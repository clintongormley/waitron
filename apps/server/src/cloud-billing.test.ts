import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { billingEnvelope, fetchBillingDisplay, readBillingDisplay } from "./cloud-billing.js";
import type { SavedCloudState } from "./cloud-client.js";

const vector = JSON.parse(
  readFileSync(new URL("../test/billing-display-vector.json", import.meta.url), "utf8"),
) as {
  machineSeedByte: number;
  publicKey: string;
  claims: {
    origin: string;
    installationId: string;
    operationId: string;
    issuedAt: number;
    lease: string;
    body: string;
  };
  envelope: { payload: string; signature: string };
};

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
  return "accepted";
};

describe("billing-display signing matches Cloud's fixed vector (waitron-cloud 5276593620774037973499fddd82bf7c780ba1c5)", () => {
  const seed = Buffer.alloc(32, vector.machineSeedByte);
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = der.toString("base64url");
  it("derives the vector's public key from its seed", () => {
    const key = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
    expect(key.export({ format: "der", type: "spki" }).toString("base64url")).toBe(
      vector.publicKey,
    );
  });
  it("signs the same bytes and signature", () => {
    const envelope = billingEnvelope(
      {
        origin: vector.claims.origin,
        privateKey,
        view: { registration: { installationId: vector.claims.installationId } },
      } as Parameters<typeof billingEnvelope>[0],
      vector.claims.operationId,
      vector.claims.lease,
      vector.claims.issuedAt,
    );
    expect(envelope).toEqual(vector.envelope);
    expect(JSON.parse(Buffer.from(envelope.payload, "base64url").toString())[7]).toBe(
      '{"version":1}',
    );
  });
});

const INSTALLATION = "11111111-1111-4111-8111-111111111111";
const VENUE = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://cloud.example.test";
const expected = { installationId: INSTALLATION, venueId: VENUE, accountUrl: `${ORIGIN}/account` };
const PRICES = {
  status: "published",
  revision: 1,
  effectiveFrom: "2026-11-01",
  currency: "EUR",
  taxExclusive: true,
  vatRateBasisPoints: 2100,
  registeredMonthlyCents: 0,
  connectedMonthlyCents: 3000,
  hostedMonthlyCents: 9000,
  hostedDayDivisor: 30,
};
const reply = (billing: unknown, prices: unknown = PRICES, extra: object = {}) => ({
  version: 1,
  installationId: INSTALLATION,
  venueId: VENUE,
  countryCode: "ES",
  calendarTimeZone: "Europe/Madrid",
  asOf: "2026-11-10T12:00:00.000Z",
  billing,
  prices,
  accountUrl: `${ORIGIN}/account`,
  ...extra,
});
const TRIAL = {
  status: "ready",
  level: "connected",
  state: "trial",
  period: {
    kind: "trial",
    level: "connected",
    from: "2026-10-31",
    until: "2026-11-30",
    coversAsOf: true,
  },
};

describe("the contract's five example replies", () => {
  const examples = {
    trial: reply(TRIAL),
    "active with no established period": reply({
      status: "ready",
      level: "hosted",
      state: "active",
      period: null,
    }),
    "lapsed with a historical period": reply({
      status: "ready",
      level: "registered",
      state: "lapsed",
      period: {
        kind: "paid",
        level: "connected",
        from: "2026-10-01",
        until: "2026-11-01",
        coversAsOf: false,
      },
    }),
    "billing unavailable, prices published": reply({
      status: "unavailable",
      reason: "state_not_ready",
    }),
    "prices unpublished, billing available": reply(TRIAL, {
      status: "unavailable",
      reason: "not_published",
    }),
  };
  for (const [name, value] of Object.entries(examples))
    it(`accepts "${name}" unchanged`, () => {
      expect(readBillingDisplay(structuredClone(value), expected)).toEqual(value);
    });
});

