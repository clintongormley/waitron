import { credentialRevision, putCredential } from "@waitron/credentials";
import { tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { managementSessions, persons } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  material,
  candidate,
  installed,
  NOW,
  INSTALLED_AT,
  parentFixture,
  rawState,
} from "../test/certificate-diagnosis-parent-fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { diagnoseCertificate } from "./certificate-diagnosis.js";
import { FISCAL_SLOT } from "./slot.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });
afterEach(() => vi.restoreAllMocks());

describe("certificate diagnosis parent", () => {
  it("refuses malformed public input without starting child work", async () => {
    const f = await parentFixture(suite.db);
    const runChild = vi.fn(f.deps.runChild);
    await expect(
      diagnoseCertificate(
        { ...f.deps, runChild },
        { ...f.request, endpoint: "https://invalid" },
        NOW,
      ),
    ).rejects.toMatchObject({
      code: "fiscal.certificate_request_invalid",
      params: { field: "body" },
    });
    expect(runChild).not.toHaveBeenCalled();
  });

  it("refuses an unconfigured taxpayer before starting native work", async () => {
    const f = await parentFixture(suite.db);
    await withTransaction(suite.db, (tx) => tx.delete(tenants));
    const runChild = vi.fn(f.deps.runChild);
    const before = await rawState(suite.db);
    await expect(
      diagnoseCertificate({ ...f.deps, runChild }, f.request, NOW),
    ).rejects.toMatchObject({
      code: "fiscal.certificate_request_invalid",
      params: { field: "body" },
    });
    expect(runChild).not.toHaveBeenCalled();
    expect(await rawState(suite.db)).toEqual(before);
  });
  it("reads the exact installed material and authorizes twice without changing any table or write counter", async () => {
    const f = await parentFixture(suite.db);
    const before = await rawState(suite.db);
    const authorize = vi.fn(f.deps.authorize);
    const runChild = vi.fn(f.deps.runChild);
    const result = await diagnoseCertificate({ ...f.deps, authorize, runChild }, f.request, NOW);
    expect(result).toEqual({
      schemaVersion: 1,
      attemptLabel: expect.stringMatching(/^[\da-f-]{36}$/),
      operation: "inspect",
      source: "installed",
      binding: { sourceGeneration: 7, expectedRevision: f.request.expectedRevision },
      environment: "preproduction",
      kind: "sello",
      endpointLabel: "preproduction-sello",
      saved: { kind: "sello", installedAt: INSTALLED_AT },
      association: "verified",
      startedAt: NOW.toISOString(),
      completedAt: expect.any(String),
      durationMs: expect.any(Number),
      stage: "complete",
      category: "local-ready",
      httpStatus: null,
      localFinding: null,
      cause: "not-established",
    });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(runChild).toHaveBeenCalledTimes(1);
    expect(runChild.mock.calls[0]![0]).toEqual({
      operation: "inspect",
      material: material(),
      taxpayer: { legalName: "Waitron SL", taxId: "89890001K" },
      timeZone: "Europe/Madrid",
      environment: "preproduction",
      startedAt: NOW.toISOString(),
    });
    expect(await rawState(suite.db)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain(installed.fingerprint);
    expect(FISCAL_SLOT.certificate?.diagnose).toBeTypeOf("function");
  });

  it("uses different candidate bytes and kind and accepts the installed file as a candidate without installing", async () => {
    const f = await parentFixture(suite.db);
    const before = await rawState(suite.db);
    const runChild = vi.fn(f.deps.runChild);
    const result = await diagnoseCertificate(
      { ...f.deps, runChild },
      {
        ...f.request,
        source: "candidate",
        ...material(candidate, "representante"),
      },
      NOW,
    );
    expect(result).toMatchObject({
      source: "candidate",
      kind: "representante",
      endpointLabel: "preproduction-representante",
      association: "not-applicable",
      category: "local-ready",
    });
    expect(runChild.mock.calls[0]![0]).toMatchObject({
      material: material(candidate, "representante"),
    });
    expect(
      await diagnoseCertificate(f.deps, { ...f.request, source: "candidate", ...material() }, NOW),
    ).toMatchObject({ category: "local-ready", association: "not-applicable" });
    expect(await rawState(suite.db)).toEqual(before);
  });

  it.each(["permission", "session", "initial-revision"] as const)(
    "refuses %s before child work or vault decryption",
    async (failure) => {
      const f = await parentFixture(suite.db);
      await withTransaction(suite.db, async (tx) => {
        await tx.run(sql`update tenant_credentials set ciphertext = x'00'`);
        if (failure === "permission")
          await tx
            .update(persons)
            .set({ role: "supervisor" })
            .where(eq(persons.id, f.session.personId));
        if (failure === "session")
          await tx.update(managementSessions).set({ endedAt: new Date().toISOString() });
      });
      const before = await rawState(suite.db);
      const runChild = vi.fn(f.deps.runChild);
      await expect(
        diagnoseCertificate({ ...f.deps, runChild }, f.request, NOW),
      ).rejects.toMatchObject({
        code:
          failure === "permission"
            ? "authorization.not_permitted"
            : failure === "session"
              ? "management_session.required"
              : "fiscal.certificate_changed",
      });
      expect(runChild).not.toHaveBeenCalled();
      expect(await rawState(suite.db)).toEqual(before);
    },
  );

  it.each(["missing", "undecryptable", "bad-shape", "bad-base64"] as const)(
    "returns sanitized %s installed evidence after final authorization",
    async (failure) => {
      const f = await parentFixture(suite.db, failure !== "missing");
      await withTransaction(suite.db, async (tx) => {
        if (failure === "undecryptable")
          await tx.run(sql`update tenant_credentials set ciphertext = x'00'`);
        if (failure === "bad-shape" || failure === "bad-base64")
          await putCredential(tx, f.deps.ring, {
            purpose: "fiscal.aeat",
            value: {
              pfxBase64: "!!!!private",
              passphrase: "secret sentinel",
              certKind: failure === "bad-shape" ? "bogus" : "sello",
            },
          });
        f.request.expectedRevision = await credentialRevision(tx, { purpose: "fiscal.aeat" });
      });
      const before = await rawState(suite.db);
      const authorize = vi.fn(f.deps.authorize);
      const runChild = vi.fn(f.deps.runChild);
      const result = await diagnoseCertificate({ ...f.deps, authorize, runChild }, f.request, NOW);
      expect(result).toMatchObject({
        category: "local-finding",
        localFinding: failure === "missing" ? "missing" : "unusable",
        kind: null,
        endpointLabel: null,
        association: "unverified",
      });
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(runChild).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(/private|sentinel|credentials\./);
      expect(await rawState(suite.db)).toEqual(before);
    },
  );

  it.each(["completed", "local-refusal", "throw", "deadline", "cancelled", "unavailable"] as const)(
    "rechecks revoked authority after %s and releases no evidence",
    async (outcome) => {
      const f = await parentFixture(suite.db);
      const runChild: typeof f.deps.runChild = async (input, signal) => {
        const value = await f.deps.runChild(input, signal);
        await withTransaction(suite.db, (tx) =>
          tx.update(persons).set({ role: "supervisor" }).where(eq(persons.id, f.session.personId)),
        );
        if (outcome === "throw") throw new Error("raw secret sentinel");
        if (outcome === "completed") return value;
        if (outcome === "local-refusal")
          return {
            outcome: "completed",
            value: { category: "local-finding", localFinding: "passphrase_wrong" },
          };
        return { outcome: "interrupted", reason: outcome, lastProgress: null };
      };
      await expect(
        diagnoseCertificate({ ...f.deps, runChild }, f.request, NOW),
      ).rejects.toMatchObject({
        code: "authorization.not_permitted",
        params: { permission: "system.manage" },
      });
    },
  );

  it("expires and aborts a held child, waits for its cleanup, then refuses evidence", async () => {
    const f = await parentFixture(suite.db);
    let settle!: () => void;
    let abortSeen!: () => void;
    const aborted = new Promise<void>((resolve) => {
      abortSeen = resolve;
    });
    const exited = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let calls = 0;
    const expiresAt = new Date(NOW.getTime() + 25).toISOString();
    let clock = NOW;
    let finished = false;
    const diagnosis = diagnoseCertificate(
      {
        ...f.deps,
        clock: () => clock,
        authorize: async () => {
          if (++calls > 1) throw new AppError("management_session.expired", {});
          return { personId: f.session.personId, expiresAt };
        },
        runChild: async (_input, signal) => {
          signal.addEventListener("abort", () => abortSeen(), { once: true });
          await exited;
          return { outcome: "interrupted", reason: "cancelled", lastProgress: null };
        },
      },
      f.request,
      NOW,
    ).finally(() => {
      finished = true;
    });
    const refusal = expect(diagnosis).rejects.toMatchObject({ code: "management_session.expired" });
    try {
      await aborted;
      clock = new Date(NOW.getTime() + 26);
      expect(finished).toBe(false);
    } finally {
      settle();
    }
    await refusal;
    expect(calls).toBe(2);
  });

  it("does not drain unrelated pending change-log rows", async () => {
    const f = await parentFixture(suite.db);
    await suite.db.withWriteLock(async () => {
      await suite.db.run(
        sql`insert into change_log (id, payload) values (${"pending-change"}, ${JSON.stringify({ resources: [{ type: "venue", id: "1" }] })})`,
      );
    });
    const before = await rawState(suite.db);
    expect(before.tables.change_log!.length).toBeGreaterThan(0);
    await expect(diagnoseCertificate(f.deps, f.request, NOW)).resolves.toMatchObject({
      category: "local-ready",
    });
    expect(await rawState(suite.db)).toEqual(before);
  });

  it("the raw write observation detects a rolled-back write even when every row is unchanged", async () => {
    await parentFixture(suite.db);
    const before = await rawState(suite.db);
    await expect(
      suite.db.withWriteLock(async () => {
        await suite.db.run(sql`update tenants set legal_name = 'Discarded change' where id = 1`);
        throw new Error("rollback control");
      }),
    ).rejects.toThrow("rollback control");
    const after = await rawState(suite.db);
    expect(after.tables).toEqual(before.tables);
    expect(after.writes).toBeGreaterThan(before.writes);
  });

  it.each([
    ["deadline", "deadline-elapsed"],
    ["cancelled", "cancelled"],
    ["unavailable", "http-response"],
  ] as const)(
    "keeps safe HTTP progress after %s without changing persistent state",
    async (reason, category) => {
      const f = await parentFixture(suite.db);
      const before = await rawState(suite.db);
      const result = await diagnoseCertificate(
        {
          ...f.deps,
          runChild: async () => ({
            outcome: "interrupted",
            reason,
            lastProgress: {
              stage: "response",
              category: "http-response",
              httpStatus: 403,
              raw: "PRIVATE SOAP SENTINEL",
            },
          }),
        },
        f.request,
        NOW,
      );
      expect(result).toMatchObject({
        stage: "response",
        category,
        httpStatus: 403,
        kind: null,
        association: "unverified",
        cause: "not-established",
      });
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
      expect(await rawState(suite.db)).toEqual(before);
    },
  );

  it.each(["local", "throw", "no-progress", "malformed", "aborted"] as const)(
    "writes nothing after %s child outcome",
    async (outcome) => {
      const f = await parentFixture(suite.db);
      const before = await rawState(suite.db);
      const result = await diagnoseCertificate(
        {
          ...f.deps,
          runChild: async (input, signal) => {
            if (outcome === "throw") throw new Error("PRIVATE RAW ERROR");
            if (outcome === "no-progress")
              return { outcome: "interrupted", reason: "deadline", lastProgress: null };
            if (outcome === "malformed")
              return { outcome: "completed", value: { stage: "PRIVATE", httpStatus: "PRIVATE" } };
            if (outcome === "aborted") f.controller.abort();
            return f.deps.runChild(
              { ...(input as object), material: { ...material(), passphrase: "WRONG SECRET" } },
              signal,
            );
          },
        },
        f.request,
        NOW,
      );
      expect(result).toMatchObject({
        category:
          outcome === "local"
            ? "local-finding"
            : outcome === "aborted"
              ? "cancelled"
              : outcome === "no-progress"
                ? "deadline-elapsed"
                : "unknown",
      });
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET/);
      expect(await rawState(suite.db)).toEqual(before);
    },
  );

  it("refuses evidence after the authorizer changes account", async () => {
    const f = await parentFixture(suite.db);
    let calls = 0;
    await expect(
      diagnoseCertificate(
        {
          ...f.deps,
          authorize: async (tx) => ({
            ...(await f.deps.authorize(tx)),
            personId: ++calls === 1 ? f.session.personId : "other-account",
          }),
        },
        f.request,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "management_session.required", params: {} });
  });

  it("does not expose a child kind that differs from the selected stored kind", async () => {
    const f = await parentFixture(suite.db);
    const result = await diagnoseCertificate(
      {
        ...f.deps,
        runChild: async () => ({
          outcome: "completed",
          value: {
            openedFingerprint: installed.fingerprint,
            kind: "representante",
            completedAt: NOW.toISOString(),
            category: "local-ready",
            stage: "complete",
            localFinding: null,
            httpStatus: null,
          },
        }),
      },
      f.request,
      NOW,
    );
    expect(result).toMatchObject({
      kind: null,
      endpointLabel: null,
      category: "unknown",
      association: "unverified",
    });
  });

  it("refuses a malformed final session expiry instead of releasing evidence", async () => {
    const f = await parentFixture(suite.db);
    let calls = 0;
    await expect(
      diagnoseCertificate(
        {
          ...f.deps,
          authorize: async (tx) => ({
            ...(await f.deps.authorize(tx)),
            ...(++calls === 2 ? { expiresAt: "not-a-time" } : {}),
          }),
        },
        f.request,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "management_session.expired", params: {} });
  });

  it("retains the HTTP observation when the host budget expires, without calling it operator cancellation", async () => {
    const f = await parentFixture(suite.db);
    const result = await diagnoseCertificate(
      {
        ...f.deps,
        runChild: async () => {
          f.controller.abort("deadline");
          return {
            outcome: "interrupted",
            reason: "deadline",
            lastProgress: { stage: "response", category: "http-response", httpStatus: 403 },
          };
        },
      },
      f.request,
      NOW,
    );
    expect(result).toMatchObject({
      category: "deadline-elapsed",
      stage: "response",
      httpStatus: 403,
    });
  });

  it.each(["expired", "invalid"] as const)(
    "refuses %s admission expiry before native work",
    async (expiry) => {
      const f = await parentFixture(suite.db);
      const runChild = vi.fn(f.deps.runChild);
      await expect(
        diagnoseCertificate(
          {
            ...f.deps,
            runChild,
            authorize: async () => ({
              personId: f.session.personId,
              expiresAt: expiry === "expired" ? NOW.toISOString() : "invalid",
            }),
          },
          f.request,
          NOW,
        ),
      ).rejects.toMatchObject({ code: "management_session.expired", params: {} });
      expect(runChild).not.toHaveBeenCalled();
    },
  );

  it.each(["deadline", "stopped"] as const)(
    "dispatches no child after a prior %s signal",
    async (reason) => {
      const f = await parentFixture(suite.db);
      const runChild = vi.fn(f.deps.runChild);
      f.controller.abort(reason);
      const before = await rawState(suite.db);
      await expect(
        diagnoseCertificate({ ...f.deps, runChild }, f.request, NOW),
      ).resolves.toMatchObject({
        category: reason === "deadline" ? "deadline-elapsed" : "cancelled",
      });
      expect(runChild).not.toHaveBeenCalled();
      expect(await rawState(suite.db)).toEqual(before);
    },
  );

  it("does not echo malformed cancellation progress", async () => {
    const f = await parentFixture(suite.db);
    const result = await diagnoseCertificate(
      {
        ...f.deps,
        runChild: async () => ({
          outcome: "interrupted",
          reason: "cancelled",
          lastProgress: { stage: "PRIVATE", category: "PRIVATE", httpStatus: "SECRET" },
        }),
      },
      f.request,
      NOW,
    );
    expect(result).toMatchObject({ category: "cancelled", httpStatus: null, stage: "local" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET/);
  });
});
