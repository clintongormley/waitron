import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { putCredential } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu/src/slot.js";
import {
  authority,
  candidate,
  material,
  NOW,
  parentFixture,
} from "@waitron/fiscal-verifactu/test/certificate-diagnosis-parent-fixtures.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { SIN_DATOS_BODY } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { startDiagnosticServer } from "@waitron/fiscal-verifactu/test/certificate-diagnosis-fixtures.js";
import { endManagementSession, managementSessions, persons } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountFiscalCertificateApi } from "./fiscal-certificate-api.js";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";
import {
  diagnosisChildFixture,
  diagnosisSnapshot,
} from "./testing/certificate-diagnosis-snapshot.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let child: Awaited<ReturnType<typeof diagnosisChildFixture>> | undefined;
beforeAll(async () => {
  child = await diagnosisChildFixture();
}, 100_000);
afterAll(async () => {
  await child?.close();
});
const path = "/management-api/fiscal-certificate/diagnose";

describe("real certificate diagnosis through HTTP and the isolated module child", () => {
  it.each([
    "installed",
    "candidate",
    "http",
    "local",
    "deadline",
    "shutdown",
    "revoked",
    "permission",
    "stale",
    "expiry-opening",
    "expiry-body",
    "expiry-cleanup",
  ] as const)(
    "%s releases the exact child and preserves rows and transient write counts",
    async (mode) => {
      const f = await parentFixture(suite.db);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holdsBody = [
        "deadline",
        "shutdown",
        "revoked",
        "permission",
        "stale",
        "expiry-body",
      ].includes(mode);
      let observedClient = "";
      const server = await startDiagnosticServer(authority, (request, response) => {
        observedClient = (request.socket as TLSSocket).getPeerCertificate().fingerprint256 ?? "";
        void (holdsBody ? held : Promise.resolve()).then(() => {
          response.writeHead(mode === "http" ? 403 : 200);
          response.end(mode === "http" ? "PRIVATE RAW FAULT" : SIN_DATOS_BODY);
        });
      });
      const marker = join(child!.root, `pid-${mode}`);
      const runner = createCertificateDiagnosisRunner({
        fiscalId: "fixture",
        entry: child!.entry,
        workMs: mode === "deadline" ? 900 : 10_000,
        cleanupMs: 300,
      });
      const logs: unknown[][] = [];
      const expiring = mode.startsWith("expiry-");
      let clock = NOW;
      if (expiring) {
        await withTransaction(suite.db, async (tx) => {
          await tx
            .update(managementSessions)
            .set({ lastSeenAt: new Date(Date.now() - 29 * 60_000).toISOString() });
        });
        const lastSeenAt = suite.db.all<{ last_seen_at: string }>(
          sql`select last_seen_at from management_sessions`,
        )[0]!.last_seen_at;
        clock = new Date(Date.parse(lastSeenAt) + 30 * 60_000 - 900);
      }
      const app = new Hono();
      mountFiscalCertificateApi(
        app,
        {
          db: suite.db,
          ring: f.deps.ring,
          seat: FISCAL_SLOT.certificate!,
          nodeId: f.deps.nodeId,
          environment: "preproduction",
          filing: () => true,
          now: () => clock,
          diagnosisRunner: {
            stop: runner.stop,
            attempt: (work, signal) =>
              runner.attempt(
                (runChild, childSignal) =>
                  work(
                    (data, signal) =>
                      runChild(
                        {
                          data,
                          endpoint: server.origin,
                          ca: authority.caPem,
                          marker,
                          phase:
                            mode === "expiry-opening"
                              ? "opening"
                              : mode === "expiry-cleanup"
                                ? "cleanup"
                                : "normal",
                        },
                        signal,
                      ),
                    childSignal,
                  ),
                signal,
              ),
          },
        },
        (...args) => void logs.push(args),
      );
      const request =
        mode === "candidate" || mode === "local"
          ? {
              ...f.request,
              operation: "check",
              source: "candidate",
              ...material(candidate, "representante"),
              ...(mode === "local" ? { passphrase: "PRIVATE WRONG PASSPHRASE" } : {}),
            }
          : { ...f.request, operation: "check" };
      let expected = await diagnosisSnapshot(suite.db);
      const pending = app.request(path, {
        method: "POST",
        headers: {
          cookie: `${MANAGEMENT_COOKIE}=${f.session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
      try {
        if (["revoked", "permission", "stale"].includes(mode)) {
          await server.requestArrived;
          await withTransaction(suite.db, async (tx) => {
            if (mode === "revoked") await endManagementSession(tx, f.session.token);
            if (mode === "permission")
              await tx
                .update(persons)
                .set({ role: "supervisor" })
                .where(eq(persons.id, f.session.personId));
            if (mode === "stale")
              await putCredential(tx, f.deps.ring, {
                purpose: "fiscal.aeat",
                value: material(candidate, "representante"),
              });
          });
          expected = await diagnosisSnapshot(suite.db);
          release();
        }
        if (mode === "shutdown") {
          await server.requestArrived;
          await runner.stop();
        }
        const response = await pending;
        const answer: unknown = await response.json();
        if (mode === "shutdown") {
          expect(response.status).toBe(503);
          expect(answer).toEqual({
            error: { code: "fiscal.certificate_diagnosis_unavailable", params: {} },
          });
        } else if (expiring || mode === "revoked" || mode === "permission" || mode === "stale") {
          expect(response.status).toBe(
            expiring || mode === "revoked" ? 401 : mode === "permission" ? 403 : 409,
          );
          expect(answer).toEqual({
            error: {
              code: expiring
                ? "management_session.expired"
                : mode === "revoked"
                  ? "management_session.required"
                  : mode === "permission"
                    ? "authorization.not_permitted"
                    : "fiscal.certificate_changed",
              params: {},
            },
          });
        } else {
          expect(response.status).toBe(200);
          expect(answer).toMatchObject({
            source: mode === "candidate" || mode === "local" ? "candidate" : "installed",
            category:
              mode === "http"
                ? "http-response"
                : mode === "local"
                  ? "local-finding"
                  : mode === "deadline"
                    ? "deadline-elapsed"
                    : "query-completed",
            ...(mode === "http" ? { httpStatus: 403 } : {}),
            ...(mode === "candidate"
              ? { kind: "representante", endpointLabel: "preproduction-representante" }
              : {}),
          });
        }
        const pid = Number(await readFile(marker, "utf8"));
        expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
        if (server.requests()) await server.connectionClosed;
        expect(server.openConnections()).toBe(0);
        expect(server.requests()).toBe(mode === "local" || mode === "expiry-opening" ? 0 : 1);
        if (mode === "candidate") {
          expect(observedClient.replaceAll(":", "").toLowerCase()).toBe(
            candidate.fingerprint.replaceAll(":", "").toLowerCase(),
          );
          expect(server.bodies[0]).toContain("ConsultaFactuSistemaFacturacion");
          expect(server.bodies[0]).not.toContain("RegistroAlta");
        }
        if (mode === "expiry-cleanup")
          expect(await readFile(`${marker}.cleanup`, "utf8")).toBe("held");
        expect(await diagnosisSnapshot(suite.db)).toEqual(expected);
        expect(JSON.stringify([answer, logs])).not.toMatch(
          /PRIVATE|openedFingerprint|pfxBase64|"passphrase"/,
        );
      } finally {
        release();
        await runner.stop();
        await pending;
        await server.close();
      }
    },
    20_000,
  );
});
