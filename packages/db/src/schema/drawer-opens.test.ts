import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { drawerOpens } from "./drawer-opens.js";
import { printers } from "./printers.js";
import { locations, tenants, tills } from "./tenants.js";

// LOSS, from the storage swap: every write below used to run as the non-owner `app_user` on a real
// PostgreSQL, so the suite also established that role's grants on `drawer_opens`, `tills` and
// `locations`. SQLite has no roles and no grants; what is left is the column mapping, the defaults,
// the reason CHECK and the two foreign keys.
//
// SECOND LOSS: the three cases that ended in a rolled-back transaction did so to leave the SHARED
// template clone untouched. There is no shared clone here — each suite gets its own file — so they
// restore the value they changed instead, which keeps them order-independent for the same reason.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A = "aaaaaaaa-0000-4000-8000-000000000011";
const PRINTER_A = "aaaaaaaa-0000-4000-8000-000000000021";
// The acting operator recorded in `person_id` — an identity person id, plain uuid, no FK (the
// person schema is a separate slice; a raw uuid keeps this audit table independent of it).
const PERSON = "cccccccc-0000-4000-8000-000000000001";
// The authorizer recorded in `authorized_by` (a supervisor who authorized the open) — same shape.
const AUTHORIZER = "cccccccc-0000-4000-8000-000000000002";

