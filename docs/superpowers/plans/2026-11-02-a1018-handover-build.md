# A1018 — controlled and emergency handover between two boxes — Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`. An implementer that passes about 150 tool calls with its task
> unfinished stops at a passing (or cleanly failing) point, commits, and hands over.

**Goal:** Let a venue move from its old box (called M1) to a selected replacement (M2) in two
ways — a *controlled handover*, when M1 still answers, and an *emergency handover*, when it does
not — so that M2 runs the venue under its own identity and a fresh invoice series, M2 alone talks
to the Spanish tax agency (AEAT) afterwards, and a returning M1 hands back only its tax records and
AEAT's answers.

**Architecture:** One new generic package, `@waitron/handover`, owns the signed message formats,
digests and the order of steps. Each box keeps its handover progress in its own `node.db` (the
per-box database file that the venue copy never overwrites). The server gains routes on both
boxes; the tax module contributes what only it understands (a summary of each invoice chain, a
whole-chain check of a copy, and building and applying the returned tax records) through new
optional module seats, so generic code never learns the tax regime. Everything is built and
tested local-to-local first; the Cloud placements reuse the same steps once the Cloud half is
jointly specified.

**Tech Stack:** TypeScript, Hono routes, Lit screens, Drizzle on SQLite (`@waitron/store`),
Ed25519 signatures (`@waitron/membership`'s `signBytes`/`verifyBytes`), Vitest (Node and real
Chromium), the `bench/sqlite-failover` rig.

**Spec:** [A1018 design](../specs/2026-10-23-a1018-simple-handover-design.md), owner-approved
2026-10-24 as published at `2c13c7f55d` (both Harbour Kitchen handovers, §§8–9, and the retained
defaults in §§3, 5 and 7). Read beside it: [A947 design](../specs/2026-10-21-a947-two-box-failover-design.md)
§§6.3, 6.4, 6.5, 7, 7.1, 7.2, 11, and the [A947 slice 3a plan](2026-10-31-a947-3a-node-db.md) (what
`node.db` holds). Build authority: the owner, 2026-11-01, "Yes, build it" (campaign queue, A1018).
Revised after a fresh-context review on 2026-11-02; what changed is in the last section.

