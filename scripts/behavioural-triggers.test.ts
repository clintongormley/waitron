import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { applyMigrations } from "../packages/migrations/src/apply.js";
import { migrationOptionsFor } from "../packages/migrations/src/manifest.js";
import { orderedMigrationSets } from "../packages/module/src/module.js";
// The exact words each refusing trigger raises, imported from the one place that declares them:
// `packages/core` matches one of them (`settle-sale.ts`), and a local copy would test the
// triggers against this file instead of against what the product reads.
import {
  BILL_PAYMENT_CHANGE_REFUSAL,
  BILL_PAYMENT_DELETE_REFUSAL,
  BILL_REFUND_CHANGE_REFUSAL,
  BILL_REFUND_DELETE_REFUSAL,
  COVERAGE_REFUSAL,
  FORM_FACTOR_REFUSAL,
  KDS_BINDING_REFUSAL,
  LOCALES_REFUSAL,
  MISSING_PROFILE_REFUSAL,
  OPEN_PARENT_REFUSAL,
  PRODUCT_ORDERING_REFUSAL,
  POST_SETTLEMENT_REFUSAL,
  PRODUCT_ID_FIXED_REFUSAL,
  REGISTER_BINDING_REFUSAL,
  TRANSITION_REFUSAL,
  VARIANT_LOCALES_REFUSAL,
  VARIANT_ONE_LEVEL_REFUSAL,
  VARIANT_PARENT_FIXED_REFUSAL,
} from "../packages/db/src/trigger-refusals.js";

/**
 * The BEHAVIOURAL rules of `packages/db/drizzle/0001_behavioural_triggers.sql` still refuse
 * against a database the PRODUCT migrated: a settlement's tender coverage, a tender
 * after settlement, a working order's status transitions, lines written against an order that is
 * not open, a line's description maps matching the venue's invoice locales, a device profile's form
 * factor while an active device uses it, and a device's station-or-register binding against its
 * profile's form factor. A trigger cannot be declared in the TypeScript schema, so a regenerated
 * migration set does not carry it.
 *
 * It also holds `packages/db/drizzle/0004_variant_one_level.sql`'s three triggers on `products`: a
 * variant is one level deep, keeps the parent it was created with, and no product's id changes.
 * And `packages/db/drizzle/0047_product_ordering_check.sql`'s two: `products.ordering` holds one of
 * its three values.
 * `working_orders_enforce_transition` is re-created, with the same name, by
 * `packages/db/drizzle/0015_settled_order_freeze_new_columns.sql` and again by
 * `packages/db/drizzle/0019_settled_order_freeze_visit_id.sql`, and
 * `working_order_lines_require_open_parent_update` by `0027_line_vat_class_triggers.sql` and again,
 * with its served exception and a refusal to move a line off an order that is not open, by
 * `packages/db/drizzle/0033_line_served_exception.sql`. Both are re-created by
 * `packages/db/drizzle/0042_placed_bill_moves.sql`, with an exception each for a presented bill.
 * `working_orders_enforce_transition` is re-created again by
 * `packages/db/drizzle/0056_placed_order_handover.sql`, which lets a sent, unpaid counter order take
 * its handover stamp.
 * `working_order_lines_require_open_parent_update` is re-created again by
 * `packages/db/drizzle/0050_line_list_price_frozen.sql`, with `list_unit_price_gross` in its
 * unchanged-column lists, and by `packages/db/drizzle/0053_line_sent_after_close.sql`, which lets a
 * presented or paid bill's line take a first `sent_at`.
 * `packages/db/drizzle/0064_line_locale_triggers_text_only.sql` re-creates the two locale update
 * triggers to fire only when an update changes the name map each one checks or moves the line.
 * Some triggers ACT rather than refuse.
 * `parties_clear_table_status` (`packages/db/drizzle/0020_visit_clears_table_status.sql`,
 * re-created under this name by `packages/db/drizzle/0036_party_rename.sql`, and again after the
 * rebuild of its table by `packages/db/drizzle/0045_recreate_triggers_after_rebuild.sql`):
 * a table's service status comes off when the party leaves `open`, on every table still a
 * member of it. It replaced `working_orders_clear_table_status`, which cleared it when a tab settled.
 * And the two of `packages/db/drizzle/0038_main_bill_release.sql`, re-created by `0045` too: a
 * party's `main_bill_id` is cleared when that bill leaves `open`, or leaves the party (to another
 * party or to the counter).
 * `packages/db/drizzle/0024_bill_payment_triggers.sql` adds the state guards on `bill_payments` and
 * `bill_payment_refunds`, and a trigger on each refusing every delete — those two refuse by design
 * whatever the row, so they have no accepting control here.
 *
 * **It migrates through `applyMigrations`**: a guard that installs the thing under test cannot see
 * the product failing to install it.
 *
 * **Reading `sqlite_master` is not enough, and most of this file is the other half.** A trigger
 * SQLite RECORDS is not a trigger SQLite ENFORCES: a `WHEN` clause that is never true, a body
 * whose condition is inverted, or a set comparison that only works in one direction all leave the
 * name in the catalogue. So every refusing trigger has a real offending write with its message
 * asserted, and each has an ACCEPTING control in the other direction — without the control, a
 * trigger that refused EVERY write would pass the refusal cases.
 *
 * WHAT IT DOES NOT COVER. `INSERT … ON CONFLICT DO UPDATE` is not tried against any of these
 * triggers, though a `BEFORE INSERT` trigger fires on it and a `BEFORE UPDATE` one on its conflict
 * path. `INSERT OR REPLACE` is tried only against `products_variant_one_level_insert` and
 * `products_ordering_check_insert`, and `UPDATE OR REPLACE` only against
 * `products_id_fixed_update`; no other trigger here, media's triggers on `products` included, is
 * tried with either. Nor is any concurrency claim: one connection, one process.
 */

/**
 * The other triggers a fully migrated venue carries: they stand in for the two foreign keys
 * `products.image` and `sections.image`
 * (`packages/media/drizzle/0001_image_references.sql` carries the reasoning, and
 * `packages/media/drizzle/0002_section_image_references.sql` adds the four on `sections.image`),
 * and for `menu_version_images.filename`, keeping a photo a live menu version names
 * (`packages/media/drizzle/0003_published_image_references.sql`). Media's
 * `0005_photo_name_only.sql` drops and re-creates all eleven around its rebuild of `media_images`.
 * Named here only because the assertion below is an EQUALITY over every non-append-only trigger.
 */
const IMAGE_REFERENCE_TRIGGERS = [
  "menu_version_images_media_image_fk_insert",
  "menu_version_images_media_image_fk_parent_delete",
  "menu_version_images_media_image_fk_parent_rename",
  "products_media_image_fk_insert",
  "products_media_image_fk_parent_delete",
  "products_media_image_fk_parent_rename",
  "products_media_image_fk_update",
  "sections_media_image_fk_insert",
  "sections_media_image_fk_parent_delete",
  "sections_media_image_fk_parent_rename",
  "sections_media_image_fk_update",
];

/**
 * Every behavioural trigger the migrations create, pinned by name: those of
 * `0001_behavioural_triggers.sql` (SQLite has no `BEFORE INSERT OR UPDATE`, so a rule covering more
 * than one event is split and the suffix names the event), the `products_*` names of
 * `0004_variant_one_level.sql` and `0047_product_ordering_check.sql`, `parties_clear_table_status` of
 * `0036_party_rename.sql`, the `working_orders_release_main_bill*` names of
 * `0038_main_bill_release.sql` (those three re-created by
 * `0045_recreate_triggers_after_rebuild.sql`), and the `bill_payment*` names of
 * `0024_bill_payment_triggers.sql`. A later migration that RECREATES a table drops its triggers
 * silently — the `products_*` ones on `products`, `parties_clear_table_status` on `parties` — and
 * this list is what notices.
 */
