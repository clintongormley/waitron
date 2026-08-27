import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  AppError,
  hasCode,
  isAppError,
  nodeId as brandNodeId,
  tenantId as brandTenantId,
} from "@waitron/shared";
import type { VenueResult } from "@waitron/provisioning";
import { verifyPassword, verifyPin } from "@waitron/identity";
import type { ProvisionRequest } from "./provision.js";
import { validateAeatCert, type AeatCert } from "./aeat-credential.js";
import type { Logger, LogLevel } from "./logger.js";
import { mountSetup, type SetupDeps } from "./setup-api.js";

const noopLog: Logger = () => {};

/** A logger that records every line, so the mount-time setup-mode signal can be asserted. */
function capturingLog(): {
  log: Logger;
  lines: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }>;
} {
  const lines: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }> = [];
  const log: Logger = (level, event, fields) => {
    lines.push({ level, event, fields });
  };
  return { log, lines };
}

describe("mountSetup — setup-mode routes for an unprovisioned box", () => {
  it("reports unprovisioned status as JSON", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction" }, noopLog);
    const res = await app.request("/setup-api/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
    });
  });

  it("reflects the deployment environment it was given", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "production" }, noopLog);
    const res = await app.request("/setup-api/status");
    expect(await res.json()).toEqual({
      provisioned: false,
      environment: "production",
      needs: ["venue"],
    });
  });

  it("serves a setup placeholder page for any other path", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction" }, noopLog);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toMatch(/set ?up/i);
  });

  it("serves the placeholder for a deep unmatched path too, not only the root", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction" }, noopLog);
    const res = await app.request("/anything/else");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toMatch(/set ?up/i);
  });

  it("does not shadow a route registered before it (e.g. /health)", async () => {
    const app = new Hono();
    app.get("/health", (c) => c.json({ ok: true }));
    mountSetup(app, { environment: "preproduction" }, noopLog);
    expect((await app.request("/health")).status).toBe(200);
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
  });

  it("logs one setup-mode signal, carrying the environment, when mounted", () => {
    const { log, lines } = capturingLog();
    mountSetup(new Hono(), { environment: "preproduction" }, log);
    const signal = lines.filter((l) => l.event === "setup.mode_active");
    expect(signal).toHaveLength(1);
    expect(signal[0]).toMatchObject({
      level: "info",
      fields: { environment: "preproduction" },
    });
  });
});

// The five VenueResult ids the provision route threads into the response + persisted trading config.
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const LOCATION_ID = "22222222-2222-2222-2222-222222222222";
const TILL_ID = "33333333-3333-3333-3333-333333333333";
const NODE_ID = "44444444-4444-4444-4444-444444444444";
const SERIES_ID_0 = "66666666-6666-6666-6666-666666666666";
const SERIES_ID_1 = "77777777-7777-7777-7777-777777777777";

function makeVenueResult(): VenueResult {
  return {
    tenantId: TENANT_ID,
    locationId: LOCATION_ID,
    tillId: TILL_ID,
    nodeId: NODE_ID,
    sif: {
      id: "55555555-5555-5555-5555-555555555555",
      tenantId: brandTenantId(TENANT_ID),
      nodeId: brandNodeId(NODE_ID),
      nif: "50000000K",
      idSistemaInformatico: "WT",
      numeroInstalacion: 1,
      registradoEn: new Date("2026-01-01T00:00:00Z"),
      revocadoEn: null,
    },
    seriesIds: [SERIES_ID_0, SERIES_ID_1],
  };
}

const DATABASE_URL = "postgres://waitron_app:pw@localhost/waitron";
const MIGRATIONS_DATABASE_URL = "postgres://waitron_migrator:pw@localhost/waitron";

/** A well-formed provision body with PLAINTEXT admin secrets (the shape the wizard POSTs). */
function demoBody(): Record<string, unknown> {
  return {
    mode: "demo",
    venue: {
      country: "ES",
      taxId: "50000000K",
      legalName: "Waitron Dev SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "Retail counter sales",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      tillName: "Caja 1",
      seriesCode: "A",
      rectificativeSeriesCode: "R",
      admin: { displayName: "Administradora", pin: "1357", password: "correct-horse-battery" },
    },
  };
}

function liveBody(): Record<string, unknown> {
  return { ...demoBody(), mode: "live" };
}

const CERT: AeatCert = {
  pfxBase64: Buffer.from("fake-pfx-bytes").toString("base64"),
  passphrase: "cert-secret",
  certKind: "sello",
};

/** A full set of provision deps, each a spy that records its invocation ORDER into `calls`. The
 * default `provision` also captures every request it saw into `provisionRequests`. */
