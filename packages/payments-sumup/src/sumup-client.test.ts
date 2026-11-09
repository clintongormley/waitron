import { createServer } from "node:http";
import { getEventListeners } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { decimal, hasCode, isAppError } from "@waitron/shared";
import type { AppError } from "@waitron/shared";
import type { SumUpClient } from "./client.js";
import { sumupClient, SumUpPairingRefused } from "./sumup-client.js";

// `sumup-client.ts` is COVERAGE-excluded (the real HTTP boundary), not import-excluded: these tests
// still run. A fetch that never resolves models an outage; the client's own deadline must turn it
// into a bounded rejection, which `collect` and `resolvePending` treat as pending (CLAUDE.md §5).
describe("sumupClient request deadline", () => {
  it("aborts and rejects a hung request within the timeout rather than hanging forever", async () => {
    let abortSignal: AbortSignal | undefined;
    const neverResolving: typeof fetch = (_url, init) => {
      abortSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: neverResolving,
      timeoutMs: 50,
    });
    const started = Date.now();
    await expect(client.findTransaction({ id: "txn_1" })).rejects.toThrow();
    // Bounded well under vitest's testTimeout: the deadline fired, not the runner.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(abortSignal?.aborted).toBe(true);
  });

  it("aborts and rejects when the HEADERS arrive but the response BODY hangs past the timeout", async () => {
    // The real outage this guards is a stalled body stream: SumUp answers the headers, then the
    // connection wedges before the body finishes. `res.text()` is then what blocks. The mock
    // mirrors real fetch — the body promise settles ONLY when the request's signal aborts (rejecting
    // it) — so a fix that stops abort reaching the body read would leave this hanging and the it()
    // deadline below would fail it, which is the point: the mock cannot pass this vacuously.
    let bodySignal: AbortSignal | undefined;
    const hangingBody: typeof fetch = (_url, init) => {
      bodySignal = (init as RequestInit | undefined)?.signal ?? undefined;
      const res = {
        status: 200,
        text: (): Promise<string> =>
          new Promise<string>((_resolve, reject) => {
            bodySignal?.addEventListener("abort", () => reject(new Error("body aborted")));
          }),
      } as unknown as Response;
      return Promise.resolve(res);
    };
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: hangingBody,
      timeoutMs: 50,
    });
    const started = Date.now();
    await expect(client.findTransaction({ id: "txn_1" })).rejects.toThrow();
    // The 50 ms deadline fired, not this it()'s 2 s bound; a hang would trip the bound instead.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(bodySignal?.aborted).toBe(true);
  }, 2_000);
});

describe("sumupClient refund", () => {
  function capturing(): { fetch: typeof fetch; url(): string; body(): string | undefined } {
    let seenUrl = "";
    let seenBody: string | undefined;
    const f: typeof fetch = (url, init) => {
      seenUrl = String(url);
      const b = (init as RequestInit | undefined)?.body;
      seenBody = b === undefined || b === null ? undefined : String(b);
      return Promise.resolve(
        new Response("{}", { status: 201, headers: { "content-type": "application/json" } }),
      );
    };
    return { fetch: f, url: () => seenUrl, body: () => seenBody };
  }

  it("sends a partial refund amount in minor units (integer cents), not euros", async () => {
    const cap = capturing();
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: cap.fetch });

    const outcome = await client.refund({ transactionId: "txn_1", amount: decimal("0.40") });

    expect(outcome.status).toBe("accepted");
    expect(JSON.parse(cap.body() ?? "null")).toEqual({ amount: 40 });
    // The documented, current endpoint — never the undocumented /v0.2/refund route.
    expect(cap.url()).toContain("/v1.0/merchants/MC/payments/txn_1/refunds");
  });

  it("omits the amount for a full refund, so SumUp refunds the whole transaction", async () => {
    const cap = capturing();
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: cap.fetch });

    await client.refund({ transactionId: "txn_1" });

    expect(cap.body()).toBe("{}");
  });
});