const EXPECTED_TRIGGERS = [
  "bill_payment_refunds_guard_update",
  "bill_payment_refunds_no_delete",
  "bill_payments_guard_update",
  "bill_payments_no_delete",
  "device_binding_rule_insert",
  "device_binding_rule_update",
  "device_profile_form_factor_locked",
  "products_id_fixed_update",
  "products_ordering_check_insert",
  "products_ordering_check_update",
  "products_variant_one_level_insert",
  "products_variant_parent_fixed_update",
  "sale_settlements_check_coverage",
  "tenders_reject_post_settlement",
  "working_order_lines_check_locales_insert",
  "working_order_lines_check_locales_update",
  "working_order_lines_check_variant_locales_insert",
  "working_order_lines_check_variant_locales_update",
  "working_order_lines_require_open_parent_delete",
  "working_order_lines_require_open_parent_insert",
  "working_order_lines_require_open_parent_update",
  "working_orders_enforce_transition",
  "working_orders_release_main_bill",
  "working_orders_release_main_bill_on_move",
  "parties_clear_table_status",
];

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** What the driver said, or `undefined` if the statement was accepted. */
function refusalFor(connection, statement) {
  try {
    connection.exec(statement);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The driver's numeric class for a statement, or `undefined` if it was accepted. */
function errcodeFor(connection, statement) {
  try {
    connection.exec(statement);
    return undefined;
  } catch (error) {
    return error.errcode;
  }
}

const STAMP = "2026-09-22T10:00:00.000Z";

/**
 * Unique-index fodder: `working_order_lines` is unique on (`working_order_id`, `line_no`) and
 * `sales` on (`series_id`, `invoice_number`), and a case that collided on one would report a unique
 * violation where it meant to report a trigger. A REFUSED insert burns a number, which is harmless.
 */
let nextLineNo = 0;
let nextInvoiceNumber = 0;

/** A bill payment on `wo-open`, taken by card for 10.00. */
function billPayment(id, state) {
  const receivedAt = state === "received" ? `'${STAMP}'` : "null";
  return (
    `insert into bill_payments (id, working_order_id, submission_id, fingerprint, kind, method, ` +
    ` applied, tip, state, requested_by, till_id, created_at, received_at) ` +
    `values ('${id}', 'wo-open', '${id}', 'fp', 'contribution', 'card', 1000, 0, '${state}', ` +
    ` 'person', 'till', '${STAMP}', ${receivedAt})`
  );
}

/** A pending card refund of 5.00 from bill payment `paymentId`, not yet sent. */
function billRefund(id, paymentId) {
  return (
    `insert into bill_payment_refunds (id, bill_payment_id, submission_id, fingerprint, ` +
    ` applied_amount, tip_amount, reason, authorized_by, requested_by, till_id, state, send_count, ` +
    ` created_at) ` +
    `values ('${id}', '${paymentId}', '${id}', 'fp', 500, 0, 'wrong item', 'person', 'person', ` +
    ` 'till', 'pending', 0, '${STAMP}')`
  );
}

/** A working order row. Callers name only what a case turns on. */
function workingOrder(id, status, extra = {}) {
  const tillId = extra.tillId ?? "till";
  const settledAt = status === "settled" ? `'${STAMP}'` : "null";
  const collectedAt = extra.collectedAt ? `'${extra.collectedAt}'` : "null";
  const partyId = extra.partyId ? `'${extra.partyId}'` : "null";
  return (
    `insert into working_orders (id, till_id, order_number, status, opened_at, settled_at, collected_at, party_id) ` +
    `values ('${id}', '${tillId}', 1, '${status}', '${STAMP}', ${settledAt}, ${collectedAt}, ${partyId})`
  );
}

/** A working-order line. `descriptions` and `variant_descriptions` arrive as JSON text. */
function line(id, orderId, descriptions, variantDescriptions = null) {
  const variant = variantDescriptions === null ? "null" : `'${variantDescriptions}'`;
  nextLineNo += 1;
  return (
    `insert into working_order_lines ` +
    `(id, working_order_id, line_no, name, descriptions, variant_descriptions, ` +
    ` quantity, unit_price_gross, vat_class, line_total) ` +
    `values ('${id}', '${orderId}', ${nextLineNo}, 'Item', '${descriptions}', ${variant}, ` +
    ` 1000, 121, 'general', 121)`
  );
}

/** A sale, with `total` in whole cents. */
function sale(id, total, correctsSaleId = null) {
  const corrects = correctsSaleId === null ? "null" : `'${correctsSaleId}'`;
  nextInvoiceNumber += 1;
  return (
    `insert into sales (id, till_id, series_id, node_id, invoice_number, issued_at, ` +
    ` issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, ` +
    ` fiscal_state, corrects_sale_id) ` +
    `values ('${id}', 'till', 'series', 'node', ${nextInvoiceNumber}, '${STAMP}', 0, ${total}, '[]', 'es', ` +
    ` '["es"]', 'verifactu', 'recorded', ${corrects})`
  );
}

/** An open party. Check constraints are off here, so `closed_at` need not follow `state`. */
function party(id) {
  return (
    `insert into parties (id, state, opened_at, opened_by, revision) ` +
    `values ('${id}', 'open', '${STAMP}', 'person', 0)`
  );
}

/** A dining table carrying the `status-busy` status. */
function table(id, label) {
  return (
    `insert into dining_tables (id, location_id, label, status_id, created_at) ` +
    `values ('${id}', 'loc', '${label}', 'status-busy', '${STAMP}')`
  );
}

/** A table's membership of a party; `leftAt` null while the table belongs to it. */
function membership(id, partyId, tableId, leftAt) {
  const left = leftAt === null ? "null" : `'${leftAt}'`;
  return (
    `insert into party_tables (id, party_id, table_id, joined_at, left_at) ` +
    `values ('${id}', '${partyId}', '${tableId}', '${STAMP}', ${left})`
  );
}

function tender(id, saleId, amount, tip = 0) {
  return (
    `insert into tenders (id, sale_id, method, amount, tip_amount, settled_at) ` +
    `values ('${id}', '${saleId}', 'card', ${amount}, ${tip}, '${STAMP}')`
  );
}

/** A line's two maps, keyed to `["es","ca"]`, the list `loc-relocale-text` later drops `ca` from. */
const OLD_TEXT = '{"es":"Plato","ca":"Plat"}';
const OLD_VARIANT = '{"es":"Grande","ca":"Gran"}';

/**
 * The fixture rows the cases below need, written straight into a migrated venue file.
 *
 * Foreign keys and check constraints are both OFF, as `append-only-triggers.test.ts` runs its own
 * seeding: one row can then stand for a parent this file does not care about, and a refusal cannot
 * be a CHECK constraint or a foreign key wearing a trigger's clothes. On this engine an
 * `ON DELETE RESTRICT` refusal arrives with the SAME numeric class as `RAISE(ABORT, …)`, so every
 * message is asserted in full rather than by class. Neither pragma touches triggers; the accepting
 * controls below run under the same two.
 */
function seed(connection) {
  const statements = [
    // Venue: one location with TWO invoice locales, so "exactly the venue locales" has a set to be
    // wrong about in both directions.
    `insert into locations (id, name, invoice_locales, operation_description) ` +
      `values ('loc', 'Venue', '["es","ca"]', 'Restaurante')`,
    `insert into tills (id, location_id, name, created_at) values ('till', 'loc', 'Till 1', '${STAMP}')`,
    `insert into tills (id, location_id, name, created_at) values ('till-2', 'loc', 'Till 2', '${STAMP}')`,

    // Working orders, one per case that changes an order's state.
    workingOrder("wo-open", "open"),
    workingOrder("wo-placed", "placed"),
    workingOrder("wo-settled", "settled"),
    workingOrder("wo-settled-extra", "settled"),
    workingOrder("wo-settled-revision", "settled"),
    workingOrder("wo-settled-payment", "settled"),
    workingOrder("wo-settled-party", "settled"),
    workingOrder("wo-settled-reopen", "settled"),
    workingOrder("wo-flip", "open"),
    workingOrder("wo-lines-update", "open"),
    workingOrder("wo-lines-delete", "open"),
    workingOrder("wo-orphaned-parent", "open"),
    workingOrder("wo-tab", "open", { partyId: "party-bill-settles" }),
    // A till that does not exist, so the join to a location resolves to nothing.
    workingOrder("wo-orphan", "open", { tillId: "ghost-till" }),

    // Lines written while their parent is still open, for the update and delete cases.
    line("line-open", "wo-open", '{"es":"Plato","ca":"Plat"}'),
    line("line-update", "wo-lines-update", '{"es":"Plato","ca":"Plat"}'),
    line("line-delete", "wo-lines-delete", '{"es":"Plato","ca":"Plat"}'),
    line("line-orphaned", "wo-orphaned-parent", '{"es":"Plato","ca":"Plat"}'),

    // A party's table carrying a service status: settling the party's bill leaves it (the party
    // clears it).
    `insert into table_service_statuses (id, label, color, created_at) ` +
      `values ('status-busy', 'Ocupada', '#ff0000', '${STAMP}')`,
    party("party-bill-settles"),
    table("dt-closes", "1"),
    membership("vt-closes", "party-bill-settles", "dt-closes", null),

    // Parties and their memberships, for the clear-when-the-party-leaves-open trigger. Each case
    // moves its own party, so no case's write changes what another case reads.
    party("party-finishes"),
    party("party-bumped"),
    party("party-frozen"),
    table("dt-member-a", "3"),
    table("dt-member-b", "4"),
    table("dt-left-earlier", "5"),
    table("dt-bystander", "6"),
    table("dt-bumped", "8"),
    membership("vt-a", "party-finishes", "dt-member-a", null),
    membership("vt-b", "party-finishes", "dt-member-b", null),
    membership("vt-left", "party-finishes", "dt-left-earlier", STAMP),
    membership("vt-bumped", "party-bumped", "dt-bumped", null),

    // A party per main-bill case, each with the open bill its case names as the main bill, so no
    // case's write changes what another case reads. `party-main-other` also holds a second open
    // bill, which its case moves.
    party("party-main-settles"),
    party("party-main-places"),
    party("party-main-moves"),
    party("party-main-revision"),
    party("party-main-other"),
    party("party-main-destination"),
    workingOrder("wo-main-settles", "open", { partyId: "party-main-settles" }),
    workingOrder("wo-main-places", "open", { partyId: "party-main-places" }),
    workingOrder("wo-main-moves", "open", { partyId: "party-main-moves" }),
    workingOrder("wo-main-revision", "open", { partyId: "party-main-revision" }),
    workingOrder("wo-main-other", "open", { partyId: "party-main-other" }),
    workingOrder("wo-main-other-split", "open", { partyId: "party-main-other" }),
    workingOrder("wo-main-destination", "open", { partyId: "party-main-destination" }),

    // Sales and their tenders. Every tender is written BEFORE any settlement, because
    // tenders_reject_post_settlement is one of the triggers under test.
    sale("sale-bare", 1000),
    sale("sale-covered", 1000),
    sale("sale-settled", 500),
    sale("sale-unsettled", 1000),
    sale("sale-tipped", 1000),
    sale("sale-tip-swallowed", 1000),
    sale("sale-corrected", 1000),
    sale("sale-rectifies", -300, "sale-corrected"),
    tender("tender-covered", "sale-covered", 1000),
    tender("tender-settled", "sale-settled", 500),
    // Amount covers the sale AND the tip: 1000 + 100.
    tender("tender-tipped", "sale-tipped", 1100, 100),
    // Amount covers the sale but NOT the tip, which is the case a formula that dropped `tip_amount`
    // would accept.
    tender("tender-tip-swallowed", "sale-tip-swallowed", 1000, 100),
    // 1000 sale less a 300 rectificativa: a formula that ignored corrections would want 1000.
    tender("tender-corrected", "sale-corrected", 700),
    `insert into sale_settlements (id, sale_id, settled_at) values ('ss-seed', 'sale-settled', '${STAMP}')`,

    // Bill payments: one each to move, to decline, and to hold a tender, which blocks a decline.
    billPayment("bp-pending", "pending"),
    billPayment("bp-received", "received"),
    billPayment("bp-tendered", "received"),
    sale("sale-bill", 1000),
    `insert into tenders (id, sale_id, method, amount, tip_amount, settled_at, bill_payment_id) ` +
      `values ('tender-bill', 'sale-bill', 'card', 1000, 0, '${STAMP}', 'bp-tendered')`,
    billRefund("bpr-pending", "bp-received"),

    // A kitchen station, so the binding rule's kds arm has a valid station to accept.
    `insert into kitchen_stations (id, location_id, name, created_at) ` +
      `values ('station', 'loc', 'Pase', '${STAMP}')`,

    // Device profiles and one active device. The device carries `till_id` because its profile's
    // form factor is `till` and device_binding_rule_insert refuses that shape without one — this
    // seed row is itself the rule's first accepting control.
    `insert into device_profiles (id, name, form_factor, created_at, updated_at) ` +
      `values ('dp-used', 'Counter', 'till', '${STAMP}', '${STAMP}')`,
    `insert into device_profiles (id, name, form_factor, created_at, updated_at) ` +
      `values ('dp-free', 'Spare', 'till', '${STAMP}', '${STAMP}')`,
    `insert into devices (id, location_id, device_profile_id, till_id, label, token_hash, active, enrolled_at, created_at) ` +
      `values ('dev-active', 'loc', 'dp-used', 'till', 'Counter 1', 'hash', 1, '${STAMP}', '${STAMP}')`,

    // The binding rule's own profiles, separate from the two above so that attaching a device to
    // one never changes what the form-factor drift guard's cases see.
    `insert into device_profiles (id, name, form_factor, created_at, updated_at) ` +
      `values ('dp-bind-kds', 'Pase', 'kds', '${STAMP}', '${STAMP}')`,
    `insert into device_profiles (id, name, form_factor, created_at, updated_at) ` +
      `values ('dp-bind-till', 'Caja', 'till', '${STAMP}', '${STAMP}')`,
    // Valid rows to UPDATE into a bad shape, and one deactivated row for the reactivation case.
    `insert into devices (id, location_id, device_profile_id, till_id, label, token_hash, active, enrolled_at, created_at) ` +
      `values ('dev-rebind', 'loc', 'dp-bind-till', 'till', 'Caja 2', 'hash', 1, '${STAMP}', '${STAMP}')`,
    `insert into devices (id, location_id, device_profile_id, till_id, label, token_hash, active, enrolled_at, created_at) ` +
      `values ('dev-heartbeat', 'loc', 'dp-bind-till', 'till', 'Caja 3', 'hash', 1, '${STAMP}', '${STAMP}')`,
    `insert into device_profiles (id, name, form_factor, created_at, updated_at) ` +
      `values ('dp-drift', 'Caja que deriva', 'till', '${STAMP}', '${STAMP}')`,
    `insert into devices (id, location_id, device_profile_id, till_id, label, token_hash, active, enrolled_at, created_at) ` +
      `values ('dev-off', 'loc', 'dp-drift', 'till', 'Caja 4', 'hash', 0, '${STAMP}', '${STAMP}')`,

    // Lines for the served exception, written while their orders are open; the orders leave open
    // below. `loc-relocale` is a venue of its own so its invoice locales can change without moving
    // what any other case reads.
    `insert into locations (id, name, invoice_locales, operation_description) ` +
      `values ('loc-relocale', 'Venue 2', '["es","ca"]', 'Restaurante')`,
    `insert into tills (id, location_id, name, created_at) ` +
      `values ('till-relocale', 'loc-relocale', 'Till 3', '${STAMP}')`,
    workingOrder("wo-served-placed", "open"),
    workingOrder("wo-served-settled", "open"),
    workingOrder("wo-served-orphan", "open"),
    workingOrder("wo-served-open", "open"),
    workingOrder("wo-served-relocale", "open", { tillId: "till-relocale" }),
    line("line-served-placed", "wo-served-placed", '{"es":"Plato","ca":"Plat"}'),
    line("line-served-settled", "wo-served-settled", '{"es":"Plato","ca":"Plat"}'),
    line("line-served-frozen", "wo-served-settled", '{"es":"Plato","ca":"Plat"}'),
    line("line-served-unchanged", "wo-served-settled", '{"es":"Plato","ca":"Plat"}'),
    line("line-served-reparent", "wo-served-settled", '{"es":"Plato","ca":"Plat"}'),
    line("line-served-orphan", "wo-served-orphan", '{"es":"Plato","ca":"Plat"}'),
    line("line-served-open", "wo-served-open", '{"es":"Plato","ca":"Plat"}'),
    line("line-open-moves", "wo-served-open", '{"es":"Plato","ca":"Plat"}'),
    line("line-served-relocale", "wo-served-relocale", '{"es":"Plato","ca":"Plat"}'),
    `update working_orders set status = 'placed' where id = 'wo-served-placed'`,

    // Presented bills that move whole (P14): each allowed case writes a row of its own, so no case's
    // write changes what another case reads. The refusals share rows, since a refused write
    // changes nothing.
    workingOrder("wo-moves-party", "open"),
    workingOrder("wo-moves-delivery", "open"),
    workingOrder("wo-moves-revision", "open"),
    workingOrder("wo-moves-frozen", "open"),
    workingOrder("wo-moves-lines", "open"),
    line("line-moves-into-group", "wo-moves-lines", '{"es":"Plato","ca":"Plat"}'),
    line("line-moves-out-of-group", "wo-moves-lines", '{"es":"Plato","ca":"Plat"}'),
    line("line-moves-frozen", "wo-moves-lines", '{"es":"Plato","ca":"Plat"}'),
    line("line-moves-deleted", "wo-moves-lines", '{"es":"Plato","ca":"Plat"}'),
    `update working_order_lines set group_id = 'group' where id = 'line-moves-out-of-group'`,
    `update working_orders set status = 'placed' ` +
      `where id in ('wo-moves-party', 'wo-moves-delivery', 'wo-moves-revision', ` +
      `'wo-moves-frozen', 'wo-moves-lines')`,
    `update working_orders set status = 'settled', settled_at = '${STAMP}' ` +
      `where id in ('wo-served-settled', 'wo-served-orphan', 'wo-served-relocale')`,

    // Lines for the sent-stamp exception: a line sent to the kitchen after its bill was presented or
    // paid.
    // `line-sent-stamped` was sent while its order was open.
    workingOrder("wo-sent-placed", "open"),
    workingOrder("wo-sent-settled", "open"),
    workingOrder("wo-sent-abandoned", "open"),
    line("line-sent-placed", "wo-sent-placed", '{"es":"Plato","ca":"Plat"}'),
    line("line-sent-placed-frozen", "wo-sent-placed", '{"es":"Plato","ca":"Plat"}'),
    line("line-sent-settled", "wo-sent-settled", '{"es":"Plato","ca":"Plat"}'),
    line("line-sent-frozen", "wo-sent-settled", '{"es":"Plato","ca":"Plat"}'),
    line("line-sent-stamped", "wo-sent-settled", '{"es":"Plato","ca":"Plat"}'),
    line("line-sent-abandoned", "wo-sent-abandoned", '{"es":"Plato","ca":"Plat"}'),
    `update working_order_lines set sent_at = '${STAMP}' where id = 'line-sent-stamped'`,
    `update working_orders set status = 'placed' where id = 'wo-sent-placed'`,
    `update working_orders set status = 'settled', settled_at = '${STAMP}' ` +
      `where id = 'wo-sent-settled'`,
    `update working_orders set status = 'abandoned' where id = 'wo-sent-abandoned'`,

    // A venue whose invoice locales change once every line below is written, as a receipt-language
    // change leaves them. Lines carrying a variant map reach both locale triggers; the `plain` ones
    // reach only the descriptions trigger, so its refusal is the one that comes back.
    `insert into locations (id, name, invoice_locales, operation_description) ` +
      `values ('loc-relocale-text', 'Venue 3', '["es","ca"]', 'Restaurante')`,
    `insert into tills (id, location_id, name, created_at) ` +
      `values ('till-relocale-text', 'loc-relocale-text', 'Till 4', '${STAMP}')`,
    workingOrder("wo-text-a", "open", { tillId: "till-relocale-text" }),
    workingOrder("wo-text-b", "open", { tillId: "till-relocale-text" }),
    workingOrder("wo-text-paid", "open", { tillId: "till-relocale-text" }),
    workingOrder("wo-text-placed", "open", { tillId: "till-relocale-text" }),
    line("line-text-paid-served", "wo-text-paid", OLD_TEXT, OLD_VARIANT),
    line("line-text-paid-sent", "wo-text-paid", OLD_TEXT, OLD_VARIANT),
    line("line-text-placed", "wo-text-placed", OLD_TEXT, OLD_VARIANT),
    line("line-text-open", "wo-text-a", OLD_TEXT, OLD_VARIANT),
    line("line-text-plain", "wo-text-a", OLD_TEXT),
    line("line-text-variant", "wo-text-a", OLD_TEXT, OLD_VARIANT),
    line("line-text-plain-move", "wo-text-a", OLD_TEXT),
    line("line-text-variant-move", "wo-text-a", OLD_TEXT, OLD_VARIANT),
    `update working_orders set status = 'settled', settled_at = '${STAMP}' where id = 'wo-text-paid'`,
    `update working_orders set status = 'placed' where id = 'wo-text-placed'`,
    `update locations set invoice_locales = '["es"]' where id = 'loc-relocale-text'`,
  ];
  for (const statement of statements) connection.exec(statement);
}

/** A venue directory the product migrated, reopened raw and seeded. */
async function migratedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "wt-behavioural-guard-"));
  scratch.push(directory);
  await applyMigrations(directory, migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null));
  const connection = new DatabaseSync(join(directory, "venue.db"));
  connection.exec("pragma recursive_triggers = on");
  connection.exec("pragma foreign_keys = off");
  connection.exec("pragma ignore_check_constraints = on");
  seed(connection);
  return connection;
}