function makeDeps(overrides: Partial<SetupDeps> = {}): {
  deps: SetupDeps;
  calls: string[];
  provisionRequests: ProvisionRequest[];
  provision: ReturnType<typeof vi.fn>;
  sealAeat: ReturnType<typeof vi.fn>;
  persistTrading: ReturnType<typeof vi.fn>;
  requestRestart: ReturnType<typeof vi.fn>;
} {
  const calls: string[] = [];
  const provisionRequests: ProvisionRequest[] = [];
  const provision = vi.fn(async (req: ProvisionRequest) => {
    provisionRequests.push(req);
    calls.push("provision");
    return makeVenueResult();
  });
  const sealAeat = vi.fn(async () => {
    calls.push("sealAeat");
  });
  const persistTrading = vi.fn(async () => {
    calls.push("persistTrading");
  });
  const requestRestart = vi.fn(() => {
    calls.push("requestRestart");
  });
  const deps: SetupDeps = {
    environment: "preproduction",
    provision,
    sealAeat,
    persistTrading,
    requestRestart,
    databaseUrl: DATABASE_URL,
    migrationsDatabaseUrl: MIGRATIONS_DATABASE_URL,
    ...overrides,
  };
  return { deps, calls, provisionRequests, provision, sealAeat, persistTrading, requestRestart };
}