// The fake stores already-mapped keys, so ONLY this real-fetch test exercises SumUp's snake_case
// transaction keys (`card.last_4_digits` / `card.type` / `entry_mode` / `auth_code`) and the
// partial-card guard; a typo would silently blank a receipt's card block.
describe("sumupClient findTransaction card mapping", () => {
  const respondingWith =
    (body: unknown): typeof fetch =>
    () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

  it("maps SumUp's snake_case card keys onto the camelCase SumUpTransaction", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: respondingWith({
        id: "txn_1",
        status: "SUCCESSFUL",
        amount: 12.5,
        card: { last_4_digits: "5838", type: "VISA" },
        entry_mode: "contactless",
        auth_code: "328600",
      }),
    });

    const t = await client.findTransaction({ id: "txn_1" });

    expect(t).toEqual({
      id: "txn_1",
      status: "SUCCESSFUL",
      amount: decimal("12.50"),
      card: { last4: "5838", type: "VISA" },
      entryMode: "contactless",
      authCode: "328600",
    });
  });

  it("omits the card block when a card sub-field is missing", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      // last_4_digits present but no `type`: a partial card must not become a half-built block.
      fetch: respondingWith({
        id: "txn_2",
        status: "SUCCESSFUL",
        amount: 4.2,
        card: { last_4_digits: "6017" },
        entry_mode: "chip",
      }),
    });

    const t = await client.findTransaction({ id: "txn_2" });

    expect(t).toEqual({
      id: "txn_2",
      status: "SUCCESSFUL",
      amount: decimal("4.20"),
      entryMode: "chip",
    });
    expect(t?.card).toBeUndefined();
  });

  it("drops the card block when last_4_digits is malformed (not exactly four digits)", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      // A 5-char last_4_digits is truthy but would trip `payments_card_last4_ck` (length = 4) and
      // block the capture write for a SUCCESSFUL charge. Card facts are receipt decoration — the
      // adapter drops the block so the money still records (CLAUDE.md §5).
      fetch: respondingWith({
        id: "txn_bad",
        status: "SUCCESSFUL",
        amount: 9,
        card: { last_4_digits: "58380", type: "VISA" },
        entry_mode: "contactless",
        auth_code: "328600",
      }),
    });

    const t = await client.findTransaction({ id: "txn_bad" });

    expect(t?.card).toBeUndefined();
    expect(t).toEqual({
      id: "txn_bad",
      status: "SUCCESSFUL",
      amount: decimal("9.00"),
      entryMode: "contactless",
      authCode: "328600",
    });
  });

  it("carries no card fields at all when SumUp returns none", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: respondingWith({ id: "txn_3", status: "SUCCESSFUL", amount: 1 }),
    });

    const t = await client.findTransaction({ id: "txn_3" });

    expect(t).toEqual({ id: "txn_3", status: "SUCCESSFUL", amount: decimal("1.00") });
  });
});

