/**
 * Memory loop end-to-end test.
 *
 *   npx tsx scripts/memory-loop-test.ts
 *
 * Exercises the full loop against Hindsight Cloud:
 *   1. RETAIN  — store a few facts in the memory bank (synchronous)
 *   2. RECALL  — retrieve them with a natural-language query
 *   3. THINK   — synthesize an answer from the recalled memories via Groq
 *
 * Env (see .env.example): HINDSIGHT_API_URL, HINDSIGHT_API_KEY,
 * optional HINDSIGHT_BANK_ID, GROQ_API_KEY.
 */

import { HindsightClient, type RecallResponse } from "@vectorize-io/hindsight-client";

// --- env ---------------------------------------------------------------------

try {
  // Node >= 21.7: load .env.local into process.env (tsx does not do it for us).
  process.loadEnvFile(".env.local");
  console.log("Loaded environment from .env.local");
} catch {
  console.log("No .env.local found — relying on ambient environment");
}

/** Accept both CONVENTIONAL_UPPER and lowercase key spellings. */
function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

const HINDSIGHT_API_URL = env("HINDSIGHT_API_URL", "hindsight_api_url");
const HINDSIGHT_API_KEY = env("HINDSIGHT_API_KEY", "hindsight_api_key");
const GROQ_API_KEY = env("GROQ_API_KEY", "groq_api_key");
const BANK_ID = env("HINDSIGHT_BANK_ID", "hindsight_bank_id") ?? "agent-memory-loop";

// --- helpers -----------------------------------------------------------------

async function groqAnswer(question: string, memories: string[]): Promise<string> {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Answer the user's question using ONLY the provided memories. " +
            "If the memories do not contain the answer, say so plainly.",
        },
        {
          role: "user",
          content:
            `Memories:\n${memories.map((m) => `- ${m}`).join("\n")}\n\nQuestion: ${question}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq API error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "(empty response)";
}

// --- main --------------------------------------------------------------------

async function main() {
  console.log(`Bank: ${BANK_ID}`);
  if (!HINDSIGHT_API_URL || !HINDSIGHT_API_KEY) {
    throw new Error(
      "HINDSIGHT_API_URL / HINDSIGHT_API_KEY are not set — copy .env.example to .env.local and fill in your keys"
    );
  }

  const client = new HindsightClient({
    baseUrl: HINDSIGHT_API_URL,
    apiKey: HINDSIGHT_API_KEY,
  });

  // 1. RETAIN -----------------------------------------------------------------
  const facts = [
    { content: "Siddhartha's favorite programming language is TypeScript.", context: "intro conversation" },
    { content: "Siddhartha is building an agent in public and posts progress weekly.", context: "intro conversation" },
    { content: "Siddhartha prefers concise answers over long explanations.", context: "style preferences" },
  ];

  console.log("\n=== 1. RETAIN ===");
  for (const fact of facts) {
    const result = await client.retain(BANK_ID, fact.content, { context: fact.context });
    console.log(`  ✓ stored (${result.items_count} item) — "${fact.content}"`);
  }

  // Give the index a moment to settle before querying.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 2. RECALL -----------------------------------------------------------------
  const question = "What is Siddhartha building and how does he like his answers?";
  console.log(`\n=== 2. RECALL ===`);
  console.log(`  query: "${question}"`);

  const recall: RecallResponse = await client.recall(BANK_ID, question);
  const memories = recall.results.map((r) => r.text);

  if (memories.length === 0) {
    console.log("  ⚠ no results — nothing was recalled");
  }
  for (const r of recall.results) {
    const score = r.scores && "final" in r.scores ? ` (score: ${(r.scores as { final?: number }).final})` : "";
    console.log(`  ← [${r.type ?? "fact"}] ${r.text}${score}`);
  }

  // 3. THINK ------------------------------------------------------------------
  console.log("\n=== 3. THINK (Groq) ===");
  const answer = await groqAnswer(question, memories);
  console.log(`  ${answer}`);

  console.log("\n✅ Memory loop completed: retain → recall → think");
}

main().catch((error) => {
  console.error("\n❌ Memory loop failed:");
  const details =
    error && typeof error === "object" && "details" in error
      ? `\nDetails: ${JSON.stringify((error as { details: unknown }).details, null, 2)}`
      : "";
  console.error(`${error instanceof Error ? error.message : String(error)}${details}`);
  process.exit(1);
});
