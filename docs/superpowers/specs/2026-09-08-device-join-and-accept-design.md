# Device enrolment — pairing mode and numeric match

**Date:** 2026-09-08
**Status:** design, pre-implementation
**Supersedes:** §2 ("Enrolment: a key is just a key") of
[`2026-09-07-device-enrolment-and-login-design.md`](2026-09-07-device-enrolment-and-login-design.md),
landed as #269. Everything else in that design — the profile as the single description of a device,
`device_kind` derived from `form_factor`, the register auto-created for a till, the shift session
keyed to the register — stands unchanged.
**Amends:** [`2026-09-08-print-agent-process-design.md`](2026-09-08-print-agent-process-design.md)
§2.3 (approved 2026-09-08, not yet implemented) — see §7. One mechanism serves both surfaces.

---

## 0. What this replaces, and why

#269 made the pairing code carry nothing. The device describes itself; the code is a bare bearer
token whose only job is to say "whoever holds this may enrol something at this venue". A manager
generates it in the dashboard, someone types ~8 Crockford characters onto a touchscreen, and the
device is in.

That is a secret in transit for no remaining purpose, and it has the failure modes secrets have: it
can be photographed, forwarded, and redeemed by someone else inside its fifteen minutes. The device
also learns nothing about who approved it, and the manager learns nothing about what they approved.

The replacement, agreed with the owner 2026-09-08:

- **Pairing mode.** The admin opens a fifteen-minute window in the dashboard. Outside it, nothing can
  ask to join.
- **Join-and-accept.** The device asks to join, carrying a name and nothing else.
- **Numeric match.** The device shows a two-digit number. The dashboard shows three; the admin taps
  the one that matches, and picks the device's profile and binding in the same dialog.

Nothing is typed. Two separate deliberate acts by the admin — opening the window, matching the
number — replace one secret that either of them could have leaked.

### 0.1 This is stronger than the pairing code, not weaker

The obvious objection to join-and-accept is that it trades "possession of a secret" for "an admin
paid attention". Pairing mode is what answers it. To enrol a device an attacker now needs the admin
to be actively opening a window *and* to tap a number the attacker cannot see, in a dialog that shows
the name the attacker chose. The pairing code required none of the admin's attention at redemption
time — only that a fifteen-minute string had reached the attacker somehow, which is exactly what a
string does.

What is genuinely weaker: a blind guesser picking one of three numbers succeeds one time in three.
§1.2 is why that does not matter.

---

## 1. The mechanism

### 1.1 Pairing mode

One **venue-wide** window admits both devices and print agents (owner decision 2026-09-08). Opening
it is gated on `device.manage`; `device.manage` and `printer.manage` are granted to exactly the same
roles today (`MANAGER` holds both — `packages/identity/src/permissions.ts:112-113` — and `admin`
holds `ALL`), so a single gate excludes nobody who could otherwise open one of two windows. Accepting
stays gated per surface, so a holder of only `printer.manage` can at worst allow a device to create a
pending request it cannot itself approve.

It **opens for fifteen minutes, extendable**: a visible countdown in the dashboard, one click to
extend or reopen, one to close early. It admits any number of joins while open, so an install with
six devices needs one window.

**The window lives in memory on the primary, not in the database.** No table, no classification, no
migration — and it fails closed on restart and on promotion, which is the behaviour to want: a node
that has just taken over should not inherit an open door. It is a small injected holder over a
controllable clock, the shape the enrol rate limiter already uses
(`apps/server/src/device-api.ts:206`):

```ts
// apps/server/src/pairing-mode.ts
export interface PairingMode {
  open(): { openUntil: string };   // opens or extends by TTL
  close(): void;
  isOpen(): boolean;
  noteRefused(): void;             // an in-memory counter, §3.3
  refusedRecently(): number;
}
```

One instance is built in `boot.ts` and passed to both `mountDeviceApi` and `mountPrintApi`, so
"venue-wide" is a property of the wiring rather than a rule anyone has to remember.

### 1.2 The numeric match

The device shows **one two-digit number**. The dashboard shows **three**, and the admin taps the
match. Two digits rather than the print-agent spec's four Crockford characters because the number is
no longer a secret anybody types: its whole job is to be compared across a room, and it should be
legible from where the admin is standing.

Three rules carry the weight the code's entropy used to:

1. **The pending list never returns the number.** The dashboard cannot show the answer beside the
   question. (This is the substantive amendment to the print-agent spec, where
   `GET /management-api/print-agents` returns `joinCode` on the row.)