> **For per-slice reviewers.** Two tables in this plan changed in every one of its six review
> rounds: the start check's decision table (Task 3.4) and the crash-window table (Formats →
> "Crash windows"). Each round found a new case where a box was left stuck or wrongly stopped. So
> every slice that touches the start check, a handover operation's states, or a route behind the
> read-only gate (Task 3.2's table) must re-walk **both** tables against its own code before it
> lands: for each table row its change can reach, say which test covers it, and add a row where
> the change creates a new step that writes both databases or waits on another box's answer.

---

## Words used in this plan

- **M1, M2**: the old box and the selected replacement, as in the design.
- **Stepdown**: M1 closes its doors to new requests, tells every background duty that reaches
  outside or files to stop, writes, on its own disk, that it has handed over, lets requests already
  admitted finish and those duties end, then restarts into a *restricted start*: it sells nothing, files nothing,
  contacts AEAT in no way, and serves only its status page and the handover routes.
- **Handover gate**: the request filter that does the "closes its doors" part of a stepdown. It
  refuses every new request except a short list, and counts the requests already inside so the
  stepdown can wait for them (Slice 2).
- **Final copy**: a complete, consistent copy of M1's `venue.db` taken after stepdown.
- **Indicator**: the signed summary M1 sends with the final copy, which M2 checks the copy against
  (design §3).
- **Relinquishment**: M1's signed record that it gives up filing to this M2 (design §§2, 6).
- **Relinquished fact**: the new fact a controlled activation records in its tax approval —
  "the old box signed away filing to this box" — in place of "the old box is offline", which
  would be false while M1 sits restricted (Slice 5a).
- **Declaration**: the emergency statement a person makes on M2 — M1 is switched off, nobody else
  is recovering the venue, and the missing last minutes are accepted (design §4).
- **Return batch**: what a returning M1 sends M2 — its tax records M2 lacks, the filing state of
  all its tax records, every AEAT answer it received, and any send whose answer is still unknown
  (design §§5–6). After a controlled handover the batch holds no records (M2 already has them all)
  and serves only as the receipt M1 needs before it may become a spare.
- **Chain**: one box's sequence of tax records, each linked to the one before by its fingerprint
  (the *huella*). A new box always starts a new chain.
- **Filing**: sending tax records to AEAT. **Drain**: the code that does it
  (`packages/fiscal-verifactu/src/drain.ts`).
- **Mirror**: a box in `mode = mirror`, serving read-only (`packages/node-db/src/schema/node-mode.ts:11`).
- **Finished joining**: a spare whose `nodes` row the main box's `venue.db` holds. Only A947 slice
  3b writes that row for a spare (below).
- **Simulation**: two servers started in one test process on two folders. It is a test, never
  physical qualification.

---

## Before you build: what this plan depends on, and what it can build now

**A947 slices 3b onwards are not built** (campaign queue, A947 heading: "NEXT for A947: slices 3b
onwards"; `git log --oneline origin/main | grep -i a947` on 2026-11-02 shows only 3a, #2371, and 4a,
#1990). Five facts follow, each traced on `61bfdfe405`:

1. **A joined spare never finishes joining today.** `adoptFromPrimary` writes a pending-adoption
   latch (`apps/server/src/adopt.ts:195-202`); finishing refuses `mirror.venue_not_copied` while
   the spare's `venue.db` holds no venue row (`apps/server/src/reserved-identity.ts:68-69`), and
   nothing copies one (`apps/server/src/finish-adoption.ts:29-33`). While latched, a spare serves
   only `/health` and its box status (`apps/server/src/boot.ts:1540-1579`).
2. **But the main box's chart already lists that spare.** Adoption appends it as
   `serving-secondary` at the address the spare sent (`apps/server/src/mirror-bundle-api.ts:207`,
   through `withMember`, `packages/membership/src/standings.ts:30-38`), and both boxes send the
   same advertised origin, `https://waitron.local` by default (A947 §2; `apps/server/src/adopt.ts:109`).
   So a rule that reads "the chart lists another box" is already true on any main box that ever
   started an adoption. A947 slice 3b gives each box its own name.
3. **The main box's `venue.db` holds no `nodes` row for any other box today.** The non-test
   writers of `nodes` are a first setup, for the box itself
   (`packages/provisioning/src/venue-apply.ts:359`), and a spare finishing its own adoption, into
   its own file (`apps/server/src/reserved-identity.ts:77`, via `insertReservedNodeTx`,
   `packages/db/src/reserved-identity.ts:26-31`) — read with
   `git grep -n "insert(nodes)" -- 'apps/**/*.ts' 'packages/**/*.ts'` on 2026-11-02, test files
   and demo scripts set aside. A947 3b is where "the main box writes the spare's `nodes` row and
   adoption-pending closes" (A947 design, slice 3b, `:1678-1682`). Promotion already refuses
   `node.not_found` without it (`apps/server/src/promote.ts:250-254`).
4. **A mirror listens on loopback only** unless the operator opts in with
   `WAITRON_MIRROR_ALLOW_EXPOSED` (`assertMirrorBindSafe`, `apps/server/src/boot.ts:1691-1695`), so
   no other box can reach a real mirror's routes today.
5. **Nothing follows the main box's stream into a live copy** (A947 slice 3c).

So this plan is cut in two:

- **Buildable now, and useful alone** (Slices 0–4, 4b, 5a, 9): formats, durable progress, the
  restricted start, the boot check, the final copy, payment collection ownership, the relinquished
  fact, the prototype re-run.
- **Buildable now against a simulated mirror, reachable on real boxes only after A947 3b** (Slices
  5–8, 10–14): every step where M2 runs. Their tests start M2 as a mirror whose `venue.db` was
  seeded from M1's, the pattern `apps/server/src/till-reroute-e2e.test.ts:315-392` already uses
  (both servers up together, M2 promoted and restarted). Nothing here is reachable on a real venue
  before 3b, for three separate reasons: M1 cannot reach a mirror bound to loopback (fact 4);
  M1's start of a controlled handover refuses `handover.destination_unaddressable` while M2's
  chart address equals M1's (Task 5.3); and Slice 3's start check counts only peers that finished
  joining (fact 3; Task 3.4), so a main box whose chart lists a half-joined spare starts as it
  does today. The emergency's continuous last copy arrives with A947 3c; until then Slice 14's
  selected-backup copy is the only copy source a real spare has.

A947 slices 4b, 4c, 4d, 4e, 5a, 5b, 5c and 5d overlap this plan. Slice 0 writes the amendment that
says which A1018 slice replaces or narrows each.

---

## Questions for the owner

**Two questions, both answered (a) by the owner on 2 November 2026. Slice 12b is built; Task 7.4b
is not.** Every other slice is the same under either answer.

**2026-11-03:** Slice 9 left one more open question, whether S2's verdict is read off Parts F and G
alone; it is under _Still unsettled_.

**Dropped from the draft: "may a returned invoice come back as a tax record only?"** The approved
design already answers it. §5: "Do not replay orders, payments, cash, drawer, stock, printing or
other business side effects", and only "original immutable fiscal records and the fiscal chain
and filing rows needed to understand them" return. The draft's option (b) brought the sale's order
row back, which that rules out; the only other way to put a returned record into
`registros_facturacion` is to make its required `sale_id` optional
(`packages/fiscal-verifactu/src/schema/registros.ts:52-55`), which changes a protected table. So the
separate store of returned records (Slice 11) is what the design implies, and it is built without
asking.

### Q1 — Do invoices that come back from the old box after an emergency count in the new box's VAT return (modelo 303)?

**Owner answer, 2 November 2026: (a)** — count returned invoices in the modelo 303 as a separate line «Invoices returned from the old box», dated by each invoice's own issue date; never in a daily close (shown beside it). FISCAL: the owner lands Slice 12b; marked pending the venue's tax adviser.

**What forces the question.** Slice 11 stores and files a returned invoice, but the VAT return
Waitron prepares sums only the new box's own sales: `computeVatReturn` reads `sales.vat_breakdown`
through `aggregateVatByRate` (`packages/reporting/src/vat-return.ts:11-27,36-38`). A returned
invoice has no sale on M2, so today it would be filed to AEAT and left out of the VAT return.

**A worked example (the design's §9, carried on).** Harbour Kitchen's M1 issues invoice
`A-0CNNW/218` at 21:40 on 23 October for table 4 (€100.00 taxable, €10.00 VAT, €110.00 in cash),
then dies. M2's copy is from 21:39, so table 4 is still open on M2. Nora declares the emergency;
a waiter, seeing table 4 open, closes it again on M2 at 21:58 and M2 issues its own invoice for it
(another €10.00 VAT). At 23:30 M1 comes back and returns invoice 218, which M2 files in M1's
identity.

- **(a) Recommended: count it.** M2's VAT return for the quarter shows a line "Invoices returned
  from the old box: €100.00 taxable, €10.00 VAT", dated by the invoice's own issue date, beside
  and added to M2's own sales. Until Nora settles table 4 (for example with a corrective invoice
  for M2's duplicate), the quarter shows €20.00 of VAT for one meal, and the reconciliation list
  says why. Why recommended: AEAT receives invoice 218 under the venue's own tax number (M2 files
  it, design §6); the code describes the return's output side as a sum over filed invoices' VAT,
  bucketed by their filed issue date (`vat-return.ts:14-16`), and a returned invoice is a filed
  invoice that only lacks a sale row on M2. Leaving it out would make Waitron's figure disagree
  with what AEAT holds. That is a reading of the design and of the code's own description, **not tax
  advice**: the plan builds (a) and marks it pending the venue's tax adviser. **Cost:** a FISCAL
  change to `vat-return.ts`, `modelo-303.ts` and `dr303.ts` (Slice 12b).
- **(b) Leave it out, and show it only in the reconciliation list and beside the reports.** The
  quarter's return shows €10.00 less VAT than AEAT holds, and Nora adds invoice 218 to the return
  by hand. **Cost:** none in code; the risk of an understated return sits with the person.

**Either way, a returned invoice never enters a daily close.** The daily close is a frozen,
append-only record (`packages/db/src/classification.ts:38`) whose hash covers its whole snapshot
(`packages/reporting/src/daily-close-hash.ts:71-95`), and 23 October's close may be made before
23:30. So returned invoices are shown *beside* the close and the cash-up, read when the screen
opens, and the close itself is unchanged (Task 12a.5). Putting them inside later closes would
change the format of a hash-chained record; it is not built unless the owner asks.

**Built:** (a), in Slice 12b, which the owner lands; pending the venue's tax adviser.
Slice 12a (the list and the lines beside the reports) is the same under either answer.

### Q2 — In an emergency, does the new box wait 90 to 150 seconds before naming its new invoice series, or take the next free minute?

**Owner answer, 2 November 2026: (a)** — the next free minute, as A947's approved switch; no change to `hour-selection.ts`, CLAUDE.md §5 unchanged, so Task 7.4b is not built.

**What forces the question.** The draft said an emergency takes the setup and restore wait,
because the last copy might lack a name the old box took after it. The code lets only a setup, a
restore and a conflict switch wait (`packages/fiscal-verifactu/src/hour-selection.ts:461`), and
CLAUDE.md §5 says "Setup/restore wait 90–150 seconds; promotion does not." So the draft's wait
cannot be built without changing fiscal code. Meanwhile A947's own switch — the spare taking over
from a main box that died, which is this same situation — takes the next free minute, by the
owner's approval of A947 §6.5 (rules 2–3, `docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md:836-850`).

**A worked example.** Harbour Kitchen, 23 October. M1 dies at 21:40 (19:40 UTC). Nora presses
**Start the venue on this box** on M2 at 21:52:10 (19:52:10 UTC); her phone's clock and M2's agree.

- **(a) Recommended: the next free minute, as A947's switch already does.** M2 takes 19:52 UTC at
  once: its series are `A-0D008` and so on. No fiscal code changes and CLAUDE.md §5 stays as it
  is. **What it leaves open:** names are UTC minutes, so the only name M2 could repeat is one M1
  took in roughly its last 150 seconds that the copy lacks (A947 §6.5's arithmetic, 45 + 45 + 60
  seconds, `:841-847`). M1 takes a name only when it is itself being set up, restored or switched,
  which a box selling at 21:40 was not doing; another box doing so is what the declaration's "no
  other recovery is in progress" rules out. The same holds for a copy from an older backup
  (Slice 14): a name M1 took long after that backup is an earlier minute than now, so it cannot
  be the one M2 takes.
- **(b) The restore's wait.** The page counts down 90 to 150 seconds, then takes 19:54 UTC
  (`A-0D00A`). **Cost:** a FISCAL change to `hour-selection.ts:461` letting a promotion under a
  recorded emergency declaration wait, a change to CLAUDE.md §5's "promotion does not" line, the
  owner lands it (Task 7.4b), and staff wait up to two and a half more minutes during an outage.

**Built:** (a). Task 7.4b is not built.

**No third question.** The other choices this plan makes are builder's choices that follow from
the approved designs; each is listed under "Decisions this plan makes" with its reason, open to
the owner.

---

## Decisions this plan makes (builder's choices, open to the owner)

1. **Stepdown is a restart, not a live switch.** M1 closes the handover gate, tells its
   outside-facing background duties to stop, writes its restriction to `node.db`, lets admitted requests finish,
   and restarts into the restricted start (Slice 2). Why: no live way to close every writer
   exists — the read-only gate is mounted only on a box that boots as a mirror or fenced
   (`boot.ts:1699-1718`) — while the restricted start can refuse to start each writer, which a
   test can list. The restart already exists for promotion (`boot.ts:3079-3092`; Docker restarts
   the box, `deploy/compose.yml:12`).
2. **A stepdown never touches the trading admission or the singleton role.** The draft used
   `TradingAdmission.requireRestart()` (`apps/server/src/trading-admission.ts:19-21`). That breaks
   the work it means to let finish: a card sale re-checks the admission in a second transaction
   after the reader answers (`apps/server/src/till-sale.ts:1625`, also `:1774`, `:2184`, through
   `requireEconomicWrite`, `trading-admission.ts:26-33`), so a card captured during the wait would
   lose its sale with `venue.time_zone_not_ready`. Instead the handover gate refuses *new*
   requests at the door and counts the ones inside, and the stepdown waits for that count to reach
   zero, at most `HANDOVER_ADMITTED_WORK_LIMIT_MS = 180_000`. The stepdown request itself is not
   counted, nor are the two event streams (`apps/server/src/live-api.ts:106`,
   `apps/server/src/department-transfer-api.ts:127`), which the listener close ends as today. A
   request still running at the limit is logged by route and left to the existing crash-safety (a
   card payment is written `attempting` before its network call,
   `packages/payments/src/schema/payments.ts:23-26`). The singleton role is left alone because it
   is read at many sites in `boot.ts` (`:1691`, `:2052-2114`, `:2356`, `:2490`, `:2551`, `:2628`,
   `:2662`, `:2731`, `:2891`, `:2973`, `:3170`) and this plan has not traced which of them a
   request reaches; stopping the named duties is enough and changes nothing a request reads.
   The 180 seconds is a starting value, to be measured in the owner's rehearsal. **The request
   that asks for the stepdown gets its answer first**: inside that request the stepdown closes
   the gate, signals the outside-facing duties to stop (decision 3) and records the restriction;
   the waiting — for admitted requests, then for those duties in the close — the close and the
   restart run after the answer is sent, as promotion
   answers first and signals itself on the next tick (`boot.ts:3089-3091`). Run inside the
   request, the close would cut the requester's own connection 500 ms in
   (`apps/server/src/close-listener.ts:28,44`) and its answer would be lost.
3. **A stepdown stops outside-facing background work at once, not at the restart.** The drain is
   started by the singleton role, not the admission (`singletonPass`, `boot.ts:3205-3206`); the
   clock watch asks AEAT whenever `filesRecords()` is true (`apps/server/src/clock-watch.ts:281`);
   the card sweep runs in every role (`boot.ts:505-512`). Design §2 step 1 says no new filing or
   payment work starts once the restriction is on disk, and counts "background jobs … and module
   writers" in that. So the stepdown signals, inside the request and right after closing the gate,
   the duties **named** in Task 2.4 — each one that files, moves money, sends to an outside service
   or device, or is a module's own background writer — using the same stops `stopWork` makes at
   close (`boot.ts:3400-3437`), moved into a named table both use; their waits stay in the close.
   **Backups and Litestream are the exception:** they send to the bucket, but they are not filing,
   payment or business work, and design §2 step 2 asks only that "backup/checkpoint writers" stop
   "before taking the final snapshot" (`docs/superpowers/specs/2026-10-23-a1018-simple-handover-design.md:148`),
   which is taken after the restart (Task 4.7). So they stop in their own place in the normal
   close, as today — backups after the sending loop has finished, Litestream last (Task 2.3b). Signalling inside the request
   matters: a loop whose sleep ended between the answer and a later signal would start a new pass
   (`apps/server/src/loop.ts:54-56`). The rest of `stopWork` stays with the close, each with its
   reason recorded in that table. A loop checks its signal only between passes
   (`apps/server/src/loop.ts:54-56,80`), so a pass already running is also told: the drain checks
   it before each new batch, the pass skips the Stripe reconcile, and the card sweep and refund
   recovery check it before each payment or refund (Tasks 2.4b, FISCAL because it touches the
   drain, and 2.4c). A request already sent to AEAT or a card provider is answered and stored, waiting only
   to its own deadline (design §2 step 2). Today's shutdown order is kept exactly (Task 2.3b).
4. **Peers ask each other with a signed request, not a person's password.** The chart is kept off
   arbitrary readers today (`apps/server/src/management-api.ts:1040-1044`, which asks for a
   manager's password); a box asks a peer by signing a short query with its own node key, which
   the peer checks against the keys its own chart vouches for (Slice 3).
5. **The start check counts only peers that finished joining** — a routable box in the chart
   whose `nodes` row this box's `venue.db` holds (fact 3 above). Why: the chart already lists a
   half-joined spare at the main box's own address (fact 2), so the draft's rule would have made
   every such main box wait at every start. Reading `nodes.id` adds no location reader. **And a box
   never waits for the source of an operation it activated as destination** (open or closed) — it
   still asks it, and a newer chart from it still stops this box: M2's
   `venue.db` is M1's copy, so it holds M1's own `nodes` row (written at M1's setup,
   `packages/provisioning/src/venue-apply.ts:359`), and the promotion leaves M1 `sell-only`
   (`packages/membership/src/standings.ts:15`), a routable standing
   (`packages/membership/src/fence.ts:44,57`). Counting it would make M2 wait at every restart
   while M1 is off (review round 2, finding 1). Still asking it matters because the old box's
   node id can come back: re-adoption always takes a fresh id (`apps/server/src/adopt.ts:105`,
   `randomUUID()` in `apps/server/src/reserved-identity.ts:37-40`, and the rejoin wipe clears
   `trading.env`, `rejoin-command.ts:138`), but a cold restore brings back `trading.env` with the
   node id in it (`RECOVERY_FILES`, `apps/server/src/state-secrets.ts:16-23`) (review round 4).
6. **The person drives an activation from a page M2 serves.** M2 names its new series from its
   own minute after another machine's clock agrees (CLAUDE.md §5), and the second clock it accepts
   is a browser's, read by challenge, never one on the same machine
   (`packages/fiscal-verifactu/src/hour-setup-clock.ts:106-127`). So in a controlled handover the
   person starts on M1's dashboard (where a fresh passkey or password sign-in works today,
   `confirmFreshSignIn`, `apps/server/src/fresh-sign-in.ts:45`), and the dashboard then opens M2's
   own handover page for the clock reading and the activation; in an emergency the person is on
   M2's page throughout.
7. **The minute name:** the next free minute in both scenarios (Q2, answered (a)). A controlled
   handover's final copy holds every name M1 ever used; for the emergency, see Q2.
8. **The returned records reach M2 as a full-state batch for every chain M1 holds**: every
   filing-state row and every AEAT answer M1 holds (A947 §7.1's rule, "not only the rows the
   receiver lacks"), M1's `envio_flujo` row (the AEAT wait time and the technical-incident token,
   `drain.ts:416-442,1185-1237`), and the tax records after the head M2 reports for each chain. M2
   never moves its own `envio_flujo` gate earlier because of M1's: it keeps the later of the two
   next-send times, and records M1's incident token as evidence without adopting it. A retry with
   the same reported heads returns the same bytes (Slice 10).
9. **The emergency declaration page offers password plus authenticator code, not a passkey, until
   A947 4b/4d.** A passkey sign-in writes its one-time challenge to the venue database
   (`packages/identity/src/passkey.ts:263-265`), and a passkey registered for `waitron.local`
   needs the venue's or the box's own name (A947 §6.6), which A947 3b and 4d provide. The page says
   so in one line. Controlled handovers start on M1's dashboard, where passkeys work. The code is
   asked when the person has one enrolled, as design §7 says ("password plus TOTP when enrolled").
10. **"Carry on as the main box" lasts for this start only.** The next start asks the peers again
    (Task 3.5). Why: a decision that outlived a restart would let a box that later learns of a
    handover keep ignoring it.
11. **Resolving a reconciliation item takes `node.promote`**, the permission to switch the
    venue's server; listing takes `report.view` (Task 12a.2).
12. **Payment collection belongs to the box that started the payment.** A764 asks, before a second
    venue node is enabled, to "restrict provider cancellation to its collection owner or add
    coordination between nodes" (`docs/backlog/payments.md:476-479`). This plan takes the first:
    every payment row names the box that started it in its existing `node_id` column, which nothing
    writes today (`packages/payments/src/schema/payments.ts:57-58`); the card sweep acts only on
    rows its own box owns; and an activation passes the old box's rows to the new box (Slices 4b
    and 5). Tender refunds already carry `node_id` and recover only on a non-fenced primary
    (`boot.ts:3304-3306`).
13. **A controlled M1 becomes a spare through the same return exchange as an emergency M1.** Its
    batch holds no records, because M2 already holds every one; the receipt and the gates then run
    unchanged (Slices 10 and 13). Why: one path to test, and A947 §7.2's checks are the proof a box
    needs before it wipes itself.
14. **M2 may close a return that is never coming.** If the old box never returns, a person holding
    `node.promote` records "the old box will not return"; the operation closes as
    `return_abandoned` and the unknown interval stays open in the reconciliation list (design §5:
    "If the disk never returns, retain a known-unknown missing-tail gap"). Without this, M2 could
    never hand over again (Task 13.5).

---

## Formats (local-only, version 1)

These formats are **local-to-local, version 1**. They are not qualified for Cloud: the contract
says "No wire format or runtime behaviour is qualified by this agreement" (Cloud
`docs/waitron-integration-contract.md:1387` at `08a2a0d4`), and asks that Cloud's resource
journal be bound to "the same operation, venue/installation mapping, M1, selected M2, expected
signed membership revision/digest, scenario and input fingerprint" (`:1488-1490`). A Cloud
placement may need a version 2. Slice 0 sends Cloud's lane G that notice before any build slice.

Every signed object is an **envelope**:

```ts
interface SignedHandoverEnvelope<B> {
  readonly purpose: `waitron.handover.${HandoverKind}.v1`;
  readonly signerNodeId: string;
  readonly body: B;
  readonly signature: string; // base64 Ed25519 over canonicalize({ purpose, signerNodeId, body })
}
type HandoverKind =
  | "query" | "status" | "stepdown" | "final-state" | "acceptance"
  | "relinquishment" | "declaration" | "return-batch" | "return-receipt" | "health";
```

`canonicalize` is `@waitron/membership`'s sorted-key JSON (`packages/membership/src/canonicalize.ts:15-24`);
the signature uses `signBytes`/`verifyBytes` (`packages/membership/src/crypto.ts:14-41`), as the
stream pointer does with its own purpose string (`packages/stream/src/pointer.ts:23,31-33`). The
purpose and signer are inside the signed bytes, so an acceptance can never be replayed as a
relinquishment, and a body signed by one box never verifies as another's. A digest is the
lower-case hex SHA-256 of the UTF-8 bytes of `canonicalize(envelope)`.

**The binding** — what one operation is about, fixed when it starts:

```ts
interface HandoverBinding {
  readonly operationId: string;                    // UUID v4
  readonly scenario: "controlled" | "emergency";
  readonly venue: { readonly country: string; readonly taxId: string;
                    readonly environment: "production" | "preproduction" };
  readonly sourceNodeId: string;                   // M1
  readonly destinationNodeId: string;              // M2
  readonly membership: { readonly term: number; readonly digest: string };
}
```

`venue` is the one `tenants` row (`packages/db/src/schema/tenants.ts:38-55`) and the deployment
stamp (`packages/db/src/schema/deployment.ts:10-24`); there is no location in it (owner,
2026-11-01). `membership.digest` is the digest of the held signed chart. The **binding
fingerprint** is the digest of `canonicalize(binding)`. The same operation id with the same
fingerprint returns the stored result; with a different fingerprint it is refused
`handover.operation_conflict` (design §7).

**The progress states**, one row per box per operation in `node.db`, each step recorded once:

| Role | Controlled | Emergency |
| --- | --- | --- |
| source (M1) | `prepared` → `source_stepped_down` → `filing_relinquished` → `return_pending` → `return_complete`; from `prepared`, `abandoned`; from `source_stepped_down`, `replaced` | (learns at return) `source_superseded` → `return_pending` → `return_complete` |
| destination (M2) | `prepared` → `copy_accepted` → `filing_assumed` → `activated` → `return_pending` → `return_complete` or `return_abandoned`; from `prepared`, `replaced` or `abandoned` | `prepared` → `emergency_declared` → `activated` → `return_pending` → `return_complete` or `return_abandoned` |

An operation is **open** until `return_complete`, `return_abandoned`, `replaced` or `abandoned`;
a box holds at most one open operation. The two early closings:

- **`abandoned`** — a controlled operation in which the source never stepped down. On M1: the
  offer failed or the stepdown refused at its first check (Task 5.3 records it at once), or the box restarted between recording `prepared`
  and the stepdown's node transaction (the next start records it, Task 3.4). Nothing can have
  relied on such an operation: M1 captures no final copy unless it holds the restriction
  (`handover.not_stepped_down`, Task 4.7), so M2 can never accept one. On M2: only when M1's
  signed status reports that operation `abandoned` (Task 5.4). A
  destination whose source **has** stepped down is never abandoned; it completes or is replaced
  (design §7).
- **`replaced`** — the design §7 crash case: a controlled operation X that reached only
  `prepared` on M2, closed by an emergency declaration Y that names it (Task 7.3). M1, if it had
  stepped down for X, moves X to `replaced` when M2's return request for Y names X, then begins Y
  as source at `source_superseded` — in that order, in one node transaction (Task 10.3). The
  one-open index refuses the other order: a probe on SQLite's partial unique index printed
  `UNIQUE constraint failed` for insert-first and succeeded for update-first. Its restriction,
  which names X, is not rewritten: it already names the same successor.

A box waiting at a step records a `waiting_reason` (a code from the errors registry) beside its
state, never a new state.

**Stepdown record** (`node_handover_restriction`, M1's `node.db`): `node_id`, `operation_id`,
`kind` (`handed-over` | `superseded`), `successor_node_id`, `membership_term`, `recorded_at`. Written
before the stepdown is acknowledged; read at every start before any worker (Slice 2). `superseded`
is what a returning emergency M1 writes when it learns of M2's newer chart (Slice 3). **Nothing
clears it.** It ends only when the box becomes a spare: the rejoin wipe deletes the whole of
`node.db` along with `venue.db` (`DATABASE_FILES = [VENUE_FILE, NODE_FILE]`,
`packages/store/src/index.ts:49`, removed by `apps/server/src/db-wipe.ts:20-28`; called from
`apps/server/src/rejoin-command.ts:133-139`), and the re-adopted box starts with an empty
`node.db` (Task 13.4).

**Final-state indicator body** (`kind: "final-state"`, signed by M1):

```ts
interface FinalStateIndicator {
  readonly binding: HandoverBinding;
  readonly snapshot: {
    readonly sha256: string; readonly bytes: number;            // of the VACUUM INTO file
    readonly schema: readonly { set: string; version: number; journalSha256: string }[];
    readonly modules: readonly { name: string; version: string }[];
  };
  readonly nodeLocal: readonly NodeLocalItem[];                   // the manifest, below
  readonly modulesSummary: Readonly<Record<string, CanonicalValue>>; // per module seat (Slice 4)
  readonly capturedAtMs: number;                                  // M1's clock; informational
}
```

The Veri*Factu module's summary is, per chain it holds (`registro_sif` row): `sifId`, `nodeId`,
`idSistemaInformatico`, `numeroInstalacion`, record count, head record id and head huella (by
`secuencia`), `envios` counts per state, the SHA-256 of its `acks` rows in key order, and the ids
of rows in `enviando`. The payments module's summary lists every external request whose outcome
is still open, with the provider and the reference that anchors its retry: payments in
`attempting`, `initiated` (a hosted payment minted but not yet paid) and `accepted_offline`
(accepted by the reader offline, not yet forwarded) (`packages/payments/src/schema/payments.ts:20-40`,
reference at `:62`), and card refunds still `pending` at a provider (`tender_refunds`, a core
table, `packages/db/src/schema/tender-refunds.ts:23,88-98`). The snapshot is
`StoreHandle.archiveTo`'s `VACUUM INTO` copy (`packages/store/src/archive.ts:24-34`); a copy taken
with every writer stopped is the "consistent snapshot" of design §3, committed journal changes
included. It carries Litestream's `_litestream_seq` and `_litestream_lock` tables as they stood
(CLAUDE.md §3); the comparison expects them, and placement starts a new stream generation.

**Acceptance** (`kind: "acceptance"`, signed by M2): `{ binding, indicatorDigest, acceptedAtMs }`.
M2 records `copy_accepted` in its `node.db` before answering.

**Relinquishment** (`kind: "relinquishment"`, signed by M1): `{ binding, indicatorDigest,
acceptanceDigest, filingAssignedTo: destinationNodeId, authorisedBy: personId }`. M1 records
`filing_relinquished` before answering. `authorisedBy` is the person whose fresh sign-in started
the operation on M1; M2 re-checks, in the accepted copy, that this person holds `node.promote`.

**Emergency declaration** (`kind: "declaration"`, signed by M2):

```ts
interface EmergencyDeclaration {
  readonly binding: HandoverBinding;                         // scenario "emergency"
  readonly wordingVersion: "a1018-emergency-v1";
  readonly locale: "en" | "es";
  readonly statements: { readonly sourceSwitchedOff: true; readonly noParallelRecovery: true;
                         readonly missingTailAccepted: true };
  readonly reason: string;                                   // 1–500 characters, required
  readonly lastCopy: { readonly source: "mirror-copy" | "selected-backup";
                       readonly identifier: string; readonly lastChangeAtMs: number | null };
  readonly provider: null;                                   // Cloud resource id: see "Waiting for the joint specification"
  readonly actor: { readonly personId: string; readonly method: "password" | "password+totp" };
  readonly declaredAtMs: number;
  readonly replaces: string | null;                          // a controlled operation id (design §7)
}
```

`reason` may name people, so it is stored and shown, never logged (CLAUDE.md §3, personal-data
log rule). `personId` is an id, not a name.

**Return batch** (`kind: "return-batch"`, signed by M1): `{ binding, sequence, requestDigest,
frozenAtMs, fiscal: <regime body> }`. `requestDigest` is the digest of M2's request, which carries
M2's head (`secuencia`) for each of M1's chains. The Veri*Factu body: for each chain M1 holds,
every `registros_facturacion` row after M2's reported head, in `secuencia` order, byte-for-byte as
stored; every `envios`, `acks`, `filing_cases` and `filing_case_events` row M1 holds for any record
of those chains; M1's `envio_flujo` row (decision 8); the ids of rows left `enviando`. After a
controlled handover the records list is empty. M1 stores the bytes of each batch beside its
operation and answers a retry with the same request with the same bytes (design §6).

**Return receipt** (`kind: "return-receipt"`, signed by M2): per record, its id and huella as M2
holds it (in its own copy or the returned-records store); per filing row, M2's state; per chain,
count and head huella. M1 checks it against its own (Slice 13).

### The node-local manifest

What a box keeps for itself — in `node.db`, in its state folder, and in the `local` tables inside
`venue.db` — and what M2 does with each (design §3 asks the builder to enumerate it). `node.db`
tables are from `packages/node-db/src/classification.ts:6-12`; `venue.db`'s `local` tables from
`packages/db/src/classification.ts:257-276`, `packages/fiscal-verifactu/src/classification.ts:20-29`
and `packages/credentials/src/classification.ts:12`; state files from
`apps/server/src/state-secrets.ts:16-23`, `apps/server/src/backup-optional-state.ts:10-16` and the
modules' non-database state (`apps/server/src/backup-sources.ts:50-62`).

| Item | Where | Class | M2's treatment |
| --- | --- | --- | --- |
| `node_mode`, `node_mirror_link`, `node_primary_key` | `node.db` | destination-owned | M2 keeps its own; M1's never travel |
| `node_recovery_key` | `node.db` | destination-owned | M2 keeps its own recovery-key check |
| `node_signing_key` | `node.db` | source-only | M1's private key never leaves M1 (design §2) |
| `node_handover_operations`, `_events`, `_restriction` (Slice 1) | `node.db` | destination-owned | each box keeps its own |
| `join_requests` | `venue.db` | source-only, inside the copy | keyed by the receiving box's node id; M2 reads only its own rows, so M1's lie unused |
| `change_log` | `venue.db` | rebuildable, inside the copy | a dashboard signal deleted by the transaction that wrote it; a leftover row is delivered once on M2, harmlessly |
| `node_sealed_state` | `venue.db` | source-only, inside the copy | M1's state files sealed with M1's recovery key, which M2 cannot open; M2 writes its own row |
| `recovery_packs` | `venue.db` | source-only, inside the copy | keyed by M1's node id; M2 reads its own or none |
| `fiscal_certificate_installs`, `fiscal_certificate_reminders` | `venue.db` | source-only, inside the copy | keyed by M1's node id. The certificate itself is in `tenant_credentials`. What M2's certificate card shows after activation is asserted in Task 5.10; if it shows no certificate, that is reported as a follow-up FISCAL task, not patched here |
| `tenant_credentials` | `venue.db` | transferred, inside the copy | sealed under the venue key ring (`packages/credentials/src/schema/tenant-credentials.ts`), so usable on M2 only when M2's ring holds every version: the ring check below |
| `secrets.env` (key ring) | state | transferred, earlier | reached M2 at joining (A947 3a Task 14a); the indicator lists the ring's key versions and M2 refuses `handover.key_ring_mismatch` when it lacks one (backlog A1273) |
| `trading.env` | state | destination-owned | M2 keeps its own node id; promotion rewrites it (`boot.ts:3067-3075`) |
| `tls/ca.*`, `tls/server.*`, `tls/venue-ca.*` | state | destination-owned | M2 keeps its own; the venue authority reached it at joining |
| `backup.env` | state | transferred, compared | the indicator carries its digest; a difference waits `handover.backup_settings_differ` |
| `modules.json` | state | transferred, compared | as `backup.env`; M2 refuses a module set that differs |
| `module-preparation-state.json` | state | source-only, summarised | it holds module operation history, including the minute selections (`packages/provisioning/src/module-preparation-state.ts:73-83`; backed up as `secrets/module-evidence/fiscal-verifactu/hour-history.json` through `FISCAL_HOUR_BACKUP_STATE`, `packages/fiscal-verifactu/src/hour-backup-state.ts:49`). M2 keeps its own file. Task 4.5 finds, by a test, whether M2's minute selection sees every name M1 used from the copy alone; if it does not, M1's projected history travels as the retained `module-evidence` file the restore path already places (`apps/server/src/first-setup-backup-recovery.ts:551-582`) |
| Litestream's `.venue.db-litestream/` | state | rebuildable | never copied; the new primary opens a new generation |

### Crash windows: what a restart or a lost answer does at each step

Two review rounds each found a box left stuck by a restart between two writes. So every step that
writes both `venue.db` and `node.db`, or crosses a network answer, is listed here with what happens
at each point and the test that covers it. The rule behind every row: **a step is recorded
before the request that depends on it is sent, every request is repeated from that record, and
every receiver answers a repeat from what it stored the first time.** A row added later keeps the
same shape.

| Step | Restart or lost answer at… | What happens | Test |
| --- | --- | --- | --- |
| M1 starts a controlled handover (Task 5.3): `node.db` `prepared` → offer to M2 → stepdown's node transaction | after `prepared`, before the stepdown's node transaction (offer unsent, unanswered or answered) | M1's next start moves it to `abandoned`, then the start check runs: it sells once M2 answers = (rule 4), and waits if M2 is silent (rule 5), as any box with a joined peer does (Task 3.4); M2, if it recorded `prepared`, closes when M1's status reports `abandoned` (Task 5.4) | 3.4 "a source operation left at `prepared`…"; 5.3 "a stepdown that throws…"; 5.4 "M1's status reporting… `abandoned`" |
| | the offer was refused, or the stepdown refused at its first check | M1 records `abandoned` at once and keeps selling | 5.3 |
| | the stepdown's write failed | M1 restarts as a normal box, and its next start moves the operation to `abandoned` (first row) | 5.3 |
| Stepdown (Task 2.4, as built): read-only check → gate → signal duties → restriction → answer → admitted requests → close (awaits the duties first) → restart | anywhere after the restriction's node transaction, or the answer is lost | M1 starts restricted; a repeated request is answered from the stored operation by the restricted start | 2.6; 5.3 "a retry after the restart…"; 2.4 "the caller… receives its full answer body" |
| Capture (Task 4.7): copy file → `final_state` event | after the file, before the event | the next request captures again from an unchanged `venue.db` (a restricted start writes nothing to it, Task 2.2) and records one event | 4.7 "a crash between the copy and the event…" |
| M2 fetches the copy (Task 5.4) | any point | the duty retries every 5 s while M2 is at `prepared`; partial files are discarded | 5.4 |
| M2 accepts (Task 5.5): `node.db` `copy_accepted` → post acceptance → M1 records `filing_relinquished` → answer → M2 records `filing_assumed` | M2 restarts after `copy_accepted`, or the answer is lost | the posting duty re-posts the same stored acceptance; M1 answers its stored relinquishment byte for byte | 5.5 "M2 restarted at `copy_accepted`…"; 5.6 "a repeated acceptance…"; 5.8 "a reboot of M1 between relinquishment and M2's assumption…" |
| M2 places the copy (Task 5.7): file swap → `copy_placed` event | mid-swap; after the swap, before the event | mid-swap: placed again from the kept `accepted.db`; after the swap: the live digest equals the indicator's, so only the event is recorded | 5.7 |
| Activation (Tasks 5.8, 7.4): one `venue.db` transaction (module activation, `trading.env`, chart; handover rows with it or right after) → `node.db` role and `activated` → restart | before the venue commit | still a mirror at `filing_assumed` / `emergency_declared`; the page repeats the activation | 5.8 "a lost activation answer…"; 7.5 "a reboot between declaration and activation…" |
| | after the venue commit, before the `node.db` records | `finishPromotedRole` makes it primary (`promoted-role.ts:39-62`); the `handover_activations` row committed with the chart (Task 5.8), so Task 5.8b records `activated`; the start check asks the source but does not wait for it (rule 3, when M1 is its only peer); it sells | 5.8b "M2 killed between…"; 7.4 "a crash after the activation commit…" |
| A controlled handover stuck at `copy_accepted` or later, M1 gone for good | — | M2 waits on M1, by design: once final-copy acceptance exists, design §7 keeps the controlled operation and its selected M2 "until its state and filing assignment are recovered", and an emergency may not replace it (`handover.controlled_unresolved`, Task 7.3). M2 is still a mirror and files nothing | 7.3 "refused from `copy_accepted`" |
| | the answer is lost | a repeat answers `activated` and takes no second name | 5.8; 7.4 |
| M2 hands its chart to M1 (Tasks 5.10, 10.4) | the post is lost, or M1 is off | the return watch re-posts while M1 reports an older term | 10.4 "posts M2's chart…" |
| Emergency declaration (Task 7.3): one node transaction (old controlled operation to `replaced` first, then the new one) | before or after the commit; the answer is lost | before: nothing recorded, the person presses again; after: the same operation id answers the stored declaration | 7.3; 7.5 |
| | after the commit, the clocks then disagree, or the page is closed | the spare stays a mirror at `emergency_declared` and files nothing; the page, reopened on any device, finds the declaration and goes straight to the sign-in and clock check | 8.1 "opened on a second device…" |
| Returning M1 learns it was superseded (Tasks 3.3, 3.4): restriction → restricted start | before the restriction | the next start asks again; M2's newer fencing chart gives `superseded` (rule 1) and the restriction is written; if M2 is silent, M1 waits (rule 5) | 3.4; 7.5 "M1 comes back while M2 is at `emergency_declared`…" |
| Return batch (Tasks 10.3–10.7, 11.2): M1 writes the batch file and `return_pending` → answer → M2 applies in one `venue.db` transaction → `node.db` state → receipt | M1 restarts after the file; the answer is lost | the same request (same heads) is answered from the stored file, byte for byte | 10.3 "the same request twice…" |
| | M2 restarts after the apply commit, before its `node.db` record | the watch asks again; the apply changes nothing the second time; the state is recorded | 10.6 "a crash after the apply commit…" |
| | M1 holds a replaced X when Y's request arrives | one node transaction: X to `replaced`, then Y begun | 10.3 |
| Carry on as the main box (Task 3.5): event → restart | after the event | the next start asks the peers again (decision 10) | 3.5 "the next start asks the peers again" |
| Old box will not return (Task 13.5) | before or after the `node.db` record | before: nothing changed; after: closed, and a new handover may begin | 13.5 |
| Rejoin wipe (Tasks 13.4, 13.4b): `wipe_started` event → `venue.db` removed → `node.db` removed | between the two removals | the next start (13.4b) or command run (13.4) finds `wipe_started` and finishes the wipe without judging again | 13.4 "a crash after `venue.db` is removed…"; 13.4b "a start with `wipe_started` after a crash…" |

---

## Fiscal boundary, slice by slice

**Protected, untouched by every slice:** `computeHuella` (in `@waitron/verifactu`, outside this
repository), the chain and `Encadenamiento`, invoice-number allocation, `registros_facturacion`'s
schema and its append-only triggers, the alta builders `recordSale` / `recordCorrection` /
`recordSubstitution` (`packages/fiscal-verifactu/src/backend.ts:287,474,579`), `registerSif`
(`packages/fiscal-verifactu/src/registro-sif.ts:111-158`) and `restoreFiscal`
(`packages/fiscal-verifactu/src/restore.ts:3`). Every slice's final task runs
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
and `git diff origin/main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
(which must print nothing). The first is the golden huella test; neither is edited by any slice.

| Slice | Fiscal? | What touches fiscal behaviour |
| --- | --- | --- |
| 0 Docs | no | — |
| 1 Records and formats | no | — |
| 2 Restricted start | **FISCAL** | stops a filing box's drain and every other AEAT contact, at once and across restarts; the drain checks a stop signal before each batch (Task 2.4b) |
| 3 Boot check | **FISCAL** | decides, before the first filing pass, whether a box may file (A947 5a's place) |
| 4 Final copy | **FISCAL** | new read-only code in `packages/fiscal-verifactu` (chain summary, whole-chain check) |
| 4b Payment collection owner | no | payments only; full review for concurrency |
| 5a The relinquished fact | **FISCAL — LOUD** | adds a version 2 approval, written only by a promotion whose old box relinquished filing, to the append-only `fiscal_allocations` (`packages/fiscal-verifactu/src/classification.ts:10`, `schema/allocations.ts:26`); every other approval, including every other promotion's, stays version 1 byte for byte and stays readable; allocation validation and the activation context gain the fact (`packages/fiscal-verifactu/src/allocation-envelope.ts`, `allocation-operation.ts`); also changes the generic module operation contract (`ModuleRecoveryFacts`, `packages/module/src/operation-preparation.ts:15-26`) and the server's promotion path (`apps/server/src/node-operation-preparation.ts`), a cross-package contract |
| 5 Controlled, server | **FISCAL** | activates a fresh fiscal identity on M2; M2 then files M1's copied records |
| 6 Controlled, screens | no, unless Task 6.4 must change `packages/fiscal-verifactu/src/setup/` (then FISCAL) | screens and guides; lands after 5 |
| 7 Emergency, server | **FISCAL** | as 5, under a declaration |
| 8 Emergency, page | no | page and guides only; lands after 7 |
| 9 Prototype re-run | no | a rig that imports no `@waitron/*` package |
| 10 Return batch: evidence | **FISCAL** | writes `envios`, `acks`, `envio_flujo` and filing cases on M2; a new outside input to the drain's per-chain block |
| 11 Return batch: originals | **FISCAL — LOUD** | a new store of returned tax records and a second filing path sharing the drain's AEAT wait and chain order. It stores originals byte-for-byte and never recomputes a huella; it does not write `registros_facturacion` |
| 12a Reconciliation list | no | reads fiscal facts through a seat; writes only the `handover` set's tables; the frozen daily close is unchanged, pinned by a test |
| 12b The VAT return line | **FISCAL** | changes the VAT figure Waitron prepares (Q1) |
| 13 Archive and wipe | **FISCAL** | gates the wipe of a box that holds tax records |
| 14 Copy from a backup | **FISCAL** | places a copy that a fiscal activation then uses |

Every slice is on the **full review path** (risk triggers: fiscal, concurrency, cross-package
contract). A FISCAL slice is landed by the owner. Slices 5a and 11 get a fresh-context review of
their tasks before their first implementer.

**The drain already files every chain it holds** — `claimBatch` has no node or SIF filter
(`packages/fiscal-verifactu/src/drain.ts:600-743`, the `pendiente` read at `:629`) — and each
record is sent with the identity stored on it when it was written
(`fromRegistroRow`, `packages/fiscal-verifactu/src/registro-row.ts:369`; built from the writing
box's SIF at `backend.ts:757-768`). So after activation M2 files M1's copied records in M1's
generating identity with no change to the drain (asesor Q2). That is read from the code, not run;
Task 5.10's simulation runs it against a stand-in AEAT, and Slice 5 changes no drain code.

---

## Global Constraints

- **Pre-live: no backwards-compatibility or data-migration code** (CLAUDE.md §3, last bullet).
  Development and demo boxes are reset (`wa-wt reset demo <name>`); a PR whose migration a box
  cannot take says so in its first line.
- **Nothing per location** (owner, 2026-11-01): no `location_id` column, no `locationId`
  parameter. Where existing code still reads `nodes.location_id` (`apps/server/src/promote.ts:250-255`),
  new code does not add a reader; A1301's slices remove it.
- **`node.db` rules** (CLAUDE.md §3): every new `node.db` table is `local`, keyed by `node_id`
  that every read and write names; no foreign key into or out of `node.db`; take `node.db`'s write
  lock outside `venue.db`'s; where one change spans both files, save `venue.db` first and `node.db`
  after, and say so in a one-line comment at the site; write `node.db` only through
  `withNodeTransaction` (`packages/db/src/tenancy.ts:48-53`). Each new `node.db` table's writer
  file is listed in `scripts/write-path-tables.json`.
- **Replacing or removing the live `venue.db`** (Tasks 5.7, 14.1): take `lockVenueDatabase`
  (`packages/db/src/client.ts:98`) first; delete `<state>/backup-room-note.json` through
  `deleteBackupRoomNote` before the file changes, and add the file to `REPLACES` in
  `scripts/backup-room-note.test.ts`, as `apps/server/src/restore.ts:590` does; move the side
  files (`SIDE_FILE_SUFFIXES`) with it and remove Litestream's `.venue.db-litestream/`, as
  `apps/server/src/db-wipe.ts:22-27` and `restore.ts:651` do; never unlink `venue.lock` or
  `migrations.lock` (`db-wipe.ts:9-15`).
- **Migration numbers are indicative**; `drizzle-kit generate` assigns them. A collision on rebase
  is fixed by regeneration (CLAUDE.md §3).
- **New error codes** are declared in their package's `errors.ts` and imported by the throwing
  file (`scripts/errors-reachable.test.ts`), use the `handover.` prefix, and have English and
  Spanish text in `apps/dashboard/src/i18n/codes.ts` and, where a page shows them, the page's own
  strings. A recorded incident code also gets an area claim and alert wording
  (`scripts/alert-codes.test.ts`).
- **Refusals** name what happened and what each choice does, offer an administrator sign-in in
  place where one would let the person carry on, and a safe Stop for destructive choices; never
  send the person to someone else (CLAUDE.md §3; `docs/developers/conventions-ui.md` → "Refusals
  name a self-service next step").
- **Forms** follow `docs/developers/design-system.md` → Forms (`:2589`): required fields marked,
  inline errors, one bottom message, the action disabled only by the form's own checks.
- **Every screen change updates its guide in English and Spanish** under
  `apps/server/src/guide/<language>/`, with shared `{#id}` headings; a new page is added to
  `GUIDE_PAGES` (`apps/server/src/guide-catalogue.ts:6-21`).
- **A sign-in refusal never reveals whether an account exists**: `password.invalid` for every
  credential failure (CLAUDE.md §3).
- **A cold restore is untouched**, with its own source, key, operation and sole-recovery checks,
  and no new demand for proof that the old box stopped. A failed controlled handover never turns
  into an emergency or a restore by itself: only a person's new declaration does, under Task 7.3's
  rule (design §§7, 10).
- **The handover never charges, refunds or settles a payment again.** Open payments and refunds
  keep their provider reference and go through the existing recovery, run by the box that owns
  the collection (decision 12; design §4; A764, `docs/backlog/payments.md:472-480`).
- **Plain English** in comments, commit messages and PR text. Every commit `git commit -s`. A
  Vitest run counts only when its `Tests` line is read; run under `env -u AI_AGENT -u CLAUDECODE`
  to see a passing test's output.
- **Coverage 98/98/98/95** for the new package from its first commit; mutation floor 90
  (`scripts/mutation-break-thresholds.test.mjs`).

---

## Review Focus

1. **A card sale admitted before a stepdown completes and keeps its sale**, while a request that
   arrives after the gate closes is refused `handover.stepping_down`, and the drain, the card sweep
   and AEAT's clock reading start nothing new. Test: Task 2.5, with the real card route and a real
   drain loop.
2. **A stepped-down box that loses power mid-capture** comes back restricted, sells nothing and
   contacts AEAT in no way — including the clock reading from AEAT's host
   (`apps/server/src/clock-watch.ts:281-284`) and the certificate checks
   (`apps/server/src/fiscal-certificate-api.ts:90,150`). Test: Task 2.6.
3. **A main box whose chart lists a half-joined spare at its own address starts normally, and a
   new main box restarted with its old box switched off starts selling.** Tests: Task 3.4's
   regression cases, Tasks 5.10 and 7.6.
4. **A lost reply at each checkpoint** (acceptance, relinquishment, activation) followed by a
   retry or a reboot of either box leaves exactly one filing box and never a second activation.
   Tests: Tasks 5.8 and 7.5.
5. **A copy that differs by one late row** is refused before acceptance, and M1 stays stepped down.
   Test: Task 5.5, with the control.
6. **A returned record that M2 already holds, with different bytes**, opens a case and keeps both
   facts rather than letting the last arrival win; and a returned original never goes to AEAT
   before an earlier record of its chain still waiting in M2's own store. Tests: Tasks 10.6 and 11.4.
7. **A returning M1 whose `node.db` was lost** (backlog A1274: it reads as a sole primary) still
   waits at start, because its chart lists another box that finished joining. Test: Task 3.4.

---

## What exists today (traced on `61bfdfe405`; read, not run, unless a line says so)

| Piece | Where | What it does today |
| --- | --- | --- |
| Promotion | `apps/server/src/promote.ts:227-311` | operator attestation (`:64-68`), module activation in one venue transaction (`:268-287`), chart term n+1 with the old primary `sell-only` (`:258-266`; `packages/membership/src/standings.ts:9-22`), role written to `node.db` after (`:300-303`) |
| Promotion preparation | `packages/fiscal-verifactu/src/hour-recovery-preparation.ts:108-118` | refuses unless the old machine is confirmed offline and not absent, and no parallel recovery runs; the approval it builds always says `oldMachineOffline: true` (`:91`), stored in append-only `fiscal_allocations` |
| Minute waits | `packages/fiscal-verifactu/src/hour-selection.ts:461` | only `setup`, `restore` and `conflict-switch` wait; a promotion takes the next free minute |
| Restart after promotion | `apps/server/src/boot.ts:3079-3092` | SIGTERM to itself; Docker restarts it |
| Trading admission | `apps/server/src/trading-admission.ts:7-33` | one switch per process; a card sale re-checks it after the reader answers (`till-sale.ts:1625,1774,2184`) |
| Fresh sign-in on the dashboard | `apps/server/src/fresh-sign-in.ts:45-90` | password or the person's own passkey, plus authenticator or recovery code when enrolled |
| One-action sign-in by id | `apps/server/src/operation-authentication.ts:91-131` | password and optional code, `node.promote` or `mirror.create`, session ended in the same step |
| `node.promote` | `packages/identity/src/permissions.ts:38,78-85` | administrators only |
| Boot peer check | `apps/server/src/boot.ts:1600-1622`, `membership-reconcile.ts:28-53` | runs only on a non-mirror with a `node_mirror_link` row; an unreachable peer means "proceed" (`:33-34`); the fetch sends no credential (`:60-63`), so `GET /management-api/membership` answers `password.invalid` (`management-api.ts:1044-1083`) — inferred, not run |
| Read-only gate | `apps/server/src/read-only-gate.ts:28-39`, mounted at `boot.ts:1699-1718` | on a mirror or fenced box, refuses every write verb `node.read_only` (403) except `POST /api/box/retire` (fenced only), `/management-api/promote` and `/management-api/promote/preparation`; each exempt route authenticates itself |
| Fence at boot | `boot.ts:1627-1637` | a held chart that fences this box demotes its singleton role and mounts the read-only gate |
| Duties by role | `boot.ts:1690-1691` (`filesRecords`), `:3200-3210` (drain via `singletonPass`), `:505-512` (card sweep, **every role**), `:3304-3306` (tender refunds, non-fenced primary), `:2541-2556` (stream), `:2481` (backups), `:2651` (clock watch) | see Task 2.4's list |
| Shutdown | `boot.ts:3400-3437` (`stopWork`), `:828-843` (order: `stopWork`, listener close, `settleRequests`, store close) | aborts every loop's controller, then awaits each |
| Consistent copy | `packages/store/src/archive.ts:24-34` | `VACUUM INTO` a `.partial` file, then rename |
| Restore placement | `apps/server/src/restore.ts:579-703` | moves the old files aside, puts `node.db` before `venue.db`; `skipSecrets` keeps the box's own identity and `node.db` (`:403-404,417-419`) |
| Rejoin wipe | `apps/server/src/rejoin.ts:39-62`, `rejoin-command.ts:133-139`, `db-wipe.ts:20-28` | refuses unless fenced; deletes the backup-room note, `venue.db`, `node.db` and Litestream's folder |
| Drain | `packages/fiscal-verifactu/src/drain.ts` | files every chain (`:600-743`); per-pass, memory-only chain block (`:252-255`, "open design decision" `:577-579`); one `envio_flujo` row for AEAT's wait and the technical incident (`:416-442`, `:1185-1237`); restart resets every `enviando` row (`:513-521`); duplicate handling compares the record's own stored identity (`:1727-1803`, `:1830-1903`) |
| Whole-chain check | `packages/fiscal-verifactu/src/backup-verification-chain.ts:52-153` (`walk`), exported only inside `verifyBackupFiscalChains` (`:155`) | reads every record of every chain through a `BackupQuery`, recomputing each huella; read-only. (`verify.ts:41` `verifyChain` checks only the last two records and can insert a chain head, `chain.ts:112-130`) |
| Filing cases | `packages/fiscal-verifactu/src/filing-cases.ts:51-70` | one case per record (`filing_cases_registro_uq`) |
| Chain head | `packages/fiscal-verifactu/src/schema/cadenas.ts` | one row per node |
| Activation | `packages/fiscal-verifactu/src/allocation.ts:437-458` | revokes, resets and retires only the activating node's SIF, chain and series |
| Two servers in one test | `apps/server/src/till-reroute-e2e.test.ts:315-392` | primary and seeded mirror up together; mirror promoted and restarted |
| Reports | `packages/reporting/src/daily-close.ts:15-35`, `cash-up.ts:18-40`, `vat-return.ts:29-45` | daily close (frozen, hash-chained), cash-up, VAT return over `sales` only |
| Payments | `packages/payments/src/schema/payments.ts:28-58` | states incl. `attempting`, `initiated`, `accepted_offline`; `node_id` exists, no writer sets it |
| Servers screen | `apps/dashboard/src/screens/servers-screen.ts:23-36` | Remove and Clear only |
| Prototype S2 | `bench/sqlite-failover/src/scenarios/s2_no_double_submit.ts` | recorded FAIL (`docs/research/2026-09-16-sqlite-failover-prototype.md:37`) |

---

## File structure

- **Create `packages/handover/`** (`@waitron/handover`): `package.json` (scripts `test`,
  `test:coverage`, `typecheck`, `lint`, `mutation`, `db:generate`), `tsconfig.json`,
  `vitest.config.ts` (98/98/98/95, `coverage.include: ["src/**"]`), `stryker.config.json`
  (`break: 90`), `drizzle.config.ts` (`migrations.table: "__drizzle_migrations_handover"`),
  `src/envelope.ts`, `src/binding.ts`, `src/states.ts`, `src/indicator.ts`, `src/manifest.ts`,
  `src/declaration.ts`, `src/return-batch.ts`, `src/errors.ts`, `src/index.ts`; from Slice 5,
  `src/schema/*.ts`, `src/classification.ts`, `src/migrations.ts`, `drizzle/`. Wiring as A947 3a's
  Task 4 did for `@waitron/node-db`: `scripts/changed-scope.mjs` (`LIGHT_B_PACKAGES`),
  `.github/workflows/ci.yml` (the light-A filter), `.github/workflows/mutation.yml` (a
  `mutation-handover` job), the root guards' package lists, `pnpm-lock.yaml`.
- **`packages/node-db`**: `src/schema/node-handover.ts`, `src/handover.ts`, a second migration.
- **`packages/module`**: the `handover` seat on `WaitronModule` (`src/module.ts:1686` area).
- **`packages/fiscal`**: the `handover` seat on `FiscalContribution` (`src/contribution.ts:166`).
- **`packages/fiscal-verifactu`**: `src/handover-summary.ts`, `src/handover-chain-check.ts` (Slice 4);
  the relinquished fact (Slice 5a); `src/handover-return.ts` (Slice 10);
  `src/returned-records.ts`, `src/schema/returned-records.ts`, `src/relay-drain.ts` (Slice 11).
- **`packages/payments`**: `src/handover-summary.ts` (Slice 4); collection ownership (Slice 4b).
- **`packages/reporting`**: the returned-invoice line in the VAT return (Slice 12b).
- **`apps/server/src`**: `handover-*.ts` files named per task.
- **`apps/dashboard`**, **`apps/till`**, **`apps/setup`**: named per task.
- **Guides**: new `apps/server/src/guide/en/servers.md` and `apps/server/src/guide/es/servers.md`
  (which also answers backlog A1283).

---
## Slices

Each slice is one pull request, landing `main` green and working on its own, in the order of the
"Waits for" column. Every slice ends with the same final checks (its last task): the focused
suites named in its tasks, `pnpm format:check`, the typecheck of every package it touched, the
fiscal golden and immutability suites unedited (Fiscal boundary), then `/finish-branch` on the
full path.

| # | Slice | Fiscal | Migration | Tasks | Waits for | Gated by |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Docs: the A947 amendment, the Cloud pin and notice, the backlog | no | no | 4 | — | — |
| 1 | The handover records and their formats | no | yes (`node.db`) | 5 | 0 | — |
| 2 | A box that has stepped down stays down | **yes** | no | 11 | 1 | — |
| 3 | A returning box asks before it sells or files | **yes** | no | 9 | 2 | — |
| 4 | The final copy and its indicator | **yes** | no | 8 | 2 | — |
| 4b | Payment collection belongs to one box (A764) | no | no | 4 | 0 | — |
| 5a | The relinquished fact (crosses the module operation contract) | **yes, loud** | no | 6 | 0 | — |
| 5 | Controlled handover, server | **yes** | yes (`venue.db`, new `handover` set) | 14 | 3, 4, 4b, 5a (real boxes: A947 3b) | — |
| 6 | Controlled handover, screens and guide | no | no | 6 | 5 | — |
| 7 | Emergency handover, server | **yes** | yes (`venue.db`, `handover` set) | 7 | 5 (real boxes: A947 3b; continuous copy: 3c) | — |
| 8 | Emergency declaration page and guide | no | no | 4 | 6, 7 | — |
| 9 | The S2 prototype re-run, fiscal-only | no | no | 3 | 0 | — |
| 10 | Return batch: evidence, and the exchange both scenarios use | **yes** | no | 8 | 7, 9 | the owner's reading of S2 (Slice 9) |
| 11 | Return batch: originals M2 never saw | **yes, loud** | yes (fiscal set) | 8 | 10 | — |
| 12a | The reconciliation list, and lines beside the reports | no | no | 7 | 11 | — |
| 12b | Returned invoices in the VAT return | **yes** | no | 2 | 12a | — (Q1 answered (a); pending the tax adviser) |
| 13 | Archive, the wipe gates, and becoming the spare | **yes** | no | 7 | 11 | — |
| 14 | A last copy from a selected backup | **yes** | no | 4 | 7, 8 | — |

---

### Slice 0 — Docs: the A947 amendment, the Cloud pin and notice, the backlog

Docs-only, so it takes CLAUDE.md §6's docs path: branch, `git commit -s`, fast-forward `main`,
push direct. It must land before Slice 1, so that no build slice contradicts an approved design
that still says otherwise, and so that Cloud's lane G knows before any format is built.

#### Task 0.1: A dated A1018 amendment to the A947 design

**Files:** Modify `docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`: a new
block at the top, "A1018, <date>: what the simple handover changes here", and a one-line pointer
under each heading it amends (§6.3, §6.4, §7, §7.1, §7.2, §11). History is not rewritten.

- [ ] **Step 1: Write the block.** It says, each in one or two sentences, with a link to this plan
  and to the [A1018 design](../specs/2026-10-23-a1018-simple-handover-design.md):
  - **§6.3 (what the spare does):** step 1 keeps "stop following, apply, verify, then check the
    person"; step 2's promotion now runs only after the A1018 emergency declaration is recorded in
    the spare's `node.db` (A1018 Slice 7), and the declaration's audit fields are this plan's
    "Emergency declaration"; step 3's "starts filing … the old main box's records that reached it"
    is unchanged and now explicitly sole: the old box never files again. The minute name is the
    next free one, as §6.5 already says for a switch (A1018 Q2, answered (a)).
  - **§6.4 (the hand-over):** replaced by A1018's controlled handover — a durable stepdown that
    survives a reboot, a final copy compared against a signed indicator, M2's durable acceptance,
    M1's relinquishment, then activation, whose approval records "relinquished", not "offline"
    (A1018 Slices 2, 4, 5a, 5). "Waits until its copy holds exactly that change" is replaced by
    the indicator's snapshot digest; a lost answer never lets M1 resume.
  - **§7 item 1:** the boot check asks every other box the chart lists that finished joining, by
    a signed query, and a till hands over a newer chart (A1018 Slice 3); «Seguir sin el equipo de
    reserva» must name the other box, confirm it is switched off and no other recovery runs, and
    is refused when this box's `node.db` holds a handover (A1018 design §4, point 1).
  - **§7.1 (the tail):** fiscal-only. The batch carries tax records, their chain and filing rows,
    `envio_flujo`, every AEAT answer and every unanswered send — never sales, orders, payments,
    cash, stock or printing rows, which stay in the returning box's archive; the "ledger tables
    only" tail of the topology design no longer applies to A947. Kept: full-state batch, frozen
    sender, identical retries, the per-chain pause while a batch applies, a filing case where two
    finished states disagree, the receiver files and the sender files nothing. The S2 re-run (5b)
    is amended to the fiscal-only batch, with a third control: a batch cut back to missing records
    only (A1018 Slice 9). Records M2 never saw are kept in a separate store and filed from there,
    sharing the drain's AEAT wait and chain order (A1018 Slice 11).
  - **§7.2 (becoming the spare):** check 1 is A1018's return receipt, for a controlled handover
    too (its batch holds no records); check 3's archive keeps every non-fiscal row; the archive is
    **not** deleted after 90 days while any reconciliation item or filing case naming one of its
    records is open, and retention otherwise follows A664's policy (A1018 design §5). The manager
    override still reaches check 2 only.
  - **§11:** 4e → A1018 Slices 2, 4, 5a, 5 and 6; 5a → A1018 Slice 3; 5b → A1018 Slice 9; 5c →
    A1018 Slices 10 and 11; 5d → A1018 Slice 13. 4b keeps "stop following" and the in-memory
    passkey challenge, and calls A1018 Slice 7's declaration and activation. A764's collection
    owner, which §6.3 left to the switch slice, is A1018 Slice 4b. 3b, 3c, 4c, 4d and 5e are
    unchanged.
- [ ] **Step 2: Check** `pnpm exec prettier --file-info docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`
  prints `"ignored": true` (docs are not format-checked), and open each relative link path in
  the block with `ls` (no guard reads links in specs).
- [ ] **Step 3: Commit** `git commit -s -m "docs(a947): A1018's simple handover amends the hand-over, the boot check, the tail and the return"`.

#### Task 0.2: Pin the Cloud agreement and mark the formats local-only

**Files:** Modify `docs/superpowers/specs/2026-10-23-a1018-simple-handover-design.md` (a dated
block at the top) and `docs/backlog/replication-cloud.md` → "A1018".

- [ ] **Step 1: Write the pin.** The block quotes the receipt: the signed contract at Cloud
  `08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec` hashes to
  `157556c31753ccf64cc9f8f0a7144f20683325231d212cd344e259b644366d02` (re-run
  `gh api 'repos/waitron-io/waitron-cloud/contents/docs/waitron-integration-contract.md?ref=08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec' --jq .content | base64 -d | shasum -a 256`
  and paste the output); the A1018 section's lines on Cloud `main` are unchanged (run the same
  fetch without `ref`, cut both at `## Handover between local and hosted machines: A1018` up to
  the next `## ` heading, and `diff` them; on 2026-11-02 at Cloud `1aae8f14c0` the first 194
  lines matched and `main` added only a `### A951 routing revision 2 response, 2026-10-23 (D136)`
  subsection after them, about A951). Then: "Formats are local-only, version 1, in the
  [build plan](../plans/2026-11-02-a1018-handover-build.md#formats-local-only-version-1); the
  contract qualifies no wire format (`:1387`). The authentication bridge, the provider-resource
  field, a hosted copy's identity and the binding of Cloud's resource journal wait for joint
  specification with Cloud."
- [ ] **Step 2: Commit** `git commit -s -m "docs(a1018): pin the Cloud agreement; the formats are local-only version 1"`.

#### Task 0.3: Tell Cloud's lane G what is waiting on it

**Files:** None in this repository beyond a line in `docs/backlog/replication-cloud.md` → "A1018"
naming where the notice went. The notice goes to Cloud's lane G through the shared contract's
proposal process (the route the A1018 section took, Cloud PRs #312 and #323), and one line goes in
the campaign's questions file for the watcher.

- [ ] **Step 1: Write the notice.** Four questions, each citing this plan's Formats and the
  contract's own lines (Cloud `docs/waitron-integration-contract.md` at `08a2a0d4`, `:1466-1495`):
  the authentication bridge (binding a Cloud account, venue and operation to the venue's
  `node.promote` holder, with format, expiry, revocation and replay refusal); the provider-resource
  field (the declaration's `provider` is `null` for every local declaration); a hosted M2 that is
  not in M1's chart (backlog A1275); and Cloud's resource journal bound to the same operation id
  and binding fingerprint (`:1488-1490`). It says plainly that Waitron's formats are local-only
  version 1 and that a Cloud placement may need a version 2, and that no local slice waits for an
  answer (design §7: "local-to-local needs no Cloud binding").
- [ ] **Step 2: Commit** the backlog line: `git commit -s -m "docs(a1018): note the questions sent to Cloud's lane G"`.

#### Task 0.4: The backlog

**Files:** Modify `docs/backlog.md` (the A1018 entry) and `docs/backlog/replication-cloud.md`
(A1018 and A947 sections); `docs/backlog/payments.md` (A764's collection-owner sentence points at
this plan's Slice 4b).

- [ ] **Step 1:** Replace "Exact formats, compatible A947 amendments, separate build authority and
  physical runtime qualification remain open" with: formats local-only version 1 and the A947
  amendment written (links), build authority given 2026-11-01, Q1 and Q2 answered (a) on 2026-11-02,
  physical qualification the owner's (this plan's last section). Add one line to the A947 section
  pointing at the amendment.
- [ ] **Step 2: Commit** `git commit -s -m "docs(backlog): A1018 is planned; formats are local-only and the A947 amendment is written"`.

---

### Slice 1 — The handover records and their formats

Not fiscal. Adds `@waitron/handover` and `node.db`'s second migration. Nothing calls it yet.

#### Task 1.1: The `@waitron/handover` package and its signed envelope

**Files:** Create the package (File structure), wired as A947 3a's Task 4 wired
`@waitron/node-db` (its "Repository wiring" list). `src/envelope.ts`, `src/errors.ts`,
`src/index.ts`. Test `packages/handover/src/envelope.test.ts`.

**Interfaces — Produces:**
`signEnvelope<B extends CanonicalValue>(kind: HandoverKind, body: B, signer: { nodeId: string; privateKey: string }): SignedHandoverEnvelope<B>`;
`verifyEnvelope<B>(raw: unknown, kind: HandoverKind, publicKeyOf: (nodeId: string) => string | undefined): { valid: true; body: B; signerNodeId: string } | { valid: false; reason: "malformed" | "wrong_purpose" | "unknown_signer" | "bad_signature" }`;
`envelopeDigest(envelope: SignedHandoverEnvelope<unknown>): string`; `sha256Hex(data: string | Uint8Array): string`.

- [ ] **Step 1: Write the failing tests.** "a signed envelope verifies with the signer's key";
  "an acceptance never verifies as a relinquishment" (`wrong_purpose`); "a body changed after
  signing is refused" (`bad_signature`); "the signer id is signed: the same body re-labelled with
  another node id is refused"; "an unknown signer is refused" (`unknown_signer`); "a non-object, a
  missing field or an extra top-level field is `malformed`"; "the digest is stable under key
  order" (two objects built in different key orders give one digest).
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/envelope.test.ts` — FAIL.
- [ ] **Step 3: Implement** on `canonicalize`, `signBytes`, `verifyBytes` from `@waitron/membership`.
- [ ] **Step 4: Run** it — PASS; then from the root `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/coverage-thresholds.test.ts scripts/mutation-break-thresholds.test.mjs scripts/ci-workflow.test.mjs scripts/english-only.test.ts`
  and `pnpm --filter @waitron/handover mutation` (score 90 or more).
- [ ] **Step 5: Commit** `git commit -s -m "handover: a signed envelope whose purpose and signer are inside the signed bytes"`.

#### Task 1.2: The binding and its fingerprint

**Files:** Create `packages/handover/src/binding.ts`. Test `src/binding.test.ts`.

**Interfaces — Produces:** `HandoverBinding` (Formats); `parseBinding(raw: unknown): HandoverBinding`
(throws `handover.request_invalid` with `{ field }`); `bindingFingerprint(b: HandoverBinding): string`.

- [ ] **Step 1: Write the failing tests.** "a binding round-trips through parse"; "refuses an
  operation id that is not a UUID", "a source equal to the destination", "a term below 1", "a
  scenario outside the two", "an extra field" (each `handover.request_invalid` naming the
  field); "two bindings differing only in the membership digest have different fingerprints".
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/binding.test.ts` — FAIL.
- [ ] **Step 3: Implement.** No location field exists to add.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "handover: the binding that fixes what one operation is about"`.

#### Task 1.3: The order of steps

**Files:** Create `packages/handover/src/states.ts`. Test `src/states.test.ts`.

**Interfaces — Produces:** `HandoverRole = "source" | "destination"`; `HandoverState` (the union of
every state in the Formats table); `nextState(role, scenario, from: HandoverState | null, to: HandoverState): HandoverState`
(throws `handover.step_out_of_order` with `{ from, to }`); `isOpen(state): boolean` (false only for
`return_complete`, `return_abandoned`, `replaced` and `abandoned`); `initialState(role, scenario): HandoverState` (the state a box records when it begins).

- [ ] **Step 1: Write the failing tests.** One `it.each` over every allowed transition in the
  Formats table (passes); one over a set of forbidden ones, including "a controlled destination
  cannot reach `filing_assumed` before `copy_accepted`", "a source cannot relinquish before it
  stepped down", "an emergency destination cannot activate before `emergency_declared`", "only a
  controlled destination at `prepared` or a controlled source at `source_stepped_down` can become
  `replaced`", "only a controlled operation at `prepared` can become `abandoned`", "a source past
  `prepared` can never become `abandoned`", "`return_abandoned` is reachable only by a destination
  at `return_pending`", "no state goes back"; and "`isOpen` is false for exactly the four closed
  states".
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/states.test.ts` — FAIL.
- [ ] **Step 3: Implement** as a table.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "handover: the order of steps for each box and scenario, and when an operation closes"`.

#### Task 1.4: `node.db`'s handover tables

**Files:** Create `packages/node-db/src/schema/node-handover.ts`, `packages/node-db/src/handover.ts`;
modify `packages/node-db/src/schema/index.ts`, `src/classification.ts`, `src/index.ts`,
`scripts/write-path-tables.json` (the three tables → `packages/node-db/src/handover.ts`),
`scripts/schema-constraints.test.ts` (the new check names). Run `pnpm exec drizzle-kit generate`
in `packages/node-db` once. Test `packages/node-db/src/handover.test.ts`.

Tables, using only `packages/db/src/schema/columns.ts` builders:
- `node_handover_operations`: `node_id`, `operation_id` (primary key together), `role`,
  `scenario`, `source_node_id`, `destination_node_id`, `binding` (json), `fingerprint`, `state`,
  `waiting_reason` (nullable), `created_at`, `updated_at`; checks on the three enumerations; a
  unique partial index `node_handover_one_open_uq` on `node_id` where
  `state not in ('return_complete', 'return_abandoned', 'replaced', 'abandoned')`.
- `node_handover_events`: `node_id`, `operation_id` (nullable: a "carry on" decision has none),
  `kind`, `detail` (json), `envelope` (nullable text), `recorded_at`; primary key a new id.
  Insert-only by code: the writer file has no update or delete (no trigger reaches `node.db`,
  A947 3a's Task 2 kept append-only triggers venue-only).
- `node_handover_restriction`: `node_id` (primary key), `operation_id` (nullable for a chart-only
  supersession), `kind` (`handed-over` | `superseded`), `successor_node_id`, `membership_term`,
  `recorded_at`. No delete: it ends with the rejoin wipe (Formats → "Stepdown record").
- Classification: all three `local`, reason "this box's own handover record, in node.db, keyed by
  this box's node id". No foreign key anywhere; `source_node_id`, `destination_node_id` and
  `successor_node_id` name venue rows, and the column comment says nothing establishes them in this
  file.

**Interfaces — Produces:** `beginHandoverOperationTx(tx: NodeTransaction, row): Promise<"created" | "replayed">`
(refuses `handover.operation_conflict` on the same id with another fingerprint, and
`handover.operation_in_progress` with `{ operationId }` when another open operation exists);
`advanceHandoverOperationTx(tx, nodeId, operationId, to: HandoverOperationState, waitingReason: string | null): Promise<void>`;
`readHandoverOperation(node, nodeId, operationId)`, `readOpenHandoverOperation(node, nodeId)`;
`appendHandoverEventTx(tx, row): Promise<void>`; `recordHandoverRestrictionTx(tx, row): Promise<void>`
(a second write with the same values is a no-op; different values refuse
`handover.restriction_conflict`); `readHandoverRestriction(node, nodeId)`. The state order is
checked by the caller with `nextState` (Task 1.3), not here: this package does not depend on
`@waitron/handover`.

- [ ] **Step 1: Write the failing tests** with `useVenueDb` and the node set: "creates the three
  tables in node.db and none in venue.db"; "a second operation while one is open is refused";
  "a closed operation (`return_abandoned`) lets a new one begin"; "the same operation id with
  another fingerprint is refused"; "a replay with the same fingerprint answers `replayed` and
  writes nothing"; "a restriction rewritten with other values is refused"; "an event is never
  updated" (the module exports no update).
- [ ] **Step 2: Run** `pnpm --filter @waitron/node-db exec vitest run src/handover.test.ts` — FAIL.
- [ ] **Step 3: Implement**; generate the migration.
- [ ] **Step 4: Run** it — PASS. From the root: `pnpm exec vitest run scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts scripts/journal-monotonic.test.ts scripts/column-vocabulary.test.ts scripts/write-path-tables.test.ts scripts/id-columns-are-references.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts`;
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`;
  `pnpm --filter @waitron/node-db mutation`.
- [ ] **Step 5: Commit** `git commit -s -m "node-db: each box records its handover progress, decisions and restriction in its own node.db"`.

#### Task 1.5: The server's handover store and signer

**Files:** Create `apps/server/src/handover-store.ts`, `apps/server/src/handover-signing.ts`.
Tests `apps/server/src/handover-store.test.ts`, `handover-signing.test.ts`.

**Interfaces — Produces:**
`beginHandover(deps: { node: NodeDatabase; nodeId: string }, binding: HandoverBinding, role: HandoverRole): Promise<"created" | "replayed">`;
`advanceHandover(deps, operationId, to: HandoverState, detail: CanonicalValue, envelope?: SignedHandoverEnvelope<unknown>): Promise<void>`
(reads the row, checks `nextState`, records the event and the new state in one node transaction;
the same `to` twice is a no-op that returns); `waitHandover(deps, operationId, reason: ErrorCode)`;
`signAsThisBox(deps: { node: NodeDatabase; ring: KeyRing; nodeId: string }, kind, body)` (uses
`readNodeIdentityKey`, `apps/server/src/node-identity.ts:25-43`);
`peerKeyOf(deps: { db: Database; node: NodeDatabase; ring: KeyRing; nodeId: string }): Promise<(nodeId: string) => string | undefined>`
— a key this box trusts (`readStoredTrustSet`, `apps/server/src/membership-trust.ts:35-43`) or one
the held chart's verified endorsements vouch for (`packages/membership/src/endorsement.ts`), and
none for a node a well-formed held chart lists as evicted or revoked, even one this box trusts; the rule is
`endorsedKeyOf` in `@waitron/membership`;
`currentBinding(deps, scenario, sourceNodeId, destinationNodeId, operationId): Promise<HandoverBinding>`
(reads `tenants`, the stamp and the held chart).

- [ ] **Step 1: Write the failing tests.** "an operation advanced out of order is refused and
  records nothing"; "advancing to the same state twice records one event"; "a box signs with its
  own node key and a peer verifies it with the key the chart's endorsement carries"; "a key the
  chart does not vouch for is unknown"; "the binding names the taxpayer and environment, and the
  held chart's term and digest" (and has no location field).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-store.test.ts src/handover-signing.test.ts` — FAIL.
- [ ] **Step 3: Implement.** One-line comment at `advanceHandover`: node.db only, never venue.db.
- [ ] **Step 4: Run** them — PASS; then the final checks for the slice.
- [ ] **Step 5: Commit** `git commit -s -m "server: record handover steps in node.db and sign them with the box's own key"`.

---

### Slice 2 — A box that has stepped down stays down

**FISCAL** (it stops a filing box). The owner lands it. No migration.

#### Task 2.1: The restricted start

**Files:** Modify `apps/server/src/boot.ts` (read `readHandoverRestriction` right after
`finishPromotedRole`, `:1590`, and before any worker; when a row exists, return a restricted
server the way the pending-adoption mode returns early, `:1540-1579`); create
`apps/server/src/restricted-start.ts` (its routes). Test `apps/server/src/boot.restricted.test.ts`.

**Interfaces — Produces:** `startRestricted(deps: RestrictedStartDeps): StartedServer`, serving
only `/health`, `GET /api/node` (always `acceptingSales: false`, and always `nodeId` and the held
chart's `term` — a till needs the term to hand over a newer chart, Task 3.6), the status page
(Task 2.7), and the routes later slices register through
`RestrictedStartDeps.routes: ((app: Hono) => void)[]`.

- [ ] **Step 1: Write the failing tests** (a real `startServer` on a seeded folder with a
  `node_handover_restriction` row): "answers `acceptingSales: false` with its node id and term";
  "refuses a till sign-in" (status 403 or 404, never 200); "mounts no dashboard, till, print or
  device route" (each representative path answers 404); "starts no fiscal pass": a stand-in AEAT
  server records zero requests over two `minTickMs` intervals; control: the same folder without
  the row starts the drain, and the stand-in records a request (the failing case prints a
  non-zero count).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.restricted.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The early return comes before `runFirstStart`, the stream host, the
  backup supervisor and every loop.
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/boot.promote.test.ts src/boot.reconcile.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box with a handover restriction starts with nothing that sells, files or writes"`.

#### Task 2.2: The restricted start touches nothing outside and nothing in venue.db

**Files:** Modify `apps/server/src/boot.ts` and `restricted-start.ts` as the test needs. Test
`apps/server/src/boot.restricted-quiet.test.ts`.

- [ ] **Step 1: Write the failing tests.** Start restricted for 5 seconds of fake time with every
  seam the full start uses: "writes nothing to venue.db" (the file's SHA-256 before and after are
  equal; control: a normal start changes it within the same time, through the sealed-state refresh
  `boot.ts:2532`); "asks AEAT's host for no clock reading" (the clock watch's `readAuthorityTime`
  stand-in is never called; `apps/server/src/clock-watch.ts:281-284`); "runs no card-provider
  sweep" (the sweep stand-in is never called; today it runs in every role, `boot.ts:505-512`);
  "starts no Litestream child" (the stream seam's `spawn` is never called).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.restricted-quiet.test.ts` — FAIL only if Task 2.1 left a worker running; if it PASSES at once, delete the early return locally and confirm each case fails for the reason named, then restore it.
- [ ] **Step 3: Implement** whatever the failing case names.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: prove a restricted box writes nothing and contacts no outside service"`.

#### Task 2.3: The handover gate

**Files:** Create `apps/server/src/handover-gate.ts`; modify `boot.ts` (create one gate per full
start and mount its middleware with `app.use("*", …)` before every other middleware, including
the read-only gate at `:1700`). Test `apps/server/src/handover-gate.test.ts`.

**Interfaces — Produces:**
`createHandoverGate(deps: { notCounted: (c: Context) => boolean }): HandoverGate`, where
`HandoverGate` is `{ middleware: MiddlewareHandler; close(deps: { allowed: (c: Context) => boolean; self: Context }): void; isClosed(): boolean; settled(limitMs: number): Promise<{ remaining: readonly { method: string; path: string }[] }> }`.
- Open: every request passes; each is counted on entry and uncounted in a `finally` after
  `next()`, except where `notCounted` says so — the two event streams (`apps/server/src/live-api.ts:106`,
  `apps/server/src/department-transfer-api.ts:127`).
- `close`: from then on, a request that `allowed` names passes uncounted; any other is refused
  503 `handover.stepping_down` (a code of its own, so no refusal blames the time zone or the read
  path). `self` — the request that closes the gate — is uncounted at once, so the stepdown never
  waits on itself.
- `settled(limitMs)`: resolves when the count reaches zero, or at the limit with the method and
  path of each request still inside.
- The trading admission and the singleton role are not touched (decision 2).

The allowed list for a stepdown, used by Task 2.4: `GET /health`, `GET /api/node`,
`POST /api/node/peer-status` (Slice 3), `GET /api/node/handover/:operationId` (Slice 5).

- [ ] **Step 1: Write the failing tests** (a Hono app with stand-in routes): "counts a request
  while it runs and not after"; "an event stream is not counted"; "after close, a new request is
  refused 503 `handover.stepping_down` and an allowed one passes"; "a request inside before close
  still completes after it"; "the closing request is not waited for"; "settled resolves at zero";
  "settled at the limit names each request still inside" (fake timers).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-gate.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/server exec vitest run src/boot.test.ts` (the gate is mounted and open on every normal start).
- [ ] **Step 5: Commit** `git commit -s -m "server: a gate that closes the door to new requests and counts the ones already inside"`.

#### Task 2.3b: Name the background duties, with today's shutdown order unchanged

A **pure refactor**: no behaviour changes, and the existing boot suites prove it by passing
unedited.

**Today's order**, copied from `apps/server/src/boot.ts:3400-3437` (`stopWork`). First seven
aborts, in this order:

```
controller.abort();
pendingCardController.abort();
cloudController.abort();
invoiceEmailController.abort();
attendanceController.abort();
certificateReminderController?.abort();
tenderRefundController.abort();
```

then ONE `closeAll` list, run strictly in this order, each entry after the one before settles,
carrying on past a failure and throwing the first failure at the end
(`apps/server/src/close-all.ts:5-15`):

```
() => pendingCardLoop,
() => tenderRefundLoop,
() => attendanceLoop,
() => attendanceEmailLoop,
() => certificateReminderLoop,
() => certificateDiagnosis?.stop(),
() => invoiceEmailLoop,
() => cloudWorker,
() => cloudSnapshots,
() => suggestionLoop,
unsubscribeFromChanges,
stopSealingNodeCommits,
// A refresh still running would otherwise run against the closed store and log a failure.
() => sealedState.settled(),
() => menuActivation.stop(),
() => appendOnlyWatch.stop(),
() => freeSpaceWatch.stop(),
() => boxEmails.stop(),
() => liveEvents.close(),
() => tunnelController.abort(),
() => loop,
() => tunnelWorker?.catch(() => {}),
() => backupSupervisor.stop(),
() => demoPrinterLoop?.stop(),
() => clockWatch.stop(),
// Litestream writes venue.db, so its stop is awaited before the store closes.
() => streamHost.stop(),
```

So the waits for the aborted loops sit in their own places in that list — the AEAT sending loop
(`() => loop`) is awaited before `backupSupervisor.stop()`, and `streamHost.stop()` is last.

**Files:** Create `apps/server/src/background-duties.ts`; modify `boot.ts`. The table holds exactly
these two lists, in exactly this order: `aborts: { name, abort(): void }[]` and
`closers: { name, close(): unknown, atStepdown?: true, reason?: string }[]`. A closer that calls a
`stop()` keeps the promise of its first call and returns it on any later call, so a stop called
early (Task 2.4) is awaited in its place, never called twice. `stopWork` becomes: call every
`abort` in order, then `closeAll(closers.map((c) => c.close))` — the same function, so the
carry-on-past-failure rule is kept. `atStepdown` and `reason` are data only in this task. Test
`apps/server/src/background-duties.test.ts`.

- [ ] **Step 1: Write the failing tests.** "the aborts and the closers are in exactly the order
  above" (the test holds the two lists as written here); "`stopWork` runs them in that order" (a
  recorder seam); "a closer that fails does not stop the ones after it, and `stopWork` rejects with
  the first failure"; "a stop called early is awaited in its place and not called again".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/background-duties.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Move each line into the table without changing what it calls; keep
  the two comments beside their entries.
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/boot.promote.test.ts src/boot.mirror.test.ts` — PASS with
  `git diff origin/main -- apps/server/src/boot.test.ts apps/server/src/boot.promote.test.ts apps/server/src/boot.mirror.test.ts`
  printing nothing. Those suites may not notice an order change; the order test above is what
  pins it.
- [ ] **Step 5: Commit** `git commit -s -m "server: name the background duties in a table, keeping today's shutdown order exactly"`.

#### Task 2.4: The stepdown, in order

**Files:** Create `apps/server/src/handover-stepdown.ts`; modify `background-duties.ts` (mark the
entries below `atStepdown` and give the rest a `reason`) and `boot.ts` (wire `stepDown` with the
gate and the restart used after promotion, `:3079-3092`). Test
`apps/server/src/handover-stepdown.test.ts`.

**Interfaces — Consumes:** `beginHandover`, `advanceHandover` (Task 1.5),
`recordHandoverRestrictionTx` (Task 1.4), `HandoverGate` (Task 2.3), `backgroundDuties` (Task
2.3b). **Produces:**
`stepDown(deps: StepDownDeps, request: { binding: HandoverBinding; kind: "handed-over" | "superseded"; self: Context }): Promise<{ restarting: true }>`.
**Inside the request** (before it answers):
1. in ONE node transaction: the operation row at `source_stepped_down` (for `handed-over`) and the
   restriction (successor = destination) — before anything is acknowledged;
2. `gate.close({ allowed: STEPDOWN_ALLOWED, self })` — new requests refused `handover.stepping_down`;
3. **signal**, synchronously and still inside the request, only what takes effect at once:
   all seven aborts, in today's order (the close repeats them harmlessly), and the first call of
   these five closers' stops, marked `atStepdown`: `certificateDiagnosis?.stop()`,
   `menuActivation.stop()`, `boxEmails.stop()`, `demoPrinterLoop?.stop()` and `clockWatch.stop()`.
   Calling a stop early is safe only where its first effect happens before its first `await`. All
   five set a `stopped` flag first: `fiscal-certificate-diagnosis-runner.ts:324-325`,
   `menu-activation.ts:87-88`, `box-alert-email.ts:456-457`, `demo-printer.ts:227-228` and
   `clock-watch.ts:461-462` (all under `apps/server/src/`, read on `61bfdfe405`); the test below
   pins it, so a later change to any of them fails there. After this, no loop starts a new pass (each loop checks its
   signal before a pass, `apps/server/src/loop.ts:54-56`, and its sleep takes the signal, `:84`),
   and a pass already running stops at its next step (Tasks 2.4b, 2.4c). **Backups, Litestream
   and the tunnel are not touched here**: they stop in the close, in today's place — backups after
   the sending loop has finished, Litestream last — so Litestream never stops while the sending
   loop may still be storing an answer;
then `stepDown` resolves, the route sends its answer, and **after the answer** (scheduled with
`setTimeout(…, 0)` as promotion does, `boot.ts:3089-3091`, so the response is written first —
decision 2):
4. `gate.settled(HANDOVER_ADMITTED_WORK_LIMIT_MS)`, logging `handover.admitted_work_cut` with the
   method and path of each request still inside;
5. the normal graceful close, unchanged: `stopWork` exactly as Task 2.3b keeps it (the aborts, then
   the `closeAll` list in today's order, which awaits each aborted loop and each early stop in its
   own place, Litestream last), then the listener, the request settling and the store, as today
   (`boot.ts:828-843`); then SIGTERM.
The closers left without `atStepdown` each carry a one-line `reason`: the loop waits (they only
wait), the change subscription, the sealing of node commits and the sealed-state refresh, the
append-only and free-space watches, the live events, the tunnel (it only carries requests, which
the gate refuses), backups and Litestream (they stop in their place in the close). A closer found
to file, move money, send to an outside service or device other than the backup bucket, or be a
module's writer is marked `atStepdown` instead. Backups and Litestream never are (decision 3).
If anything after step 1 throws — closing the gate, signalling, or any later step — the restart
is still scheduled, in a `finally`, so the box comes back restricted rather than selling with its
gate half closed. `HANDOVER_ADMITTED_WORK_LIMIT_MS = 180_000`. `stepDown` never calls
`tradingAdmission.requireRestart()` and never writes `holders.singletonRole` (decision 2).

- [ ] **Step 1: Write the failing tests** (seams for each duty's stop, counting calls; a real HTTP
  listener for the first case): **"the caller of the stepdown receives its full answer body"**
  (control: run steps 4–5 inside the request, locally, and the body never arrives — the client
  sees its connection closed); "the restriction is on disk before the answer" (read it from a
  second store handle inside the route's answer seam); "every abort and every `atStepdown` stop has
  taken effect when `stepDown` resolves" (each duty seam reports whether it would start new work);
  "backups and Litestream are not stopped before the answer"; "after the answer the close runs in
  Task 2.3b's order, Litestream last"; "each stop runs exactly once across the stepdown and the
  close"; "every closer is either `atStepdown` or carries a reason"; **"no named duty starts a new pass after the restriction is written"** (each
  duty seam records pass starts; one duty's sleep is made to end between the answer and the await:
  control — signal after the answer instead, and that duty records a pass); "a throw while
  signalling still schedules the restart"; "the trading admission still reads `ready` during the
  wait"; "a request still running at the limit is cut and logged by route, and the stepdown
  proceeds" (fake timers); "a second call for the same binding answers `replayed` and does not
  restart twice".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-stepdown.test.ts` — FAIL.
- [ ] **Step 3: Implement.** One-line comment at step 1: the restriction is written before the
  answer, so a lost answer leaves the box stepped down (design §2).
- [ ] **Step 4: Run** it — PASS; then `src/background-duties.test.ts src/boot.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a stepdown records itself, closes the door and signals outside work, answers, then waits and restarts"`.

#### Task 2.4b: A running pass stops before its next AEAT batch

**FISCAL** (it changes the drain). The signal of Task 2.4 stops new passes, not the rest of a
running one: `runLoop` checks it only between passes (`apps/server/src/loop.ts:54-56,80`), and
`runPass` gets none. One pass runs the AEAT drain and then the Stripe reconcile
(`apps/server/src/pass.ts:78-125`), and the drain keeps claiming and submitting a new batch while
records are due (`packages/fiscal-verifactu/src/drain.ts:256`, the submit at `:343`). So a pass
running when the restriction is written could send further batches and start a reconcile, which
design §2 steps 1–2 forbid.

**Files:** `apps/server/src/pass.ts` (`runPass` takes the loop's `signal` and skips the reconcile
once it is aborted); `packages/fiscal-verifactu/src/drain.ts` (an optional `signal` checked before
each claim in the `while (dueCount > 0)` loop, `:256`; a batch already sent is answered and stored
as today; nothing else in the drain changes); the drain's caller in `boot.ts` passes it. **How it
leaves:** after the loop the drain always stores AEAT's next allowed send time, `now + t`
(`upsertFlujo`, `drain.ts:385-386`). So when the signal is seen before this pass sent anything,
the drain **returns** without that write, and AEAT's wait is not moved later for a send that never
happened; when a batch was already sent this pass, it **breaks** out of the loop, so the wait AEAT
set after that send is stored as today. Tests
`packages/fiscal-verifactu/src/drain.signal.test.ts`, `apps/server/src/pass.signal.test.ts`.

- [ ] **Step 1: Write the failing tests.** Drain: "with three batches due, a signal raised while
  the first batch's answer is held sends no second batch, and the first is stored as answered"
  (control: no signal, three batches); **"a signal seen before the first send leaves
  `envio_flujo` unchanged"** (control: `break` instead of `return`, and the stored next send time
  moves later); "a signal seen after a send stores the wait AEAT set"; "no signal: unchanged"
  (`src/drain.test.ts` passes unedited). Pass: "a signal raised during the drain skips the
  reconcile" (control: no signal, the reconcile runs).
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.signal.test.ts src/drain.test.ts` and `pnpm --filter @waitron/server exec vitest run src/pass.signal.test.ts` — FAIL (the new ones).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS, with `git diff origin/main -- packages/fiscal-verifactu/src/drain.test.ts` printing nothing; the golden and immutability suites unedited; typecheck `@waitron/fiscal-verifactu` and `@waitron/server`.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal: a running drain sends no further AEAT batch once told to stop"`.

#### Task 2.4c: A running card sweep or refund recovery stops before its next item

Not fiscal. The same gap as Task 2.4b, for the duties that move money item by item.

**Files:** `packages/payments/src/provider.ts:250` (`resolvePending(now, owners, signal?)`); each
implementation checks the signal before each payment it settles
(`packages/payments-stripe/src/provider.ts:255`, `packages/payments-sumup/src/provider.ts:314`; the
simulator `packages/payments/src/simulator.ts:181`, `packages/payments-stripe/src/device-provider.ts:206`
and the test fake answer zeros and only gain the parameter); the sweep wrapper passes it
(`apps/server/src/boot.ts:520-531`); `apps/server/src/tender-refund-recovery.ts` checks
`deps.signal` before each refund it sends to a provider (`recoverTenderRefunds`, called at `:142`).
Duties that move no money and file nothing (the email loops, the Cloud worker) finish their pass;
the box restarts after. Tests: one case in each adapter's suite and in
`apps/server/src/tender-refund-recovery.test.ts`.

- [ ] Failing tests: each adapter "a signal raised after the first payment settles no second"
  (control: no signal, both settle); refund recovery "a signal stops before the next refund".
  Implement; PASS; typecheck `@waitron/payments`, `@waitron/payments-stripe`,
  `@waitron/payments-sumup`, `@waitron/server`.
  `git commit -s -m "payments: a running card sweep or refund recovery stops before its next item once told to"`.

#### Task 2.5: A card sale in flight survives a stepdown, and nothing new reaches outside

**Files:** Test `apps/server/src/handover-stepdown.real.test.ts` (Review Focus 1).

- [ ] **Step 1: Write the test.** A real `startServer` with a stand-in AEAT that counts requests
  and can hold an answer, a real drain loop with **more than one batch due**, Stripe configured
  with a stand-in that counts reconcile calls, and a card provider whose capture the test holds
  open — the simulator provider (`apps/server/src/boot.ts:500`, `packages/payments/src/simulator.ts`)
  or a stand-in passed through `StartServerSeams`, whichever lets the test hold the capture; the
  test's first comment names which. Start a card sale on the real till route; hold AEAT's answer
  to the first batch; while both are held, call the stepdown; release both. Assert: the sale's
  second transaction commits (a `sales` row exists for the order, and the response is not
  `venue.time_zone_not_ready`); a new till request made after the stepdown began is refused
  `handover.stepping_down`; **AEAT receives no second submission and the reconcile is never
  called** after the restriction's `recorded_at`; the card-sweep stand-in is not called after it;
  the request that asked for the stepdown received its answer.
  **Control:** replace the gate's close with `tradingAdmission.requireRestart()` (locally, not
  committed) and the first assertion fails with `venue.time_zone_not_ready` — write that expected
  failing line in the test's comment before running it.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-stepdown.real.test.ts` — PASS (it pins Tasks 2.3–2.4c); the control fails as written.
- [ ] **Step 3: Commit** `git commit -s -m "server: a card sale admitted before a stepdown keeps its sale, and nothing new reaches AEAT or the provider"`.

#### Task 2.6: Power lost at any point of a stepdown

**Files:** Test `apps/server/src/handover-stepdown.crash.test.ts` (Review Focus 2).

- [ ] **Step 1: Write the tests.** For each crash point after the node transaction — after it
  commits and before the answer, during the admitted-work wait, during close — stop the process's
  store without the graceful close, then `startServer` on the same folder: "comes back restricted,
  `acceptingSales: false`, no AEAT request" (stand-in counts zero); "the operation reads
  `source_stepped_down`". For each crash point before it — before the stepdown begins, as the gate
  closes, during the quiesce (the duties are told to stop before the write) — the box comes back
  as a normal primary that files: `acceptingSales: true`, no restriction, an AEAT submission
  arrives.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-stepdown.crash.test.ts` — PASS (it pins Tasks 2.1–2.4).
- [ ] **Step 3: Commit** `git commit -s -m "server: a stepdown interrupted at any point comes back restricted"`.

#### Task 2.7: The restricted box's own page, and its guide

**Files:** Create `apps/server/src/restricted-page.ts` (server-rendered, English and Spanish, in
the recovery page's style, `apps/server/src/recovery-surface.ts:123-133`); create
`apps/server/src/guide/en/servers.md` and `apps/server/src/guide/es/servers.md` with section
`{#handed-over}`; add `"servers"` to `GUIDE_PAGES` (`apps/server/src/guide-catalogue.ts:6-21`).
Test `apps/server/src/restricted-page.test.ts`.

Words (English; Spanish in the same file): title "This box has handed over", body "It takes no
sales and sends nothing to the tax agency. The venue now runs on {successor}." plus the operation's
progress, one line per recorded step, and a line "It sends its invoice records to {successor} by
itself, then becomes the spare." No action button: nothing here needs a person (a state this box
is meant to be in; CLAUDE.md §3).

- [ ] **Step 1: Write the failing tests.** "shows the successor and each recorded step, in English
  and in Spanish"; "escapes the successor's name"; "carries no form". Then
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the root,
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/restricted-page.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Write the rendered page to a file and open it in the workspace's
  Playwright Chromium in both themes and at 390 px (CLAUDE.md §4: a page asserted as a string has
  nothing checking that it renders).
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a stepped-down box says what it is and where the venue went, in English and Spanish"`.

#### Task 2.8: Final checks for Slice 2

- [ ] Run the slice's focused suites, `pnpm format:check`, `pnpm --filter @waitron/server typecheck`,
  `pnpm --filter @waitron/node-db typecheck`, the fiscal golden and immutability suites with the
  unedited-diff check (Fiscal boundary), and from the root `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/personal-log-params.test.ts`.
  Then `/finish-branch` (full). The PR says FISCAL in its first line.

#### Slice 2 as built (2026-11-03)

The build departed from the task texts above in these ways; the task texts are left as written.

- `createHandoverGate` takes no argument. An open event stream is never counted as admitted work,
  because its handler returns its response at once (measured while building the gate).
- A restricted box's `/health` answers 200 with `{ ok: true, tradingAvailable: false }`, so the
  install and update health checks still pass on a box that has stepped down.
- `stepDown` returns `{ restarting: true, replayed: boolean }`; a replayed call schedules no second
  restart.
- No production route reaches `stepDown` in Slice 2. `boot.ts` exposes it only through a test seam.
  The first production route to reach it is Slice 3's Task 3.3 membership route
  (`POST /api/node/membership`), which steps a box down as `superseded` when a signed, newer chart
  fences it; Slice 5's Task 5.3 adds the signed-in management route (`POST /management-api/handover`)
  that starts a controlled handover.
- The stepdown's close is bounded by the same shutdown deadline a SIGTERM has, so a close that never
  settles still restarts the box.
- The pending-card pass skips its later steps once it has been signalled, and hands the signal to
  its last step: `settlePendingBillPayments` asks the card provider about no further bill refund,
  and `resumeCardRefund` checks the signal just before its provider lookup, leaving that refund
  pending.
- The restricted page's title is "This box no longer runs the venue" for both kinds of restriction
  (handed over and superseded); its body says "The box taking over the venue is {successor}." rather
  than Task 2.7's "The venue now runs on {successor}.", which is false at `source_stepped_down` and
  for a superseded box; and the page carries no closing line about sending records back or
  becoming the spare. Tasks 10.3 and 13.4b add those sentences to the page and to both guides.
- A superseded stepdown records no handover operation; Task 10.3 begins one.
- The page's English and Spanish words are in `apps/server/src/i18n/restricted-page.ts`
  (`RESTRICTED_PAGE_WORDS`, `RESTRICTED_STEP_WORDS`), beside the guide pages' and the recovery
  page's words that A968 moved there, rather than in `apps/server/src/restricted-page.ts`, the file
  Task 2.7 creates. Tasks 10.3 and 13.4b put their sentences' words in that catalogue and the lines
  that show them in `apps/server/src/restricted-page.ts`.
- `stepDown` runs in a different order from Task 2.4's steps 1–3, by the owner's answer (c) on
  PR #2420. It first checks the binding (for a handover) and any stored restriction without writing, refusing with
  nothing stopped. Then it closes the gate, tells the duties to stop, and writes the operation and
  the restriction in one node transaction. Only then does it answer, and the wait, close and restart
  follow as in steps 4–5. A write that fails is the caller's answer, and the box restarts as a
  normal box with no restriction. A second call made while the first call's write is running waits
  for that write (kept in memory, per server). Only a throw at the first check of the first call leaves the
  gate open; every other throw comes after the gate closed and the box restarts, so Task 5.3's route
  tells the two apart before recording `abandoned`.

---

### Slice 3 — A returning box asks before it sells or files

**FISCAL** (A947 5a's place: it decides, before the first filing pass, whether this box may
file). The owner lands it. It changes A947's Ruling C7 for any box whose chart lists another box
that finished joining: an unreachable peer means wait, not proceed (design §4, point 1). Until
A947 3b no such box exists (fact 3), so on today's boxes every start proceeds as it does now.

#### Task 3.1: The signed peer query

**Files:** Create `apps/server/src/peer-status-api.ts`; mount it in the full start, the restricted
start, the pending-adoption start (`boot.ts:1540-1579`) and the waiting start (Task 3.5). Test
`apps/server/src/peer-status-api.test.ts`.

**Interfaces — Produces:** `POST /api/node/peer-status`, body a `query` envelope
`{ nonce: string (16–64 chars), atMs: number, operationId?: string }` signed by the asking box;
answer a `status` envelope signed by this box: `{ heldMembership: SignedMembershipDocument | null, restriction: { kind, successorNodeId, operationId } | null, openOperation: { operationId, role, scenario, state, sourceNodeId, destinationNodeId } | null, requestedOperation: { operationId, role, scenario, state, sourceNodeId, destinationNodeId } | null, nonce }`.
`requestedOperation` is the state of the operation the query names, **open or closed** — so a
peer can see `abandoned` (Task 5.4), which `openOperation` never shows.
Refusals: `handover.peer_unknown` (403) when the signer is not a key `peerKeyOf` knows or is
`evicted` in the held chart; `handover.request_invalid` (400).

- [ ] **Step 1: Write the failing tests.** "a box the chart lists gets a signed status echoing its
  nonce"; "a stranger's key is refused 403 `handover.peer_unknown`"; "an evicted box is refused";
  "the answer verifies with this box's key and fails with any other"; "a query naming a closed
  operation gets its closed state in `requestedOperation`"; "the restricted and the
  pending-adoption starts answer it too".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/peer-status-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The chart is not served to unsigned callers (decision 4).
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: boxes ask each other for the current chart with a signed query"`.

#### Task 3.2: Which write routes a mirror or fenced box lets through, and how each authenticates

**Files:** Create `apps/server/src/read-only-exemptions.ts` (the list as data, and the predicate);
modify `boot.ts:1707-1715` to use it. Test `apps/server/src/read-only-exemptions.test.ts`.

The read-only gate refuses every write verb on a mirror or fenced box (`read-only-gate.ts:32-37`),
and "each exempt route authenticates itself" (`:26`). Exempting a POST is a security decision, so
the full list lives in one file, each with how it authenticates, and later slices add their rows
there:

| Route | Box | How it authenticates | Added by |
| --- | --- | --- | --- |
| `POST /api/box/retire` | fenced | existing (`boot.ts:1709`) | today |
| `POST /management-api/promote`, `/management-api/promote/preparation` | mirror, fenced | existing | today |
| `POST /api/node/peer-status` | mirror, fenced | a `query` envelope signed by a key the held chart vouches for and does not evict; answers only signed status | Slice 3 |
| `POST /api/node/membership` | mirror, fenced | none needed from the caller: the body is a signed chart, accepted only through `acceptMembershipDocument` against the stored trust set; the answer is one boolean | Slice 3 |
| `POST /api/node/handover/offer` | mirror | a `stepdown` envelope signed by the binding's source with a key the chart vouches for, the binding's chart term and digest equal to M2's | Slice 5 |
| `POST /api/node/handover/:operationId/preparation` | mirror | the same sign-in as `prepare` (`apps/server/src/node-operation-preparation.ts:227-241`, `node.promote`); the operation must be at `filing_assumed` or `emergency_declared`; its context comes from the operation's own record, never the body | Slice 5 (Task 5.7b) |
| `POST /api/node/handover/:operationId/activate` | mirror | email, password and code when enrolled, against the placed copy; `node.promote`; the operation's recorded state | Slice 5 |
| `POST /api/node/handover/emergency/declare` | mirror | email, password and code when enrolled; `node.promote` | Slice 7 |

GET routes need no exemption. M2's return routes run after activation, when M2 is no longer a
mirror; M1's run on the restricted start, which mounts no read-only gate.

- [ ] **Step 1: Write the failing tests.** "the exempt set is exactly this list" (so a new
  exemption is a deliberate edit); per row, on a real mirror start, "the route is reached and
  refuses an unauthenticated call with its own code, not `node.read_only`"; control: "an
  unlisted write route on the same mirror answers 403 `node.read_only`". Rows for Slices 5 and 7
  are added by those slices.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/read-only-exemptions.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Move today's three exemptions into the list unchanged.
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/server exec vitest run src/boot.mirror.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: one list of the write routes a read-only box lets through, each with how it authenticates"`.

#### Task 3.3: A newer chart handed to a box

**Files:** Create `apps/server/src/node-membership-api.ts` (`POST /api/node/membership`, body
`{ document }`); mounted in all four starts. Test `apps/server/src/node-membership-api.test.ts`.

**Interfaces — Produces:** the route verifies with `acceptMembershipDocument` against the stored
trust set and the held chart (as boot does, `boot.ts:1616-1619`), persists it when strictly newer
(`persistNodeMembershipIfNewer`), and — when it fences this box (`isFencedStanding`,
`packages/membership/src/fence.ts:20-24`) and this box is not already restricted — on the full
start runs `stepDown` with `kind: "superseded"` and `successorNodeId: servingPrimaryNodeId(doc)`
(Task 2.4: the same gate, quiesce and bounded wait, design §4 point 2, with the answer sent before
the quiesce), and on the waiting start writes the restriction and restarts after answering. Answers `{ accepted: boolean }`; a refused chart is 200
`{ accepted: false }` (the caller learns nothing it did not send).

- [ ] **Step 1: Write the failing tests.** "a newer chart that fences a selling box closes its
  gate, stops its outside work, restricts it and restarts" (the stepdown seam called once with
  `superseded`); "a newer chart that does not fence it is held, and the box keeps selling"; "an
  older or equal chart changes nothing"; "a chart signed by an unknown key changes nothing"; "a
  restricted box stays restricted when handed an older chart"; "on a mirror the route is reached
  through the read-only gate" (Task 3.2's row).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/node-membership-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box handed a newer chart that fences it steps down before it sells again"`.

#### Task 3.4: The check at start

**Files:** Create `apps/server/src/boot-peer-check.ts`; modify `boot.ts` (call it after
`finishPromotedRole` and the restriction read, before the held-membership read at `:1627`; the
existing `reconcileMembershipOnBoot` call stays for a box with a `node_mirror_link` and no counted
peer). Test `apps/server/src/boot-peer-check.test.ts` (Review Focus 3 and 7).

**Interfaces — Produces:**
`checkPeersAtStart(deps: { held: SignedMembershipDocument | null; nodeId: string; ownOrigin: string; joined: (nodeId: string) => Promise<boolean>; activatedFrom: ReadonlySet<string>; ask: (peer: RoutableServer) => Promise<PeerStatus | null>; accept: (doc) => Promise<AcceptResult>; openOperation: boolean; timeoutMs: number }): Promise<"proceed" | "superseded" | "wait">`.
`joined` reads whether this box's `venue.db` holds a `nodes` row with that id (decision 5).
`activatedFrom` is the source node of every operation in this
box's `node.db` where this box is the destination and reached `activated`, open or closed.
**Two kinds of peer.** A **counted peer** is another box with a routable standing in the held
chart for which `joined` is true and which is not in `activatedFrom`. An **asked-only peer** is a
routable box in `activatedFrom`: a box this one took over from. Both are asked; only counted peers
can make this box wait.

**Four kinds of answer**, each asked with a timeout of `timeoutMs` (default 5 s):
- **F — newer and fencing:** a verified chart newer than the held one in which this box is
  `sell-only` or `evicted` (`isFencedStanding`, `packages/membership/src/fence.ts:20-24`), **or** a
  status whose `openOperation` has this box as `sourceNodeId` **and** is past the point where this
  box could still be selling safely: an emergency operation at `emergency_declared` or later, or a
  controlled one at `copy_accepted` or later. A controlled operation still at `prepared` is **not**
  F: its source may not have stepped down, and it closes as `abandoned` once the source reports
  that (Task 5.4) — counting it would restrict an M1 that only restarted before its stepdown, for
  good, while M2 closed its side;
- **N — newer, not fencing:** a verified chart newer than the held one in which this box still
  serves. It is persisted (`persistNodeMembershipIfNewer`, as Task 3.3 does) before the result,
  so the box starts with it;
- **= — nothing newer:** a valid signed status whose chart is the same or older;
- **S — silent:** no answer in time, an address equal to `ownOrigin` or empty, an invalid
  signature, or a chart signed by a key this box does not trust.

**The decision, as one table** — what each answer contributes:

| Answer | from a counted peer | from an asked-only peer |
| --- | --- | --- |
| F | `superseded` | `superseded` |
| N | the chart is held; counts as an answer | the chart is held; nothing else |
| = | counts as an answer | nothing |
| S | no answer | nothing |

**And how the contributions combine**, in this order:
1. any F from any peer → `superseded` (the caller writes the restriction and starts restricted);
2. else, an open operation in which this box is the source → `wait` (it never reaches here in
   practice: see the repairs below);
3. else, no counted peer at all → `proceed`;
4. else, at least one counted peer counts as an answer (N or =) → `proceed`;
5. else (every counted peer S) → `wait`.

So an M2 whose only peer is the M1 it took over from proceeds whether M1 is silent or answers
with an older chart (rule 3), and stops only if M1 brings a newer chart that fences it (rule 1) —
which needs a person to have promoted a cold-restored M1, since a restore writes a new term but
keeps every other box's standing (`apps/server/src/rebuild-first-start.ts:121-139`).
`openOperation` — an open operation in which this box is the **source** — never returns
`proceed`. A destination's operation never blocks a start: a destination before activation is a
read-only mirror that files nothing, and **the check runs only on a box whose mode is not
`mirror`**, as today's peer reconcile does (`apps/server/src/boot.ts:1600`). Two repairs run
first, so that no restart leaves a half-recorded step behind:
- a **source** operation still at `prepared` (a restart between Task 5.3's `prepared` and the
  stepdown's node transaction) is moved to `abandoned` with an event: the box never stepped down,
  so no copy of it can have been accepted (Formats → progress states). A source operation past
  `prepared` cannot reach the check, because its restriction sends the start to the restricted
  start first (Task 2.1);
- a **destination** operation at `filing_assumed` or `emergency_declared` on a box that is no
  longer a mirror, with a `handover_activations` row for it in `venue.db` — a restart between the
  activation's `venue.db` commit and its `node.db` record, which `finishPromotedRole` turns into a
  primary at this same start (`apps/server/src/promoted-role.ts:39-62`, called at `boot.ts:1590`) —
  is finished by Task 5.8b, which records `activated`. Its source then joins `activatedFrom`.
Slice 3 lands before `handover_activations` exists, so Task 3.4 provides the repair hook and Task
5.8b fills it.

- [ ] **Step 1: Write the failing tests** (pure, stand-in `ask` and `joined`): one per rule above;
  **"a main box whose chart lists a pending spare at the same address, with no `nodes` row for
  it, proceeds and asks nobody"** (the review's regression case: today's adoption puts that spare
  in the chart, `mirror-bundle-api.ts:207`); control for it: "the same chart with a `nodes` row
  for the spare and no answer waits"; "a peer that answers with a chart signed by an unknown key
  counts as no answer"; "a stale chart from a till does not clear a wait" (only a peer answer or a
  person does, design §4); "a box with no `node.db` row but a chart that lists a joined spare
  waits" (backlog A1274); **"a box that activated as destination does not count the operation's
  source, and proceeds with that source switched off"** (the review's round-2 case: M2's copy
  holds M1's `nodes` row and its chart lists M1 `sell-only`), with its control "the same chart and
  rows without the activated operation waits"; "a destination whose operation is `activated` and
  still `return_pending` proceeds"; "a source operation left at `prepared` is moved to
  `abandoned`, and the box proceeds once its counted peer answers =" (rule 4; with that peer
  silent it waits, rule 5); **"a peer whose controlled operation naming this box as source is
  still at `prepared` is not F: the box proceeds"** (round 6's case; control: the same peer at
  `copy_accepted` gives `superseded`); "a peer at `emergency_declared` naming this box as source
  is F"; "a mirror runs no check"; **"a box in `activatedFrom` is
  asked: if it answers with a newer chart that fences this box, the result is `superseded`"**
  (round 4's outside case: an old box's id can come back by a cold restore, which brings back its
  `trading.env`, `apps/server/src/state-secrets.ts:16-23`); "a box in `activatedFrom` that does
  not answer, with no counted peer, leaves the result `proceed`" (rule 3); and one case per cell
  of the decision table: counted F, N, =, S and asked-only F, N, =, S, each alone, plus "counted S
  with asked-only = waits" (rule 5) and "counted = with asked-only F is superseded" (rule 1). Each
  N case also asserts the newer chart is held after the check.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot-peer-check.test.ts` — FAIL.
- [ ] **Step 3: Implement**, and wire it in `boot.ts`; `superseded` writes the restriction and
  takes the restricted start (Task 2.1); `wait` takes the waiting start (Task 3.5). Add a boot
  test in the same file on a real `startServer`: a seeded main box whose chart lists an adopted,
  unfinished spare starts selling (`acceptingSales: true`).
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/boot.reconcile.test.ts src/boot.mirror.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box whose chart lists a joined box asks it before selling or filing"`.

#### Task 3.5: The waiting start and "Carry on as the main box"

**Files:** Create `apps/server/src/waiting-start.ts`, `apps/server/src/waiting-page.ts`
(server-rendered, English and Spanish); modify `boot.ts`. Test `apps/server/src/waiting-start.test.ts`.

The waiting start serves `/health`, `GET /api/node` (`acceptingSales: false`, with `nodeId` and
`term`), the peer routes (Tasks 3.1, 3.3), and its page; it asks the peers again every 15 seconds
and restarts when the answer is `proceed` or `superseded`.

The page: title "This box is waiting for {other box}", body "It will not take sales or send
anything to the tax agency until it knows whether {other box} has taken over. It checks again
every 15 seconds." and one form, **Carry on as the main box**: email, password, authenticator code
(asked after `totp.required`, as the dashboard does), the other box named in the statement
"{other box} is switched off", and "No other recovery of this venue is in progress"; both
required. Pressing it signs the person in by email (`password.invalid` for every credential
failure), requires `node.promote`, records a `node_handover_events` row
`{ kind: "carried_on_without_peer", detail: { personId, peerNodeIds, chartTerm } }`, and restarts
into a normal start **for this start only** (decision 10). Refusal when this box holds a
restriction, or an open operation in which it is the source (the same rule as Task 3.4): `handover.known_handover` — "This box has already handed over
to {successor}. It cannot carry on as the main box." with no choice but the status page link
(design §4: it cannot undo a known handover).

- [ ] **Step 1: Write the failing tests.** "waits, answering `acceptingSales: false` with its
  term"; "restarts when a peer answers"; "carry on with a correct sign-in and both statements
  restarts normally and records the decision"; "a person without `node.promote` is refused with
  the role sentence"; "a wrong password answers `password.invalid`"; "either statement unticked
  keeps the action disabled"; "a box with a restriction refuses `handover.known_handover`"; "the
  next start asks the peers again".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/waiting-start.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Render the page to a file and open it in Chromium, both themes, 390 px.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box that cannot reach its peer waits, and a person may carry on only by naming it"`.

#### Task 3.6: A till hands its newer chart to a box it reaches

**Files:** Modify `apps/server/src/till-api.ts` (`GET /api/till`, `:1525`, adds `membership`: the
held signed chart); `apps/till/src/api/server-router.ts` (keep the newest chart it has been given;
when a probe of a server answers a `term` lower than the held chart's, **or answers no `term` at
all**, POST the chart to that server's `/api/node/membership` once per server and held term).
Tests `apps/till/src/api/server-router.test.ts`, `apps/server/src/till-api.test.ts`.

Why the missing term counts: `GET /api/node` answers only `{ acceptingSales: false }` when the
trading admission is not ready (`apps/server/src/node-api.ts:45-47`), so a box in that state gives
the till no term to compare.

- [ ] **Step 1: Write the failing tests.** Router: "posts the held chart to a server answering a
  lower term, once"; "posts it to a server answering no term, once"; "posts nothing to a server at
  the same or a higher term"; "keeps the newest of two charts it was given". Server: "the start
  read carries the held chart". Control for the router: with the POST removed, the first case
  fails with zero calls.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/api/server-router.test.ts` and `pnpm --filter @waitron/server exec vitest run src/till-api.test.ts -t "membership"` — FAIL.
- [ ] **Step 3: Implement.** The till never changes its own routing because of this post.
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "till: hand a newer chart to a box that holds an older one or does not say"`.

#### Task 3.7: Suites that start a box with a joined peer — first half

**Files:** The suites printed by `git grep -ln 'serving-secondary\|mirrorEnv' -- 'apps/server/src/*.test.ts'`
(19 files on `61bfdfe405`), first ten in that command's order. Each one that starts a non-mirror box
whose chart lists another box **with a `nodes` row** either starts the peer first, or passes the
test seam `peerCheck: () => "proceed"` the task adds to `StartServerSeams` (`boot.ts:851`) with a
comment naming why. Expect several to need it: a peer counts when the chart lists it at a
routable standing **and** a `nodes` row exists for it, and shared seeds write rows for both boxes
(for example `seedVenueWithNodesAndTill`, `apps/server/src/till-reroute-e2e.test.ts:154`).

- [ ] **Step 1:** Run those ten files directly (`pnpm --filter @waitron/server exec vitest run <files>`),
  not the package's whole coverage run; fix each that now waits, never by loosening the check.
  Record each in the PR's "Changed test checks" table: file, test, what changed, why.
- [ ] **Step 2:** Run them — PASS.
- [ ] **Step 3: Commit** `git commit -s -m "server: suites with joined peers start the peer or say why they skip the start check (1 of 2)"`.

#### Task 3.8: Suites that start a box with a joined peer — second half, and the guide

**Files:** The remaining nine files from Task 3.7's command; guide section
`{#waiting-for-the-other-box}` in both `servers.md` files.

- [ ] **Step 1:** As Task 3.7 for these nine.
- [ ] **Step 2:** Run them — PASS; then `src/guide-content.test.ts` and, from the root,
  `scripts/guide-links.test.ts`.
- [ ] **Step 3: Commit** `git commit -s -m "server: suites with joined peers (2 of 2), and the guide for a waiting box"`.

#### Task 3.9: Final checks for Slice 3

- [ ] As Task 2.8, plus `pnpm --filter @waitron/till typecheck` and
  `pnpm --filter @waitron/till exec vitest run src/api`. CI runs the server package's full
  coverage. PR first line: FISCAL, and "changes Ruling C7 for a box with a joined peer; no box
  has one before A947 3b".

---

### Slice 4 — The final copy and its indicator

**FISCAL** (new read-only code in `packages/fiscal-verifactu`). The owner lands it. Everything
here runs only in the restricted start or on a copy.

#### Task 4.1: The module seat for handover summaries and checks

**Files:** Modify `packages/module/src/module.ts` (`WaitronModule.handover?: ModuleHandoverContribution`,
beside `fiscal`, `:1686`); create `packages/module/src/handover.ts`. Test
`packages/module/src/handover.test.ts`.

**Interfaces — Produces:**
`interface ModuleHandoverContribution { summarise(tx: Transaction): Promise<CanonicalValue>; checkCopy?(query: BackupQuery): Promise<"ok" | "broken"> }`;
`collectHandoverSummaries(modules: readonly WaitronModule[], tx: Transaction): Promise<Record<string, CanonicalValue>>`
(keyed by module name, enabled modules only, in name order);
`checkHandoverCopy(modules, query): Promise<{ ok: true } | { ok: false; module: string }>`.

- [ ] **Step 1: Write the failing tests.** "collects each enabled module's summary under its
  name"; "skips a module without the seat"; "a module that throws fails the whole collection with
  `handover.summary_failed` naming it"; "a copy check that answers `broken` names its module".
- [ ] **Step 2: Run** `pnpm --filter @waitron/module exec vitest run src/handover.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts` and, from the root, `scripts/module-seams.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "module: a seat for what each module must vouch for, and check, in a handover"`.

#### Task 4.2: The Veri*Factu chain summary

**Files:** Create `packages/fiscal-verifactu/src/handover-summary.ts`; register it on the
module's descriptor. Test `packages/fiscal-verifactu/src/handover-summary.test.ts`.

**Interfaces — Produces:** `summariseChains(tx: Transaction): Promise<ChainSummary[]>`, one entry
per (`node_id`, `sif_id`) pair that has a record, ordered by those two:
`{ nodeId, sifId, idSistemaInformatico, numeroInstalacion, count, headRegistroId, headHuella, envios: Record<EnvioState, number>, acksSha256, enviandoIds: string[] }`.
Read-only: `select` statements only; no `readChainHead` (it inserts, `chain.ts:112-130`).

- [ ] **Step 1: Write the failing tests** with `useVenueDb` and the package's record fixtures:
  "two chains on two nodes are summarised apart, head by `secuencia` not invoice number"; "a
  chain whose SIF was revoked and replaced is two entries"; "counts every envio state"; "adding one
  record changes count, head and huella" (control); "writes nothing" (the file digest before and
  after are equal).
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/handover-summary.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: summarise each chain for a handover, reading only"`.

#### Task 4.3: The Veri*Factu whole-chain check of a copy

**Files:** Create `packages/fiscal-verifactu/src/handover-chain-check.ts`; modify
`backup-verification-chain.ts` only to export its `walk` (`:52`) under a plain name, with
`verifyBackupFiscalChains` unchanged; register `checkCopy` on the module's descriptor. Test
`packages/fiscal-verifactu/src/handover-chain-check.test.ts`.

Why this and not `verifyChain`: `verifyChain` reads only the last two records of one node and can
insert a chain head (`verify.ts:41-60`, `chain.ts:112-130`); `walk` reads every record of every
chain through a read-only `BackupQuery`, recomputing each huella with `verifyHuella` and checking
each link (`backup-verification-chain.ts:13-153`), which is design §4's "check integrity and
fiscal chains".

**Interfaces — Produces:** `checkFiscalChains(query: BackupQuery): Promise<"ok" | "broken">`.

- [ ] **Step 1: Write the failing tests.** "an intact copy of two chains is `ok`"; "one record's
  `importe_total` changed in the copy is `broken`" (control in the other direction: the unchanged
  copy is `ok`); "one record removed from the middle of a chain is `broken`"; "reads only" (the
  copy's digest before and after are equal); `backup-verification-chain.test.ts` passes unedited.
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/handover-chain-check.test.ts src/backup-verification-chain.test.ts` — FAIL (the first).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then the golden and immutability suites.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: check every record of every chain in a copy, reading only"`.

#### Task 4.4: The payments summary

**Files:** Create `packages/payments/src/handover-summary.ts`; register it on the payments
module's descriptor (`packages/composition/src/modules.ts:262`). Test
`packages/payments/src/handover-summary.test.ts`.

**Interfaces — Produces:** `summariseOpenPayments(tx): Promise<{ payments: { paymentId: string; provider: string; reference: string | null; state: "attempting" | "initiated" | "accepted_offline" }[]; refunds: { refundId: string; provider: string | null; providerPaymentRef: string | null }[] }>`,
each ordered by id. `refunds` are `tender_refunds` rows in state `pending`
(`packages/db/src/schema/tender-refunds.ts:23,88-98`).

- [ ] **Step 1: Write the failing tests.** "lists every payment in `attempting`, `initiated` and
  `accepted_offline` with its provider reference"; "lists no payment in another state"; "lists
  every pending card refund and no completed or failed one"; "writes nothing".
- [ ] **Step 2: Run** `pnpm --filter @waitron/payments exec vitest run src/handover-summary.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "payments: list every payment and refund whose outcome is still open, for a handover"`.

#### Task 4.5: The node-local manifest, as data

**Files:** Create `packages/handover/src/manifest.ts` (the table under "The node-local manifest"
as data). Test `packages/handover/src/manifest.test.ts`, and a root guard
`scripts/handover-manifest-complete.test.ts` (it reads every module's classification, so it
belongs in the root project, CLAUDE.md §4).

**Interfaces — Produces:** `NODE_LOCAL_MANIFEST: readonly { item: string; where: "node.db" | "venue.db" | "state"; class: "transferred" | "source-only" | "destination-owned" | "rebuildable"; treatment: string }[]`.

- [ ] **Step 1: Write the failing tests.** Root guard: "every table classified `local` in any
  migration set the composition lists, and every `node.db` table in `NODE_CLASSIFICATION`, appears
  in the manifest" (so a new `local` table cannot be forgotten); "every name in `RECOVERY_FILES`
  and `OPTIONAL_BACKUP_STATE` appears"; "every module's `backup.nonDbState` source appears"
  (`apps/server/src/backup-sources.ts:50-62`; today only `FISCAL_HOUR_BACKUP_STATE`,
  `packages/composition/src/modules.ts:327`). Package: "no item is listed twice". Then a probe
  test in `apps/server/src/handover-minute-history.test.ts`: on a seeded copy of a box that used
  two minute names, a mirror seeded from it and activated takes a name later than both **without**
  the source's `module-preparation-state.json`; its result decides the manifest's row for that
  file, as the manifest table says.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/handover-manifest-complete.test.ts`, `pnpm --filter @waitron/handover exec vitest run src/manifest.test.ts` and `pnpm --filter @waitron/server exec vitest run src/handover-minute-history.test.ts` — FAIL.
- [ ] **Step 3: Implement.** If the probe shows the copy alone is not enough, the manifest row
  says "transferred, as the retained `module-evidence` file", and Task 5.7 places it as the
  restore path does; record the probe's result in the PR.
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "handover: name every piece of a box's own state, wherever it lives, and what the new box does with it"`.

#### Task 4.6: The manifest's digests

**Files:** Create `apps/server/src/handover-manifest.ts`. Test `apps/server/src/handover-manifest.test.ts`.

**Interfaces — Produces:** `buildNodeLocalManifest(stateDir: string, ring: KeyRing): Promise<NodeLocalItem[]>`,
where `NodeLocalItem` adds `sha256` for `backup.env` and `modules.json` (absent file: `null`) and
`ringVersions: number[]` for `secrets.env`; never a secret's bytes.

- [ ] **Step 1: Write the failing tests.** "the manifest carries no secret": no value equals the
  ring's key bytes; "a missing `backup.env` reads `sha256: null`"; "a changed `modules.json`
  changes its digest".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-manifest.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: digest the state a box compares in a handover, never a secret"`.

#### Task 4.7: Capture the final copy and sign the indicator

**Files:** Create `packages/handover/src/indicator.ts` (the type and `assembleIndicator`) and
`apps/server/src/handover-capture.ts`. Tests `packages/handover/src/indicator.test.ts`,
`apps/server/src/handover-capture.test.ts`.

**Interfaces — Produces:**
`captureFinalCopy(deps: { store; stateDir; ring; node; nodeId; modules }, binding): Promise<SignedHandoverEnvelope<FinalStateIndicator>>`:
refuses `handover.not_stepped_down` unless this box holds the restriction for this operation;
`archiveTo` into `<state>/handover/<operationId>/venue.db`; SHA-256 and size of that file; schema
versions and journal hashes per set; the module summaries read **from the captured file**, opened
read-only, so they describe the same bytes; the manifest; signed; stored as a
`node_handover_events` row `{ kind: "final_state" }`. A second call returns the stored indicator
without capturing again.

- [ ] **Step 1: Write the failing tests.** "the indicator's digest is the SHA-256 of the file it
  names"; "the summaries are read from the captured file" (a row written to the live file after
  capture — through a test-only handle — does not appear); "a second call returns the same
  envelope byte for byte"; "a crash between the copy and the event: the next call captures again
  and records one event"; "refused on a box that has not stepped down"; "verifies with this box's
  key".
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/indicator.test.ts` and `pnpm --filter @waitron/server exec vitest run src/handover-capture.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a stepped-down box captures its final copy once and signs what it holds"`.

#### Task 4.8: Serve the final copy to the selected box only, and final checks

**Files:** Create `apps/server/src/handover-source-api.ts`, registered in the restricted start.
Test `apps/server/src/handover-source-api.test.ts`.

**Interfaces — Produces:** `POST /api/node/handover/:operationId/indicator` and
`POST /api/node/handover/:operationId/final-copy` (streams the file), each authorised by a `query`
envelope signed by the binding's destination; any other signer is refused
`handover.peer_unknown` (403); an unknown operation `handover.operation_unknown` (404).

- [ ] **Step 1: Write the failing tests.** "the destination gets the indicator and the copy, and
  the copy's digest matches"; "another listed box is refused"; "an unknown operation is 404".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-source-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then the final checks as Task 2.8, plus the typechecks of
  `@waitron/module`, `@waitron/fiscal-verifactu`, `@waitron/payments`, `@waitron/handover`. PR first
  line: FISCAL (read-only code in the fiscal package).
- [ ] **Step 5: Commit** `git commit -s -m "server: only the selected box may fetch the final copy and its indicator"`.

---

### Slice 4b — Payment collection belongs to one box (A764)

Not fiscal; on the full review path (concurrency, payments). No migration: `payments.node_id`
already exists (`packages/payments/src/schema/payments.ts:57-58`). It answers the A764 condition
"Before enabling a second venue node, restrict provider cancellation to its collection owner"
(`docs/backlog/payments.md:476-479`), which A1018 design §4 makes a build dependency ("A764's
payment ownership remains a build qualification dependency, including background workers as well
as till requests"). Lands before Slice 5.

#### Task 4b.1: Every payment row names the box that started it

**Files:** Every writer of `payments` (list them with
`git grep -n "insert(payments)" -- 'packages/**/*.ts' 'apps/**/*.ts'`, test files aside) sets
`node_id` to the writing box's node id. Test `packages/payments/src/collection-owner.test.ts`.

The column has a foreign key to `nodes` (`payments_node_fk`, `packages/payments/src/schema/payments.ts:106-110`),
so once it is written every test that writes a payment needs a `nodes` row for that id. Expect
fixture growth: list the payment-writing test helpers first (`git grep -ln "insert(payments)\|recordAttempt\|collect(" -- 'packages/payments*/src' 'apps/server/src'`
is a starting point, not a complete list) and give each a seeded `nodes` row, rather than leaving
the column null in tests.

- [ ] **Step 1: Write the failing tests.** One case per writer found: "a payment written by this
  path carries this box's node id". The test file's first comment pastes the grep's output, so a
  new writer is visible in review.
- [ ] **Step 2: Run** `pnpm --filter @waitron/payments exec vitest run src/collection-owner.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Update the column's comment: it is now the collection owner.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "payments: each payment records the box that started it"`.

#### Task 4b.2: The card sweep acts only on payments its own box owns

**Files:** The sweep's read is inside each adapter, which calls `listAttempting(tx, provider)`
(`packages/payments/src/store.ts:507`) with only a provider name
(`packages/payments-stripe/src/provider.ts:256`, `packages/payments-sumup/src/provider.ts:315`;
the simulator answers zeros, `packages/payments/src/simulator.ts:181-184`). So the owner filter is
threaded through: `PaymentProvider.resolvePending(now, owners: CollectionOwners)` (Task 2.4c's `signal?` goes after it)
(`packages/payments/src/provider.ts:250`), each adapter passes `owners` to
`listAttempting(tx, provider, owners)`, and `withPendingSweep` (`apps/server/src/boot.ts:505-512`)
supplies it. `resolvePending` then sees only rows owned by this box: `node_id` equals this box's id, or `node_id` is one of the boxes this box
has taken over from (an empty set until Slice 5's Task 5.9 supplies it), or `node_id` is null and
this box is the singleton primary. Test `packages/payments/src/collection-owner.sweep.test.ts`.

- [ ] **Step 1: Write the failing tests.** "a sweep on box B leaves box A's `attempting` payment
  alone" (the provider stand-in records no call for it); "it sweeps its own"; "a null owner is
  swept by the primary only"; control: with the filter removed, the first case records a call.
- [ ] **Step 2: Run** `pnpm --filter @waitron/payments exec vitest run src/collection-owner.sweep.test.ts`, and the adapters' own suites (`pnpm --filter @waitron/payments-stripe exec vitest run`, `pnpm --filter @waitron/payments-sumup exec vitest run`) — FAIL (the first).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/server exec vitest run src/boot-pending-sweep.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "payments: a box resolves only the card payments it owns"`.

#### Task 4b.3: The backlog

**Files:** `docs/backlog/payments.md` (A764's "Collection ownership is process-local …" sentence
says what now holds and what stays open: coordination between two boxes collecting at the same
time is not built; one collection owner per payment is).

- [ ] Edit; `git commit -s -m "docs(backlog): A764's collection owner is built; coordination between boxes is not"`.

#### Task 4b.4: Final checks for Slice 4b

- [ ] As Task 2.8, with the typechecks of `@waitron/payments`, `@waitron/payments-stripe` and
  `@waitron/payments-sumup`. PR first line: "payments: one collection owner per payment (A764),
  before a second box; `PaymentProvider.resolvePending` takes the owners".

---

### Slice 5a — The relinquished fact

**FISCAL — LOUD, and a cross-package contract change.** The owner lands it. A fresh-context review
of these tasks ran on 2026-11-03 (`/Users/clintongormley/waitron-campaign/a1018/s5a-review-1.md`);
all fifteen of its findings are folded in (Review round 7). No migration: the approval column is
plain text with no check on its shape. It changes three packages: the generic module operation
contract (`@waitron/module`), the server's operation host (`apps/server`) and the fiscal package;
`@waitron/provisioning` and `@waitron/composition` gain only a fixture field in their tests. The
PR discloses that a promotion's stored approval in `fiscal_allocations` can take a new shape
(CLAUDE.md §3's disclosure for a stored-shape change).

**Why.** Promotion's approval always records `oldMachineOffline: true`
(`packages/fiscal-verifactu/src/hour-recovery-preparation.ts:91`), and the preparation refuses
anything else (`:113-114`). That approval is stored in the append-only `fiscal_allocations`
(`packages/fiscal-verifactu/src/classification.ts:10`; `schema/allocations.ts:26`). In a controlled
handover M1 is running, restricted, when M2 activates; recording "offline" would write a false
fact into a record nobody can correct. The approval instead records what happened: M1 signed away
filing to this box.

**How old shapes stay readable.** The new fact goes in a **version 2** approval, built **only
when a promotion's old box relinquished filing** (`oldMachineRelinquished: true`). Every other
approval stays version 1, byte for byte as today: every promotion without the fact (an emergency
handover, an ordinary promotion), and every paper, custody, conflict-recovery, setup and throwaway
approval. Version 1 means "not relinquished". Allocation validation accepts version 2 only when
the context it is judged in says relinquished, and only the hour promotion's admission sets that
(Task 5a.2), so no other path can store one. This is not compatibility code for pre-live data
(CLAUDE.md §3 forbids that): the fiscal package "still reads old Cloud receipts until their
retirement" (`docs/backlog/fiscal.md:1078-1081`; no new ones arrive, since the Cloud registry that
signed them was dropped, A1189). So no reader that accepts version 1 today stops accepting it.

**Task order.** 5a.1 and 5a.1b carry the fact to the module and keep it out of request bodies.
5a.2 teaches allocation validation the new shape **before** 5a.3 builds it: promotion's admission
runs the validator (`packages/fiscal-verifactu/src/allocation-envelope.ts:296` and `:370`), which
today refuses every version 2 `malformed_approval`, so a builder landed first could not pass its
own tests. 5a.4 is the backup verifier and the guards on the readers that stay version 1 only.

**Failing tests and guards.** In this slice a "failing test" is one that fails before its task's
implementation and passes after it. A test that already passes before the implementation is
called a **guard**; each guard is proved by a deletion control (a temporary edit, reverted) that
makes it fail.

#### Task 5a.1: The promotion path carries the fact to the module

**How a promotion reaches the module today** (traced on `61bfdfe405`, re-checked on
`c336372fae`): `POST /management-api/promote` calls
`nodePreparation.withPromotion(operation, body, body, …)` (`apps/server/src/promote-api.ts:116-125`);
`withPromotion` (`apps/server/src/node-operation-preparation.ts:259-280`) calls `invoke`
(`:137-185`), which checks the held context — today only `oldNodeNeutralised` and
`noParallelRecovery` (`Context`, `:40-43`; checks `:149-153`) — and opens the operation scope with
**no isolation** (`:159-160`). The module's facts are then built by `readRecoveryFacts`
(`:104-131`) with `oldMachineOffline: isolation?.oldMachineOffline ?? true` (`:119`). Isolation is
set only by `withLiveRecovery` (`:187-226`), used for the conflict switch; and setting it makes
`authorize` call `assertLive` (`:91`), which refuses `node.read_only` unless the box is already
primary (`:69-77`) — so a mirror's promotion cannot use it.

**Files:**
- `apps/server/src/node-operation-preparation.ts`: `Context` gains `oldMachineRelinquished?: unknown`;
  `invoke` refuses a promote whose value is present and not a boolean with
  `module.operation_invalid` (its existing `invalid(binding)`, `:66-68`), and stores it in the
  scope (`:60-65`) as a **new field, `promotion: { oldMachineRelinquished: boolean }`, not as
  `isolation`**, so `assertLive` is never reached; `readRecoveryFacts` returns
  `oldMachineRelinquished` from that field (absent means `false`) and
  `oldMachineOffline: isolation?.oldMachineOffline ?? !relinquished`. `withLiveRecovery`'s isolation
  and its callers are unchanged.
- `packages/module/src/operation-preparation.ts`: `ModuleRecoveryFacts` (`:15-26`) gains
  `oldMachineRelinquished: boolean`, required. The host's `run(binding, key, isolation, body)`
  (`:122-127`, the live-recovery entry) is unchanged. The name is regime-neutral, so the module
  boundary still learns nothing about Veri*Factu (`scripts/module-seams.test.ts`).
- The source objects that build recovery facts set `oldMachineRelinquished: false`:
  `apps/server/src/recovery-preparation.ts:183-187` and
  `apps/server/src/first-setup-backup-recovery.ts:697-702`. **The `Isolation` type
  (`recovery-preparation.ts:73-76`, a `Pick` of three facts) is not extended**, so the isolation
  answers stay as they are: `recovery-preparation.ts:365-369`, `apps/server/src/recovery-entry.ts:73-77`,
  `apps/server/src/testing/staged-hour-crash.ts:226-230` and
  `apps/server/src/testing/staged-hour-restore.ts:214-218`.
- Test fixtures that build `ModuleRecoveryFacts` gain `oldMachineRelinquished: false` and nothing
  else (fixture growth, no assertion changes). The review's typecheck named:
  `packages/provisioning/src/recovery-preparation-host.test.ts` (at `:54`, `:113` and `:132`),
  `packages/fiscal-verifactu/src/conflict-recovery-routes.test.ts:314`,
  `packages/fiscal-verifactu/src/hosted-hour-recovery.test.ts:56`,
  `packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts:217`,
  `packages/composition/src/allocation-configuration.test.ts:237`,
  `apps/server/src/first-setup-backup-history.test.ts:293`,
  `apps/server/src/hour-recovery-host.test.ts:244`,
  `apps/server/src/testing/hour-test-clock.test.ts:67` and the shared helper
  `apps/server/test/hour-recovery-host.ts:217-230`; add the field at any further site the
  typechecks name.

Tests in a new `apps/server/src/node-operation-preparation.test.ts` (none exists on
`c336372fae`), built as `apps/server/src/live-module-operation.test.ts:80-90` builds
`createNodeOperationPreparation`, with a stub module whose `recovery` records what
`host.readRecoveryFacts` returns and whose `liveRecoveryActions` include `conflict-switch`.
`@waitron/module` changes only a type, so its typecheck is its check.

- [ ] **Step 1: Write the failing tests.** **"a promotion on a mirror with
  `oldMachineRelinquished: true` reaches the module as `oldMachineOffline: false,
  oldMachineRelinquished: true`, and is not refused `node.read_only`"**; "a promotion without it
  reaches the module as `oldMachineOffline: true, oldMachineRelinquished: false`" (fails today:
  the field is absent); "a promotion whose `oldMachineRelinquished` is `"yes"` is refused
  `module.operation_invalid`"; "a conflict switch through `withLiveRecovery` reaches the module
  with its isolation answers and `oldMachineRelinquished: false`" (fails today: the field is
  absent). The hand-built source sites are checked by the typecheck, because the field is
  required.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/node-operation-preparation.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS. **Control** (a temporary edit, reverted): in `invoke`, store the
  fact as `isolation: { oldMachineOffline: false, noParallelRecovery: true }` instead of the new
  field, and the mirror case is refused `node.read_only` — the reason it is a separate field.
  Then run `pnpm --filter @waitron/server exec vitest run src/live-module-operation.test.ts src/promote-api.test.ts src/hour-promotion.test.ts src/hour-recovery-host.test.ts src/first-setup-backup-history.test.ts src/testing/hour-test-clock.test.ts`,
  `pnpm --filter @waitron/provisioning exec vitest run src/recovery-preparation-host.test.ts`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hosted-hour-recovery.test.ts src/minute-selection-unknown-name.test.ts src/conflict-recovery-routes.test.ts`,
  `pnpm --filter @waitron/composition exec vitest run src/allocation-configuration.test.ts`,
  from the root `pnpm exec vitest run scripts/module-seams.test.ts`, and typecheck
  `@waitron/module`, `@waitron/server`, `@waitron/fiscal-verifactu`, `@waitron/composition` and
  `@waitron/provisioning`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a promotion can say the old box relinquished its work, without the live-box check"`.

#### Task 5a.1b: The existing promote routes cannot set the fact

Both existing promote routes pass the whole request body as the context:
`nodePreparation.prepare(operation.binding, body, body, body.proposal, …)`
(`apps/server/src/promote-api.ts:93`) and `withPromotion(operation, body, body, …)` (`:119-122`).
After Task 5a.1 that would let any `node.promote` caller send `oldMachineRelinquished: true` and
store a "relinquished" approval in the append-only `fiscal_allocations` with no relinquishment
behind it. The third path, `withPromotionModuleOperation` (`:128-139`), opens no preparation scope
and reads no context, so the fact cannot enter there; it is unchanged.

**Files:** `apps/server/src/promote-api.ts`: both routes build the context from exactly
`{ oldNodeNeutralised: body.oldNodeNeutralised, noParallelRecovery: body.noParallelRecovery }`.
Only the handover's own routes set `oldMachineRelinquished` — Task 5.7b's preparation route and
Tasks 5.8 and 7.4's activation, all through `handoverPromotionContext`, from the stored, verified
relinquishment or declaration.

Tests:
- `apps/server/src/promote-api.test.ts` uses no database and doubles everything (`:7-8`), so it
  cannot see what is stored. Its case checks what the routes hand on.
- `apps/server/src/hour-promotion.test.ts` already mounts `mountPromoteApi` with a real
  `nodePreparation` and database (the case at `:520-598`, mounting at `:524-548`, reading the
  stored rows through `rows()`, `:258-265`). The end-to-end case goes there.

- [ ] **Step 1: Write the failing tests.** In `promote-api.test.ts`: "both routes hand a stub
  `nodePreparation` a context of exactly `{ oldNodeNeutralised, noParallelRecovery }`, although the
  body also carries `oldMachineRelinquished: true` and the sign-in fields" (fails today: the
  whole body is handed on). In `hour-promotion.test.ts`: **"a promotion whose preparation and
  promote bodies both carry `oldMachineRelinquished: true` stores a version 1 approval exactly as
  today"** (fails today, after Task 5a.1: the fact reaches the preparation, which refuses
  `old_machine_active`, `packages/fiscal-verifactu/src/hour-recovery-preparation.ts:114`). The
  existing cases of both files pass unedited (they are the guards that both routes still pass
  `oldNodeNeutralised` and `noParallelRecovery`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/promote-api.test.ts src/hour-promotion.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a promote request's body cannot claim the old box relinquished"`.

#### Task 5a.2: Allocation validation accepts version 2 only where a relinquished promotion is judged

**Where the approval is judged** (re-checked on `c336372fae`): `approvalShape`
(`packages/fiscal-verifactu/src/allocation-envelope.ts:192-215`) accepts version 1 only, and
runs at admission (`withHourAdmission`, `:296`) and in `validateEnvelope` (`:370`). Activation
judges the approval again with a context built at
`packages/fiscal-verifactu/src/allocation-operation.ts:240-254` from the
`AllocationOperationEvidence` (`:84-90`) that `withHourAdmission` hands on (`allocation-envelope.ts:306-312`):
first through `validateForActivation` (`packages/fiscal-verifactu/src/allocation.ts:84-90`), and
on a retry after commit through `validateAllocationReplay` (`allocation.ts:386-397`). Other
paths judge outside approvals with contexts of their own: the emergency preparation
(`emergency-preparation.ts:228-240`, storing the verdict's approval at `:250`), the paper
recovery export (`paper-recovery-export.ts:86`), paper and dormant promotions (through
`allocation.ts:84`) and old Cloud receipts (`cloud-evidence.ts:373-376`).

**Files:**
- `packages/fiscal-verifactu/src/allocation-types.ts`: `RecoveryApproval` (`:16-27`) becomes
  version 1 as today, or version 2: version 1's fields with `version: 2` and
  `oldMachineRelinquished: boolean`.
- `packages/fiscal-verifactu/src/allocation-envelope.ts`:
  - `AllocationContext` (`:46-89`) gains `oldMachineRelinquished?: boolean`, absent meaning not
    relinquished. `mode` (`:50`, `"initial-setup" | "recovery"`) cannot tell a promotion from a
    recovery, which is why the context carries the fact.
  - `approvalShape` accepts version 1's exact keys with `version: 1`, or those keys plus a boolean
    `oldMachineRelinquished` with `version: 2`.
  - `validateEnvelope`, beside the event check (`:383-391`): a version 2 approval is refused
    `malformed_approval` unless `context.oldMachineRelinquished === true` (so every context that
    never sets the field refuses version 2 exactly as today); a version 1 approval is refused
    `event_mismatch` when `context.oldMachineRelinquished === true`; a version 2 approval whose
    `oldMachineRelinquished` is not `true` is refused `event_mismatch`. The offline rule
    (`:394-395`) is met by `oldMachineOffline` or by a version 2 `oldMachineRelinquished`.
  - `HourAdmissionFacts` (`:234-237`) gains `oldMachineRelinquished?: boolean`;
    `withHourAdmission` puts it in the context it validates with (`:316-329`) and in the evidence
    it hands on (`:306-312`), adding the key only when it is `true`, so every existing caller's
    evidence is unchanged.
- `packages/fiscal-verifactu/src/allocation-operation.ts`: `AllocationOperationEvidence` (`:84-90`)
  gains `oldMachineRelinquished?: boolean`, and the activation context (`:240-254`) copies it.
  `snapshotAllocationEvidence` (`:153-171`) already spreads the evidence, so the field survives it.
- Unchanged, and so refusing version 2: the emergency, paper-export, paper and dormant promotion,
  and Cloud contexts named above. Only the hour promotion's admission facts set the field
  (Task 5a.3).

Tests: new cases in `packages/fiscal-verifactu/src/allocation-envelope.test.ts`,
`hour-standby-activation.test.ts` (which already admits through `withHourAdmission` and
activates, `:83`), `emergency-preparation.test.ts` and `dormant-takeover.test.ts` (which drives a
paper standby promotion through `allocation.ts`).

- [ ] **Step 1: Write the failing tests.** Each fails today because `approvalShape` refuses
  every version 2 `malformed_approval`, or because a version 1 approval passes whatever the
  context says. In `allocation-envelope.test.ts`: "a version 2 approval saying
  `oldMachineOffline: false, oldMachineRelinquished: true` passes when the context says
  relinquished"; "a version 1 approval is refused `event_mismatch` when the context says
  relinquished"; "a version 2 approval saying `oldMachineRelinquished: false` is refused
  `event_mismatch` in a relinquished context". In `hour-standby-activation.test.ts`: "a promotion
  admitted with `oldMachineRelinquished: true` activates and stores the version 2 approval it was
  given"; **"a committed controlled activation, retried, is accepted"** (a lost answer, then a
  retry with `priorActivation: "committed"`; the `fiscal_allocations` count is unchanged).
- [ ] **Step 2: Write the guards.** They pass today, because every version 2 is refused today. In
  `allocation-envelope.test.ts`: "a version 2 approval is refused `malformed_approval` when the
  context does not say relinquished"; "a version 1 approval passes as today when the context does
  not say relinquished". In `emergency-preparation.test.ts`: "an emergency preparation given a
  version 2 approval is refused". In `dormant-takeover.test.ts`: "a paper standby promotion given
  version 2 is refused".
- [ ] **Step 3: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/allocation-envelope.test.ts src/hour-standby-activation.test.ts src/emergency-preparation.test.ts src/dormant-takeover.test.ts` — the Step 1 tests FAIL, the guards PASS.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** them — PASS. **Controls** (temporary edits, reverted): drop the copy at
  `allocation-operation.ts:240-254`, and both `hour-standby-activation.test.ts` cases are refused
  `malformed_approval` at activation — the reason the evidence carries the fact; delete the
  "version 2 only in a relinquished context" refusal, and the three version-2 guards fail (if one
  still passes, name what else refuses it in the commit message). Then run
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-activation.test.ts src/allocation-operation.test.ts src/allocation.test.ts`
  and typecheck `@waitron/fiscal-verifactu`.
- [ ] **Step 6: Commit** `git commit -s -m "fiscal-verifactu: allocation validation accepts a version 2 approval only where a relinquished promotion is judged"`.

#### Task 5a.3: The promotion preparation builds version 2 only when the old box relinquished

**Where the approval is built** (re-checked on `c336372fae`):
`packages/fiscal-verifactu/src/hour-recovery-preparation.ts`'s `inputFor` (`:68-98`) is called in
three places: `:135` (a new intent, conflict switches only), `:166` (`select`) and `:197`
(`prepare`). At `select` no facts are in scope: `engine.select` returns the stored intent without
them (`hour-selection.ts:237-239`). `createPreparation` (`:111`) takes an operator function, not a
promotion flag. If `select` built version 1 while `prepare` built version 2, `prepare` would refuse
`event_mismatch` (`:197-198`).

**Files:** `packages/fiscal-verifactu/src/hour-recovery-preparation.ts`:
- `HourRecoveryFacts` (`:21-26`) gains `oldMachineRelinquished: boolean`, required
  (`ModuleRecoveryFacts` carries it since Task 5a.1, and `hosted-hour-recovery.ts:50-67` spreads it
  through).
- `createPreparation` takes `promotion: boolean` instead of an operator function, and finds the
  operator with `hourOperator(binding, authority, promotion)` (`:34-54`);
  `createHourRecoveryPreparation` (`:105-107`) passes `false`, `createHourPromotionPreparation`
  (`:108-110`) passes `true`.
- `checked` (`:112-118`) admits relinquished only for a promotion: the offline rule (`:114`) is met
  by `oldMachineOffline` or, for a promotion only, by `oldMachineRelinquished`; a recovery whose
  facts say relinquished is refused `old_machine_active`, whatever its offline fact.
- `inputFor` takes `relinquished: boolean`. When it is `true` it builds a version 2 approval with
  `oldMachineOffline: false, oldMachineRelinquished: true`; when it is `false` it builds today's
  version 1, byte for byte (fixed `oldMachineOffline: true`). Its callers: `:135` passes `false`;
  `select` (`:160-168`), for a promotion, reads the fact inside `options.withState(binding, …)`,
  as `within` does at `:145-148` — through `options.readContext` (`hosted-hour-recovery.ts:50-57`,
  which takes no clock reading) and `checked`, falling back to `options.read(binding)` when a test
  host gives no `readContext` — because the real host's `readRecoveryFacts` refuses
  `setup.attempt_conflict` outside a preparation scope
  (`packages/provisioning/src/recovery-preparation-host.ts:26-30`); for a recovery it passes
  `false` without reading. Task 5a.3's `select` test drives the real `createHostedHourRecovery`
  host, so a test host without that scope check cannot hide the refusal. `prepare` passes
  `facts.oldMachineRelinquished` from `within`.
- `prepare` hands the fact to admission: the facts at `:205-207` gain
  `oldMachineRelinquished: facts.oldMachineRelinquished`, which Task 5a.2's `withHourAdmission`
  reads.
- Test fixtures typed `HourRecoveryFacts` gain `oldMachineRelinquished: false` and nothing else:
  `hour-recovery-preparation.test.ts:123`, `conflict-hour-preparation.test.ts:37`,
  `conflict-recovery.test.ts:202`, `minute-selection-unknown-name.test.ts:146-155` (named by the
  typecheck at `:158`), and any further site the typecheck names.

Test `packages/fiscal-verifactu/src/hour-recovery-preparation.relinquished.test.ts`, driving
`createHourPromotionPreparation` through admission and activation.

- [ ] **Step 1: Write the failing tests.** "a controlled promotion stores a version 2 approval
  saying `oldMachineOffline: false, oldMachineRelinquished: true`" (fails today: `checked`
  refuses `old_machine_active`); "`select` and `prepare` build the same version 2 input, so a
  relinquished promotion is not refused `event_mismatch`" (fails today for the same reason); "a
  recovery whose facts say both offline and relinquished is refused `old_machine_active`" (fails
  today: nothing reads the fact).