const connection = await migratedDatabase();

describe("the behavioural triggers a migrated venue file carries", () => {
  it("creates exactly the triggers this file pins, and no others", () => {
    const created = connection
      .prepare(`select name from sqlite_master where type = 'trigger' order by name`)
      .all()
      .map((row) => String(row.name))
      .filter(
        (name) => !name.endsWith("_append_only_update") && !name.endsWith("_append_only_delete"),
      );
    expect(created).toEqual([...EXPECTED_TRIGGERS, ...IMAGE_REFERENCE_TRIGGERS].sort());
  });
});

describe("sale_settlements_check_coverage", () => {
  it("refuses a settlement whose tenders do not cover the sale", () => {
    expect(
      refusalFor(
        connection,
        `insert into sale_settlements (id, sale_id, settled_at) values ('ss-bare', 'sale-bare', '${STAMP}')`,
      ),
    ).toBe(COVERAGE_REFUSAL);
  });

  it("raises through the trigger class, not through a foreign key", () => {
    expect(
      errcodeFor(
        connection,
        `insert into sale_settlements (id, sale_id, settled_at) values ('ss-bare2', 'sale-bare', '${STAMP}')`,
      ),
    ).toBe(1811);
  });

  it("accepts a settlement whose tenders cover the sale", () => {
    expect(
      refusalFor(
        connection,
        `insert into sale_settlements (id, sale_id, settled_at) values ('ss-cov', 'sale-covered', '${STAMP}')`,
      ),
    ).toBeUndefined();
  });

  it("counts the tip on top of the sale, so a tip a tender swallowed is refused", () => {
    expect(
      refusalFor(
        connection,
        `insert into sale_settlements (id, sale_id, settled_at) values ('ss-tip-ok', 'sale-tipped', '${STAMP}')`,
      ),
    ).toBeUndefined();
    expect(
      refusalFor(
        connection,
        `insert into sale_settlements (id, sale_id, settled_at) values ('ss-tip-bad', 'sale-tip-swallowed', '${STAMP}')`,
      ),
    ).toBe(COVERAGE_REFUSAL);
  });

  it("nets in a rectificativa that corrects the sale", () => {
    expect(
      refusalFor(
        connection,
        `insert into sale_settlements (id, sale_id, settled_at) values ('ss-corr', 'sale-corrected', '${STAMP}')`,
      ),
    ).toBeUndefined();
  });

  // The rule says nothing when the sale row is gone. Pinned because it is the branch a rewrite
  // would most easily turn into a refusal.
  it("says nothing about a settlement whose sale row does not exist", () => {
    expect(
      refusalFor(
        connection,
        `insert into sale_settlements (id, sale_id, settled_at) values ('ss-ghost', 'ghost-sale', '${STAMP}')`,
      ),
    ).toBeUndefined();
  });
});

