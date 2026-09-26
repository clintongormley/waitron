import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError, SUPPORTED_LOCALE_CODES } from "@waitron/shared";
import type { VenueResult } from "@waitron/provisioning";
import { verifyPassword, verifyPin } from "@waitron/identity";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { ProvisionRequest } from "./provision.js";
import type { RestoreRequest } from "./restore-request.js";
import type { AdoptCredential, AdoptRequest } from "./adopt.js";
import type { Logger, LogLevel } from "./logger.js";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { createSetupOperationStore } from "./setup-operation.js";
import type { ConfigurationPreview } from "./configuration-import.js";

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

const LOCATION_ID = "22222222-2222-2222-2222-222222222222";
const TILL_ID = "33333333-3333-3333-3333-333333333333";
const NODE_ID = "44444444-4444-4444-4444-444444444444";
const SERIES_ID_0 = "66666666-6666-6666-6666-666666666666";
const SERIES_ID_1 = "77777777-7777-7777-7777-777777777777";

function makeVenueResult(): VenueResult {
  return {
    locationId: LOCATION_ID,
    tillId: TILL_ID,
    nodeId: NODE_ID,
    seriesIds: [SERIES_ID_0, SERIES_ID_1],
    seeded: [
      {
        module: "fiscal-verifactu",
        report: "SIF 55555555-5555-5555-5555-555555555555 (installation 1)",
      },
    ],
  };
}

/** A well-formed provision body with PLAINTEXT admin secrets (the shape the wizard POSTs). */
function demoBody(): Record<string, unknown> {
  return {
    mode: "demo",
    venue: {
      country: "ES",
      taxId: "50000000R",
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
      admin: {
        displayName: "Administradora",
        firstNames: "Ana Maria",
        lastNames: "Lopez Garcia",
        pin: "1357",
        password: "correct-horse-battery",
        email: "admin@waitron.dev",
      },
    },
  };
}

function liveBody(): Record<string, unknown> {
  return { ...demoBody(), mode: "live" };
}

function prepareBody(): Record<string, unknown> {
  return { ...demoBody(), mode: "prepare" };
}

// A well-formed AEAT-cert wire blob (the shape the wizard POSTs as `aeatCert`). A plain object, not
// a regime type: the host sees the secret only as opaque `unknown`, validated through the seat.
const CERT = {
  pfxBase64: Buffer.from("fake-pfx-bytes").toString("base64"),
  passphrase: "cert-secret",
  certKind: "sello",
} as const;

/** A full set of provision deps, each a spy that records its invocation ORDER into `calls`. The
 * default `provision` also captures every request it saw into `provisionRequests`. */
function makeDeps(overrides: Partial<SetupDeps> = {}): {
  deps: SetupDeps;
  calls: string[];
  provisionRequests: ProvisionRequest[];
  provision: ReturnType<typeof vi.fn>;
  seedDemo: ReturnType<typeof vi.fn>;
  establishIdentity: ReturnType<typeof vi.fn>;
  seedMembership: ReturnType<typeof vi.fn>;
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
  const recoverProvision = vi.fn(async () => makeVenueResult());
  const seedDemo = vi.fn(async () => {
    calls.push("seedDemo");
  });
  const establishIdentity = vi.fn(async () => {
    calls.push("establishIdentity");
  });
  const seedMembership = vi.fn(async () => {
    calls.push("seedMembership");
  });
  const persistTrading = vi.fn(async () => {
    calls.push("persistTrading");
  });
  const requestRestart = vi.fn(() => {
    calls.push("requestRestart");
  });
  const runFiscalTest = vi.fn().mockResolvedValue({ status: "accepted" });
  const assertFiscalReady = vi.fn().mockResolvedValue(undefined);
  // A fake db that RECORDS the seal in order into `calls`; the seal's own database write is the
  // regime's `provisioning-secret.test.ts`'s to test. The seam is `withWriteLock` because
  // `withTransaction` IS the write lock (`packages/db/src/tenancy.ts`).
  const db = {
    withWriteLock: async () => {
      calls.push("sealAeat");
    },
  } as unknown as Database;
  const ring = {} as unknown as KeyRing;
  const deps: SetupDeps = {
    environment: "preproduction",
    provision,
    recoverProvision,
    seedDemo,
    establishIdentity,
    seedMembership,
    db,
    ring,
    persistTrading,
    requestRestart,
    runFiscalTest,
    assertFiscalReady,
    ...overrides,
  };
  return {
    deps,
    calls,
    provisionRequests,
    provision,
    seedDemo,
    establishIdentity,
    seedMembership,
    persistTrading,
    requestRestart,
  };
}