- [ ] **Step 2: Write the guards.** "a promotion without the fact stores version 1 exactly as
  today" (compared with today's literal); "a recovery still stores version 1, byte for byte as
  today"; "a promotion with neither fact is refused `old_machine_active`".
- [ ] **Step 3: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-recovery-preparation.relinquished.test.ts` — the Step 1 tests FAIL, the guards PASS.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** it — PASS. **Control** (a temporary edit, reverted): build version 2 for
  every promotion, and the first guard fails. Then run
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-recovery-preparation.test.ts src/conflict-hour-preparation.test.ts src/conflict-recovery.test.ts src/minute-selection-unknown-name.test.ts src/hosted-hour-recovery.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/hour-promotion.test.ts` (Task 5a.1b's case
  still stores version 1, because the body cannot carry the fact), and typecheck
  `@waitron/fiscal-verifactu` and `@waitron/server`.
- [ ] **Step 6: Commit** `git commit -s -m "fiscal-verifactu: a promotion whose old box relinquished filing records that, not that it was offline"`.

#### Task 5a.4: Backup verification reads version 2, and the readers that stay version 1 are guarded

**Files:** under `packages/fiscal-verifactu/src/`. The approval is read by these places (found with
`grep -rn oldMachineOffline` and `grep -rn "exact(" ` on `61bfdfe405`, test files aside, and
re-checked on `c336372fae`; a `git grep` for `oldMachineOffline` and `approval.` under `apps/`
finds nothing outside this package that parses the approval; the task's first step re-runs both
greps and adds any new reader to this table):

