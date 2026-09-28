/**
 * Hardcoded demo data — deliberately no database or persistence layer.
 *
 * Client 1 holds the before/after test pair: near-identical late filings,
 * used to compare how the agent handles the first occurrence versus the
 * second, nearly identical one. Client 2 exists to demonstrate bank
 * isolation: the same filing text analyzed under client 2 must recall
 * nothing from client 1's memory.
 */

export type DemoFiling = {
  id: string;
  text: string;
};

export type DemoClient = {
  id: string;
  name: string;
  filings: DemoFiling[];
};

export const DEMO_CLIENT_ID = "demo-client-1";

export const demoClients: DemoClient[] = [
  {
    id: "demo-client-1",
    name: "Demo Client 1",
    filings: [
      {
        id: "filing-invoice-4",
        text: "Invoice #4, filed 9 days late, no note attached",
      },
      {
        id: "filing-invoice-7",
        text: "Invoice #7, filed 6 days late, no note attached",
      },
    ],
  },
  {
    id: "demo-client-2",
    name: "Demo Client 2 (isolation check)",
    filings: [
      {
        id: "filing-invoice-4-clone",
        text: "Invoice #4, filed 9 days late, no note attached",
      },
    ],
  },
];
