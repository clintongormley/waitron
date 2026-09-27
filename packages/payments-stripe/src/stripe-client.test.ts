import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { stripeClient } from "./stripe-client.js";

/** Only the two PaymentIntent calls the abandoned-attempt resolver makes. */
function fakeStripe(calls: string[]): Stripe {
  return {
    paymentIntents: {
      retrieve: (id: string) => {
        calls.push(`retrieve ${id}`);
        return Promise.resolve({
          id,
          status: "succeeded",
          amount: 1210,
          amount_received: 1000,
          currency: "eur",
        });
      },
      cancel: (id: string) => {
        calls.push(`cancel ${id}`);
        return Promise.resolve({ id, status: "canceled" });
      },
    },
  } as unknown as Stripe;
}

describe("stripeClient's PaymentIntent binding", () => {
  it("retrievePaymentIntent maps Stripe's amount_received to amountReceived, in minor units", async () => {
    const calls: string[] = [];
    const client = stripeClient(fakeStripe(calls));
    expect(await client.retrievePaymentIntent("pi_1")).toEqual({
      id: "pi_1",
      status: "succeeded",
      amount: 1210,
      amountReceived: 1000,
    });
    expect(calls).toEqual(["retrieve pi_1"]);
  });

  it("cancelPaymentIntent cancels through the SDK and reports the resulting status", async () => {
    const calls: string[] = [];
    const client = stripeClient(fakeStripe(calls));
    expect(await client.cancelPaymentIntent("pi_2")).toEqual({ status: "canceled" });
    expect(calls).toEqual(["cancel pi_2"]);
  });
});

describe("stripeClient's refund binding", () => {
  function refundsStripe(calls: unknown[], create: (args: unknown[]) => Promise<unknown>) {
    const pages: Record<string, { data: unknown[]; has_more: boolean }> = {
      first: {
        data: [{ id: "re_1", status: "succeeded", metadata: { bill_payment_refund_id: "a" } }],
        has_more: true,
      },
      re_1: {
        data: [{ id: "re_2", status: null, metadata: null }],
        has_more: false,
      },
    };
    return {
      refunds: {
        create: (...args: unknown[]) => {
          calls.push(["create", ...args]);
          return create(args);
        },
        list: (params: { starting_after?: string }) => {
          calls.push(["list", params]);
          return Promise.resolve(pages[params.starting_after ?? "first"]);
        },
      },
    } as unknown as Stripe;
  }

  it("createRefund sends the exact amount in minor units, the metadata and the key, and returns Stripe's own status", async () => {
    const calls: unknown[] = [];
    const client = stripeClient(
      refundsStripe(calls, () =>
        Promise.resolve({ id: "re_9", status: "requires_action", metadata: { k: "v" } }),
      ),
    );

    const answer = await client.createRefund({
      paymentIntentId: "pi_1",
      amount: decimal("12.34"),
      idempotencyKey: "bpr_x",
      metadata: { bill_payment_refund_id: "x" },
    });

    expect(answer).toEqual({
      ok: true,
      refund: { id: "re_9", status: "requires_action", metadata: { k: "v" } },
    });
    expect(calls).toEqual([
      [
        "create",
        { payment_intent: "pi_1", amount: 1234, metadata: { bill_payment_refund_id: "x" } },
        { idempotencyKey: "bpr_x", maxNetworkRetries: 0 },
      ],
    ]);
  });

  it("createRefund answers Stripe's HTTP status for a refusal, and none for a failure with no status", async () => {
    const refused = stripeClient(
      refundsStripe([], () => Promise.reject(Object.assign(new Error("bad"), { statusCode: 400 }))),
    );
    const lost = stripeClient(refundsStripe([], () => Promise.reject(new Error("socket hang up"))));
    const params = {
      paymentIntentId: "pi_1",
      amount: decimal("1.00"),
      idempotencyKey: "k",
      metadata: {},
    };

    expect(await refused.createRefund(params)).toEqual({ ok: false, httpStatus: 400 });
    expect(await lost.createRefund(params)).toEqual({ ok: false, httpStatus: null });
  });

  it("listRefunds reads every page of the payment intent's refunds", async () => {
    const calls: unknown[] = [];
    const client = stripeClient(refundsStripe(calls, () => Promise.reject(new Error("unused"))));

    expect(await client.listRefunds("pi_7")).toEqual([
      { id: "re_1", status: "succeeded", metadata: { bill_payment_refund_id: "a" } },
      { id: "re_2", status: "unknown", metadata: {} },
    ]);
    expect(calls).toEqual([
      ["list", { payment_intent: "pi_7", limit: 100 }],
      ["list", { payment_intent: "pi_7", limit: 100, starting_after: "re_1" }],
    ]);
  });
});

// The installed SDK (stripe@22.6.2) run against a local server standing in for Stripe: what
// reaches the server, and what reaches our code, for one `createRefund`.
describe("stripeClient's refund through the Stripe SDK itself", () => {
  async function stripeAnswering(
    answer: (attempt: number, req: IncomingMessage, res: ServerResponse) => void,
  ) {
    const keys: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      keys.push(req.headers["idempotency-key"] as string | undefined);
      req.resume();
      req.on("end", () => answer(keys.length, req, res));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const stripe = new Stripe("sk_test_local", { host: "127.0.0.1", port, protocol: "http" });
    return { client: stripeClient(stripe), keys, close: () => server.close() };
  }
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const params = {
    paymentIntentId: "pi_1",
    amount: decimal("5.00"),
    idempotencyKey: "bpr_r1",
    metadata: { bill_payment_refund_id: "r1" },
  };

  it("does not send a refund again after a server error", async () => {
    const stripe = await stripeAnswering((_n, _req, res) =>
      json(res, 503, { error: { type: "api_error", message: "down" } }),
    );
    try {
      expect(await stripe.client.createRefund(params)).toEqual({ ok: false, httpStatus: 503 });
      expect(stripe.keys).toEqual(["bpr_r1"]);
    } finally {
      stripe.close();
    }
  });

  it("still sends it again, under the same key, after a closed connection, and hands on that second answer", async () => {
    const stripe = await stripeAnswering((attempt, req, res) => {
      if (attempt === 1) {
        req.socket.destroy();
        return;
      }
      json(res, 429, { error: { type: "invalid_request_error", message: "rate limited" } });
    });
    try {
      expect(await stripe.client.createRefund(params)).toEqual({ ok: false, httpStatus: 429 });
      expect(stripe.keys).toEqual(["bpr_r1", "bpr_r1"]);
    } finally {
      stripe.close();
    }
  });
});
