# How Hindsight powers the audit agent

Hindsight Cloud is the agent's only memory — the app has no database. Everything runs through `@vectorize-io/hindsight-client`.

**Bank scoping.** Every client gets an isolated memory bank: `${HINDSIGHT_BANK_ID}-${clientId}` (for the demo, `agent-memory-loop-demo-client-1`). Memories never cross clients; a fresh client id starts with an empty bank.

**The loop.** On each `POST /api/agent/analyze` the route first *recalls*: the submitted document text is the query, and the returned facts' texts become the "What the agent remembered" panel. Those same facts are injected into the LLM prompt as "Memory of prior documents:" above "Document under review:", so flags are judged against related prior filings. Only then does the route *retain* the document, so the next analysis sees it — a first-ever submission recalls nothing by construction. Nothing is deduplicated, so reruns accumulate.

**Why it matters.** Two near-identical filings behave differently: the first gets basic flags; the second surfaces escalation ("repeated" violations) because the first is already in memory. That is the Invoice #4 → #7 before/after demo.

`scripts/memory-loop-test.ts` runs the same retain → recall → think loop standalone.
