import { NextResponse } from "next/server";

import {
  AnalyzeError,
  UPSTREAM_TIMEOUT_MS,
  toUpstreamError,
} from "@/lib/analyze-errors";
import { demoClients } from "@/lib/demo-data";
import { HINDSIGHT_BANK_ID, getHindsightClient } from "@/lib/hindsight";

/**
 * POST /api/agent/analyze
 *
 * Body: { clientId: string, documentText: string }
 *
 * Memory loop against Hindsight Cloud, no database:
 *   1. RECALL  — retrieve memories related to the submitted document
 *   2. THINK   — flags via Groq over the recalled (prior) context
 *   3. RETAIN  — only then store this document, so the next analysis sees it
 *
 * Because retain happens last, the first submission for a fresh bank recalls
 * nothing: the "remembered" panel shows only what came before this document.
 *
 * Failure contract (see lib/analyze-errors.ts):
 *   400  malformed JSON / missing fields          (source: request)
 *   404  unknown clientId                         (source: request)
 *   429  LLM provider rate limit                  (source: llm)
 *   502  upstream returned an error               (source: hindsight | llm)
 *   503  misconfigured provider credentials       (source: hindsight | llm)
 *   504  upstream timed out                       (source: hindsight | llm)
 *   500  anything else — generic, safe message    (source: server)
 *
 * Every failure returns { error, source } so the UI can show a labeled,
 * human-readable message instead of a blank screen.
 */

type Flag = { severity: "high" | "medium" | "low"; title: string; detail: string };

/** Stable short hash so the same text re-retains under the same documentId. */
function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

type AnalyzeBody = {
  clientId?: unknown;
  documentText?: unknown;
};

/** Reject if the upstream call neither settles nor aborts within the cap. */
function withTimeout<T>(source: "hindsight" | "llm", promise: Promise<T>): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(
        new DOMException(`${source} call exceeded ${UPSTREAM_TIMEOUT_MS}ms`, "TimeoutError")
      );
    }, UPSTREAM_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]);
}

async function groqFlags(documentText: string, memories: string[]): Promise<Flag[]> {
  const apiKey =
    process.env.GROQ_API_KEY?.trim() || process.env.groq_api_key?.trim();
  if (!apiKey) {
    throw new AnalyzeError(
      "llm",
      "LLM provider is not configured: GROQ_API_KEY is missing from .env.local.",
      503
    );
  }

  let response: Response;
  try {
    response = await withTimeout(
      "llm",
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are a compliance auditor. Given a document and the agent's memory of related " +
                "prior documents, list every flag worth raising. Respond with ONLY a JSON array; " +
                'each element: {"severity": "high"|"medium"|"low", "title": string, "detail": string}. ' +
                "If nothing is worth flagging, respond with [].",
            },
            {
              role: "user",
              content: `Memory of prior documents:\n${
                memories.length ? memories.map((m) => `- ${m}`).join("\n") : "(none yet)"
              }\n\nDocument under review:\n${documentText}`,
            },
          ],
        }),
      })
    );
  } catch (error) {
    throw toUpstreamError("llm", error);
  }

  if (!response.ok) {
    // Log the full upstream body server-side; surface only a safe summary.
    const upstreamBody = await response.text().catch(() => "(no body)");
    console.error(
      `[/api/agent/analyze] Groq error ${response.status}:`,
      upstreamBody.slice(0, 500)
    );

    if (response.status === 401 || response.status === 403) {
      throw new AnalyzeError(
        "llm",
        "LLM provider rejected the API key. Check GROQ_API_KEY in .env.local.",
        503
      );
    }
    if (response.status === 404) {
      throw new AnalyzeError(
        "llm",
        "LLM model is not available on this Groq account. Update the model name.",
        503
      );
    }
    if (response.status === 429) {
      throw new AnalyzeError(
        "llm",
        "LLM provider is rate limiting requests. Wait a moment and try again.",
        429
      );
    }
    throw new AnalyzeError(
      "llm",
      `LLM provider request failed (HTTP ${response.status}). Try again in a moment.`,
      502
    );
  }

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = await response.json();
  } catch {
    throw new AnalyzeError(
      "llm",
      "LLM provider returned a malformed response. Try again in a moment.",
      502
    );
  }

  const raw = data.choices?.[0]?.message?.content?.trim() ?? "[]";

  // Tolerate models that wrap the array in prose or code fences.
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  const json = start !== -1 && end > start ? raw.slice(start, end + 1) : "[]";

  try {
    const parsed = JSON.parse(json) as Flag[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new AnalyzeError(
      "llm",
      "LLM returned an unparseable flags response. Try again in a moment.",
      502
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: AnalyzeBody;
    try {
      body = (await request.json()) as AnalyzeBody;
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON.", source: "request" },
        { status: 400 }
      );
    }

    const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
    const documentText =
      typeof body?.documentText === "string" ? body.documentText.trim() : "";

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required", source: "request" },
        { status: 400 }
      );
    }
    if (!documentText) {
      return NextResponse.json(
        { error: "documentText is required", source: "request" },
        { status: 400 }
      );
    }
    if (!demoClients.some((c) => c.id === clientId)) {
      return NextResponse.json(
        { error: `Unknown client: ${clientId}`, source: "request" },
        { status: 404 }
      );
    }

    const client = getHindsightClient();
    // Per-client bank keeps demo data isolated (e.g. from scripts/memory-loop-test.ts).
    const bankId = `${HINDSIGHT_BANK_ID}-${clientId}`;

    // 1. RECALL — related PRIOR memories (this document is not stored yet).
    //    A bank that has never been retained into does not exist yet; Hindsight
    //    404s on it. For the very first document that is the same as zero
    //    memories, so map it to an empty recall instead of a 502.
    let memories: string[];
    try {
      const recall = await withTimeout(
        "hindsight",
        client.recall(bankId, documentText, {
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        })
      );
      memories = recall.results.map((r) => r.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found") && message.includes(bankId)) {
        memories = [];
      } else {
        throw toUpstreamError("hindsight", error);
      }
    }

    // 2. THINK — flags synthesized from prior memory + document.
    const flags = await groqFlags(documentText, memories);

    // 3. RETAIN — store this document only after the check, so the next
    //    analysis can use it (the first-ever analysis recalls nothing).
    //    documentId makes re-analyzing the same text idempotent: it replaces
    //    the earlier memories instead of duplicating them (retry-safe).
    try {
      await withTimeout(
        "hindsight",
        client.retain(bankId, documentText, {
          context: `Client ${clientId} filing`,
          metadata: { clientId },
          documentId: `${clientId}:${hashText(documentText)}`,
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        })
      );
    } catch (error) {
      throw toUpstreamError("hindsight", error);
    }

    return NextResponse.json({ flags, remembered: memories });
  } catch (error) {
    // Full details stay in server logs; the client gets a safe message.
    console.error("[/api/agent/analyze] analyze failed:", error);

    if (error instanceof AnalyzeError) {
      return NextResponse.json(
        { error: error.message, source: error.source },
        { status: error.status }
      );
    }

    // Hindsight errors that escaped a wrapper map to their source with the
    // right status (503 for auth, 502 otherwise).
    const isHindsight =
      error instanceof Error &&
      (error.name === "HindsightError" || error.constructor.name === "HindsightError");
    if (isHindsight) {
      const normalized = toUpstreamError("hindsight", error);
      return NextResponse.json(
        { error: normalized.message, source: normalized.source },
        { status: normalized.status }
      );
    }

    return NextResponse.json(
      {
        error: "Something went wrong while analyzing this document. Try again.",
        source: "server",
      },
      { status: 500 }
    );
  }
}
