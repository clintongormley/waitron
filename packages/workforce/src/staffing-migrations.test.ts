import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_CLASSIFICATION, CORE_MIGRATIONS, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { WORKFORCE_CLASSIFICATION } from "./classification.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function columnsOf(table: string) {
  const columns = await db.execute<{ name: string; notnull: number; pk: number }>(
    sql`select name, "notnull", pk from pragma_table_info(${table})`,
  );
  return Object.fromEntries(columns.rows.map((c) => [c.name, { notNull: c.notnull, pk: c.pk }]));
}

describe("the staffing tables in workforce's set", () => {
  it("keeps its tables in workforce's set, which classifies them", () => {
    expect(CORE_CLASSIFICATION.map(({ table }) => table)).toEqual(
      expect.arrayContaining(["staff_roles", "person_staff_roles"]),
    );
    expect(WORKFORCE_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_workforce");
    expect(WORKFORCE_CLASSIFICATION.map(({ table }) => table)).toEqual(
      expect.arrayContaining(["staffing_days", "staffing_blocks", "shift_assignments"]),
    );
  });

  it("creates staff_roles with a name, a colour and a position", async () => {
    expect(await columnsOf("staff_roles")).toEqual({
      id: { notNull: 1, pk: 1 },
      name: { notNull: 1, pk: 0 },
      colour: { notNull: 1, pk: 0 },
      position: { notNull: 1, pk: 0 },
      hidden_at: { notNull: 0, pk: 0 },
    });
  });

  it("creates person_staff_roles keyed by the person and the staff role together", async () => {
    expect(await columnsOf("person_staff_roles")).toEqual({
      person_id: { notNull: 1, pk: 1 },
      staff_role_id: { notNull: 1, pk: 2 },
    });
  });

  it("creates staffing_days with an optional area and day of each kind", async () => {
    expect(await columnsOf("staffing_days")).toEqual({
      id: { notNull: 1, pk: 1 },
      department_id: { notNull: 0, pk: 0 },
      station_id: { notNull: 0, pk: 0 },
      season_id: { notNull: 0, pk: 0 },
      weekday: { notNull: 0, pk: 0 },
      special_day_date_id: { notNull: 0, pk: 0 },
    });
  });

  it("creates staffing_blocks with a day, a staff role, a headcount and its hours", async () => {
    expect(await columnsOf("staffing_blocks")).toEqual({
      id: { notNull: 1, pk: 1 },
      day_id: { notNull: 1, pk: 0 },
      staff_role_id: { notNull: 1, pk: 0 },
      headcount: { notNull: 1, pk: 0 },
      starts_at: { notNull: 1, pk: 0 },
      ends_at: { notNull: 1, pk: 0 },
    });
  });

  it("creates shift_assignments keyed by the shift", async () => {
    expect(await columnsOf("shift_assignments")).toEqual({
      shift_id: { notNull: 1, pk: 1 },
      department_id: { notNull: 0, pk: 0 },
      station_id: { notNull: 0, pk: 0 },
      staff_role_id: { notNull: 1, pk: 0 },
    });
  });
});