describe("a reply that breaks the closed version-1 shape is refused whole", () => {
  const cases: [string, unknown][] = [
    ["an extra top-level key", reply(TRIAL, PRICES, { venueName: "x" })],
    ["an extra billing key", reply({ ...TRIAL, debt: 0 })],
    ["an extra period key", reply({ ...TRIAL, period: { ...TRIAL.period, note: "" } })],
    ["an extra prices key", reply(TRIAL, { ...PRICES, dailyCents: 300 })],
    [
      "an extra key on unavailable billing",
      reply({ status: "unavailable", reason: "state_not_ready", level: "connected" }),
    ],
    [
      "an extra key on unpublished prices",
      reply(TRIAL, { status: "unavailable", reason: "not_published", revision: 1 }),
    ],
    [
      "a missing key",
      Object.fromEntries(Object.entries(reply(TRIAL)).filter(([k]) => k !== "asOf")),
    ],
    ["version 2", reply(TRIAL, PRICES, { version: 2 })],
    [
      "another installation",
      reply(TRIAL, PRICES, { installationId: "33333333-3333-4333-8333-333333333333" }),
    ],
    ["another venue", reply(TRIAL, PRICES, { venueId: "33333333-3333-4333-8333-333333333333" })],
    ["another country", reply(TRIAL, PRICES, { countryCode: "PT" })],
    [
      "an account URL on the same host with another path",
      reply(TRIAL, PRICES, { accountUrl: `${ORIGIN}/billing` }),
    ],
    [
      "an account URL over plain HTTP",
      reply(TRIAL, PRICES, { accountUrl: "http://cloud.example.test/account" }),
    ],
    [
      "an account URL with a trailing slash",
      reply(TRIAL, PRICES, { accountUrl: `${ORIGIN}/account/` }),
    ],
    ["an unknown time zone", reply(TRIAL, PRICES, { calendarTimeZone: "Europe/Atlantis" })],
    ["an offset in place of a zone name", reply(TRIAL, PRICES, { calendarTimeZone: "+01:00" })],
    ["a zone name in the wrong case", reply(TRIAL, PRICES, { calendarTimeZone: "europe/madrid" })],
    ["an asOf without milliseconds", reply(TRIAL, PRICES, { asOf: "2026-11-10T12:00:00Z" })],
    [
      "a day that does not exist",
      reply({ ...TRIAL, period: { ...TRIAL.period, until: "2026-02-30" } }),
    ],
    ["an empty interval", reply({ ...TRIAL, period: { ...TRIAL.period, until: "2026-10-31" } })],
    ["an unknown billing state", reply({ ...TRIAL, state: "suspended" })],
    ["an unknown unavailable reason", reply({ status: "unavailable", reason: "later" })],
    [
      "a registered price that is not free",
      reply(TRIAL, { ...PRICES, registeredMonthlyCents: 100 }),
    ],
    ["a negative price", reply(TRIAL, { ...PRICES, connectedMonthlyCents: -1 })],
    ["a fractional price", reply(TRIAL, { ...PRICES, hostedMonthlyCents: 90.5 })],
    ["a day divisor other than 30", reply(TRIAL, { ...PRICES, hostedDayDivisor: 31 })],
    ["another currency", reply(TRIAL, { ...PRICES, currency: "USD" })],
    ["prices that include tax", reply(TRIAL, { ...PRICES, taxExclusive: false })],
    ["a fractional VAT rate", reply(TRIAL, { ...PRICES, vatRateBasisPoints: 2100.5 })],
    ["an impossible effective day", reply(TRIAL, { ...PRICES, effectiveFrom: "2026-13-01" })],
    ["a negative price revision", reply(TRIAL, { ...PRICES, revision: -1 })],
    ["an array", [reply(TRIAL)]],
  ];
  for (const [name, value] of cases)
    it(`refuses ${name}`, () => {
      expect(codeOf(() => readBillingDisplay(value, expected))).toBe("cloud.unavailable");
    });
  it("accepts UTC as a zone name", () => {
    expect(
      codeOf(() => readBillingDisplay(reply(TRIAL, PRICES, { calendarTimeZone: "UTC" }), expected)),
    ).toBe("accepted");
  });
});