async function postProvision(
  app: Hono,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request("/setup-api/provision", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Yield one macrotask, so a `setTimeout(…, 0)`-scheduled restart has fired. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Narrowing helper for mutating a decoded body's nested objects in the validation tests. */
const asRec = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

describe("POST /setup-api/provision — orchestration, onboarding intent, cert gate, latch", () => {
  it("runs an explicit fiscal test and refuses activation when its bound evidence is absent", async () => {
    const fiscalTest = new Hono();
    const runFiscalTest = vi.fn().mockResolvedValue({ status: "accepted" });
    mountSetup(fiscalTest, makeDeps({ runFiscalTest }).deps, noopLog);
    const body = { ...liveBody(), aeatCert: CERT };
    const tested = await fiscalTest.request("/setup-api/fiscal-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(tested.status).toBe(200);
    expect(await tested.json()).toEqual({ status: "accepted" });
    expect(runFiscalTest).toHaveBeenCalledOnce();

    const provision = new Hono();
    const assertFiscalReady = vi.fn(async () => {
      throw new AppError("setup.fiscal_test_required", { module: "verifactu" });
    });
    const deps = makeDeps({ assertFiscalReady });
    mountSetup(provision, deps.deps, noopLog);
    const refused = await postProvision(provision, body);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: { code: "setup.fiscal_test_required", params: { module: "verifactu" } },
    });
    expect(deps.provision).not.toHaveBeenCalled();
  });

  it("reports completed persistent progress and replays it after a process restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-api-operation-"));
    try {
      const operations = createSetupOperationStore(dir);
      const first = new Hono();
      mountSetup(first, makeDeps({ operations }).deps, noopLog);
      expect((await postProvision(first, demoBody())).status).toBe(200);

      const status = await (await first.request("/setup-api/status")).json();
      expect(status.operation).toMatchObject({ kind: "provision", phase: "complete" });
      expect(status.operation).not.toHaveProperty("requestHash");
      expect(status.operation).not.toHaveProperty("data");

      const restarted = new Hono();
      const next = makeDeps({ operations: createSetupOperationStore(dir) });
      mountSetup(restarted, next.deps, noopLog);
      const replay = await postProvision(restarted, demoBody());
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ provisioned: true });
      expect(next.provision).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps setup status healthy when persisted operation state needs operator recovery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-api-corrupt-operation-"));
    try {
      writeFileSync(join(dir, "setup-operation.json"), "not-json");
      const app = new Hono();
      mountSetup(
        app,
        { environment: "preproduction", operations: createSetupOperationStore(dir) },
        noopLog,
      );

      const response = await app.request("/setup-api/status");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ operationBlocked: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recovers a venue committed before operation progress reached disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-api-recovery-"));
    const body = demoBody();
    const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    try {
      const operations = createSetupOperationStore(dir);
      await expect(
        operations.run("provision", requestHash, async () => {
          throw new Error("process stopped after the database commit");
        }),
      ).rejects.toThrow("process stopped");

      const recoverProvision = vi.fn(async () => makeVenueResult());
      const provision = vi.fn(async () => {
        throw new AppError("setup.already_provisioned", {});
      });
      const app = new Hono();
      const deps = makeDeps({ operations, provision, recoverProvision });
      mountSetup(app, deps.deps, noopLog);

      expect((await postProvision(app, body)).status).toBe(200);
      expect(provision).toHaveBeenCalledOnce();
      expect(recoverProvision).toHaveBeenCalledOnce();
      expect(deps.establishIdentity).toHaveBeenCalledWith(NODE_ID);
      expect((await operations.read())?.phase).toBe("complete");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not repeat committed demo setup steps after a later publishing failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-api-step-resume-"));
    try {
      const firstPersist = vi
        .fn<NonNullable<SetupDeps["persistTrading"]>>()
        .mockRejectedValueOnce(new Error("disk unavailable"));
      const first = makeDeps({
        operations: createSetupOperationStore(dir),
        persistTrading: firstPersist,
      });
      const firstApp = new Hono();
      mountSetup(firstApp, first.deps, noopLog);

      expect((await postProvision(firstApp, demoBody())).status).toBe(500);
      expect(first.seedDemo).toHaveBeenCalledOnce();
      expect(first.establishIdentity).toHaveBeenCalledOnce();
      expect(first.seedMembership).toHaveBeenCalledOnce();

      const resumed = makeDeps({
        operations: createSetupOperationStore(dir),
        persistTrading: vi.fn(async () => {}),
      });
      const resumedApp = new Hono();
      mountSetup(resumedApp, resumed.deps, noopLog);

      expect((await postProvision(resumedApp, demoBody())).status).toBe(200);
      expect(resumed.provision).not.toHaveBeenCalled();
      expect(resumed.seedDemo).not.toHaveBeenCalled();
      expect(resumed.establishIdentity).not.toHaveBeenCalled();
      expect(resumed.seedMembership).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("provisions and seeds a demo venue: 200, orchestrates in order, defers restart, seals no cert", async () => {
    const app = new Hono();
    const {
      deps,
      calls,
      provisionRequests,
      establishIdentity,
      seedMembership,
      requestRestart,
      persistTrading,
    } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provisioned: true, restarting: true });

    // The restart is scheduled on the NEXT tick, so it has NOT fired by the time the 200 is returned.
    expect(requestRestart).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "provision",
      "seedDemo",
      "establishIdentity",
      "seedMembership",
      "persistTrading",
    ]);
    await tick();
    expect(calls).toEqual([
      "provision",
      "seedDemo",
      "establishIdentity",
      "seedMembership",
      "persistTrading",
      "requestRestart",
    ]);

    expect(establishIdentity).toHaveBeenCalledWith(NODE_ID);
    expect(seedMembership).toHaveBeenCalledWith(NODE_ID);

    // Demo → no AEAT cert seal (the seal is never reached), and the fiscal environment is preproduction.
    expect(calls).not.toContain("sealAeat");
    const req = provisionRequests[0];
    expect(req.environment).toBe("preproduction");

    // Plaintext admin secrets were HASHED at the boundary and never reached provision.
    expect(req.venue.admin).not.toHaveProperty("pin");
    expect(req.venue.admin).not.toHaveProperty("password");
    expect(verifyPin("1357", req.venue.admin.pinHash)).toBe(true);
    expect(verifyPassword("correct-horse-battery", req.venue.admin.passwordHash)).toBe(true);

    expect(persistTrading.mock.calls[0][0]).toEqual({
      tillId: TILL_ID,
      nodeId: NODE_ID,
      seriesId: SERIES_ID_0,
      locationId: LOCATION_ID,
      environment: "preproduction",
      onboardingIntent: "demo",
    });
  });

  it("provisions Prepare in preproduction and persists the distinct preparation intent", async () => {
    const app = new Hono();
    const { deps, provisionRequests, persistTrading, calls } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, prepareBody());

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].environment).toBe("preproduction");
    expect(calls).not.toContain("sealAeat");
    expect(calls).not.toContain("seedDemo");
    expect(persistTrading.mock.calls[0][0]).toMatchObject({
      environment: "preproduction",
      onboardingIntent: "prepare",
    });
  });

  it("normalizes the admin email and threads it into the provision request", async () => {
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const body = demoBody();
    asRec(asRec(body.venue).admin).email = "Owner@X.com";
    const res = await postProvision(app, body);

    expect(res.status).toBe(200);
    await tick();
    // Normalized to lowercase/trimmed, and not hashed — the email is not a credential.
    expect(provisionRequests[0].venue.admin.email).toBe("owner@x.com");
  });

  it("threads the admin's real names through to the provision request", async () => {
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].venue.admin).toMatchObject({
      firstNames: "Ana Maria",
      lastNames: "Lopez Garcia",
    });
  });

  // The browser's language wins, and a language Waitron does not ship loses to the venue's own
  // locale.
  it("gives the admin the language their browser asked for", async () => {
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody(), {
      "Accept-Language": "en-GB,en;q=0.9,es;q=0.8",
    });

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].venue.admin.locale).toBe("en-GB");
  });

  it("falls back to the venue's own language when the browser asks for one we do not ship", async () => {
    // A Madrid venue, so the answer `es-ES` differs from the `en-GB` floor.
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody(), { "Accept-Language": "fr-FR,fr;q=0.9" });

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].venue.admin.locale).toBe("es-ES");
  });

  it("falls back to the venue's own language when the browser sends no preference", async () => {
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].venue.admin.locale).toBe("es-ES");
  });

  it("only ever stores a language the apps can render", async () => {
    // `persons.locale` has no enum behind it, so a code with no catalogue would render as missing
    // strings.
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody(), { "Accept-Language": "en-US" });

    expect(res.status).toBe(200);
    await tick();
    expect(SUPPORTED_LOCALE_CODES).toContain(provisionRequests[0].venue.admin.locale);
  });

  it.each(["admin.firstNames", "admin.lastNames"] as const)(
    "refuses an empty %s rather than storing it",
    async (field) => {
      const app = new Hono();
      const { deps, provision } = makeDeps();
      mountSetup(app, deps, noopLog);

      const body = demoBody();
      asRec(asRec(body.venue).admin)[field.slice("admin.".length)] = "";
      const res = await postProvision(app, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "setup.request_invalid", params: { field } },
      });
      expect(provision).not.toHaveBeenCalled();
    },
  );

  it.each(["admin.firstNames", "admin.lastNames"] as const)(
    "refuses a %s that is only whitespace, exactly as it refuses an empty one",
    async (field) => {
      // The column's check counts `" "` as a length of one and would store it.
      const app = new Hono();
      const { deps, provision } = makeDeps();
      mountSetup(app, deps, noopLog);

      const body = demoBody();
      asRec(asRec(body.venue).admin)[field.slice("admin.".length)] = "   ";
      const res = await postProvision(app, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "setup.request_invalid", params: { field } },
      });
      expect(provision).not.toHaveBeenCalled();
    },
  );

  it.each([
    { route: "/setup-api/provision", label: "provision" },
    { route: "/setup-api/fiscal-test", label: "fiscal-test" },
  ])("refuses a malformed body to $label with a 400, not a 500", async ({ route }) => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await app.request(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it.each([
    { route: "/setup-api/provision", label: "provision" },
    { route: "/setup-api/fiscal-test", label: "fiscal-test" },
  ])("refuses an empty body to $label with a 400, not a 500", async ({ route }) => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await app.request(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it("trims a padded real name rather than storing the padding", async () => {
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const body = demoBody();
    const admin = asRec(asRec(body.venue).admin);
    admin.firstNames = "  Ana Maria  ";
    admin.lastNames = "\tLopez Garcia\n";
    const res = await postProvision(app, body);

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].venue.admin).toMatchObject({
      firstNames: "Ana Maria",
      lastNames: "Lopez Garcia",
    });
  });

  it("accepts a provision with no real names and passes them through as null", async () => {
    // `waitron-provision venue` never prompts for them, so an absent field is legitimate.
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const body = demoBody();
    const admin = asRec(asRec(body.venue).admin);
    delete admin.firstNames;
    delete admin.lastNames;
    const res = await postProvision(app, body);

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].venue.admin).toMatchObject({
      firstNames: null,
      lastNames: null,
    });
  });

  it("normalizes country fields and derives fiscal territory and time zone before provisioning", async () => {
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const body = demoBody();
    const venue = asRec(body.venue);
    const location = asRec(venue.location);
    venue.taxId = " b 1234567 4 ";
    location.postalCode = " 28013 ";
    location.province = "madrid";
    const res = await postProvision(app, body);

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].venue).toMatchObject({
      country: "ES",
      taxId: "B12345674",
      location: {
        postalCode: "28013",
        province: "Madrid",
        fiscalTerritory: "ES-common",
        timeZone: "Europe/Madrid",
      },
    });
  });

  it("refuses a country pack that is not ready for venue onboarding", async () => {
    const app = new Hono();
    const { deps, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);
    const body = demoBody();
    const venue = asRec(body.venue);
    venue.country = "gb";
    const res = await postProvision(app, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: "country" } },
    });
    expect(provisionRequests).toEqual([]);
  });

  it.each([
    ["fiscal territory", "fiscalTerritory", "GB-vat", "location.fiscalTerritory"],
    ["time zone", "timeZone", "Atlantic/Canary", "location.timeZone"],
  ] as const)(
    "refuses a supplied %s that disagrees with the country pack",
    async (_label, key, value, field) => {
      const app = new Hono();
      const { deps, provision } = makeDeps();
      mountSetup(app, deps, noopLog);
      const body = demoBody();
      asRec(asRec(body.venue).location)[key] = value;

      const res = await postProvision(app, body);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toEqual({
        code: "setup.request_invalid",
        params: { field },
      });
      expect(provision).not.toHaveBeenCalled();
    },
  );

  it.each<[string, string, (body: Record<string, unknown>) => void]>([
    ["a bad NIF checksum", "taxId", (body) => void (asRec(body.venue).taxId = "B12345678")],
    [
      "an invalid postcode",
      "location.postalCode",
      (body) => void (asRec(asRec(body.venue).location).postalCode = "53000"),
    ],
    [
      "a postcode/province mismatch",
      "location.province",
      (body) => void (asRec(asRec(body.venue).location).province = "Barcelona"),
    ],
    [
      "an unsupported fiscal jurisdiction",
      "location.fiscalTerritory",
      (body) => {
        const location = asRec(asRec(body.venue).location);
        location.postalCode = "35001";
        location.province = "Las Palmas";
      },
    ],
  ])("refuses %s at the setup boundary", async (_label, field, mutate) => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);
    const body = demoBody();
    mutate(body);

    const res = await postProvision(app, body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: "setup.request_invalid", params: { field } });
    expect(provision).not.toHaveBeenCalled();
  });

  it("refuses a malformed admin email with 400 person.email_invalid, without provisioning", async () => {
    const app = new Hono();
    const { deps, provision, requestRestart } = makeDeps();
    mountSetup(app, deps, noopLog);

    const body = demoBody();
    asRec(asRec(body.venue).admin).email = "nope";
    const res = await postProvision(app, body);

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("person.email_invalid");
    expect(provision).not.toHaveBeenCalled();
    await tick();
    expect(requestRestart).not.toHaveBeenCalled();
  });

  it("refuses a live production provision with no AEAT cert (400 setup.provisioning_secret_required naming the module), without provisioning", async () => {
    const app = new Hono();
    const { deps, provision, requestRestart } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, liveBody());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.provisioning_secret_required", params: { module: "verifactu" } },
    });
    expect(provision).not.toHaveBeenCalled();
    await tick();
    expect(requestRestart).not.toHaveBeenCalled();
  });

  it("lets the dev onboarding target exercise Live without production filing or a real cert", async () => {
    const app = new Hono();
    const { deps, provisionRequests, persistTrading } = makeDeps({ devMode: true });
    mountSetup(app, deps, noopLog);

    expect((await postProvision(app, liveBody())).status).toBe(200);
    expect(provisionRequests[0].environment).toBe("preproduction");
    expect(persistTrading).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "preproduction", onboardingIntent: "live" }),
    );
  });

  it("provisions a live venue with a cert: stamps production and seals the cert in order", async () => {
    const app = new Hono();
    const { deps, calls, provisionRequests } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, { ...liveBody(), aeatCert: CERT });

    expect(res.status).toBe(200);
    await tick();
    expect(provisionRequests[0].environment).toBe("production");
    expect(calls).toEqual([
      "provision",
      "establishIdentity",
      "seedMembership",
      "sealAeat",
      "persistTrading",
      "requestRestart",
    ]);
  });

  // A real AEAT signing cert must never be sealed into a preproduction tenant's vault.
  it("refuses a demo provision carrying an AEAT cert (400 setup.request_invalid, field aeatCert), without provisioning or sealing", async () => {
    const app = new Hono();
    const { deps, provision, calls, requestRestart } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, { ...demoBody(), aeatCert: CERT });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("setup.request_invalid");
    expect(json.error.params.field).toBe("aeatCert");
    expect(provision).not.toHaveBeenCalled();
    expect(calls).not.toContain("sealAeat");
    await tick();
    expect(requestRestart).not.toHaveBeenCalled();
  });

  it("refuses a Prepare provision carrying an AEAT cert before provisioning or sealing", async () => {
    const app = new Hono();
    const { deps, provision, calls } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, { ...prepareBody(), aeatCert: CERT });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: "aeatCert" } },
    });
    expect(provision).not.toHaveBeenCalled();
    expect(calls).not.toContain("sealAeat");
  });

  // The presence gate runs before the regime's `validate` seat: a cert that is refused regardless
  // is never validated.
  it("refuses a demo provision carrying a MALFORMED aeatCert with field EXACTLY 'aeatCert' (not a validator sub-field like 'pfxBase64'), without validating/provisioning/sealing", async () => {
    const app = new Hono();
    const { deps, provision, calls, requestRestart } = makeDeps();
    mountSetup(app, deps, noopLog);

    const malformedCert = {
      pfxBase64: "not base64!!!",
      passphrase: "cert-secret",
      certKind: "sello",
    };
    const res = await postProvision(app, { ...demoBody(), aeatCert: malformedCert });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("setup.request_invalid");
    // "pfxBase64" is what the regime's validator would have named.
    expect(json.error.params.field).toBe("aeatCert");
    expect(json.error.params.field).not.toBe("pfxBase64");
    expect(provision).not.toHaveBeenCalled();
    expect(calls).not.toContain("sealAeat");
    await tick();
    expect(requestRestart).not.toHaveBeenCalled();
  });

  // A malformed cert must be refused BEFORE `provision` stamps production and mints the chain
  // (unrepairable, CLAUDE.md §5); refused only at the seal, a corrected retry would meet
  // `setup.already_provisioned` for good.
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
    ["a missing admin.email", "admin.email", (b) => void delete asRec(asRec(b.venue).admin).email],
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

    const first = postProvision(app, demoBody());
    await tick(); // let the first request reach + set the latch (its provision is now pending)

    const second = await postProvision(app, demoBody());
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: { code: "setup.already_provisioning", params: {} },
    });
    expect(provision).toHaveBeenCalledTimes(1); // the second never reached provision

    release(makeVenueResult());
    expect((await first).status).toBe(200);
    await tick();
  });

  it("resets the latch after a FAILED provision so a retry is accepted (no operation store)", async () => {
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

    const second = await postProvision(app, demoBody());
    expect(second.status).toBe(200);
    await tick();
    expect(requestRestart).toHaveBeenCalledTimes(1);
  });

  it("keeps the latch SET after a SUCCESSFUL provision — a second POST is 409 while the box restarts", async () => {
    // A second POST arriving while the box restarts must not start a second, unrecoverable chain.
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
    expect(provision).toHaveBeenCalledTimes(1);
  });

  it("maps a thrown setup.already_provisioned to 409", async () => {
    const app = new Hono();
    const provision = vi.fn(async () => {
      throw new AppError("setup.already_provisioned", {});
    });
    const { deps } = makeDeps({ provision });
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("setup.already_provisioned");
  });

  it("maps a thrown module.provision_only_disabled to 409 (SP-1b fiscal gate)", async () => {
    const app = new Hono();
    const provision = vi.fn(async () => {
      throw new AppError("module.provision_only_disabled", { module: "fiscal-verifactu" });
    });
    const { deps } = makeDeps({ provision });
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("module.provision_only_disabled");
  });

  it("answers 503 setup.not_ready when NONE of the provision deps are wired", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction" }, noopLog);

    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
  });

  it.each([
    ["provision"],
    ["seedDemo"],
    ["establishIdentity"],
    ["seedMembership"],
    ["db"],
    ["ring"],
    ["persistTrading"],
    ["requestRestart"],
  ] as const)("answers 503 setup.not_ready when %s alone is unwired", async (missing) => {
    const app = new Hono();
    const { deps } = makeDeps({ [missing]: undefined });
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
  });
});

