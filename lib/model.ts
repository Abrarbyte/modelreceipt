/**
 * The model layer the gateway wraps.
 *
 * ModelReceipt is not a model vendor - it is the evidence layer in front of
 * one. Any provider works; what matters for the receipt is that we can name,
 * and commit to, exactly which model answered.
 *
 * With no API key configured the gateway serves a deterministic built-in model
 * so the public demo works for anyone who opens the link. That model is clearly
 * labelled `demo-*` everywhere it appears, including inside the receipt, for
 * the same reason the SDK labels simulated attestation: evidence that quietly
 * overstates what it covers is worse than no evidence.
 */
import { createHash } from "node:crypto";

export interface ModelAnswer {
  readonly text: string;
  /** Model identifier as the provider names it. Goes into the receipt. */
  readonly model: string;
  /** Which upstream served it. Goes into the receipt. */
  readonly provider: string;
  /** Serving precision, when the provider discloses it. */
  readonly precision: string;
  readonly latencyMs: number;
  /** True when this was the built-in demo model rather than real inference. */
  readonly simulated: boolean;
}

interface Provider {
  readonly name: string;
  readonly key: string | undefined;
  readonly model: string;
  readonly url: string;
  headers(key: string): Record<string, string>;
}

/**
 * Read an environment variable, treating blank as unset.
 *
 * `??` only falls back on undefined, so an env var that exists but is empty -
 * easily created by a mis-paste in a hosting dashboard - silently overrides the
 * default with "". That produced a live deployment advertising a model id of
 * "", which is precisely the kind of quiet config drift this product exists to
 * make visible.
 */
function env(name: string, fallback: string): string {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function providerKey(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function providers(): Provider[] {
  return [
    {
      name: "groq",
      key: providerKey("GROQ_API_KEY"),
      model: env("GROQ_MODEL", "qwen/qwen3.8-27b"),
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: (key) => ({ Authorization: `Bearer ${key}` }),
    },
    {
      name: "openai",
      key: providerKey("OPENAI_API_KEY"),
      model: env("OPENAI_MODEL", "gpt-4o-mini"),
      url: "https://api.openai.com/v1/chat/completions",
      headers: (key) => ({ Authorization: `Bearer ${key}` }),
    },
    {
      name: "openrouter",
      key: providerKey("OPENROUTER_API_KEY"),
      model: env("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free"),
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: (key) => ({ Authorization: `Bearer ${key}` }),
    },
  ];
}

/** The provider that will actually serve, or null when none is configured. */
export function activeProvider(): { name: string; model: string } | null {
  const provider = providers().find((p) => p.key);
  return provider ? { name: provider.name, model: provider.model } : null;
}

/**
 * The built-in demo model.
 *
 * Deterministic: the same prompt always produces the same answer, which makes
 * it genuinely useful for this product. It lets a visitor send one prompt
 * twice, under two different declared "model versions", and see that the
 * receipts differ in exactly the field that matters.
 */
function demoModel(prompt: string, variant: string): string {
  const digest = createHash("sha256").update(`${variant}:${prompt}`).digest("hex");
  const confidence = 60 + (parseInt(digest.slice(0, 2), 16) % 40);
  const words = prompt.trim().split(/\s+/).length;
  return [
    `[demo model ${variant}] Processed a ${words}-word prompt.`,
    ``,
    `This deployment has no upstream model configured, so the gateway answered`,
    `deterministically. The receipt alongside this answer is NOT simulated: it`,
    `was produced by the CooL SDK, signed, and appended to the live transparency`,
    `log. Verify it on the Verify page, then change one character and watch it`,
    `fail.`,
    ``,
    `Deterministic fingerprint: ${digest.slice(0, 32)}`,
    `Synthetic confidence: ${confidence}%`,
  ].join("\n");
}

/** Call the configured provider, or the demo model when none is set. */
export async function answer(prompt: string, variant = "v1"): Promise<ModelAnswer> {
  const started = Date.now();
  const provider = providers().find((p) => p.key);

  if (!provider) {
    return {
      text: demoModel(prompt, variant),
      model: `demo-model-${variant}`,
      provider: "modelreceipt-builtin",
      precision: "deterministic",
      latencyMs: Date.now() - started,
      simulated: true,
    };
  }

  try {
    const response = await fetch(provider.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...provider.headers(provider.key as string) },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${provider.name} ${response.status}: ${detail.slice(0, 200)}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
    };
    const message = body.choices?.[0]?.message;
    // Some reasoning models return an empty `content` and put the answer in
    // `reasoning`. Committing to an empty string would produce a technically
    // valid receipt for an answer the user never saw, so fall back explicitly
    // rather than sealing a blank.
    const text = message?.content?.trim() || message?.reasoning?.trim() || "";
    if (!text) {
      throw new Error(`${provider.name} returned an empty completion`);
    }

    return {
      text,
      model: provider.model,
      provider: provider.name,
      // Providers do not disclose serving precision today. Saying "unknown"
      // rather than guessing is the honest record - and is precisely the gap
      // this product exists to close.
      precision: "undisclosed",
      latencyMs: Date.now() - started,
      simulated: false,
    };
  } catch (error) {
    // A provider outage must not cost us the evidence. Fall back, and record
    // the fallback truthfully rather than pretending the upstream answered.
    return {
      text: demoModel(prompt, variant),
      model: `demo-model-${variant}`,
      provider: `modelreceipt-builtin (fallback: ${(error as Error).message.slice(0, 80)})`,
      precision: "deterministic",
      latencyMs: Date.now() - started,
      simulated: true,
    };
  }
}