describe("tenders_reject_post_settlement", () => {
  it("refuses a tender once the sale is settled", () => {
    expect(refusalFor(connection, tender("tender-late", "sale-settled", 100))).toBe(
      POST_SETTLEMENT_REFUSAL,
    );
  });

  it("accepts a tender while the sale is unsettled", () => {
    expect(refusalFor(connection, tender("tender-early", "sale-unsettled", 100))).toBeUndefined();
  });
});

describe("working_orders_enforce_transition", () => {
  it("refuses a placed order going back to open", () => {
    expect(
      refusalFor(connection, `update working_orders set status = 'open' where id = 'wo-placed'`),
    ).toBe(TRANSITION_REFUSAL);
  });

  it("refuses a settled order going back to open", () => {
    expect(
      refusalFor(
        connection,
        `update working_orders set status = 'open' where id = 'wo-settled-reopen'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
  });

  it("accepts an open order moving to placed", () => {
    expect(
      refusalFor(connection, `update working_orders set status = 'placed' where id = 'wo-flip'`),
    ).toBeUndefined();
  });

  // The kitchen-handover stamp is the ONLY write a settled order takes.
  it("accepts the kitchen-handover stamp on a settled order", () => {
    expect(
      refusalFor(
        connection,
        `update working_orders set collected_at = '${STAMP}' where id = 'wo-settled'`,
      ),
    ).toBeUndefined();
  });

  it("refuses the handover stamp when anything else changes with it", () => {
    expect(
      refusalFor(
        connection,
        `update working_orders set collected_at = '${STAMP}', label = 'renamed' ` +
          `where id = 'wo-settled-extra'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
  });

  it("refuses the handover stamp when the order's revision changes with it", () => {
    expect(
      refusalFor(
        connection,
        `update working_orders set collected_at = '${STAMP}', revision = revision + 1 ` +
          `where id = 'wo-settled-revision'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
  });

  // Changing `party_id` ALONE would be refused whether or not the column is in the list, because the
  // settled exception also needs `collected_at` to go from null to set; so the stamp rides along.
  it("refuses the handover stamp when the order's party changes with it", () => {
    expect(
      refusalFor(
        connection,
        `update working_orders set collected_at = '${STAMP}', party_id = 'party-frozen' ` +
          `where id = 'wo-settled-party'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
  });

  it("refuses the handover stamp when a card payment attempt is marked with it", () => {
    expect(
      refusalFor(
        connection,
        `update working_orders set collected_at = '${STAMP}', payment_attempt_at = '${STAMP}' ` +
          `where id = 'wo-settled-payment'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
  });
});

/**
 * The columns of `working_orders` the placed → placed exception's list does not name: `status`,
 * which it requires to stay `placed`, and the three a move may change.
 */
const MOVABLE_ORDER_COLUMNS = new Set(["status", "party_id", "delivery_table_id", "revision"]);
/** Every column of `working_orders` a presented bill's move must leave as it is. */
const FROZEN_PLACED_ORDER_COLUMNS = connection
  .prepare(`select name from pragma_table_info('working_orders') order by cid`)
  .all()
  .map((row) => String(row.name))
  .filter((name) => !MOVABLE_ORDER_COLUMNS.has(name));

describe("working_orders_enforce_transition's exception for a presented bill", () => {
  it("reads the table's columns, so the per-column cases below are not vacuous", () => {
    expect(FROZEN_PLACED_ORDER_COLUMNS).toEqual(
      expect.arrayContaining(["id", "label", "payment_attempt_at", "settled_at"]),
    );
  });

  it("accepts a presented bill changing its party alone", () => {
    expect(
      refusalFor(
        connection,
        `update working_orders set party_id = 'party-frozen' where id = 'wo-moves-party'`,
      ),
    ).toBeUndefined();
  });

  it("accepts a presented bill losing its delivery table alone", () => {
    connection.exec(
      `update working_orders set delivery_table_id = 'dt-bystander' where id = 'wo-moves-delivery'`,
    );
    expect(
      refusalFor(
        connection,
        `update working_orders set delivery_table_id = null where id = 'wo-moves-delivery'`,
      ),
    ).toBeUndefined();
  });

  it("accepts a presented bill's revision moving on alone", () => {
    expect(
      refusalFor(
        connection,
        `update working_orders set revision = revision + 1 where id = 'wo-moves-revision'`,
      ),
    ).toBeUndefined();
  });

  it("refuses a presented bill's label, or its payment attempt, changed alone", () => {
    expect(
      refusalFor(
        connection,
        `update working_orders set label = 'Mesa 9' where id = 'wo-moves-frozen'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
    expect(
      refusalFor(
        connection,
        `update working_orders set payment_attempt_at = '${STAMP}' where id = 'wo-moves-frozen'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
  });

  it.each(FROZEN_PLACED_ORDER_COLUMNS)(
    "refuses a presented bill changing its party and also %s",
    (column) => {
      expect(
        refusalFor(
          connection,
          `update working_orders set party_id = 'party-frozen', ${column} = 'changed' ` +
            `where id = 'wo-moves-frozen'`,
        ),
      ).toBe(TRANSITION_REFUSAL);
    },
  );

  it("still refuses a presented bill going back to open, alone or with a party change", () => {
    for (const also of ["", ", party_id = 'party-frozen'"]) {
      expect(
        refusalFor(
          connection,
          `update working_orders set status = 'open'${also} where id = 'wo-moves-frozen'`,
        ),
      ).toBe(TRANSITION_REFUSAL);
    }
  });
});

/** Every column of `working_orders` a placed order's handover stamp must leave as it is. */
const FROZEN_HANDOVER_COLUMNS = connection
  .prepare(`select name from pragma_table_info('working_orders') order by cid`)
  .all()
  .map((row) => String(row.name))
  .filter((name) => name !== "collected_at");

/** A counter order already sent (`placed`), written for one case alone. */
function placedCounterOrder(id, collectedAt) {
  connection.exec(workingOrder(id, "placed", collectedAt ? { collectedAt } : {}));
}

describe("working_orders_enforce_transition's handover exception for a placed order", () => {
  it("reads the table's columns, so the per-column cases below are not vacuous", () => {
    expect(FROZEN_HANDOVER_COLUMNS).toEqual(
      expect.arrayContaining(["id", "status", "label", "party_id", "revision", "settled_at"]),
    );
  });

  it("accepts a placed order's handover stamp alone", () => {
    placedCounterOrder("wo-handover-alone");
    expect(
      refusalFor(
        connection,
        `update working_orders set collected_at = '${STAMP}' where id = 'wo-handover-alone'`,
      ),
    ).toBeUndefined();
  });

  it("refuses the stamp on a placed order when its label changes with it", () => {
    placedCounterOrder("wo-handover-label");
    expect(
      refusalFor(
        connection,
        `update working_orders set collected_at = '${STAMP}', label = 'renamed' ` +
          `where id = 'wo-handover-label'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
  });

  it.each(FROZEN_HANDOVER_COLUMNS)(
    "refuses the stamp on a placed order when %s changes with it",
    (column) => {
      const id = `wo-handover-with-${column}`;
      placedCounterOrder(id);
      expect(
        refusalFor(
          connection,
          `update working_orders set collected_at = '${STAMP}', ${column} = 'changed' ` +
            `where id = '${id}'`,
        ),
      ).toBe(TRANSITION_REFUSAL);
    },
  );

  it("refuses moving a placed order's handover stamp from one time to another", () => {
    placedCounterOrder("wo-handover-restamp", STAMP);
    expect(
      refusalFor(
        connection,
        `update working_orders set collected_at = '2026-09-22T11:00:00.000Z' ` +
          `where id = 'wo-handover-restamp'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
  });

  it("refuses clearing a placed order's handover stamp", () => {
    placedCounterOrder("wo-handover-cleared", STAMP);
    expect(
      refusalFor(
        connection,
        `update working_orders set collected_at = null where id = 'wo-handover-cleared'`,
      ),
    ).toBe(TRANSITION_REFUSAL);
  });

  it("accepts settling a handed-over placed order with its stamp kept", () => {
    placedCounterOrder("wo-handover-settles", STAMP);
    expect(
      refusalFor(
        connection,
        `update working_orders set status = 'settled', settled_at = '${STAMP}' ` +
          `where id = 'wo-handover-settles'`,
      ),
    ).toBeUndefined();
  });
});

describe("working_order_lines_require_open_parent", () => {
  it("refuses a line inserted under a placed order", () => {
    expect(refusalFor(connection, line("line-placed", "wo-placed", '{"es":"a","ca":"b"}'))).toBe(
      OPEN_PARENT_REFUSAL,
    );
  });

  // TWO rules refuse this write: an order that does not exist is also an order whose location
  // cannot be resolved. SQLite does not fix the order several triggers on one event fire in, so
  // which message comes back is not pinned — only that the write is refused with one of the two.
  it("refuses a line inserted under an order that does not exist", () => {
    expect([OPEN_PARENT_REFUSAL, LOCALES_REFUSAL]).toContain(
      refusalFor(connection, line("line-ghost", "ghost-order", '{"es":"a","ca":"b"}')),
    );
  });

  // The missing-parent branch on its own, with no other trigger able to reach it: a DELETE fires
  // only `require_open_parent_delete`. The line is orphaned by deleting its order out from under
  // it, which this connection can do because it runs with foreign keys off.
  it("refuses a line deleted after its order row disappeared", () => {
    connection.exec(`delete from working_orders where id = 'wo-orphaned-parent'`);
    expect(
      refusalFor(connection, `delete from working_order_lines where id = 'line-orphaned'`),
    ).toBe(OPEN_PARENT_REFUSAL);
  });

  it("accepts a line inserted under an open order", () => {
    expect(
      refusalFor(connection, line("line-accepted", "wo-open", '{"es":"Plato","ca":"Plat"}')),
    ).toBeUndefined();
  });

  it("refuses a line updated after its order left open", () => {
    connection.exec(`update working_orders set status = 'placed' where id = 'wo-lines-update'`);
    expect(
      refusalFor(connection, `update working_order_lines set note = 'x' where id = 'line-update'`),
    ).toBe(OPEN_PARENT_REFUSAL);
  });

  it("refuses a line deleted after its order left open", () => {
    connection.exec(`update working_orders set status = 'placed' where id = 'wo-lines-delete'`);
    expect(refusalFor(connection, `delete from working_order_lines where id = 'line-delete'`)).toBe(
      OPEN_PARENT_REFUSAL,
    );
  });
});

/**
 * Every column of the line except the two a served mark moves, read from the migrated table rather
 * than listed here, so a column added later is tried the day it lands. Each value differs from the
 * seeded one; the two description maps keep the venue's exact locales so the locale triggers accept
 * them and only the open-parent rule is left to refuse.
 */
const SERVED_COLUMNS = new Set(["served_quantity", "served_at"]);
const FROZEN_LINE_COLUMNS = connection
  .prepare(`select name from pragma_table_info('working_order_lines') order by cid`)
  .all()
  .map((row) => String(row.name))
  .filter((name) => !SERVED_COLUMNS.has(name));
const CHANGED_VALUE = {
  // Another order that is not open and resolves to the same venue, so the locale triggers accept it.
  working_order_id: `'wo-placed'`,
  descriptions: `'{"ca":"Plat nou","es":"Plato nuevo"}'`,
  variant_descriptions: `'{"ca":"Variant","es":"Variante"}'`,
};

describe("working_order_lines_require_open_parent_update's served exception", () => {
  it("reads the table's columns, so the per-column cases below are not vacuous", () => {
    expect(FROZEN_LINE_COLUMNS).toEqual(
      expect.arrayContaining(["id", "working_order_id", "group_id", "credited_to", "note"]),
    );
  });

  it("accepts a served mark, and its undo, on a line whose order is placed", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_quantity = 1000, served_at = '${STAMP}' ` +
          `where id = 'line-served-placed'`,
      ),
    ).toBeUndefined();
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_quantity = 0, served_at = null ` +
          `where id = 'line-served-placed'`,
      ),
    ).toBeUndefined();
  });

  it("accepts part of a line served on a settled order, with served_at left empty", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_quantity = 500 where id = 'line-served-settled'`,
      ),
    ).toBeUndefined();
    expect(
      connection
        .prepare(
          `select served_quantity, served_at from working_order_lines where id = 'line-served-settled'`,
        )
        .get(),
    ).toEqual({ served_quantity: 500, served_at: null });
  });

  it("accepts served_at changed on its own on a settled order", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_at = '${STAMP}' where id = 'line-served-settled'`,
      ),
    ).toBeUndefined();
  });

  it.each(FROZEN_LINE_COLUMNS)(
    "refuses a served mark on a settled order that also changes %s",
    (column) => {
      const value = CHANGED_VALUE[column] ?? `'changed'`;
      expect(
        refusalFor(
          connection,
          `update working_order_lines set served_quantity = 1000, served_at = '${STAMP}', ` +
            `${column} = ${value} where id = 'line-served-frozen'`,
        ),
      ).toBe(OPEN_PARENT_REFUSAL);
    },
  );

  it("refuses an update of a settled order's line that changes no served column", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_quantity = served_quantity, served_at = served_at ` +
          `where id = 'line-served-unchanged'`,
      ),
    ).toBe(OPEN_PARENT_REFUSAL);
    expect(
      refusalFor(
        connection,
        `update working_order_lines set note = 'x' where id = 'line-served-unchanged'`,
      ),
    ).toBe(OPEN_PARENT_REFUSAL);
  });

  it("refuses a served mark on a line whose order row disappeared", () => {
    connection.exec(`delete from working_orders where id = 'wo-served-orphan'`);
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_quantity = 1000, served_at = '${STAMP}' ` +
          `where id = 'line-served-orphan'`,
      ),
    ).toBe(OPEN_PARENT_REFUSAL);
  });

  it("leaves a line on an open order writable in every column, served ones included", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_quantity = 1000, served_at = '${STAMP}', ` +
          `note = 'x', group_id = 'group', credited_to = 'person', unit_price_gross = 200 ` +
          `where id = 'line-served-open'`,
      ),
    ).toBeUndefined();
  });

  it("accepts a served mark on a settled line once its venue's invoice locales changed", () => {
    connection.exec(`update locations set invoice_locales = '["es"]' where id = 'loc-relocale'`);
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_quantity = 1000, served_at = '${STAMP}' ` +
          `where id = 'line-served-relocale'`,
      ),
    ).toBeUndefined();
  });
});

/** Every column of the line except its kitchen group, read from the migrated table. */
const FROZEN_GROUPED_LINE_COLUMNS = connection
  .prepare(`select name from pragma_table_info('working_order_lines') order by cid`)
  .all()
  .map((row) => String(row.name))
  .filter((name) => name !== "group_id");

describe("working_order_lines_require_open_parent_update's kitchen-group exception", () => {
  it("reads the table's columns, so the per-column cases below are not vacuous", () => {
    expect(FROZEN_GROUPED_LINE_COLUMNS).toEqual(
      expect.arrayContaining(["id", "quantity", "unit_price_gross", "served_quantity"]),
    );
  });

  it("accepts a presented bill's line joining a group, and leaving one", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set group_id = 'group' where id = 'line-moves-into-group'`,
      ),
    ).toBeUndefined();
    expect(
      refusalFor(
        connection,
        `update working_order_lines set group_id = null where id = 'line-moves-out-of-group'`,
      ),
    ).toBeUndefined();
  });

  it("refuses a presented bill's line changing its quantity or its price alone", () => {
    for (const change of ["quantity = 2000", "unit_price_gross = 1"]) {
      expect(
        refusalFor(
          connection,
          `update working_order_lines set ${change} where id = 'line-moves-frozen'`,
        ),
      ).toBe(OPEN_PARENT_REFUSAL);
    }
  });

  it.each(FROZEN_GROUPED_LINE_COLUMNS)(
    "refuses a presented bill's line changing its group and also %s",
    (column) => {
      const value = CHANGED_VALUE[column] ?? `'changed'`;
      expect(
        refusalFor(
          connection,
          `update working_order_lines set group_id = 'group', ${column} = ${value} ` +
            `where id = 'line-moves-frozen'`,
        ),
      ).toBe(OPEN_PARENT_REFUSAL);
    },
  );

  it("still refuses a line inserted under a presented bill, or deleted from one", () => {
    expect(
      refusalFor(connection, line("line-moves-added", "wo-moves-lines", '{"es":"a","ca":"b"}')),
    ).toBe(OPEN_PARENT_REFUSAL);
    expect(
      refusalFor(connection, `delete from working_order_lines where id = 'line-moves-deleted'`),
    ).toBe(OPEN_PARENT_REFUSAL);
  });

  it("refuses a paid bill's line changing its group alone", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set group_id = 'group' where id = 'line-served-unchanged'`,
      ),
    ).toBe(OPEN_PARENT_REFUSAL);
  });
});

/** Every column of the line except its sent stamp, read from the migrated table. */
const FROZEN_SENT_LINE_COLUMNS = connection
  .prepare(`select name from pragma_table_info('working_order_lines') order by cid`)
  .all()
  .map((row) => String(row.name))
  .filter((name) => name !== "sent_at");

const LATER = "2026-09-22T11:00:00.000Z";

describe("working_order_lines_require_open_parent_update's sent-stamp exception", () => {
  it("reads the table's columns, so the per-column cases below are not vacuous", () => {
    expect(FROZEN_SENT_LINE_COLUMNS).toEqual(
      expect.arrayContaining(["id", "quantity", "unit_price_gross", "served_at", "group_id"]),
    );
  });

  it("accepts the first sent stamp on a line of a paid bill, and of a presented one", () => {
    for (const id of ["line-sent-settled", "line-sent-placed"]) {
      expect(
        refusalFor(
          connection,
          `update working_order_lines set sent_at = '${LATER}' where id = '${id}'`,
        ),
      ).toBeUndefined();
    }
    expect(
      connection
        .prepare(
          `select sent_at as sentAt from working_order_lines ` +
            `where id in ('line-sent-settled', 'line-sent-placed')`,
        )
        .all()
        .map((row) => row.sentAt),
    ).toEqual([LATER, LATER]);
  });

  it("refuses a paid bill's line changing or clearing a sent stamp it already has", () => {
    for (const value of [`'${LATER}'`, "null"]) {
      expect(
        refusalFor(
          connection,
          `update working_order_lines set sent_at = ${value} where id = 'line-sent-stamped'`,
        ),
      ).toBe(OPEN_PARENT_REFUSAL);
    }
  });

  // On a presented bill a line may change its group alone, so `group_id` matters most there.
  it.each(
    FROZEN_SENT_LINE_COLUMNS.flatMap((column) => [
      ["presented", column, "line-sent-placed-frozen"],
      ["paid", column, "line-sent-frozen"],
    ]),
  )("refuses a %s bill's line taking its sent stamp and also changing %s", (_bill, column, id) => {
    const value = CHANGED_VALUE[column] ?? `'changed'`;
    expect(
      refusalFor(
        connection,
        `update working_order_lines set sent_at = '${LATER}', ${column} = ${value} ` +
          `where id = '${id}'`,
      ),
    ).toBe(OPEN_PARENT_REFUSAL);
  });

  it("still refuses a paid bill's line changing its quantity or its price alone", () => {
    for (const change of ["quantity = 2000", "unit_price_gross = 1"]) {
      expect(
        refusalFor(
          connection,
          `update working_order_lines set ${change} where id = 'line-sent-frozen'`,
        ),
      ).toBe(OPEN_PARENT_REFUSAL);
    }
  });

  it("refuses a sent stamp on an abandoned bill's line", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set sent_at = '${LATER}' where id = 'line-sent-abandoned'`,
      ),
    ).toBe(OPEN_PARENT_REFUSAL);
  });
});

