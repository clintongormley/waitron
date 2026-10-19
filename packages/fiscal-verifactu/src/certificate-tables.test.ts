import {
  captureError,
  checkFailed,
  constraintTarget,
  isUniqueViolation,
  newId,
  triggerRaised,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";

const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

const NODE = "node-a";
const PERSON = "person-a";

function insertInstall(
  db: Database,
  fields: {
    id?: string;
    source: string;
    personId: string | null;
    checkedEndpoint: string | null;
    checkedAt: string | null;
  },
) {
  const id = fields.id ?? newId();
  return withTransaction(db, (tx) =>
    tx.execute(sql`
      insert into fiscal_certificate_installs (
        id, node_id, installed_at, source, person_id, kind, fingerprint, organisation, tax_id,
        issuer, valid_from, valid_until, checked_endpoint, checked_at
      ) values (
        ${id}, ${NODE}, '2026-10-18T10:00:00.000Z', ${fields.source}, ${fields.personId},
        'sello', ${"AB".repeat(32)}, 'Waitron SL', 'B12345678', 'AC FNMT Usuarios',
        '2026-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z', ${fields.checkedEndpoint},
        ${fields.checkedAt}
      )
    `),
  ).then(() => id);
}

function insertReminder(db: Database, installId: string, stage = "warning") {
  return withTransaction(db, (tx) =>
    tx.execute(sql`
      insert into fiscal_certificate_reminders (
        id, node_id, install_id, stage, person_id, status, claimed_at, reported_at
      ) values (
        ${newId()}, ${NODE}, ${installId}, ${stage}, ${PERSON}, 'claimed',
        '2026-10-18T10:00:00.000Z', null
      )
    `),
  );
}

const SETUP = { source: "setup", personId: null, checkedEndpoint: null, checkedAt: null };
const DASHBOARD = {
  source: "dashboard",
  personId: PERSON,
  checkedEndpoint: "https://prewww1.aeat.es/",
  checkedAt: "2026-10-18T10:00:00.000Z",
};

describe("fiscal_certificate_installs and fiscal_certificate_reminders", () => {
  it("accepts a setup install with no person, endpoint or check time", async () => {
    const id = await insertInstall(pg.db, SETUP);
    const { rows } = await pg.db.execute<{ id: string; person_id: string | null }>(
      sql`select id, person_id from fiscal_certificate_installs`,
    );
    expect(rows).toEqual([{ id, person_id: null }]);
  });

  it("refuses an UPDATE and a DELETE of an install row", async () => {
    const id = await insertInstall(pg.db, SETUP);
    const update = await captureError(async () =>
      pg.db.execute(sql`update fiscal_certificate_installs set fingerprint = 'changed'`),
    );
    expect(triggerRaised(update, "fiscal_certificate_installs is append-only")).toBe(true);
    const remove = await captureError(async () =>
      pg.db.execute(sql`delete from fiscal_certificate_installs`),
    );
    expect(triggerRaised(remove, "fiscal_certificate_installs is append-only")).toBe(true);
    const { rows } = await pg.db.execute<{ id: string; fingerprint: string }>(
      sql`select id, fingerprint from fiscal_certificate_installs`,
    );
    expect(rows).toEqual([{ id, fingerprint: "AB".repeat(32) }]);
  });

  it.each([
    ["person", { personId: null }],
    ["check time", { checkedAt: null }],
    ["checked endpoint", { checkedEndpoint: null }],
  ] as const)("refuses a dashboard install with no %s", async (_, missing) => {
    const error = await captureError(() => insertInstall(pg.db, { ...DASHBOARD, ...missing }));
    expect(checkFailed(error, "fiscal_certificate_installs_dashboard_ck")).toBe(true);
    const { rows } = await pg.db.execute(sql`select id from fiscal_certificate_installs`);
    expect(rows).toEqual([]);
  });

  it("accepts a dashboard install with a person, endpoint and check time", async () => {
    const id = await insertInstall(pg.db, DASHBOARD);
    const { rows } = await pg.db.execute(sql`select id, source from fiscal_certificate_installs`);
    expect(rows).toEqual([{ id, source: "dashboard" }]);
  });

  it("refuses a second reminder for the same install, stage and person", async () => {
    const installId = await insertInstall(pg.db, SETUP);
    await insertReminder(pg.db, installId);
    await insertReminder(pg.db, installId, "urgent");
    const error = await captureError(() => insertReminder(pg.db, installId));
    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toEqual({
      table: "fiscal_certificate_reminders",
      columns: ["install_id", "stage", "person_id"],
    });
    const { rows } = await pg.db.execute(
      sql`select stage from fiscal_certificate_reminders order by stage`,
    );
    expect(rows).toEqual([{ stage: "urgent" }, { stage: "warning" }]);
  });
});