| Reader | Where | Accepts after this slice |
| --- | --- | --- |
| allocation validation | `allocation-envelope.ts:192-215` (`approvalShape`), the event check `:383-391`, the "old machine" rules `:392-395` | Task 5a.2: version 1 always except in a relinquished context; version 2 only in one |
| backup verification of stored allocations | `backup-verification-history.ts:125-152`, including its "absent or offline" refusal `:142`; the approval is read at `:287`, inside the table loop `:465-467` | versions 1 and 2, the refusal widened to "absent, offline or relinquished" (this task) |
| declared paper evidence | `declared-paper-evidence.ts:181-205` (version check `:195`) | version 1 only, unchanged (paper approvals are never promotions); guarded |
| initial setup | `initial-setup.ts:188-196` and `:224-245` (version check `:239`) | version 1 only, unchanged; guarded |
| old Cloud receipts | `cloud-evidence.ts:270-290` (version check `:279`) | version 1 only, unchanged (Cloud never signs version 2); guarded |
| conflict recovery input | `conflict-recovery-contract.ts:74-128` (`parseConflictInput`, version check `:111`) | version 1 only, unchanged; guarded |
| conflict preparation result | `conflict-recovery-contract.ts:234-255` (`parseConflictPreparation`, which calls `parseConflictInput`) | version 1 only, unchanged: conflict switches only. **Task 6.4's page must not reuse it for a promotion's selected result**, which can be version 2 |
| conflict recovery screen | `dashboard/conflict-recovery.ts:318-331` | conflict switches only, version 1; unchanged |
| Cloud preparation and initial Cloud setup | `cloud-preparation.ts:141`, `initial-cloud-setup.ts:167` | read `oldMachineOffline` after `cloud-evidence.ts`'s version-1-only check; unchanged |
| emergency preparation, paper recovery export | `emergency-preparation.ts:228-240`, `paper-recovery-export.ts:86` | through allocation validation, whose context there never says relinquished: version 1 only; guarded in Task 5a.2 |
| single-field readers | `hour-history-reader.ts:135-175`, `backup-verification.ts:91-108`, `restore-committed.ts:23`, `hour-recovery-state.ts:80` | read only `eventId`, `targetNodeId`, `sourceId` or `confirmedAt`, which version 2 keeps; unchanged |