describe("working_order_lines_require_open_parent_update moving a line between orders", () => {
  it("refuses moving a settled order's line onto an open order, alone or with other changes", () => {
    for (const also of [
      "",
      ", name = 'changed', unit_price_gross = 1",
      ", served_quantity = 1000",
    ]) {
      expect(
        refusalFor(
          connection,
          `update working_order_lines set working_order_id = 'wo-open'${also} ` +
            `where id = 'line-served-reparent'`,
        ),
      ).toBe(OPEN_PARENT_REFUSAL);
    }
  });

  it("accepts moving a line from one open order to another", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set working_order_id = 'wo-open' where id = 'line-open-moves'`,
      ),
    ).toBeUndefined();
  });
});

describe("working_order_lines_check_locales", () => {
  it("refuses a description map missing one of the venue's locales", () => {
    expect(refusalFor(connection, line("line-short", "wo-open", '{"es":"Plato"}'))).toBe(
      LOCALES_REFUSAL,
    );
  });

  it("refuses a description map carrying a locale the venue does not invoice in", () => {
    expect(
      refusalFor(connection, line("line-extra", "wo-open", '{"es":"a","ca":"b","zz":"c"}')),
    ).toBe(LOCALES_REFUSAL);
  });

  // Written in the other order than the venue configures them: the comparison is between two SETS,
  // and nothing here may depend on the order either side arrives in.
  it("accepts the exact locales in the other order", () => {
    expect(
      refusalFor(connection, line("line-reordered", "wo-open", '{"ca":"Plat","es":"Plato"}')),
    ).toBeUndefined();
  });

  // A line whose order resolves to no location deliberately gets the same refusal: from a caller's
  // side it is the same fault.
  it("refuses a line whose order resolves to no location, in the same words", () => {
    expect(refusalFor(connection, line("line-orphan", "wo-orphan", '{"es":"a","ca":"b"}'))).toBe(
      LOCALES_REFUSAL,
    );
  });

  it("refuses an update that breaks the locale set", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set descriptions = '{"es":"Plato"}' where id = 'line-open'`,
      ),
    ).toBe(LOCALES_REFUSAL);
  });
});