async function postProvision(app: Hono, body: unknown): Promise<Response> {
  return app.request("/setup-api/provision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Yield one macrotask, so a `setTimeout(…, 0)`-scheduled restart has fired. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Narrowing helper for mutating a decoded body's nested objects in the validation tests. */
const asRec = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

describe("POST /setup-api/provision — orchestration, demo/live fork, cert gate, latch", () => {
  it("provisions a demo venue: 200, orchestrates in order, defers restart, seals no cert", async () => {
    const app = new Hono();
    const { deps, calls, provisionRequests, sealAeat, requestRestart, persistTrading } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provisioned: true, tenantId: TENANT_ID, restarting: true });

    // The restart is scheduled on the NEXT tick, so it has NOT fired by the time the 200 is returned.
    expect(requestRestart).not.toHaveBeenCalled();
    expect(calls).toEqual(["provision", "persistTrading"]);
    await tick();
    expect(calls).toEqual(["provision", "persistTrading", "requestRestart"]);

    // Demo → no AEAT cert seal, and the demo/live fork stamped preproduction.
    expect(sealAeat).not.toHaveBeenCalled();
    const req = provisionRequests[0];
    expect(req.environment).toBe("preproduction");

    // Plaintext admin secrets were HASHED at the boundary and never reached provision.
    expect(req.venue.admin).not.toHaveProperty("pin");
    expect(req.venue.admin).not.toHaveProperty("password");
    expect(verifyPin("1357", req.venue.admin.pinHash)).toBe(true);
    expect(verifyPassword("correct-horse-battery", req.venue.admin.passwordHash)).toBe(true);

    // The persisted trading config is composed from the VenueResult ids + the injected DB URLs.
    expect(persistTrading.mock.calls[0][0]).toEqual({
      tenantId: TENANT_ID,
      tillId: TILL_ID,
      nodeId: NODE_ID,
      seriesId: SERIES_ID_0,
      locationId: LOCATION_ID,
      databaseUrl: DATABASE_URL,
      migrationsDatabaseUrl: MIGRATIONS_DATABASE_URL,
      environment: "preproduction",
    });
  });

  it("refuses a live ES-common provision with no AEAT cert (400), without provisioning", async () => {
    const app = new Hono();
    const { deps, provision, requestRestart } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, liveBody());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "setup.aeat_cert_required", params: {} } });
    expect(provision).not.toHaveBeenCalled();
    await tick();
    expect(requestRestart).not.toHaveBeenCalled();
  });

  it("provisions a live venue with a cert: stamps production and seals the cert in order", async () => {
    const app = new Hono();
    const { deps, calls, provisionRequests, sealAeat } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, { ...liveBody(), aeatCert: CERT });

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].environment).toBe("production");
    expect(sealAeat).toHaveBeenCalledTimes(1);
    expect(sealAeat.mock.calls[0]).toEqual([TENANT_ID, CERT]);
    // The seal runs AFTER provision mints the tenant and BEFORE the trading config is persisted.
    expect(calls).toEqual(["provision", "sealAeat", "persistTrading", "requestRestart"]);
  });

  // CRITICAL fiscal guard: a malformed AEAT cert must be refused BEFORE `provision` runs. Without the
  // upfront `validateAeatCert` in `parseCert`, a live ES-common provision with `certKind:"bogus"` or a
  // non-base64 `pfxBase64` would run `provision` first — stamping production and minting the SIF/hash
  // chain (UNREPAIRABLE, CLAUDE.md §5) — and only THEN 400 inside `sealAeatCredential`, wedging the box
  // permanently (a corrected retry then hits `setup.already_provisioned` 409 forever). The 0 provision
  // calls below are the proof that NOTHING was stamped or minted. Deletion-proof: remove the
  // `validateAeatCert(parsed)` line in `setup-api.ts`'s `parseCert` and these go RED — the bogus cert
  // reaches `provision`.
  it.each<[string, Record<string, unknown>]>([
    ["a certKind outside {sello, representante}", { ...CERT, certKind: "bogus" }],
    ["a non-base64 pfxBase64", { ...CERT, pfxBase64: "not valid base64!!!" }],
  ])(
    "refuses a live provision whose aeatCert has %s (400) WITHOUT stamping or minting",
    async (_label, aeatCert) => {
      const app = new Hono();
      const { deps, provision, requestRestart } = makeDeps();
      mountSetup(app, deps, noopLog);

      const res = await postProvision(app, { ...liveBody(), aeatCert });

      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("setup.request_invalid");
      // NOTHING stamped or minted — the malformed cert was rejected before `provision` ran.
      expect(provision).not.toHaveBeenCalled();
      await tick();
      expect(requestRestart).not.toHaveBeenCalled();
    },
  );

  it("rejects an unparseable body with 400 setup.request_invalid, without provisioning", async () => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, "not json {");

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("setup.request_invalid");
    expect(provision).not.toHaveBeenCalled();
  });

  it("rejects a JSON-null body with 400 setup.request_invalid", async () => {
    const app = new Hono();
    const { deps } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, "null");

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("setup.request_invalid");
  });

  it("names a missing venue field in 400 setup.request_invalid without echoing a secret", async () => {
    const app = new Hono();
    const { deps } = makeDeps();
    mountSetup(app, deps, noopLog);

    const bad = demoBody();
    delete (bad.venue as Record<string, unknown>).taxId;
    const res = await postProvision(app, bad);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("setup.request_invalid");
    expect(body.error.params.field).toBe("taxId");
    // The response must never carry the admin secrets, whatever the field.
    expect(JSON.stringify(body)).not.toContain("1357");
    expect(JSON.stringify(body)).not.toContain("correct-horse-battery");
  });

  // Each structural guard names the offending field and refuses BEFORE provisioning. Covers the
  // demo/live `mode` fork, the object/array/nullable/string-array shape screens, and nested paths.
  it.each<[string, string, (body: Record<string, unknown>) => void]>([
    ["an unknown mode", "mode", (b) => void (b.mode = "bogus")],
    ["a string venue", "venue", (b) => void (b.venue = "nope")],
    ["a null venue", "venue", (b) => void (b.venue = null)],
    ["an array venue", "venue", (b) => void (b.venue = [])],
    ["a missing location", "location", (b) => void delete asRec(b.venue).location],
    ["a missing admin", "admin", (b) => void delete asRec(b.venue).admin],
    [
      "non-array locales",
      "location.invoiceLocales",
      (b) => void (asRec(asRec(b.venue).location).invoiceLocales = "es-ES"),
    ],
    [
      "empty locales",
      "location.invoiceLocales",
      (b) => void (asRec(asRec(b.venue).location).invoiceLocales = []),
    ],
    [
      "a non-string locale",
      "location.invoiceLocales",
      (b) => void (asRec(asRec(b.venue).location).invoiceLocales = [42]),
    ],
    ["a missing admin.pin", "admin.pin", (b) => void delete asRec(asRec(b.venue).admin).pin],
  ])(
    "rejects %s with 400 setup.request_invalid naming the field, without provisioning",
    async (_label, field, mutate) => {
      const app = new Hono();
      const { deps, provision } = makeDeps();
      mountSetup(app, deps, noopLog);

      const body = demoBody();
      mutate(body);
      const res = await postProvision(app, body);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("setup.request_invalid");
      expect(json.error.params.field).toBe(field);
      expect(provision).not.toHaveBeenCalled();
    },
  );

  it("accepts a non-null addressLine2 and provisions (200)", async () => {
    const app = new Hono();
    const { deps } = makeDeps();
    mountSetup(app, deps, noopLog);

    const body = demoBody();
    asRec(asRec(body.venue).location).addressLine2 = "Piso 2";
    const res = await postProvision(app, body);

    expect(res.status).toBe(200);
    await tick();
  });

  it("latches out a second concurrent provision with 409 while the first is in flight", async () => {
    const app = new Hono();
    let release!: (v: VenueResult) => void;
    const pending = new Promise<VenueResult>((resolve) => {
      release = resolve;
    });
    const provision = vi.fn(() => pending);
    const { deps } = makeDeps({ provision });
    mountSetup(app, deps, noopLog);

    // Fire the first POST but do NOT await it — its provision hangs on `pending`.
    const first = postProvision(app, demoBody());
    await tick(); // let the first request reach + set the latch (its provision is now pending)

    const second = await postProvision(app, demoBody());
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: { code: "setup.already_provisioning", params: {} },
    });
    expect(provision).toHaveBeenCalledTimes(1); // the second never reached provision

    // Let the first finish so nothing dangles.
    release(makeVenueResult());
    expect((await first).status).toBe(200);
    await tick();
  });

  it("resets the latch after a FAILED provision so a corrected retry is accepted", async () => {
    const app = new Hono();
    const provision = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient boom"))
      .mockResolvedValueOnce(makeVenueResult());
    const { deps, requestRestart } = makeDeps({ provision });
    mountSetup(app, deps, noopLog);

    const first = await postProvision(app, demoBody());
    expect(first.status).toBe(500); // a non-AppError provision fault → opaque server.internal
    await tick();
    expect(requestRestart).not.toHaveBeenCalled(); // a failed provision never restarts

    // The latch was reset on failure, so a second POST runs rather than being refused 409.
    const second = await postProvision(app, demoBody());
    expect(second.status).toBe(200);
    await tick();
    expect(requestRestart).toHaveBeenCalledTimes(1);
  });

  it("keeps the latch SET after a SUCCESSFUL provision — a second POST is 409 while the box restarts", async () => {
    // The success arm of the latch: unlike a FAILED provision (which resets it above), a successful one
    // LEAVES the latch set — the box is on its way down to restart into trading mode, so a second POST
    // arriving in that window must not start a second, unrecoverable chain. It is refused 409
    // `setup.already_provisioning` and never reaches `provision`.
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);

    const first = await postProvision(app, demoBody());
    expect(first.status).toBe(200);
    await tick(); // let the deferred restart fire; the latch stays set

    const second = await postProvision(app, demoBody());
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: { code: "setup.already_provisioning", params: {} },
    });
    // Only the first POST reached provision — the latch refused the second synchronously.
    expect(provision).toHaveBeenCalledTimes(1);
  });

  it("maps a thrown setup.already_provisioned to 409", async () => {
    const app = new Hono();
    const provision = vi.fn(async () => {
      throw new AppError("setup.already_provisioned", { tenantId: TENANT_ID });
    });
    const { deps } = makeDeps({ provision });
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("setup.already_provisioned");
  });

  it("answers 503 setup.not_ready when NONE of the provision deps are wired", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction" }, noopLog);

    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
  });

  // Each individual dep is load-bearing: with all others wired, omitting ONE still yields 503 — the
  // box is up but not ready to provision. Also covers each arm of the synchronous deps gate.
  it.each([
    ["provision"],
    ["sealAeat"],
    ["persistTrading"],
    ["requestRestart"],
    ["databaseUrl"],
    ["migrationsDatabaseUrl"],
  ] as const)("answers 503 setup.not_ready when %s alone is unwired", async (missing) => {
    const app = new Hono();
    const { deps } = makeDeps({ [missing]: undefined });
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
  });
});

