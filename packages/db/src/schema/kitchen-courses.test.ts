import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
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

  // Seeded once in beforeAll: a product (for the products.course_id FK proof) and a course to
  // route to.
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

  // The Drizzle builder rather than raw SQL: `id` and `created_at` are `$defaultFn` columns applied
  // CLIENT-side, so a raw `insert` is refused NOT NULL.
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
    // PostgreSQL held these labels in an ENUM TYPE, so this case read `pg_enum` and cast a literal,
    // with a non-label cast raising `22P02` as the control. The regenerated SQLite column is `text`
    // with an `in (...)` CHECK (`packages/db/src/schema/columns.ts`'s `enumType`/`enumCheck`), so
    // the same question is asked by WRITING each label: there is no type to interrogate, and the
    // constraint is the only thing that knows the set.
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
    // The control in the other direction: a value that is not a label is refused by the CHECK, so
    // the three accepted above are genuinely being validated. Raw SQL, because the column's type
    // admits only the three labels.
    const e = await captureError(() =>
      inTx(async (tx) => {
        tx.run(sql`update locations set fire_control = 'nope' where id = ${LOCATION_A2}`);
      }),
    );
    expect(isPgError(e, CHECK_VIOLATION)).toBe(true);
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

    // … a course that names no row at all is refused (FK existence) …
    const eRandom = await captureError(() =>
      inTx((tx) =>
        tx.update(products).set({ courseId: RANDOM_UUID }).where(eq(products.id, productA)),
      ),
    );
    expect(isPgError(eRandom, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("wires all three course columns with a foreign key to kitchen_courses", async () => {
    // The behavioural proof above covers products.course_id; working_order_lines.course_id and
    // ticket_items.course_id use the IDENTICAL DDL. Asserting each of the three structurally
    // catches a copy-paste error in the target or the column list — a course FK pointing at
    // kitchen_stations, say — that the single behavioural test would not reach.
    //
    // `pragma foreign_key_list` replaces `pg_get_constraintdef`: it reads the LIVE catalogue the
    // same way, but it reports no constraint NAME, because SQLite does not store one for a foreign
    // key. So the three are found by their owning table and column instead of by
    // `products_course_fk` and its two siblings, and if one of those names were needed again it
    // could not be read back from this engine at all.
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