describe("working_order_lines_check_variant_locales", () => {
  it("refuses a variant map missing one of the venue's locales", () => {
    expect(
      refusalFor(
        connection,
        line("line-var-short", "wo-open", '{"es":"a","ca":"b"}', '{"es":"Grande"}'),
      ),
    ).toBe(VARIANT_LOCALES_REFUSAL);
  });

  it("accepts a variant map carrying exactly the venue's locales", () => {
    expect(
      refusalFor(
        connection,
        line("line-var-ok", "wo-open", '{"es":"a","ca":"b"}', '{"es":"Grande","ca":"Gran"}'),
      ),
    ).toBeUndefined();
  });

  // The nullable column's short-circuit: every accepted line above carries no variant map at all.
  it("says nothing about a line with no variant map", () => {
    expect(
      refusalFor(connection, line("line-var-null", "wo-open", '{"es":"a","ca":"b"}')),
    ).toBeUndefined();
  });

  it("refuses an update that breaks the variant locale set", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set variant_descriptions = '{"zz":"x"}' where id = 'line-var-ok'`,
      ),
    ).toBe(VARIANT_LOCALES_REFUSAL);
  });
});

describe("working_order_lines_check_locales_update and its variant twin once a venue's invoice locales changed", () => {
  it("accepts a served mark, its undo and a first sent stamp on a paid line", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_quantity = 1000, served_at = '${STAMP}' ` +
          `where id = 'line-text-paid-served'`,
      ),
    ).toBeUndefined();
    expect(
      refusalFor(
        connection,
        `update working_order_lines set served_quantity = 0, served_at = null ` +
          `where id = 'line-text-paid-served'`,
      ),
    ).toBeUndefined();
    expect(
      refusalFor(
        connection,
        `update working_order_lines set sent_at = '${STAMP}' where id = 'line-text-paid-sent'`,
      ),
    ).toBeUndefined();
  });

  it("accepts a kitchen group change on a presented bill's line", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set group_id = 'group' where id = 'line-text-placed'`,
      ),
    ).toBeUndefined();
  });

  it("accepts an open line's quantity change, and both maps set to their own values", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set quantity = 2000, line_total = 242 where id = 'line-text-open'`,
      ),
    ).toBeUndefined();
    expect(
      refusalFor(
        connection,
        `update working_order_lines set descriptions = descriptions, ` +
          `variant_descriptions = variant_descriptions where id = 'line-text-open'`,
      ),
    ).toBeUndefined();
  });

  it("refuses new text written under the old locales, in either map", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set descriptions = '{"es":"Plato grande","ca":"Plat gran"}' ` +
          `where id = 'line-text-plain'`,
      ),
    ).toBe(LOCALES_REFUSAL);
    expect(
      refusalFor(
        connection,
        `update working_order_lines set variant_descriptions = '{"es":"Mediano","ca":"Mitja"}' ` +
          `where id = 'line-text-variant'`,
      ),
    ).toBe(VARIANT_LOCALES_REFUSAL);
  });

  it("refuses moving a line whose descriptions carry the old locales", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set working_order_id = 'wo-text-b' ` +
          `where id = 'line-text-plain-move'`,
      ),
    ).toBe(LOCALES_REFUSAL);
  });

  it("refuses moving a line whose variant map alone carries the old locales", () => {
    expect(
      refusalFor(
        connection,
        `update working_order_lines set descriptions = '{"es":"Plato"}' ` +
          `where id = 'line-text-variant-move'`,
      ),
    ).toBeUndefined();
    expect(
      refusalFor(
        connection,
        `update working_order_lines set working_order_id = 'wo-text-b' ` +
          `where id = 'line-text-variant-move'`,
      ),
    ).toBe(VARIANT_LOCALES_REFUSAL);
  });

  it("accepts a fresh line keyed to the new locales", () => {
    expect(
      refusalFor(connection, line("line-text-fresh", "wo-text-a", '{"es":"Plato"}')),
    ).toBeUndefined();
  });
});

describe("parties_clear_table_status", () => {
  const statusOf = (table) =>
    connection.prepare(`select status_id from dining_tables where id = ?`).get(table).status_id;

  it("clears the status of every table still a member when the party closes, and no other", () => {
    connection.exec(
      `update parties set state = 'closed', closed_at = '${STAMP}' where id = 'party-finishes'`,
    );
    expect(statusOf("dt-member-a")).toBeNull();
    expect(statusOf("dt-member-b")).toBeNull();
    expect(statusOf("dt-left-earlier")).toBe("status-busy");
    expect(statusOf("dt-bystander")).toBe("status-busy");
  });

  it("leaves it alone when an open party only changes its revision", () => {
    connection.exec(`update parties set revision = revision + 1 where id = 'party-bumped'`);
    expect(statusOf("dt-bumped")).toBe("status-busy");
  });

  it("leaves a table's status alone when its party's bill settles", () => {
    connection.exec(
      `update working_orders set status = 'settled', settled_at = '${STAMP}' where id = 'wo-tab'`,
    );
    expect(statusOf("dt-closes")).toBe("status-busy");
  });
});

