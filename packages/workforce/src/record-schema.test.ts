import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, newId, captureError, engineErrorMessage } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { locationId as brandLocationId } from "@waitron/shared";
import { seedLocation, seedPerson } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
let personId: string, otherPersonId: string, locationId: string, nodeId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  personId = await seedPerson(suite.db);
  otherPersonId = await seedPerson(suite.db, "Other");
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
});
interface Shape {
  kind: string;
  recorder: string | null;
  author: string | null;
  direction: string | null;
  missing: string | null;
  target: string | null;
  response: string | null;
  closure: string | null;
  status: string | null;
  reason: string | null;
  actor: string | null;
  subject: string;
}
function shape(over: Partial<Shape> = {}): Shape {
  return {
    kind: "in",
    recorder: personId,
    author: null,
    direction: null,
    missing: null,
    target: null,
    response: null,
    closure: null,
    status: null,
    reason: null,
    actor: null,
    subject: personId,
    ...over,
  };
}
async function insert(s: Shape, sequence = 1) {
  const id = newId();
  await suite.db.execute(sql`insert into time_entries (
 id, person_id, location_id, node_id, entry_kind, event_at, recorded_at, event_offset_minutes,
 recorded_by_person_id, captured_by_source, author_kind, correction_direction, missing_entry_kind,
 responds_to_entry_id, pay_period_closure_id, corrects_entry_id, correction_status, correction_reason,
 correction_actor_id, entry_hash, sequence_no, is_first_entry
 ) values (${id}, ${s.subject}, ${locationId}, ${nodeId}, ${s.kind}, '2026-01-05T09:00:00.000Z',
 '2026-01-05T09:00:00.000Z', 0, ${s.recorder}, 'dashboard', ${s.author}, ${s.direction}, ${s.missing},
 ${s.response}, ${s.closure}, ${s.target}, ${s.status}, ${s.reason}, ${s.actor}, ${"A".repeat(64)}, ${sequence}, 1)`);
  return id;
}
describe("record shape constraints", () => {
  it("admits a pending missing clock-out with a reason and accountable worker", async () => {
    const id = await insert(
      shape({
        kind: "correction",
        author: "worker",
        direction: "worker_request",
        missing: "out",
        status: "requested",
        reason: "Forgot",
        actor: personId,
      }),
    );
    expect(
      suite.db.execute(sql`select id, missing_entry_kind, corrects_entry_id from time_entries`)
        .rows,
    ).toEqual([{ id, missing_entry_kind: "out", corrects_entry_id: null }]);
  });
  it.each([
    ["null human recorder", { recorder: null }, "time_entries_author_ck"],
    ["automatic with human recorder", { author: "automatic" }, "time_entries_author_ck"],
    ["unknown author", { author: "system" }, "time_entries_author_kind_ck"],
    ["unknown direction", { direction: "any" }, "time_entries_correction_direction_ck"],
    ["unknown missing kind", { missing: "any" }, "time_entries_missing_entry_kind_ck"],
    [
      "targetless correction",
      {
        kind: "correction",
        author: "worker",
        status: "requested",
        reason: "Forgot",
        actor: "actor",
      },
      "time_entries_correction_shape_ck",
    ],
    ["clock carrying correction metadata", { missing: "out" }, "time_entries_correction_shape_ck"],
    [
      "confirmation without response",
      { kind: "confirmation", author: "worker" },
      "time_entries_correction_shape_ck",
    ],
  ])("refuses %s", async (_name, over, constraint) => {
    const error = await captureError(() => insert(shape(over)));
    expect(engineErrorMessage(error)).toContain(constraint);
    expect(suite.db.execute(sql`select id from time_entries`).rows).toEqual([]);
  });
  it("admits worker confirmation and refuses a response pointing at another worker", async () => {
    const target = await insert(shape({ kind: "out", author: "automatic", recorder: null }));
    await insert(shape({ kind: "confirmation", author: "worker", response: target }), 2);
    const error = await captureError(() =>
      insert(
        shape({
          kind: "confirmation",
          author: "worker",
          response: target,
          subject: otherPersonId,
          recorder: otherPersonId,
        }),
        3,
      ),
    );
    expect(engineErrorMessage(error)).toContain("FOREIGN KEY constraint failed");
    expect(
      suite.db.execute(sql`select entry_kind from time_entries order by sequence_no`).rows,
    ).toEqual([{ entry_kind: "out" }, { entry_kind: "confirmation" }]);
  });
  it("refuses a missing closure referenced by an automatic counting marker", async () => {
    const target = await insert(shape({ kind: "out", author: "automatic", recorder: null }));
    const error = await captureError(() =>
      insert(
        shape({
          kind: "confirmation",
          author: "automatic",
          recorder: null,
          response: target,
          closure: newId(),
        }),
        2,
      ),
    );
    expect(engineErrorMessage(error)).toContain("FOREIGN KEY constraint failed");
  });
});
describe("pay period schema", () => {
  it("stores singleton monthly settings and refuses a second settings row", async () => {
    await suite.db.execute(
      sql`insert into pay_period_settings (id, frequency, anchor_date) values (1, 'monthly', null)`,
    );
    const error = await captureError(() =>
      suite.db.execute(
        sql`insert into pay_period_settings (id, frequency, anchor_date) values (2, 'monthly', null)`,
      ),
    );
    expect(engineErrorMessage(error)).toContain("pay_period_settings_singleton_ck");
    expect(suite.db.execute(sql`select * from pay_period_settings`).rows).toEqual([
      { id: 1, frequency: "monthly", anchor_date: null },
    ]);
  });
  it.each([
    ["unknown", "yearly", null, "pay_period_settings_frequency_ck"],
    ["fortnight without anchor", "fortnightly", null, "pay_period_settings_anchor_ck"],
    ["monthly with anchor", "monthly", "2026-01-05", "pay_period_settings_anchor_ck"],
    ["Tuesday anchor", "fortnightly", "2026-01-06", "pay_period_settings_anchor_ck"],
    ["invalid anchor", "fortnightly", "2026-13-01", "pay_period_settings_anchor_ck"],
  ])("refuses %s", async (_name, frequency, anchor, constraint) => {
    const error = await captureError(() =>
      suite.db.execute(
        sql`insert into pay_period_settings (id, frequency, anchor_date) values (1, ${frequency}, ${anchor})`,
      ),
    );
    expect(engineErrorMessage(error)).toContain(constraint);
  });
  it("writes a frozen closure, refuses changing or deleting it, and accepts its counting marker", async () => {
    const id = newId();
    await suite.db
      .execute(sql`insert into pay_period_closures (id, node_id, location_id, period_start, period_end, clock, scheduled_close_at, closed_at, snapshot, sequence_no, prev_closure_hash, closure_hash)
   values (${id}, ${nodeId}, ${locationId}, '2026-01-01', '2026-02-01', '{"timeZone":"Europe/Madrid","dayCutover":"06:00"}', '2026-02-01T05:00:00.000Z', '2026-02-01T05:00:00.000Z', '{"sessions":[],"entries":[],"summaries":[],"countedAutomaticEntryIds":[]}', 1, null, ${"A".repeat(64)})`);
    const target = await insert(shape({ kind: "out", author: "automatic", recorder: null }));
    await insert(
      shape({
        kind: "confirmation",
        author: "automatic",
        recorder: null,
        response: target,
        closure: id,
      }),
      2,
    );
    for (const query of [
      sql`update pay_period_closures set closed_at = '2026-02-02T05:00:00.000Z' where id = ${id}`,
      sql`delete from pay_period_closures where id = ${id}`,
    ]) {
      const error = await captureError(() => suite.db.execute(query));
      expect(engineErrorMessage(error)).toContain("append-only");
    }
    expect(suite.db.execute(sql`select id, closed_at from pay_period_closures`).rows).toEqual([
      { id, closed_at: "2026-02-01T05:00:00.000Z" },
    ]);
  });
});
