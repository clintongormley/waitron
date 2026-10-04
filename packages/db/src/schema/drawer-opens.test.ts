import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDevice } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { drawerOpens } from "./drawer-opens.js";
import { printers } from "./printers.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { locations, tenants } from "./tenants.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const PRINTER_A = "aaaaaaaa-0000-4000-8000-000000000021";
const PERSON = "cccccccc-0000-4000-8000-000000000001";
const AUTHORIZER = "cccccccc-0000-4000-8000-000000000002";

let deviceA = "";

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
    await db.insert(printers).values({
      id: PRINTER_A,
      locationId: LOCATION_A,
      name: "Impresora A",
      transport: "cloud_poll",
      pollId: "poll-a",
    });
    ({ deviceId: deviceA } = await seedDevice(db, { locationId: brandLocationId(LOCATION_A) }));
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Drizzle rather than raw SQL: `id` and `opened_at` are `$defaultFn` columns a raw insert does not
  // fill.
  async function seedOpen(
    reason: "cash_sale" | "manual",
    saleId: string | null = null,
  ): Promise<void> {
    await inTx((tx) =>
      tx.insert(drawerOpens).values({ deviceId: deviceA, personId: PERSON, reason, saleId }),
    );
  }

  it("writes and reads back a manual open (the column list, and the authorized_by/via_override defaults)", async () => {
    // The positive control for the CHECK and FK rejections below.
    await seedOpen("manual");
    const [row] = await inTx((tx) =>
      tx
        .select()
        .from(drawerOpens)
        .where(and(eq(drawerOpens.personId, PERSON), eq(drawerOpens.reason, "manual"))),
    );
    expect(row!.deviceId).toBe(deviceA);
    expect(row!.personId).toBe(PERSON);
    expect(row!.reason).toBe("manual");
    expect(row!.saleId).toBeNull();
    expect(row!.openedAt).toBeInstanceOf(Date);
    expect(row!.authorizedBy).toBeNull();
    expect(row!.viaOverride).toBe(false);
  });

  it("records authorized_by and via_override on an authorized open (new audit columns present + writable)", async () => {
    await inTx((tx) =>
      tx.insert(drawerOpens).values({
        deviceId: deviceA,
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
    await seedOpen("cash_sale");
    // Raw SQL, because the column's TypeScript type excludes unknown labels; `id` and
    // `opened_at` are `$defaultFn` columns, so the statement supplies them.
    const e = await captureError(() =>
      inTx(async (tx) =>
        tx.run(
          sql`insert into drawer_opens (id, device_id, person_id, reason, opened_at)
              values ('do-bad', ${deviceA}, ${PERSON}, 'refund', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(e, CHECK_VIOLATION)).toBe(true);
  });

  it("the sale binding is enforced (FK to sales)", async () => {
    // A nonexistent sale id proves the FK is wired without building a full sale fixture.
    const missingSale = "dddddddd-0000-4000-8000-0000000000ff";
    const e = await captureError(() => seedOpen("cash_sale", missingSale));
    expect(isRefusal(e, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("records calibration against a printer without a device or sale", async () => {
    const [saved] = await inTx((tx) =>
      tx
        .insert(drawerOpens)
        .values({
          printerId: PRINTER_A,
          personId: PERSON,
          authorizedBy: AUTHORIZER,
          reason: "calibration",
        })
        .returning(),
    );
    expect(saved).toMatchObject({
      printerId: PRINTER_A,
      deviceId: null,
      saleId: null,
      personId: PERSON,
      authorizedBy: AUTHORIZER,
      reason: "calibration",
      viaOverride: false,
    });
  });

  it.each([
    { reason: "calibration" as const },
    { reason: "manual" as const, printerId: PRINTER_A },
    { reason: "cash_sale" as const, printerId: PRINTER_A },
  ])("rejects a drawer audit with an invalid target: %j", async (target) => {
    const error = await captureError(() =>
      inTx((tx) =>
        tx.insert(drawerOpens).values({
          personId: PERSON,
          ...target,
        }),
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
  });

  it("refuses a calibration that names a device", async () => {
    const error = await captureError(() =>
      inTx((tx) =>
        tx.insert(drawerOpens).values({
          personId: PERSON,
          printerId: PRINTER_A,
          deviceId: deviceA,
          reason: "calibration",
        }),
      ),
    );
    expect(engineErrorMessage(error)).toBe("CHECK constraint failed: drawer_opens_target_ck");
  });

  it("refuses an open naming a device that does not exist", async () => {
    const error = await captureError(() =>
      inTx((tx) =>
        tx.insert(drawerOpens).values({
          deviceId: "dddddddd-0000-4000-8000-0000000000aa",
          personId: PERSON,
          reason: "manual",
        }),
      ),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("refuses calibration against a missing printer", async () => {
    const error = await captureError(() =>
      inTx((tx) =>
        tx.insert(drawerOpens).values({
          printerId: "missing-printer",
          personId: PERSON,
          reason: "calibration",
        }),
      ),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
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
    // An unconfigured venue gets cash accountability, not an open drawer.
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