// The rules themselves are the regime's to test (`packages/fiscal-verifactu/src/venue-fields.test.ts`);
// this pins that the boundary RUNS them, names the offending field, and mints nothing when it refuses.
describe("POST /setup-api/provision — the regime's rules on the operator's venue fields", () => {
  it.each<[string, string, (body: Record<string, unknown>) => void]>([
    [
      "a series code with a space",
      "seriesCode",
      (b) => void (asRec(b.venue).seriesCode = "Serie A"),
    ],
    [
      "a rectificative series code with a space",
      "rectificativeSeriesCode",
      (b) => void (asRec(b.venue).rectificativeSeriesCode = "Serie R"),
    ],
    [
      "an operation description carrying a character XML forbids",
      "location.operationDescription",
      (b) => void (asRec(asRec(b.venue).location).operationDescription = "Barra\u0007principal"),
    ],
    // Without this row `legalName` could be wired to any other string field and every test would
    // still pass: the legal name is only checked for control characters.
    [
      "a legal name carrying a character XML forbids",
      "legalName",
      (b) => void (asRec(b.venue).legalName = "Waitron\u0007Dev SL"),
    ],
  ])("refuses %s, naming the field and provisioning nothing", async (_label, field, mutate) => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);

    const body = demoBody();
    mutate(body);
    const res = await postProvision(app, body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: "setup.request_invalid", params: { field } });
    expect(provision).not.toHaveBeenCalled();
  });

  // Were the check on the provision route alone, an operator could pass the fiscal test and then be
  // refused at provisioning by the same value.
  it("refuses the explicit fiscal test too, before any submission is attempted", async () => {
    const app = new Hono();
    const runFiscalTest = vi.fn().mockResolvedValue({ status: "accepted" });
    const { deps } = makeDeps({ runFiscalTest });
    mountSetup(app, deps, noopLog);

    // The certificate is supplied so the series code is the ONLY fault: without it the secret gate
    // would refuse first, and the 400 would prove nothing about the venue-field seat.
    const body: Record<string, unknown> = { ...liveBody(), aeatCert: CERT };
    asRec(body.venue).seriesCode = "Serie A";
    const res = await app.request("/setup-api/fiscal-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "setup.request_invalid",
      params: { field: "seriesCode" },
    });
    expect(runFiscalTest).not.toHaveBeenCalled();
  });

  // Pins that the venue-field seat runs BEFORE the provisioning-secret gate: this body is wrong in
  // both ways, so whichever check runs first decides the answer.
  it("names the bad field ahead of the missing certificate when a live body is wrong in both ways", async () => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);

    const body = liveBody();
    asRec(body.venue).seriesCode = "Serie A";
    const res = await postProvision(app, body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "setup.request_invalid",
      params: { field: "seriesCode" },
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it("still provisions the ordinary demo venue, whose fields the regime accepts", async () => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(200);
    expect(provision).toHaveBeenCalledOnce();
    await tick();
  });
});

// The route-ORDERING guard: the wizard's catch-all is registered LAST, so the routes registered
// before it still win their own paths.
describe("mountSetup — serving a built setup wizard when setupAppDir is configured", () => {
  // Both this marker and the placeholder match `/set ?up/i`, so assertions key on the distinct
  // substrings.
  let wizardDir: string | undefined;

  beforeAll(() => {
    wizardDir = mkdtempSync(join(tmpdir(), "waitron-setup-wizard-"));
    writeFileSync(join(wizardDir, "index.html"), "<html>setup-wizard-spa</html>");
  });

  afterAll(() => {
    if (wizardDir !== undefined) rmSync(wizardDir, { recursive: true, force: true });
  });

  it("still serves /setup-api/status as JSON — the wizard catch-all does not shadow it", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction", setupAppDir: wizardDir }, noopLog);
    const res = await app.request("/setup-api/status");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
    });
  });

  it("still routes POST /setup-api/provision — the wizard catch-all does not swallow it", async () => {
    const app = new Hono();
    // Only `environment` + `setupAppDir` are wired, so the synchronous deps gate answers
    // 503 setup.not_ready — a JSON error, NOT the wizard index.html a shadowing `GET *` catch-all would
    // have served. That distinguishes "the POST route matched" from "the catch-all answered".
    mountSetup(app, { environment: "preproduction", setupAppDir: wizardDir }, noopLog);
    const res = await postProvision(app, demoBody());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
  });

  it("serves the built wizard index.html at the origin root — NOT the placeholder shell", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction", setupAppDir: wizardDir }, noopLog);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("setup-wizard-spa"); // the built wizard bundle
    expect(text).not.toContain("needs setup"); // NOT the inline placeholder shell
  });

  it.each(["/manage", "/anything/else"])(
    "redirects setup navigation %s to the root",
    async (path) => {
      const app = new Hono();
      mountSetup(app, { environment: "preproduction", setupAppDir: wizardDir }, noopLog);
      const res = await app.request(path, { headers: { Accept: "text/html" } });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    },
  );

  it.each([
    "/assets/missing.js",
    "/missing.js",
    "/setup-api/missing",
    "/management-api/missing",
    "/api/missing",
  ])("keeps missing files and API paths as 404: %s", async (path) => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction", setupAppDir: wizardDir }, noopLog);
    const res = await app.request(path, { headers: { Accept: "text/html" } });
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it("falls back to the inline placeholder for a stray path when setupAppDir is absent (unchanged)", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction" }, noopLog);
    const res = await app.request("/anything/else");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("needs setup"); // the inline placeholder shell
    expect(text).not.toContain("setup-wizard-spa");
  });
});

