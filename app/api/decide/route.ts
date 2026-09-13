/**
 * Seal a structured decision.
 *
 * This is the same gateway as /api/infer with one difference that matters:
 * the input is a JSON record about a person - a claim, an application, an
 * onboarding case - and the output is a JSON decision about them. That is what
 * production AI at insurers and banks actually does, and it is the shape of
 * decision a person later disputes.
 *
 * The receipt commits to the exact input bytes and the exact decision bytes.
 * Later, "was my claim decided on the data I submitted, by the model version
 * the insurer says it used?" has a cryptographic answer rather than a
 * customer-service one.
 */
import { NextResponse } from "next/server";
import { evidenceRecord, seal } from "@/lib/cool";
import { ensureSchema, sql } from "@/lib/db";
import { isDurable } from "@/lib/durable-log";
import { normaliseSession, subjectRef } from "@/lib/identity";
import { scenarioById } from "@/lib/scenarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface DecideBody {
  scenario?: unknown;
  input?: unknown;
  subject?: unknown;
  sessionId?: unknown;
}

/** Call the configured provider with a system prompt, expecting JSON back. */
async function decide(system: string, input: Record<string, unknown>) {
  const key =
    process.env.GROQ_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim();

  const userMessage = JSON.stringify(input, null, 2);

  if (!key) {
    // Deterministic fallback so the demo works with no provider configured.
    // Clearly labelled in the receipt as the built-in model.
    return {
      text: JSON.stringify(
        { decision: "ESCALATE_TO_HUMAN", reason: "No upstream model configured on this deployment.", demo: true },
        null,
        2,
      ),
      model: "demo-model-decide",
      provider: "modelreceipt-builtin",
      simulated: true,
    };
  }

  const isGroq = key.startsWith("gsk_");
  const isOpenRouter = key.startsWith("sk-or-");
  const url = isGroq
    ? "https://api.groq.com/openai/v1/chat/completions"
    : isOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
  const model = isGroq
    ? process.env.GROQ_MODEL?.trim() || "qwen/qwen3.8-27b"
    : isOpenRouter
      ? process.env.OPENROUTER_MODEL?.trim() || "meta-llama/llama-3.3-70b-instruct:free"
      : process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
      temperature: 0,
      max_tokens: 400,
    }),
  });

  if (!response.ok) {
    throw new Error(`upstream ${response.status}: ${(await response.text()).slice(0, 160)}`);
  }
  const body = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("upstream returned an empty decision");

  return {
    text,
    model: body.model ?? model,
    provider: isGroq ? "groq" : isOpenRouter ? "openrouter" : "openai",
    simulated: false,
  };
}

/** Pull the JSON object out of a reply that may be wrapped in a code fence. */
function parseDecision(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function POST(request: Request) {
  let body: DecideBody;
  try {
    body = (await request.json()) as DecideBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const scenario = scenarioById(String(body.scenario ?? ""));
  if (!scenario) {
    return NextResponse.json({ error: "unknown scenario" }, { status: 400 });
  }

  // Callers may edit the sample input; anything else falls back to the sample.
  const input =
    body.input && typeof body.input === "object" && !Array.isArray(body.input)
      ? (body.input as Record<string, unknown>)
      : scenario.input;
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const sessionId = normaliseSession(body.sessionId);

  const started = Date.now();
  let result;
  try {
    result = await decide(scenario.system, input);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
  const decision = parseDecision(result.text);

  // The input bytes and the decision bytes are what get committed. Serialising
  // deterministically means a re-submission of the same claim produces the same
  // commitment, which is what makes "you decided on different data" checkable.
  const inputBytes = JSON.stringify(input, Object.keys(input).sort());
  const outputBytes = decision ? JSON.stringify(decision, Object.keys(decision).sort()) : result.text;

  const { receipt, treeSize, leafIndex } = await seal({
    type: scenario.eventType,
    metadata: {
      scenario: scenario.id,
      model: result.model,
      provider: result.provider,
      simulated_model: result.simulated,
      latency_ms: Date.now() - started,
      decision: decision?.decision ?? decision?.risk_tier ?? decision?.priority ?? null,
      subject: subject || null,
      session: sessionId,
      region: process.env.VERCEL_REGION ?? "local",
    },
    payloads: { input: inputBytes, output: outputBytes },
    softwareName: `modelreceipt-decide-${scenario.id}`,
    softwareVersion: "1.0.0",
  });

  const record = evidenceRecord(receipt);
  const db = sql();
  if (db) {
    try {
      await ensureSchema();
      await db`
        INSERT INTO receipts (
          record_id, leaf_index, event_type, model, provider, issued_at, receipt, subject_ref, session_id
        ) VALUES (
          ${record.record_id}, ${leafIndex}, ${record.event.type},
          ${result.model}, ${result.provider}, ${record.time.issued_at},
          ${JSON.stringify(receipt)}::jsonb,
          ${subject ? subjectRef(subject) : null}, ${sessionId}
        )
        ON CONFLICT (record_id) DO NOTHING
      `;
    } catch (error) {
      console.error("receipt persistence failed", error);
    }
  }

  return NextResponse.json({
    scenario: scenario.id,
    eventType: scenario.eventType,
    decision,
    raw: result.text,
    model: result.model,
    provider: result.provider,
    simulatedModel: result.simulated,
    latencyMs: Date.now() - started,
    committed: { input: inputBytes, output: outputBytes },
    receipt,
    log: { treeSize, leafIndex, durable: isDurable() },
  });
}