describe("drawer_opens schema (cash-drawer audit — columns, defaults, CHECK, FKs)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await db.insert(locations).values({
      id: LOCATION_A,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await db.insert(tills).values({ id: TILL_A, locationId: LOCATION_A, name: "Till A" });
    await db.insert(printers).values({
      id: PRINTER_A,
      locationId: LOCATION_A,
      name: "Impresora A",
      transport: "cloud_poll",
      pollId: "poll-a",
    });
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // The Drizzle builder rather than raw SQL: `id` and `opened_at` are `$defaultFn` columns Drizzle
  // applies CLIENT-side, so a raw `insert` is refused NOT NULL before anything under test is
  // reached.
  async function seedOpen(
    reason: "cash_sale" | "manual",
    saleId: string | null = null,
  ): Promise<void> {
    await inTx((tx) =>
      tx.insert(drawerOpens).values({ tillId: TILL_A, personId: PERSON, reason, saleId }),
    );
  }

  it("writes and reads back a manual open (the column list, and the authorized_by/via_override defaults)", async () => {
    // The positive control for the CHECK and FK rejections below: without a write that SUCCEEDS, a
    // rejection could equally mean the row was malformed some other way. A manual open has no sale
    // (sale_id NULL), which is the common accountability case.
    await seedOpen("manual");
    const [row] = await inTx((tx) =>
      tx
        .select()
        .from(drawerOpens)
        .where(and(eq(drawerOpens.personId, PERSON), eq(drawerOpens.reason, "manual"))),
    );
    expect(row!.tillId).toBe(TILL_A);
    expect(row!.personId).toBe(PERSON);
    expect(row!.reason).toBe("manual");
    expect(row!.saleId).toBeNull();
    // `opened_at`'s value now comes from a `$defaultFn` Drizzle evaluates client-side, where
    // PostgreSQL's `defaultNow()` put the SERVER clock in it (`packages/db/src/schema/columns.ts`).
    expect(row!.openedAt).toBeInstanceOf(Date);
    // The new audit columns on their DEFAULT path: this insert supplied neither, so authorized_by
    // is NULL — as the automatic `cash_sale` drawer kick leaves it — and via_override took its NOT
    // NULL DEFAULT false.
    expect(row!.authorizedBy).toBeNull();
    expect(row!.viaOverride).toBe(false);
  });

  it("records authorized_by and via_override on an authorized open (new audit columns present + writable)", async () => {
    // A gated open a supervisor (AUTHORIZER) authorized on behalf of an operator (PERSON) who lacks
    // cash.drawer — authorized_by set, via_override true.
    await inTx((tx) =>
      tx.insert(drawerOpens).values({
        tillId: TILL_A,
        personId: PERSON,
        reason: "manual",
        authorizedBy: AUTHORIZER,
        viaOverride: true,
      }),
    );
    const [row] = await inTx((tx) =>
      tx
        .select()
        .from(drawerOpens)
        .where(and(eq(drawerOpens.personId, PERSON), eq(drawerOpens.authorizedBy, AUTHORIZER))),
    );
    expect(row!.authorizedBy).toBe(AUTHORIZER);
    expect(row!.viaOverride).toBe(true);
  });

  it("the reason CHECK accepts 'cash_sale' and rejects an unknown reason", async () => {
    // 'manual' is exercised by the positive control above; this pins that 'cash_sale' is also
    // accepted and that the closed vocabulary bites.
    await seedOpen("cash_sale");
    // Raw SQL, because the column's TypeScript type admits only the two labels. `id` and
    // `opened_at` are stated because both are `$defaultFn` columns.
    const e = await captureError(() =>
      inTx(async (tx) =>
        tx.run(
          sql`insert into drawer_opens (id, till_id, person_id, reason, opened_at)
              values ('do-bad', ${TILL_A}, ${PERSON}, 'refund', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isPgError(e, CHECK_VIOLATION)).toBe(true);
  });

  it("the sale binding is enforced (FK to sales)", async () => {
    // A full sale fixture is disproportionate for a schema task (a sale needs a series + node +
    // ~15 columns); a non-existent id proves the FK is wired all the same, and NULL (the manual
    // case) is proven to skip it by the positive control above.
    const missingSale = "dddddddd-0000-4000-8000-0000000000ff";
    const e = await captureError(() => seedOpen("cash_sale", missingSale));
    expect(isPgError(e, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("tills.receipt_printer_id is writable and its FK accepts a real printer", async () => {
    await inTx((tx) =>
      tx.update(tills).set({ receiptPrinterId: PRINTER_A }).where(eq(tills.id, TILL_A)),
    );
    const [row] = await inTx((tx) =>
      tx
        .select({ receiptPrinterId: tills.receiptPrinterId })
        .from(tills)
        .where(eq(tills.id, TILL_A)),
    );
    expect(row!.receiptPrinterId).toBe(PRINTER_A);
    await inTx((tx) =>
      tx.update(tills).set({ receiptPrinterId: null }).where(eq(tills.id, TILL_A)),
    );
  });

  it("locations.receipt_print_mode defaults to 'auto' and is settable", async () => {
    const [before] = await inTx((tx) =>
      tx
        .select({ mode: locations.receiptPrintMode })
        .from(locations)
        .where(eq(locations.id, LOCATION_A)),
    );
    expect(before!.mode).toBe("auto");
    await inTx((tx) =>
      tx
        .update(locations)
        .set({ receiptPrintMode: "on_request" })
        .where(eq(locations.id, LOCATION_A)),
    );
    const [after] = await inTx((tx) =>
      tx
        .select({ mode: locations.receiptPrintMode })
        .from(locations)
        .where(eq(locations.id, LOCATION_A)),
    );
    expect(after!.mode).toBe("on_request");
    await inTx((tx) =>
      tx.update(locations).set({ receiptPrintMode: "auto" }).where(eq(locations.id, LOCATION_A)),
    );
  });

  it("locations.drawer_open_policy defaults to 'gated' (the SECURE default) and is settable", async () => {
    // Deliberately unlike receipt_print_mode's inert 'auto': an unconfigured venue gets cash
    // accountability, not an open drawer.
    const [before] = await inTx((tx) =>
      tx
        .select({ policy: locations.drawerOpenPolicy })
        .from(locations)
        .where(eq(locations.id, LOCATION_A)),
    );
    expect(before!.policy).toBe("gated");
    await inTx((tx) =>
      tx.update(locations).set({ drawerOpenPolicy: "open" }).where(eq(locations.id, LOCATION_A)),
    );
    const [after] = await inTx((tx) =>
      tx
        .select({ policy: locations.drawerOpenPolicy })
        .from(locations)
        .where(eq(locations.id, LOCATION_A)),
    );
    expect(after!.policy).toBe("open");
    await inTx((tx) =>
      tx.update(locations).set({ drawerOpenPolicy: "gated" }).where(eq(locations.id, LOCATION_A)),
    );
  });
});
