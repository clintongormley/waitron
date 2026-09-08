// Real PostgreSQL: a promoted primary that sells and chains locally but has no `fiscal.aeat`
// certificate. The cert-distribution slice has not landed, so the running fiscal pass skips filing —
// the drain must NOT crash, must NOT submit, must leave local chaining untouched, and must surface
// the "awaiting fiscal certificate" state on box-status (once in the log, then quiet).
//
// The drain runs as the non-superuser deployment role (`server_pass_probe`, an `app_user` member
// created cluster-wide by apps/server's globalSetup) — the credential read + fiscal-table SELECTs are
// exercised through the grants a real box runs under, not a superuser that sees everything (CLAUDE.md
// §4). The `getCredential` seam returns nothing for a tenant with no `fiscal.aeat` vault row, so the
// regime's `resolveClient` throws `credentials.missing`, which `drain` contains as a per-tenant skip.
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing } from "@waitron/credentials";
import { hashPassword, hashPin } from "@waitron/identity";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
// The same test-only entry point the regime's own drain suites (and boot.promote.test.ts) use to seed
// a due `envios` row + its registro/SIF — but WITHOUT the accompanying `fiscal.aeat` credential, which
// is the whole point of this suite.
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { createHealthState } from "./health.js";
import { createLogger } from "./logger.js";
import { mountBoxStatusApi } from "./box-status.js";
import { mountManagementApi } from "./management-api.js";
import { runPass, DRAIN_DUTY } from "./pass.js";

const NOW = new Date("2026-07-26T09:00:00Z");
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the seeded manager's dashboard password.
const MANAGER_EMAIL = "manager@awaiting-cert.test";
const PROBE_ROLE = "server_pass_probe";
const PROBE_PASSWORD = "probe";
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const ring = loadKeyRing(KEY_ENV);

const suite = useTemplateDb({ template: "manifest" });

let probe: Database;
beforeAll(async () => {
  probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
});
afterAll(async () => {
  if (probe !== undefined) await probe.close();
});

/** Insert a manager (with a dashboard login email) into a seeded tenant so the box-status route's
 * `authorizeManager("till.configure")` gate resolves — `app_user` holds INSERT on `persons`. */
async function seedManager(tenantId: string): Promise<void> {
  await withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    await tx.execute(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (${tenantId}, 'The Manager', ${MANAGER_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')`);
  });
}

/** A Hono app carrying the management API (for its login route) and the box-status route, both wired to
 * the SAME awaiting-cert holder the fiscal pass writes — exactly boot.ts's shared-holder wiring. */
function buildApp(tenantId: string, nodeId: string, awaitingCert: { current: boolean }): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId, nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    () => {},
  );
  mountBoxStatusApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId, nodeId },
      environment: "production",
      health: createHealthState(NOW),
      now: () => NOW,
      tlsCertPath: undefined,
      readReplicationLag: undefined,
      readDisposal: undefined,
      readBackup: undefined,
      readConfigConflicts: undefined,
      readMode: () => "primary",
      readSingletonRole: () => "primary",
      readAwaitingFiscalCertificate: () => awaitingCert.current,
      readFiscalCertificate: () => Promise.resolve("none"),
    },
    () => {},
  );
  return app;
}

async function login(app: Hono): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function readEnvio(
  registroId: string,
): Promise<{ estado: string; intentos: number; incidencia: boolean }> {
  const rows = await suite.admin.execute<{ estado: string; intentos: number; incidencia: boolean }>(
    sql`select estado, intentos, incidencia from envios where registro_id = ${registroId}`,
  );
  return rows.rows[0]!;
}

/** The chain-bearing columns of a registro — what a submit would never touch and a chaining write
 * would. Read via superuser (a read, not the path under test). */
async function readRegistro(
  registroId: string,
): Promise<{ secuencia: number; huella: string; num_serie_factura: string }> {
  const rows = await suite.admin.execute<{
    secuencia: number;
    huella: string;
    num_serie_factura: string;
  }>(
    sql`select secuencia, huella, num_serie_factura from registros_facturacion where id = ${registroId}`,
  );
  return rows.rows[0]!;
}

describe("promoted primary awaiting the fiscal certificate (real postgres)", () => {
  it("surfaces awaiting-cert on box-status, does not crash the drain, does not submit, leaves the chain untouched", async () => {
    // A due registro + `envios` row, with NO `fiscal.aeat` credential sealed for the tenant.
    const seeded = await seedPendingEnvios(suite.admin, { count: 1 });
    await seedManager(seeded.tenantId);
    const registroId = seeded.registroIds[0]!;
    const registroBefore = await readRegistro(registroId);

    const awaitingCert = { current: false };
    const lines: string[] = [];
    const log = createLogger(
      (line) => lines.push(line),
      () => NOW,
    );

    // The fiscal pass as boot.ts wires it: the REAL regime drain (which builds its own mTLS resolver
    // and reads `fiscal.aeat` from the vault), a trivial reconcile, and the shared awaiting-cert cell.
    const report = await runPass(
      {
        drain: (now) =>
          FISCAL_SLOT.drain(
            { db: probe, ring, environment: "production", skipRetryMs: 300_000, log },
            now,
          ),
        reconcile: () =>
          Promise.resolve({ ran: [], deferred: 0, beyondHorizon: 0, skipped: [], nextDueAt: null }),
        awaitingCert,
        monotonicMs: () => performance.now(),
        log,
      },
      NOW,
    );

    // The drain did NOT crash: a missing cert is contained as a per-tenant skip, so the duty is `ok`
    // and its one due tenant is counted as skipped (so `/health` still sees the unmet obligation).
    const drainReport = report.duties.find((entry) => entry.duty === DRAIN_DUTY)!;
    expect(drainReport.ok).toBe(true);
    expect(drainReport.skipped).toBe(1);

    // The awaiting-cert state is explicit: the flag is set and `fiscal.awaiting_certificate` is logged
    // exactly ONCE (the edge-triggered "log once" surface), alongside the per-pass drain.tenant_skipped
    // trace that records which tenant was skipped and why.
    expect(awaitingCert.current).toBe(true);
    expect(lines.filter((line) => line.includes("fiscal.awaiting_certificate"))).toHaveLength(1);
    expect(
      lines.some(
        (line) => line.includes("drain.tenant_skipped") && line.includes("credentials.missing"),
      ),
    ).toBe(true);

    // Nothing was submitted: the envío is untouched — still pendiente, never attempted.
    expect(await readEnvio(registroId)).toEqual({
      estado: "pendiente",
      intentos: 0,
      incidencia: false,
    });
    // Local chaining is untouched: the registro's chain columns are exactly as seeded (the drain never
    // reached `drainTenant`, and chaining happens on the sale path, not here).
    expect(await readRegistro(registroId)).toEqual(registroBefore);

    // box-status surfaces the flag to an authenticated manager — the operator-visible signal.
    const app = buildApp(seeded.tenantId, seeded.nodeId, awaitingCert);
    const cookie = await login(app);
    const res = await app.request("/api/box/status", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.awaitingFiscalCertificate).toBe(true);
  });
});