// The reader-management calls plus `memberships`. Each test asserts the exact method + path; the
// shapes are the experiments runbook's recorded live responses
// (docs/research/2026-09-10-sumup-solo-experiments.md §0.3-0.5), not a guess.
describe("sumupClient reader management", () => {
  function stub(
    responder: (method: string, pathname: string) => { status: number; body?: unknown },
  ): { fetch: typeof fetch; calls: [string, string][] } {
    const calls: [string, string][] = [];
    const f: typeof fetch = (url, init) => {
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      const pathname = new URL(String(url)).pathname;
      calls.push([method, pathname]);
      const { status, body } = responder(method, pathname);
      // A 204 (deleteReader) forbids a body on the Response constructor entirely — not just an
      // empty string — so it takes a distinct branch with no headers either.
      if (status === 204) return Promise.resolve(new Response(null, { status: 204 }));
      const text = body === undefined ? "" : JSON.stringify(body);
      return Promise.resolve(
        new Response(text, { status, headers: { "content-type": "application/json" } }),
      );
    };
    return { fetch: f, calls };
  }

  it("lists the readers paired to the merchant account", async () => {
    const s = stub(() => ({
      status: 200,
      body: {
        items: [
          { id: "rdr_1", name: "Counter", status: "paired" },
          { id: "rdr_2", name: "Terrace", status: "paired" },
        ],
      },
    }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MY2NPHDW", fetch: s.fetch });

    const readers = await client.listReaders();

    expect(readers).toEqual([
      { id: "rdr_1", name: "Counter", status: "paired" },
      { id: "rdr_2", name: "Terrace", status: "paired" },
    ]);
    expect(s.calls).toContainEqual(["GET", "/v0.1/merchants/MY2NPHDW/readers"]);
  });

  it("pairs a reader from a code", async () => {
    const calls: [string, string][] = [];
    const fetchStub = async (url: string, init: RequestInit) => {
      calls.push([init.method!, new URL(url).pathname]);
      return new Response(JSON.stringify({ id: "rdr_9", status: "processing" }), { status: 201 });
    };
    const c = sumupClient({
      apiKey: "k",
      merchantCode: "MY2NPHDW",
      fetch: fetchStub as typeof fetch,
    });

    const r = await c.pairReader({ pairingCode: "ABC12345", name: "Counter" });

    expect(r).toEqual({ id: "rdr_9", status: "processing" });
    expect(calls).toContainEqual(["POST", "/v0.1/merchants/MY2NPHDW/readers"]);
  });

  it("sends the pairing code and name as pairing_code/name in the request body", async () => {
    let seenBody: string | undefined;
    const f: typeof fetch = (_url, init) => {
      seenBody = String((init as RequestInit | undefined)?.body ?? "");
      return Promise.resolve(
        new Response(JSON.stringify({ id: "rdr_9", status: "processing" }), { status: 201 }),
      );
    };
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: f });

    await client.pairReader({ pairingCode: "ABC12345", name: "Counter" });

    expect(JSON.parse(seenBody ?? "null")).toEqual({
      pairing_code: "ABC12345",
      name: "Counter",
    });
  });

  it("throws SumUpPairingRefused on a 4xx (bad/expired/used code), carrying the problem title", async () => {
    // The 4xx is a DEFINITE refusal: a distinguishable error the seat maps to
    // `payment.pairing_refused`; the title is a status phrase, never a secret.
    const s = stub(() => ({ status: 409, body: { title: "pairing code already used" } }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });

    const error = await client
      .pairReader({ pairingCode: "USED1234", name: "Counter" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SumUpPairingRefused);
    if (error instanceof SumUpPairingRefused) expect(error.title).toBe("pairing code already used");
  });

  it("gets a single reader by id", async () => {
    const s = stub(() => ({ status: 200, body: { id: "rdr_1", status: "paired" } }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });

    const r = await client.getReader("rdr_1");

    expect(r).toEqual({ id: "rdr_1", status: "paired" });
    expect(s.calls).toContainEqual(["GET", "/v0.1/merchants/MC/readers/rdr_1"]);
  });

  it("returns null for a reader id SumUp does not recognise", async () => {
    const s = stub(() => ({ status: 404, body: { detail: "Reader not found" } }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });

    const r = await client.getReader("rdr_missing");

    expect(r).toBeNull();
  });

  it("maps an ONLINE reader status to online:true with connection/screen detail", async () => {
    const s = stub(() => ({
      status: 200,
      body: {
        data: {
          status: "ONLINE",
          connection_type: "Wi-Fi",
          state: "IDLE",
          firmware_version: "3.3.42.2",
        },
      },
    }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });

    const status = await client.readerStatus("rdr_1");

    expect(status.online).toBe(true);
    expect(status.connection).toBe("Wi-Fi");
    expect(status.activity).toBe("IDLE");
    expect(s.calls).toContainEqual(["GET", "/v0.1/merchants/MC/readers/rdr_1/status"]);
  });

  it("maps an OFFLINE reader status to online:false", async () => {
    const s = stub(() => ({
      status: 200,
      body: { data: { status: "OFFLINE", connection_type: "Wi-Fi", state: "IDLE" } },
    }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });

    const status = await client.readerStatus("rdr_1");

    expect(status.online).toBe(false);
  });

  it("deletes a reader", async () => {
    const s = stub(() => ({ status: 204 }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });

    await client.deleteReader("rdr_1");

    expect(s.calls).toContainEqual(["DELETE", "/v0.1/merchants/MC/readers/rdr_1"]);
  });

  async function unpairFailure(client: SumUpClient): Promise<AppError<"reader.unpair_failed">> {
    const error: unknown = await client.deleteReader("rdr_1").catch((e: unknown) => e);
    if (!isAppError(error) || !hasCode(error, "reader.unpair_failed"))
      throw new Error(`expected reader.unpair_failed, got ${String(error)}`);
    return error;
  }

  it.each([400, 401, 403, 409, 429, 500])("rejects reader deletion on HTTP %s", async (status) => {
    const s = stub(() => ({ status, body: { title: "Rejected" } }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });
    expect((await unpairFailure(client)).params).toEqual({ providerId: "sumup" });
  });

  it.each([
    [401, "credential_rejected"],
    [403, "credential_rejected"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [400, "http_400"],
    [429, "http_429"],
  ])("tells why a reader deletion failed on HTTP %s", async (status, reason) => {
    const s = stub(() => ({ status, body: { title: "Rejected" } }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });
    expect((await unpairFailure(client)).reason).toBe(reason);
  });

  const htmlPage = "<html><body><h1>Gateway says no</h1></body></html>";
  const answering =
    (status: number, body: BodyInit | null): typeof fetch =>
    () =>
      Promise.resolve(new Response(body, { status, headers: { "content-type": "text/html" } }));

  it.each([
    [401, "credential_rejected"],
    [403, "credential_rejected"],
    [429, "http_429"],
  ])(
    "tells why a reader deletion failed on HTTP %s from its status alone",
    async (status, reason) => {
      const client = sumupClient({
        apiKey: "k",
        merchantCode: "MC",
        fetch: answering(status, htmlPage),
      });
      const error = await unpairFailure(client);
      expect(error.reason).toBe(reason);
    },
  );

  it("accepts deletion of an already absent reader whose 404 is not JSON", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: answering(404, htmlPage),
    });
    await expect(client.deleteReader("rdr_1")).resolves.toBeUndefined();
  });

  it("tells a 401 whose body breaks off as credential_rejected, not unreachable", async () => {
    const breaksOff = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("terminated"));
      },
    });
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: answering(401, breaksOff),
    });
    expect((await unpairFailure(client)).reason).toBe("credential_rejected");
  });

  it("releases the body of a reader deletion's answer it does not read", async () => {
    let cancelled = false;
    const unread = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: answering(409, unread) });
    await client.deleteReader("rdr_1").catch(() => undefined);
    expect(cancelled).toBe(true);
    // This stream never ends, so a client that reads the body hangs here and trips the bound.
  }, 2_000);

  it("tells a reader deletion cut off by a dropped connection as unreachable", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    expect((await unpairFailure(client)).reason).toBe("unreachable");
  });

  it("tells a reader deletion cut off by its deadline as unreachable", async () => {
    let signal: AbortSignal | undefined;
    const neverAnswering: typeof fetch = (_url, init) => {
      signal = (init as RequestInit | undefined)?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: neverAnswering,
      timeoutMs: 50,
    });
    expect((await unpairFailure(client)).reason).toBe("unreachable");
    expect(signal?.aborted).toBe(true);
    // Only the client's own 50 ms deadline settles this fetch; without it the 2 s bound trips.
  }, 2_000);

  it("refuses a reader deletion that SumUp redirects, without following it", async () => {
    const requested: string[] = [];
    const server = createServer((req, res) => {
      requested.push(`${req.method ?? ""} ${req.url ?? ""}`);
      if (req.url === "/v0.1/merchants/MC/readers/rdr_1") {
        res.writeHead(302, { location: "/signin" }).end();
      } else {
        res.writeHead(200, { "content-type": "text/html" }).end(htmlPage);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const client = sumupClient({
        apiKey: "k",
        merchantCode: "MC",
        baseUrl: `http://127.0.0.1:${port}`,
      });
      expect((await unpairFailure(client)).reason).toBe("http_302");
      expect(requested).toEqual(["DELETE /v0.1/merchants/MC/readers/rdr_1"]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("accepts deletion of an already absent reader on a retry", async () => {
    const s = stub(() => ({ status: 404, body: { title: "Reader not found" } }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });
    await expect(client.deleteReader("rdr_1")).resolves.toBeUndefined();
  });

  it("lists the merchant memberships this API key can act as", async () => {
    const s = stub(() => ({
      status: 200,
      body: {
        items: [
          {
            resource_id: "MY2NPHDW",
            type: "merchant",
            resource: { name: "Test restaurant" },
            roles: ["role_admin", "role_owner"],
          },
        ],
      },
    }));
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: s.fetch });

    const memberships = await client.memberships();

    expect(memberships).toEqual([{ merchantCode: "MY2NPHDW", name: "Test restaurant" }]);
    expect(s.calls).toContainEqual(["GET", "/v0.1/memberships"]);
  });
});

describe("sumupClient sendRefund", () => {
  const answering =
    (status: number, seen: { url?: string; body?: string } = {}): typeof fetch =>
    (url, init) => {
      seen.url = String(url);
      seen.body = String((init as RequestInit).body);
      return Promise.resolve(
        new Response(status === 201 ? "{}" : JSON.stringify({ title: "no" }), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    };

  it("sends the exact amount in minor units and answers SumUp's HTTP status", async () => {
    const seen: { url?: string; body?: string } = {};
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: answering(201, seen) });

    const answer = await client.sendRefund({ transactionId: "txn_1", amount: decimal("0.40") });

    expect(answer).toEqual({ httpStatus: 201 });
    expect(JSON.parse(seen.body ?? "null")).toEqual({ amount: 40 });
    expect(seen.url).toContain("/v1.0/merchants/MC/payments/txn_1/refunds");
  });

  it.each([400, 409, 422, 429, 500, 503])(
    "answers %i as data rather than throwing",
    async (status) => {
      const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: answering(status) });
      expect(await client.sendRefund({ transactionId: "t", amount: decimal("1.00") })).toEqual({
        httpStatus: status,
      });
    },
  );

  it("rejects when no answer comes back", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    await expect(
      client.sendRefund({ transactionId: "t", amount: decimal("1.00") }),
    ).rejects.toThrow("fetch failed");
  });

  async function againstServer<T>(
    handler: Parameters<typeof createServer>[1],
    use: (client: SumUpClient) => Promise<T>,
    timeoutMs?: number,
    transport?: typeof fetch,
  ): Promise<T> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      return await use(
        sumupClient({
          apiKey: "k",
          merchantCode: "MC",
          baseUrl: `http://127.0.0.1:${port}`,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          ...(transport === undefined ? {} : { fetch: transport }),
        }),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  describe("temporary balance refusal", () => {
    const detail = "Not enough available balance to perform the operation at the moment";

    it("recognises the exact explanation from a real HTTP 409 body", async () => {
      const answer = await againstServer(
        (_req, res) =>
          res
            .writeHead(409, { "content-type": "application/problem+json" })
            .end(JSON.stringify({ status: 409, title: "Conflict", detail })),
        (client) => client.sendRefund({ transactionId: "t", amount: decimal("1.00") }),
      );
      expect(answer).toEqual({ httpStatus: 409, reason: "provider_balance_unavailable" });
    });

    it.each([
      ["a different problem", 409, JSON.stringify({ detail: "Refund already exists" })],
      ["a longer explanation", 409, JSON.stringify({ detail: detail + " later" })],
      ["a bare prefix", 409, JSON.stringify({ detail: "Not enough" })],
      ["another status", 422, JSON.stringify({ detail })],
      ["an array", 409, JSON.stringify([{ detail }])],
      ["a null body", 409, "null"],
      ["malformed JSON", 409, "{"],
      ["an oversized valid problem", 409, JSON.stringify({ detail, padding: "x".repeat(4096) })],
    ])("keeps %s generic without losing its status", async (_label, status, body) => {
      const answer = await againstServer(
        (_req, res) => res.writeHead(status, { "content-type": "application/json" }).end(body),
        (client) => client.sendRefund({ transactionId: "t", amount: decimal("1.00") }),
      );
      expect(answer).toEqual({ httpStatus: status });
    });

    it("retains prompt 409 headers when the body stalls, within the tender response budget", async () => {
      const started = performance.now();
      const answer = await againstServer(
        (_req, res) => {
          res.writeHead(409, { "content-type": "application/json" });
          res.write('{"detail":');
        },
        (client) => client.sendRefund({ transactionId: "t", amount: decimal("1.00") }),
        8_000,
      );
      expect(answer).toEqual({ httpStatus: 409 });
      expect(performance.now() - started).toBeLessThan(3_500);
    }, 15_000);

    it("retains a known 409 after the real response body is truncated", async () => {
      let truncate!: () => void;
      const answer = await againstServer(
        (_req, res) => {
          truncate = () => res.destroy();
          res.writeHead(409, { "content-type": "application/json" });
          res.write('{"detail":');
        },
        (client) => client.sendRefund({ transactionId: "t", amount: decimal("1.00") }),
        undefined,
        async (input, init) => {
          const response = await fetch(input, init);
          truncate();
          return response;
        },
      );
      expect(answer).toEqual({ httpStatus: 409 });
    });

    it.each([
      [4096, true],
      [4097, false],
    ] as const)("accepts explanation at %i bytes: %s", async (bytes, recognised) => {
      const empty = JSON.stringify({ detail, padding: "" });
      const body = JSON.stringify({
        detail,
        padding: "x".repeat(bytes - Buffer.byteLength(empty)),
      });
      expect(Buffer.byteLength(body)).toBe(bytes);
      const answer = await againstServer(
        (_req, res) => res.writeHead(409).end(body),
        (client) => client.sendRefund({ transactionId: "t", amount: decimal("1.00") }),
      );
      expect(answer).toEqual(
        recognised
          ? { httpStatus: 409, reason: "provider_balance_unavailable" }
          : { httpStatus: 409 },
      );
    });

    it.each([409, 422])("cancels an unread or oversized real %i body", async (status) => {
      let closed = false;
      await againstServer(
        (_req, res) => {
          res.on("close", () => {
            closed = true;
          });
          res.writeHead(status);
          res.write("x".repeat(4097));
        },
        async (client) => {
          expect(await client.sendRefund({ transactionId: "t", amount: decimal("1.00") })).toEqual({
            httpStatus: status,
          });
          await vi.waitFor(() => expect(closed).toBe(true));
        },
      );
    });

    it.each([
      "absent",
      "locked",
      "invalid UTF-8",
      "cancel rejects",
      "aborted before body",
      "never finishes",
    ])(
      "keeps a known refusal with optional body %s",
      async (shape) => {
        const body =
          shape === "absent"
            ? null
            : new ReadableStream<Uint8Array>({
                start(controller) {
                  if (shape === "invalid UTF-8") {
                    controller.enqueue(
                      new TextEncoder().encode(
                        JSON.stringify({ detail, padding: "bad" }).replace('bad"', ""),
                      ),
                    );
                    controller.enqueue(new Uint8Array([255]));
                    controller.enqueue(new TextEncoder().encode('"}'));
                  } else
                    controller.enqueue(
                      new TextEncoder().encode(
                        shape === "cancel rejects" ? "x".repeat(4097) : JSON.stringify({ detail }),
                      ),
                    );
                  if (shape !== "cancel rejects" && shape !== "never finishes") controller.close();
                },
                cancel() {
                  if (shape === "cancel rejects") throw new Error("cancel failed");
                },
              });
        const response = new Response(body, { status: 409 });
        const lock = shape === "locked" ? response.body!.getReader() : null;
        try {
          const client = sumupClient({
            apiKey: "k",
            merchantCode: "MC",
            timeoutMs: 5,
            fetch: async () => {
              if (shape === "aborted before body")
                await new Promise((done) => setTimeout(done, 20));
              return response;
            },
          });
          expect(await client.sendRefund({ transactionId: "t", amount: decimal("1.00") })).toEqual({
            httpStatus: 409,
          });
        } finally {
          lock?.releaseLock();
        }
      },
      5_000,
    );

    it("leaves no abort listener or active deadline after reading the explanation", async () => {
      let signal!: AbortSignal;
      vi.useFakeTimers();
      try {
        const client = sumupClient({
          apiKey: "k",
          merchantCode: "MC",
          fetch: async (_url, init) => {
            signal = init!.signal!;
            return new Response(JSON.stringify({ detail }), { status: 409 });
          },
        });
        expect(await client.sendRefund({ transactionId: "t", amount: decimal("1.00") })).toEqual({
          httpStatus: 409,
          reason: "provider_balance_unavailable",
        });
        expect(getEventListeners(signal, "abort")).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(signal.aborted).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it.each([
    { status: 404, contentType: "text/html", body: "<html>nope</html>" },
    { status: 201, contentType: "text/plain", body: "ok" },
  ])(
    "answers $status with a body that is not JSON by its status",
    async ({ status, contentType, body }) => {
      const answer = await againstServer(
        (_req, res) => res.writeHead(status, { "content-type": contentType }).end(body),
        (client) => client.sendRefund({ transactionId: "t", amount: decimal("1.00") }),
      );
      expect(answer).toEqual({ httpStatus: status });
    },
  );

  it("answers a 201 whose body never ends without waiting for the body", async () => {
    const answer = await againstServer(
      (_req, res) => {
        res.writeHead(201, { "content-type": "application/json" });
        res.write("{");
      },
      (client) => client.sendRefund({ transactionId: "t", amount: decimal("1.00") }),
      2_000,
    );
    expect(answer).toEqual({ httpStatus: 201 });
  });
});

describe("sumupClient findTransaction refund events", () => {
  const respondingWith =
    (body: unknown): typeof fetch =>
    () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

  // The field shapes the venue's live account returned on 2026-09-27: the event id a number, the
  // amount a number of euros. The timestamps here are the test's own.
  it("reads the REFUND transaction events, in euros, with their ids as text", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: respondingWith({
        id: "54a5a753",
        status: "SUCCESSFUL",
        amount: 1.0,
        transaction_events: [
          { event_type: "PAYOUT", status: "SUCCESSFUL", id: 1, amount: 1.0, timestamp: "x" },
          {
            event_type: "REFUND",
            status: "REFUNDED",
            id: 11234017009,
            amount: 0.4,
            date: "2026-09-11",
            timestamp: "2026-09-11T11:30:02.100Z",
          },
          {
            event_type: "REFUND",
            status: "REFUNDED",
            id: 11234029448,
            amount: 0.6,
            date: "2026-09-11",
            timestamp: "2026-09-11T11:31:40.000Z",
          },
        ],
      }),
    });

    const t = await client.findTransaction({ id: "54a5a753" });

    expect(t?.refundEvents).toEqual([
      {
        id: "11234017009",
        status: "REFUNDED",
        amount: decimal("0.40"),
        timestamp: "2026-09-11T11:30:02.100Z",
      },
      {
        id: "11234029448",
        status: "REFUNDED",
        amount: decimal("0.60"),
        timestamp: "2026-09-11T11:31:40.000Z",
      },
    ]);
  });

  it("falls back to `events` when SumUp sends no transaction_events", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: respondingWith({
        id: "f37572ac",
        status: "SUCCESSFUL",
        amount: 1.0,
        events: [
          {
            type: "REFUND",
            status: "REFUNDED",
            id: 11233372107,
            amount: 1.0,
            timestamp: "2026-09-11T11:24:51.016Z",
            transaction_id: "f37572ac",
          },
        ],
      }),
    });

    expect((await client.findTransaction({ id: "f37572ac" }))?.refundEvents).toEqual([
      {
        id: "11233372107",
        status: "REFUNDED",
        amount: decimal("1.00"),
        timestamp: "2026-09-11T11:24:51.016Z",
      },
    ]);
  });
});