const PRIMARY_URL = "https://primary.example";
const ADOPT_CREDENTIAL: AdoptCredential = {
  personId: "88888888-8888-8888-8888-888888888888",
  password: "correct-horse-battery",
};
const BREAK_GLASS_SECRET = "break-glass-secret-abc123DEF456";

/** An adopt-only box wires just the two deps the adopt route's gate needs. */
function makeAdoptDeps(overrides: Partial<SetupDeps> = {}): {
  deps: SetupDeps;
  adopt: ReturnType<typeof vi.fn>;
  adoptRequests: AdoptRequest[];
  requestRestart: ReturnType<typeof vi.fn>;
} {
  const adoptRequests: AdoptRequest[] = [];
  const adopt = vi.fn(async (req: AdoptRequest) => {
    adoptRequests.push(req);
    return { breakGlassSecret: BREAK_GLASS_SECRET };
  });
  const requestRestart = vi.fn();
  const deps: SetupDeps = {
    environment: "preproduction",
    adopt,
    requestRestart,
    ...overrides,
  };
  return { deps, adopt, adoptRequests, requestRestart };
}

function adoptBody(): Record<string, unknown> {
  return { primaryUrl: PRIMARY_URL, credential: ADOPT_CREDENTIAL };
}

async function postAdopt(app: Hono, body: unknown): Promise<Response> {
  return app.request("/setup-api/adopt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function postRestore(
  app: Hono,
  body: Uint8Array,
  environment = "production",
): Promise<Response> {
  return app.request("/setup-api/restore", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-waitron-recovery-key": "recovery-secret",
      "x-waitron-restore-environment": environment,
    },
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  });
}

async function postConfiguration(app: Hono, body: Uint8Array): Promise<Response> {
  return app.request("/setup-api/configuration", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-waitron-export-passphrase": "a strong passphrase",
    },
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  });
}

describe("POST /setup-api/configuration", () => {
  it("labels an unexpected configuration staging fault as configuration, not restore", async () => {
    const log = vi.fn();
    const app = new Hono();
    mountSetup(
      app,
      {
        environment: "preproduction",
        stageConfiguration: vi.fn(async () => {
          throw new Error("broken staging disk");
        }),
      },
      log,
    );

    const response = await postConfiguration(app, Uint8Array.from([1, 2, 3]));

    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledWith(
      "error",
      "setup.configuration_import_failed",
      expect.objectContaining({ errorCode: "unknown" }),
    );
  });

  it("stages and previews a bounded preparation export", async () => {
    const preview = {
      venue: { taxId: "B12345678" },
      counts: { products: 2 },
      reconnect: ["printers"],
    } as never;
    const stageConfiguration = vi.fn(async () => preview);
    const app = new Hono();
    mountSetup(app, { environment: "preproduction", stageConfiguration }, noopLog);
    const response = await postConfiguration(app, Uint8Array.from([1, 2, 3]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preview);
    expect(stageConfiguration).toHaveBeenCalledWith(
      Uint8Array.from([1, 2, 3]),
      "a strong passphrase",
    );
  });

  it("blocks provisioning while a configuration archive is being staged", async () => {
    let release!: () => void;
    const held = new Promise<ConfigurationPreview>((resolve) => {
      release = () => resolve({ venue: {} as never, counts: {}, reconnect: [] });
    });
    const app = new Hono();
    const { deps, provision } = makeDeps({ stageConfiguration: vi.fn(() => held) });
    mountSetup(app, deps, noopLog);

    const staging = postConfiguration(app, Uint8Array.from([1, 2, 3]));
    await tick();
    const provisionResponse = await postProvision(app, demoBody());

    expect(provisionResponse.status).toBe(409);
    expect(provision).not.toHaveBeenCalled();
    release();
    expect((await staging).status).toBe(200);
  });
});

/** Refusals every restore route can meet from the same validation, with the one status each answers. */
const SHARED_RESTORE_REFUSALS: [AppError, number][] = [
  [new AppError("recovery.passphrase_invalid", {}), 422],
  [new AppError("backup.artifact_invalid", { reason: "tag" }), 422],
  [new AppError("backup.archive_invalid", { reason: "truncated" }), 422],
  [
    new AppError("restore.environment_mismatch", { backup: "preproduction", target: "production" }),
    409,
  ],
  [new AppError("restore.schema_too_new", { module: "core", backup: 9, target: 8 }), 409],
  [new AppError("provisioning.database_ahead", { set: "core", unknownMigrations: ["0009"] }), 409],
  [new AppError("restore.stream_source_live", { lastChangeAt: "2026-09-23T11:58:00Z" }), 409],
  [new AppError("restore.stream_source_unchecked", { reason: "clock" }), 409],
];

describe("the archive and Cloud restore routes, on the refusals they share with the bucket rebuild", () => {
  it("answers the refusals an archive restore shares with the rebuild with the same statuses", async () => {
    const seen: [string, number][] = [];
    for (const [error] of SHARED_RESTORE_REFUSALS) {
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          stageRestore: vi.fn().mockRejectedValue(error),
          requestRestart: vi.fn(),
        },
        noopLog,
      );
      const res = await postRestore(app, Uint8Array.from([1]));
      expect((await res.json()) as unknown).toMatchObject({ error: { code: error.code } });
      seen.push([error.code, res.status]);
    }
    expect(seen).toEqual(SHARED_RESTORE_REFUSALS.map(([error, status]) => [error.code, status]));
  });

  it("answers the refusals a Cloud restore shares with the rebuild with the same statuses", async () => {
    const requestId = "3728e560-fbb2-41aa-8c2b-d21f3ce1ce92";
    const pointId = "9f41b8b8-b14e-472a-8eb4-f9259b80f0d1";
    const seen: [string, number][] = [];
    for (const [error] of SHARED_RESTORE_REFUSALS) {
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          cloudRecovery: {
            binding: vi.fn(async () => ({ requestId, pointId })),
            restore: vi.fn(async (stage: (request: RestoreRequest) => Promise<void>) => {
              await stage({
                artifact: Uint8Array.from([1]),
                recoveryKey: "key",
                environment: "preproduction",
                managedCloud: { requestId, pointId },
              });
            }),
          } as unknown as SetupDeps["cloudRecovery"],
          stageRestore: vi.fn().mockRejectedValue(error),
          requestRestart: vi.fn(),
        },
        noopLog,
      );
      const res = await app.request("/setup-api/cloud-recovery/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pointId }),
      });
      expect((await res.json()) as unknown).toMatchObject({ error: { code: error.code } });
      seen.push([error.code, res.status]);
    }
    expect(seen).toEqual(SHARED_RESTORE_REFUSALS.map(([error, status]) => [error.code, status]));
  });
});

describe("POST /setup-api/restore", () => {
  it("stages the encrypted artifact under the persistent operation lease and restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-restore-operation-"));
    try {
      const stageRestore = vi.fn(async () => {});
      const requestRestart = vi.fn();
      const app = new Hono();
      const operations = createSetupOperationStore(dir);
      mountSetup(
        app,
        { environment: "preproduction", operations, stageRestore, requestRestart },
        noopLog,
      );
      const response = await postRestore(app, Uint8Array.from([1, 2, 3]));
      expect(response.status).toBe(202);
      expect(stageRestore).toHaveBeenCalledWith(
        {
          artifact: Uint8Array.from([1, 2, 3]),
          recoveryKey: "recovery-secret",
          environment: "production",
        },
        { oldBoxGone: false },
      );
      expect((await operations.read())?.phase).toBe("complete");
      await tick();
      expect(requestRestart).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an invalid target environment without staging", async () => {
    const stageRestore = vi.fn(async () => {});
    const app = new Hono();
    mountSetup(
      app,
      { environment: "preproduction", stageRestore, requestRestart: vi.fn() },
      noopLog,
    );
    const response = await postRestore(app, Uint8Array.from([1]), "dev");
    expect(response.status).toBe(400);
    expect(stageRestore).not.toHaveBeenCalled();
  });
});

