import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { decimal, deviceOrigin, workingOrderId } from "@waitron/shared";
import { StripeTerminalProvider } from "./provider.js";
import { stripeClient } from "./stripe-client.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

describe("unknown Stripe payments through the installed HTTP client", () => {
  it.each(["succeeded", "canceled"] as const)(
    "uses the re-read's %s after HTTP refusals",
    async (status) => {
      const calls: string[] = [];
      let cancelled = false;
      const server = createServer((req, res) => {
        calls.push(`${req.method} ${req.url}`);
        req.resume();
        req.on("end", () => {
          let code = 200;
          let body: unknown;
          if (req.url === "/v1/payment_intents" && req.method === "POST") body = { id: "pi_http" };
          else if (req.url === "/v1/terminal/readers/reader_http/process_payment_intent")
            body = { id: "reader_http", action: { status: "in_progress" } };
          else if (req.url === "/v1/payment_intents/pi_http" && req.method === "GET")
            body = {
              id: "pi_http",
              status: cancelled ? status : "requires_payment_method",
              amount: 1210,
              amount_received: cancelled && status === "succeeded" ? 1210 : 0,
              currency: "eur",
            };
          else {
            if (req.url === "/v1/payment_intents/pi_http/cancel") cancelled = true;
            code = req.method === "GET" ? 401 : 400;
            body = { error: { type: "invalid_request_error", message: "refused" } };
          }
          res.writeHead(code, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const { port } = server.address() as AddressInfo;
        const sdk = new Stripe("sk_test_local", { host: "127.0.0.1", port, protocol: "http" });
        const provider = new StripeTerminalProvider({
          db: suite.db,
          client: stripeClient(sdk),
          poll: { maxAttempts: 1, intervalMs: 0 },
        });
        const seeded = await seedWorkingOrder(suite.db);
        const result = await provider.collect({
          origin: deviceOrigin(seeded.deviceId),
          workingOrderId: workingOrderId(seeded.workingOrderId),
          amount: decimal("12.10"),
          readerRef: "reader_http",
        });
        expect(result.state).toBe("attempting");
        expect(
          (await getPaymentByRef(suite.db, { provider: "stripe", paymentRef: result.paymentRef }))
            ?.externalRef,
        ).toBe("pi_http");
        const pass = await provider.resolvePending(new Date("2026-10-17T00:00:00Z"));
        expect(pass).toEqual({
          nextDueAt: null,
          forwarded: status === "succeeded" ? 1 : 0,
          declined: status === "canceled" ? 1 : 0,
          incidentsRaised: 0,
        });
        expect(
          (await getPaymentByRef(suite.db, { provider: "stripe", paymentRef: result.paymentRef }))
            ?.state,
        ).toBe(status === "succeeded" ? "captured" : "failed");
        expect(
          (await suite.db.execute(sql`select person_id, provider_status from payment_resolutions`))
            .rows,
        ).toEqual([{ person_id: null, provider_status: status }]);
        expect(calls).toEqual([
          "POST /v1/payment_intents",
          "POST /v1/terminal/readers/reader_http/process_payment_intent",
          "GET /v1/terminal/readers/reader_http",
          "POST /v1/terminal/readers/reader_http/cancel_action",
          "GET /v1/payment_intents/pi_http",
          "POST /v1/payment_intents/pi_http/cancel",
          "GET /v1/payment_intents/pi_http",
        ]);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});
