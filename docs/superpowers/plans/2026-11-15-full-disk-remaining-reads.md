# Full disk: the two remaining till reads

**Authority and status:** separate Sol-high planning draft; source reading only, no verification. Lane K `questions.md`, WATCHER 2026-11-15 12:17:

> Finish the Wi-Fi Forget cut first. Then a one-page plan for the two remaining read paths (floor-state and invoice-delivery reads whose write transaction answers 507 on a full disk when no write is due) through Claude, then `## PLAN FOR APPROVAL:`. It sits inside the bundle and CLAUDE.md's rule that housekeeping writes must not take reads down on a full disk. The clock-in/attendance notices stay outside, under the 02:44 limit; the bar and tints stay in the backlog for the owner. Close FULL-DISK-WORDS once those two reads land.

Forget landed #3339, `68e116c348277cc94ed603f9f0b8fbfd45caf433` (supplied receipt). Planning only is cleared. Claude review, corrections and the driver's `## PLAN FOR APPROVAL:` precede watcher build clearance; no owner design approval is claimed.

**Finish line:** you can read the current authorized floor and invoice-delivery status on a full disk with a notification waiting when reconciliation is not due. Necessary writes still fail visibly until space returns.

**Smallest change:**

- `apps/server/src/floor-today-store.ts:974`: extract `ensureToday`'s candidate selection into shared local code; expose `todayReconciliationDue(tx, now)`. Reuse the complete active-zone/business-day selection and `catchUpDue`, without copied SQL. Keep its conservative meaning: a candidate can still wait for guests or a name.
- `apps/server/src/invoice-delivery.ts:262`: expose `invoiceDeliveryClaimsDue(tx, now)` using the same sending/`claimLapsed` predicate as expiry. Preserve global expiry, restart behavior and linked print-job updates.
- `apps/server/src/till-api.ts:2472` and `:2792`: keep `requireSession` outside turns. Take a no-drain `withWriteLock` turn, checking existing zone/sale authorization and due work; if none, return the existing read there. Otherwise leave the lock, then enter existing `withTransaction`, repeat those checks, reconcile and read. Capture one `now` per decision/expiry. Preserve both delivery response branches, zone filtering, resets, revisions and after-commit notifications. Never nest locks (`packages/store/src/write-queue.ts`) or change draining (`packages/db/src/tenancy.ts`).

**Test first, then implement:**

- `apps/server/src/start-full-disk.e2e.test.ts`: first reproduce each pending-row failure on its existing small real filesystem; expect 200, exact baseline data, unchanged pending row and no delivered notification. Observe the expected red before implementation. Add genuine due-write controls expecting `507 storage.disk_full`, unchanged rows/no notification, then successful reconciliation and notification after freeing space. Deliberately replace the blanket two-route 507 assertion under this watcher ask; document it in PR “Changed test checks”.
- `apps/server/src/floor-today-store.test.ts` and `apps/server/src/invoice-delivery.test.ts`: use ordinary `useVenueDb` coverage for shared due decisions, including day reset/catch-up and lease boundaries/backward-clock claims. Retain existing behavior assertions.
- `apps/server/src/floor-catch-up.test.ts` and `apps/server/src/till-api.deliveries.test.ts`: own route reconciliation, revisions and global expiry. Reuse session checks and `apps/server/src/till-api.profile-zones.test.ts`; do not repeat dependency failure suites or change fiscal tests. Run focused changed files, real-disk with `WAITRON_REQUIRE_TEST_TOOLS=1`, then normal hook/current-head CI.

**Closure and budget:** remove only the resolved two-read bullet from `docs/backlog/box.md`; update `docs/backlog.md`. Add dated supersession pointers for blanket transaction retention in `docs/developers/conventions-data.md` and `docs/superpowers/plans/2026-11-15-full-disk-words.md`. Change `apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md` only for actionable staff instructions; no UI design. No global helper, schema, cache, worker, membership change, fiscal-core change or failure-masking fallback. One build PR within three working hours. Estimate additions/removals: production +110/−35, tests +210/−20, support +0/−0, prose +75/−10: 460 lines; stop for watcher outside opinion beyond 690 (1.5×).