2. **The server builds the choice set and does not say which is real.** Opening a pending row asks
   for a challenge; the reply is three shuffled numbers. The admin taps one, the dashboard posts the
   value, and the server compares it to the request's own number. The check is server-side and unit
   testable, and the browser genuinely cannot leak the answer — the person is what is being tested,
   not the page.
3. **No decoy equals any other pending request's real number, across both surfaces in the tenant.**
   Without this, two devices joining at once can be honestly ambiguous, and that ambiguity is exactly
   what an attacker would arrange: knock at the same moment as a real device and hope its number
   appears among your decoys. With a cap of ten pending rows per surface, at most twenty of the
   hundred values are real, so decoys always have room.

**A wrong tap denies the request; it is not a retry.** This is what makes one-in-three acceptable: a
blind guesser gets a single one-in-three attempt per knock, and knocks are rate limited, capped, and
possible only while the window is open. It is also how Google's numeric match behaves — a wrong
number ends the attempt. An admin who fat-fingers presses *Try again* on the device, which knocks
afresh with a new number.

---

## 2. The device's flow

The device flow collapses from two screens to one. It carries a name and nothing else, and it never
reads the venue's catalogue — there is no unauthenticated catalogue endpoint left to read.

1. Boot, no cookie → **one screen**: "Name this device", Save.
2. `POST /api/device/join {name}`. Refused with `device.pairing_closed` when the window is shut, so
   the screen can say *"Ask the manager to switch on pairing mode in the dashboard"* rather than
   something opaque.
3. The reply is `{ joinId, verificationNumber }` and a cookie `${joinId}.${token}` — the existing
   selector-plus-validator shape, but its selector names a **join request**, so `requireDevice` finds
   nothing in `devices` and every other device route answers `device.unauthorized`. The token is inert
   by construction rather than by a flag.
4. The device shows the number large, with "waiting for approval", and polls
   `GET /api/device/join/status`, which resolves that cookie against `device_join_requests` and
   answers `pending`, `approved` or `not_approved`.
5. `approved` → **the status response re-issues the cookie as `${deviceId}.${token}`** (the same
   secret, the new selector, since accept copies `token_hash` onto the `devices` row). The device
   boots into the shell its profile's form factor selects. `not_approved` → "This device was not approved", with *Try again*, which knocks afresh
   as a new request with a new number.

A denied request row is deleted, so `not_approved` covers denied, expired and never-existed alike.
One message is the right number of messages here.

*Try again* is a human pressing a button. The automatic re-join the print-agent design rules out
(§3 there) stays ruled out.

---

## 3. The admin's flow

### 3.1 The window

The devices screen gains an **Allow new devices** control with a countdown while open, *Extend* and
*Close*. It is the same control on the printers screen, reading and writing the same venue-wide
state.

### 3.2 Accepting

*Devices waiting to join* lists name and how long ago. Opening a row is a dialog carrying:

- the **three numbers** as three buttons, shuffled, each accessibly labelled ("Number 47") — these
  screens have a11y suites (`apps/dashboard/src/screens/devices-screen.a11y.test.ts`);
- the **profile** picker, and the **station** or **register** picker its form factor calls for.