describe("whether a period covers asOf is judged on the reply's own calendar", () => {
  // 23:30 UTC on 31 October is already 1 November in Madrid.
  const at = (calendarTimeZone: string, coversAsOf: boolean) =>
    reply(
      {
        status: "ready",
        level: "connected",
        state: "active",
        period: {
          kind: "paid",
          level: "connected",
          from: "2026-11-01",
          until: "2026-12-01",
          coversAsOf,
        },
      },
      PRICES,
      { calendarTimeZone, asOf: "2026-10-31T23:30:00.000Z" },
    );
  it("in Madrid the day is 1 November, inside the period", () => {
    expect(codeOf(() => readBillingDisplay(at("Europe/Madrid", true), expected))).toBe("accepted");
    expect(codeOf(() => readBillingDisplay(at("Europe/Madrid", false), expected))).toBe(
      "cloud.unavailable",
    );
  });
  it("in UTC the same instant is 31 October, so the same period starts in the future", () => {
    expect(codeOf(() => readBillingDisplay(at("UTC", true), expected))).toBe("cloud.unavailable");
    expect(codeOf(() => readBillingDisplay(at("UTC", false), expected))).toBe("cloud.unavailable");
  });
  const lapsed = (calendarTimeZone: string, coversAsOf: boolean) =>
    reply(
      {
        status: "ready",
        level: "connected",
        state: "lapsed",
        period: {
          kind: "paid",
          level: "connected",
          from: "2026-10-01",
          until: "2026-11-01",
          coversAsOf,
        },
      },
      PRICES,
      { calendarTimeZone, asOf: "2026-10-31T23:30:00.000Z" },
    );
  it("a period ending on 31 October covers that instant in UTC and not in Madrid", () => {
    expect(codeOf(() => readBillingDisplay(lapsed("UTC", true), expected))).toBe("accepted");
    expect(codeOf(() => readBillingDisplay(lapsed("UTC", false), expected))).toBe(
      "cloud.unavailable",
    );
    expect(codeOf(() => readBillingDisplay(lapsed("Europe/Madrid", false), expected))).toBe(
      "accepted",
    );
    expect(codeOf(() => readBillingDisplay(lapsed("Europe/Madrid", true), expected))).toBe(
      "cloud.unavailable",
    );
  });
});

describe("the allowed level, state and period combinations", () => {
  const LEVELS = ["registered", "connected", "hosted"] as const;
  const STATES = ["trial", "active", "payment_failing", "lapsed"] as const;
  type Period = {
    kind: "trial" | "paid";
    level: "connected" | "hosted";
    when: "current" | "past" | "future";
  } | null;
  const periods: Period[] = [null];
  for (const kind of ["trial", "paid"] as const)
    for (const level of ["connected", "hosted"] as const)
      for (const when of ["current", "past", "future"] as const)
        periods.push({ kind, level, when });
  const span = {
    current: { from: "2026-10-31", until: "2026-11-30", coversAsOf: true },
    past: { from: "2026-10-01", until: "2026-11-01", coversAsOf: false },
    future: { from: "2026-11-20", until: "2026-12-20", coversAsOf: false },
  };
  // The contract's table, written out once (asOf is 10 November in Madrid).
  const allowed = (level: (typeof LEVELS)[number], state: (typeof STATES)[number], p: Period) => {
    if (p?.when === "future") return false;
    const sameLevel = !!p && (level === "registered" || p.level === level);
    if (state === "trial")
      return (
        level !== "registered" && p?.kind === "trial" && p.level === level && p.when === "current"
      );
    if (level === "registered" && state !== "lapsed") return p === null;
    if (state === "active" || state === "payment_failing")
      return p === null || (p.kind === "paid" && sameLevel);
    return (
      p === null ||
      (p.kind === "paid" && sameLevel) ||
      (p.kind === "trial" && sameLevel && p.when === "past")
    );
  };
  for (const level of LEVELS)
    for (const state of STATES)
      for (const p of periods) {
        const name = `${level}/${state} with ${p ? `a ${p.when} ${p.level} ${p.kind} period` : "no period"}`;
        const ok = allowed(level, state, p);
        it(`${ok ? "accepts" : "refuses"} ${name}`, () => {
          const period = p && { kind: p.kind, level: p.level, ...span[p.when] };
          expect(
            codeOf(() =>
              readBillingDisplay(reply({ status: "ready", level, state, period }), expected),
            ),
          ).toBe(ok ? "accepted" : "cloud.unavailable");
        });
      }
});

