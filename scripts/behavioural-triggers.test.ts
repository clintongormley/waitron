import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { applyMigrations } from "../packages/migrations/src/apply.js";
import { migrationOptionsFor } from "../packages/migrations/src/manifest.js";
import { orderedMigrationSets } from "../packages/module/src/module.js";
import {
  COVERAGE_REFUSAL,
  FORM_FACTOR_REFUSAL,
  LOCALES_REFUSAL,
  OPEN_PARENT_REFUSAL,
  POST_SETTLEMENT_REFUSAL,
  TRANSITION_REFUSAL,
  VARIANT_LOCALES_REFUSAL,
} from "../packages/db/src/trigger-refusals.js";

/**
 * The eight BEHAVIOURAL triggers `packages/db` carried under PostgreSQL still refuse — or still
 * act — against a database the PRODUCT migrated.
 *
 * These are the database-level backstops that are not append-only: a settlement's tender coverage,
 * a tender after settlement, a working order's status transitions, lines written against an order
 * that is not open, a line's description maps matching the venue's invoice locales, and a device
 * profile's form factor while an active device uses it — plus the one that ACTS rather than
 * refuses, clearing a dining table's service status when its tab closes. They were hand-written
 * `--custom` SQL, a trigger has never been declarable in TypeScript, and regenerating every
 * migration set from the schema for the storage switch dropped all of them. They are restored by
 * `packages/db/drizzle/0001_behavioural_triggers.sql`.
 *
 * **It migrates through `applyMigrations`, like `scripts/append-only-triggers.test.ts` beside it,
 * and for the same reason**: a guard that installs the thing under test cannot see the product
 * failing to install it. Here the migration is the product's own path by construction, but the
 * property that matters is the same one — the triggers are read out of a file drizzle produced
 * from the journal, not out of SQL text this file supplies.
 *
 * **Reading `sqlite_master` is not enough, and most of this file is the other half.** A trigger
 * SQLite RECORDS is not a trigger SQLite ENFORCES: a `WHEN` clause that is never true, a body
 * whose condition is inverted, or a set comparison that only works in one direction all leave the
 * name in the catalogue. So every refusing trigger has a real offending write with its message
 * asserted, and each has an ACCEPTING control in the other direction — without the control, a
 * trigger that refused EVERY write would pass the refusal cases.
 *
 * WHERE THE HALVES LIVE. Both halves are here: the name pin and the behaviour. Nothing about these
 * triggers is proven in `packages/db`, so a reader looking there will find nothing and should look
 * here. (`packages/db`'s own `schema/orders.transition.test.ts`,
 * `schema/device-profiles.trigger.pg.test.ts` and `schema/park-retrieve.test.ts` exercise the same
 * rules through the product's write paths; they are a different claim — that the CALLER is refused
 * — and they do not establish that the database refuses a caller that goes around them.)
 *
 * WHAT IT DOES NOT COVER. `INSERT OR REPLACE` and `INSERT … ON CONFLICT DO UPDATE` are not tried
 * against these triggers; a `BEFORE INSERT` trigger fires on both, and a `BEFORE UPDATE` one fires
 * on the conflict path, but neither shape is exercised below. Nor is any concurrency claim: one
 * connection, one process.
 */

/**
 * Every behavioural trigger the migration creates, pinned by name.
 *
 * TWELVE names for EIGHT PostgreSQL triggers. SQLite has no `BEFORE INSERT OR UPDATE` — one
 * trigger takes exactly one event — so the three that covered more than one event are split, and
 * the suffix names the event. The split is the engine's; the rules are unchanged.
 */
const EXPECTED_TRIGGERS = [
  "device_profile_form_factor_locked",
  "sale_settlements_check_coverage",
  "tenders_reject_post_settlement",
  "working_order_lines_check_locales_insert",
  "working_order_lines_check_locales_update",
  "working_order_lines_check_variant_locales_insert",
  "working_order_lines_check_variant_locales_update",
  "working_order_lines_require_open_parent_delete",
  "working_order_lines_require_open_parent_insert",
  "working_order_lines_require_open_parent_update",
  "working_orders_clear_table_status",
  "working_orders_enforce_transition",
];