Moving the binding here is the second half of the owner's decision and it is a real tightening, not
only a UI move. Enrolment currently runs unauthenticated, and it *writes*: a till-form-factor enrol
auto-creates a `tills` row (#269). After this it runs inside a management session holding
`device.manage`, in one `withTenant` transaction, exactly like every other management write.

Accept resolves the profile to its form factor and applies #269's rules unchanged: `kds` requires a
station; anything else requires a register, and a `till` form factor creates one named after the
device. `device.station_required` / `device.register_required` / `device.register_name_taken` keep
their meanings and simply surface on a management route now.

Deny sits behind the same two-step confirm as Revoke.

### 3.3 When the window was shut

A knock refused because the window was closed increments an **in-memory counter** — no row is
written, since row creation is the thing the window exists to prevent. The management read exposes
it so the dashboard can say *"2 devices tried to join in the last 10 minutes"* beside the toggle.

This heads off the one real usability failure of a window: an admin who has not opened it, looking at
a device that appears broken. It wants a home in the dashboard's notification surface, which does not
exist yet — see `docs/backlog.md` → *Product work still open*.

---

## 4. Data

**`device_pairing_codes` is dropped.** **`device_join_requests` replaces it**, taking the same
classification slot — `local`, "this node's pending device join requests; not copied". Pre-production,
so this is a drop and recreate with no backfill (CLAUDE.md §3). It is a core-set table because it is
the enrolment mechanism for the core device model rather than any module's; the commit says so.

| column | notes |
| --- | --- |
| `id`, `tenant_id`, `location_id` | as `device_pairing_codes` had them |
| `label` | the name the device asked for |
| `token_hash` | minted at join; copied to `devices` at accept, so the device's cookie survives approval |
| `verification_number` | the two-digit number, `text` |
| `created_at` | TTL is fifteen minutes, filtered on read and swept opportunistically at join and accept, as the pairing code's TTL was |

`location_id` is stamped from `cfg.locationId` — the node's own venue — exactly as
`generatePairingCode` stamped it (`apps/server/src/device.ts:171`), so the device still asks nothing
about which venue it is joining. Devices already enrolled are untouched: this changes how a row is
created, not what a row is.

**A pending request is not a `devices` row**, which is where this design departs from the print
agent's shape, deliberately. `devices` carries the station-XOR-register constraint trigger from #269
§1.3, and a request whose binding has not been chosen yet cannot satisfy it. Keeping requests in
their own table means `devices` continues to hold only real, fully bound, approved devices; accept
inserts the row and deletes the request in one transaction, and `active`/revoke semantics are
untouched.

---

## 5. Routes

| Route | Auth | Does |
| --- | --- | --- |
| `POST /api/device/join` `{name}` | none; window-gated (`device.pairing_closed`), rate limited (`device.join_rate_limited`), capped at ten pending (`device.join_full`) | inserts the request, mints the number and token; sets the inert cookie; returns `{ joinId, verificationNumber }` |
| `GET /api/device/join/status` | the inert device cookie | `pending` \| `approved` \| `not_approved` |
| `GET /management-api/device-join-requests` | `device.manage` | pending rows: `{ id, label, createdAt }` — **never the number** |
| `GET /management-api/device-join-requests/:id/challenge` | `device.manage` | three shuffled numbers per §1.2 |
| `POST /management-api/device-join-requests/:id/accept` | `device.manage` | `{ choice, profileId, stationId?, registerId? }`; a wrong `choice` deletes the request and returns `device.join_mismatch`; a right one inserts the `devices` row (register auto-created for a till) and deletes the request, in one `withTenant` transaction |
| `POST /management-api/device-join-requests/:id/deny` | `device.manage` | deletes the request |
| `GET/POST/DELETE /management-api/pairing-mode` | `device.manage` | read / open-or-extend / close; the read carries `refusedRecently` |
| `POST /management-api/device-codes` | — | **deleted** |
| `POST /api/device/enrol/verify` | — | **deleted** |
| `POST /api/device/enrol` | — | **deleted** |

The window and the limiter are checked **before the body is parsed and before any DB work**, keeping
the existing property that a flood on an unauthenticated route draws no connection from the pool
(`apps/server/src/device-api.ts:260`'s handler comment; CLAUDE.md §5, nothing external may block a
sale).

`mountPairingModeApi` is its own small mount in `boot.ts` rather than living inside either surface's
API, because neither owns it.

---

## 6. Errors

Deleted with their routes: `device.pairing_invalid`, `device.pairing_expired`,
`device.pairing_rate_limited`, `device.pairing_code_unavailable`. Codes are never renamed once
shipped (CLAUDE.md §3) — nothing here is shipped, no client outside this repository has seen them,
and the commit says so, exactly as the print-agent design deletes its `agent.pairing_*` family.

Added: `device.pairing_closed` (403), `device.join_rate_limited` (429), `device.join_full` (429),
`device.join_mismatch` (400).

There is deliberately **no** `device.pending`. Because a pending request lives in its own table, a
pending cookie's selector matches no `devices` row and every ordinary device route already answers
`device.unauthorized`; the status route is the one place that resolves it, and it answers 200 with a
status rather than an error. The print agent needs `agent.pending` only because its pending rows sit
in `print_agents` — adopting §7.3 retires that code too.

Unchanged and now raised on the accept route: `device.station_required`, `device.register_required`,
`device.till_required`, `device.register_name_taken`, `device.profile_missing`,
`device.binding_invalid`.

---

## 7. Amendments to the print-agent design

Track H slice 1 is approved but not implemented, so these are edits to
[`2026-09-08-print-agent-process-design.md`](2026-09-08-print-agent-process-design.md) §2.3 rather
than rework:

1. **`join_code` becomes a two-digit `verification_number`**, and
   `GET /management-api/print-agents` **stops returning it**. A `…/:id/challenge` route returns the
   three shuffled numbers; accept takes `{ choice }`; a wrong choice denies.
2. **`POST /print-api/agent/join` is window-gated** (`agent.pairing_closed`). An agent refused
   because the window is shut **retries with backoff** and its status page says "Ask the manager to
   switch on pairing mode in the dashboard" — distinct from denied, which still stops until the
   process is restarted. This includes the agent on the server's own box: it needs no address typed,
   but it still asks and is still accepted.
3. **Recommended, for symmetry:** pending agents move to `print_agent_join_requests` (`local`), the
   twin of §4's table, and denial deletes the row. That retires the `active`-flag overload the
   current spec carries ("a denied row is a revoked row that was never approved"), leaves
   `print_agents` holding only real agents, and retires `agent.pending` — an agent polls its own
   status route exactly as a device does, instead of learning it is unapproved from a 403 on the job
   pull. If this is declined, the two surfaces still share the
   flow, the window, the gesture and the vocabulary, and differ only in storage.

The decoy-distinctness rule of §1.2 spans **both** tables' pending rows, so an agent request and a
device request can never show colliding numbers.

---

## 8. Dev mode

`config.devMode` holds pairing mode permanently open and **auto-accepts at join**: the request is
created and immediately approved with the location's default profile, returning a live cookie. A
fresh browser at a worktree till boots straight in.

This deletes `apps/server/src/dev-pairing.ts`, the `DEMO` code, and the per-browser re-enrol step
that follows every `wa-wt reset` (`docs/backlog.md` and CLAUDE.md §6 both currently document that
step; both are updated in the same change — a behaviour change retires every receipt about the old
behaviour, CLAUDE.md §1).

---

## 9. Deleted

`device_pairing_codes` (table, classification line, schema, its unique lookup index);
`generatePairingCode`, `verifyPairingCode`, `isDevPairingCode` and `apps/server/src/dev-pairing.ts`;
`readEnrolCatalogue` in its unauthenticated form (its reads move behind the accept dialog's
management session); the dashboard's generate-code form; the three routes in §5; the four error codes
in §6.

---

## 10. What this does not defend against

Stated plainly, because the alternative is a claim that outruns the code (CLAUDE.md §1):

- **An admin who taps without looking.** One in three succeeds. The decoy rule, the deny-on-wrong and
  the window shrink the opportunity; nothing removes it.
- **An attacker inside the window who can also see the device's screen.** They can read the number and
  knock with a convincing name; if the admin then opens the attacker's row rather than the real one,
  the numbers match. Physical presence at the screen defeats this design, as it defeats the pairing
  code it replaces.
- **Origin.** A grep of `apps/server/src` on 2026-09-08 found no read of `x-forwarded-for` or of a
  socket remote address — a claim about the text, not a running probe — so a knock arriving through the cloud tunnel is indistinguishable from one on the venue
  LAN. Restricting knocks to the LAN was considered and **dropped**: the window reduces the exposure
  from permanent to minutes per install, and origin awareness is machinery this server does not have.
  Revisit if the window ever grows a "stay open" mode.

---

## 11. Testing

- **The decoy rule** — no returned choice equals another pending request's number, across both
  tables; seeded RNG, and a negative control that fails when the exclusion is deleted.
- **Wrong choice denies**, and the request is gone afterwards; prove by deletion that the accept path
  is what refuses, not the router.
- **Window closed → refused with zero DB work**, following the shape of the existing rate-limiter
  test (`apps/server/src/print-api.test.ts:186`): delete the check and watch the test fail.
- **The window fails closed** on a fresh holder, and closing mid-window refuses immediately (a
  controllable clock; no sleeping).
- **Accept is one transaction** — a device insert that throws rolls back the auto-created register.
- **Tenant scoping on every by-id route** (accept, deny, challenge): a request scoped to tenant A
  reads and writes zero of tenant B's rows (CLAUDE.md §3, the till-reroute S3 receipt). Real
  Postgres, as `app_user` with `rolsuper = f` — reading did not catch that class last time; running a
  two-tenant probe did.
- **Grants** on `device_join_requests` in `packages/db`'s privileges suite, plus the two root guards
  after the schema change: `scripts/classification-complete.test.ts` and
  `scripts/append-only-enable-always.test.ts`.
- **Dashboard**: the accept dialog's three buttons under the existing a11y suites; the device screen's
  number is announced, not only styled large.
- **End to end**, real PG: open the window, knock, list (assert the number is *absent* from the list
  payload), challenge, accept with the right number, the device's cookie works; then a second knock,
  accept with a wrong number, and the device sees `not_approved`.

---

## 12. Non-goals

- No per-IP rate limiting; the limiter stays per-process, as it is today.
- No record of refused knocks beyond an in-memory counter — persisting them would hand an attacker
  the row creation the window exists to deny.
- No notification surface. The refused-knock hint renders inline beside the toggle until the
  dashboard has one (`docs/backlog.md`).