Builders that keep writing version 1, unchanged: `hour-throwaway-allocation.ts:67`,
`throwaway-allocation.ts:89`, `hour-preparation.ts:64`, `conflict-recovery-routes.ts:92,152`, and
the custody state's typed literal (`custodian/custody-state.ts:93,613`).

Tests in `backup-verification-history.test.ts`, `declared-paper-preparation.test.ts` (which calls
`declared-paper-evidence.ts`), `initial-setup.test.ts`, `cloud-evidence.test.ts` and
`conflict-recovery-contract.test.ts`.

- [ ] **Step 1: Write the failing test.** In `backup-verification-history.test.ts`: "a stored
  version 2 relinquished approval verifies" (fails today: the reader accepts version 1 only).
- [ ] **Step 2: Write the guards.** In `backup-verification-history.test.ts`: "a stored version 1
  approval verifies as today"; "a stored version 2 approval saying neither offline, absent nor
  relinquished is refused". For each unchanged reader, in its suite: "a version 2 approval is
  refused" (so it cannot slip in where no promotion belongs).
- [ ] **Step 3: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification-history.test.ts src/declared-paper-preparation.test.ts src/initial-setup.test.ts src/cloud-evidence.test.ts src/conflict-recovery-contract.test.ts` — the Step 1 test FAILS, the guards PASS.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** them — PASS. **Controls** (temporary edits, reverted): for each unchanged
  reader, make it accept version 2's shape — add `oldMachineRelinquished` to its key list and drop
  its `version !== 1` check — and its guard fails. Dropping the version check alone does not make
  the guard fail, because each reader's key list is exact (for example `declared-paper-evidence.ts:77-81`
  counts the object's own keys). Then the golden and immutability suites unedited, and the
  existing cases of the readers' suites unedited:
  `git diff origin/main -U0 -- packages/fiscal-verifactu/src/{allocation-envelope,backup-verification-history,declared-paper-preparation,initial-setup,cloud-evidence,conflict-recovery-contract}.test.ts | /usr/bin/grep '^-[^-]'`
  prints nothing (new cases only add lines).
- [ ] **Step 6: Commit** `git commit -s -m "fiscal-verifactu: backup verification reads a relinquished promotion's approval; the readers that stay version 1 are guarded"`.

#### Task 5a.5: Final checks for Slice 5a

- [ ] As Task 2.8, plus `pnpm --filter @waitron/fiscal-verifactu exec vitest run` and the
  typechecks of `@waitron/module`, `@waitron/server`, `@waitron/fiscal-verifactu`,
  `@waitron/composition` and `@waitron/provisioning`.
- [ ] `@waitron/fiscal-verifactu` has no mutation script: the review ran
  `pnpm --filter @waitron/fiscal-verifactu mutation`, which printed `None of the selected packages
  has a "mutation" script` and exited 0. Instead, a hand deletion control (reverted): delete Task
  5a.2's version 2 acceptance and its "relinquished must match the context" refusals, run
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/allocation-envelope.test.ts src/hour-standby-activation.test.ts src/hour-recovery-preparation.relinquished.test.ts`,
  and see Task 5a.2's and Task 5a.3's failing tests fail. Paste the counts into the PR.
- [ ] The fixture-only files changed nothing but the field:
  `git diff origin/main -U0 -- <every fixture file Tasks 5a.1 and 5a.3 named> | /usr/bin/grep '^[-+][^-+]' | /usr/bin/grep -v 'oldMachineRelinquished: false'`
  prints nothing.
- [ ] Update CLAUDE.md §5 only if a line there states the approval's facts (grep `oldMachine` and
  "offline" in CLAUDE.md first). PR first line: "FISCAL — a promotion whose old box relinquished
  filing stores a version 2 approval saying so; every other approval stays version 1, byte for
  byte; the module operation contract gains the field".

---

### Slice 5 — Controlled handover, server

**FISCAL** (it activates a fresh fiscal identity on M2, which then files M1's copied records). The
owner lands it. Adds the `handover` module's `venue.db` migration set. Tested as a simulation;
reachable on real boxes after A947 3b.

The order, end to end (design §2): the person starts on M1's dashboard (Task 5.3) → M1 offers to
M2 (M2 records `prepared`) → M1 steps down and restarts restricted (Slice 2) and captures (Slice
4) → M2 fetches and compares, records `copy_accepted`, sends its acceptance (Task 5.5) → M1
records `filing_relinquished` and answers with its relinquishment (Task 5.6) → M2 records
`filing_assumed`, restarts to place the accepted copy (Task 5.7), and waits for a person on its
own page to compare clocks and press Activate (Task 5.8) → M2 activates under its own identity,
takes over M1's payment collection (Task 5.9), restarts as the main box and hands its chart to M1
(Task 5.10); the tills follow the chart.

#### Task 5.1: The `handover` module and its venue record of activations

**Files:** `packages/handover/src/schema/*.ts`, `src/classification.ts`, `src/migrations.ts`,
`drizzle/` (generated); register the module in `packages/composition/src/modules.ts` (mandatory,
after `node`) and `packages/migrations/migrations.manifest.json` (with its append-only table). The
commit message states the reason it is a set of its own and not core's (CLAUDE.md §3): the
handover is one seat's records, kept out of the core set.

- `handover_activations` — ledger, append-only: `operation_id` (primary key), `scenario`,
  `source_node_id`, `destination_node_id`, `evidence` (json: the signed relinquishment, or the
  signed declaration), `person_id` (plain id; `persons` is identity's set), `activated_at`. Each
  `_id` column is a declared reference, a location column or left out of the export
  (`scripts/id-columns-are-references.test.ts`); the column comments say which.

- [ ] **Step 1: Write the failing tests** (`packages/handover/src/schema.test.ts`): "creates the
  table in venue.db"; "a row cannot be updated or deleted" (the append-only trigger's error).
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/schema.test.ts` — FAIL.
- [ ] **Step 3: Implement**; generate the migration.
- [ ] **Step 4: Run** it — PASS; then from the root every guard in Task 1.4's Step 4 plus
  `scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/module-seams.test.ts`,
  and `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "handover: the venue keeps a record of every activation and its evidence"`.

#### Task 5.2: M2 receives an offer

**Files:** Create `apps/server/src/handover-destination-api.ts`, mounted in a mirror's start; add
the offer's row to `read-only-exemptions.ts` (Task 3.2). Test
`apps/server/src/handover-destination-api.test.ts`.

**Interfaces — Produces:** `POST /api/node/handover/offer`, body a `stepdown` envelope signed by
M1 whose body is `{ binding, authorisedBy: personId }`. M2 refuses `handover.not_a_spare` unless it
is a mirror, `handover.peer_unknown` unless the signer is the binding's source and a key it trusts,
`handover.membership_mismatch` (409) when the binding's chart term or digest differs from M2's held
chart, and `handover.operation_in_progress` when another operation is open. Otherwise it records
`prepared` and answers a `status` envelope. `GET /api/node/handover/:operationId` answers M2's
signed status for the page and for retries.

- [ ] **Step 1: Write the failing tests.** One per refusal; "a valid offer records `prepared` and
  a replay returns the same status"; "an offer naming another destination is refused"; "the
  offer reaches the route through the read-only gate" (Task 3.2's exemption test gains the row).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-destination-api.test.ts src/read-only-exemptions.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare accepts a handover offer only from the main box its chart names"`.

#### Task 5.2b: An ordinary promotion waits while a handover is open on this box

**Files:** `apps/server/src/promote-api.ts` (`POST /management-api/promote` and
`/management-api/promote/preparation`, both exempt from a mirror's read-only gate, Task 3.2)
refuse `handover.operation_in_progress` with `{ operationId }` while this box holds an open
operation as destination, before anything is recorded. Test: a new `describe` block in
`apps/server/src/promote-api.test.ts`.

Why: an ordinary promotion of a box that is mid-handover would make it primary without the
handover's relinquishment or declaration, and leave the handover operation behind. The refusal
names the operation, and the person finishes the handover on M2's page instead (Task 6.3), or, if
M1 is gone, declares an emergency there, which replaces a handover still at `prepared` (Task 7.3).

- [ ] Failing tests: "an ordinary promotion while a destination operation is open is refused
  `handover.operation_in_progress` and records nothing"; "with no open operation it promotes as
  today"; "with a closed operation it promotes as today". Implement; PASS.
  `git commit -s -m "server: an ordinary promotion waits while a handover is open on the box"`.

#### Task 5.3: M1 starts a controlled handover

**Files:** Create `apps/server/src/handover-source-start-api.ts` (`POST /management-api/handover`),
mounted in the full start. Test `apps/server/src/handover-source-start-api.test.ts`.

**Interfaces — Consumes:** `confirmFreshSignIn` (`apps/server/src/fresh-sign-in.ts:45`), `stepDown`
(Task 2.4), `currentBinding`, `signAsThisBox` (Task 1.5). **Produces:** body
`{ operationId, destinationNodeId, signIn }`; the session's person must hold `node.promote`. Checks,
each refusing before anything is recorded: the destination is `serving-secondary` in the held
chart (`handover.destination_not_spare`); its `contactUrl` is non-empty and differs from this
box's advertised origin (`handover.destination_unaddressable`, the case every real venue is in
until A947 3b); it answers a signed peer query within 5 s (`handover.destination_unreachable`).
Then it begins its own operation (role source, `prepared`), posts the offer, and calls `stepDown`
with this request as `self`. If the offer is refused or not answered, **or `stepDown` refuses
at its first check**, it records `abandoned` with the reason and answers that refusal; the box keeps
selling, because nothing was stopped. If `stepDown`'s write fails, it answers that refusal and the
box restarts as a normal box; its next start moves the operation to `abandoned`. `stepDown`
can also throw after the gate has closed in other ways (telling the duties to stop failed though
the write committed, which restarts the box restricted; or a replayed call fails), so the route
must tell a first-check refusal apart from the rest before recording `abandoned` (see "Slice 2 as
built"). On
success it answers `{ handoverPage: "<M2 contactUrl>/handover/<operationId>" }` — sent before the
wait for admitted work and the restart (Task 2.4). The same operation id and inputs return the stored answer; changed inputs
refuse `handover.operation_conflict`.

- [ ] **Step 1: Write the failing tests.** One per refusal (each also asserts no node.db row and
  no restart); "a person without `node.promote` is refused"; "an offer M2 refuses leaves the
  operation `abandoned`, the box selling, and a new handover allowed"; "a stepdown refused at its
  first check leaves the operation `abandoned` and the box selling"; "a stepdown whose write fails
  restarts the box, and its next start leaves the operation `abandoned`, which M2's next status
  read sees"; "a valid start records
  `prepared`, offers, steps down and the caller receives the page address"; "a retry after the restart is answered by the
  restricted start from the stored operation" (Task 2.1's `routes` gains this read).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-source-start-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a person holding node.promote starts a controlled handover from the main box"`.

#### Task 5.4: M2 fetches the final copy

**Files:** Extend `handover-destination-api.ts` with a background duty that runs while M2 holds
`prepared` for a controlled operation: it fetches the indicator and the copy from M1 (Task 4.8)
into `<state>/handover/<operationId>/received.db`, retrying every 5 seconds while M1 restarts.
Test `apps/server/src/handover-fetch.test.ts`.

While it waits, each attempt also reads M1's signed status for this operation (Task 3.1's
`requestedOperation`): **only when M1 reports it `abandoned`** does M2 record `abandoned` and stop.
M1 at `prepared` is not enough: M2 answers the offer before M1's stepdown starts, so M2's first
status read can land while M1 is still `prepared` and about to step down (review round 3, C2).
M1 itself turns a `prepared` it will never step down for into `abandoned` — on a failed offer or
a stepdown refused at its first check (Task 5.3), and at its next start (Task 3.4), including after
a stepdown whose write failed — so the abandon M2 waits for always
comes while M1 runs. A stepped-down M1 never reports `abandoned` (Task 1.3), so it is never left
behind.

- [ ] **Step 1: Write the failing tests.** "fetches once M1's restricted start answers"; "a
  partial download is discarded and fetched again"; "stops when the operation leaves `prepared`";
  "M1's status reporting the operation `abandoned` closes M2's operation as `abandoned`";
  **"M2's status read landing between M1's `prepared` and its stepdown keeps M2 waiting, and the
  fetch then succeeds"** (control: with round 2's rule, `prepared` and no restriction, M2 closes
  and the later fetch is refused); "M1's status showing a restriction keeps M2 waiting".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-fetch.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare fetches the old box's final copy and indicator"`.

#### Task 5.5: M2 compares and accepts the final copy

**Files:** Create `apps/server/src/handover-compare.ts`. Test `apps/server/src/handover-compare.test.ts`
(Review Focus 5).

**Interfaces — Produces:**
`compareFinalCopy(deps, operation, indicator: SignedHandoverEnvelope<FinalStateIndicator>, copyPath: string): Promise<{ ok: true } | { ok: false; reason: ErrorCode; detail: CanonicalValue }>`.
In this order, each failure recording `waitHandover(reason)` and leaving M1 stepped down:
indicator signed by the binding's source (`handover.indicator_untrusted`); its binding equals the
operation's (`handover.indicator_mismatch`); the received file's SHA-256 and size equal the
indicator's (`handover.copy_mismatch`); `PRAGMA integrity_check` is `ok`
(`handover.copy_damaged`); every module's copy check passes (Task 4.1, `checkHandoverCopy`;
`handover.chain_broken` naming the module); no set's version is ahead of M2's image
(`provisioning.database_ahead`, as `assertNotAhead`); the module set and versions equal M2's
(`handover.modules_differ`); `backup.env` and `modules.json` digests equal M2's
(`handover.backup_settings_differ`); every ring version listed is in M2's ring
(`handover.key_ring_mismatch`); each module's summary, **recomputed from the received file**,
equals the indicator's (`handover.summary_mismatch`, naming the module). On success: the file is
kept at `<state>/handover/<operationId>/accepted.db`, `copy_accepted` is recorded with the
acceptance envelope, and only then is the acceptance posted to M1. The posting is a duty that runs
while the operation is at `copy_accepted`, every 5 seconds, so a lost answer or a restart of
either box re-posts the same stored acceptance and gets M1's same stored relinquishment (Task
5.6); on receiving it M2 records `filing_assumed` (Task 5.7).

- [ ] **Step 1: Write the failing tests.** One per check, built from a real capture (Task 4.7) and
  then altered: "one row written after capture" (`handover.copy_mismatch`); "a copy whose bytes
  match but whose indicator lists one fewer record in a chain" (`handover.summary_mismatch`); "a
  copy with one record's amount changed and a re-signed indicator" (`handover.chain_broken`); and
  so on. "Nothing is posted to M1 before `copy_accepted` is on disk" (the post seam reads node.db);
  "M2 restarted at `copy_accepted` posts the same acceptance again and records `filing_assumed`".
  Control: the unaltered copy is accepted.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-compare.test.ts` — FAIL.
- [ ] **Step 3: Implement.** One-line comment: the summaries are recomputed from the received
  bytes because a matching digest proves only that M2 holds what M1 sent, not that M1 sent what it
  summarised.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare accepts the final copy only when every check of the indicator passes"`.

#### Task 5.6: M1 relinquishes filing to this M2, once

**Files:** Extend `apps/server/src/handover-source-api.ts` (restricted start) with
`POST /api/node/handover/:operationId/acceptance`. Test
`apps/server/src/handover-relinquish.test.ts`.

**Interfaces — Produces:** verifies the acceptance (signed by the binding's destination, naming
this operation's indicator digest); in one node transaction records `filing_relinquished` with the
signed relinquishment envelope; answers it. A repeat answers the stored relinquishment. An
acceptance for another indicator refuses `handover.indicator_mismatch`.

- [ ] **Step 1: Write the failing tests.** "records and answers a relinquishment bound to the
  indicator and the acceptance"; "a repeated acceptance answers the same bytes"; "M1 is restricted
  before, during and after" (no state lifts the restriction).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-relinquish.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the old box gives up filing to the spare that accepted its copy, and only once"`.

#### Task 5.7: M2 places the accepted copy

**Files:** Create `apps/server/src/handover-place-copy.ts`; modify `boot.ts` (before the store
opens, as `runStagedRestore` does, `apps/server/src/restore-request.ts:344-642`, place
`accepted.db` as `venue.db` when the operation is at `filing_assumed` and not yet placed; `node.db`
is never touched); add the file to `REPLACES` in `scripts/backup-room-note.test.ts`. Test
`apps/server/src/handover-place-copy.test.ts`.

**Interfaces — Produces:** on receiving the relinquishment M2 records `filing_assumed` and
restarts; at start it places the copy under the house rules (Global Constraints → "Replacing or
removing the live `venue.db`": `lockVenueDatabase`, `deleteBackupRoomNote` first, the old file and
its side files moved aside as `restoreDatabase` does, `apps/server/src/restore.ts:661-694`,
Litestream's folder removed) and records `copy_placed` as an event. `accepted.db` is **copied**
into place and kept until `copy_placed` is recorded, and "already placed" is decided by the live
`venue.db`'s SHA-256 equalling the indicator's digest — so a restart after the swap and before the
event records the event without placing again, and a restart mid-swap places again from the kept
file. If Task 4.5's probe made the minute history a transferred item, the retained
`module-evidence` file is placed here too.

- [ ] **Step 1: Write the failing tests.** "places once; a reboot between `filing_assumed` and
  placement places once"; **"a reboot after the swap and before `copy_placed` records the event
  and does not place again"**; "a reboot mid-swap places from the kept `accepted.db`"; "the
  backup-room note is gone before `venue.db` changes" (control: without the deletion, the note
  survives and the test prints it); "`.venue.db-litestream/` is removed"; "the swap does not
  touch `node.db`; its only change is the `copy_placed` event"; "`venue.lock` is never unlinked".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-place-copy.test.ts` and, from the root, `pnpm exec vitest run scripts/backup-room-note.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare places the accepted copy under the venue folder's house rules"`.

#### Task 5.7b: The handover's own preparation route

**Why.** Every promotion needs a clock check against the person's browser, which the browser
drives itself with `clock-challenge` and `compare-clocks` steps
(`packages/fiscal-verifactu/src/conflict-recovery-contract.ts:14-15`); the box refuses its own
machine as the second clock (`hour-setup-clock.ts:106-107`). Those steps reach the module only
through `nodePreparation.prepare` (`apps/server/src/node-operation-preparation.ts:227-241`), whose
one route today is `POST /management-api/promote/preparation` (`apps/server/src/promote-api.ts:93`).
That route is refused while a handover is open (Task 5.2b) and cannot carry the relinquished fact
(Task 5a.1b). So the handover has a route of its own.

**Files:** Create `apps/server/src/handover-preparation.ts`, holding
`POST /api/node/handover/:operationId/preparation` and `handoverPromotionContext` (Task 5.8's
`handover-activation.ts`, created after it, imports both); add `personIdForLoginEmail` to
`packages/identity/src/manager-login.ts` and its index. The route takes
`{ moduleOperation, signIn: { email, password, totp? }, proposal }`, is mounted on a mirror and
added to `read-only-exemptions.ts` (Task 3.2's row). It first calls `requireNodeOperationHttps`
(TLS and a same-origin request, `apps/server/src/node-operation-https.ts`), as both promote routes
do (`promote-api.ts:71,118`). It refuses
`handover.step_out_of_order` unless the operation is at `filing_assumed` or `emergency_declared`,
and `module.operation_invalid` unless the binding's action is `promote` and its target is this
box. It builds the context with one function, `handoverPromotionContext(operation)`, from the
operation's own record — controlled: `{ oldNodeNeutralised: true, noParallelRecovery: true, oldMachineRelinquished: true }`;
emergency: the same with `oldMachineRelinquished: false` — and never from the body; the onBox
check is the existing one (`promote-api.ts:91`). Tasks 5.8 and 7.4 use the same function for
`withPromotion`. Test `apps/server/src/handover-preparation.test.ts`.

**Sign-in by email, without revealing whether the account exists** (CLAUDE.md §3: unknown and
wrong-secret accounts answer `password.invalid` "after the same hashing work"). The pages ask for
an email, but `withAuthenticatedOperation`, which `invoke` uses, takes only a `personId`
(`apps/server/src/operation-authentication.ts:102-110`) and does exactly one password hash itself,
through `checkManagerPassword` by id (`:112-113`), which hashes against a dummy for a person it
cannot find (`packages/identity/src/manager-login.ts:56-65`). So the identity package gains one
export, `personIdForLoginEmail(db, email): Promise<string>`, beside the private `findPersonLogin`
(`manager-login.ts:37`): it does **no** hashing, and answers the person's id, or a fresh random
UUID when no active account has that email. `withAuthenticatedOperation` then does its one hash in
both cases and refuses an unknown id with `password.invalid`, as it refuses a wrong password.

- [ ] **Step 1: Write the failing tests.** "a controlled operation at `filing_assumed` gets a clock
  challenge and a comparison"; "a body that sets `oldMachineRelinquished` is ignored: the context
  comes from the record"; "an operation at `copy_accepted` is refused `handover.step_out_of_order`";
  "the browser on the box itself is refused as the second clock" (`same_machine`); "the route is
  reached through a mirror's read-only gate" (Task 3.2's exemption test gains the row); "after a
  prepare here, the activation with the same context is not refused `event_mismatch`" (control:
  prepare with the other scenario's context, and it is); **"an unknown email and a wrong password
  get the same answer, `password.invalid`, after the same number of password hashes — one"** (a
  counting seam on the hash); "a plain-HTTP or cross-origin request is refused
  `authorization.not_permitted`".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-preparation.test.ts src/read-only-exemptions.test.ts` and `pnpm --filter @waitron/identity exec vitest run src/manager-login.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a handover prepares its clock check and minute through its own route, with the context its record gives"`.

#### Task 5.8: M2 activates

**Files:** Create `apps/server/src/handover-activation.ts` (importing Task 5.7b's
`handoverPromotionContext`); add the activate row to `read-only-exemptions.ts`. Test
`apps/server/src/handover-activation.test.ts` (Review Focus 4). The route first calls
`requireNodeOperationHttps`, and turns the email into a person id with `personIdForLoginEmail`
exactly as Task 5.7b does.

**Interfaces — Produces:** `POST /api/node/handover/:operationId/activate` with
`{ signIn: { email, password, totp? }, comparisonId }`: the person signs in against the placed copy
(`password.invalid` for every credential failure) and must hold `node.promote` there; the clock
comparison and minute selection were prepared through Task 5.7b's route, which `comparisonId`
names. It promotes through the same
path the promote route uses — `nodePreparation.withPromotion(operation, signIn, context, …)`
(`apps/server/src/promote-api.ts:116-125`) with `context = handoverPromotionContext(operation)` (Task 5.7b), here `{ oldNodeNeutralised: true,
noParallelRecovery: true, oldMachineRelinquished: true }`, justified by the recorded
relinquishment — so the module receives `oldMachineOffline: false, oldMachineRelinquished: true`
(Task 5a.1) and `createHourPromotionPreparation`
(`packages/fiscal-verifactu/src/hour-recovery-preparation.ts:108-110`) stores a version 2 approval
(Task 5a.3); the next free minute (decision 7). The **same context** — built by one function
from the operation's own record, Task 5.7b — is passed to the `prepare` step behind Task 5.7b's
route and to `withPromotion`: the approval is part of the prepared input, and the promotion refuses
`event_mismatch` when the input it rebuilds differs from the one prepared
(`packages/fiscal-verifactu/src/hour-recovery-preparation.ts:197`). Promotion's one venue
transaction holds the module activation, `trading.env` and the new chart
(`apps/server/src/promote.ts:268-284`), run by `withPromotion`'s runner as
`commit((tx) => consume(tx, ready))` (`apps/server/src/node-operation-preparation.ts:276`). The
activation wraps the `consume` it hands that runner so the `handover_activations` row is written
**in that same transaction, right after `consume`** — mandatory, never a later transaction. Then
the role (`promote.ts:297-301`) and `activated` are recorded in node.db (venue first, node after);
then it restarts as the promotion route does. A restart after the venue commit is finished by
Task 5.8b.

- [ ] **Step 1: Write the failing tests.** "activates under a new SIF and series, with M1's SIF
  untouched" (`registro_sif` rows for M1 unchanged); "the stored approval says relinquished, not
  offline"; "the new chart marks M1 `sell-only`"; "writes one `handover_activations` row"; "a lost
  activation answer, then a retry with the same operation, answers `activated` and takes no second
  name" (`fiscal_allocations` count unchanged); "a reboot of M1 between relinquishment and M2's
  assumption leaves M1 restricted, and M2's retry of the acceptance gets the same relinquishment";
  "activate before `filing_assumed` is refused `handover.step_out_of_order`"; "a person without
  `node.promote` in the placed copy is refused"; "on a mirror, the activation is not refused
  `node.read_only`"; "the `handover_activations` row commits with the chart, or neither does" (a
  throw injected after `consume`: neither the chart nor the row is stored); "an unknown email and
  a wrong password get the same answer after one password hash each"; "a plain-HTTP or
  cross-origin request is refused"; "the prepare step and the promotion receive the same context" (control: prepare without the field, and the promotion
  is refused `event_mismatch`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-activation.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/server exec vitest run src/promote.test.ts src/promoted-role.test.ts src/boot.promote.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare activates its own identity after a fresh sign-in, recording that the old box relinquished"`.

#### Task 5.8b: A start that finds an activation half-recorded finishes it

**Files:** `apps/server/src/handover-activation-repair.ts`, called from Task 3.4's repair hook,
before the start check. Test `apps/server/src/handover-activation-repair.test.ts` (Review Focus 4).

**Interfaces — Produces:** for an open operation in which this box is the destination, **at
`filing_assumed` or `emergency_declared`**, on a box whose mode is no longer `mirror`, **with a
`handover_activations` row for that operation in `venue.db`**: the activation committed, because
that row is written only inside the activation's own transaction (Task 5.8). The repair records
`activated` in node.db and nothing else. Without the row it changes nothing — in particular, a
box made primary some other way (an ordinary promotion, which Task 5.2b refuses while a handover
is open, but which this rule does not rely on) is never recorded as activated for the handover.
Its source joins `activatedFrom` (Task 3.4).

- [ ] **Step 1: Write the failing tests** (real `startServer`, a crash seam between the venue
  commit and the node.db record): **"M2 killed between the activation's `venue.db` commit and its
  `node.db` record restarts and sells"**, with M1 switched off (control: without the repair, the
  start check waits and the test prints `acceptingSales: false`); **"a box whose own chart names
  it primary but holds no `handover_activations` row for the operation is not recorded as
  activated"**; "an operation at `prepared` or `copy_accepted` is never repaired"; "a mirror is
  left alone".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-activation-repair.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/boot-peer-check.test.ts src/promoted-role.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a start finishes a handover activation whose node.db record was lost"`.

#### Task 5.9: The new main box takes over the old box's payment collection

**Files:** `apps/server/src/handover-collection.ts` supplies Task 4b.2's "boxes this box has taken
over from" set, read from `handover_activations` rows whose `destination_node_id` is this box.
Test `apps/server/src/handover-collection.test.ts`.

- [ ] **Step 1: Write the failing tests.** "after activation, M2's sweep resolves M1's
  `attempting` payment once" (provider stand-in counts one call); "before activation it does
  not"; "a box that took over from nobody sweeps only its own".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-collection.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the new main box resolves the old box's open card payments, and no one else does"`.

