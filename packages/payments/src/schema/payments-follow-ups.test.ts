import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
  newId,
} from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { seedWorkingOrder } from "../../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const AT = "2026-07-22T10:00:00.000Z";
const PERSON = "22222222-2222-4222-8222-222222222222";
const resolution = {
  resolution_outcome: "captured",
  resolution_cancelled_at_provider: 0,
  resolved_at: AT,
};
const hold = { hold_provider_amount: 1210, held_at: AT };
const outcome = { ...hold, hold_outcome: "kept", hold_decided_by: PERSON, hold_decided_at: AT };
type Fields = Record<string, string | number | null>;
let order: string;

beforeEach(async () => {
  order = (await seedWorkingOrder(suite.db)).workingOrderId;
  await seedPerson(suite.db, { id: PERSON, displayName: "Manager" });
});

async function insert(fields: Fields) {
  const row: Fields = {
    id: newId(),
    working_order_id: order,
    source: "operator_script",
    provider: "fake",
    payment_ref: newId(),
    amount: 1210,
    state: "captured",
    created_at: AT,
    updated_at: AT,
    ...fields,
  };
  return suite.db.execute(sql`insert into payments (${sql.join(
    Object.keys(row).map((k) => sql.identifier(k)),
    sql`, `,
  )})
    values (${sql.join(
      Object.values(row).map((v) => sql`${v}`),
      sql`, `,
    )}) returning *`);
}

it.each<Fields>([
  {},
  { requested_by: PERSON },
  resolution,
  { ...resolution, resolved_by: PERSON },
  hold,
  outcome,
  { ...resolution, resolution_outcome: "failed", resolution_cancelled_at_provider: 1 },
  { ...outcome, hold_outcome: "refunded_at_provider", hold_note: "Refunded" },
  { reconcile_remediated_at: AT },
])("accepts complete follow-up facts: %j", async (fields) => {
  const { rows } = await insert(fields);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject(fields);
});

it.each<[string, Fields]>([
  ["payments_resolution_outcome_ck", { ...resolution, resolution_outcome: "unknown" }],
  ["payments_resolution_cancelled_ck", { ...resolution, resolution_cancelled_at_provider: 1 }],
  ["payments_resolution_fields_ck", { ...resolution, resolved_at: null }],
  ["payments_resolution_fields_ck", { ...resolution, resolution_cancelled_at_provider: null }],
  ["payments_resolution_fields_ck", { resolved_by: PERSON }],
  ["payments_resolution_fields_ck", { resolution_provider_status: "paid" }],
  ["payments_hold_amount_ck", { ...hold, hold_provider_amount: 0 }],
  ["payments_hold_amount_ck", { ...hold, hold_provider_amount: -1 }],
  ["payments_hold_fields_ck", { held_at: AT }],
  ["payments_hold_fields_ck", { hold_provider_amount: 1210 }],
  ["payments_hold_outcome_ck", { ...outcome, hold_outcome: "unknown" }],
  ["payments_hold_note_ck", { ...outcome, hold_note: "" }],
  ["payments_hold_note_ck", { ...outcome, hold_note: "  " }],
  ["payments_hold_outcome_fields_ck", { ...outcome, held_at: null, hold_provider_amount: null }],
  ["payments_hold_outcome_fields_ck", { ...outcome, hold_decided_by: null }],
  ["payments_hold_outcome_fields_ck", { ...outcome, hold_decided_at: null }],
  ["payments_hold_outcome_fields_ck", { ...hold, hold_note: "Undecided" }],
  ["payments_hold_or_remediation_ck", { ...hold, reconcile_remediated_at: AT }],
])(
  "refuses incomplete or contradictory follow-up facts with %s: %j",
  async (constraint, fields) => {
    const error = await captureError(() => insert(fields));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain(constraint);
  },
);

it.each<Fields>([
  { requested_by: "missing" },
  { ...resolution, resolved_by: "missing" },
  { ...outcome, hold_decided_by: "missing" },
])("refuses an actor who is not a person: %j", async (fields) => {
  const error = await captureError(() => insert(fields));
  expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
});

it.each([null, PERSON, "missing"])("checks the refund authoriser: %s", async (authorizedBy) => {
  const { rows } = await insert({});
  const write = () =>
    suite.db.execute(sql`insert into payment_refunds
    (id, payment_id, amount, state, authorized_by, created_at)
    values (${newId()}, ${rows[0]!.id}, 100, 'succeeded', ${authorizedBy}, ${AT})`);
  if (authorizedBy === "missing") {
    const error = await captureError(write);
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  } else {
    await write();
    const saved = await suite.db.execute(sql`select authorized_by from payment_refunds`);
    expect(saved.rows).toEqual([{ authorized_by: authorizedBy }]);
  }
});