async function postBucketRestore(app: Hono, body: unknown): Promise<Response> {
  return app.request("/setup-api/restore-bucket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /setup-api/restore-bucket", () => {
  it("stages the rebuild under the persistent operation lease and restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-bucket-"));
    try {
      const stageBucketRestore = vi.fn(async () => {});
      const requestRestart = vi.fn();
      const operations = createSetupOperationStore(dir);
      const app = new Hono();
      mountSetup(
        app,
        { environment: "preproduction", operations, stageBucketRestore, requestRestart },
        noopLog,
      );
      const response = await postBucketRestore(app, {
        kit: "WAITRON-RECOVERY-KIT-1:abc",
        environment: "production",
      });
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ restoreStaged: true, restarting: true });
      expect(stageBucketRestore).toHaveBeenCalledWith({
        kit: "WAITRON-RECOVERY-KIT-1:abc",
        environment: "production",
        oldBoxGone: false,
        venueConfirmed: null,
      });
      expect((await operations.read())?.phase).toBe("complete");
      await tick();
      expect(requestRestart).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers a live old box with 409 and its last change time, and accepts the confirmed retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-bucket-"));
    try {
      const stageBucketRestore = vi
        .fn()
        .mockRejectedValueOnce(
          new AppError("restore.stream_source_live", { lastChangeAt: "2026-09-23T11:58:00.000Z" }),
        )
        .mockResolvedValueOnce(undefined);
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          operations: createSetupOperationStore(dir),
          stageBucketRestore,
          requestRestart: vi.fn(),
        },
        noopLog,
      );
      const first = await postBucketRestore(app, { kit: "k", environment: "production" });
      expect(first.status).toBe(409);
      expect(await first.json()).toEqual({
        error: {
          code: "restore.stream_source_live",
          params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
        },
      });
      const second = await postBucketRestore(app, {
        kit: "k",
        environment: "production",
        oldBoxGone: true,
      });
      expect(second.status).toBe(202);
      expect(stageBucketRestore).toHaveBeenLastCalledWith({
        kit: "k",
        environment: "production",
        oldBoxGone: true,
        venueConfirmed: null,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("releases the latch after a refusal when this box keeps no setup progress", async () => {
    const stageBucketRestore = vi
      .fn()
      .mockRejectedValueOnce(new AppError("restore.stream_source_unchecked", { reason: "clock" }))
      .mockResolvedValueOnce(undefined);
    const app = new Hono();
    mountSetup(
      app,
      { environment: "preproduction", stageBucketRestore, requestRestart: vi.fn() },
      noopLog,
    );
    expect((await postBucketRestore(app, { kit: "k", environment: "production" })).status).toBe(
      409,
    );
    const retry = await postBucketRestore(app, {
      kit: "k",
      environment: "production",
      oldBoxGone: true,
    });
    expect(retry.status).toBe(202);
  });

  it.each<[string, Record<string, unknown>]>([
    ["kit", { environment: "production" }],
    ["kit", { kit: "", environment: "production" }],
    ["kit", { kit: 7, environment: "production" }],
    ["kit", { kit: "k".repeat(64 * 1024 + 1), environment: "production" }],
    ["environment", { kit: "k", environment: "dev" }],
    ["environment", { kit: "k" }],
    ["oldBoxGone", { kit: "k", environment: "production", oldBoxGone: "yes" }],
    ["venueConfirmed", { kit: "k", environment: "production", venueConfirmed: 89890001 }],
  ])("refuses a request with a bad %s without staging (%#)", async (field, body) => {
    const stageBucketRestore = vi.fn(async () => {});
    const app = new Hono();
    mountSetup(
      app,
      { environment: "preproduction", stageBucketRestore, requestRestart: vi.fn() },
      noopLog,
    );
    const res = await postBucketRestore(app, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field } },
    });
    expect(stageBucketRestore).not.toHaveBeenCalled();
    // A refused request releases the latch, so a corrected one is accepted.
    expect((await postBucketRestore(app, { kit: "k", environment: "production" })).status).toBe(
      202,
    );
  });

  it.each(["stageBucketRestore", "requestRestart"] as const)(
    "answers not ready when %s is not wired",
    async (missing) => {
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          stageBucketRestore: vi.fn(async () => {}),
          requestRestart: vi.fn(),
          [missing]: undefined,
        },
        noopLog,
      );
      const res = await postBucketRestore(app, { kit: "k", environment: "production" });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
    },
  );

  it("maps each refusal a rebuild can meet to its status", async () => {
    const cases: [AppError, number][] = [
      [new AppError("backup.stream_kit_invalid", { reason: "shape" }), 400],
      [new AppError("restore.stream_pointer_missing", {}), 422],
      [new AppError("restore.stream_pointer_unverified", { reason: "signature" }), 422],
      [new AppError("backup.stream_pointer_invalid", { reason: "not_json" }), 422],
      [new AppError("restore.stream_integrity_failed", {}), 422],
      [new AppError("restore.stream_state_missing", { nodeId: "n" }), 422],
      [new AppError("recovery.passphrase_invalid", {}), 422],
      [new AppError("backup.artifact_invalid", { reason: "tag" }), 422],
      [new AppError("backup.archive_invalid", { reason: "truncated" }), 422],
      [
        new AppError("backup.stream_request_failed", {
          operation: "get",
          key: "current.json",
          status: null,
          name: "TimedOut",
        }),
        502,
      ],
      [new AppError("backup.stream_restore_failed", { exitCode: 1, diskFull: false }), 502],
      [new AppError("restore.stream_disk_full", {}), 507],
      [
        new AppError("restore.environment_mismatch", {
          backup: "preproduction",
          target: "production",
        }),
        409,
      ],
      [new AppError("restore.schema_too_new", { module: "core", backup: 9, target: 8 }), 409],
      [
        new AppError("provisioning.database_ahead", { set: "core", unknownMigrations: ["0009"] }),
        409,
      ],
      [new AppError("restore.stream_source_live", { lastChangeAt: "2026-09-23T11:58:00Z" }), 409],
      [new AppError("restore.stream_source_unchecked", { reason: "clock" }), 409],
      [
        new AppError("restore.stream_venue_unconfirmed", {
          legalName: "L",
          taxId: "T",
          locationName: "N",
        }),
        409,
      ],
    ];
    const seen: [string, number][] = [];
    for (const [error] of cases) {
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          stageBucketRestore: vi.fn().mockRejectedValue(error),
          requestRestart: vi.fn(),
        },
        noopLog,
      );
      const res = await postBucketRestore(app, { kit: "k", environment: "production" });
      expect((await res.json()) as unknown).toMatchObject({ error: { code: error.code } });
      seen.push([error.code, res.status]);
    }
    expect(seen).toEqual(cases.map(([error, status]) => [error.code, status]));
  });

  // The owner sees whose copy it is before anything is staged.
  it("answers an unconfirmed venue with 409 and its names, and stages the retry that names its tax id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-bucket-"));
    try {
      const venue = { legalName: "Waitron SL", taxId: "89890001K", locationName: "Local" };
      const stageBucketRestore = vi
        .fn()
        .mockRejectedValueOnce(new AppError("restore.stream_venue_unconfirmed", venue))
        .mockResolvedValueOnce(undefined);
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          operations: createSetupOperationStore(dir),
          stageBucketRestore,
          requestRestart: vi.fn(),
        },
        noopLog,
      );
      const first = await postBucketRestore(app, { kit: "k", environment: "production" });
      expect(first.status).toBe(409);
      expect(await first.json()).toEqual({
        error: { code: "restore.stream_venue_unconfirmed", params: venue },
      });
      const second = await postBucketRestore(app, {
        kit: "k",
        environment: "production",
        venueConfirmed: "89890001K",
      });
      expect(second.status).toBe(202);
      expect(stageBucketRestore).toHaveBeenLastCalledWith({
        kit: "k",
        environment: "production",
        oldBoxGone: false,
        venueConfirmed: "89890001K",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The confirmation travels in a header, beside the recovery key's.
  it("passes the archive restore's old-box confirmation through, and answers its refusal with 409", async () => {
    const stageRestore = vi
      .fn()
      .mockRejectedValueOnce(
        new AppError("restore.stream_source_live", { lastChangeAt: "2026-09-23T11:58:00.000Z" }),
      )
      .mockRejectedValueOnce(new AppError("restore.stream_source_unchecked", { reason: "bucket" }))
      .mockResolvedValueOnce(undefined);
    const app = new Hono();
    mountSetup(
      app,
      { environment: "preproduction", stageRestore, requestRestart: vi.fn() },
      noopLog,
    );
    const send = (headers: Record<string, string>) =>
      app.request("/setup-api/restore", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-waitron-recovery-key": "key",
          "x-waitron-restore-environment": "production",
          ...headers,
        },
        body: Uint8Array.from([1]),
      });
    const first = await send({});
    expect(first.status).toBe(409);
    expect(await first.json()).toEqual({
      error: {
        code: "restore.stream_source_live",
        params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
      },
    });
    expect(stageRestore).toHaveBeenLastCalledWith(expect.anything(), { oldBoxGone: false });
    // A refused staging releases the latch, so the next attempt is staged. Only "1" confirms.
    const unchecked = await send({ "x-waitron-old-box-gone": "true" });
    expect(unchecked.status).toBe(409);
    expect(await unchecked.json()).toEqual({
      error: { code: "restore.stream_source_unchecked", params: { reason: "bucket" } },
    });
    expect(stageRestore).toHaveBeenCalledTimes(2);
    expect(stageRestore).toHaveBeenLastCalledWith(expect.anything(), { oldBoxGone: false });
    const confirmed = await send({ "x-waitron-old-box-gone": "1" });
    expect(confirmed.status).toBe(202);
    expect(stageRestore).toHaveBeenLastCalledWith(
      { artifact: Uint8Array.from([1]), recoveryKey: "key", environment: "production" },
      { oldBoxGone: true },
    );
  });

  it("does not replay an unconfirmed archive restore's completion for the confirmed one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-bucket-"));
    try {
      const operations = createSetupOperationStore(dir);
      const first = new Hono();
      mountSetup(
        first,
        {
          environment: "preproduction",
          operations,
          stageRestore: vi.fn(async () => {}),
          requestRestart: vi.fn(),
        },
        noopLog,
      );
      expect((await postRestore(first, Uint8Array.from([1]))).status).toBe(202);
      const hash = (await operations.read())?.requestHash;

      const restarted = new Hono();
      mountSetup(
        restarted,
        {
          environment: "preproduction",
          operations: createSetupOperationStore(dir),
          stageRestore: vi.fn(async () => {}),
          requestRestart: vi.fn(),
        },
        noopLog,
      );
      const confirmed = await restarted.request("/setup-api/restore", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-waitron-recovery-key": "recovery-secret",
          "x-waitron-restore-environment": "production",
          "x-waitron-old-box-gone": "1",
        },
        body: Uint8Array.from([1]),
      });
      expect(confirmed.status).toBe(409);
      expect(await confirmed.json()).toMatchObject({ error: { code: "setup.operation_conflict" } });
      expect((await operations.read())?.requestHash).toBe(hash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shares the setup latch with the archive restore", async () => {
    let release: () => void = () => {};
    const stageRestore = vi.fn(() => new Promise<void>((r) => (release = r)));
    const stageBucketRestore = vi.fn(async () => {});
    const app = new Hono();
    mountSetup(
      app,
      { environment: "preproduction", stageRestore, stageBucketRestore, requestRestart: vi.fn() },
      noopLog,
    );
    const archive = postRestore(app, Uint8Array.from([1]));
    await tick();
    const bucket = await postBucketRestore(app, { kit: "k", environment: "production" });
    expect(bucket.status).toBe(409);
    expect(await bucket.json()).toMatchObject({ error: { code: "setup.already_provisioning" } });
    expect(stageBucketRestore).not.toHaveBeenCalled();
    release();
    expect((await archive).status).toBe(202);
    await tick();
  });
});

