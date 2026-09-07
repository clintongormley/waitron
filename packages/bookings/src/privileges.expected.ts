/**
 * app_user's table privileges for this module's own tables, read back from the live catalog by
 * privileges.test.ts (real Postgres). Letters: S=SELECT I=INSERT U=UPDATE D=DELETE T=TRUNCATE.
 *
 * `bookings` holds exactly SELECT, INSERT, UPDATE — never DELETE (a booking is CANCELLED, never
 * removed; schema/bookings.ts) and never TRUNCATE. A deliberate grant change edits this file in the
 * same commit, with the reason in the message (CLAUDE.md §3, never widen a grant to pass a test).
 * The whole-manifest matrix in @waitron/fiscal-verifactu's privileges.expected.ts pins the same row
 * from the other side (that suite migrates the full manifest, which now includes bookings).
 */
export const PRIVILEGES: Record<string, string> = {
  bookings: "SIU",
};