#### Task 5.10: The old box learns the new chart, and the controlled handover end to end (simulation)

**Files:** `apps/server/src/handover-activation.ts` (after the restart as the main box, M2 posts
its new chart to M1's `/api/node/membership` once, as a till would, Task 3.3); create
`apps/server/src/handover-controlled.e2e.test.ts`, on the pattern of
`till-reroute-e2e.test.ts:315-392`, with a stand-in AEAT that records each request's
`IdSistemaInformatico` and `NumeroInstalacion`. The file's first comment says: a simulation of two
boxes in one process, not physical qualification.

- [ ] **Step 1: Write the test.** M1 primary with one filed and one `pendiente` record, one open
  table and one `attempting` card payment; M2 a mirror seeded from M1; the handover from Task 5.3
  through activation with a browser clock sample from the test. Assert: M2 `acceptingSales: true`
  with a new series; M1 answers `acceptingSales: false`, holds M2's chart (so the rejoin's fence
  check will pass later), and starts no new filing after its stepdown; a batch already being sent
  when the stepdown starts finishes, and its answer is in the final copy; M2 files M1's
  `pendiente` record with **M1's** identity and its own first sale with **its own**; the open
  table is on M2; M2's sweep, not M1's, resolves the card payment; a till router pointed at both
  moves to M2; **M1 is then switched off and M2 restarted: M2 starts selling, without waiting**
  (it does not count M1 as a peer, Task 3.4); and what M2's certificate card shows (the manifest's open row: if it shows no
  certificate, the test records that as `it.fails` with a comment naming the follow-up, and the
  PR reports it).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-controlled.e2e.test.ts` — PASS (it pins Tasks 5.2–5.9). Control: comment out the restricted start's early return and the assertion that M1 starts no new filing after its stepdown fails.
- [ ] **Step 3: Commit** `git commit -s -m "server: a controlled handover between two simulated boxes, end to end"`.

#### Task 5.11: Final checks for Slice 5

- [ ] As Task 2.8, plus the root guards in Task 5.1's Step 4. PR first line: FISCAL; "adds the
  `handover` migration set; reachable on real boxes after A947 3b".

---

### Slice 6 — Controlled handover, screens and guide

Not fiscal, unless Task 6.4 must give the fiscal module's clock element a promotion mode (then the
PR says FISCAL and the owner lands it). Lands after Slice 5.

#### Task 6.1: "Hand over to this box" on the Servers screen

**Files:** Modify `apps/dashboard/src/screens/servers-screen.ts` (a row action on a
`serving-secondary` row, shown to people holding `node.promote`), `apps/dashboard/src/api/client.ts`
(`startHandover`), `apps/dashboard/src/i18n/strings.ts` and `codes.ts`. Tests
`servers-screen.test.ts`, `servers-screen.a11y.test.ts`, a new `servers-screen.handover.test.ts`.

The dialog: title "Hand over to {box}"; text "This box stops taking sales and sends its final copy
to {box}. {box} then runs the venue with a new invoice series. Tills move by themselves; staff sign
in again. A card payment already in progress is not charged again." The fresh sign-in (passkey, or
password then code), as the recovery-pack screen asks it (`apps/server/src/backup-recovery-pack-api.ts:389`).
**Hand over** sends the request with an operation id kept for retries; success opens the address it
answers. Refusals per code, each saying what happened and what to do (CLAUDE.md §3): unreachable —
"{box} did not answer. Check it is switched on and connected, then try again."; unaddressable —
"{box} shares this box's address, so it cannot be handed over yet."

- [ ] **Step 1: Write the failing tests** (real Chromium): the action shows only on a spare row
  and only for `node.promote`; the dialog follows the Forms contract (`design-system.md:2589`); each
  refusal's sentence; English and Spanish; axe in both themes.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/servers-screen.handover.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and the two existing suites — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "dashboard: hand the venue over to a spare from the Servers screen"`.

#### Task 6.2: M2 serves its handover page

**Files:** Create `apps/server/src/handover-page-mount.ts` (serves the setup app's handover screen
at `/handover/:operationId` on a mirror and on a box between placement and activation, the way
`boot.ts:923` serves the setup app). Test `apps/server/src/handover-page-mount.test.ts`.

- [ ] **Step 1: Write the failing tests.** "a mirror serves `/handover/<id>`"; "a box between
  placement and activation serves it"; "a primary that finished activating answers 404 for an
  unknown id".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-page-mount.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare serves its own handover page"`.

#### Task 6.3: The handover screen shows progress

**Files:** Create `apps/setup/src/screens/handover-screen.ts` (the setup app already hosts the
fiscal module's clock comparison with its explained waits, `vf-recovery-hour`, A947 4a). Tests
`apps/setup/src/screens/handover-screen.test.ts`, `.a11y.test.ts`.

The page shows the operation's progress from `GET /api/node/handover/:operationId` (Task 5.2), one
line per step, refreshing every 2 seconds; a lost answer re-reads the status, never re-sends a
different request.

- [ ] **Step 1: Write the failing tests.** Progress lines per state; a waiting reason shown in
  words; English and Spanish; axe both themes, 390 px.
- [ ] **Step 2: Run** `pnpm --filter @waitron/setup exec vitest run src/screens/handover-screen.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "setup: the spare's handover page shows each step as it happens"`.

#### Task 6.4: The handover screen signs in, compares clocks and activates

**Files:** `apps/setup/src/screens/handover-screen.ts`. Tests `handover-screen.activate.test.ts`.

Once the status reports the copy placed (the `copy_placed` event, Task 5.7) the page asks for a
sign-in (email, password, then code) and shows the clock comparison with its explained wait and
countdown, sending the browser's `clock-challenge` and `compare-clocks` steps to
`POST /api/node/handover/:operationId/preparation` (Task 5.7b) — not to
`/management-api/promote/preparation`, which Task 5.2b refuses while the handover is open; then
**Start the venue on this box**. Refusals in place.

- [ ] **Step 1: Write the failing tests.** The sign-in appears only once the copy is placed; the
  button stays disabled until the clock comparison passes; a lost answer followed by a status of
  `activated` shows success without a second press; English and Spanish.
- [ ] **Step 2: Run** `pnpm --filter @waitron/setup exec vitest run src/screens/handover-screen.activate.test.ts` — FAIL.
- [ ] **Step 3: Implement.** If `vf-recovery-hour` cannot drive a promotion binding as it stands,
  give it a promotion mode in `packages/fiscal-verifactu/src/setup/` with its own tests and mark the
  PR FISCAL.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "setup: the spare's own page carries a handover through to activation"`.

#### Task 6.5: The guide

**Files:** `apps/server/src/guide/en/servers.md`, `apps/server/src/guide/es/servers.md`: sections
`{#hand-over}` (when to use it, what each box shows, what staff do) and `{#after-hand-over}`;
`apps/dashboard/src/help-guide.ts` links the dialog to `{#hand-over}`.

- [ ] Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the
  root, `pnpm exec vitest run scripts/guide-links.test.ts` — PASS.
  `git commit -s -m "guide: handing the venue over to a spare, in English and Spanish"`.

#### Task 6.6: Final checks for Slice 6

- [ ] As Task 2.8, with the dashboard and setup typechecks and their browser suites run with
  measured headroom (`memory_pressure | grep free`, CLAUDE.md §2).

---

### Slice 7 — Emergency handover, server

**FISCAL**. The owner lands it. Adds a second migration to the `handover` set.

#### Task 7.1: The gap tables

**Files:** `packages/handover/src/schema/*.ts`, `drizzle/` (generated, the set's second
migration), `packages/migrations/migrations.manifest.json` (the append-only table).

- `handover_gap_items` — state: `id`, `operation_id`, `kind` (`unknown_interval` |
  `returned_invoice`), `source_node_id`, `installation`, `series_number`, `original_ids` (json),
  `issue_date`, `taxable_cents`, `tax_cents`, `gross_cents` (null for an unknown interval),
  `interval_from`, `interval_to`, `evidence` (json: where the retained original and the batch that
  carried it are kept; Slice 12a fills it), `status` (`open` | `acknowledged` | `resolved`),
  `updated_at`. Money in whole cents (CLAUDE.md §3).
- `handover_gap_events` — ledger, append-only: `id`, `gap_item_id` (foreign key), `kind`
  (`opened` | `acknowledged` | `resolved` | `interval_closed`), `person_id`, `note`,
  `correction_reference`, `recorded_at`.

- [ ] **Step 1: Write the failing tests** (`packages/handover/src/schema.gaps.test.ts`): "creates
  the two tables in venue.db"; "a gap event cannot be updated or deleted"; "a gap item's amounts
  are whole cents" (a fraction refused by its check).
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/schema.gaps.test.ts` — FAIL.
- [ ] **Step 3: Implement**; generate the migration.
- [ ] **Step 4: Run** it — PASS; then the root guards in Task 5.1's Step 4.
- [ ] **Step 5: Commit** `git commit -s -m "handover: the venue keeps the gaps an emergency leaves"`.

#### Task 7.2: What the spare shows before a declaration

**Files:** Create `apps/server/src/handover-emergency-api.ts` (mirror start). Test
`apps/server/src/handover-emergency-preview.test.ts`.

**Interfaces — Produces:** `GET /api/node/handover/emergency/preview` answers
`{ source: { nodeId, name }, copy: { kind: "mirror-copy", lastChangeAtMs, integrity: "ok" | "damaged", chains: "ok" | "broken" }, chainSummaries: ChainSummary[], sourceAnswering: boolean, openEmergency: { operationId, state } | null }`.
`openEmergency` is this box's open emergency operation, if it has one, so the page can resume it
(Task 8.1).
`integrity` is `PRAGMA integrity_check`; `chains` is every module's copy check (Task 4.1,
`checkHandoverCopy`; for Veri*Factu, Task 4.3's whole-chain walk), run on the copy opened as a
read-only `BackupQuery`; `chainSummaries` is Task 4.2's summary. `lastChangeAtMs` is the newest
`issued_at` in `sales` and `updated_at` in `working_orders` of the copy, labelled on the page as
"the latest activity this copy holds" (A947 3c's follower position replaces it). `sourceAnswering`
is a signed peer query to the source (5 s). Reads only.

- [ ] **Step 1: Write the failing tests.** "names the last activity and every chain"; "reports a
  damaged copy" (a corrupted page); "reports a broken chain" (one record's amount changed in the
  copy; control: unchanged reads `ok`); "says the old box still answers when it does"; "writes
  nothing to the copy" (digest before and after).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency-preview.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare checks its copy and its chains, and shows what it holds, before anyone declares"`.

#### Task 7.3: The declaration

**Files:** Extend `handover-emergency-api.ts` with `POST /api/node/handover/emergency/declare`;
add its row to `read-only-exemptions.ts`. Test `apps/server/src/handover-emergency-declare.test.ts`.

**Interfaces — Produces:** body `{ operationId, signIn: { email, password, totp? }, statements, reason, locale }`.
The route first calls `requireNodeOperationHttps` (as Task 5.7b), then signs the person in by
email with `loginManager` (`packages/identity/src/manager-login.ts:130-144`), which already does
the same hashing work for an unknown account (a dummy hash, `:88-89`), and ends the session in
the same step. Refusals, each before anything is recorded: a credential failure `password.invalid`; no
`node.promote` → `authorization.not_permitted` (what `authorizeManager` throws,
`packages/identity/src/manager-login.ts:172`); a statement not `true` → `handover.request_invalid`
naming it; `reason` empty or over 500 characters; the source still answers a signed query →
`handover.source_still_answering` (409; the page offers the controlled handover); a damaged copy →
`handover.copy_damaged`; a broken chain → `handover.chain_broken`. Then, in one node transaction,
the operation (`emergency`, role destination) at `emergency_declared` and the signed declaration
as an event. **Crash replacement (design §7):** if this box holds an open controlled operation for
the same source with only `prepared` recorded — no `copy_accepted`, no `filing_assumed`, no
`activated` — that operation moves to `replaced` with an event naming the new one **before** the
new operation is inserted, in the same node transaction (the one-open index refuses the other
order, Formats), and the declaration's `replaces` names it; with anything later recorded, the declaration is refused
`handover.controlled_unresolved` (409).

- [ ] **Step 1: Write the failing tests.** One per refusal (each asserting no node.db row); "a
  valid declaration records it before answering"; "the same operation and inputs answer the stored
  declaration"; "replacement from `prepared` moves the old operation to `replaced`; refused from
  `copy_accepted`"; "an unknown email and a wrong password get the same answer after the same
  hashing work"; "a plain-HTTP or cross-origin request is refused"; "the reason is never in a log line" (capture the logger).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency-declare.test.ts src/read-only-exemptions.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then from the root `pnpm exec vitest run scripts/personal-log-params.test.ts scripts/errors-reachable.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: an emergency declaration is recorded on the spare before anything changes"`.

#### Task 7.4: Emergency activation

**Files:** Extend `apps/server/src/handover-activation.ts` (Task 5.8) for the emergency scenario.
Test `apps/server/src/handover-emergency-activation.test.ts`.

**Interfaces — Produces:** `POST /api/node/handover/:operationId/activate` accepts an emergency
operation at `emergency_declared`, with the same sign-in, the clock comparison prepared through
Task 5.7b's route (whose context, built from this operation's record, carries
`oldMachineRelinquished: false`), and through the same
`withPromotion` path with `context = { oldNodeNeutralised: true, noParallelRecovery: true,
oldMachineRelinquished: false }`, so the module receives `oldMachineOffline: true`, justified by
the recorded declaration; the next free minute (Q2, answered (a)). In the activation's own venue
transaction, as Task 5.8 writes it: the `handover_activations` row with the declaration as evidence and a
`handover_gap_items` row `{ kind: "unknown_interval", interval_from: lastChangeAtMs, interval_to: null }`;
then `activated` in node.db. A restart between is finished by Task 5.8b.

- [ ] **Step 1: Write the failing tests.** "takes the next free minute" (fake clock; the same as
  a controlled activation in the same harness); "the stored approval is version 1,
  `oldMachineOffline: true`, with no `oldMachineRelinquished` key"; "writes the activation and the unknown interval in the activation's own
  transaction"; "a crash after the activation commit and before the node.db record: the next
  start records `activated` once and sells" (Task 5.8b's repair); "a lost answer and a retry take no second
  name".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency-activation.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare activates after a declaration and records the gap"`.

#### Task 7.4b (not built: the owner answered Q2 with (a)): the emergency waits as a restore does

**FISCAL.** **Files:** `packages/fiscal-verifactu/src/hour-selection.ts:461` (a promotion whose
binding carries a recorded emergency declaration settles, as `setup`, `restore` and
`conflict-switch` do); CLAUDE.md §5's "Setup/restore wait 90–150 seconds; promotion does not."
line, rewritten to name the emergency promotion; `handover-emergency-activation.test.ts`.

- [ ] Failing tests: "an emergency promotion waits 90–150 seconds"; "a controlled promotion still
  takes the next free minute" (control); `minute-selection-unknown-name.test.ts` passes unedited.
  Implement; PASS; golden and immutability suites unedited.
  `git commit -s -m "fiscal-verifactu: an emergency promotion waits as a restore does (owner, Q2)"`.

#### Task 7.5: Retries and crashes across both boxes

**Files:** Test `apps/server/src/handover-emergency.crash.test.ts` (Review Focus 4).

- [ ] **Step 1: Write the tests.** "a reboot between declaration and activation resumes at
  `emergency_declared` and activates once"; "a second declaration naming another source while one
  is open is refused `handover.operation_in_progress`"; "a declaration for a different destination
  after possible activation is refused" (design §7); "M1 comes back while M2 is at
  `emergency_declared`: M1's start check (Slice 3) finds M2's open operation naming it and starts
  restricted".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency.crash.test.ts` — PASS, each with its control named in the test.
- [ ] **Step 3: Commit** `git commit -s -m "server: emergency retries and reboots keep one filing box"`.

#### Task 7.6: The emergency, end to end (simulation)

**Files:** `apps/server/src/handover-emergency.e2e.test.ts` (first comment: a simulation, not
qualification).

