// Weaker than its name. It knows an actor column only by its name: ACTOR_COLUMN's first half
// matches the usual spellings, and the three explicit names (credited_to, owner_id, editor_id)
// were found by reading each `*_id`/`*_to` column's schema comment and the A664 audit (plan
// decision 2), so a person column under any other name is missed until someone reads it. It reads
// `@waitron/db`'s schema alone: the tables its root exports, and, for the three it does not, the
// newest drizzle snapshot's columns. The adjustments module's actor columns are classified by
// packages/adjustments/src/personal-data.coverage.test.ts; other modules' are in the backlog point
// headed The rest of "who did what" in the download, in docs/backlog/data-protection.md, not here.
// And it proves a column was classified, not that the actions part honours the classification
// (personal-data-actions.test.ts does that).
import { readFileSync, readdirSync } from "node:fs";
import * as db from "@waitron/db";
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

const ACTOR_COLUMN =
  /(^|_)(person_id|person|by|operator_id|actor_id)$|^(credited_to|owner_id|editor_id)$/;

const READ = [
  "sale_voids.voided_by",
  "tender_refunds.requested_by",
  "tender_refunds.authorized_by",
  "tender_refunds.attested_by",
  "bill_payment_refunds.requested_by",
  "bill_payment_refunds.authorized_by",
  "bill_payment_refunds.attested_by",
  "drawer_opens.person_id",
  "drawer_opens.authorized_by",
];

const NOT_YET_REASON =
  'not in the download yet: backlog, The rest of "who did what" in the download';

const NOT_YET: Record<string, string> = Object.fromEntries(
  [
    "bill_edit_states.editor_id",
    "bill_payments.attested_by",
    "bill_payments.requested_by",
    "daily_closes.closed_by",
    "incidents.acknowledged_by",
    "invoice_deliveries.person_id",
    "invoice_pdf_downloads.person_id",
    "membership_clearances.person_id",
    "membership_removals.person_id",
    "order_amendments.actor_id",
    "order_draft_events.actor_id",
    "order_draft_events.from_person",
    "order_draft_events.to_person",
    "order_drafts.owner_id",
    "order_group_events.actor_id",
    "order_groups.fired_by",
    "order_groups.submitted_by",
    "order_portion_events.actor_id",
    "parties.closed_by",
    "parties.opened_by",
    "pass_item_marks.done_by_person_id",
    "receipt_reprints.person_id",
    "recovery_packs.made_by",
    "sales.authorized_by",
    "sales.operator_id",
    "ticket_item_moves.moved_by_person_id",
    "unpaid_departures.authorized_by",
    "unpaid_departures.recorded_by",
    "working_order_lines.credited_to",
  ].map((column) => [column, NOT_YET_REASON]),
);

const COVERED_ELSEWHERE: Record<string, string> = {
  "line_service_cancellations.actor_id":
    "the kept-charge cancel's requester; checked against its one writer of a new cancellation, line-cancel.ts's keep-charge branch, which writes the adjustments row the adjustments module's part lists (a split copies the row with its actor); a new writer must write an adjustment too",
};

const NOT_A_PERSON: Record<string, string> = {
  "print_jobs.claimed_by": "the claiming print agent's id",
  "invoice_deliveries.claimed_by": "the claiming print agent's id, or the node's for an email",
};