describe("legacy refund HTTP bodies", () => {
  it.each([200, 202, 204, 400, 403, 404, 409, 422])(
    "reads status %s without parsing its body",
    async (status) => {
      const client = sumupClient({
        apiKey: "test-key",
        merchantCode: "MC",
        fetch: () =>
          Promise.resolve(
            new Response(status === 204 ? null : "<html>provider answer</html>", { status }),
          ),
      });
      await expect(client.refund({ transactionId: "txn_1" })).resolves.toEqual({
        status: status >= 400 ? "refused" : "accepted",
      });
    },
  );
});

describe("legacy refund uncertain HTTP status", () => {
  it.each([301, 302, 307, 308, 401, 402, 408, 410, 429, 500, 503])(
    "leaves HTTP %s uncertain without reading its body",
    async (status) => {
      const client = sumupClient({
        apiKey: "test-key",
        merchantCode: "MC",
        fetch: () => Promise.resolve(new Response("<html>provider answer</html>", { status })),
      });
      await expect(client.refund({ transactionId: "txn_1" })).rejects.toThrow(`HTTP ${status}`);
    },
  );
});

describe("SumUp refund evidence", () => {
  it("reads both refund arrays even when the first contains only a payout", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "M",
      fetch: async () =>
        Response.json({
          id: "txn",
          status: "SUCCESSFUL",
          amount: 1,
          transaction_events: [{ event_type: "PAYOUT", id: 2, amount: 0.98 }],
          events: [
            {
              type: "REFUND",
              id: 3,
              status: "REFUNDED",
              amount: 0.4,
              timestamp: "2026-11-09T10:00:00Z",
            },
          ],
        }),
    });
    expect((await client.findTransaction({ id: "txn" }))?.refundEvents).toEqual([
      { id: "3", status: "REFUNDED", amount: decimal("0.40"), timestamp: "2026-11-09T10:00:00Z" },
    ]);
  });
  it.each([
    null,
    "unknown",
    [{ id: 1, amount: 0.4, timestamp: "2026-11-09T10:00:00Z" }],
    [{ type: "REFUND", id: "", amount: 0.4, timestamp: "bad" }],
  ])("retains malformed refund evidence (%s) instead of silently dropping it", async (events) => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "M",
      fetch: async () => Response.json({ id: "txn", status: "SUCCESSFUL", amount: 1, events }),
    });
    expect((await client.findTransaction({ id: "txn" }))?.refundEvidenceInvalid).toBe(true);
  });
});
