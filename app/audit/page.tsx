"use client";

import { useState } from "react";

import { demoClients, type DemoFiling } from "@/lib/demo-data";

type Flag = { severity: "high" | "medium" | "low"; title: string; detail: string };

type AnalyzeResponse = {
  flags?: Flag[];
  remembered?: string[];
  error?: string;
  source?: "request" | "hindsight" | "llm" | "server";
};

const sourceLabels: Record<NonNullable<AnalyzeResponse["source"]>, string> = {
  request: "Invalid input",
  hindsight: "Memory service error",
  llm: "AI provider error",
  server: "Server error",
};

type PanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; source?: AnalyzeResponse["source"] }
  | { status: "done"; flags: Flag[]; remembered: string[] };

const severityStyles: Record<Flag["severity"], string> = {
  high: "border-red-200 bg-red-50 text-red-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-sky-200 bg-sky-50 text-sky-800",
};

function ResultPanels({
  state,
}: {
  state: Extract<PanelState, { status: "done" }>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Flags */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Flags
        </h2>
        {state.flags.length === 0 ? (
          <p className="text-sm text-slate-500">No flags raised for this document.</p>
        ) : (
          <ul className="space-y-2">
            {state.flags.map((flag, i) => (
              <li
                key={i}
                className={`rounded-md border p-3 text-sm ${severityStyles[flag.severity] ?? severityStyles.low}`}
              >
                <p className="font-medium">
                  <span className="mr-2 rounded px-1.5 py-0.5 text-xs font-semibold uppercase">
                    {flag.severity}
                  </span>
                  {flag.title}
                </p>
                <p className="mt-1 opacity-90">{flag.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What the agent remembered */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          What the agent remembered
        </h2>
        {state.remembered.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing relevant came back from memory.
          </p>
        ) : (
          <ul className="space-y-2">
            {state.remembered.map((memory, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
              >
                {memory}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function AuditPage() {
  const [selectedClientId, setSelectedClientId] = useState<string>(
    demoClients[0]?.id ?? ""
  );
  const selectedClient =
    demoClients.find((c) => c.id === selectedClientId) ?? demoClients[0];

  const filings: DemoFiling[] = selectedClient?.filings ?? [];

  const [selectedFilingId, setSelectedFilingId] = useState<string>(
    filings[0]?.id ?? ""
  );
  const [customText, setCustomText] = useState("");
  const [state, setState] = useState<PanelState>({ status: "idle" });

  async function handleSubmit() {
    const selected = filings.find((f) => f.id === selectedFilingId);
    const text = customText.trim() || selected?.text || "";

    if (!text) {
      setState({
        status: "error",
        message: "Pick a filing or enter some text first.",
        source: "request",
      });
      return;
    }

    setState({ status: "loading" });
    try {
      let response: Response;
      try {
        response = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: selectedClient?.id ?? "demo-client-1",
            documentText: text,
          }),
        });
      } catch {
        // fetch only rejects on network-level failures (offline, server down).
        throw new Error(
          "Could not reach the server. Check your connection and try again.",
          { cause: "server" }
        );
      }

      // The body may not be JSON (e.g. an HTML error page from a proxy).
      let data: AnalyzeResponse;
      try {
        data = (await response.json()) as AnalyzeResponse;
      } catch {
        data = { error: `Request failed (HTTP ${response.status})` };
      }

      if (!response.ok) {
        throw new Error(data.error ?? `Request failed (HTTP ${response.status})`, {
          cause: data.source ?? "server",
        });
      }

      setState({
        status: "done",
        flags: data.flags ?? [],
        remembered: data.remembered ?? [],
      });
    } catch (error) {
      const cause =
        error instanceof Error && error.cause ? String(error.cause) : "server";
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unexpected error. Try again.",
        source: (cause as AnalyzeResponse["source"]) ?? "server",
      });
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-white px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Audit</h1>
      <p className="mt-1 text-sm text-slate-500">
        Pick a filing (or paste custom text) and run the agent&apos;s memory loop over it.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
        className="mt-6 space-y-4"
      >
        <div>
          <label
            htmlFor="client"
            className="block text-sm font-medium text-slate-700"
          >
            Client
          </label>
          <select
            id="client"
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              const next = demoClients.find((c) => c.id === e.target.value);
              setSelectedFilingId(next?.filings[0]?.id ?? "");
            }}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            {demoClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="filing"
            className="block text-sm font-medium text-slate-700"
          >
            Filing
          </label>
          <select
            id="filing"
            value={selectedFilingId}
            onChange={(e) => setSelectedFilingId(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            {filings.map((filing) => (
              <option key={filing.id} value={filing.id}>
                {filing.text}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="custom"
            className="block text-sm font-medium text-slate-700"
          >
            Custom text (overrides the filing above)
          </label>
          <textarea
            id="custom"
            rows={4}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="Paste a document to analyze…"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>

        <button
          type="submit"
          disabled={state.status === "loading"}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.status === "loading" ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      <div className="mt-8">
        {state.status === "error" && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            <p className="font-medium">
              {state.source ? sourceLabels[state.source] : "Something went wrong"}
            </p>
            <p className="mt-1">{state.message}</p>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        )}
        {state.status === "done" && <ResultPanels state={state} />}
      </div>
    </main>
  );
}