const COLUMNS: Record<string, { readonly in: string[]; readonly out: string[] }> = {
  sale_voids: {
    in: ["sale_id", "voided_at", "voided_by"],
    out: ["id", "reason"],
  },
  tender_refunds: {
    in: [
      "sale_id",
      "applied_amount",
      "tip_amount",
      "method",
      "state",
      "created_at",
      "requested_by",
      "authorized_by",
      "attested_by",
    ],
    out: [
      "id",
      "tender_id",
      "submission_id",
      "fingerprint",
      "reason",
      "attestation_note",
      "source",
      "device_id",
      "node_id",
      "location_id",
      "manual",
      "provider",
      "provider_payment_ref",
      "completed_at",
      "failed_at",
      "sent_at",
      "send_count",
      "refs_before_send",
      "provider_refund_ref",
      "provider_status",
      "last_lookup_at",
      "next_retry_at",
    ],
  },
  bill_payment_refunds: {
    in: [
      "bill_payment_id",
      "applied_amount",
      "tip_amount",
      "state",
      "created_at",
      "requested_by",
      "authorized_by",
      "attested_by",
    ],
    out: [
      "id",
      "submission_id",
      "fingerprint",
      "reason",
      "source",
      "device_id",
      "sent_at",
      "send_count",
      "provider_refund_ref",
      "refs_before_send",
      "attestation_note",
      "completed_at",
      "failed_at",
    ],
  },
  drawer_opens: {
    in: [
      "reason",
      "opened_at",
      "sale_id",
      "bill_payment_id",
      "via_override",
      "person_id",
      "authorized_by",
    ],
    out: ["id", "device_id", "printer_id", "tender_refund_id"],
  },
};

const ROOT_UNEXPORTED = ["change_log", "node_membership"];

const tables = Object.values(db).flatMap((value) =>
  is(value, SQLiteTable) ? [getTableConfig(value)] : [],
);

function newestSnapshot(): { name: string; columns: string[] }[] {
  const meta = new URL("../../../packages/db/drizzle/meta/", import.meta.url);
  const newest = readdirSync(meta)
    .filter((name) => /^\d+_snapshot\.json$/.test(name))
    .sort()
    .at(-1)!;
  const snapshot = JSON.parse(readFileSync(new URL(newest, meta), "utf8")) as {
    tables: Record<string, { name: string; columns: Record<string, { name: string }> }>;
  };
  return Object.values(snapshot.tables).map((table) => ({
    name: table.name,
    columns: Object.values(table.columns).map((column) => column.name),
  }));
}

describe("actions personal-data classification", () => {
  it("classifies every actor column in the core schema exactly once", () => {
    const actorColumns = tables.flatMap((config) =>
      config.columns
        .filter((column) => ACTOR_COLUMN.test(column.name))
        .map((column) => `${config.name}.${column.name}`),
    );
    const lists = [
      READ,
      Object.keys(NOT_YET),
      Object.keys(COVERED_ELSEWHERE),
      Object.keys(NOT_A_PERSON),
    ];
    const classified = lists.flat();
    expect(classified.filter((column, index) => classified.indexOf(column) !== index)).toEqual([]);
    expect(actorColumns.sort()).toEqual(classified.sort());
  });

  it("walks every table of the newest core snapshot the root exports", () => {
    const walked = tables.map((config) => config.name).sort();
    const expected = newestSnapshot()
      .map((table) => table.name)
      .filter((name) => !ROOT_UNEXPORTED.includes(name))
      .sort();
    expect(walked).toEqual(expected);
  });

  it("finds no actor column in the tables the root does not export", () => {
    const unexported = newestSnapshot().filter((table) => ROOT_UNEXPORTED.includes(table.name));
    expect(unexported.map((table) => table.name).sort()).toEqual([...ROOT_UNEXPORTED].sort());
    expect(
      unexported.flatMap((table) =>
        table.columns
          .filter((column) => ACTOR_COLUMN.test(column))
          .map((column) => `${table.name}.${column}`),
      ),
    ).toEqual([]);
  });

  it.each(Object.keys(COLUMNS))("classifies every column of %s exactly once", (name) => {
    const config = tables.find((table) => table.name === name);
    expect(config).toBeDefined();
    const { in: included, out: excluded } = COLUMNS[name]!;
    expect(included.filter((column) => excluded.includes(column))).toEqual([]);
    expect(config!.columns.map((c) => c.name).sort()).toEqual([...included, ...excluded].sort());
  });
});