/**
 * The exact words each refusing trigger raises, read from the ONE place that declares them
 * (`packages/db/src/trigger-refusals.ts`) rather than copied here.
 *
 * That import is what binds the migration's SQL to the callers that translate its refusals — the
 * words are a SQLite trigger's whole identity, and `packages/core`'s `settleSale` matches one of
 * them by equality. Reword the SQL alone and the cases below fail; change a constant alone and they
 * fail the same way. A local copy here would have asserted this file against itself.
 */

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
 * Unique-index fodder.
 *
 * `working_order_lines` is unique on (`working_order_id`, `line_no`) and `sales` on
 * (`series_id`, `invoice_number`), and neither is the thing under test — a case that collided on
 * one would report `SQLITE_CONSTRAINT_UNIQUE` where it meant to report a trigger. A counter per
 * shape keeps every fixture row distinct; a REFUSED insert burns a number, which is harmless.
 */
let nextLineNo = 0;
let nextInvoiceNumber = 0;

/** A working order row. Callers name only what a case turns on. */
function workingOrder(id, status, extra = {}) {
  const tillId = extra.tillId ?? "till";
  const settledAt = status === "settled" ? `'${STAMP}'` : "null";
  const collectedAt = extra.collectedAt ? `'${extra.collectedAt}'` : "null";
  return (
    `insert into working_orders (id, till_id, order_number, status, opened_at, settled_at, collected_at) ` +
    `values ('${id}', '${tillId}', 1, '${status}', '${STAMP}', ${settledAt}, ${collectedAt})`
  );
}

