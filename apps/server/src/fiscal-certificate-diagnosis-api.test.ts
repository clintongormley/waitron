import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as credentials from "@waitron/credentials";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu/src/slot.js";
import {
  parentFixture,
  rawState,
} from "@waitron/fiscal-verifactu/test/certificate-diagnosis-parent-fixtures.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { endManagementSession, managementSessions, persons } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { mountFiscalCertificateApi } from "./fiscal-certificate-api.js";
import type { CertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const path = "/management-api/fiscal-certificate/diagnose";
const secret = "PRIVATE-DIAGNOSIS-SECRET";
afterEach(() => vi.restoreAllMocks());

async function fixture(
  options: {
    filing?: boolean | (() => boolean);
    seat?: Pick<FiscalCertificateSeat, "read" | "install" | "diagnose" | "diagnoseInChild">;
    runner?: boolean;
  } = {},
) {
  const f = await parentFixture(suite.db);
  const logs: unknown[][] = [];
  let children = 0;
  let during: (() => Promise<void>) | undefined;
  const runner: CertificateDiagnosisRunner = {
    attempt: (work, signal) =>
      work(async () => {
        children++;
        await during?.();
        return {
          outcome: "completed",
          value: {
            stage: "local",
            category: "local-ready",
            kind: "sello",
            httpStatus: null,
            localFinding: null,
          },
        };
      }, signal),
    stop: async () => {},
  };
  const app = new Hono();
  mountFiscalCertificateApi(
    app,
    {
      db: suite.db,
      ring: f.deps.ring,
      seat: options.seat ?? FISCAL_SLOT.certificate!,
      nodeId: f.deps.nodeId,
      locationId: f.deps.locationId,
      environment: "preproduction",
      filing: () =>
        typeof options.filing === "function" ? options.filing() : (options.filing ?? true),
      now: () => new Date(),
      ...(options.runner === false ? {} : { diagnosisRunner: runner }),
    },
    (...args) => void logs.push(args),
  );
  const post = (body: unknown = f.request, cookie: string | null = f.session.token) =>
    app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie === null ? {} : { cookie: `${MANAGEMENT_COOKIE}=${cookie}` }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return {
    ...f,
    app,
    post,
    logs,
    children: () => children,
    during: (fn: () => Promise<void>) => {
      during = fn;
    },
  };
}

describe("authorized certificate diagnosis HTTP boundary", () => {
  it("mounts only POST, returns module evidence and leaves every row and write counter unchanged", async () => {
    const f = await fixture();
    const before = await rawState(suite.db);
    expect((await f.app.request(path)).status).toBe(404);
    const response = await f.post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      source: "installed",
      category: "local-ready",
      kind: "sello",
      endpointLabel: "preproduction-sello",
    });
    expect(f.children()).toBe(1);
    expect(await rawState(suite.db)).toEqual(before);
  });

  it("the admission authorization preserves pending change-log rows", async () => {
    const f = await fixture();
    await suite.db.withWriteLock(async () => {
      suite.db.run(
        sql`insert into change_log (id, payload) values (${"diagnosis-pending"}, ${JSON.stringify({ resources: [{ type: "venue", id: "1" }] })})`,
      );
    });
    const before = await rawState(suite.db);
    expect(before.tables.change_log).toHaveLength(1);
    const response = await f.post();
    expect(response.status).toBe(200);
    expect(await rawState(suite.db)).toEqual(before);
  });

  it.each(["no-seat", "no-child-seat", "no-runner"] as const)(
    "%s preserves ordinary route-not-found",
    async (mode) => {
      const { read, install, diagnose } = FISCAL_SLOT.certificate!;
      const f = await fixture({
        seat:
          mode === "no-seat"
            ? { read, install }
            : mode === "no-child-seat"
              ? { read, install, diagnose }
              : undefined,
        runner: mode !== "no-runner",
      });
      expect((await f.post()).status).toBe(404);
      expect(f.children()).toBe(0);
    },
  );

  it.each([
    ["missing", 401, "management_session.required"],
    ["unknown", 401, "management_session.required"],
    ["revoked", 401, "management_session.required"],
    ["expired", 401, "management_session.expired"],
    ["suspended", 403, "person.suspended"],
    ["permission", 403, "authorization.not_permitted"],
    ["not-filing", 409, "fiscal.certificate_not_used"],
    ["revision", 409, "fiscal.certificate_changed"],
  ] as const)("%s refuses without child work or session writes", async (mode, status, code) => {
    const f = await fixture({ filing: mode !== "not-filing" });
    await withTransaction(suite.db, async (tx) => {
      if (mode === "revoked") await endManagementSession(tx, f.session.token);
      if (mode === "expired")
        await tx
          .update(managementSessions)
          .set({ lastSeenAt: new Date(Date.now() - 31 * 60_000).toISOString() });
      if (mode === "suspended")
        await tx
          .update(persons)
          .set({ status: "suspended" })
          .where(eq(persons.id, f.session.personId));
      if (mode === "permission")
        await tx
          .update(persons)
          .set({ role: "supervisor" })
          .where(eq(persons.id, f.session.personId));
    });
    const before = await rawState(suite.db);
    const decrypt = vi.spyOn(credentials, "tryGetCredential");
    const response = await f.post(
      mode === "revision" ? { ...f.request, expectedRevision: "stale" } : f.request,
      mode === "missing" ? null : mode === "unknown" ? "not-a-session" : f.session.token,
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, params: {} } });
    expect(f.children()).toBe(0);
    expect(decrypt).not.toHaveBeenCalled();
    expect(await rawState(suite.db)).toEqual(before);
    expect(JSON.stringify(f.logs)).not.toContain(f.session.personId);
  });

  it.each(["{", "null", "[]", '{"source":"installed"}'])(
    "malformed request %s returns 400 without child work",
    async (body) => {
      const f = await fixture();
      const response = await f.post(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "fiscal.certificate_request_invalid" },
      });
      expect(f.children()).toBe(0);
    },
  );

  it("rejects 200001 bytes before any child work", async () => {
    const f = await fixture();
    const response = await f.post(" ".repeat(200_001));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "fiscal.certificate_too_large", params: {} },
    });
    expect(f.children()).toBe(0);
  });

  it.each(["revoked", "permission", "suspended", "filing", "expiry"] as const)(
    "%s during work releases only an authority refusal",
    async (mode) => {
      let filing = true;
      const f = await fixture({ filing: () => filing });
      f.during(async () => {
        if (mode === "filing") filing = false;
        else
          await withTransaction(suite.db, async (tx) => {
            if (mode === "revoked") await endManagementSession(tx, f.session.token);
            if (mode === "permission")
              await tx
                .update(persons)
                .set({ role: "supervisor" })
                .where(eq(persons.id, f.session.personId));
            if (mode === "suspended")
              await tx
                .update(persons)
                .set({ status: "suspended" })
                .where(eq(persons.id, f.session.personId));
            if (mode === "expiry")
              await tx
                .update(managementSessions)
                .set({ lastSeenAt: new Date(Date.now() - 31 * 60_000).toISOString() });
          });
      });
      const response = await f.post();
      expect(response.status).toBe(
        mode === "filing" ? 409 : mode === "permission" || mode === "suspended" ? 403 : 401,
      );
      expect(await response.json()).toEqual({
        error: {
          code:
            mode === "filing"
              ? "fiscal.certificate_not_used"
              : mode === "revoked"
                ? "management_session.required"
                : mode === "expiry"
                  ? "management_session.expired"
                  : mode === "suspended"
                    ? "person.suspended"
                    : "authorization.not_permitted",
          params: {},
        },
      });
      expect(f.children()).toBe(1);
    },
  );

  it.each([
    [
      () => new AppError("fiscal.certificate_diagnosis_busy", {}),
      409,
      "fiscal.certificate_diagnosis_busy",
      {},
    ],
    [
      () => new AppError("person.suspended", { personId: secret }, { reason: secret }),
      403,
      "person.suspended",
      {},
    ],
    [
      () =>
        new AppError(
          "fiscal.certificate_request_invalid",
          { field: "passphrase" },
          { reason: secret },
        ),
      400,
      "fiscal.certificate_request_invalid",
      { field: "passphrase" },
    ],
    [
      () => new AppError("fiscal.certificate_request_invalid", { field: secret }),
      400,
      "fiscal.certificate_request_invalid",
      {},
    ],
    [
      () => new AppError("management.request_invalid", { field: secret }),
      503,
      "fiscal.certificate_diagnosis_unavailable",
      {},
    ],
    [
      () => Object.assign(new Error(secret), { code: secret, cause: new Error(secret) }),
      503,
      "fiscal.certificate_diagnosis_unavailable",
      {},
    ],
    [
      () => Object.assign(new AppError("storage.disk_full", {}), { cause: new Error(secret) }),
      503,
      "fiscal.certificate_diagnosis_unavailable",
      {},
    ],
  ] as const)(
    "projects diagnostic failure case %# before logger and envelope",
    async (error, status, code, params) => {
      const f = await fixture({
        seat: {
          ...FISCAL_SLOT.certificate!,
          diagnose: async () => {
            throw error();
          },
        },
      });
      const response = await f.post();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code, params } });
      expect(JSON.stringify(f.logs)).not.toContain(secret);
      expect(f.logs).toHaveLength(1);
    },
  );

  it("accepts exactly 200000 bytes without widening the body limit", async () => {
    const f = await fixture();
    const body = JSON.stringify(f.request);
    const response = await f.post(body + " ".repeat(200_000 - Buffer.byteLength(body)));
    expect(response.status).toBe(200);
    expect(f.children()).toBe(1);
    expect(suite.db.all(sql`select 1 as alive`)).toEqual([{ alive: 1 }]);
  });

  it("a completed answer is discarded when its request has already been aborted", async () => {
    const f = await fixture();
    const abort = new AbortController();
    f.during(async () => {
      abort.abort();
    });
    const response = await f.app.request(path, {
      method: "POST",
      headers: {
        cookie: `${MANAGEMENT_COOKIE}=${f.session.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(f.request),
      signal: abort.signal,
    });
    expect(response.status).toBe(499);
    expect(await response.text()).toBe("");
    expect(f.logs).toEqual([]);
  });

  it.each(["unknown-session", "permission", "not-filing"] as const)(
    "%s still gets its authority refusal while another attempt is busy",
    async (mode) => {
      const f = await fixture();
      if (mode === "permission")
        await withTransaction(suite.db, async (tx) => {
          await tx
            .update(persons)
            .set({ role: "supervisor" })
            .where(eq(persons.id, f.session.personId));
        });
      const runner = createCertificateDiagnosisRunner({ fiscalId: "fixture" });
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const active = runner.attempt(async () => {
        await hold;
        return null;
      }, new AbortController().signal);
      const app = new Hono();
      mountFiscalCertificateApi(
        app,
        {
          ...f.deps,
          seat: FISCAL_SLOT.certificate!,
          diagnosisRunner: runner,
          filing: () => mode !== "not-filing",
          now: () => new Date(),
        },
        () => {},
      );
      const before = await rawState(suite.db);
      try {
        const response = await app.request(path, {
          method: "POST",
          headers: {
            cookie: `${MANAGEMENT_COOKIE}=${mode === "unknown-session" ? "11111111-1111-4111-8111-111111111111" : f.session.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(f.request),
        });
        expect(response.status).toBe(
          mode === "unknown-session" ? 401 : mode === "permission" ? 403 : 409,
        );
        expect(await response.json()).toEqual({
          error: {
            code:
              mode === "unknown-session"
                ? "management_session.required"
                : mode === "permission"
                  ? "authorization.not_permitted"
                  : "fiscal.certificate_not_used",
            params: {},
          },
        });
        expect(await rawState(suite.db)).toEqual(before);
      } finally {
        release();
        await active;
        await runner.stop();
      }
    },
  );
});
