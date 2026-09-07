import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import { bookings } from "./schema/bookings.js";

/**
 * The bookings module's sync enrolment — bookings is the first genuinely-toggleable enrolling module.
 * One STATE-class runtime table: a reservation is created then mutated through its lifecycle
 * (`booked → seated → completed/no_show/cancelled`), so it upserts on `id`. It carries no monotonic
 * update column (only `created_at`), so — like `dining_tables` / `working_orders` — it rides the
 * ordered lane on the seq cursor with a null watermark. `captureOps` is insert/update ONLY: a booking
 * is CANCELLED, never removed, so `app_user` holds no DELETE (0001_bookings_baseline_sql.sql) and the
 * verbs never delete. NOT config-class: a reservation is single-writer runtime state a serving node
 * owns, not venue configuration flowing down from a primary. `columns` is DERIVED by `enrol()` off the
 * owning Drizzle table so it cannot drift.
 */
export const BOOKINGS_ENROLMENT: readonly EnrolledTable[] = [
  enrol(bookings, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    // Below its FK parents: dining_tables (rank 1) and working_orders (rank 2), so bookings is 3.
    fkRank: 3,
    lane: "ordered",
  }),
];
