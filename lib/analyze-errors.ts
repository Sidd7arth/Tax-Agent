/**
 * Error taxonomy for the analyze flow.
 *
 * The route catches everything, classifies it, logs full details server-side,
 * and returns a short, safe message plus which system failed (`source`).
 * The UI renders a labeled error panel with a retry — no blank screens, no
 * leaked stack traces or upstream response bodies.
 */

export type AnalyzeErrorSource = "request" | "hindsight" | "llm" | "server";

/** Upstream sources (what actually failed), as sent to the client. */
export type UpstreamSource = "hindsight" | "llm";

export class AnalyzeError extends Error {
  readonly source: AnalyzeErrorSource;
  readonly status: number;

  constructor(source: AnalyzeErrorSource, message: string, status = 500) {
    super(message);
    this.name = "AnalyzeError";
    this.source = source;
    this.status = status;
  }
}

/** Upstream calls are capped so a hung provider can't hang the request. */
export const UPSTREAM_TIMEOUT_MS = 30_000;

/** True when the error came from an aborted / timed-out request. */
export function isTimeoutError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Normalize any throw from an upstream call into an AnalyzeError whose
 * message is safe to show the user; full details go to server logs only.
 */
export function toUpstreamError(
  source: UpstreamSource,
  error: unknown
): AnalyzeError {
  if (error instanceof AnalyzeError) return error;

  const label =
    source === "hindsight" ? "Hindsight memory service" : "LLM provider";

  if (isTimeoutError(error)) {
    return new AnalyzeError(
      source,
      `${label} timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s. Try again in a moment.`
    );
  }
  if (error instanceof Error && error.message.includes("fetch failed")) {
    return new AnalyzeError(
      source,
      `${label} is unreachable right now. Try again in a moment.`
    );
  }

  // HindsightError and provider errors land here: keep the message short and
  // strip anything that looks like a multi-line stack/body dump.
  const detail = (error instanceof Error ? error.message : String(error))
    .split("\n")[0]
    .slice(0, 200);

  // HindsightError carries the HTTP status of the failed call.
  const statusCode =
    typeof (error as { statusCode?: unknown })?.statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : undefined;

  if (statusCode === 401 || statusCode === 403) {
    return new AnalyzeError(
      source,
      `${label} rejected the API credentials. Check the keys in .env.local.`,
      503
    );
  }
  if (statusCode === 429) {
    return new AnalyzeError(
      source,
      `${label} is rate limiting requests. Wait a moment and try again.`,
      429
    );
  }

  return new AnalyzeError(source, `${label} request failed: ${detail}`, 502);
}
