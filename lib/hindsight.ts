import { HindsightClient } from "@vectorize-io/hindsight-client";

/**
 * Shared Hindsight Cloud client for the memory loop.
 *
 * Env vars (see .env.example):
 *   HINDSIGHT_API_URL  — e.g. https://api.hindsight.vectorize.io
 *   HINDSIGHT_API_KEY  — Hindsight Cloud API key
 *   HINDSIGHT_BANK_ID  — memory bank id (default: "agent-memory-loop")
 */
export const HINDSIGHT_BANK_ID =
  process.env.HINDSIGHT_BANK_ID || "agent-memory-loop";

let client: HindsightClient | null = null;

/** Read an env var, accepting both conventional uppercase and lowercase spellings. */
function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export function getHindsightClient(): HindsightClient {
  if (client) return client;

  const baseUrl = env("HINDSIGHT_API_URL", "hindsight_api_url");
  const apiKey = env("HINDSIGHT_API_KEY", "hindsight_api_key");

  if (!baseUrl) {
    throw new Error(
      "HINDSIGHT_API_URL is not set. Copy .env.example to .env.local and fill in your Hindsight Cloud credentials."
    );
  }
  if (!apiKey) {
    throw new Error(
      "HINDSIGHT_API_KEY is not set. Copy .env.example to .env.local and fill in your Hindsight Cloud credentials."
    );
  }

  client = new HindsightClient({ baseUrl, apiKey });
  return client;
}
