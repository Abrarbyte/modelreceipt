/**
 * OpenAI-compatible proxy: the drop-in adoption path.
 *
 *     client = OpenAI(base_url="https://<deployment>/v1", api_key=YOUR_KEY)
 *
 * One line changes in the caller's application and every completion it makes
 * from then on carries a receipt. No SDK to install, no code to restructure,
 * no lock-in: point the base URL back at the provider and everything keeps
 * working, minus the evidence.
 *
 * This shape is deliberate. The question this product answers - "which model
 * actually served this request?" - is only interesting if the answer covers
 * REAL traffic against the caller's OWN provider account. A playground can
 * demonstrate the mechanism; only a proxy can produce evidence about
 * production inference.
 *
 * Trust note, stated plainly because it matters: while the proxy serves the
 * request, the receipt attests what THIS gateway observed. That is the correct
 * trust boundary for a gateway an enterprise runs in front of its own traffic
 * (self-hosting is one `git clone` away), and it is why the receipt records the
 * gateway's own deployment digest rather than claiming to attest the upstream
 * provider's silicon. On dstack/TDX hardware the enclave measurement closes the
 * remaining gap for the gateway itself.
 */
import { NextResponse } from "next/server";
import { evidenceRecord, seal } from "@/lib/cool";
import { ensureSchema, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Upstream {
  readonly name: string;
  readonly url: string;
}

/**
 * Route by API key prefix, so the caller changes exactly one line and nothing
 * else. An explicit `x-modelreceipt-provider` header overrides it.
 */
function upstreamFor(apiKey: string, override: string | null): Upstream {
  const table: Record<string, Upstream> = {
    groq: { name: "groq", url: "https://api.groq.com/openai/v1/chat/completions" },
    openai: { name: "openai", url: "https://api.openai.com/v1/chat/completions" },
    openrouter: {
      name: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
    },
  };
  if (override && table[override]) return table[override];
  if (apiKey.startsWith("gsk_")) return table.groq;
  if (apiKey.startsWith("sk-or-")) return table.openrouter;
  return table.openai;
}

export async function POST(request: Request) {
  const started = Date.now();

  let body: {
    model?: string;
    messages?: Array<{ role: string; content: string }>;
    stream?: boolean;
    [key: string]: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: "invalid JSON body", type: "invalid_request_error" } },
      { status: 400 },
    );
  }

  if (body.stream) {
    // Honest failure beats a receipt that silently covers only part of a
    // response. Streaming needs the completion assembled before it can be
    // committed to; that is a real limitation, documented in the README.
    return NextResponse.json(
      {
        error: {
          message:
            "streaming is not supported by the ModelReceipt proxy yet: a receipt must commit to the complete output. Set stream=false.",
          type: "invalid_request_error",
        },
      },
      { status: 400 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const callerKey = auth.replace(/^Bearer\s+/i, "").trim();
  const providerOverride = request.headers.get("x-modelreceipt-provider");

  // Fall back to a server-side key so the endpoint is testable with curl and
  // no credentials at all.
  const key =
    callerKey ||
    process.env.GROQ_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    "";

  const messages = body.messages ?? [];
  const promptText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  let completionText = "";
  let modelName = typeof body.model === "string" ? body.model : "unknown";
  let providerName = "modelreceipt-builtin";
  let upstreamStatus = 200;
  let openAiResponse: Record<string, unknown> | null = null;

  if (key) {
    const upstream = upstreamFor(key, providerOverride);
    providerName = upstream.name;
    try {
      const response = await fetch(upstream.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ ...body, stream: false }),
      });
      upstreamStatus = response.status;
      const text = await response.text();

      if (!response.ok) {
        // Pass the upstream's own error through untouched - a proxy that
        // rewrites errors is a proxy nobody can debug. No receipt is issued,
        // because no inference happened.
        return new NextResponse(text, {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }

      openAiResponse = JSON.parse(text) as Record<string, unknown>;
      const choices = openAiResponse.choices as
        | Array<{ message?: { content?: string } }>
        | undefined;
      completionText = choices?.[0]?.message?.content ?? "";
      modelName = (openAiResponse.model as string) ?? modelName;
    } catch (error) {
      return NextResponse.json(
        {
          error: {
            message: `upstream request failed: ${(error as Error).message}`,
            type: "api_error",
          },
        },
        { status: 502 },
      );
    }
  } else {
    // No key anywhere: answer deterministically so the endpoint is still
    // demonstrable, and say so inside the receipt.
    const { answer } = await import("@/lib/model");
    const result = await answer(promptText || "(empty prompt)", "proxy");
    completionText = result.text;
    modelName = result.model;
    providerName = result.provider;
    openAiResponse = {
      id: `chatcmpl-modelreceipt-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: completionText },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  // Seal the exchange. The prompt and completion go in as payloads and come
  // back only as salted commitments; this service never retains either.
  const { receipt, treeSize, leafIndex } = await seal({
    type: "model.execution",
    metadata: {
      model: modelName,
      provider: providerName,
      requested_model: body.model ?? null,
      precision: "undisclosed",
      latency_ms: Date.now() - started,
      upstream_status: upstreamStatus,
      via: "openai-compatible-proxy",
      region: process.env.VERCEL_REGION ?? "local",
    },
    payloads: { input: promptText, output: completionText },
    softwareName: "modelreceipt-proxy",
    softwareVersion: "1.0.0",
  });

  const record = evidenceRecord(receipt);
  const db = sql();
  if (db) {
    try {
      await ensureSchema();
      await db`
        INSERT INTO receipts (record_id, leaf_index, event_type, model, provider, issued_at, receipt)
        VALUES (
          ${record.record_id}, ${leafIndex}, ${record.event.type},
          ${modelName}, ${providerName}, ${record.time.issued_at},
          ${JSON.stringify(receipt)}::jsonb
        )
        ON CONFLICT (record_id) DO NOTHING
      `;
    } catch (error) {
      console.error("receipt persistence failed", error);
    }
  }

  const origin = new URL(request.url).origin;
  const recordId = record.record_id;

  // The response stays byte-compatible with the OpenAI schema so existing
  // clients keep parsing it. Evidence rides alongside: small pointers in
  // headers (a full receipt would blow the header size limit), and the receipt
  // itself under a namespaced key that OpenAI clients ignore.
  return NextResponse.json(
    { ...openAiResponse, _modelreceipt: receipt },
    {
      headers: {
        "x-modelreceipt-id": recordId,
        "x-modelreceipt-verify": `${origin}/verify?record=${recordId}`,
        "x-modelreceipt-badge": `${origin}/api/badge/${recordId}`,
        "x-modelreceipt-tree-size": String(treeSize),
        "x-modelreceipt-leaf": String(leafIndex ?? ""),
      },
    },
  );
}
