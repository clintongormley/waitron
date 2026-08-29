import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { lagFor } from "@waitron/sync";

// Real Postgres, and specifically a REAL sync_tailer member (sync_applier), not the owner: FORCE RLS
// on sync_log only bites a non-superuser, so this is the one connection shape that can show the
// withTenant wrap is load-bearing. Owner reads (box-status.replication.test.ts) bypass RLS and can't.
const ORIGIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const suite = useTemplateDb({ template: "manifest" });

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(75_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function setupTenant(): Promise<string> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Deli Test SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
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
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );
  // One sync_log row at seq 10 for this tenant; one cursor at 3 → lag 7 under the tenant, 0 without.
  await suite.admin.execute(
    sql`insert into sync_log (seq, origin_id, table_name, op, tenant_id, row_image)
        overriding system value
        values (10, ${ORIGIN}::uuid, 'products', 'insert', ${venue.tenantId}::uuid, '{}'::jsonb)`,
  );
  await suite.admin.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, last_applied_seq, alive, lane)
        values ('s1', ${ORIGIN}::uuid, 3, true, 'ordered')`,
  );
  return venue.tenantId;
}

describe("box-status replication reader through a real sync_tailer pool", () => {
  let tailer: Database | undefined;
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await setupTenant();
    tailer = await suite.pg.connectAs("sync_applier", "ap"); // app_user + sync_tailer member
  });

  afterAll(async () => {
    if (tailer !== undefined) await tailer.close(); // guarded teardown (CLAUDE.md §4)
  });

  it("withTenant-wrapped lagFor sees the tenant's real lag", async () => {
    const lags = await withTenant(tailer!, tenantId, (tx) => lagFor(tx));
    expect(lags[0]?.lag).toBe(7n);
  });

  it("bare lagFor (no tenant context) reads a false-healthy lag 0 — the wrap is load-bearing", async () => {
    const lags = await lagFor(tailer!);
    for (const l of lags) expect(l.lag).toBe(0n);
  });
});
