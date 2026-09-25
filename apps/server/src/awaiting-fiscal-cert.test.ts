/**
 * A promoted primary that sells and chains locally but has no `fiscal.aeat` certificate. The
 * cert-distribution slice has not landed, so the running fiscal pass skips filing — the drain must
 * NOT crash, must NOT submit, must leave local chaining untouched, and must surface the "awaiting
 * fiscal certificate" state on box-status (once in the log, then quiet).
 *
 * ## What this suite does not check
 *
 * SQLite has no roles, and every call below runs on the one handle, so nothing here checks
 * that the deployment role can reach the vault and the fiscal tables.
 *
 * ## This suite is RED, and the reason is a FIXTURE in another package
 *
 * `seedPendingEnvios` reaches `seedTenantWithSif` (`packages/fiscal-verifactu/test/fixtures.ts:275`),
 * which raw-inserts `tenants` naming four columns. `tenants.created_at` is a NOT NULL `$defaultFn`
 * that a raw insert never reaches, so the insert is refused. Measured 2026-09-22, running this file
 * alone: `Error: NOT NULL constraint failed: tenants.created_at`, thrown from that line. The same
 * file still carries `::jsonb`, `array[...]` and `now()` further down, so that refusal is the FIRST
 * of several rather than the only one.
 *
 * Nothing here is edited around it: the fixture belongs to `packages/fiscal-verifactu`, whose own
 * conversion is unfinished on this branch (`docs/handoffs/2026-09-21-f1-the-flip.md`), and inlining
 * a seed here would leave the real fixture broken and this suite testing a private copy.
 */
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withTransaction, type Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "@waitron/credentials";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { envios, FISCAL_SLOT } from "@waitron/fiscal-verifactu";
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
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const ring = loadKeyRing(KEY_ENV);

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

/** Insert a manager (with a dashboard login email) into a seeded tenant so the box-status route's
 * `authorizeManager("system.manage")` gate resolves.
 *
 * Seeded through the table definition rather than as raw SQL, the change
 * `apps/server/src/testing/fiscal-fixtures.ts` took: `persons.id` and `persons.created_at` are
 * `$defaultFn` generators on this engine, which a raw insert never reaches while both columns are
 * NOT NULL. */
async function seedManager(): Promise<void> {
  await withTransaction(db, async (tx) => {
    await tx.insert(persons).values({
      displayName: "The Manager",
      email: MANAGER_EMAIL,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword(PASSWORD),
      role: "manager",
    });
  });
}

/** A Hono app carrying the management API (for its login route) and the box-status route, both wired to
 * the SAME awaiting-cert holder the fiscal pass writes — exactly boot.ts's shared-holder wiring. */
function buildApp(nodeId: string, awaitingCert: { current: boolean }): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db,
      cfg: { nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    () => {},
  );
  mountBoxStatusApi(
    app,
    {
      db,
      cfg: { nodeId },
      environment: "production",
      health: createHealthState(NOW),
      now: () => NOW,
      tlsCertPath: undefined,
      readBackup: undefined,
      readStream: undefined,
      readMode: () => "primary",
      readSingletonRole: () => "primary",
      readAwaitingFiscalCertificate: () => awaitingCert.current,
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

// Read through the TABLE, not raw SQL: `incidencia` is a `flag` column and the boolean read mapping
// that helper carries (`packages/db/src/schema/columns.ts`) belongs to a drizzle select over the
// column — a raw statement goes around it and this engine answers 0/1.
async function readEnvio(
  registroId: string,
): Promise<{ estado: string; intentos: number; incidencia: boolean }> {
  const rows = await db
    .select({ estado: envios.estado, intentos: envios.intentos, incidencia: envios.incidencia })
    .from(envios)
    .where(eq(envios.registroId, registroId));
  return rows[0]!;
}

/** The chain-bearing columns of a registro — what a submit would never touch and a chaining write
 * would. */
async function readRegistro(
  registroId: string,
): Promise<{ secuencia: number; huella: string; num_serie_factura: string }> {
  const rows = await db.execute<{
    secuencia: number;
    huella: string;
    num_serie_factura: string;
  }>(
    sql`select secuencia, huella, num_serie_factura from registros_facturacion where id = ${registroId}`,
  );
  return rows.rows[0]!;
}

describe("promoted primary awaiting the fiscal certificate", () => {
  it("surfaces awaiting-cert on box-status, does not crash the drain, does not submit, leaves the chain untouched", async () => {
    // A due registro + `envios` row, with NO `fiscal.aeat` credential sealed for the tenant.
    const seeded = await seedPendingEnvios(db, { count: 1 });
    await seedManager();
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
            { db, ring, environment: "production", skipRetryMs: 300_000, log },
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

    // The drain did NOT crash: a missing cert is contained as a skip, so the duty is `ok` and the
    // pass is counted as skipped (so `/health` still sees the unmet obligation).
    const drainReport = report.duties.find((entry) => entry.duty === DRAIN_DUTY)!;
    expect(drainReport.ok).toBe(true);
    expect(drainReport.skipped).toBe(1);

    // The awaiting-cert state is explicit: the flag is set and `fiscal.awaiting_certificate` is logged
    // exactly ONCE (the edge-triggered "log once" surface), alongside the per-pass drain.tenant_skipped
    // trace that records why the pass was skipped.
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
    // reached `drainDue`, and chaining happens on the sale path, not here).
    expect(await readRegistro(registroId)).toEqual(registroBefore);

    // box-status surfaces the flag to an authenticated manager — the operator-visible signal.
    const app = buildApp(seeded.nodeId, awaitingCert);
    const cookie = await login(app);
    const res = await app.request("/api/box/status", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.awaitingFiscalCertificate).toBe(true);
  });
});