- [ ] **Step 1: Write the test** on Harbour Kitchen §9: M2 seeded from M1 "at 21:39" with a
  `nodes` row for M2 in both files (as A947 3b will write it); M1 then issues invoice
  `A-0CNNW/218` (€110.00) and is closed without a stepdown; M2's declaration and activation; M2
  files M1's copied `pendiente` record in M1's identity; M1 started again finds M2 (Slice 3),
  writes `superseded`, starts restricted, makes no AEAT request; the gap list holds one unknown
  interval from 21:39 and **no** amounts. Before M1 returns, **M2 is restarted with M1 still off
  and starts selling without waiting** (Task 3.4).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency.e2e.test.ts` — PASS.
- [ ] **Step 3: Commit** `git commit -s -m "server: an emergency handover between two simulated boxes, end to end"`.

#### Task 7.7: Final checks for Slice 7

- [ ] As Task 2.8, plus the root guards in Task 5.1's Step 4. PR first line: FISCAL; "reachable on
  real boxes after A947 3b; continuous copy after 3c".

---

### Slice 8 — Emergency declaration page and guide

Not fiscal. Lands after Slices 6 and 7.

#### Task 8.1: The emergency mode of M2's page

**Files:** Modify `apps/setup/src/screens/handover-screen.ts` (Tasks 6.3–6.4) with an emergency
mode at `/handover/emergency`; strings in `apps/setup/src/i18n/`. Tests
`handover-screen.emergency.test.ts`, `.a11y.test.ts`.

The page, top to bottom: what the copy holds ("The latest activity this copy holds is from
{time}. Anything after that is missing."), and whether its records check out; the design's
warning (§4), in English and Spanish: "Switch off {M1} before continuing. A broken connection can
look like a failed machine. If {M1} is still running, both machines may take sales and payments,
and your bills, cash and stock will disagree. {M2} may be missing {M1}'s latest records. Only tax
records will return later; the business difference will need reconciliation."; the three
statements (required checkboxes); the reason (required, up to 500 characters); the sign-in
(email, password, then code), with one line "Passkeys are not offered here yet."; then two
actions in order. **On load, the page reads the preview's `openEmergency`: when the spare already
holds an operation at `emergency_declared`, it shows that declaration's reason and time, skips
the declaration, and goes straight to the sign-in and the clock check** — from any device, so a
person whose first device's clock disagreed can carry on from a phone. Otherwise: **Record the declaration**, disabled until every required field passes, sends
Task 7.3's request. Once it is recorded, the page compares clocks through
`POST /api/node/handover/:operationId/preparation` (Task 5.7b needs the operation at
`emergency_declared`), and **Start the venue on this box** is enabled once the clocks pass. A
declaration recorded while the clocks then fail leaves the spare a mirror that files nothing; the
page offers **Check again**. Refusals in place: still answering — "{M1} still answers, so it was not switched off. Hand
over from {M1} instead, or switch it off and check again." with **Check again** and **Hand over
instead**; a broken chain — "This copy's invoice records do not check out, so it cannot be used.
Choose a backup instead." with the backup choice once Slice 14 lands; a role refusal offers
**Sign in as someone else** (an administrator in place).

- [ ] **Step 1: Write the failing tests.** The warning and statements in both languages;
  **Record the declaration** disabled until all required pass; the clock comparison starts only
  after the declaration is recorded, and **Start the venue on this box** is enabled only once it
  passes; **"opened on a second device while the spare holds a declaration at
  `emergency_declared`, the page skips the declaration and offers the sign-in and the clock
  check"** (control: without the resume, the form is blank and a second declaration is refused
  `handover.operation_in_progress`); each refusal's sentence and choices; the reason over
  500 characters marked inline; axe both themes, 390 px.
- [ ] **Step 2: Run** `pnpm --filter @waitron/setup exec vitest run src/screens/handover-screen.emergency.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "setup: the spare's emergency page warns, asks for three statements and a reason, then starts the venue"`.

#### Task 8.2: Reaching the page

**Files:** `apps/server/src/handover-page-mount.ts` (serve `/handover/emergency` on a mirror at its
own address); the Servers screen, opened on the spare's own dashboard, links to it. Tests in
`handover-page-mount.test.ts`.

- [ ] Failing test "a mirror serves the emergency page; a primary does not"; implement; PASS;
  `git commit -s -m "server: a spare serves its emergency page at its own address"`. The till strip
  and the QR label remain A947 4c and 4d.

#### Task 8.3: The guide

- [ ] Sections `{#emergency}` and `{#old-box-returns}` in both `servers.md` files: when to use it,
  the warning in plain words, what comes back later and what does not. Guide suites as Task 6.5.
  `git commit -s -m "guide: the emergency switch and what happens when the old box returns"`.

#### Task 8.4: Final checks for Slice 8

- [ ] As Task 6.6.

---

### Slice 9 — The S2 prototype re-run, fiscal-only

Not fiscal (a rig that imports no `@waitron/*` package, `bench/sqlite-failover/README.md:1-21`).
It is the gate for Slices 10 and 11 (A947 §7.1: "If S2 does not pass, the tail shipper is not
built").

#### Task 9.1: Model the fiscal-only return batch

**Files:** Modify `bench/sqlite-failover/src/scenarios/s2_no_double_submit.ts` and
`bench/sqlite-failover/src/model.ts`.

- [ ] **Step 1:** Add a part "fiscal-only full-state batch from a fenced sender": the sender is
  fenced before the batch; the batch carries records after the receiver's head, every filing row
  and every acknowledgement it holds, and returns `enviando` rows as `pendiente`; the receiver
  pauses filing for the sender's chains while applying; business rows are never carried. Add the
  replay variant as a part of its own.
- [ ] **Step 2: Run** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/bench-sqlite-failover scenarios` and read S2's row — expect PASS for these parts.
- [ ] **Step 3: Commit** `git commit -s -m "bench: S2 models A1018's fiscal-only return batch from a fenced sender"`.

#### Task 9.2: The three controls

- [ ] **Step 1:** Add controls that must FAIL: the fence removed; the batch cut back to missing
  records only; the batch built without the `enviando` → `pendiente` return. Run as Task 9.1 Step 2
  and read each control's line: each reports a second filing. Before running, write in the
  scenario's comment what the failing line prints.
- [ ] **Step 2: Commit** `git commit -s -m "bench: S2's controls show each part of the return batch is needed"`.

#### Task 9.3: Record the result

- [ ] Add the run's table, date and commit to `docs/research/2026-09-16-sqlite-failover-prototype.md`
  as a dated section, and the command to `bench/sqlite-failover/README.md`.
  `pnpm --filter @waitron/bench-sqlite-failover typecheck`.
  `git commit -s -m "docs: S2 passes with A1018's return batch; its controls fail as they should"`.
  **If S2 does not pass, Slices 10 and 11 are not built**; stop and report.

#### Slice 9 as built (2026-11-03)

The build departed from the task texts above in the first two ways; the last two record a choice
and a limit the task texts left open. The task texts are left as written.

- S2's row still reads FAIL: Parts F and G pass and the three controls fail, but the old Part D
  and Part E's second half (the unfenced tail ship) still file a record twice. Whether the gate is read off F and G
  alone waits for the owner; see the
  [research note](../../research/2026-09-16-sqlite-failover-prototype.md#s2-re-run-with-a1018s-return-batch-2026-11-03).
  Task 9.3's commit message was not used, because S2 did not pass.
- The third control reports a record never filed rather than a second filing: the rig's filing
  run picks up only waiting rows.
- Part G builds the batch again from the same reported heads and applies the first batch a second
  time.
- No control drives the receiver's per-chain pause.

---

### Slice 10 — Return batch: evidence, and the exchange both scenarios use

**FISCAL**. The owner lands it. Waits for Slice 9's PASS. A fresh-context review of this slice's
tasks, against A947 §7.1 as amended, runs before its first implementer (topology §5.2, risk 2).
Until Slice 11 lands, a batch that carries records M2 lacks leaves the operation at
`return_pending` with the waiting reason `handover.returned_originals_waiting`; nothing reaches
`return_complete` while a returned original is unstored.

#### Task 10.1: The fiscal seat for the return batch

**Files:** Modify `packages/fiscal/src/contribution.ts` (`FiscalContribution.handover?`, beside
`drain`, `:183`). Test `packages/fiscal/src/contribution.handover.test.ts` (types and a
contract-shaped stand-in).

**Interfaces — Produces:**
```ts
interface FiscalHandoverSeat {
  buildReturn(tx: Transaction, request: { heads: readonly { nodeId: string; sifId: string; secuencia: number }[] }): Promise<CanonicalValue>;
  applyReturn(tx: Transaction, body: CanonicalValue, ctx: { operationId: string; sourceNodeId: string }): Promise<ReturnApplyResult>;
  receipt(tx: Transaction, body: CanonicalValue): Promise<CanonicalValue>;
  chainsOf(body: CanonicalValue): readonly string[]; // sif ids the batch touches, for the pause
}
interface ReturnApplyResult {
  readonly outcomesApplied: number; readonly conflicts: readonly { recordId: string; ours: string; theirs: string }[];
  readonly missingRecords: readonly string[]; // ids M2 lacks; Slice 11 stores them
}
```
- [ ] Failing test, implement, PASS (`pnpm --filter @waitron/fiscal exec vitest run src/contribution.handover.test.ts`).
  `git commit -s -m "fiscal: a seat for building and applying a handover's return batch"`.

#### Task 10.2: Veri*Factu builds the batch

**Files:** Create `packages/fiscal-verifactu/src/handover-return.ts` (`buildReturn`, `chainsOf`).
Test `packages/fiscal-verifactu/src/handover-return.build.test.ts`.

**Interfaces — Produces:** the body in Formats → "Return batch": per chain M1 holds, records after
the requested head in `secuencia` order, byte-for-byte; every `envios`, `acks`, `filing_cases`
and `filing_case_events` row for any record of those chains; the `envio_flujo` row; `enviando`
rows carried as `pendiente` with their original state named (A947 §7.1). Read-only.

- [ ] **Step 1: Write the failing tests.** "carries records after the head, all filing rows, all
  answers and `envio_flujo`"; "with every head equal to M1's, carries no records and still every
  filing row" (the controlled case); "an `enviando` row is carried as `pendiente` with its
  original state named"; "carries no `sales`, `sale_lines`, `working_orders`, `payments` or
  `tenders` row" (the body's keys); "built twice from the same database and request, the canonical
  bytes are equal"; "writes nothing" (file digest).
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/handover-return.build.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS, then the golden and immutability suites.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: build a returning box's tax records, filing state and AEAT answers, and nothing else"`.

#### Task 10.3: M1 freezes and serves its batch

**Files:** Create `apps/server/src/handover-return-source.ts` (restricted start:
`POST /api/node/handover/:operationId/return`, a request signed by the operation's destination
carrying its heads). An emergency M1 that wrote `superseded` (Tasks 3.3, 3.4) records the
operation as source at `source_superseded` from M2's status; a controlled M1 already holds it at
`filing_relinquished`. **The design §7 crash case:** an M1 that stepped down for a controlled
operation X, which M2 then replaced by an emergency declaration Y (Task 7.3), still holds X open at
`source_stepped_down`; when the return request for Y names X in its declaration's `replaces`, M1
first moves X to `replaced`, then begins Y as source at `source_superseded`, in one node
transaction — the other order is refused by the one-open-operation index (Formats). Its restriction, naming X, is left as it is. Test `apps/server/src/handover-return-source.test.ts`.

**Interfaces — Produces:** the batch envelope stored at `<state>/handover/<operationId>/return-<sequence>.json`
keyed by the request digest; the same request answers the same bytes; a request with other heads
is a new sequence. M1 records `return_pending`. Add the sentence that the box sends its invoice
records back to the restricted page (`restricted-page.ts`) and to `servers.md` `{#handed-over}`,
both languages (see "Slice 2 as built").

- [ ] **Step 1: Write the failing tests.** "the same request twice answers identical bytes";
  "another destination is refused"; "a box that is not restricted refuses
  `handover.not_stepped_down`"; "a controlled M1 answers an empty-records batch"; "an M1 holding X
  at `source_stepped_down` asked for Y, which replaces X, closes X as `replaced` and answers Y's
  batch" (it also asserts the update runs before the insert); "a request for Y that does not name X is refused while X is open".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-return-source.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a returning box freezes its tax records into a batch that every retry repeats"`.

#### Task 10.4: M2 asks for the batch

**Files:** Create `apps/server/src/handover-return-watch.ts` (on M2 after an activation, either
scenario: every minute, a signed peer query to the source; when it answers restricted, request
the batch with M2's heads; M2's operation moves to `return_pending`). Test
`apps/server/src/handover-return-watch.test.ts`.

Whenever the source's status reports a chart older than M2's, the watch posts M2's chart to the
source's `/api/node/membership` (Task 3.3) — so a lost post from Task 5.10, or an M1 that was off
when it was made, still ends up holding the chart that fences it, which its rejoin needs
(`apps/server/src/rejoin.ts:43-46`).

- [ ] **Step 1: Write the failing tests.** "asks every minute until the source answers
  restricted"; "posts M2's chart to a source reporting an older term, until it reports the new
  one"; "requests with M2's head for each of the source's chains"; "stops once the
  operation is `return_complete` or `return_abandoned`"; "after a controlled activation it asks at
  once".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-return-watch.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the new main box asks a returning old box for its tax records"`.

#### Task 10.5: The drain's outside pause

**Files:** Modify `packages/fiscal-verifactu/src/drain.ts` (an outside input
`pausedSifIds?: () => ReadonlySet<string>` read at the start of each pass and joined with
`blockedSifIds`, `:252-255`; the comment at `:577-579` updated to say the per-pass block now has
this outside input). Test `packages/fiscal-verifactu/src/drain.paused.test.ts`.

- [ ] **Step 1: Write the failing tests.** "a paused chain is not claimed; another chain is";
  control "without the pause both are claimed"; `src/drain.test.ts` passes unedited.
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.paused.test.ts src/drain.test.ts` — FAIL (the first).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then the golden and immutability suites.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: the drain can pause chosen chains from outside"`.

#### Task 10.6: M2 applies known answers, keeps conflicts

**Files:** implement `applyReturn` in `handover-return.ts`; create
`apps/server/src/handover-return-apply.ts` (adds the chains to the paused set, waits for the pass
in flight to end, applies in one venue transaction, lifts the pause). Tests
`packages/fiscal-verifactu/src/handover-return.apply.test.ts`,
`apps/server/src/handover-return-apply.test.ts` (Review Focus 6).

Rules for a record M2 holds, using the filing order of A947 §7.2 check 1 (not yet filed —
`pendiente`, `enviando` — before finished — `aceptado`, `aceptado_con_errores`, `rechazado`,
`detenido`, `retenido`; `pendiente` with `reconciled_resubmit_at` counts as further along):
M1's state further along → M2 takes M1's `envios` state and `acks` row; equal → nothing; M2's
further along → nothing; two different finished states → keep M2's row, record M1's in
`fiscal_conflict_evidence` and open a filing case on M2 (`openFilingCase`,
`packages/fiscal-verifactu/src/filing-cases.ts:51-70`) — never last-arrival-wins. A record M2 lacks
goes to `missingRecords`. A record whose stored bytes differ from M2's copy of the same id is a
conflict, never an overwrite. M1's `envio_flujo` row: M2 keeps the later of the two next-send
times and the larger wait, and records M1's incident token as evidence without adopting it
(decision 8).

- [ ] **Step 1: Write the failing tests.** One per rule; "M1's later AEAT wait moves M2's gate
  later, and an earlier one never moves it earlier"; "applying the same batch twice changes
  nothing"; "a pass in flight on a paused chain finishes before the batch applies" (server); "a
  batch with missing records leaves the operation `return_pending` with
  `handover.returned_originals_waiting`"; "a crash after the apply commit and before the
  `node.db` record: the next pass applies nothing new and records the state"; "a batch holding a
  conflict and a missing record, applied twice, leaves the `fiscal_conflict_evidence` count, the
  filing cases and the missing list as after the first" (`openFilingCase` already returns the
  existing case, `packages/fiscal-verifactu/src/filing-cases.ts:55-59`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/handover-return.apply.test.ts` and `pnpm --filter @waitron/server exec vitest run src/handover-return-apply.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal: apply a returning box's AEAT answers to records the new box holds, keeping both facts when they disagree"`.

#### Task 10.7: The receipt

**Files:** `receipt` in `handover-return.ts`; `apps/server/src/handover-return-apply.ts` answers
it to M1 as a `return-receipt` envelope and records it. Test
`packages/fiscal-verifactu/src/handover-return.receipt.test.ts`.

- [ ] Failing tests "per record, the id and huella M2 holds; per filing row, M2's state; per chain,
  count and head"; "a record M2 lacks is listed as missing, not as held"; "an empty-records batch
  gets a receipt whose chains equal M1's". Implement; PASS.
  `git commit -s -m "fiscal-verifactu: the new box's receipt for a return batch"`.

#### Task 10.8: Final checks for Slice 10

- [ ] As Task 2.8, plus `pnpm --filter @waitron/fiscal exec vitest run`. PR first line: FISCAL;
  "the drain gains an outside per-chain pause".

---

### Slice 11 — Return batch: originals M2 never saw

**FISCAL — LOUD.** The owner lands it. It adds a store of returned tax records and a second filing
path. It **does not** write `registros_facturacion`, never recomputes a huella and never builds a
record; it stores M1's records byte-for-byte and sends them unchanged in their generating
identity. A fresh-context review of the slice before its first implementer, as Slice 10.

#### Task 11.1: The returned-records store

**Files:** `packages/fiscal-verifactu/src/schema/returned-records.ts`, `src/classification.ts`,
the package's migration (generated), `src/returned-records.ts`,
`packages/migrations/migrations.manifest.json` (the append-only table). Test
`packages/fiscal-verifactu/src/returned-records.test.ts`.

- `registros_devueltos` — ledger, append-only: every column `registros_facturacion` stores, with
  the same text representations for huella inputs, plus `operation_id`, `source_node_id`,
  `received_at`; primary key the original id; no foreign key to `sales`, `devices`, `nodes` or
  `registro_sif` (the column comments say so, and that the source box's archive holds those rows);
  a unique index equal to `registros_identidad_uq`'s columns. Each `_id` column (`sale_id`,
  `node_id`, `sif_id`, `operation_id`, `source_node_id` and the rest the copied columns bring) is
  a declared reference, a location column or left out of the export
  (`scripts/id-columns-are-references.test.ts`), and the column comment says which.
- `envios_devueltos` — ledger, mutable as `envios` is: `registro_id` (foreign key to
  `registros_devueltos`), the `envios` states, `intentos`, `proximo_intento_en`, the AEAT reply,
  `conflict` (json, nullable: both facts when finished states disagree).

- [ ] **Step 1: Write the failing tests.** "stores a returned record byte-for-byte" (every column
  equals the batch's); "a record already in `registros_facturacion` is never stored here"; "a
  returned row cannot be updated or deleted"; "the same id twice with other bytes is refused".
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/returned-records.test.ts` — FAIL.
- [ ] **Step 3: Implement**; generate.
- [ ] **Step 4: Run** it — PASS; then from the root every guard in Task 5.1's Step 4 and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: a separate store for tax records a returning box sends back"`.

#### Task 11.2: Apply stores the missing originals, checking their chain

**Files:** `applyReturn` (Task 10.6) stores `missingRecords` through `returned-records.ts`, and the
operation reaches `return_complete` only when every missing record is stored. Test
`packages/fiscal-verifactu/src/handover-return.originals.test.ts`.

- [ ] Failing tests: "the first returned record's predecessor huella equals the head M2 holds for
  that chain, and each next record's equals the one before"; "a break in that link stores the
  records and raises `handover.returned_chain_broken` as a recorded incident" (with its area claim
  and English and Spanish alert wording, `scripts/alert-codes.test.ts`); "an `enviando` original is
  stored `pendiente`"; "the operation moves from `return_pending` to `return_complete` once every
  missing record is stored". Implement; PASS.
  `git commit -s -m "fiscal-verifactu: returned originals are stored only after their chain link is checked"`.

#### Task 11.3: The drain's sending pieces, shared without changing the drain

**Files:** Modify `drain.ts` only to export the pieces the relay reuses — the transport call, the
reply parsing, the `envio_flujo` gate (`readGate`, `upsertFlujo`, `:416-481`), the technical
incident (`technicalIncidentToken`, `openTechnicalIncident`, `closeTechnicalIncident`,
`:1185-1237`) and `handleDuplicate` / `routeB` (`:1727-1903`) — behind a storage interface, with
the drain's own behaviour unchanged. Test: `src/drain.test.ts` passes **unedited**, and a new
`src/drain-pieces.test.ts` pins the exported signatures.

- [ ] **Step 1:** Write `drain-pieces.test.ts` (each piece callable through the storage interface
  with the drain's own storage); run it — FAIL.
- [ ] **Step 2:** Extract; run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain-pieces.test.ts src/drain.test.ts` — PASS, with `git diff origin/main -- packages/fiscal-verifactu/src/drain.test.ts` printing nothing.
- [ ] **Step 3: Commit** `git commit -s -m "fiscal-verifactu: share the drain's sending, wait and duplicate pieces, with the drain unchanged"`.

#### Task 11.4: Filing the returned originals, with one AEAT wait and one chain order

**Files:** Create `packages/fiscal-verifactu/src/relay-drain.ts`. Test
`packages/fiscal-verifactu/src/relay-drain.test.ts` (Review Focus 6).

Two rules from the drain that the relay must keep (review I7): **one wait** — the relay reads and
writes the same `envio_flujo` row as the drain (AEAT's wait time and the technical-incident
token, `drain.ts:416-481,1185-1237`), so the two never send closer together than AEAT allows, and
an incident one opens marks the other's cohort; **one chain order** — a returned record N+1 of a
chain never goes before record N of the same chain while N still waits in `envios` on M2 (N is in
M2's own copy, N+1 came back later).

- [ ] **Step 1: Write the failing tests** with a stand-in AEAT: "sends a returned record with its
  stored `SistemaInformatico`" (M1's `IdSistemaInformatico` and `NumeroInstalacion`); "in chain
  order per source chain"; "**holds record N+1 while record N of the same chain is still
  `pendiente` in `envios`**, and sends it after N is accepted"; "**respects the AEAT wait the drain
  last stored, and stores the wait AEAT gives it** for the drain to read"; "an incident the relay
  opens marks the drain's pending rows too"; "a 3000 duplicate is settled by consulta when the
  fingerprint and installation match, and kept waiting when the answer is missing"; "two different
  finished facts are kept in `conflict` and the record is not refiled"; "honours the paused set".
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/relay-drain.test.ts` — FAIL.
- [ ] **Step 3: Implement** on Task 11.3's pieces.
- [ ] **Step 4: Run** it — PASS; the golden and immutability suites unedited.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: file returned originals in their own identity, sharing the drain's AEAT wait and chain order"`.

#### Task 11.5: The relay runs only where the drain runs

**Files:** Wire the relay pass into the same `singletonPass` as the drain
(`apps/server/src/boot.ts:3205-3210`), after the drain in each pass, so it runs only on the box
holding the singleton role and is stopped by the same controller (Task 2.4's quiesce). Test
`apps/server/src/relay-drain.wiring.test.ts`.

- [ ] Failing tests: "never runs on a box without the singleton role"; "runs after the drain in the
  same pass"; "a stepdown's quiesce stops it". Implement; PASS.
  `git commit -s -m "server: the relay files only on the main box, in the drain's own pass"`.

#### Task 11.6: Box status shows the returned records

**Files:** `apps/server/src/box-status.ts` and `apps/dashboard/src/screens/box-status-rows.ts` (a
row "Invoices returned from {old box}: {n} waiting, {m} filed, {k} need checking"); strings and
guide (`box-status.md` `{#returned-invoices}`, both languages). Tests in their suites.

- [ ] Failing tests for the row in both languages; implement; PASS; guide suites.
  `git commit -s -m "box status: show the invoices returned from the old box and their filing"`.

#### Task 11.7: Harbour Kitchen's invoice 218 (simulation)

**Files:** Extend `apps/server/src/handover-emergency.e2e.test.ts` (Task 7.6).

- [ ] After M2's activation, M1 starts again restricted; M2's watch fetches the batch; assert:
  invoice 218 is in `registros_devueltos`, filed by M2 with **M1's** identity, after M1's record
  217 if 217 was still `pendiente` on M2; M1 made **no** AEAT request; a record M1 had already
  sent before failing (stand-in AEAT answers 3000, then consulta matches) ends `aceptado` with one
  submission counted; no `sales` row for 218 exists on M2; the operation reads `return_complete`.
  `git commit -s -m "server: invoice 218 returns, is filed in the old box's identity, and no sale is replayed"`.

#### Task 11.8: Final checks for Slice 11

- [ ] As Task 2.8. PR first line: "FISCAL — a returned-records store and a second filing path
  sharing the drain's AEAT wait and chain order; `registros_facturacion` untouched".

---

### Slice 12a — The reconciliation list, and lines beside the reports

Not fiscal: it reads fiscal facts through the seat, writes only the `handover` set's tables, and
leaves the frozen daily close and cash-up untouched, which a test pins. The same under either
answer to Q1.

#### Task 12a.1: Gap items from a return

**Files:** `apps/server/src/handover-return-apply.ts` writes, in the apply transaction, one
`handover_gap_items` row `{ kind: "returned_invoice" }` per stored original, with installation,
series and number, original ids, issue date and amounts taken from the record (gross
`importe_total`, tax `cuota_total`, taxable their difference, converted with `decimalToCents`),
and `evidence` naming the retained original (its `registros_devueltos` id), the batch that
carried it (its file and digest on M2) and the source box's archive (its operation id, Task 13.1)
— design §5: "It links the retained original and any available archived evidence". When the
receipt shows every chain matched, the operation's unknown interval gets an `interval_closed`
event. Test `apps/server/src/handover-gap-items.test.ts`.

- [ ] Failing tests: "invoice 218 gives one item: 23 October, 10000, 1000, 11000 cents, with its
  evidence"; "applying the batch again adds nothing"; "an interval stays open while any chain is
  unmatched". Implement; PASS.
  `git commit -s -m "server: each returned invoice becomes a reconciliation item with its known amounts and evidence"`.

#### Task 12a.2: The management API

**Files:** `apps/server/src/handover-gap-api.ts`: `GET /management-api/handover/gaps`
(`report.view`), `POST .../:id/acknowledge` and `POST .../:id/resolve`
`{ note, correctionReference? }` (both `node.promote`, decision 11). An acknowledgement is not a
resolution; a correction reference names an M2-owned record and never changes the item's
amounts. Test `apps/server/src/handover-gap-api.test.ts`.

- [ ] Failing tests per route and permission; "resolve without a note is refused naming `note`";
  implement; PASS. `git commit -s -m "server: list, acknowledge and resolve handover gaps"`.

#### Task 12a.3: The list screen

**Files:** `apps/dashboard/src/screens/handover-gaps-screen.ts` (under Reports), its strings,
`navigation.ts`, tests (`*.test.ts`, `*.a11y.test.ts`). Columns: date, old box, series and number,
taxable, tax, gross ("unknown" for an interval), status, responsible person, and a link to the
item's evidence.

- [ ] Failing tests (English and Spanish; axe both themes); implement; PASS.
  `git commit -s -m "dashboard: the handover reconciliation list"`.

#### Task 12a.4: Acknowledge and resolve

**Files:** the same screen's acknowledge action and resolve form, with `draftScopeFor` and a
`*.unsaved.test.ts` (CLAUDE.md §3).

- [ ] Failing tests (Forms contract; the unsaved-changes guard; English and Spanish); implement;
  PASS. `git commit -s -m "dashboard: acknowledge and resolve a handover gap"`.

#### Task 12a.5: Lines beside the daily close and the cash-up

**Files:** Create `packages/reporting/src/handover-gap-lines.ts` (`handoverGapLines(tx, day)`:
"Invoices returned from the old box" with counts and taxable, tax and gross for the day, and
"Unknown: the old box's records from {from} are missing" for a day an open interval covers), read
by the close and cash-up screens when they open. `daily-close.ts`, `cash-up.ts`, `close-types.ts`,
`record-daily-close.ts` and `daily-close-hash.ts` are **not** changed. Tests
`packages/reporting/src/handover-gap-lines.test.ts`, the two screens' suites.

- [ ] **Step 1: Write the failing tests.** "the day of invoice 218 shows €100.00 / €10.00 /
  €110.00 returned"; "a day inside an open interval says unknown"; **"the frozen close of a
  fixture day hashes the same before and after this change"** (a golden `entry_hash` for a seeded
  day, through `recordDailyClose`); "the cash-up's own totals are unchanged".
- [ ] **Step 2: Run** `pnpm --filter @waitron/reporting exec vitest run src/handover-gap-lines.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and the screens' suites — PASS; then `pnpm --filter @waitron/reporting exec vitest run src/daily-close-hash.test.ts src/record-daily-close.test.ts src/verify-daily-close-chain.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "reporting: show returned invoices and unknown intervals beside the day's close, never inside it"`.

#### Task 12a.6: The guide

- [ ] `servers.md` `{#reconciliation}` in both languages: what each line means, what
  acknowledgement and resolution do, why a returned invoice is beside the close and not in it.
  Guide suites as Task 6.5. `git commit -s -m "guide: the handover reconciliation list"`.

#### Task 12a.7: Final checks for Slice 12a

- [ ] As Task 6.6, plus `pnpm --filter @waitron/reporting exec vitest run`.

---

### Slice 12b — Returned invoices in the VAT return

**FISCAL** (it changes the VAT figure Waitron prepares). The owner lands it. Built on Q1's
answer (a) (owner, 2 November 2026), pending the venue's tax adviser.

#### Task 12b.1: The returned-invoices line

**Files:** `packages/reporting/src/vat-return.ts` (the output side adds the returned invoices of
the period, bucketed by their own *fecha de expedición*, as a separate line in `VatReturn`),
`modelo-303.ts` and `dr303.ts` (the line carried into the boxes they fill), `types.ts`. Tests in
`vat-return.test.ts`, `modelo-303.test.ts`, `dr303.test.ts`.

- [ ] Failing tests: "the quarter of invoice 218 shows €10.00 more output VAT, on its own line";
  "a returned invoice dated in another period is not counted here"; "a period with none is
  unchanged" (control: every existing case passes unedited). Implement; PASS; the golden and
  immutability suites unedited.
  `git commit -s -m "reporting: count invoices returned from the old box in the VAT return, on their own line (owner, Q1)"`.

#### Task 12b.2: Final checks for Slice 12b

- [ ] As Task 2.8, plus `pnpm --filter @waitron/reporting exec vitest run`. PR first line: FISCAL;
  "the VAT return counts returned invoices; owner answered Q1 on 2 November 2026; pending the venue's tax adviser".

---

### Slice 13 — Archive, the wipe gates, and becoming the spare

**FISCAL** (it gates the wipe of a box that holds tax records). The owner lands it. It runs for a
returning box after either scenario (decision 13).

#### Task 13.1: The returning box archives itself

**Files:** `apps/server/src/handover-archive.ts`: `archiveTo` into
`<state>/handover-archive/<operationId>/venue.db`, outside the venue folder a wipe empties; read
back; `PRAGMA integrity_check`; record counts per chain equal the live file's; recorded as an event.
Never streamed, never in a backup, never shipped (A947 §7.2). Test `handover-archive.test.ts`.

- [ ] Failing tests including "a damaged archive is not counted as verified"; implement; PASS.
  `git commit -s -m "server: a returning box keeps a verified archive of everything it held"`.

#### Task 13.2: The new box's signed health

**Files:** `POST /api/node/handover/health` on the main box (signed `health` envelope: accepting
sales, the term that fenced the source, last filing pass time, open filing cases, AEAT answered in
the last 15 minutes or nothing waiting, backup alerts per `apps/server/src/alert-sources.ts`), a
signed query from a box its chart lists. Test `handover-health-api.test.ts`.

- [ ] Failing tests per field; implement; PASS.
  `git commit -s -m "server: the main box vouches for its own health to a returning box"`.

#### Task 13.3: The gates

**Files:** `apps/server/src/handover-wipe-gates.ts`:
`judgeWipe(...)` → `{ pass: true } | { pass: false; failed: GateName[] }` over: every record's
receipt matches (huella exact; filing rows not behind); per-chain counts and heads equal; every
record has a filing row on M2; per chain, the sums of `importe_total` and `cuota_total` of the
transferred records equal; M2's health passes (five-minute and fifteen-minute bounds, starting
values); the archive is verified. After a controlled handover the receipt is the empty-records
batch's (Task 10.7), so the same gates apply. Shown on M1's restricted page (see "Slice 2 as built") and M2's Servers
screen; retried every minute. A manager may override the health gate only, after a fresh sign-in
on M1's page. Test `handover-wipe-gates.test.ts`.

- [ ] Failing tests: one per gate (each gate removed in turn lets a planted fault through — the
  proof by deletion, CLAUDE.md §4); "the override reaches the health gate and no other"; "a
  controlled M1 with an empty-records receipt passes when M2 is healthy". Implement; PASS.
  `git commit -s -m "server: a returning box wipes nothing until every gate passes"`.

#### Task 13.4: The rejoin command requires the gates, and finishes a wipe it began

**Files:** `apps/server/src/rejoin.ts` (`rejoinAsSecondary`, `:39-62`) and
`apps/server/src/rejoin-command.ts`. The chart the guards read is loaded by the command
(`readNodeMembership`, `rejoin-command.ts:111-118`), not by `rejoin.ts`, so `RejoinDeps` gains two
readers the command supplies from the box's `node.db`: `readHandover(): Promise<{ hasOperation: boolean; wipeStarted: boolean }>`
and `recordWipeStarted(gateResult): Promise<void>`. Rules:
- when this box's `node.db` holds a handover operation, `judgeWipe` (Task 13.3) must pass, then
  `recordWipeStarted` writes a `wipe_started` event, with the gate result, **before** anything is
  deleted;
- when `wipeStarted` is already true, the command skips the fence and gate checks and finishes the
  wipe. Why: the wipe removes `venue.db` before `node.db` (`DATABASE_FILES = [VENUE_FILE, NODE_FILE]`,
  `packages/store/src/index.ts:49`; removed in that order by `apps/server/src/db-wipe.ts:22-26`), so
  a crash between the two leaves `node.db`'s restriction with no `venue.db` — no held chart, so a
  re-run would be refused `rejoin.not_fenced` (`rejoin.ts:43-46`) and no gate could pass again.
The wipe keeps `<state>/handover-archive/`. It removes `node.db` too, so the restriction and the
operation rows go with it — the only way a restriction ends. No archive is deleted by any code
here: deletion waits for A664's retention policy, and while a reconciliation item or filing case
names one of its records it must not happen (design §5). Tests in `rejoin.test.ts` and
`rejoin-command.test.ts`.

- [ ] Failing tests: "refused while a gate fails"; "after a pass, `wipe_started` is recorded
  before the first deletion, and the box wipes and keeps its archive"; **"a crash after `venue.db`
  is removed and before `node.db` is: the next run of the command finishes the wipe"** (control:
  without the event, the re-run is refused `rejoin.not_fenced`); **"after the wipe and
  re-adoption, the box starts with no restriction and can later be a handover's destination"** (a
  fresh `node.db`, then Task 5.2's offer accepted); "no code path deletes an archive" (a text guard
  over `apps/server/src`, weaker than its name: it reads text). Implement; PASS.
  `git commit -s -m "server: a returning box's rejoin needs the gates, and a wipe it began is finished on a re-run"`.

#### Task 13.4b: The returning box wipes itself once the gates pass

A947 §7.2 has the returning box wipe itself and become the spare "with nobody touching it", and
the box's operator has no terminal to run a command. **Files:** `apps/server/src/handover-self-wipe.ts`;
`boot.ts`. When Task 13.3's minute check passes on the restricted start, it records `wipe_started`
(Task 13.4's reader and writer) and restarts. A start that finds `wipe_started` runs the same wipe
as the command (`wipeVenueDatabases` and the steps around it, `rejoin-command.ts:133-139`) **before
the store opens**, as a staged restore runs before it (`apps/server/src/restore-request.ts:344-642`),
then continues into setup mode, where the box re-adopts. The same start finishes a wipe a crash
interrupted. Guide: `servers.md` `{#old-box-becomes-spare}`, both languages, and the restricted
page's sentence that the box becomes the spare (`restricted-page.ts`, English and Spanish). Test
`apps/server/src/handover-self-wipe.test.ts`.

- [ ] Failing tests: "gates passing record `wipe_started` and restart"; "a start with
  `wipe_started` wipes before the store opens, keeps the archive and comes up in setup mode";
  "a start with `wipe_started` after a crash between the two removals finishes the wipe"; "no
  `wipe_started`, no wipe". Implement; PASS; guide suites as Task 6.5.
  `git commit -s -m "server: a returning box wipes itself and becomes a spare once every gate passes"`.

#### Task 13.5: "The old box will not return"

**Files:** `apps/server/src/handover-gap-api.ts` gains
`POST /management-api/handover/:operationId/source-not-returning` (`node.promote`, fresh sign-in,
a required note); the reconciliation screen offers it on an operation at `return_pending`. It
moves M2's operation to `return_abandoned` and leaves every open gap item open (decision 14).
Tests in `handover-gap-api.test.ts` and the screen's suite.

- [ ] Failing tests: "closes the operation and keeps the unknown interval open"; "a new handover
  can begin afterwards"; "refused without `node.promote`"; "a returning M1 after that is still
  restricted by M2's chart" (Task 3.4's `superseded`), with its return not built — the test's
  comment says so. Implement; PASS.
  `git commit -s -m "server: a manager can close a return that is never coming, keeping the gap open"`.

#### Task 13.6: Final checks for Slice 13

- [ ] As Task 2.8. PR first line: FISCAL.

---

### Slice 14 — A last copy from a selected backup

**FISCAL** (it places a copy a fiscal activation then uses). The owner lands it. For a spare
before A947 3c, and the groundwork A1188's part 0 needs.

#### Task 14.1: Place a backup as the spare's own copy

**Files:** `apps/server/src/handover-copy-from-backup.ts`, using the restore readers with the
spare's own identity kept (`skipSecrets`, `apps/server/src/restore.ts:403-404,417-419`) and its
`node.db` untouched, under the house rules for replacing `venue.db` (Global Constraints; add the
file to `REPLACES` in `scripts/backup-room-note.test.ts`). Refusals:
`handover.copy_predates_destination` when the backup's chart does not list this box (a box missing
from the chart could not be checked by a returning M1); the backup key missing →
`handover.backup_key_missing`. Test `handover-copy-from-backup.test.ts`.

- [ ] Failing tests including "the box keeps its own node id and signing key after placement" and
  "the backup-room note is gone before `venue.db` changes"; implement; PASS.
  `git commit -s -m "server: a spare can take a selected backup as its last copy, as itself"`.

#### Task 14.2: Choose the copy on the emergency page

**Files:** the preview (Task 7.2) lists both sources; the declaration's `lastCopy.source` is
`selected-backup` with the source id (`apps/server/src/recovery-source.ts:5-25`); the page (Task
8.1) offers the choice. Tests in their suites.

- [ ] Failing tests; implement; PASS.
  `git commit -s -m "setup: the emergency page offers a selected backup when the spare has no copy"`.

#### Task 14.3: Simulation

- [ ] Extend `handover-emergency.e2e.test.ts` with a spare that has no copy and takes M1's latest
  archive. `git commit -s -m "server: an emergency handover from a selected backup, end to end"`.

#### Task 14.4: Final checks for Slice 14

- [ ] As Task 2.8.

---

## What A1188 part 1 needs, and which slice delivers it