describe("working_orders_release_main_bill", () => {
  const mainBillOf = (party) =>
    connection.prepare(`select main_bill_id from parties where id = ?`).get(party).main_bill_id;
  // Set inside each case rather than in `seed`, so the seed does not depend on the column.
  const nameMainBill = (party, bill) =>
    connection.exec(`update parties set main_bill_id = '${bill}' where id = '${party}'`);

  it("clears the main bill when it moves from open to settled", () => {
    nameMainBill("party-main-settles", "wo-main-settles");
    connection.exec(
      `update working_orders set status = 'settled', settled_at = '${STAMP}' ` +
        `where id = 'wo-main-settles'`,
    );
    expect(mainBillOf("party-main-settles")).toBeNull();
  });

  it("clears the main bill when it moves from open to placed", () => {
    nameMainBill("party-main-places", "wo-main-places");
    connection.exec(`update working_orders set status = 'placed' where id = 'wo-main-places'`);
    expect(mainBillOf("party-main-places")).toBeNull();
  });

  it("clears the main bill on the old party when the bill moves to another party", () => {
    nameMainBill("party-main-moves", "wo-main-moves");
    nameMainBill("party-main-destination", "wo-main-destination");
    connection.exec(
      `update working_orders set party_id = 'party-main-destination' where id = 'wo-main-moves'`,
    );
    expect(mainBillOf("party-main-moves")).toBeNull();
    expect(mainBillOf("party-main-destination")).toBe("wo-main-destination");
  });

  it("leaves the main bill set when the bill changes only its revision", () => {
    nameMainBill("party-main-revision", "wo-main-revision");
    connection.exec(
      `update working_orders set revision = revision + 1 where id = 'wo-main-revision'`,
    );
    expect(mainBillOf("party-main-revision")).toBe("wo-main-revision");
  });

  it("leaves the main bill set when ANOTHER bill of the party moves to another party", () => {
    nameMainBill("party-main-other", "wo-main-other");
    connection.exec(
      `update working_orders set party_id = 'party-main-destination' ` +
        `where id = 'wo-main-other-split'`,
    );
    expect(mainBillOf("party-main-other")).toBe("wo-main-other");
  });
});

describe("device_binding_rule_insert", () => {
  it("refuses a kds device that binds no station", () => {
    expect(
      refusalFor(
        connection,
        `insert into devices (id, location_id, device_profile_id, label, token_hash, active, enrolled_at, created_at) ` +
          `values ('dev-kds-bare', 'loc', 'dp-bind-kds', 'Pase 1', 'hash', 1, '${STAMP}', '${STAMP}')`,
      ),
    ).toBe(KDS_BINDING_REFUSAL);
  });

  it("refuses a kds device that also binds a register", () => {
    expect(
      refusalFor(
        connection,
        `insert into devices (id, location_id, device_profile_id, station_id, till_id, label, token_hash, active, enrolled_at, created_at) ` +
          `values ('dev-kds-both', 'loc', 'dp-bind-kds', 'station', 'till', 'Pase 2', 'hash', 1, '${STAMP}', '${STAMP}')`,
      ),
    ).toBe(KDS_BINDING_REFUSAL);
  });

  it("refuses a non-kds device that binds no register", () => {
    expect(
      refusalFor(
        connection,
        `insert into devices (id, location_id, device_profile_id, label, token_hash, active, enrolled_at, created_at) ` +
          `values ('dev-till-bare', 'loc', 'dp-bind-till', 'Caja 9', 'hash', 1, '${STAMP}', '${STAMP}')`,
      ),
    ).toBe(REGISTER_BINDING_REFUSAL);
  });

  it("refuses a non-kds device that also binds a station", () => {
    expect(
      refusalFor(
        connection,
        `insert into devices (id, location_id, device_profile_id, station_id, till_id, label, token_hash, active, enrolled_at, created_at) ` +
          `values ('dev-till-both', 'loc', 'dp-bind-till', 'station', 'till', 'Caja 10', 'hash', 1, '${STAMP}', '${STAMP}')`,
      ),
    ).toBe(REGISTER_BINDING_REFUSAL);
  });

  // Reachable here and nowhere else: this file runs with `pragma foreign_keys = off`, and in the
  // product the NOT NULL column behind an `ON DELETE RESTRICT` key cannot name a missing profile.
  // Without this refusal the row would be ACCEPTED — `form_factor` is NULL, so neither arm fires.
  it("refuses a device whose profile does not exist", () => {
    expect(
      refusalFor(
        connection,
        `insert into devices (id, location_id, device_profile_id, till_id, label, token_hash, active, enrolled_at, created_at) ` +
          `values ('dev-ghost', 'loc', 'dp-missing', 'till', 'Fantasma', 'hash', 1, '${STAMP}', '${STAMP}')`,
      ),
    ).toBe(MISSING_PROFILE_REFUSAL);
  });

  it("raises through the trigger class, not through a foreign key", () => {
    expect(
      errcodeFor(
        connection,
        `insert into devices (id, location_id, device_profile_id, label, token_hash, active, enrolled_at, created_at) ` +
          `values ('dev-kds-bare2', 'loc', 'dp-bind-kds', 'Pase 3', 'hash', 1, '${STAMP}', '${STAMP}')`,
      ),
    ).toBe(1811);
  });

  it("accepts a kds device bound to a station and no register", () => {
    expect(
      refusalFor(
        connection,
        `insert into devices (id, location_id, device_profile_id, station_id, label, token_hash, active, enrolled_at, created_at) ` +
          `values ('dev-kds-ok', 'loc', 'dp-bind-kds', 'station', 'Pase 4', 'hash', 1, '${STAMP}', '${STAMP}')`,
      ),
    ).toBeUndefined();
  });

  it("accepts a non-kds device bound to a register and no station", () => {
    expect(
      refusalFor(
        connection,
        `insert into devices (id, location_id, device_profile_id, till_id, label, token_hash, active, enrolled_at, created_at) ` +
          `values ('dev-till-ok', 'loc', 'dp-bind-till', 'till', 'Caja 11', 'hash', 1, '${STAMP}', '${STAMP}')`,
      ),
    ).toBeUndefined();
  });
});

describe("device_binding_rule_update", () => {
  it("refuses a stray station added to a register device", () => {
    expect(
      refusalFor(connection, `update devices set station_id = 'station' where id = 'dev-rebind'`),
    ).toBe(REGISTER_BINDING_REFUSAL);
  });

  it("refuses a rebind onto a profile the binding contradicts", () => {
    expect(
      refusalFor(
        connection,
        `update devices set device_profile_id = 'dp-bind-kds' where id = 'dev-rebind'`,
      ),
    ).toBe(KDS_BINDING_REFUSAL);
  });

  it("accepts a rebind onto another register", () => {
    expect(
      refusalFor(connection, `update devices set till_id = 'till-2' where id = 'dev-heartbeat'`),
    ).toBeUndefined();
  });

  // The three cases below run in order: the drift is set up, then reactivation is refused, then the
  // heartbeat on that same drifted row shows the gate is what decides WHETHER the rule runs.
  it("lets an inactive device's profile drift (the drift guard blocks only ACTIVE devices)", () => {
    expect(
      refusalFor(
        connection,
        `update device_profiles set form_factor = 'kds' where id = 'dp-drift'`,
      ),
    ).toBeUndefined();
  });

  it("refuses reactivating a device whose binding the drifted profile contradicts", () => {
    expect(refusalFor(connection, `update devices set active = 1 where id = 'dev-off'`)).toBe(
      KDS_BINDING_REFUSAL,
    );
  });

  // The row here is one the rule WOULD refuse, so an ungated trigger would refuse this write too —
  // which makes this an assertion about the gate rather than about a row that was fine anyway.
  it("says nothing about an update that touches no binding column", () => {
    expect(
      refusalFor(connection, `update devices set last_seen_at = '${STAMP}' where id = 'dev-off'`),
    ).toBeUndefined();
  });
});

describe("device_profile_form_factor_locked", () => {
  it("refuses a form-factor change while an active device uses the profile", () => {
    expect(
      refusalFor(connection, `update device_profiles set form_factor = 'kds' where id = 'dp-used'`),
    ).toBe(FORM_FACTOR_REFUSAL);
  });

  it("accepts any other change to the same profile", () => {
    expect(
      refusalFor(connection, `update device_profiles set name = 'Renamed' where id = 'dp-used'`),
    ).toBeUndefined();
  });

  it("accepts a form-factor change on a profile no device uses", () => {
    expect(
      refusalFor(connection, `update device_profiles set form_factor = 'kds' where id = 'dp-free'`),
    ).toBeUndefined();
  });

  it("accepts a form-factor change once the device is deactivated", () => {
    connection.exec(`update devices set active = 0 where id = 'dev-active'`);
    expect(
      refusalFor(connection, `update device_profiles set form_factor = 'kds' where id = 'dp-used'`),
    ).toBeUndefined();
  });
});

/**
 * A product row. Foreign keys and checks are off in this file (see `seed`), so a variant needs no
 * catalogue row and may leave every inherited column null.
 */
function product(id, parentId = null) {
  const parent = parentId === null ? "null" : `'${parentId}'`;
  return (
    `insert into products (id, catalogue_id, parent_id, name, created_at, updated_at) ` +
    `values ('${id}', 'cat', ${parent}, '${id}', '${STAMP}', '${STAMP}')`
  );
}

/** The same row written with `INSERT OR REPLACE`. */
function replaceProduct(id, parentId = null) {
  return product(id, parentId).replace("insert into", "insert or replace into");
}

/** The stored `parent_id` of a product, or `undefined` when no row has that id. */
function parentOf(id) {
  return connection.prepare(`select parent_id from products where id = ?`).get(id)?.parent_id;
}

