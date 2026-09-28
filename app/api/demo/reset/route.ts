import { NextResponse } from "next/server";

import { demoClients } from "@/lib/demo-data";
import { HINDSIGHT_BANK_ID, getHindsightClient } from "@/lib/hindsight";

/**
 * POST /api/demo/reset
 *
 * Body: { clientId: string } — or { clientId: "all" } for every demo client.
 *
 * Deletes the client's Hindsight bank so the next analyze behaves like a
 * first-ever run: Invoice #4 recalls nothing, and the before/after demo is
 * reproducible without editing .env.local or restarting the server.
 *
 * Not used by the audit flow itself — this is a demo-control endpoint.
 * It is limited to the hardcoded demo-client allowlist and carries no auth:
 * fine for the local demo, do NOT expose publicly as-is.
 */
export async function POST(request: Request) {
  try {
    let body: { clientId?: unknown };
    try {
      body = (await request.json()) as { clientId?: unknown };
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 }
      );
    }

    const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    const client = getHindsightClient();

    if (clientId === "all") {
      for (const c of demoClients) {
        try {
          await client.deleteBank(`${HINDSIGHT_BANK_ID}-${c.id}`);
        } catch {
          // Bank doesn't exist yet — already fresh, nothing to do.
        }
      }
      return NextResponse.json({ reset: demoClients.map((c) => c.id) });
    }

    if (!demoClients.some((c) => c.id === clientId)) {
      return NextResponse.json(
        { error: `Unknown client: ${clientId}` },
        { status: 404 }
      );
    }

    const bankId = `${HINDSIGHT_BANK_ID}-${clientId}`;
    try {
      await client.deleteBank(bankId);
    } catch {
      // Bank doesn't exist yet — already fresh.
    }

    return NextResponse.json({ reset: [clientId], bankId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[/api/demo/reset] failed:", message);
    return NextResponse.json(
      { error: "Reset failed. Check the server logs." },
      { status: 500 }
    );
  }
}
