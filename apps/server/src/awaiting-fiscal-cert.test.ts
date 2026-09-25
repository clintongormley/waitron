/**
 * A primary with no `fiscal.aeat` certificate: the drain must not crash, must not submit, must leave
 * the chain untouched, and must surface the awaiting-certificate state on box-status, logged once.
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
// Seeds a due `envios` row and its registro WITHOUT a `fiscal.aeat` credential.
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { createHealthState } from "./health.js";
import { createLogger } from "./logger.js";
import { mountBoxStatusApi } from "./box-status.js";
import { mountManagementApi } from "./management-api.js";
import { runPass, DRAIN_DUTY } from "./pass.js";

const NOW = new Date("2026-07-26T09:00:00Z");
const PASSWORD = "correct horse";
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

/** Through the table, not raw SQL: `persons.id` and `persons.created_at` are `$defaultFn`
 * generators, which a raw insert never reaches. */
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

/** Box-status reads the same awaiting-cert holder the fiscal pass writes, as in boot.ts. */
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
      readStream: () => ({ state: "off" }),
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

// Through the table, not raw SQL: `incidencia` is a `flag` column, and a raw read answers 0/1.
async function readEnvio(
  registroId: string,
): Promise<{ estado: string; intentos: number; incidencia: boolean }> {
  const rows = await db
    .select({ estado: envios.estado, intentos: envios.intentos, incidencia: envios.incidencia })
    .from(envios)
    .where(eq(envios.registroId, registroId));
  return rows[0]!;
}

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

    // The real regime drain, which reads `fiscal.aeat` from the vault.
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

    // A missing cert is a skip, not a failure.
    const drainReport = report.duties.find((entry) => entry.duty === DRAIN_DUTY)!;
    expect(drainReport.ok).toBe(true);
    expect(drainReport.skipped).toBe(1);

    expect(awaitingCert.current).toBe(true);
    expect(lines.filter((line) => line.includes("fiscal.awaiting_certificate"))).toHaveLength(1);
    expect(
      lines.some(
        (line) => line.includes("drain.tenant_skipped") && line.includes("credentials.missing"),
      ),
    ).toBe(true);

    expect(await readEnvio(registroId)).toEqual({
      estado: "pendiente",
      intentos: 0,
      incidencia: false,
    });
    expect(await readRegistro(registroId)).toEqual(registroBefore);

    const app = buildApp(seeded.nodeId, awaitingCert);
    const cookie = await login(app);
    const res = await app.request("/api/box/status", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.awaitingFiscalCertificate).toBe(true);
  });
});