describe("products_variant_one_level_insert", () => {
  // Order matters: the rows these cases name are written by the first cases, and the blocks after
  // this one use them too, as the file's other blocks share one seeded connection.
  it("accepts a variant naming a parent that has no parent", () => {
    expect(refusalFor(connection, product("p-top"))).toBeUndefined();
    expect(refusalFor(connection, product("p-other-top"))).toBeUndefined();
    expect(refusalFor(connection, product("p-lonely"))).toBeUndefined();
    expect(refusalFor(connection, product("p-var", "p-top"))).toBeUndefined();
  });

  it("accepts a second variant under the same parent", () => {
    expect(refusalFor(connection, product("p-var-2", "p-top"))).toBeUndefined();
  });

  it("refuses a product whose parent is itself a variant", () => {
    expect(refusalFor(connection, product("p-grand", "p-var"))).toBe(VARIANT_ONE_LEVEL_REFUSAL);
  });

  it("raises through the trigger class, not through a foreign key", () => {
    expect(errcodeFor(connection, product("p-grand-2", "p-var"))).toBe(1811);
  });

  it("refuses a product naming itself as its parent", () => {
    expect(refusalFor(connection, product("p-self", "p-self"))).toBe(VARIANT_ONE_LEVEL_REFUSAL);
  });

  // With foreign keys off here — or deferred, as configuration transfer runs them — a variant can be
  // written before the parent it names. The parent then arrives with a child already in place.
  it("refuses a product naming a parent when it already has a variant of its own", () => {
    expect(refusalFor(connection, product("p-early-child", "p-late"))).toBeUndefined();
    expect(refusalFor(connection, product("p-late", "p-top"))).toBe(VARIANT_ONE_LEVEL_REFUSAL);
  });

  it("accepts a top-level product whose variant was written before it", () => {
    expect(refusalFor(connection, product("p-early-child-2", "p-late-top"))).toBeUndefined();
    expect(refusalFor(connection, product("p-late-top"))).toBeUndefined();
  });

  // `INSERT OR REPLACE` runs this insert trigger while the row it replaces is still in the table,
  // and never runs the update trigger, so the fixed parent is this trigger's to hold here.
  it("refuses an INSERT OR REPLACE moving a variant to another parent", () => {
    expect(refusalFor(connection, replaceProduct("p-var-2", "p-other-top"))).toBe(
      VARIANT_PARENT_FIXED_REFUSAL,
    );
  });

  it("refuses an INSERT OR REPLACE making a variant a top-level product", () => {
    expect(refusalFor(connection, replaceProduct("p-var-2"))).toBe(VARIANT_PARENT_FIXED_REFUSAL);
  });

  it("accepts an INSERT OR REPLACE of a variant under the parent it already has", () => {
    expect(refusalFor(connection, replaceProduct("p-var-2", "p-top"))).toBeUndefined();
    expect(parentOf("p-var-2")).toBe("p-top");
  });
});

describe("products_variant_parent_fixed_update", () => {
  it("refuses giving a top-level product a parent", () => {
    expect(
      refusalFor(connection, `update products set parent_id = 'p-top' where id = 'p-lonely'`),
    ).toBe(VARIANT_PARENT_FIXED_REFUSAL);
  });

  // A product that already HAS variants being made a variant of something else would be a second
  // level the insert trigger never saw.
  it("refuses giving a parent that has variants a parent of its own", () => {
    expect(
      refusalFor(connection, `update products set parent_id = 'p-other-top' where id = 'p-top'`),
    ).toBe(VARIANT_PARENT_FIXED_REFUSAL);
  });

  it("refuses moving a variant to another parent", () => {
    expect(
      refusalFor(connection, `update products set parent_id = 'p-other-top' where id = 'p-var'`),
    ).toBe(VARIANT_PARENT_FIXED_REFUSAL);
  });

  it("refuses clearing a variant's parent", () => {
    expect(refusalFor(connection, `update products set parent_id = null where id = 'p-var'`)).toBe(
      VARIANT_PARENT_FIXED_REFUSAL,
    );
  });

  it("accepts any other change to a variant", () => {
    expect(
      refusalFor(connection, `update products set name = 'Renamed', active = 0 where id = 'p-var'`),
    ).toBeUndefined();
  });
});

describe("products_id_fixed_update", () => {
  // A child naming an id nobody holds yet, then a variant renamed to that id: the child's parent
  // is now a variant, a second level no insert trigger saw.
  it("refuses renaming a variant onto the id a waiting child names", () => {
    expect(refusalFor(connection, product("p-waiting-child", "p-missing"))).toBeUndefined();
    expect(refusalFor(connection, `update products set id = 'p-missing' where id = 'p-var'`)).toBe(
      PRODUCT_ID_FIXED_REFUSAL,
    );
    expect(parentOf("p-var")).toBe("p-top");
  });

  it("refuses changing the id of a product that has variants", () => {
    expect(
      refusalFor(connection, `update products set id = 'p-top-renamed' where id = 'p-top'`),
    ).toBe(PRODUCT_ID_FIXED_REFUSAL);
  });

  it("refuses changing the id of a top-level product with no variants", () => {
    expect(
      refusalFor(connection, `update products set id = 'p-lonely-renamed' where id = 'p-lonely'`),
    ).toBe(PRODUCT_ID_FIXED_REFUSAL);
  });

  // The replace deletes the variant and leaves a top-level row under its id: its parent cleared by
  // a statement that never names `parent_id`.
  it("refuses an UPDATE OR REPLACE moving a top-level product onto a variant's id", () => {
    expect(
      refusalFor(connection, `update or replace products set id = 'p-var-2' where id = 'p-lonely'`),
    ).toBe(PRODUCT_ID_FIXED_REFUSAL);
    expect(parentOf("p-var-2")).toBe("p-top");
  });

  it("accepts an update that writes a product's id back unchanged", () => {
    expect(
      refusalFor(connection, `update products set id = id, name = 'Same id' where id = 'p-var'`),
    ).toBeUndefined();
  });
});

/** A top-level product row carrying `ordering`, spelled into the statement as given. */
function productOrdered(id, ordering) {
  return (
    `insert into products (id, catalogue_id, name, ordering, created_at, updated_at) ` +
    `values ('${id}', 'cat', '${id}', '${ordering}', '${STAMP}', '${STAMP}')`
  );
}

/** The stored `ordering` of a product, or `undefined` when no row has that id. */
function orderingOf(id) {
  return connection.prepare(`select ordering from products where id = ?`).get(id)?.ordering;
}

// `products.ordering` has no CHECK constraint, because adding one makes drizzle rebuild `products`;
// these two triggers are what refuses any other value.
describe("products_ordering_check_insert", () => {
  it("accepts each of the three values", () => {
    for (const ordering of ["public", "staff_only", "not_sold_separately"])
      expect(refusalFor(connection, productOrdered(`p-ordered-${ordering}`, ordering))).toBe(
        undefined,
      );
    expect(orderingOf("p-ordered-staff_only")).toBe("staff_only");
  });

  it("gives a product written without the column the value public", () => {
    expect(refusalFor(connection, product("p-ordered-default"))).toBeUndefined();
    expect(orderingOf("p-ordered-default")).toBe("public");
  });

  it("refuses an insert with any other value", () => {
    expect(refusalFor(connection, productOrdered("p-ordered-secret", "secret"))).toBe(
      PRODUCT_ORDERING_REFUSAL,
    );
    expect(orderingOf("p-ordered-secret")).toBeUndefined();
  });

  it("compares the value exactly, so a capitalised one is refused", () => {
    expect(refusalFor(connection, productOrdered("p-ordered-caps", "Public"))).toBe(
      PRODUCT_ORDERING_REFUSAL,
    );
  });

  it("raises through the trigger class", () => {
    expect(errcodeFor(connection, productOrdered("p-ordered-secret-2", "secret"))).toBe(1811);
  });

  it("refuses an INSERT OR REPLACE with any other value", () => {
    expect(
      refusalFor(
        connection,
        productOrdered("p-ordered-public", "secret").replace(
          "insert into",
          "insert or replace into",
        ),
      ),
    ).toBe(PRODUCT_ORDERING_REFUSAL);
    expect(orderingOf("p-ordered-public")).toBe("public");
  });
});

describe("products_ordering_check_update", () => {
  it("refuses an update to any other value", () => {
    expect(
      refusalFor(
        connection,
        `update products set ordering = 'secret' where id = 'p-ordered-public'`,
      ),
    ).toBe(PRODUCT_ORDERING_REFUSAL);
    expect(orderingOf("p-ordered-public")).toBe("public");
  });

  it("accepts an update to each of the three values", () => {
    for (const ordering of ["not_sold_separately", "staff_only", "public"]) {
      expect(
        refusalFor(
          connection,
          `update products set ordering = '${ordering}' where id = 'p-ordered-public'`,
        ),
      ).toBeUndefined();
      expect(orderingOf("p-ordered-public")).toBe(ordering);
    }
  });
});

describe("bill_payments_guard_update", () => {
  it("refuses a change to a bill payment's applied amount", () => {
    expect(
      refusalFor(connection, `update bill_payments set applied = 1 where id = 'bp-pending'`),
    ).toBe(BILL_PAYMENT_CHANGE_REFUSAL);
  });

  it("refuses declining a received payment once a tender names it", () => {
    expect(
      refusalFor(
        connection,
        `update bill_payments set state = 'declined' where id = 'bp-tendered'`,
      ),
    ).toBe(BILL_PAYMENT_CHANGE_REFUSAL);
  });

  it("accepts pending to received", () => {
    expect(
      refusalFor(
        connection,
        `update bill_payments set state = 'received', received_at = '${STAMP}' where id = 'bp-pending'`,
      ),
    ).toBeUndefined();
  });

  it("accepts declining a received payment no tender names", () => {
    expect(
      refusalFor(
        connection,
        `update bill_payments set state = 'declined' where id = 'bp-received'`,
      ),
    ).toBeUndefined();
  });
});

describe("bill_payments_no_delete", () => {
  it("refuses deleting a bill payment", () => {
    expect(refusalFor(connection, `delete from bill_payments where id = 'bp-pending'`)).toBe(
      BILL_PAYMENT_DELETE_REFUSAL,
    );
  });
});

describe("bill_payment_refunds_guard_update", () => {
  it("refuses counting two sends at once", () => {
    expect(
      refusalFor(
        connection,
        `update bill_payment_refunds set sent_at = '${STAMP}', send_count = 2 where id = 'bpr-pending'`,
      ),
    ).toBe(BILL_REFUND_CHANGE_REFUSAL);
  });

  it("accepts stamping the first send", () => {
    expect(
      refusalFor(
        connection,
        `update bill_payment_refunds set sent_at = '${STAMP}', send_count = 1 where id = 'bpr-pending'`,
      ),
    ).toBeUndefined();
  });
});

describe("bill_payment_refunds_no_delete", () => {
  it("refuses deleting a bill payment refund", () => {
    expect(
      refusalFor(connection, `delete from bill_payment_refunds where id = 'bpr-pending'`),
    ).toBe(BILL_REFUND_DELETE_REFUSAL);
  });
});
