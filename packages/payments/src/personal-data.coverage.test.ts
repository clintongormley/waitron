// Classifies columns by name. The behaviour test checks what the file actually contains.
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

// schema-ownership.test.ts checks these exports against the module's owned tables.
const tables = Object.values(schema).flatMap((value) =>
  is(value, SQLiteTable) ? [getTableConfig(value)] : [],
);
const ACTOR_COLUMN =
  /(^|_)(person_id|person|by|operator_id|actor_id)$|^(credited_to|owner_id|editor_id)$/;
const READ = ["payments.hold_decided_by"];
const NOT_YET = ["payments.requested_by", "payments.resolved_by", "payment_refunds.authorized_by"];

describe("payments personal-data classification", () => {
  it("classifies each actor column of its owned tables exactly once", () => {
    const actors = tables.flatMap(({ name, columns }) =>
      columns
        .filter((column) => ACTOR_COLUMN.test(column.name))
        .map((column) => `${name}.${column.name}`),
    );
    expect(actors.sort()).toEqual([...READ, ...NOT_YET].sort());
  });

  it("classifies every field of payments exactly once", () => {
    const included = [
      "id",
      "working_order_id",
      "hold_decided_by",
      "hold_decided_at",
      "hold_outcome",
    ];
    const excluded = [
      "source",
      "device_id",
      "sale_id",
      "node_id",
      "reader_id",
      "provider",
      "payment_ref",
      "external_ref",
      "external_provider",
      "external_machine",
      "card_scheme",
      "card_last4",
      "card_entry_mode",
      "card_auth_code",
      "amount",
      "requested_amount",
      "state",
      "settled_at",
      "provider_checkout_started_at",
      "reconcile_remediated_at",
      "created_at",
      "updated_at",
      "bill_payment_id",
      "resolution_outcome",
      "resolution_cancelled_at_provider",
      "resolution_provider_status",
      "resolved_by",
      "resolved_at",
      "hold_provider_amount",
      "held_at",
      "hold_note",
      "requested_by",
    ];
    const columns = getTableConfig(schema.payments).columns.map(({ name }) => name);
    expect(columns.sort()).toEqual([...included, ...excluded].sort());
  });
});
