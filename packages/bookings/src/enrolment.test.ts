import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { BOOKINGS_ENROLMENT } from "./enrolment.js";
import { bookings } from "./schema/bookings.js";

describe("BOOKINGS_ENROLMENT", () => {
  const byTable = new Map(BOOKINGS_ENROLMENT.map((e) => [e.table, e]));

  it("enrols exactly the bookings table on the ordered lane", () => {
    expect([...byTable.keys()]).toEqual(["bookings"]);
    for (const e of BOOKINGS_ENROLMENT) expect(e.lane).toBe("ordered");
  });

  it("is a state-class runtime table: watermark-upsert on id, no watermark, insert/update only", () => {
    const b = byTable.get("bookings")!;
    expect(b.mode).toBe("watermark-upsert");
    expect(b.conflictKey).toEqual(["id"]);
    // No monotonic update column (bookings carries `created_at` only), so — like dining_tables /
    // working_orders — it rides the ordered lane on the seq cursor with a null watermark.
    expect(b.watermarkColumn).toBeNull();
    // app_user holds no DELETE on bookings (a booking is CANCELLED, never removed), so the verbs
    // never delete.
    expect(b.captureOps).toEqual(["insert", "update"]);
  });

  it("is NOT config-class — a reservation is single-writer runtime state, not venue configuration", () => {
    expect(byTable.get("bookings")!.configClass).toBe(false);
  });

  it("ranks below its FK parents (dining_tables rank 1, working_orders rank 2)", () => {
    expect(byTable.get("bookings")!.fkRank).toBeGreaterThan(2);
  });

  it("derives its columns verbatim from the Drizzle table (never hand-written)", () => {
    const expected = Object.values(getTableColumns(bookings)).map((c) => c.name);
    expect(byTable.get("bookings")!.columns).toEqual(expected);
  });
});
