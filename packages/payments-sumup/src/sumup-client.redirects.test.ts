import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { SumUpClient } from "./client.js";
import { sumupClient } from "./sumup-client.js";

const calls: {
  name: string;
  request: string;
  targetBody: string;
  invoke: (client: SumUpClient) => Promise<unknown>;
}[] = [
  {
    name: "refund",
    request: "POST /v1.0/merchants/MC/payments/txn_1/refunds",
    targetBody: "",
    invoke: (client) => client.refund({ transactionId: "txn_1", amount: decimal("0.40") }),
  },
  {
    name: "sendRefund",
    request: "POST /v1.0/merchants/MC/payments/txn_1/refunds",
    targetBody: "",
    invoke: (client) => client.sendRefund({ transactionId: "txn_1", amount: decimal("0.40") }),
  },
  {
    name: "createCheckout",
    request: "POST /v0.1/merchants/MC/readers/rdr_1/checkout",
    targetBody: '{"data":{"checkout_id":"checkout_1","client_transaction_id":"ct_1"}}',
    invoke: (client) =>
      client.createCheckout({
        readerId: "rdr_1",
        amount: decimal("0.40"),
        currency: "EUR",
        description: "Test checkout",
        foreignTransactionId: "payment_1",
      }),
  },
  {
    name: "findTransaction",
    request: "GET /v2.1/merchants/MC/transactions?id=txn_1",
    targetBody: '{"id":"txn_1","status":"SUCCESSFUL","amount":0.40}',
    invoke: (client) => client.findTransaction({ id: "txn_1" }),
  },
  {
    name: "listReaders",
    request: "GET /v0.1/merchants/MC/readers",
    targetBody: '{"items":[{"id":"rdr_1","status":"paired","name":"Counter"}]}',
    invoke: (client) => client.listReaders(),
  },
  {
    name: "pairReader",
    request: "POST /v0.1/merchants/MC/readers",
    targetBody: '{"id":"rdr_1","status":"paired"}',
    invoke: (client) => client.pairReader({ pairingCode: "ABC12345", name: "Counter" }),
  },
  {
    name: "getReader",
    request: "GET /v0.1/merchants/MC/readers/rdr_1",
    targetBody: '{"id":"rdr_1","status":"paired"}',
    invoke: (client) => client.getReader("rdr_1"),
  },
  {
    name: "readerStatus",
    request: "GET /v0.1/merchants/MC/readers/rdr_1/status",
    targetBody: '{"data":{"status":"ONLINE"}}',
    invoke: (client) => client.readerStatus("rdr_1"),
  },
  {
    name: "memberships",
    request: "GET /v0.1/memberships",
    targetBody: '{"items":[{"resource_id":"MC","resource":{"name":"Test restaurant"}}]}',
    invoke: (client) => client.memberships(),
  },
];

describe.each(calls)("sumupClient $name redirects", ({ name, request, targetBody, invoke }) => {
  it.each([301, 302, 303, 307, 308])(
    "does not follow HTTP %i or accept its target",
    async (status) => {
      const requested: string[] = [];
      const server = createServer((req, res) => {
        requested.push(`${req.method ?? ""} ${req.url ?? ""}`);
        if (req.url === "/redirect-target") {
          res.writeHead(200, { "content-type": "application/json" }).end(targetBody);
        } else {
          res.writeHead(status, { location: "/redirect-target" }).end("<html>Redirect</html>");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const { port } = server.address() as AddressInfo;
        const client = sumupClient({
          apiKey: "test-key",
          merchantCode: "MC",
          baseUrl: `http://127.0.0.1:${port}`,
        });
        if (name === "sendRefund") {
          await expect(invoke(client)).resolves.toEqual({ httpStatus: status });
        } else {
          await expect(invoke(client)).rejects.toThrow(`HTTP ${status}`);
        }
        expect(requested).toEqual([request]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