/** A working-order line. `descriptions` and `variant_descriptions` arrive as JSON text. */
function line(id, orderId, descriptions, variantDescriptions = null) {
  const variant = variantDescriptions === null ? "null" : `'${variantDescriptions}'`;
  nextLineNo += 1;
  return (
    `insert into working_order_lines ` +
    `(id, working_order_id, line_no, name, descriptions, variant_descriptions, ` +
    ` quantity, unit_price, unit_price_gross, vat_rate, line_total) ` +
    `values ('${id}', '${orderId}', ${nextLineNo}, 'Item', '${descriptions}', ${variant}, ` +
    ` 1000, 100, 121, 2100, 121)`
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

function tender(id, saleId, amount, tip = 0) {
  return (
    `insert into tenders (id, sale_id, method, amount, tip_amount, settled_at) ` +
    `values ('${id}', '${saleId}', 'card', ${amount}, ${tip}, '${STAMP}')`
  );
}

/**
 * The fixture rows the cases below need, written straight into a migrated venue file.
 *
 * Foreign keys and check constraints are both OFF, exactly as `append-only-triggers.test.ts` runs
 * its own seeding, and for the same two reasons: one row can then stand for a parent this file
 * does not care about (`invoice_series`, `nodes`, `catalogues`), and — the reason that matters
 * here — a refusal cannot be a CHECK constraint or a foreign key wearing a trigger's clothes. On
 * this engine an `ON DELETE RESTRICT` refusal arrives with the SAME numeric class as
 * `RAISE(ABORT, …)` (1811, `SQLITE_CONSTRAINT_TRIGGER`), so the code alone could not tell them
 * apart; with foreign keys off, and with every message asserted in full rather than by class,
 * neither can be mistaken for the trigger. Neither pragma touches triggers, and the accepting
 * controls below are what say so — they run under exactly the same two.
 */
function seed(connection) {
  const statements = [
    // Venue: one location with TWO invoice locales, so "exactly the venue locales" has a set to be
    // wrong about in both directions.
    `insert into locations (id, name, invoice_locales, operation_description) ` +
      `values ('loc', 'Venue', '["es","ca"]', 'Restaurante')`,
    `insert into tills (id, location_id, name, created_at) values ('till', 'loc', 'Till 1', '${STAMP}')`,

    // Working orders, one per case that changes an order's state.
    workingOrder("wo-open", "open"),
    workingOrder("wo-placed", "placed"),
    workingOrder("wo-settled", "settled"),
    workingOrder("wo-settled-extra", "settled"),
    workingOrder("wo-settled-reopen", "settled"),
    workingOrder("wo-flip", "open"),
    workingOrder("wo-lines-update", "open"),
    workingOrder("wo-lines-delete", "open"),
    workingOrder("wo-orphaned-parent", "open"),
    workingOrder("wo-tab", "open"),
    workingOrder("wo-tab-placed", "open"),
    // A till that does not exist, so the join to a location resolves to nothing.
    workingOrder("wo-orphan", "open", { tillId: "ghost-till" }),

    // Lines written while their parent is still open, for the update and delete cases.
    line("line-open", "wo-open", '{"es":"Plato","ca":"Plat"}'),
    line("line-update", "wo-lines-update", '{"es":"Plato","ca":"Plat"}'),
    line("line-delete", "wo-lines-delete", '{"es":"Plato","ca":"Plat"}'),
    line("line-orphaned", "wo-orphaned-parent", '{"es":"Plato","ca":"Plat"}'),

    // Dining tables carrying a service status, for the clear-on-close trigger.
    `insert into table_service_statuses (id, label, color, created_at) ` +
      `values ('status-busy', 'Ocupada', '#ff0000', '${STAMP}')`,
    `insert into dining_tables (id, location_id, label, tab_id, status_id, created_at) ` +
      `values ('dt-closes', 'loc', '1', 'wo-tab', 'status-busy', '${STAMP}')`,
    `insert into dining_tables (id, location_id, label, tab_id, status_id, created_at) ` +
      `values ('dt-stays', 'loc', '2', 'wo-tab-placed', 'status-busy', '${STAMP}')`,

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

    // Device profiles and one active device.
    `insert into device_profiles (id, name, form_factor, created_at, updated_at) ` +
      `values ('dp-used', 'Counter', 'till', '${STAMP}', '${STAMP}')`,
    `insert into device_profiles (id, name, form_factor, created_at, updated_at) ` +
      `values ('dp-free', 'Spare', 'till', '${STAMP}', '${STAMP}')`,
    `insert into devices (id, location_id, device_profile_id, label, token_hash, active, enrolled_at, created_at) ` +
      `values ('dev-active', 'loc', 'dp-used', 'Counter 1', 'hash', 1, '${STAMP}', '${STAMP}')`,
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
  it("creates exactly the behavioural triggers, under the names this file pins", () => {
    const created = connection
      .prepare(`select name from sqlite_master where type = 'trigger' order by name`)
      .all()
      .map((row) => String(row.name))
      .filter(
        (name) => !name.endsWith("_append_only_update") && !name.endsWith("_append_only_delete"),
      );
    expect(created).toEqual(EXPECTED_TRIGGERS);
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

  // PostgreSQL's `sales_assert_tenders_cover` returned without raising when the sale row was gone —
  // "the sale itself was rolled back; nothing left to reconcile". Kept, and pinned here because it
  // is the one branch a straight port would most easily turn into a refusal.
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
});

describe("working_order_lines_require_open_parent", () => {
  it("refuses a line inserted under a placed order", () => {
    expect(refusalFor(connection, line("line-placed", "wo-placed", '{"es":"a","ca":"b"}'))).toBe(
      OPEN_PARENT_REFUSAL,
    );
  });

  // TWO rules refuse this write, not one: an order that does not exist is also an order whose
  // location cannot be resolved, so `check_locales` refuses it as well. SQLite does not fix the
  // order several triggers on one event fire in, so which of the two messages comes back is not a
  // property this file may pin — measured on SQLite 3.53.4 it was the locale one. What IS pinned is
  // that the write is refused, with one of the two messages and nothing else.
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

  // PostgreSQL raised a SEPARATE message here ("working order % has no resolvable location"). On
  // this engine it folds into the same refusal: `raise` takes a literal, so a second message would
  // be a second trigger, and the two cases are the same fault from a caller's side — the line's
  // locales could not be shown to match the venue's.
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

describe("working_orders_clear_table_status", () => {
  const statusOf = (table) =>
    connection.prepare(`select status_id from dining_tables where id = ?`).get(table).status_id;

  it("clears the dining table's service status when its tab settles", () => {
    expect(statusOf("dt-closes")).toBe("status-busy");
    connection.exec(
      `update working_orders set status = 'settled', settled_at = '${STAMP}' where id = 'wo-tab'`,
    );
    expect(statusOf("dt-closes")).toBeNull();
  });

  it("leaves it alone when the tab is only placed", () => {
    connection.exec(`update working_orders set status = 'placed' where id = 'wo-tab-placed'`);
    expect(statusOf("dt-stays")).toBe("status-busy");
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