describe("POST /setup-api/adopt — mirror bundle fetch + adopt + restart, sharing provision's latch", () => {
  it("persists adoption completion without retaining the break-glass secret", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-adopt-operation-"));
    try {
      const operations = createSetupOperationStore(dir);
      const first = new Hono();
      mountSetup(first, makeAdoptDeps({ operations }).deps, noopLog);
      const response = await postAdopt(first, adoptBody());
      expect(await response.json()).toMatchObject({ breakGlassSecret: BREAK_GLASS_SECRET });
      expect((await operations.read())?.data).toEqual({
        adopted: true,
        restarting: true,
      });

      const restarted = new Hono();
      const next = makeAdoptDeps({ operations: createSetupOperationStore(dir) });
      mountSetup(restarted, next.deps, noopLog);
      const replay = await postAdopt(restarted, adoptBody());
      expect(await replay.json()).toEqual({ adopted: true, restarting: true });
      expect(next.adopt).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adopts a venue: 200, passes the body through to adopt, defers the restart", async () => {
    const app = new Hono();
    const { deps, adopt, adoptRequests, requestRestart } = makeAdoptDeps();
    mountSetup(app, deps, noopLog);

    const res = await postAdopt(app, adoptBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      adopted: true,
      breakGlassSecret: BREAK_GLASS_SECRET,
      restarting: true,
    });

    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adoptRequests[0]).toEqual({ primaryUrl: PRIMARY_URL, credential: ADOPT_CREDENTIAL });

    expect(requestRestart).not.toHaveBeenCalled();
    await tick();
    expect(requestRestart).toHaveBeenCalledTimes(1);
  });

  it("surfaces the break-glass secret in the response but NEVER logs it", async () => {
    const app = new Hono();
    const { deps } = makeAdoptDeps();
    const { log, lines } = capturingLog();
    mountSetup(app, deps, log);

    const res = await postAdopt(app, adoptBody());
    expect(res.status).toBe(200);
    expect((await res.json()).breakGlassSecret).toBe(BREAK_GLASS_SECRET);
    await tick();
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(BREAK_GLASS_SECRET);
  });

  it("maps a mirror.bundle_fetch_failed from adopt to HTTP 502", async () => {
    const app = new Hono();
    const adopt = vi.fn(async () => {
      throw new AppError("mirror.bundle_fetch_failed", {});
    });
    const { deps, requestRestart } = makeAdoptDeps({ adopt });
    mountSetup(app, deps, noopLog);

    const res = await postAdopt(app, adoptBody());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "mirror.bundle_fetch_failed", params: {} },
    });
    await tick();
    expect(requestRestart).not.toHaveBeenCalled(); // a failed fetch never restarts
  });

  it("latches out a second concurrent adopt with 409 while the first is in flight", async () => {
    const app = new Hono();
    let release!: (v: { breakGlassSecret: string }) => void;
    const pending = new Promise<{ breakGlassSecret: string }>((resolve) => {
      release = resolve;
    });
    const adopt = vi.fn(() => pending);
    const { deps } = makeAdoptDeps({ adopt });
    mountSetup(app, deps, noopLog);

    const first = postAdopt(app, adoptBody());
    await tick(); // let the first request reach + set the shared latch

    const second = await postAdopt(app, adoptBody());
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: { code: "setup.already_provisioning", params: {} },
    });
    expect(adopt).toHaveBeenCalledTimes(1); // the second never reached adopt

    release({ breakGlassSecret: BREAK_GLASS_SECRET });
    expect((await first).status).toBe(200);
    await tick();
  });

  it("resets the latch after a FAILED adopt so a retry is accepted (no operation store)", async () => {
    const app = new Hono();
    const adopt = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient boom"))
      .mockResolvedValueOnce({ breakGlassSecret: BREAK_GLASS_SECRET });
    const { deps, requestRestart } = makeAdoptDeps({ adopt });
    mountSetup(app, deps, noopLog);

    const first = await postAdopt(app, adoptBody());
    expect(first.status).toBe(500); // a non-AppError adopt fault → opaque server.internal
    await tick();
    expect(requestRestart).not.toHaveBeenCalled();

    const second = await postAdopt(app, adoptBody());
    expect(second.status).toBe(200);
    await tick();
    expect(requestRestart).toHaveBeenCalledTimes(1);
  });

  it("keeps the latch SET after a SUCCESSFUL adopt — a second POST is 409 while the box restarts", async () => {
    const app = new Hono();
    const { deps, adopt } = makeAdoptDeps();
    mountSetup(app, deps, noopLog);

    const first = await postAdopt(app, adoptBody());
    expect(first.status).toBe(200);
    await tick(); // let the deferred restart fire; the latch stays set

    const second = await postAdopt(app, adoptBody());
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: { code: "setup.already_provisioning", params: {} },
    });
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  it.each([["primaryUrl"], ["credential"]] as const)(
    "rejects a body missing %s with 400 setup.request_invalid naming the field, without adopting",
    async (field) => {
      const app = new Hono();
      const { deps, adopt, requestRestart } = makeAdoptDeps();
      mountSetup(app, deps, noopLog);

      const body = adoptBody();
      delete body[field];
      const res = await postAdopt(app, body);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("setup.request_invalid");
      expect(json.error.params.field).toBe(field);
      expect(adopt).not.toHaveBeenCalled();
      await tick();
      expect(requestRestart).not.toHaveBeenCalled();
    },
  );

  // A wrong-shape login is refused at the mirror's own boundary rather than failing at the primary
  // as a 502, and the error names the field, never its value.
  it.each([
    ["credential.personId", (c: Record<string, unknown>) => delete c.personId],
    ["credential.password", (c: Record<string, unknown>) => delete c.password],
  ] as const)(
    "rejects a credential missing %s with 400 setup.request_invalid, without adopting",
    async (field, mutate) => {
      const app = new Hono();
      const { deps, adopt } = makeAdoptDeps();
      mountSetup(app, deps, noopLog);

      const cred: Record<string, unknown> = { ...ADOPT_CREDENTIAL };
      mutate(cred);
      const res = await postAdopt(app, { primaryUrl: PRIMARY_URL, credential: cred });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("setup.request_invalid");
      expect(json.error.params.field).toBe(field);
      expect(adopt).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-object credential with 400 setup.request_invalid naming 'credential'", async () => {
    const app = new Hono();
    const { deps, adopt } = makeAdoptDeps();
    mountSetup(app, deps, noopLog);

    const res = await postAdopt(app, { primaryUrl: PRIMARY_URL, credential: "1234" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("setup.request_invalid");
    expect(json.error.params.field).toBe("credential");
    expect(adopt).not.toHaveBeenCalled();
  });

  // SSRF guard: the route is UNAUTHENTICATED, so a `primaryUrl` pointing at a metadata endpoint, an
  // internal host or a non-http scheme is refused before `adopt` fetches anything.
  it.each([
    ["the cloud metadata endpoint", "http://169.254.169.254/latest/meta-data"],
    ["an https private literal IP", "https://10.0.0.5"],
    ["a private literal IP over http", "http://192.168.1.1"],
    ["a non-loopback host over plain http", "http://primary.example"],
    ["a non-http scheme", "file:///etc/passwd"],
    ["an unparseable primaryUrl", "not-a-url"],
  ])(
    "rejects %s with 400 mirror.primary_url_invalid and never reaches adopt",
    async (_label, primaryUrl) => {
      const app = new Hono();
      const { deps, adopt, requestRestart } = makeAdoptDeps();
      mountSetup(app, deps, noopLog);

      const res = await postAdopt(app, { primaryUrl, credential: ADOPT_CREDENTIAL });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("mirror.primary_url_invalid");
      // No fetch/adopt was driven, and the offending URL is never echoed back to the caller.
      expect(adopt).not.toHaveBeenCalled();
      expect(JSON.stringify(json)).not.toContain(primaryUrl);
      await tick();
      expect(requestRestart).not.toHaveBeenCalled();
    },
  );

  it("accepts a credential carrying an optional totp and adopts (200)", async () => {
    const app = new Hono();
    const { deps, adopt, adoptRequests } = makeAdoptDeps();
    mountSetup(app, deps, noopLog);

    const credential: AdoptCredential = { ...ADOPT_CREDENTIAL, totp: "123456" };
    const res = await postAdopt(app, { primaryUrl: PRIMARY_URL, credential });
    expect(res.status).toBe(200);
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adoptRequests[0]).toEqual({ primaryUrl: PRIMARY_URL, credential });
    await tick();
  });

  // Pins that provision and adopt share ONE latch, in both directions; same-route tests cannot tell
  // one shared latch from two independent ones.
  it("shares the one-shot latch across routes: provision in flight blocks adopt, and adopt blocks provision", async () => {
    // provision in flight → a concurrent adopt is refused 409
    {
      const app = new Hono();
      let release!: (v: VenueResult) => void;
      const pending = new Promise<VenueResult>((resolve) => {
        release = resolve;
      });
      const provision = vi.fn(() => pending);
      const adopt = vi.fn(async () => ({
        breakGlassSecret: BREAK_GLASS_SECRET,
      }));
      const { deps } = makeDeps({ provision, adopt });
      mountSetup(app, deps, noopLog);

      const first = postProvision(app, demoBody());
      await tick(); // the provision holds the shared latch
      const blocked = await postAdopt(app, adoptBody());
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toEqual({
        error: { code: "setup.already_provisioning", params: {} },
      });
      expect(adopt).not.toHaveBeenCalled(); // the shared latch refused it synchronously

      release(makeVenueResult());
      expect((await first).status).toBe(200);
      await tick();
    }

    // adopt in flight → a concurrent provision is refused 409 (the reverse direction)
    {
      const app = new Hono();
      let release!: (v: { breakGlassSecret: string }) => void;
      const pending = new Promise<{ breakGlassSecret: string }>((resolve) => {
        release = resolve;
      });
      const adopt = vi.fn(() => pending);
      const { deps, provision } = makeDeps({ adopt });
      mountSetup(app, deps, noopLog);

      const first = postAdopt(app, adoptBody());
      await tick(); // the adopt holds the shared latch
      const blocked = await postProvision(app, demoBody());
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toEqual({
        error: { code: "setup.already_provisioning", params: {} },
      });
      expect(provision).not.toHaveBeenCalled(); // the shared latch refused it synchronously

      release({ breakGlassSecret: BREAK_GLASS_SECRET });
      expect((await first).status).toBe(200);
      await tick();
    }
  });

  it("answers 503 setup.not_ready when the adopt dep is unwired", async () => {
    const app = new Hono();
    const { deps, adopt } = makeAdoptDeps({ adopt: undefined });
    mountSetup(app, deps, noopLog);

    const res = await postAdopt(app, adoptBody());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
    expect(adopt).not.toHaveBeenCalled();
  });

  it("answers 503 setup.not_ready when requestRestart is unwired (the other gate arm)", async () => {
    const app = new Hono();
    const { deps, adopt } = makeAdoptDeps({ requestRestart: undefined });
    mountSetup(app, deps, noopLog);

    const res = await postAdopt(app, adoptBody());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
    expect(adopt).not.toHaveBeenCalled();
  });
});

