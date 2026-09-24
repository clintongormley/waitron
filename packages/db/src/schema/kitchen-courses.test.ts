import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { catalogues, products } from "./catalogue.js";
import { kitchenCourses } from "./kitchen-courses.js";
import { locations, tenants } from "./tenants.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const RANDOM_UUID = "99999999-9999-4999-8999-999999999999";

describe("kitchen_courses schema (columns, defaults, course FKs)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  let productA = "";
  let courseA = "";

  beforeAll(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await db.insert(locations).values([
      { id: LOCATION_A, name: "Loc A", invoiceLocales: ["es"], operationDescription: "Hostelería" },
      {
        id: LOCATION_A2,
        name: "Loc A2",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
    courseA = await seedCourse(LOCATION_A, "Entrantes");
    const [cat] = await db
      .insert(catalogues)
      .values({ name: "Deli A" })
      .returning({ id: catalogues.id });
    const [prod] = await db
      .insert(products)
      .values({
        catalogueId: cat!.id,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = prod!.id;
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Drizzle rather than raw SQL: `id` and `created_at` are `$defaultFn` columns a raw insert does
  // not fill.
  async function seedCourse(location: string, name: string, displayOrder = 0): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(kitchenCourses)
        .values({ locationId: location, name, displayOrder })
        .returning({ id: kitchenCourses.id });
      return row!.id;
    });
  }

  it("maps display_order and name through the Drizzle export, with the active default", async () => {
    const id = await seedCourse(LOCATION_A, "Principales", 1);
    await inTx((tx) =>
      tx.update(kitchenCourses).set({ displayOrder: 5 }).where(eq(kitchenCourses.id, id)),
    );
    const [row] = await inTx((tx) =>
      tx.select().from(kitchenCourses).where(eq(kitchenCourses.id, id)),
    );
    expect(row!.displayOrder).toBe(5);
    expect(row!.name).toBe("Principales");
    expect(row!.active).toBe(true);
  });

  it("locations.fire_control defaults to 'waiter' (the new venue setting)", async () => {
    const [row] = await inTx((tx) =>
      tx
        .select({ fireControl: locations.fireControl })
        .from(locations)
        .where(eq(locations.id, LOCATION_A)),
    );
    expect(row!.fireControl).toBe("waiter");
  });

  it("fire_control accepts the three labels and refuses a fourth", async () => {
    // The column is `text` with an `in (...)` CHECK, so the set is tested by writing each label.
    for (const label of ["waiter", "kitchen", "expo"] as const) {
      await inTx((tx) =>
        tx.update(locations).set({ fireControl: label }).where(eq(locations.id, LOCATION_A2)),
      );
      const [row] = await inTx((tx) =>
        tx
          .select({ fireControl: locations.fireControl })
          .from(locations)
          .where(eq(locations.id, LOCATION_A2)),
      );
      expect(row!.fireControl).toBe(label);
    }
    // Control: a non-label is refused. Raw SQL, because the column's type admits only the labels.
    const e = await captureError(() =>
      inTx(async (tx) => {
        tx.run(sql`update locations set fire_control = 'nope' where id = ${LOCATION_A2}`);
      }),
    );
    expect(isRefusal(e, CHECK_VIOLATION)).toBe(true);
    // Restore, since this suite shares its rows across cases.
    await inTx((tx) =>
      tx.update(locations).set({ fireControl: "waiter" }).where(eq(locations.id, LOCATION_A2)),
    );
  });

  it("routes a product to a course and rejects a missing one", async () => {
    await inTx((tx) =>
      tx.update(products).set({ courseId: courseA }).where(eq(products.id, productA)),
    );
    const [row] = await inTx((tx) =>
      tx.select({ courseId: products.courseId }).from(products).where(eq(products.id, productA)),
    );
    expect(row!.courseId).toBe(courseA);

    const eRandom = await captureError(() =>
      inTx((tx) =>
        tx.update(products).set({ courseId: RANDOM_UUID }).where(eq(products.id, productA)),
      ),
    );
    expect(isRefusal(eRandom, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("wires all three course columns with a foreign key to kitchen_courses", async () => {
    // The behavioural case above covers products.course_id only; this catches a copy-paste error
    // in the other two, such as a course FK pointing at kitchen_stations. SQLite stores no name for
    // a foreign key, so each is found by table and column.
    for (const table of ["products", "working_order_lines", "ticket_items"]) {
      const keys = suite.db.all<{ table: string; from: string; to: string }>(
        sql.raw(`select "table", "from", "to" from pragma_foreign_key_list('${table}')`),
      );
      const course = keys.filter((key) => key.from === "course_id");
      expect(course, `${table}.course_id must have exactly one foreign key`).toHaveLength(1);
      expect(course[0]!.table).toBe("kitchen_courses");
      expect(course[0]!.to).toBe("id");
    }
  });
});