A1188 part 1 is "the box learns §1's facts; the Cloud services card" ([A1188 §11](../specs/2026-10-29-a1188-cloud-emergency-start-design.md#11-how-it-would-be-built)):
whether the emergency start is open, the emergency address and the hosted daily price, and a card
showing the code on request. **It needs no code from this plan.** What held it was A1018's build
approval, given 2026-11-01, and Cloud's half: the contract's billing section says "Emergency
hosting facts need a separate agreed read or a later version" (Cloud `main` at `1aae8f14c0`,
`docs/waitron-integration-contract.md:1928`, read 2026-11-02). So A1188 part 1 can start once
Cloud agrees that read, without waiting for any slice here; the "who can start it" line on its
card is A1188's own rule (password and authenticator code), not this plan's.

The later A1188 parts do use this plan:

| A1188 part | Needs from A1018 | Delivered by |
| --- | --- | --- |
| 0 (a copy under its own identity) | placing a copy without taking the old box's identity | Slice 14 (local); a Cloud copy's identity waits for the contract amendment A1188 §9 item 4 names |
| 3 (the locked start) | a start that serves nothing that sells | Slice 2's restricted start is the pattern; the locked start is A1188's own |
| 4 (declaration and activation) | the declaration format, its recording before activation, the activation | Slices 7 and 8 (the declaration's `provider` field stays null until the joint specification); A1188 §12's open wait is Q2 here, answered (a) on 2026-11-02: the next free minute |
| 6 (the returning box) | the start check and the supersession | Slice 3; asking Cloud is A1188's own addition |

Tell the watcher in the campaign's questions file when Slices 3, 7 and 14 land (the queue asks).

---

## Waiting for the joint specification with Cloud

Not built by this plan, and not invented here (contract, "Map the person and the retry",
`08a2a0d4` lines 1470–1495). Slice 0's Task 0.3 sends these to Cloud's lane G before any build
slice; no local slice waits for the answer.

- **The authentication bridge**: binding a Cloud account, venue and operation to the venue's
  `node.promote` holder, with its format, expiry, revocation and replay refusal.
- **The provider-resource stop**: the declaration's `provider` field is `null` for every local
  declaration; its content for a hosted M1 is the joint format.
- **A hosted M2 that is not in M1's chart**: a returning M1 cannot verify a chart signed by a key
  it never trusted (A1188 §12; backlog A1275). Slice 14 refuses such a copy locally.
- **Cloud's resource journal bound to the same operation and binding fingerprint** (contract
  `:1488-1490`), against formats that are local-only version 1 here.

---

## Owner task: physical qualification on real boxes

**For the owner, after A947 3b and 3c and Slices 0–14 have landed. Not done by any implementer;
no simulation above counts as it.** On two real boxes on one switch, with the internet unplugged
throughout and every clock read at the start and the end:

1. Controlled: hand over mid-service from the Servers screen, with a card payment held open at the
   reader during the stepdown; switch on the spare's page; pull M1's power during the capture
   once, and during the activation once; watch M1 return its empty batch, pass the gates and
   rejoin.
2. Emergency: pull M1's plug mid-sale after a cash sale the spare has not copied; declare on the
   spare from a phone; sell; power M1 back; watch it restrict itself, return its invoice, pass the
   gates and rejoin.
3. The split: unplug M1's network cable instead of its power, declare, and watch M1 stop when a
   till brings it the newer chart.
4. Measure: the 180-second admitted-work limit, the five- and fifteen-minute health bounds, the
   copy's size and transfer time.

The other six placements (local-to-Cloud, Cloud-to-Cloud, Cloud-to-local, each both ways) wait for
the joint specification and Cloud's half.

---

## Still unsettled

- **Q1** answered (a); Slice 12b pending the venue's tax adviser.
- **Passkeys on the spare's page** wait for A947 4b/4d (decision 9).
- **The last-activity time** of a mirror's copy is a proxy until A947 3c's follower reports its
  position (Task 7.2).
- **Whether `vf-recovery-hour` can drive a promotion** is found in Task 6.4; if not, that task
  touches fiscal UI code.
- **Whether M2 sees every minute name M1 used from the copy alone** is found by Task 4.5's probe;
  if not, the history file travels as the restore path already places it.
- **What M2's certificate card shows after activation** is found by Task 5.10; if it shows no
  certificate, a FISCAL follow-up maps it.
- **A return to a box other than the one the old box handed to** (M2 handed over to M3 before M1
  came back) is not built; Task 13.5 leaves M1 restricted and its records in its archive.
- **Archive deletion** waits for A664's retention policy; nothing here deletes one.
- **Whether S2's verdict is read off Parts F and G alone** (Slice 9 as built); until answered,
  Slices 10 and 11 are not built.

---

## Review round 1: what changed

A fresh-context review of draft `4f62994710` (`/Users/clintongormley/waitron-campaign/a1018/review-1.md`).
Each finding was checked against the code on `61bfdfe405` before acting; the check is named.

| Finding | Checked by | What changed |
| --- | --- | --- |
| C1 stepdown refuses admitted card sales and stops nothing in the background | read `till-sale.ts:1625,1774,2184` (admission re-checked in the second transaction), `boot.ts:3205-3206`, `clock-watch.ts:281`, `boot.ts:505-512` | Applied. Decisions 2 and 3 rewritten; new Task 2.3 (handover gate, own code `handover.stepping_down`, self-exclusion, event streams uncounted); Task 2.4 quiesces the named duties at once and never touches the admission or the role; new Task 2.5 uses the real card route and drain loop, with the review's probe as its control; Task 3.3 uses the same sequence for a superseding chart |
| C2 Slice 3 reachable today; a main box would wait at every start | read `mirror-bundle-api.ts:207`, `standings.ts:30-38`; `git grep "insert(nodes)"` (no writer of another box's row) | Applied: the rule counts only peers that finished joining (a `nodes` row, which only A947 3b writes; decision 5); the review's regression test and a real-start test in Task 3.4; the gate exemptions in Task 3.2; the false "nothing reachable" sentence replaced with three traced reasons |
| I1 every new POST on M2 refused by the read-only gate | read `read-only-gate.ts:32-37`, `boot.ts:1707-1715` | Applied: new Task 3.2, one list of exempt routes with how each authenticates, a test that the list is exact, rows added by Slices 5 and 7 |
| I2 controlled activation records a false "offline" fact | read `hour-recovery-preparation.ts:91,113-114`, `allocation-envelope.ts:195-210`, `classification.ts:10` (append-only) | Applied: new Slice 5a (FISCAL — LOUD) adds the relinquished fact and updates the exact-key readers and every builder found by grep. (Round 2 corrected "four readers": there are six, plus a seventh builder and the module contract.) |
| I3 the emergency wait needs fiscal code | read `hour-selection.ts:461`; CLAUDE.md §5 | Applied as owner question Q2, recommending the next free minute (A947 §6.5 already chose it for a switch); Task 7.4b exists only for the other answer; Task 7.4's "stop and report" removed |
| I4 returned invoices left out of modelo 303; Q1 not a genuine choice | read `vat-return.ts:11-38`; design §5 | Applied: old Q1 dropped with its reason; new Q1 asks the 303 question; Slice 12 split into 12a (not fiscal) and 12b (FISCAL, gated by Q1) |
| I5 handover records never end; a controlled M1 has no path to spare | read `db-wipe.ts:20-28`, `packages/store/src/index.ts:49` | Applied in part. The claim that a rejoined box restarts restricted forever does not hold: the rejoin wipe already deletes `node.db`; the plan now says so and Task 13.4 tests it. The rest holds: states `return_abandoned` and `replaced` added (the draft's crash replacement had no closed state either), a controlled M1 returns an empty batch through the same exchange (decision 13), Task 13.5 closes a return that never comes |
| I6 `venue.db`'s `local` tables missing from the inventory | read `packages/db/src/classification.ts:257-276`, `fiscal-verifactu/src/classification.ts:20-29` | Applied, plus `tenant_credentials` (`credentials/src/classification.ts:12`), which the review missed, and a correction: `module-preparation-state.json` holds minute selections, not rebuildable data (Task 4.5's probe). The completeness test is a root guard over every `local` table and module state source |
| I7 the second filing path ignores the AEAT wait and chain order | read `drain.ts:416-481,1185-1237` | Applied: Task 11.3 shares the wait and incident pieces with the drain unchanged; Task 11.4 tests both rules |
| I8 A764 payment ownership not addressed | read `docs/backlog/payments.md:476-479`, `payments.ts:57-58` | Applied: new Slice 4b (one collection owner per payment, through the unwritten `node_id`), Task 5.9 hands the old box's payments to the new one (decision 12) |
| I9 indicator misses open requests | read `payments.ts:20-40`, `tender-refunds.ts:23,88-98` | Applied: Task 4.4 lists `initiated`, `accepted_offline` and pending card refunds |
| I10 emergency preview never checks the chains | read `verify.ts:41-60`, `chain.ts:112-130`, `backup-verification-chain.ts:52-155` | Applied with a different tool: `verifyChain` checks only two records and can insert, so new Task 4.3 exports the read-only whole-chain `walk`; Tasks 5.5, 7.2 and 7.3 use it |
| I11 replacing `venue.db` omits house rules | read `scripts/backup-room-note.test.ts`, `restore.ts:590,651`, `client.ts:98` | Applied: a Global Constraint, and Tasks 5.7 and 14.1 test the note, the lock and Litestream's folder |
| I12 tasks too big | — | Applied: 3.6 split into 3.7–3.8 (run the 19 files directly, not the package coverage run); 5.5 into 5.7–5.8; 6.2 into 6.2–6.4; 10.4 into 10.5–10.6; 11.3 into 11.3–11.5; 12.3 into 12a.3–12a.4 |
| Minor: "Slices 0–10 and 12–14 the same under either answer" | — | Moot: that Q1 is dropped; the slice table now has a "Gated by" column |
| Minor: formats "settled"; Cloud notice after Slice 7 | fetched the contract at `08a2a0d4` (hash `157556c3…6d02`), read `:1387`, `:1488-1490` | Applied: "local-only, version 1"; Task 0.3 sends the notice before Slice 1 |
| Minor: passkey citation | read `passkey.ts:181,263` | Applied: the sign-in challenge write is `:263-265` |
| Minor: suite count 19, not 18 | ran the review's `git grep` (19) | Applied |
| Minor: the node probe drops `term` | read `node-api.ts:45-47` | Applied: restricted and waiting starts answer `term`; the till also posts to a server that answers none (Task 3.6) |
| Minor: unlisted builder choices | — | Applied: decisions 10 and 11 |
| Minor: return batch drops `envio_flujo` | read A947 §7.1 | Applied: carried, with a never-earlier rule (decision 8, Task 10.6) |
| Minor: Slice 14 depends on Slice 8 | read Task 14.2 | Applied in the slice table |
| Minor: Slice 10 must stay `return_pending` while originals are unstored | — | Applied: Slice 10's preamble, Tasks 10.6 and 11.2 |
| Minor: Task 11.1's manifest entry and `_id` columns | — | Applied |
| Minor: controlled handovers get no audit row | — | Applied: `handover_activations` in Task 5.1, for both scenarios |
| Minor: reconciliation list lacks evidence links | design §5 | Applied: `evidence` column (Task 7.1), filled in Task 12a.1, linked in 12a.3 |
| Minor: a mirror listens on loopback only | read `boot.ts:1691-1695` | Applied: fact 4 in "Before you build" |
| Minor: daily close is hash-chained; Slice 12 "not fiscal" doubtful | read `daily-close-hash.ts:71-95`, `db/src/classification.ts:38` | Applied: returned invoices are shown beside the close, never inside it, with a golden-hash test (Task 12a.5); Q1 says so |
| Fiscal guardrails | — | Slices 5a, 12b and Task 7.4b marked FISCAL; every slice keeps the golden huella and immutability suites unedited |

---

## Review round 2: what changed

A narrow check of revision `9195c19a81` (`/Users/clintongormley/waitron-campaign/a1018/review-2.md`).
Each finding was checked against the code on `61bfdfe405` before acting; the check is named.
None was rejected. The owner questions are unchanged; the slice table changes only in Slice 5a
(three tasks to four, and its title names the contract it crosses).

| Finding | Checked by | What changed |
| --- | --- | --- |
| 1 (Critical) M2 waits at every restart after a handover | read `fence.ts:44,57` (`sell-only` is routable), `standings.ts:15` (promotion leaves M1 `sell-only`), `venue-apply.ts:359` (M1's own `nodes` row travels in the copy) | Applied. Decision 5 and Task 3.4: a box never counts the source of an operation it activated as destination; the open-operation rule applies only to a source or a destination before `activated`; a source left at `prepared` is closed at start. Task 3.5's refusal uses the same rule. Tests: Task 3.4's restart cases, and "M2 restarts with M1 off and sells" in Tasks 5.10 and 7.6 |
| 2 The source cannot close a failed or replaced operation | read the plan's own states table and Tasks 5.3, 7.3, 10.3 against the one-open index (Task 1.4) | Applied. New closed state `abandoned` (both roles, only from `prepared`, never once the source stepped down); `replaced` added for a source at `source_stepped_down`. Task 5.3 abandons on a failed offer; Task 3.4 abandons a source left at `prepared`; Task 5.4 closes M2's side when M1's signed status shows it never stepped down; Task 10.3 moves X to `replaced` and begins Y in one node transaction. Tasks 1.3 and 1.4 updated |
| 3 The stepdown loses its own answer | read `close-listener.ts:28,44` (500 ms grace, then every connection closed) and `boot.ts:3089-3091` (promotion answers, then signals itself next tick) | Applied. Decision 2 and Task 2.4: inside the request only the restriction and the gate; the quiesce, the wait, the close and the restart run after the answer. Task 2.4 tests that the caller receives its body, with the in-request version as the control; Tasks 2.5, 3.3 and 5.3 assert or rely on it |
| 4 Slice 5a's "four readers" is false; the fact needs the module contract; old shapes must stay readable | read `cloud-evidence.ts:271-290`, `conflict-recovery-contract.ts:74-110`, `custodian/custody-state.ts:93,613`, `packages/module/src/operation-preparation.ts:15-26,125`, `apps/server/src/node-operation-preparation.ts:64,115-121,190-210`, `docs/backlog/fiscal.md:1078-1081`, `allocation-envelope.ts:46-62` | Applied. Slice 5a rewritten as four tasks and marked as crossing a package contract. The fact travels through the generic module contract (Task 5a.1). The approval gains a **version 2** written only by a promotion; version 1 is unchanged and stays readable wherever it is read today, because old Cloud receipts and every other builder keep producing it. Six readers listed with what each accepts. One correction to the review's direction: allocation validation cannot tell a promotion from a recovery today (`mode` is only `"initial-setup" \| "recovery"`), so the context carries the fact and the approval must match it |
| 5 Task 2.4's duty list does not match its sentence | read `boot.ts:2043-2075` (both attendance loops on one controller), `:2602` (box emails), `:2128`, `:3167`, `:3387`, `:3400-3437` | Applied. Decision 3 and Task 2.4 now name the duties, adding attendance, box emails, menu activation, the demo printer and the Cloud suggestion loop; the members left to the close are named, and the test requires every `stopWork` member to be either stopped or given a reason |
| Minor: the card sweep's read is inside the adapters | read `payments-stripe/src/provider.ts:256`, `payments-sumup/src/provider.ts:315`, `packages/payments/src/store.ts:507`, `provider.ts:250` | Applied. Task 4b.2 threads the owners through `PaymentProvider.resolvePending` and `listAttempting`; the adapters' suites and typechecks join Slice 4b |
| Minor: `payments.node_id` has a foreign key to `nodes` | read `payments.ts:106-110` | Applied. Task 4b.1 names the fixture growth |
| Minor: Task 3.7 understated how many suites change | read `till-reroute-e2e.test.ts:154` (seeds both boxes' rows) | Applied. Task 3.7 now expects several |
| Fiscal marks | — | Unchanged except Slice 5a's row, which now names the contract change. Every slice still runs the golden huella and `inmutabilidad` suites unedited |

---

## Review round 3: what changed

A narrow check of revision `fc045dc3d3` (`/Users/clintongormley/waitron-campaign/a1018/review-3.md`).
Each finding was checked on `61bfdfe405` before acting; none was rejected. Because rounds 2 and 3
each found a new stuck-box case, the whole class was swept: the new "Crash windows" table under
Formats lists every step that writes both databases or crosses a network answer, what a restart
at each point does, and the test. The sweep found three cases the review did not name (rows
"M2 accepts", "M2 places the copy", "Rejoin wipe"). The owner questions are unchanged; the slice
table changes only in Slice 5 (11 tasks to 12, adding Task 5.8b).

| Finding | Checked by | What changed |
| --- | --- | --- |
| C1 (Critical) M2 stuck if it restarts between the activation's two writes | read `promoted-role.ts:39-62` (primary from its own signed chart), `boot.ts:1590` (runs first at every start), `boot.ts:1600` (today's peer reconcile skips mirrors), `promote.ts:268-301` (venue transaction, then role) | Applied. Task 3.4: an open operation blocks a start only where the box is the source; the check runs only on a box not in mirror mode; a repair hook runs first. New Task 5.8b fills the hook: a destination before `activated` whose own chart names it primary, or whose `handover_activations` row exists, gets its missing venue rows and `activated`, and its source joins `activatedFrom`. Task 3.5's refusal follows. Test: "M2 killed between the activation's `venue.db` commit and its `node.db` record restarts and sells". This supersedes round 2's "or the destination before `activated`" |
| C2 (Critical) M2's abandon races M1's stepdown | read Task 5.3's order (M2 answers the offer before M1's stepdown starts) and Task 3.1's status (open operation only) | Applied. Task 3.1's status gains `requestedOperation`, open or closed. Task 5.4: M2 abandons only when M1 reports `abandoned`, never on `prepared`. Test where M2's read lands between M1's `prepared` and its stepdown, with round 2's rule as the control |
| I1 the relinquished fact never reaches a promotion | read `promote-api.ts:116-125` → `withPromotion` (`node-operation-preparation.ts:259-280`) → `invoke` (`:137-185`, scope with no isolation `:159-160`) → `readRecoveryFacts` (`:104-131`, offline defaults true `:119`); `assertLive` (`:69-77`, called `:91`) | Applied. Task 5a.1 rewritten: the promotion's held context gains `oldMachineRelinquished`, stored in a new scope field, not `isolation`, so `assertLive` is never reached; the module contract change is only `ModuleRecoveryFacts`; the live-recovery `run` is unchanged (the plan had mislabelled `:190-210`, which is `withLiveRecovery`). The hand-built fact sites are listed (`recovery-preparation.ts:73-76,183-187,366-370`, `first-setup-backup-recovery.ts:697-702`, `recovery-entry.ts:73-77`). Tasks 5.8 and 7.4 promote through `withPromotion`. Test on a mirror, with "pass it as isolation" as the control |
| I2 stopping duties after the answer lets a pass start | read `loop.ts:54-56` (signal checked before each pass), `:84` (the sleep takes the signal) | Applied. Task 2.4 signals every named duty inside the request right after closing the gate, and only waits after the answer. Test: "no named duty starts a new pass after the restriction is written", with signalling after the answer as the control |
| M1 statement order for "close X, begin Y" | probe outside the repo on Node's SQLite with the partial unique index: insert-first printed `UNIQUE constraint failed: ops.node_id`; update-first succeeded | Applied in Formats, Task 7.3 and Task 10.3, with the order asserted in 10.3's test |
| M2 `stopWork` is unnamed, so a "list equals stopWork" test compares nothing | read `boot.ts:3400-3437` | Applied. Task 2.4 moves the stops into a named `backgroundDuties` table that both the close and the stepdown use; the test is a runtime check on that table |
| M3 a stepdown that throws after a successful offer leaves `prepared` open | read Task 5.3 | Applied: recorded as `abandoned` on that path too, with a test |
| M4 "version 1 keeps arriving from old Cloud receipts" overstates the source | read `docs/backlog/fiscal.md:1078-1081` | Applied: old receipts are still read until their retirement; no new ones arrive; version 1 keeps being written by every other builder |
| Sweep: M2 accepting, then restarting before the acceptance reached M1 | read Task 5.5 (posted once, from the request path) | Added: a posting duty that re-posts while at `copy_accepted`, and its test |
| Sweep: placement's swap and event are two steps | read Task 5.7, whose test also said `node.db` was unchanged while the task records an event in it | Added: placement copies and keeps `accepted.db`, and decides "already placed" by digest; two crash tests; the contradictory test wording fixed |
| Sweep: the rejoin wipe removes `venue.db` before `node.db` | read `packages/store/src/index.ts:47-49`, `db-wipe.ts:22-26`, `rejoin.ts:43-46` | Added: a `wipe_started` event before any deletion, so a crash between the two removals is finished by the next run instead of being refused `rejoin.not_fenced` |
| Sweep: capture, chart hand-off, return apply | read Tasks 4.7, 5.10, 10.4, 10.6 | Added: a capture crash test (4.7), the chart re-posted by the return watch (10.4), and an apply crash test (10.6) |
| Fiscal marks | — | Unchanged. Slice 5a's row now names `ModuleRecoveryFacts` and the server's promotion path as the contract it crosses. Every slice still runs the golden huella and `inmutabilidad` suites unedited |

---

## Review round 4: what changed

A narrow check of revision `94cdf74195` (`/Users/clintongormley/waitron-campaign/a1018/review-4.md`).
Each finding was checked on `61bfdfe405` before acting; none was rejected. Owner questions are
unchanged. Slice table: Slice 2 from 8 to 11 tasks (2.3b, 2.4b, 2.4c), Slice 5a from 4 to 5
(5a.1b), Slice 5 from 12 to 13 (5.2b), Slice 13 from 6 to 7 (13.4b); Slice 2 now changes the drain
(it was already FISCAL). Task sizes were re-checked after the additions: the stop-signal work was
split into 2.4b (drain and pass, FISCAL) and 2.4c (payments and refunds), and the self-wipe into
13.4b.

| Finding | Checked by | What changed |
| --- | --- | --- |
| I1 the start repair can record `activated` for a handover that never activated | read `node-operation-preparation.ts:269-277` (the runner commits `consume` in one transaction) and `promote.ts:286-296` (it hands that runner its `run`); Task 3.2's table (`/management-api/promote` open on a mirror) | Applied. Task 5.8 writes the `handover_activations` row inside the promotion's own transaction, right after `consume` — mandatory. Task 5.8b acts only at `filing_assumed` or `emergency_declared` and only on that row, never on the chart alone, and writes nothing to `venue.db`. New Task 5.2b refuses an ordinary promotion while a destination operation is open. Tests: "a box whose own chart names it primary but holds no row is not recorded as activated"; "the row commits with the chart, or neither does" |
| I2 any `node.promote` caller can store a "relinquished" approval; prepare and promote must share the context | read `promote-api.ts:93` and `:119-122` (the body is passed as the context), `hour-recovery-preparation.ts:197` (`event_mismatch` when the rebuilt input differs) | Applied. New Task 5a.1b: both routes build the context from exactly `oldNodeNeutralised` and `noParallelRecovery`; a test sends the field in the body and gets a version 1 approval. Task 5.8 passes the same context to `prepare` and `withPromotion`, with a test whose control is refused `event_mismatch` |
| I3 the signal stops new passes, not the rest of a running one | read `loop.ts:54-56,80`, `pass.ts:78-125`, `drain.ts:256,343`, `boot.ts:520-531`, `tender-refund-recovery.ts:142` | Applied. New Task 2.4b (FISCAL): the drain checks the signal before each batch, and the pass skips the reconcile once signalled; `drain.test.ts`, the golden and immutability suites unedited. New Task 2.4c: the card sweep's adapters and refund recovery check it before each item. Decision 3 updated. Task 2.5 now has more than one batch due and Stripe configured, holds the first batch's answer, and asserts no second submission and no reconcile |
| I4 the duty table changed the normal shutdown order | read `boot.ts:3400-3437` (seven aborts, then a fixed sequence, Litestream last, `:3434-3435`) | Applied. New Task 2.3b is a pure refactor keeping today's order exactly, proven by `boot.test.ts`, `boot.promote.test.ts` and `boot.mirror.test.ts` passing unedited. Task 2.4 signals inside the request only what takes effect at once (aborts, and stops whose first effect precedes their first `await` — the clock watch's does, `clock-watch.ts:461-462`; the rest are read and given a flag where needed), and awaits after the answer in table order, Litestream last. The tunnel moved to the close (it only carries requests, which the gate refuses) |
| Outside item: a box the new main box took over from is never asked again | read `adopt.ts:105` and `reserved-identity.ts:37-40` (re-adoption always takes a fresh `randomUUID()` id), `rejoin-command.ts:138` (the wipe clears `trading.env`), `state-secrets.ts:16-23` (a cold restore brings `trading.env`, and the node id in it, back) | Applied. A same-id return is possible, through a cold restore of the old box's backup, though not through re-adoption. So the rule is no longer "never counted": the old box is still **asked** at every start, and a newer chart from it still supersedes this box, but its silence never makes this box wait (decision 5, Task 3.4, with two tests) |
| M1 test files typing `ModuleRecoveryFacts` will not compile | read `hosted-hour-recovery.test.ts:56`, `minute-selection-unknown-name.test.ts:217`, `allocation-configuration.test.ts:236` | Applied: Task 5a.1 names them and adds the `@waitron/fiscal-verifactu` and `@waitron/composition` typechecks |
| M2 Task 13.4 named only `rejoin.ts`; "a start finishes the wipe" named no code | read `rejoin-command.ts:111-118` (the chart is read there) | Applied. Task 13.4 adds two `RejoinDeps` readers the command supplies. New Task 13.4b gives the start its code and tests: the restricted start records `wipe_started` and restarts, and a start that finds it wipes before the store opens. Also answers A947 §7.2's "with nobody touching it", which no task had built |
| M3 a later throw in the stepdown | read Task 2.4 | Applied: the restart is scheduled in a `finally` for any throw after the node transaction, with a test |
| M4 the idempotent apply test lacked a conflict and a missing record | read `filing-cases.ts:55-59` | Applied in Task 10.6 |
| M5 the crash table did not show a controlled handover stuck at `copy_accepted` | design §7 | Applied: a row saying M2 waits on M1 by design, with the test that refuses an emergency replacement from `copy_accepted` |
| M6 two line citations pointed at comments | `grep -n` on `boot.ts` (`:1590` is the call, `:1600` the mirror check) | Applied in Task 3.4 and in the round-3 table |
| Fiscal marks | — | Slice 2's row now names the drain change. Every slice still runs the golden huella and `inmutabilidad` suites unedited, and `drain.test.ts` stays unedited in Tasks 2.4b, 10.5 and 11.3 |

---

## Review round 5: what changed

A tight check of revision `264d525a7d` (`/Users/clintongormley/waitron-campaign/a1018/review-5.md`).
Each finding was checked on `61bfdfe405` before acting; none was rejected. Owner questions are
unchanged. Slice table: Slice 5 from 13 to 14 tasks (Task 5.7b); no FISCAL or migration mark
changes.

| Finding | Checked by | What changed |
| --- | --- | --- |
| 2 (Critical) Task 5.2b blocks both handover activations | read `hour-setup-clock.ts:106-107` (the box is refused as its own second clock), `conflict-recovery-contract.ts:14-15` (the browser's clock steps), `node-operation-preparation.ts:227-241` (`prepare`), and `git grep "nodePreparation.prepare"` (one caller, `promote-api.ts:93`) | Applied, by the route the coordinator preferred. New Task 5.7b: `POST /api/node/handover/:operationId/preparation`, a row in Task 3.2's exemption table, open only at `filing_assumed` or `emergency_declared`, with its context built from the operation's own record by one function (`handoverPromotionContext`) that Tasks 5.8 and 7.4 also use for `withPromotion` — so prepare and promote always agree. Checked against Task 5a.1b (the existing routes still cannot set the fact: this route never reads it from the body), Task 5.2b (it still refuses only the ordinary routes), and Slice 14 (its activation is Task 7.4's, so it uses the same route). Tasks 6.4 and 8.1 send the browser's clock steps there; the emergency page now records the declaration before it compares clocks, because the route needs `emergency_declared` |
| 4 Task 2.3b did not keep today's shutdown order | read `boot.ts:3400-3437` and `close-all.ts:5-15` | Applied. Task 2.3b now copies today's seven aborts and the whole `closeAll` list verbatim, keeps the waits for the aborted loops in their own places (`() => loop` before `backupSupervisor.stop()`, Litestream last) and keeps `closeAll`'s carry-on-past-failure rule; its test holds the list as written. Task 2.4 signals only the aborts and five immediate-effect stops inside the request; backups, Litestream and the tunnel stop in their place in the normal close, which then runs unchanged |
| 4 (smaller) Litestream's stop started inside the request | the same reading | Applied by the same change: Litestream is never stopped before the close, so it never stops while the sending loop may still store an answer |
| 5 the start-check rules contradicted their tests | read the rules against each Task 3.4 test; `rebuild-first-start.ts:120-139` (a restore writes a new term and rewrites only its own address) and `fence.ts:20-24` | Applied. Task 3.4 now states the rule as one decision table (counted or asked-only peer × F, N, =, S) and five combination rules in order; an M2 whose only peer is its old M1 proceeds whether M1 is silent or answers older (rule 3); a newer chart that does not fence this box is held, and counts as an answer only from a counted peer. Every Task 3.4 test was checked against the table — one, "a source left at `prepared`… proceeds", needed its peer's answer stated — and a test was added per cell. The crash-table rows that rely on the start check now name the rule they use; the M1-at-`prepared` row no longer says "sells" unconditionally |
| Drain point: exit with `return` before the first send | read `drain.ts:385-386` (`upsertFlujo` after the loop) | Applied in Task 2.4b, with a test whose control (`break`) moves AEAT's stored next send time later |

---

## Review round 6: what changed

A tight check of revision `c3250b64ea` (`/Users/clintongormley/waitron-campaign/a1018/review-6.md`),
the last before the plan lands. Each finding was checked on `61bfdfe405` before acting; none was
rejected. Owner questions and the slice table are unchanged. A "For per-slice reviewers" note now
sits at the top of the plan.

| Finding | Checked by | What changed |
| --- | --- | --- |
| Smaller: the HTTPS and same-origin check | read `node-operation-https.ts` (TLS socket, same origin), `promote-api.ts:71,118` (both promote routes call it; the review's `:89` is off by a few lines, the point holds) | Applied to Tasks 5.7b, 5.8 and 7.3, each with a refusal test |
| Smaller: an email never becomes a person, so every sign-in on the new routes is refused | read `operation-authentication.ts:102-113` (takes only a `personId`, hashes once itself), `manager-login.ts:37` (`findPersonLogin` is private), `:56-65` and `:86-96` (unknown accounts hash a dummy) | Applied under CLAUDE.md §3's login-refusal rule. Task 5.7b adds `personIdForLoginEmail`, which does no hashing and answers a fresh random id for an unknown email, so `withAuthenticatedOperation`'s one hash happens either way; Tasks 5.7b and 5.8 use it, with a test that an unknown email and a wrong password get the same answer after one hash each. Task 7.3 signs in with `loginManager` by email, which already does the dummy hash |
| Smaller: Task 5.7b added to a file Task 5.8 creates | read the plan's order | Applied: Task 5.7b creates `handover-preparation.ts`; Task 5.8's `handover-activation.ts` imports from it |
| 2 a declaration recorded before a failed clock check had no way back | read the states table, Task 8.1 and Task 1.4's one-open index | Applied as suggested: the preview reports `openEmergency`, and the page resumes an open `emergency_declared` operation from any device, straight to the sign-in and clock check; a new crash-table row and a test whose control shows the blank form refused |
| 3 rule F counted a controlled operation still at `prepared` | read Task 3.1's status (no source field) against the M1-restarts-before-stepdown crash row | Applied. Task 3.1's status gains `sourceNodeId` and `destinationNodeId`; F counts an operation naming this box as source only at `emergency_declared` or later, or controlled at `copy_accepted` or later; tests for the `prepared` case (proceeds) and its control (`copy_accepted` supersedes) |
| 5 decision 3 and Task 2.4 would stop backups and Litestream early | read the five early stops (`fiscal-certificate-diagnosis-runner.ts:324-325`, `menu-activation.ts:87-88`, `box-alert-email.ts:456-457`, `demo-printer.ts:227-228`, `clock-watch.ts:461-462`: each sets `stopped` before its first `await`) and design §2 step 2 (`2026-10-23-a1018-simple-handover-design.md:148`) | Applied. Decision 3 and Task 2.4's last sentence exempt backups and Litestream, citing design §2 step 2: they stop before the final snapshot, which is taken after the restart, in their own place in the normal close. Task 2.4 now cites all five early stops instead of asking the implementer to check four |


---

## Review round 7: what changed

A fresh-context review of Slice 5a's tasks alone, on base `c336372fae`
(`/Users/clintongormley/waitron-campaign/a1018/s5a-review-1.md`). Its reviewer ran a typecheck
of the new required field and the version 1 or 2 type in a copy, a validator probe case, and the
plan's mutation command; the rest is reading. The controller ruled to fold all fifteen findings.
Every line cited in the rewritten slice was reopened on `c336372fae` before it was written. Owner
questions are unchanged. Slice table: Slice 5a from 5 to 6 tasks (the final checks are now 5a.5);
no FISCAL or migration mark changes. Slice 5a's row in the fiscal boundary table now says version 2
is written only when the old box relinquished filing, and that allocation validation and the
activation context gain the fact.

| Finding | Checked by | What changed |
| --- | --- | --- |
| 1 (Critical) the builder cannot pass before the validator knows version 2 | read `allocation-envelope.ts:192-215` (`approvalShape`, version 1 only) and its two calls, `:296` and `:370` | Applied. New order: 5a.2 is allocation validation, 5a.3 the builder, 5a.4 backup verification and the guards |
| 2 (Critical) Tasks 5a.1b and 5a.2 disagreed about what a promotion stores | read the old 5a.2 tests against 5a.1b's | Applied. Version 2 is built only when `oldMachineRelinquished` is true; every other promotion stores version 1 byte for byte. The old "emergency promotion stores version 2" test is replaced by the guard "a promotion without the fact stores version 1 exactly as today". Task 7.4's "the stored approval says offline, not relinquished" is met by version 1 (version 1 means not relinquished), so Task 7.4 is unchanged |
| 3 the validator as worded let a non-promotion path store version 2 | read `emergency-preparation.ts:228-240,250`, `paper-recovery-export.ts:86`, `allocation.ts:84-90`, `cloud-evidence.ts:373-376` | Applied. Version 2 is accepted only when `context.oldMachineRelinquished === true`, and refused `malformed_approval` elsewhere, as today; version 1 is refused `event_mismatch` in a relinquished context. Only the hour promotion's admission facts set the field. Guards: an emergency preparation and a paper standby promotion given version 2 are refused |
| 4 the activation-time check and a retry after commit judge their own context | read `allocation-operation.ts:84-90` (the evidence), `:153-171` (its snapshot spreads it), `:240-254` (the context), `allocation-envelope.ts:306-312` (the evidence is built there; the review's `:302-308` is a few lines off) and `allocation.ts:386-397` | Applied in Task 5a.2: `HourAdmissionFacts` (`allocation-envelope.ts:234-237`; the review said `:233-236`) and the evidence gain the field, and the activation context copies it. Test "a committed controlled activation, retried, is accepted", with dropping the copy as its control |
| 5 three calls build the approval, and `select` has no facts | read `hour-recovery-preparation.ts:111,135,166,197` and `hour-selection.ts:237-239`, `hosted-hour-recovery.ts:50-57` | Applied in Task 5a.3: `createPreparation` takes `promotion: boolean`; `select` reads the fact through `readContext` (falling back to `read`, as `within` does at `:146-148`); `prepare` passes the facts' value; `checked` admits relinquished only for a promotion; the admission facts carry it to Task 5a.2's validator |
| 6 Task 5a.1's site list was incomplete | read each cited line; the review's typecheck named the sites | Applied. The `Isolation` `Pick` (`recovery-preparation.ts:73-76`) is not extended; `false` is set only in the source objects at `recovery-preparation.ts:183-187` and `first-setup-backup-recovery.ts:697-702` (plus the scope-driven one in `node-operation-preparation.ts`); the isolation answers (`recovery-preparation.ts:365-369`, `recovery-entry.ts:73-77`, the two staged-hour helpers) are unchanged. Every test file the typecheck named is listed (`allocation-configuration.test.ts`'s fixture is at `:237`, not `:236`), and `@waitron/provisioning` joins the typechecks. The old Step 4's `recovery-preparation.test.ts` and `recovery-entry.test.ts` do not exist on `c336372fae` and are dropped |
| 7 "lists only new files" could not hold | — | Applied. Task 5a.4 checks that the readers' existing suites lose no line (`git diff origin/main -U0 … \| /usr/bin/grep '^-[^-]'` prints nothing); Task 5a.5 checks that the fixture files change only by the field |
| 8 `@waitron/fiscal-verifactu` has no mutation script | read `packages/fiscal-verifactu/package.json` (no `mutation` script) | Applied. Task 5a.5 replaces the command with a hand deletion control on Task 5a.2's checks |
| 9 `promote-api.test.ts` cannot see what is stored | read `promote-api.test.ts:7-8` (no database), `hour-promotion.test.ts:520-598` (real preparation and database; `rows()` at `:258-265`), `promote-api.ts:128-139` | Applied in Task 5a.1b: the end-to-end "stores version 1" case goes in `hour-promotion.test.ts`; `promote-api.test.ts` checks that a stub `nodePreparation` receives exactly the two fields; `withPromotionModuleOperation` is named as unchanged |
| 10 the "pass it as isolation" control would be refused before `assertLive` | read `node-operation-preparation.ts:197-203` (`module.operation_invalid` for an action outside `liveRecoveryActions`, before `assertLive`) | Applied. The control is now a temporary edit storing the fact as `isolation` in `invoke`; the non-boolean refusal is named `module.operation_invalid`; the new suite follows `live-module-operation.test.ts:80-90` |
| 11 "version 2 is refused" already passes for the unchanged readers | read the version checks at `declared-paper-evidence.ts:195`, `initial-setup.ts:239`, `cloud-evidence.ts:279`, `conflict-recovery-contract.ts:111` | Applied, with one correction: these tests are guards. Their deletion control is to make the reader accept version 2's shape (add the key and drop the version check). Deleting the version check alone, as the review suggested, would not make them fail: each reader's key list is exact (`declared-paper-evidence.ts:77-81` counts own keys), and version 2 carries one more key. That is read from the code, not run; the implementer runs the control. The slice now defines "failing test" and "guard", and every test in it is labelled one or the other |
| 12 the table missed readers and builders | read each cited site, and `git grep` for `oldMachineOffline` and `approval.` under `apps/` (nothing outside the fiscal package parses the approval) | Applied: rows for the conflict preparation result (with the note that Task 6.4's page must not reuse it for a promotion's selected result), the conflict recovery screen, Cloud preparation and initial Cloud setup, the emergency preparation and paper export, and the single-field readers. The two staged-hour test helpers are isolation answers, listed under Task 5a.1 as unchanged |
| 13 moved lines | reopened each on `c336372fae` | Applied: `RecoveryApproval` `allocation-types.ts:16-27`; `approvalShape` `allocation-envelope.ts:192-215`; `AllocationContext` `:46-89` (`mode` `:50`); `withLiveRecovery` `node-operation-preparation.ts:187-226`; `inputFor` `hour-recovery-preparation.ts:68-98`; `parseConflictInput` `conflict-recovery-contract.ts:74-128`; the declared paper check `declared-paper-evidence.ts:181-205`; the backup verification table loop `backup-verification-history.ts:465-467` |
| 14 no migration, protected core untouched | — | No change needed; the slice's opening now says why there is no migration |
| 15 sizing | — | No change needed; each of the six tasks stays well under 100 tool calls, 5a.1 the largest |

Other plan text: Task 5.8's pointer to the builder now names Task 5a.3 (it named 5a.2). The earlier
rounds' tables keep the task numbers they used at the time.

Narrow check of round 7 (fresh context, 2026-11-03): two more changes. Task 5a.3's `select` reads
the fact inside `options.withState`, because the real host's `readRecoveryFacts` refuses
`setup.attempt_conflict` outside a preparation scope (`recovery-preparation-host.ts:26-30`; read,
not run), and its test drives the real host. Task 7.4's approval test is worded as the exact
version 1 shape, since a version 1 approval carries no `oldMachineRelinquished` key. The check ran
finding 11's control in a throwaway copy (`conflict-recovery-contract.ts:111`) and confirmed the
round-7 correction, and typechecked the required fields against Tasks 5a.1 and 5a.3's file lists.