it("serves fiscal-owned venue defaults without exposing provider secrets", async () => {
  const app = new Hono();
  mountSetup(app, { environment: "preproduction" }, noopLog);
  const response = await app.request("/setup-api/venue-defaults");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    verifactu: { operationDescription: "Venta en establecimiento" },
  });
});

describe("setup routes — remaining refusals and resumption paths", () => {
  /** Starts a provision whose `provision` step waits until `release` is called, so the shared latch
   * stays set while another route is tried. */
  async function provisionInFlight(overrides: Partial<SetupDeps> = {}) {
    let release!: (v: VenueResult) => void;
    const pending = new Promise<VenueResult>((resolve) => {
      release = resolve;
    });
    const app = new Hono();
    const made = makeDeps({ provision: vi.fn(() => pending), ...overrides });
    mountSetup(app, made.deps, noopLog);
    const first = postProvision(app, demoBody());
    await tick();
    const finish = async () => {
      release(makeVenueResult());
      expect((await first).status).toBe(200);
      await tick();
    };
    return { app, finish, ...made };
  }

  const busy = { error: { code: "setup.already_provisioning", params: {} } };
  const notReady = { error: { code: "setup.not_ready", params: {} } };
  const invalid = (field: string) => ({
    error: { code: "setup.request_invalid", params: { field } },
  });

  it("marks the status of a development-mode box", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction", devMode: true }, noopLog);
    expect(await (await app.request("/setup-api/status")).json()).toEqual({
      provisioned: false,
      environment: "preproduction",
      developmentMode: true,
      needs: ["venue"],
    });
  });

  it.each([
    ["an unexpected failure", new Error("disk unavailable")],
    [
      "a refusal other than a conflicting operation",
      new AppError("setup.already_provisioning", {}),
    ],
  ])("does not report a status when reading setup progress hits %s", async (_label, failure) => {
    const app = new Hono();
    mountSetup(
      app,
      {
        environment: "preproduction",
        operations: { read: () => Promise.reject(failure), run: vi.fn() },
      },
      noopLog,
    );
    expect((await app.request("/setup-api/status")).status).toBe(500);
  });

  it.each(["admin.firstNames", "admin.lastNames"] as const)(
    "refuses a %s that is not text",
    async (field) => {
      const app = new Hono();
      const { deps, provision } = makeDeps();
      mountSetup(app, deps, noopLog);
      const body = demoBody();
      asRec(asRec(body.venue).admin)[field.slice("admin.".length)] = 42;

      const res = await postProvision(app, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(invalid(field));
      expect(provision).not.toHaveBeenCalled();
    },
  );

  it("refuses a province the country does not have", async () => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);
    const body = demoBody();
    asRec(asRec(body.venue).location).province = "Atlantis";

    const res = await postProvision(app, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(invalid("location.province"));
    expect(provision).not.toHaveBeenCalled();
  });

  it("refuses an invoice language the country does not offer", async () => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);
    const body = demoBody();
    asRec(asRec(body.venue).location).invoiceLocales = ["es-ES", "fr-FR"];

    const res = await postProvision(app, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(invalid("location.invoiceLocales"));
    expect(provision).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    [
      "a configuration-import flag that is not true or false",
      { ...demoBody(), configurationImport: "yes" },
    ],
    ["a configuration import on a demo venue", { ...demoBody(), configurationImport: true }],
    ["a configuration import on a prepared venue", { ...prepareBody(), configurationImport: true }],
  ])("refuses %s", async (_label, body) => {
    const app = new Hono();
    const { deps, provision } = makeDeps();
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(invalid("configurationImport"));
    expect(provision).not.toHaveBeenCalled();
  });

  it("carries a live venue's configuration import through and clears the staged archive once published", async () => {
    const app = new Hono();
    const clearConfiguration = vi.fn(async () => {});
    const { deps, provisionRequests, persistTrading } = makeDeps({ clearConfiguration });
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, {
      ...liveBody(),
      aeatCert: CERT,
      configurationImport: true,
    });

    expect(res.status).toBe(200);
    expect(provisionRequests[0]!.configurationImport).toBe(true);
    expect(clearConfiguration).toHaveBeenCalledOnce();
    expect(clearConfiguration.mock.invocationCallOrder[0]).toBeGreaterThan(
      persistTrading.mock.invocationCallOrder[0]!,
    );
    await tick();
  });

  it("refuses to activate a production venue when this box cannot check fiscal readiness", async () => {
    const app = new Hono();
    const { deps, provision } = makeDeps({ assertFiscalReady: undefined });
    mountSetup(app, deps, noopLog);

    const res = await postProvision(app, { ...liveBody(), aeatCert: CERT });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "setup.fiscal_test_required", params: { module: "verifactu" } },
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it("does not publish the trading configuration again when resuming after publishing began", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-api-publish-resume-"));
    const body = demoBody();
    const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    try {
      const operations = createSetupOperationStore(dir);
      await expect(
        operations.run("provision", requestHash, async (operation) => {
          await operation.advance("publishing", { result: makeVenueResult() });
          throw new Error("process stopped before the restart");
        }),
      ).rejects.toThrow("process stopped");

      const app = new Hono();
      const resumed = makeDeps({ operations });
      mountSetup(app, resumed.deps, noopLog);

      const res = await postProvision(app, body);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ provisioned: true, restarting: true });
      expect(resumed.provision).not.toHaveBeenCalled();
      expect(resumed.persistTrading).not.toHaveBeenCalled();
      expect((await operations.read())?.phase).toBe("complete");
      await tick();
      expect(resumed.requestRestart).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("POST /setup-api/fiscal-test", () => {
    const postFiscalTest = (app: Hono, body: unknown) =>
      app.request("/setup-api/fiscal-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    it("answers not ready when this box cannot run a fiscal test", async () => {
      const app = new Hono();
      mountSetup(app, makeDeps({ runFiscalTest: undefined }).deps, noopLog);

      const res = await postFiscalTest(app, { ...liveBody(), aeatCert: CERT });

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual(notReady);
    });

    it.each<[string, boolean, Record<string, unknown>]>([
      ["a demo venue", false, demoBody()],
      ["a live venue on a development box", true, liveBody()],
    ])(
      "refuses a fiscal test for %s, which would not file for real",
      async (_label, devMode, body) => {
        const runFiscalTest = vi.fn();
        const app = new Hono();
        mountSetup(app, makeDeps({ runFiscalTest, devMode }).deps, noopLog);

        const res = await postFiscalTest(app, body);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(invalid("mode"));
        expect(runFiscalTest).not.toHaveBeenCalled();
      },
    );

    it("refuses a fiscal test while a provision is in flight", async () => {
      const runFiscalTest = vi.fn();
      const { app, finish } = await provisionInFlight({ runFiscalTest });

      const res = await postFiscalTest(app, { ...liveBody(), aeatCert: CERT });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(busy);
      expect(runFiscalTest).not.toHaveBeenCalled();
      await finish();
    });

    it("allows another fiscal test once the previous one has finished", async () => {
      const runFiscalTest = vi.fn().mockResolvedValue({ status: "rejected" });
      const app = new Hono();
      mountSetup(app, makeDeps({ runFiscalTest }).deps, noopLog);
      const body = { ...liveBody(), aeatCert: CERT };

      expect((await postFiscalTest(app, body)).status).toBe(200);
      const again = await postFiscalTest(app, body);

      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ status: "rejected" });
      expect(runFiscalTest).toHaveBeenCalledTimes(2);
    });
  });

  it("leaves a failed adoption unfinished so the same request can be retried", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-adopt-retry-"));
    try {
      const operations = createSetupOperationStore(dir);
      const failing = new Hono();
      mountSetup(
        failing,
        makeAdoptDeps({
          operations,
          adopt: vi.fn(async () => {
            throw new AppError("mirror.bundle_fetch_failed", {});
          }),
        }).deps,
        noopLog,
      );
      expect((await postAdopt(failing, adoptBody())).status).toBe(502);
      expect((await operations.read())?.phase).toBe("started");

      const retry = new Hono();
      const next = makeAdoptDeps({ operations });
      mountSetup(retry, next.deps, noopLog);
      expect((await postAdopt(retry, adoptBody())).status).toBe(200);
      expect(next.adopt).toHaveBeenCalledOnce();
      expect((await operations.read())?.phase).toBe("complete");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("POST /setup-api/restore", () => {
    const restoreDeps = () => ({
      environment: "preproduction" as const,
      stageRestore: vi.fn(async () => {}),
      requestRestart: vi.fn(),
    });

    it.each(["stageRestore", "requestRestart"] as const)(
      "answers not ready when %s is not wired",
      async (missing) => {
        const deps = { ...restoreDeps(), [missing]: undefined };
        const app = new Hono();
        mountSetup(app, deps, noopLog);

        const res = await postRestore(app, Uint8Array.from([1]));

        expect(res.status).toBe(503);
        expect(await res.json()).toEqual(notReady);
      },
    );

    it("refuses a restore while a provision is in flight", async () => {
      const stageRestore = vi.fn(async () => {});
      const { app, finish } = await provisionInFlight({ stageRestore });

      const res = await postRestore(app, Uint8Array.from([1]));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(busy);
      expect(stageRestore).not.toHaveBeenCalled();
      await finish();
    });

    it.each<[string, Record<string, string>, Uint8Array]>([
      [
        "a body that is not a binary upload",
        { "content-type": "application/json" },
        Uint8Array.from([1]),
      ],
      ["no content type", { "content-type": "" }, Uint8Array.from([1])],
      [
        "a declared size over the upload limit",
        { "content-length": String(256 * 1024 * 1024 + 1) },
        Uint8Array.from([1]),
      ],
      ["an empty upload", {}, new Uint8Array(0)],
    ])("refuses %s without staging", async (_label, headers, body) => {
      const deps = restoreDeps();
      const app = new Hono();
      mountSetup(app, deps, noopLog);

      const res = await app.request("/setup-api/restore", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-waitron-recovery-key": "recovery-secret",
          "x-waitron-restore-environment": "production",
          ...headers,
        },
        body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(invalid("artifact"));
      expect(deps.stageRestore).not.toHaveBeenCalled();
      // A refused upload releases the latch, so a corrected one is accepted.
      expect((await postRestore(app, Uint8Array.from([1]))).status).toBe(202);
    });

    it("blocks provisioning while a restore is being staged", async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const app = new Hono();
      const { deps, provision } = makeDeps({ stageRestore: vi.fn(() => held) });
      mountSetup(app, deps, noopLog);

      const restoring = postRestore(app, Uint8Array.from([1]));
      await tick();
      const provisionResponse = await postProvision(app, demoBody());

      expect(provisionResponse.status).toBe(409);
      expect(await provisionResponse.json()).toEqual(busy);
      expect(provision).not.toHaveBeenCalled();
      release();
      expect((await restoring).status).toBe(202);
      await tick();
    });

    it("stages a restore directly when this box keeps no setup progress", async () => {
      const deps = restoreDeps();
      const app = new Hono();
      mountSetup(app, deps, noopLog);

      const res = await postRestore(app, Uint8Array.from([4, 5]), "preproduction");

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ restoreStaged: true, restarting: true });
      expect(deps.stageRestore).toHaveBeenCalledWith(
        {
          artifact: Uint8Array.from([4, 5]),
          recoveryKey: "recovery-secret",
          environment: "preproduction",
        },
        { oldBoxGone: false },
      );
      await tick();
      expect(deps.requestRestart).toHaveBeenCalledOnce();
    });

    it("answers a repeated restore after a restart without staging it again", async () => {
      const dir = mkdtempSync(join(tmpdir(), "waitron-setup-restore-replay-"));
      try {
        const first = new Hono();
        mountSetup(
          first,
          { ...restoreDeps(), operations: createSetupOperationStore(dir) },
          noopLog,
        );
        expect((await postRestore(first, Uint8Array.from([1, 2, 3]))).status).toBe(202);

        const next = restoreDeps();
        const restarted = new Hono();
        mountSetup(restarted, { ...next, operations: createSetupOperationStore(dir) }, noopLog);
        const replay = await postRestore(restarted, Uint8Array.from([1, 2, 3]));

        expect(replay.status).toBe(202);
        expect(await replay.json()).toEqual({ restoreStaged: true, restarting: true });
        expect(next.stageRestore).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("POST /setup-api/configuration", () => {
    it("answers not ready when this box cannot stage a configuration archive", async () => {
      const app = new Hono();
      mountSetup(app, { environment: "preproduction" }, noopLog);

      const res = await postConfiguration(app, Uint8Array.from([1]));

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual(notReady);
    });

    it("refuses to stage a configuration archive while a provision is in flight", async () => {
      const stageConfiguration = vi.fn();
      const { app, finish } = await provisionInFlight({ stageConfiguration });

      const res = await postConfiguration(app, Uint8Array.from([1]));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(busy);
      expect(stageConfiguration).not.toHaveBeenCalled();
      await finish();
    });

    it.each<[string, Record<string, string>, Uint8Array]>([
      [
        "a body that is not a binary upload",
        { "content-type": "text/plain" },
        Uint8Array.from([1]),
      ],
      [
        "a declared size over the upload limit",
        { "content-length": String(64 * 1024 * 1024 + 1) },
        Uint8Array.from([1]),
      ],
      ["an empty upload", {}, new Uint8Array(0)],
    ])("refuses %s without staging", async (_label, headers, body) => {
      const stageConfiguration = vi.fn(async () => ({
        venue: {} as never,
        counts: {},
        reconnect: [],
      }));
      const app = new Hono();
      mountSetup(app, { environment: "preproduction", stageConfiguration }, noopLog);

      const res = await app.request("/setup-api/configuration", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-waitron-export-passphrase": "a strong passphrase",
          ...headers,
        },
        body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(invalid("artifact"));
      expect(stageConfiguration).not.toHaveBeenCalled();
    });
  });
});

describe("the setup latch after a request refused before its work starts", () => {
  /** A recorded setup operation, as `createSetupOperationStore` writes it. */
  function recordOperation(dir: string, kind: string, requestHash: string): void {
    writeFileSync(
      join(dir, "setup-operation.json"),
      JSON.stringify({
        version: 1,
        id: "00000000-0000-4000-8000-000000000001",
        kind,
        requestHash,
        phase: "started",
        data: {},
        updatedAt: "2026-09-26T00:00:00.000Z",
      }),
    );
  }

  const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

  /** A POST whose body stream fails when it is read. */
  function unreadableBody(path: string): Request {
    return new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error("connection reset while reading the body"));
        },
      }),
      duplex: "half",
    } as RequestInit);
  }

  const busy = { error: { code: "setup.already_provisioning", params: {} } };

  it("provision: a request refused for another recorded request leaves the matching one free to resume it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-latch-provision-"));
    try {
      const body = demoBody();
      recordOperation(dir, "provision", sha256(JSON.stringify(body)));
      expect((await createSetupOperationStore(dir).read())?.kind).toBe("provision");
      const app = new Hono();
      const deps = makeDeps({ operations: createSetupOperationStore(dir) });
      mountSetup(app, deps.deps, noopLog);

      const other = await postProvision(app, { ...body, mode: "demo", extra: "different" });
      expect(other.status).toBe(409);
      expect(await other.json()).toMatchObject({ error: { code: "setup.operation_conflict" } });

      const matching = await postProvision(app, body);
      expect(await matching.json()).not.toEqual(busy);
      expect(matching.status).toBe(200);
      expect(deps.provision).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("provision: an unreadable recorded operation is reported again, not as setup already running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-latch-unreadable-"));
    try {
      writeFileSync(join(dir, "setup-operation.json"), "not-json");
      const app = new Hono();
      mountSetup(app, makeDeps({ operations: createSetupOperationStore(dir) }).deps, noopLog);

      for (let attempt = 0; attempt < 2; attempt++) {
        const refused = await postProvision(app, demoBody());
        expect(refused.status).toBe(409);
        expect(await refused.json()).toMatchObject({
          error: { code: "setup.operation_conflict" },
        });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("provision: a body that fails while it is read leaves the next request free", async () => {
    const app = new Hono();
    const deps = makeDeps();
    mountSetup(app, deps.deps, noopLog);

    const failed = await app.request(unreadableBody("/setup-api/provision"));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: { code: "server.internal" } });

    const next = await postProvision(app, demoBody());
    expect(await next.json()).not.toEqual(busy);
    expect(next.status).toBe(200);
  });

  it("adopt: a request refused for another recorded request leaves the matching one free to resume it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-latch-adopt-"));
    try {
      recordOperation(dir, "adopt", sha256(JSON.stringify(adoptBody())));
      expect((await createSetupOperationStore(dir).read())?.kind).toBe("adopt");
      const app = new Hono();
      const deps = makeAdoptDeps({ operations: createSetupOperationStore(dir) });
      mountSetup(app, deps.deps, noopLog);

      const other = await postAdopt(app, { ...adoptBody(), extra: "different" });
      expect(other.status).toBe(409);
      expect(await other.json()).toMatchObject({ error: { code: "setup.operation_conflict" } });

      const matching = await postAdopt(app, adoptBody());
      expect(await matching.json()).not.toEqual(busy);
      expect(matching.status).toBe(200);
      expect(deps.adopt).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adopt: a body that fails while it is read leaves the next request free", async () => {
    const app = new Hono();
    const deps = makeAdoptDeps();
    mountSetup(app, deps.deps, noopLog);

    const failed = await app.request(unreadableBody("/setup-api/adopt"));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: { code: "server.internal" } });

    const next = await postAdopt(app, adoptBody());
    expect(await next.json()).not.toEqual(busy);
    expect(next.status).toBe(200);
  });

  it.each([
    ["restore", (app: Hono) => postRestore(app, Uint8Array.from([1]))],
    [
      "restore-bucket",
      (app: Hono) => postBucketRestore(app, { kit: "k", environment: "production" }),
    ],
  ] as const)(
    "%s: a request refused for another recorded operation leaves the next one free",
    async (_route, post) => {
      const dir = mkdtempSync(join(tmpdir(), "waitron-setup-latch-restore-"));
      try {
        const app = new Hono();
        mountSetup(
          app,
          {
            environment: "preproduction",
            operations: createSetupOperationStore(dir),
            stageRestore: vi.fn(async () => {}),
            stageBucketRestore: vi.fn(async () => {}),
            requestRestart: vi.fn(),
          },
          noopLog,
        );
        recordOperation(dir, "provision", "another-request");
        expect((await createSetupOperationStore(dir).read())?.kind).toBe("provision");

        const refused = await post(app);
        expect(refused.status).toBe(409);
        expect(await refused.json()).toMatchObject({ error: { code: "setup.operation_conflict" } });

        rmSync(join(dir, "setup-operation.json"));
        expect((await post(app)).status).toBe(202);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