// The upfront cert validator `parseCert` calls before `provision`. Tested directly (not only through
// the endpoint) because `parseCert`'s own `asString` already rejects an empty passphrase, so that
// branch is defense-in-depth unreachable from the endpoint — a direct test is what proves it fires.
describe("validateAeatCert — full cert-value validation before provisioning", () => {
  function goodCert(overrides: Partial<AeatCert> = {}): AeatCert {
    return { ...CERT, ...overrides };
  }

  it("accepts a well-formed cert (sello + base64 pfx + non-empty passphrase)", () => {
    expect(() => validateAeatCert(goodCert())).not.toThrow();
    expect(() => validateAeatCert(goodCert({ certKind: "representante" }))).not.toThrow();
  });

  it.each<[string, AeatCert, string]>([
    [
      "a certKind outside the set",
      goodCert({ certKind: "bogus" as AeatCert["certKind"] }),
      "certKind",
    ],
    ["an empty pfxBase64", goodCert({ pfxBase64: "" }), "pfxBase64"],
    ["a non-base64 pfxBase64", goodCert({ pfxBase64: "not base64!" }), "pfxBase64"],
    ["a malformed base64 length", goodCert({ pfxBase64: "QQ" }), "pfxBase64"],
    ["an empty passphrase", goodCert({ passphrase: "" }), "passphrase"],
  ])("rejects %s with setup.request_invalid naming the field", (_label, cert, field) => {
    let error: unknown;
    try {
      validateAeatCert(cert);
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      field,
    );
  });
});