describe("the exchange with Cloud", () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });
  async function cloud(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
    const seen: { method?: string; url?: string; type?: string; body: string }[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      seen.push({ method: req.method, url: req.url, type: req.headers["content-type"], body });
      handler(req, res, body);
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const key = generateKeyPairSync("ed25519");
    const lease = { payload: "bGVhc2U", signature: "c2ln" };
    const state = {
      version: 1,
      origin,
      privateKey: key.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
      publicKey: key.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
      localVenueId: "local",
      environment: "test",
      requestId: "r",
      code: "",
      view: {
        requestId: "r",
        localVenueId: "local",
        environment: "test",
        expiresAt: "2026-11-10T12:00:00.000Z",
        state: "complete",
        registration: {
          installationId: INSTALLATION,
          venueId: VENUE,
          organisationId: "33333333-3333-4333-8333-333333333333",
          legalBusinessId: "44444444-4444-4444-8444-444444444444",
        },
      },
      lifecycle: { unavailable: false, revoked: false, lease },
    } as SavedCloudState;
    return { state, seen, origin, lease, key };
  }
  const json = (res: ServerResponse, status: number, value: unknown, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(typeof value === "string" ? value : JSON.stringify(value));
  };
  const good = (origin: string) => ({ ...reply(TRIAL), accountUrl: `${origin}/account` });
  const codeOfAsync = async (p: Promise<unknown>) => {
    try {
      await p;
      return "accepted";
    } catch (error) {
      return error instanceof AppError ? error.code : String(error);
    }
  };

  it("posts the signed envelope with the exact version-1 body and the saved lease", async () => {
    let origin = "";
    const c = await cloud((_req, res) => json(res, 200, good(origin)));
    origin = c.origin;
    const result = await fetchBillingDisplay(c.state);
    expect(result.billing).toEqual(TRIAL);
    expect(c.seen).toHaveLength(1);
    const sent = c.seen[0]!;
    expect([sent.method, sent.url, sent.type]).toEqual([
      "POST",
      "/api/installations/billing-display",
      "application/json",
    ]);
    const envelope = JSON.parse(sent.body) as { payload: string; signature: string };
    expect(Object.keys(envelope).sort()).toEqual(["payload", "signature"]);
    const bytes = Buffer.from(envelope.payload, "base64url");
    expect(verify(null, bytes, c.key.publicKey, Buffer.from(envelope.signature, "base64url"))).toBe(
      true,
    );
    const claims = JSON.parse(bytes.toString()) as unknown[];
    expect(claims[0]).toBe("waitron-cloud-machine-v1");
    expect(claims[1]).toBe(c.origin);
    expect(claims[2]).toBe("billing-display");
    expect(claims[3]).toBe(INSTALLATION);
    expect(claims[6]).toBe(JSON.stringify(c.lease));
    expect(claims[7]).toBe('{"version":1}');
  });

  it("uses a fresh operation id on every read", async () => {
    let origin = "";
    const c = await cloud((_req, res) => json(res, 200, good(origin)));
    origin = c.origin;
    await fetchBillingDisplay(c.state);
    await fetchBillingDisplay(c.state);
    const ids = c.seen.map(
      (s) => JSON.parse(Buffer.from(JSON.parse(s.body).payload, "base64url").toString())[4],
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("refuses a reply bound to another account address than the saved origin's", async () => {
    const c = await cloud((_req, res) => json(res, 200, reply(TRIAL)));
    expect(await codeOfAsync(fetchBillingDisplay(c.state))).toBe("cloud.unavailable");
  });

  it("refuses without a registration or a lease, and once revoked, sending nothing", async () => {
    const c = await cloud((_req, res) => json(res, 500, {}));
    const revoked = { ...c.state, lifecycle: { ...c.state.lifecycle!, revoked: true } };
    const leaseless = { ...c.state, lifecycle: { unavailable: false, revoked: false } };
    const unregistered = { ...c.state, view: { ...c.state.view!, registration: undefined } };
    for (const s of [revoked, leaseless, unregistered])
      expect(await codeOfAsync(fetchBillingDisplay(s as SavedCloudState))).toBe(
        "cloud.not_configured",
      );
    expect(c.seen).toHaveLength(0);
  });

  const refusals: [number, string, string][] = [
    [400, "invalid_input", "cloud.request_invalid"],
    [400, "invalid_request", "cloud.request_invalid"],
    [400, "unsupported_billing_version", "cloud.request_invalid"],
    [405, "method_not_allowed", "cloud.request_invalid"],
    [413, "invalid_input", "cloud.request_invalid"],
    [415, "invalid_input", "cloud.request_invalid"],
    [401, "invalid_proof", "cloud.unavailable"],
    [403, "forbidden", "cloud.unavailable"],
    [403, "revoked", "cloud.unavailable"],
    [408, "invalid_input", "cloud.unavailable"],
    [429, "rate_limited", "cloud.unavailable"],
    [503, "temporarily_unavailable", "cloud.unavailable"],
    [500, "anything", "cloud.unavailable"],
  ];
  for (const [status, error, code] of refusals)
    it(`maps ${status} ${error} to ${code}`, async () => {
      const c = await cloud((_req, res) => json(res, status, { error }));
      expect(await codeOfAsync(fetchBillingDisplay(c.state))).toBe(code);
    });

  it("tells the connection about a revocation and a refused proof, naming the lease and key used", async () => {
    for (const [status, error] of [
      [403, "revoked"],
      [401, "invalid_proof"],
    ] as const) {
      const c = await cloud((_req, res) => json(res, status, { error }));
      const onRefusal = vi.fn(async () => {});
      await codeOfAsync(fetchBillingDisplay(c.state, { onRefusal }));
      expect(onRefusal).toHaveBeenCalledWith(error, JSON.stringify(c.lease), c.state.publicKey);
    }
  });

  it("reports a 429's Retry-After hint in seconds", async () => {
    const c = await cloud((_req, res) =>
      json(res, 429, { error: "rate_limited" }, { "retry-after": "120" }),
    );
    const error = await fetchBillingDisplay(c.state).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError & { retryAfterMs?: number }).retryAfterMs).toBe(120_000);
  });

  it("refuses a redirect", async () => {
    const c = await cloud((_req, res) => {
      res.writeHead(302, { location: "/elsewhere" });
      res.end();
    });
    expect(await codeOfAsync(fetchBillingDisplay(c.state))).toBe("cloud.unavailable");
    expect(c.seen).toHaveLength(1);
  });

  it("accepts a reply of exactly 16,384 bytes and refuses one byte more", async () => {
    let origin = "";
    let pad = 0;
    const c = await cloud((_req, res) => {
      const body = JSON.stringify(good(origin));
      json(res, 200, body + " ".repeat(pad - body.length));
    });
    origin = c.origin;
    pad = 16_384;
    expect(await codeOfAsync(fetchBillingDisplay(c.state))).toBe("accepted");
    pad = 16_385;
    expect(await codeOfAsync(fetchBillingDisplay(c.state))).toBe("cloud.unavailable");
  });

  it("refuses a reply that is not UTF-8 JSON", async () => {
    const c = await cloud((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(Buffer.from([0x7b, 0xff, 0x7d]));
    });
    expect(await codeOfAsync(fetchBillingDisplay(c.state))).toBe("cloud.unavailable");
  });

  it("gives up on a reply that never finishes within its time limit", async () => {
    const c = await cloud((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("{");
    });
    expect(await codeOfAsync(fetchBillingDisplay(c.state, { timeoutMs: 100 }))).toBe(
      "cloud.unavailable",
    );
  });

  it("bounds the whole read by eight seconds unless told otherwise", async () => {
    let origin = "";
    const c = await cloud((_req, res) => json(res, 200, good(origin)));
    origin = c.origin;
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await fetchBillingDisplay(c.state);
    expect(timeout).toHaveBeenCalledWith(8000);
  });

  it("stops when the caller's signal is aborted", async () => {
    const c = await cloud(() => {});
    expect(await codeOfAsync(fetchBillingDisplay(c.state, { signal: AbortSignal.abort() }))).toBe(
      "cloud.unavailable",
    );
  });
});
