# Adding and editing devices — implementation plan

**2026-10-08 update:** [A413](../../backlog.md) replaces the two Add buttons with one in the page
heading and replaces the completed-join line with a compact confirmation asking whether to add
another device (owner revision at 14:05). Close ends adding; Add another device resumes waiting
with "Waiting for more devices…". The Devices table also gains search and profile/status filters.
The original design and plan below remain historical.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A device joins the way a printer is added — through an Add a device dialog that holds the
join window open only while it is open, a number check, then the device's name and profile — and
every device can afterwards be renamed and edited, with its battery shown in the list.

**Architecture:** The in-memory join window (`apps/server/src/pairing-mode.ts`) becomes a set of
expiring holds plus in-memory "claims" (which login matched a request's number). The management
routes in `join-api.ts` gain hold, check and claim-aware accept routes; device requests are discarded
whenever the window has shut since they were made. The dashboard gets one shared hold controller
used by the Devices and Printers screens, a two-step Pair dialog, a device table with an Edit dialog
saved through one new route, and a battery column fed by a new device route and three new columns.

**Tech Stack:** Hono routes, drizzle on SQLite (`@waitron/db`), Lit web components with `wt-*`
primitives, Vitest (node for the server, real Chromium for the dashboard and till), `qrcode`.

**Spec:** [docs/superpowers/specs/2026-10-04-add-a-device-design.md](../specs/2026-10-04-add-a-device-design.md)

**Review:** the planning session checked the plan's code claims by grep on 2026-10-04 and fixed
three. A fresh-context Opus review against the spec and the code followed on 2026-10-05; it ran the
plan's `pairing-mode.ts` and `pairing-hold.ts` code and tests in a scratch copy (all passed) and
probed the release order, and found 3 blockers and 9 should-fix points, all fixed in this revision:
existing tests missing from the granted list (now named), the release route discarding before the
release, claims dropped inside a transaction that could roll back, the controller's missing
`background` fallback, a wrong typecheck expectation, the Edit route re-checking unchanged printers,
the per-device reader fetch, three dropped server checks, no way out of a failed hold, refusals not
placed under their field, and `JOIN_TTL_MS`'s comment.

## Delivery: three pull requests

Each is its own queue item and its own branch, and each leaves `main` working on its own.

| Item | Tasks | Branch | What lands |
| --- | --- | --- | --- |
| W104 | 1–6 | `feat/add-a-device` | Holds, number check and claims, the Add a device dialog, the agent dialog on holds, the till's message |
| W105 | 7–8 | `feat/device-edit-dialog` | The `PATCH` device route, the device table and the Edit dialog |
| W106 | 9–11 | `feat/device-battery` | The battery columns, the device route, the till reporter, the Battery column |

W105 starts after W104 lands; W106 after W105 (its column goes in W105's table).

## Global Constraints

- Hold length **3 minutes**, renewed every **60 seconds** (spec §2). Renewal is passive
  (`withPassiveManagementRead` on the server, `api.background` in the dashboard).
- Holds and claims live in memory only; no table changes for pairing (spec §4).
- Device requests are discarded once the window has shut since they were made; print-agent requests
  are never discarded by that rule (spec §4).
- The print-agent accept route and its number-tap-is-the-accept flow are unchanged.
- Dev mode's auto-accept stays, without the window (spec §4).
- Permissions unchanged: `device.manage` for holds, check, accept, deny, list and edit;
  `payments.manage` for the card reader (spec §4, §5).
- New error codes: `device.pairing_hold_lapsed`, `join_request.claimed`, `join_request.unclaimed`
  (all 409). Every file that throws one imports `./errors.js`; each gets EN and ES dashboard wording.
- Device name: trimmed, non-empty, unique among active devices at the location
  (`devices_location_label_active_key`); a clash is `device.name_taken`, shown under Name.
- Forms follow `docs/developers/design-system.md` → Forms: required fields marked, error beside the
  field and one message at the bottom, action disabled until fixed, every input has a semantic `name`.
- Every colour, spacing, radius and font reads a `--wt-*` token. Row-menu columns are keyed
  `actions` with `pinned: "end"`. Cell markup is styled with `part=`, never a class.
- Battery: level is a whole percentage 0–100, refused outside it by the route; stored at most once a
  minute per device except a charging change; three nullable columns added with **no CHECK** (a
  CHECK forces a drizzle rebuild of `devices`, CLAUDE.md §3); "Not reported" when never reported;
  greyed with "as of {time}" when older than 10 minutes.
- Every user-visible string in English and Spanish.
- Run focused tests while implementing; CI runs the package suites. Look at every changed screen in
  both themes and at phone width (390 px).

## Review Focus

1. **A dialog left open while its manager walks away.** The renewal is passive, so the login times
   out and the renewal answers 401; the controller must stop renewing (not retry forever) and the
   window must shut within 3 minutes. Test: Task 4 Step 1, "stops renewing after a 401".
2. **Two managers pairing the same device.** The second must not be able to check, deny or accept a
   request the first has claimed. Test: Task 3 Step 1, "refuses a request another login has claimed".
3. **A device that asked while the window was open, then the dialog was closed and reopened.** Its
   request must be gone, and its status `not_approved`. Test: Task 3 Step 1, "discards a device
   request made before the window last shut".
4. **The Printers screen's agent dialog and the Devices dialog open at once.** Closing one must not
   shut the other's window. Test: Task 2 Step 1, "releasing one hold leaves the window open".
5. **A name of only spaces, or with spaces around it.** Only spaces is refused under Name; spaces
   around it are trimmed before the uniqueness check, so " Barra " clashes with "Barra". Test: Task 3
   Step 1 cases 5–6 and Task 7 Step 1 ("refuses a blank name on edit"); add to Task 7 "a name differing
   only by surrounding spaces clashes".

## Existing tests this plan changes (owner's grant required before starting)

Under the lane rule (owner, 2026-10-04 ~19:15) every changed existing assertion is asked about
first. This plan retires behaviours the spec removes, so the tests below change or are deleted. The
owner is asked once, for the whole list, when the item is queued; if the grant is not recorded in
the lane's `questions.md`, STOP before Task 1.

W104:
- `apps/server/src/pairing-mode.test.ts` — whole file rewritten for holds (open/extend/close and
  the refused count go).
- `apps/server/src/join-api.db.test.ts` — the `the pairing-mode control` describe (window routes,
  refused count, `DELETE`, `/renew`) rewritten for hold routes; every device-accept case sending
  `choice` moves to check-then-accept.
- `apps/server/src/join-e2e.test.ts` — the accept steps sending `choice`, and the refused-count
  steps (`refusedRecently: 0` / `1`).
- `apps/server/src/join-requests.test.ts` — the device accept cases sending `choice`, and
  "DENIES on a wrong choice, and the deny SURVIVES THE TRANSACTION", which moves to
  `checkDeviceJoinNumber`.
- `apps/server/src/device-api.test.ts` — the `refusedRecently()` assertions in the shut-window and
  rate-limit cases; the dev auto-accept and helper calls that pass `choice`.
- `apps/server/src/device.test.ts` — the accept call passing `choice` (setup).
- `apps/server/src/join-api.test.ts` — "join approval binds a kitchen screen to its watcher…": its
  accept bodies send `choice`; it moves to check-then-accept with the same three assertions.
- **Task 3 setups** (added after the 2026-10-05 plan review; setup and whole-shape pins only, no
  existing value changes): a device request is now discarded whenever the window is shut, so these
  open a hold first — `join-api.db.test.ts`'s list, challenge, deny and pending-cap groups;
  `join-requests.test.ts`'s `readJoinStatus` cases (they also pass the holder as a new fifth
  argument) and its `AcceptResult` import; `device.test.ts`'s status read expecting `"pending"`.
  The device-list `toEqual` pins in `join-api.db.test.ts` and `join-e2e.test.ts` gain
  `pairingBy: null`.
- `apps/dashboard/src/api/client.test.ts` — the pairing-mode GET/POST/DELETE cases, the
  `renewPairingMode` case, and the device accept cases sending `choice`.
- `apps/dashboard/src/screens/devices-screen.test.ts` — every pairing case: the window card, the
  refused hint, open/extend/close, the waiting list, Deny, the accept dialog and its number tests,
  "picks the joining device's profile and station from labelled dropdowns", the closing-window and
  deny edge cases, and "keeps a failed pairing open's connection failure…".
- `apps/dashboard/src/screens/devices-screen.a11y.test.ts` — the "open pairing window" and accept
  dialog states and the stub's pairing methods.
- `apps/dashboard/src/screens/printers-screen.test.ts` and `printers-screen.a11y.test.ts` — the
  `SHUT`/`OPEN` fixtures' `refusedRecently`, the stubs' `openPairingMode` / `renewPairingMode` /
  `closePairingMode`, and these cases by name (each moves to `takePairingHold` /
  `releasePairingHold` keeping its intent, unless marked):
  - "opens pairing automatically and closes it with the agent modal"
  - "puts Add agent under the empty agent table's sentence, opening the same pairing"
  - "opens the window automatically and shows when it lapses"
  - "shows an error banner when opening the window is rejected"
  - "keeps pairing open, polls passively…" (renewal now by the controller, through `background`)
  - "closes a pending pairing open…"
  - "reports a failed pairing close after dismissing the modal" — DELETED: the controller ignores a
    failed release, because a hold the server could not release lapses within 3 minutes anyway
  - "does not open pairing when the screen leaves…"
  - "retains the refused-request hint…" — DELETED with the refused count
  - "ignores a previous opening's pairing failure…"
  - "does not show a previous pairing deadline…"
  - "opens pairing once when Add agent is pressed twice"
  - "ignores Scan while an agent scan is still listening…" — its "a rescan opens the window again"
    assertion goes: Scan no longer touches the window, the dialog's hold does
  - "opens the window before the first pairing read arrives…"
  - the a11y file's "renders the open pairing window accessibly" stub (`refusedRecently`).
- `apps/till/src/i18n/codes.test.ts` — the `device.pairing_closed` wording (EN and ES).
- Any test pinning `device.name_taken`'s dashboard wording (it changes: the name is now editable).

W105:
- `apps/server/src/device-api.test.ts` — the `assign-device-profile` describe and the
  `PUT /management-api/devices/:id/made-here` describe (both routes are replaced by `PATCH`).
- `apps/dashboard/src/api/client.test.ts` — the `reassignDeviceProfile` and `setDeviceMadeHere`
  cases.
- `apps/dashboard/src/screens/devices-screen.test.ts` — every list-row case: made-here checkboxes,
  reassign dropdown, revoke button, hardware block, reader dropdown, the field-label cases in
  `devices-screen fields`, the "remaining edges" reassign cases.
- `apps/dashboard/src/screens/devices-screen.a11y.test.ts` — the list and made-here states.

W106: none expected (new columns and routes only); a whole-shape pin of a device row gaining the
three battery keys is allowed by the rule.

---

## W104 — Add a device

### Task 1: The window becomes holds and claims

**Files:**
- Modify: `apps/server/src/pairing-mode.ts` (whole file)
- Test: `apps/server/src/pairing-mode.test.ts` (whole file)

**Interfaces:**
- Produces:

```ts
export const PAIRING_HOLD_MS = 3 * 60 * 1000;
export interface PairingClaim { holdId: string; sessionKey: string; personName: string }
export interface PairingMode {
  open(): { holdId: string; openUntil: string }; // takes a NEW hold
  renew(holdId: string): { openUntil: string } | null; // null: unknown or lapsed
  release(holdId: string): void;
  hasHold(holdId: string): boolean;
  isOpen(): boolean;
  openUntil(): string | null; // latest live hold's expiry
  openSince(): string | null; // ISO start of the current open period, null when shut
  claim(requestId: string, claim: PairingClaim): void;
  claimOf(requestId: string): PairingClaim | undefined; // undefined once its hold has ended
  orphanedClaims(): string[]; // request ids whose claim's hold has ended
  dropClaim(requestId: string): void;
}
export function createPairingMode(opts?: { now?: () => number; holdMs?: number; newId?: () => string }): PairingMode;
```

`open()` keeps its name so the many test setups that call `pairingMode.open()` to admit a knock
still compile unchanged.

- [ ] **Step 1: Write the failing tests** — replace `pairing-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PAIRING_HOLD_MS, createPairingMode } from "./pairing-mode.js";

function atClock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}
const ids = () => {
  let n = 0;
  return () => `hold-${++n}`;
};

describe("createPairingMode", () => {
  it("is shut on a fresh holder — a restart never inherits an open door", () => {
    const mode = createPairingMode();
    expect(mode.isOpen()).toBe(false);
    expect(mode.openUntil()).toBeNull();
    expect(mode.openSince()).toBeNull();
  });

  it("a hold opens the window until it lapses", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const { holdId, openUntil } = mode.open();
    expect(holdId).toBe("hold-1");
    expect(Date.parse(openUntil)).toBe(1_000 + PAIRING_HOLD_MS);
    clock.advance(PAIRING_HOLD_MS - 1);
    expect(mode.isOpen()).toBe(true);
    clock.advance(1);
    expect(mode.isOpen()).toBe(false);
    expect(mode.hasHold(holdId)).toBe(false);
  });

  it("renewing a live hold moves its lapse; an unknown or lapsed hold is refused", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const { holdId } = mode.open();
    clock.advance(PAIRING_HOLD_MS - 10);
    expect(mode.renew(holdId)).toEqual({
      openUntil: new Date(clock.now() + PAIRING_HOLD_MS).toISOString(),
    });
    expect(mode.renew("nope")).toBeNull();
    clock.advance(PAIRING_HOLD_MS);
    expect(mode.renew(holdId)).toBeNull();
  });

  it("releasing one hold leaves the window open while another is live", () => {
    const mode = createPairingMode({ newId: ids() });
    const a = mode.open();
    mode.open();
    mode.release(a.holdId);
    expect(mode.isOpen()).toBe(true);
  });

  it("the window shuts when its last hold is released", () => {
    const mode = createPairingMode({ newId: ids() });
    const a = mode.open();
    mode.release(a.holdId);
    expect(mode.isOpen()).toBe(false);
    expect(mode.openSince()).toBeNull();
  });

  it("openSince stays at the start of an unbroken open period and restarts after a shut", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const a = mode.open();
    clock.advance(1_000);
    mode.open();
    mode.release(a.holdId);
    expect(mode.openSince()).toBe(new Date(1_000).toISOString());
    clock.advance(2 * PAIRING_HOLD_MS);
    expect(mode.openSince()).toBeNull();
    mode.open();
    expect(mode.openSince()).toBe(new Date(clock.now()).toISOString());
  });

  it("openUntil is the latest live hold's lapse", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    mode.open();
    clock.advance(5_000);
    const later = mode.open();
    expect(mode.openUntil()).toBe(later.openUntil);
  });

  it("a claim lives as long as its hold, then is orphaned until dropped", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const { holdId } = mode.open();
    const claim = { holdId, sessionKey: "k", personName: "Ana" };
    mode.claim("r1", claim);
    expect(mode.claimOf("r1")).toEqual(claim);
    expect(mode.orphanedClaims()).toEqual([]);
    mode.release(holdId);
    expect(mode.claimOf("r1")).toBeUndefined();
    expect(mode.orphanedClaims()).toEqual(["r1"]);
    mode.dropClaim("r1");
    expect(mode.orphanedClaims()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/pairing-mode.test.ts`
Expected: FAIL — `PAIRING_HOLD_MS` is not exported, `hasHold` is not a function.

- [ ] **Step 3: Implement** — replace `pairing-mode.ts` (keep the file's header paragraph about
being in memory on the primary, reworded for holds):

```ts
import { randomUUID } from "node:crypto";

/**
 * The venue-wide join window, held open by the dashboard dialogs that are open.
 *
 * IN MEMORY, ON THE PRIMARY, DELIBERATELY, not a table: a restart or a promotion forgets every hold
 * and claim, so the window starts shut. `boot.ts` builds ONE holder for the device, join and print
 * mounts.
 */
export const PAIRING_HOLD_MS = 3 * 60 * 1000;

/** Which login matched a request's number, and the hold it lives as long as. `sessionKey` is
 * `hashSessionToken` of the session, so this long-lived map never keeps a live credential. */
export interface PairingClaim {
  holdId: string;
  sessionKey: string;
  personName: string;
}

export interface PairingMode {
  open(): { holdId: string; openUntil: string };
  renew(holdId: string): { openUntil: string } | null;
  release(holdId: string): void;
  hasHold(holdId: string): boolean;
  isOpen(): boolean;
  openUntil(): string | null;
  openSince(): string | null;
  claim(requestId: string, claim: PairingClaim): void;
  claimOf(requestId: string): PairingClaim | undefined;
  orphanedClaims(): string[];
  dropClaim(requestId: string): void;
}

export function createPairingMode(
  opts: { now?: () => number; holdMs?: number; newId?: () => string } = {},
): PairingMode {
  const { now = Date.now, holdMs = PAIRING_HOLD_MS, newId = randomUUID } = opts;
  const holds = new Map<string, number>();
  const claims = new Map<string, PairingClaim>();
  let openSinceMs: number | null = null;

  const prune = (): void => {
    const t = now();
    for (const [id, until] of holds) if (until <= t) holds.delete(id);
    if (holds.size === 0) openSinceMs = null;
  };
  const live = (holdId: string): boolean => {
    prune();
    return holds.has(holdId);
  };
  const iso = (ms: number): string => new Date(ms).toISOString();

  return {
    open() {
      prune();
      const t = now();
      if (openSinceMs === null) openSinceMs = t;
      const holdId = newId();
      holds.set(holdId, t + holdMs);
      return { holdId, openUntil: iso(t + holdMs) };
    },
    renew(holdId) {
      if (!live(holdId)) return null;
      const until = now() + holdMs;
      holds.set(holdId, until);
      return { openUntil: iso(until) };
    },
    release(holdId) {
      holds.delete(holdId);
      prune();
    },
    hasHold: live,
    isOpen() {
      prune();
      return holds.size > 0;
    },
    openUntil() {
      prune();
      return holds.size === 0 ? null : iso(Math.max(...holds.values()));
    },
    openSince() {
      prune();
      return openSinceMs === null ? null : iso(openSinceMs);
    },
    claim(requestId, claim) {
      claims.set(requestId, claim);
    },
    claimOf(requestId) {
      const claim = claims.get(requestId);
      return claim !== undefined && live(claim.holdId) ? claim : undefined;
    },
    orphanedClaims() {
      prune();
      return [...claims].filter(([, c]) => !holds.has(c.holdId)).map(([id]) => id);
    },
    dropClaim(requestId) {
      claims.delete(requestId);
    },
  };
}
```

- [ ] **Step 4: Run to see it pass** — same command; expected PASS.

- [ ] **Step 5: Fix the compile breaks this causes, without changing behaviour yet.**
`noteRefused`, `refusedRecently` and `close` are gone. In `apps/server/src/device-api.ts` delete
the `deps.pairingMode.noteRefused();` line in the knock route (and the comment sentence naming it);
in `apps/server/src/print-api.ts` delete the same line in the agent knock. In `join-api.ts` the
window routes are replaced in Task 2 — for this step make `GET /management-api/pairing-mode` return
`{ open, openUntil }`, and delete the `POST`, `/renew` and `DELETE` window routes (Task 2 adds the
hold routes). `pnpm --filter @waitron/server typecheck` covers the test files too
(`apps/server/tsconfig.json` includes `src`), so it FAILS here in `join-api.db.test.ts` (imports
`PAIRING_WINDOW_MS`, calls `noteRefused`) and `device-api.test.ts` (calls `refusedRecently()`) until
Task 2, and in `join-requests.test.ts` and `device.test.ts` until Task 3. Production files must
typecheck: check that every remaining error is in a `.test.ts` file.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/pairing-mode.ts apps/server/src/pairing-mode.test.ts apps/server/src/device-api.ts apps/server/src/print-api.ts apps/server/src/join-api.ts
git commit -s -m "Hold the join window open per dialog instead of for fifteen minutes"
```

### Task 2: Hold routes, the device address, and the shut-window refusal

**Files:**
- Modify: `apps/server/src/join-api.ts` (window routes, `JoinApiDeps`)
- Modify: `apps/server/src/errors.ts` (add `device.pairing_hold_lapsed`)
- Modify: `apps/server/src/boot.ts:1473` (pass `deviceAddress: config.advertisedOrigin`)
- Test: `apps/server/src/join-api.db.test.ts` (the `the pairing-mode control` describe)
- Test: `apps/server/src/device-api.test.ts`, `apps/server/src/join-e2e.test.ts` (refused-count
  assertions removed — granted list)

**Interfaces:**
- Consumes: Task 1's `PairingMode`.
- Produces (HTTP, all `device.manage`):
  - `GET /management-api/pairing-mode` → `{ open: boolean; openUntil: string | null; deviceAddress: string }`
  - `POST /management-api/pairing-mode/holds` → `200 { holdId: string; openUntil: string }`
  - `POST /management-api/pairing-mode/holds/:holdId/renew` → `200 { openUntil }` | `409 device.pairing_hold_lapsed` (passive: does not touch the session)
  - `DELETE /management-api/pairing-mode/holds/:holdId` → `204` (an unknown hold is not an error)
  - `JoinApiDeps` gains `deviceAddress: string`.

- [ ] **Step 1: Write the failing tests** — in `join-api.db.test.ts`, change `mountApp` to pass
`deviceAddress: "https://waitron.local"` and replace the `the pairing-mode control` describe with:

```ts
describe("the join window's holds", () => {
  it("GET reports a shut window and the address devices use", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const res = await send(app, "GET", "/management-api/pairing-mode", { cookie: venue.managerCookie });
    expect(await res.json()).toEqual({ open: false, openUntil: null, deviceAddress: "https://waitron.local" });
  });

  it("taking a hold opens the window; releasing it shuts it", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const taken = await send(app, "POST", "/management-api/pairing-mode/holds", { cookie: venue.managerCookie });
    expect(taken.status).toBe(200);
    const { holdId } = (await taken.json()) as { holdId: string; openUntil: string };
    expect(mode.isOpen()).toBe(true);
    const released = await send(app, "DELETE", `/management-api/pairing-mode/holds/${holdId}`, { cookie: venue.managerCookie });
    expect(released.status).toBe(204);
    expect(mode.isOpen()).toBe(false);
  });

  it("releasing one hold leaves the window open", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const take = async () =>
      ((await (await send(app, "POST", "/management-api/pairing-mode/holds", { cookie: venue.managerCookie })).json()) as { holdId: string }).holdId;
    const a = await take();
    await take();
    await send(app, "DELETE", `/management-api/pairing-mode/holds/${a}`, { cookie: venue.managerCookie });
    expect(mode.isOpen()).toBe(true);
  });

  it("renews a live hold and refuses an unknown one with device.pairing_hold_lapsed", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { holdId } = mode.open();
    const ok = await send(app, "POST", `/management-api/pairing-mode/holds/${holdId}/renew`, { cookie: venue.managerCookie });
    expect(ok.status).toBe(200);
    const unknown = await send(app, "POST", `/management-api/pairing-mode/holds/${randomUUID()}/renew`, { cookie: venue.managerCookie });
    expect(unknown.status).toBe(409);
    expect((await errorOf(unknown)).code).toBe("device.pairing_hold_lapsed");
  });

  it("a fresh holder (a restart) refuses a hold taken before it", async () => {
    const venue = await setupVenue(suite.db);
    const before = createPairingMode();
    const { holdId } = before.open();
    const app = mountApp(venue.cfg, createPairingMode());
    const res = await send(app, "POST", `/management-api/pairing-mode/holds/${holdId}/renew`, { cookie: venue.managerCookie });
    expect((await errorOf(res)).code).toBe("device.pairing_hold_lapsed");
  });

  it("refuses staff on every hold route before saying anything else", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    for (const [method, path] of [
      ["GET", "/management-api/pairing-mode"],
      ["POST", "/management-api/pairing-mode/holds"],
      ["POST", `/management-api/pairing-mode/holds/${randomUUID()}/renew`],
      ["DELETE", `/management-api/pairing-mode/holds/${randomUUID()}`],
    ] as const) {
      const res = await send(app, method, path, { cookie: venue.staffCookie });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });
});
```

Carry over, pointed at the new routes, the three checks the replaced describe held: the passive
renewal case (it read the session's last-seen time before and after — keep that technique);
"refuses renewal after the management session expires" (the server half of Review Focus 1); and
"all window routes need a management session" (401 with no cookie). The staff case keeps its
error-body assertion (`code` and `params.permission`), not only the status.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/join-api.db.test.ts -t "holds"`
Expected: FAIL — 404 on `/management-api/pairing-mode/holds`.

- [ ] **Step 3: Implement.** In `errors.ts`, beside `"device.pairing_closed"`, add
`"device.pairing_hold_lapsed": Record<string, never>;`. In `join-api.ts`: add
`deviceAddress: string` to `JoinApiDeps`; add `"device.pairing_hold_lapsed": 409` to `STATUS`;
replace the window routes with:

```ts
  app.get("/management-api/pairing-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, "device.manage", async () => undefined);
      return c.json({
        open: deps.pairingMode.isOpen(),
        openUntil: deps.pairingMode.openUntil(),
        deviceAddress: deps.deviceAddress,
      });
    }),
  );

  app.post("/management-api/pairing-mode/holds", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, "device.manage", async () => undefined);
      return c.json(deps.pairingMode.open(), 200);
    }),
  );

  app.post("/management-api/pairing-mode/holds/:holdId/renew", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Renewal never counts as someone using the dashboard, so an unattended dialog lapses with the login.
      await withPassiveManagementRead(() => gated(sessionId, "device.manage", async () => undefined));
      const renewed = deps.pairingMode.renew(c.req.param("holdId"));
      if (renewed === null) throw new AppError("device.pairing_hold_lapsed", {});
      return c.json(renewed, 200);
    }),
  );

  app.delete("/management-api/pairing-mode/holds/:holdId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const holdId = c.req.param("holdId");
      // Released inside the gate, so staff cannot release a hold. From Task 3 the gate's transaction
      // also discards the device requests a shut window strands, so they vanish now, not at the next read.
      await gated(sessionId, "device.manage", async () => {
        deps.pairingMode.release(holdId);
      });
      return c.body(null, 204);
    }),
  );
```

In `boot.ts` pass `deviceAddress: config.advertisedOrigin` to `mountJoinApi`. Update every other
`mountJoinApi(` call in tests to pass `deviceAddress` (fixture growth).

In `device-api.test.ts` and `join-e2e.test.ts` delete the `refusedRecently` assertions and the
e2e's `pairing-mode` GET steps that read the count (granted list); open the window through
`POST /management-api/pairing-mode/holds` where the e2e opened it through the old route.

- [ ] **Step 4: Run to see them pass**

Run: `pnpm --filter @waitron/server exec vitest run src/join-api.db.test.ts src/pairing-mode.test.ts src/device-api.test.ts src/join-e2e.test.ts`
Expected: the holds describe passes; device-accept cases still sending `choice` fail until Task 3.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/join-api.ts apps/server/src/errors.ts apps/server/src/boot.ts apps/server/src/join-api.db.test.ts apps/server/src/join-api.test.ts apps/server/src/print-agent-e2e.test.ts apps/server/src/device-api.test.ts apps/server/src/join-e2e.test.ts
git commit -s -m "Add routes that take, renew and release a hold on the join window"
```

### Task 3: Check the number, claim the request, approve with a name, discard on a shut window

**Files:**
- Modify: `apps/server/src/join-requests.ts`
- Modify: `apps/server/src/join-api.ts`
- Modify: `apps/server/src/device-api.ts` (knock, status, dev auto-accept)
- Modify: `apps/server/src/device.ts` (add `requireDeviceName`)
- Modify: `apps/server/src/testing/enrol.ts`
- Modify: `apps/server/src/errors.ts` (`join_request.claimed`, `join_request.unclaimed`)
- Test: `apps/server/src/join-api.db.test.ts`, `apps/server/src/join-requests.test.ts`,
  `apps/server/src/join-e2e.test.ts`, `apps/server/src/device-api.test.ts`, `apps/server/src/device.test.ts`

**Interfaces:**
- Consumes: Task 1's `PairingMode`; Task 2's routes.
- Produces:

```ts
// join-requests.ts
export type DeviceRequestWindow = Pick<PairingMode, "openSince" | "orphanedClaims">;
/** Returns the orphaned-claim request ids it deleted; the CALLER drops those claims after its
 * transaction commits, so a rolled-back sweep leaves the claims for the next sweep. */
export async function discardLapsedDeviceRequests(tx: Transaction, cfg: TillConfig, window: DeviceRequestWindow): Promise<string[]>;
export async function checkDeviceJoinNumber(tx: Transaction, cfg: TillConfig, id: string, choice: string): Promise<{ ok: boolean }>;
export async function acceptDeviceJoinRequest(
  tx: Transaction, cfg: TillConfig, id: string,
  input: { label: string; profileId: string; stationId?: string | null; watcherId?: string | null },
): Promise<{ deviceId: string; name: string; formFactor: FormFactor }>;
export async function readJoinStatus(db: Database, cfg: TillConfig, joinId: string, token: string, window: DeviceRequestWindow): Promise<JoinStatus>;
// listPendingJoinRequests unchanged in shape; the route adds pairingBy.
// device.ts
export function requireDeviceName(value: unknown): string; // trimmed; "" → management.request_invalid { field: "name" }
```

HTTP (all `device.manage`):
- `GET /management-api/join-requests?kind=device` → rows `{ id, kind, label, createdAt, pairingBy: { name: string; mine: boolean } | null }`. `kind=print_agent` rows are unchanged (no `pairingBy`). A claim writes no row, so other managers' lists learn of it at their next read (the live query's 60-second refetch, or any join-request change); a second manager who taps Pair first is refused `join_request.claimed`, shown in the Pair dialog.
- `POST /management-api/device-join-requests/:id/check` body `{ choice: string; holdId: string }` → `204` | `400 device.join_mismatch` (request deleted) | `409 join_request.claimed` | `409 device.pairing_hold_lapsed`.
- `POST /management-api/device-join-requests/:id/accept` body `{ name: string; profileId: string; stationId?: string|null; watcherId?: string|null }` → `200 { deviceId, name, formFactor }` | `409 join_request.unclaimed` | existing binding and name codes.
- `POST /management-api/join-requests/:id/deny` on a device request another login has claimed → `409 join_request.claimed`; otherwise as today, and the claim is dropped.

- [ ] **Step 1: Write the failing tests** in `join-api.db.test.ts` (new describe
`device pairing: check, claim, approve`). Use a helper that mounts with a known holder and takes a
hold through the route:

```ts
async function pairingApp(venue: Venue) {
  const mode = createPairingMode();
  const app = mountApp(venue.cfg, mode);
  const { holdId } = (await (await send(app, "POST", "/management-api/pairing-mode/holds", { cookie: venue.managerCookie })).json()) as { holdId: string };
  return { mode, app, holdId };
}
async function secondManagerCookie(): Promise<string> {
  // A second login for the same manager: the claim belongs to a LOGIN, not a person.
  const [mgr] = await suite.db.select({ id: persons.id }).from(persons).where(eq(persons.displayName, "The Manager"));
  const session = await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId: mgr!.id }));
  return `${MANAGEMENT_COOKIE}=${session.token}`;
}
```

Cases (each one `it`):

1. "a right number claims the request for this login; the list says so" — knock (`numbers: () => 42`),
   check with `{ choice: "42", holdId }` → 204; list as the same cookie → `pairingBy: { name: "The Manager", mine: true }`; list as `secondManagerCookie()` → `mine: false`.
2. "a wrong number deletes the request and answers device.join_mismatch" — check with `"43"` → 400
   `device.join_mismatch`; `pendingCount()` is 0.
3. "refuses a request another login has claimed" — first login checks right; the second login's
   check → 409 `join_request.claimed`; its accept → 409 `join_request.unclaimed`; its deny → 409
   `join_request.claimed`; the row still exists.
4. "approval without a claim is refused" — knock, accept straight away → 409 `join_request.unclaimed`.
5. "approves a claimed request under the name the manager typed" — check right, accept with
   `{ name: "  Barra 2  ", profileId }` → 200 `{ name: "Barra 2" }`; the `devices` row's label is
   `Barra 2`; the claim is gone (`mode.claimOf(id)` undefined).
6. "refuses a blank name" — check right, accept `{ name: "   ", profileId }` → 400
   `management.request_invalid` with `params.field === "name"`; the request survives.
7. "a taken name is refused and the request survives for a corrected retry" — enrol "Barra" via
   `enrolDeviceForTest`; check right; accept `{ name: "Barra" }` → 409 `device.name_taken`; accept
   `{ name: "Barra 2" }` → 200.
8. "a claim ends with its hold, and the request is discarded" — take TWO holds (A and B, so the
   window stays open and only the claim's own path can discard the row); check right with hold A;
   release A through the route; `pendingCount()` is 0, `mode.orphanedClaims()` is empty, and the
   device's status (`readJoinStatus` with `mode` as its window) is `not_approved`. Control: the same
   steps releasing B instead leave the row and the claim in place.
9. "discards a device request made before the window last shut" — take hold A, knock, release A,
   take hold B; list → empty; `pendingCount()` 0.
10. "keeps a print agent's request when the window shuts" — take a hold, knock with
    `kind: "print_agent"`, release; `pendingCount()` 1.
11a. "approval after the claim's hold lapsed is refused" — build the holder with
    `now: () => Date.now() + offset` (so its times stay comparable with the rows' real `created_at`);
    take hold A, knock, check right with A; `offset += 2 * 60_000`; take hold B; `offset += 90_000`
    (A has lapsed, B is live, the window never shut); accept → 409 `join_request.unclaimed`.
11. "check needs a live hold" — check with `holdId: randomUUID()` → 409 `device.pairing_hold_lapsed`.
12. "staff are refused check and accept with 403 before the id is judged".

In `join-requests.test.ts` move the "DENIES on a wrong choice…" case to
`checkDeviceJoinNumber` (same assertions: the mismatch result, and that the deletion survives the
transaction), and change the device accept cases to the new input (granted list).

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/join-api.db.test.ts -t "device pairing"`
Expected: FAIL — 404 on `/check`.

- [ ] **Step 3: Implement `join-requests.ts`.** Add, after `sweepLapsed`:

```ts
export type DeviceRequestWindow = Pick<PairingMode, "openSince" | "orphanedClaims">;

/**
 * A device asks only while the window is open, so a device request made before the window last
 * shut, or one whose claim's hold has ended, is discarded. Print-agent requests are left alone: an
 * agent told `not_approved` stops for good (`packages/print-agent/src/agent.ts`), A269.
 *
 * Returns the orphaned-claim ids it deleted. The caller drops those claims only after its
 * transaction commits: dropped here, a rolled-back transaction would bring the row back unclaimed.
 */
export async function discardLapsedDeviceRequests(
  tx: Transaction,
  cfg: TillConfig,
  window: DeviceRequestWindow,
): Promise<string[]> {
  const since = window.openSince();
  const device = and(ownedBy(cfg), eq(joinRequests.kind, "device"));
  await tx
    .delete(joinRequests)
    .where(since === null ? device : and(device, lt(joinRequests.createdAt, since)));
  const orphaned = window.orphanedClaims();
  if (orphaned.length > 0)
    await tx.delete(joinRequests).where(and(device, inArray(joinRequests.id, orphaned)));
  return orphaned;
}

/**
 * Compare the tapped number with a device request's own. A mismatch DELETES the request and is
 * returned, not thrown, so the deletion commits and a wrong tap cannot be retried.
 */
export async function checkDeviceJoinNumber(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  choice: string,
): Promise<{ ok: boolean }> {
  await sweepLapsed(tx, cfg);
  const where = and(ownedBy(cfg), eq(joinRequests.id, id), eq(joinRequests.kind, "device"));
  const [row] = await tx.select({ n: joinRequests.verificationNumber }).from(joinRequests).where(where);
  if (row === undefined) throw new AppError("join_request.not_found", {});
  if (choice === row.n) return { ok: true };
  await tx.delete(joinRequests).where(where);
  return { ok: false };
}
```

Change `acceptDeviceJoinRequest`: input `{ label, profileId, stationId?, watcherId? }`; delete the
`choice` comparison and the `AcceptResult` mismatch branch; insert `label: input.label`; return
`{ deviceId: row.id, name: input.label, formFactor: binding.formFactor }`. Rewrite its header to
say the number was checked earlier by `checkDeviceJoinNumber` and the route checks the claim.
Delete the `AcceptResult` type. Give `readJoinStatus` a fifth parameter `window:
DeviceRequestWindow & Pick<PairingMode, "dropClaim">`; inside its transaction call
`dropped = await discardLapsedDeviceRequests(tx, cfg, window)` after `sweepLapsed`, and after the
transaction `for (const id of dropped) window.dropClaim(id)`. Import `inArray` from drizzle and
`type PairingMode` from `./pairing-mode.js`. Rewrite `JOIN_TTL_MS`'s comment (it says "the same
fifteen minutes as the pairing window", no longer true): it is now only an outer limit on a request
whose window stays open.

In `device.ts` add:

```ts
/** A device's name as a manager typed it: trimmed and never blank. Uniqueness is the index's. */
export function requireDeviceName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") throw new AppError("management.request_invalid", { field: "name" });
  return name;
}
```

- [ ] **Step 4: Implement `join-api.ts`.** Add `"join_request.claimed": 409` and
`"join_request.unclaimed": 409` to `STATUS` and both codes to `errors.ts`. Make both `gated` and
`gatedByRowKind` discard first and drop the orphaned claims only after the transaction commits, and
make `gated` hand its callback the authorising person:

```ts
  const gated = async <T>(
    sessionId: string,
    permission: Permission,
    fn: (tx: Transaction, personId: string) => Promise<T>,
  ): Promise<T> => {
    let dropped: string[] = [];
    const result = await withTransaction(deps.db, async (tx) => {
      dropped = await discardLapsedDeviceRequests(tx, deps.cfg, deps.pairingMode);
      const { authorizedBy } = await authorizeManager(tx, { managementSessionId: sessionId, permission });
      return fn(tx, authorizedBy);
    });
    for (const id of dropped) deps.pairingMode.dropClaim(id);
    return result;
  };
```

(`gatedByRowKind` the same way.) The hold-release route from Task 2 changes so the discard runs
AFTER the release — `gated` discards before its callback, when the released hold is still live:

```ts
      const dropped = await gated(sessionId, "device.manage", async (tx) => {
        deps.pairingMode.release(holdId);
        return discardLapsedDeviceRequests(tx, deps.cfg, deps.pairingMode);
      });
      for (const id of dropped) deps.pairingMode.dropClaim(id);
```

The list route adds `pairingBy`:

```ts
const sessionKey = hashSessionToken(sessionId);
const rows = await gated(sessionId, PERMISSION_FOR[kind], (tx) => listPendingJoinRequests(tx, deps.cfg, kind));
// Device rows only: an agent row keeps today's shape, so the print-agent list pins are untouched.
return c.json(kind === "print_agent" ? rows : rows.map((row) => {
  const claim = deps.pairingMode.claimOf(row.id);
  return { ...row, pairingBy: claim === undefined ? null : { name: claim.personName, mine: claim.sessionKey === sessionKey } };
}));
```

Add the check route:

```ts
  app.post("/management-api/device-join-requests/:id/check", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const sessionKey = hashSessionToken(sessionId);
      const id = c.req.param("id");
      const body = await readJsonBody<{ choice?: unknown; holdId?: unknown }>(c);
      const result = await gated(sessionId, "device.manage", async (tx, personId) => {
        const choice = requireString(body.choice, "choice");
        const holdId = requireString(body.holdId, "holdId");
        if (!isUuid(id)) throw new AppError("join_request.not_found", {});
        const claim = deps.pairingMode.claimOf(id);
        if (claim !== undefined && claim.sessionKey !== sessionKey)
          throw new AppError("join_request.claimed", {});
        if (!deps.pairingMode.hasHold(holdId)) throw new AppError("device.pairing_hold_lapsed", {});
        const checked = await checkDeviceJoinNumber(tx, deps.cfg, id, choice);
        if (checked.ok) {
          const [person] = await tx.select({ name: persons.displayName }).from(persons).where(eq(persons.id, personId));
          // Claimed inside the transaction, so no other check can run between the match and the
          // claim; the check itself writes nothing on a match.
          deps.pairingMode.claim(id, { holdId, sessionKey, personName: person?.name ?? "" });
        }
        return checked;
      });
      // Thrown after the transaction, so the deletion of a wrongly matched request commits.
      if (!result.ok) throw new AppError("device.join_mismatch", {});
      return c.body(null, 204);
    }),
  );
```

Replace the device accept route's body handling:

```ts
      const body = await readJsonBody<{ name?: unknown; profileId?: unknown; stationId?: unknown; watcherId?: unknown }>(c);
      const accepted = await gated(sessionId, "device.manage", (tx) => {
        const label = requireDeviceName(body.name);
        const profileId = requireBodyUuid(body.profileId, "profileId");
        const stationId = optionalBodyUuid(body.stationId, "stationId");
        const watcherId = optionalBodyUuid(body.watcherId, "watcherId");
        if (!isUuid(id)) throw new AppError("join_request.not_found", {});
        if (deps.pairingMode.claimOf(id)?.sessionKey !== hashSessionToken(sessionId))
          throw new AppError("join_request.unclaimed", {});
        return acceptDeviceJoinRequest(tx, deps.cfg, id, { label, profileId, stationId, watcherId });
      });
      deps.pairingMode.dropClaim(id);
      return c.json(accepted, 200);
```

In the deny route, inside the gate, before `denyJoinRequest`: if the row's claim belongs to another
session, throw `join_request.claimed`; after a successful deny call `deps.pairingMode.dropClaim(id)`.
Import `hashSessionToken`, `persons` from `@waitron/identity` and `eq` from drizzle.

- [ ] **Step 5: Implement `device-api.ts` and the helper.** In the knock route, inside the
transaction and before `createJoinRequest`, call
`dropped = await discardLapsedDeviceRequests(tx, deps.cfg, deps.pairingMode)` and after the
transaction `for (const id of dropped) deps.pairingMode.dropClaim(id)`; in the dev auto-accept pass
`{ label: name, profileId: till.id }` (no `choice`). In `/api/device/join/status` pass
`deps.pairingMode` as `readJoinStatus`'s window. In `testing/enrol.ts` call
`acceptDeviceJoinRequest(tx, cfg, made.joinId, { label: input.name, profileId: input.profileId, stationId: input.stationId ?? null, watcherId: input.watcherId ?? null })`
and return `{ deviceId: accepted.deviceId, token: made.token }` (the v8-ignored mismatch branch
goes). Update the accept call in `device.test.ts` the same way (setup).

- [ ] **Step 6: Give existing setups an open window.** A test that creates a device request and
then calls a route or `readJoinStatus` now needs the window open, or the request is discarded
(granted list, "Task 3 setups"): in `join-api.db.test.ts` the list, challenge, deny and pending-cap
groups mount with a holder that has `open()` called; in `join-requests.test.ts` the `readJoinStatus`
calls pass an opened holder as the fifth argument and the `AcceptResult` import goes; in
`device.test.ts` the status read passes an opened holder; `join-api.test.ts` opens a hold and
moves to check-then-accept. The `toEqual` pins of a device list in `join-api.db.test.ts` and
`join-e2e.test.ts` gain `pairingBy: null` (a whole-shape pin gaining a key; every existing value
unchanged).

- [ ] **Step 7: Update the remaining tests to check-then-accept** (granted list): `join-e2e.test.ts`
posts `/check` with the hold it took, then `/accept` with `name`; the wrong-number step posts
`/check` with the wrong number and expects 400 and the device's status `not_approved`.
`device-api.test.ts`'s dev auto-accept case keeps its assertions.

- [ ] **Step 8: Run**

Run: `pnpm --filter @waitron/server exec vitest run src/join-api.db.test.ts src/join-api.test.ts src/join-requests.test.ts src/join-e2e.test.ts src/device-api.test.ts src/device.test.ts src/pairing-mode.test.ts src/print-api.test.ts src/print-agent-e2e.test.ts`
Expected: PASS. Then `pnpm --filter @waitron/server typecheck` — PASS.

- [ ] **Step 9: Prove the claim guard by deletion.** Delete the `claimOf(id)?.sessionKey !==` line
in the accept route, run case 3 and case 4, see them fail, restore it. Write the experiment in the
PR.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src
git commit -s -m "Check a device's number first, then approve it under the name the manager types"
```

### Task 4: The dashboard client and one hold controller for both screens

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (types and methods)
- Create: `apps/dashboard/src/api/pairing-hold.ts`
- Create: `apps/dashboard/src/api/pairing-hold.test.ts`
- Create: `apps/dashboard/src/i18n/form-message.ts` (`bottomMessage`, `refusal`, moved)
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (agent dialog uses the controller)
- Test: `apps/dashboard/src/api/client.test.ts`, `apps/dashboard/src/screens/printers-screen.test.ts`,
  `apps/dashboard/src/screens/printers-screen.a11y.test.ts`

**Interfaces:**
- Consumes: Task 2 and 3 routes.
- Produces:

```ts
// client.ts
export interface PairingModeState { open: boolean; openUntil: string | null; deviceAddress: string }
export interface JoinRequestRow { id: string; kind: "device" | "print_agent"; label: string; createdAt: string; pairingBy: { name: string; mine: boolean } | null }
pairingMode(): Promise<PairingModeState>;
takePairingHold(): Promise<{ holdId: string; openUntil: string }>;
renewPairingHold(holdId: string): Promise<{ openUntil: string }>; // call through api.background
releasePairingHold(holdId: string): Promise<void>;
checkDeviceJoinNumber(id: string, input: { choice: string; holdId: string }): Promise<void>;
acceptDeviceJoinRequest(id: string, input: { name: string; profileId: string; stationId?: string; watcherId?: string }): Promise<{ deviceId: string; name: string; formFactor: FormFactor }>;
// removed: openPairingMode, renewPairingMode, closePairingMode
// pairing-hold.ts
export const PAIRING_RENEW_MS = 60_000;
export type PairingHoldStatus = "idle" | "held" | "lapsed" | "failed";
export class PairingHold {
  constructor(api: () => DashboardApi, onChange: (status: PairingHoldStatus, errorCode: string | null) => void, renewMs?: number);
  get holdId(): string | null;
  get status(): PairingHoldStatus;
  start(): Promise<void>; // takes a hold, then renews every renewMs
  stop(): void; // stops renewing and releases the hold (fire and forget)
}
```

- [ ] **Step 1: Write the failing controller tests** (`pairing-hold.test.ts`, fake timers):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "./client.js";
import { PairingHold } from "./pairing-hold.js";

afterEach(() => vi.useRealTimers());

function fakeApi(over: Partial<DashboardApi> = {}) {
  const api = {
    takePairingHold: vi.fn().mockResolvedValue({ holdId: "h1", openUntil: "x" }),
    renewPairingHold: vi.fn().mockResolvedValue({ openUntil: "y" }),
    releasePairingHold: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as DashboardApi;
  (api as { background: DashboardApi }).background = api;
  return api;
}

describe("PairingHold", () => {
  it("takes a hold, renews it every minute, and releases it on stop", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const changes: string[] = [];
    const hold = new PairingHold(() => api, (s) => changes.push(s), 60_000);
    await hold.start();
    expect(hold.holdId).toBe("h1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.renewPairingHold).toHaveBeenCalledWith("h1");
    hold.stop();
    expect(api.releasePairingHold).toHaveBeenCalledWith("h1");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.renewPairingHold).toHaveBeenCalledTimes(1);
    expect(changes).toEqual(["held", "idle"]);
  });

  it("reports a lapsed hold and stops renewing", async () => {
    vi.useFakeTimers();
    const api = fakeApi({ renewPairingHold: vi.fn().mockRejectedValue({ code: "device.pairing_hold_lapsed" }) });
    const changes: string[] = [];
    const hold = new PairingHold(() => api, (s) => changes.push(s), 60_000);
    await hold.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(api.renewPairingHold).toHaveBeenCalledTimes(1);
    expect(hold.status).toBe("lapsed");
    expect(hold.holdId).toBeNull();
  });

  it("stops renewing after a 401", async () => {
    vi.useFakeTimers();
    const api = fakeApi({ renewPairingHold: vi.fn().mockRejectedValue({ code: "management_session.expired" }) });
    const hold = new PairingHold(() => api, () => {}, 60_000);
    await hold.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(api.renewPairingHold).toHaveBeenCalledTimes(1);
    expect(hold.status).toBe("failed");
  });

  it("keeps renewing after a transient failure", async () => {
    vi.useFakeTimers();
    const renew = vi.fn().mockRejectedValueOnce({ code: "connection.failed" }).mockResolvedValue({ openUntil: "y" });
    const api = fakeApi({ renewPairingHold: renew });
    const hold = new PairingHold(() => api, () => {}, 60_000);
    await hold.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(hold.status).toBe("held");
  });

  it("releases a hold whose take answers after stop", async () => {
    let resolve!: (v: { holdId: string; openUntil: string }) => void;
    const api = fakeApi({ takePairingHold: vi.fn(() => new Promise((r) => (resolve = r))) });
    const hold = new PairingHold(() => api, () => {}, 60_000);
    const started = hold.start();
    hold.stop();
    resolve({ holdId: "late", openUntil: "x" });
    await started;
    expect(api.releasePairingHold).toHaveBeenCalledWith("late");
    expect(hold.holdId).toBeNull();
  });

  it("a second start after the first finished releases the first hold", async () => {
    const take = vi.fn().mockResolvedValueOnce({ holdId: "h1", openUntil: "x" }).mockResolvedValueOnce({ holdId: "h2", openUntil: "x" });
    const api = fakeApi({ takePairingHold: take });
    const hold = new PairingHold(() => api, () => {}, 60_000);
    await hold.start();
    await hold.start();
    expect(api.releasePairingHold).toHaveBeenCalledWith("h1");
    expect(hold.holdId).toBe("h2");
  });

  it("reports a refused take as failed with its code", async () => {
    const api = fakeApi({ takePairingHold: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }) });
    const seen: [string, string | null][] = [];
    const hold = new PairingHold(() => api, (s, e) => seen.push([s, e]), 60_000);
    await hold.start();
    expect(seen).toEqual([["failed", "authorization.not_permitted"]]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/pairing-hold.test.ts`
Expected: FAIL — cannot resolve `./pairing-hold.js`.

- [ ] **Step 3: Implement `pairing-hold.ts`**

```ts
import { codeOf } from "../i18n/codes.js";
import type { DashboardApi } from "./client.js";

export const PAIRING_RENEW_MS = 60_000;
export type PairingHoldStatus = "idle" | "held" | "lapsed" | "failed";

/** Codes after which renewing again cannot succeed: the hold or the login is gone. */
const FINAL = new Set(["device.pairing_hold_lapsed", "management_session.required", "management_session.expired", "authorization.not_permitted", "person.suspended"]);

/** Holds the venue's join window open for as long as one dashboard dialog is open. */
export class PairingHold {
  #holdId: string | null = null;
  #status: PairingHoldStatus = "idle";
  #epoch = 0;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly api: () => DashboardApi,
    private readonly onChange: (status: PairingHoldStatus, errorCode: string | null) => void,
    private readonly renewMs = PAIRING_RENEW_MS,
  ) {}

  get holdId(): string | null {
    return this.#holdId;
  }

  get status(): PairingHoldStatus {
    return this.#status;
  }

  async start(): Promise<void> {
    // A second start must not leak the first hold and its timer.
    if (this.#holdId !== null || this.#timer !== undefined) this.stop();
    const epoch = ++this.#epoch;
    try {
      const { holdId } = await this.api().takePairingHold();
      if (epoch !== this.#epoch) {
        void this.api().releasePairingHold(holdId).catch(() => undefined);
        return;
      }
      this.#holdId = holdId;
      this.#set("held", null);
      this.#timer = setInterval(() => void this.#renew(epoch), this.renewMs);
    } catch (error) {
      if (epoch === this.#epoch) this.#set("failed", codeOf(error));
    }
  }

  stop(): void {
    this.#epoch++;
    clearInterval(this.#timer);
    this.#timer = undefined;
    const holdId = this.#holdId;
    this.#holdId = null;
    if (holdId !== null) void this.api().releasePairingHold(holdId).catch(() => undefined);
    if (this.#status !== "idle") this.#set("idle", null);
  }

  async #renew(epoch: number): Promise<void> {
    const holdId = this.#holdId;
    if (holdId === null) return;
    try {
      // Test stubs have no `background`; the real client always does (printers-screen.ts does the same).
      const api = this.api();
      await (api.background ?? api).renewPairingHold(holdId);
    } catch (error) {
      const code = codeOf(error);
      if (epoch !== this.#epoch || !FINAL.has(code)) return;
      clearInterval(this.#timer);
      this.#timer = undefined;
      this.#holdId = null;
      this.#set(code === "device.pairing_hold_lapsed" ? "lapsed" : "failed", code);
    }
  }

  #set(status: PairingHoldStatus, errorCode: string | null): void {
    this.#status = status;
    this.onChange(status, errorCode);
  }
}
```

(The first test's expected `["held", "idle"]` relies on `stop()` reporting `idle` once; keep it.)

- [ ] **Step 4: Change `client.ts`** to the produced interface: update `PairingModeState` and
`JoinRequestRow`; replace `openPairingMode` / `renewPairingMode` / `closePairingMode` with:

```ts
  takePairingHold(): Promise<{ holdId: string; openUntil: string }> {
    return this.#request("/management-api/pairing-mode/holds", "POST");
  }

  /** The route leaves the session's idle clock alone; call it through `background`. */
  renewPairingHold(holdId: string): Promise<{ openUntil: string }> {
    return this.#request(`/management-api/pairing-mode/holds/${holdId}/renew`, "POST");
  }

  releasePairingHold(holdId: string): Promise<void> {
    return this.#request<void>(`/management-api/pairing-mode/holds/${holdId}`, "DELETE");
  }

  /** A wrong `choice` deletes the request; the server answers `device.join_mismatch`. */
  checkDeviceJoinNumber(id: string, input: { choice: string; holdId: string }): Promise<void> {
    return this.#request<void>(`/management-api/device-join-requests/${id}/check`, "POST", input);
  }
```

and change `acceptDeviceJoinRequest`'s input to `{ name, profileId, stationId?, watcherId? }`.
Update `client.test.ts` (granted list): the GET case's state gains `deviceAddress` and loses
`refusedRecently`; add one case per new method asserting method, path and body; the background
renewal case at the end of the file points at `renewPairingHold("h1")` and its path.

- [ ] **Step 5: Move the agent dialog onto the controller** in `printers-screen.ts`: delete
`#pairingOperations`, `#renewPairingAt`, `#setPairing`; add
`readonly #hold = new PairingHold(() => this.api, (status, code) => { this.holdStatus = status; if (code !== null && status === "failed") this.errorKey = code; });`
with `@state() private holdStatus: PairingHoldStatus = "idle"`. `#openAgentModal` calls
`void this.#hold.start()`; `#stopAgentModal` calls `this.#hold.stop()`; `#scanAgents` no longer
opens the window (it only reads the queue); `#agentTick` no longer renews. `#renderPairing` loses the
refused line; it shows `pairing-until` from the live `pairingMode` query as today. When
`holdStatus === "lapsed"` render, above the waiting list,
`<p role="status" class="hold-lapsed" data-test="hold-lapsed">${t("pairing.hold_lapsed")} <wt-button size="sm" data-test="hold-restart" @click=${() => void this.#hold.start()}>${t("pairing.hold_restart")}</wt-button></p>`
(not `wt-notice`: that one fades out after `duration` and has no tone). Style `.hold-lapsed` with
`color: var(--wt-color-danger)` and token spacing.

Move `bottomMessage` and `refusal` from `printers-screen.ts` (the two consts after its imports) into
a new `apps/dashboard/src/i18n/form-message.ts`, exported unchanged, and import them in
`printers-screen.ts`; Task 5 imports them too.
Delete `printers.pairing_refused` from both locales. Update the printers tests (granted list): the
stubs gain `takePairingHold`, `renewPairingHold`, `releasePairingHold` in place of the three removed
methods, `SHUT`/`OPEN` lose `refusedRecently` and gain `deviceAddress`; "opens pairing automatically
and closes it with the agent modal" asserts `takePairingHold` once on open and
`releasePairingHold("h1")` on close; add a case "shows the lapsed notice and takes a new hold on
Start again".

Add the shared strings to `apps/dashboard/src/i18n/strings.ts`:

```ts
  "pairing.hold_lapsed": "No longer accepting devices",
  "pairing.hold_restart": "Start again",
// es-ES
  "pairing.hold_lapsed": "Ya no se aceptan dispositivos",
  "pairing.hold_restart": "Volver a empezar",
```

and to `apps/dashboard/src/i18n/codes.ts` (EN / ES):

```ts
  "device.pairing_hold_lapsed": {
    en: "Devices can no longer ask to join from this dialog. Start again to keep accepting them",
    es: "Este diálogo ya no acepta dispositivos. Vuelve a empezar para seguir aceptándolos",
  },
  "join_request.claimed": {
    en: "Another manager is pairing this device",
    es: "Otro responsable está emparejando este dispositivo",
  },
  "join_request.unclaimed": {
    en: "Tap the number shown on the device first",
    es: "Primero toca el número que muestra el dispositivo",
  },
```

- [ ] **Step 6: Run**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/pairing-hold.test.ts src/api/client.test.ts src/screens/printers-screen.test.ts src/screens/printers-screen.a11y.test.ts`
Expected: PASS. Then `pnpm --filter @waitron/dashboard typecheck` — it fails only in
`devices-screen.ts`, which Task 5 rewrites.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/api apps/dashboard/src/screens/printers-screen*.ts apps/dashboard/src/i18n
git commit -s -m "Hold the join window from the dashboard with one controller shared by both dialogs"
```

### Task 5: The Add a device dialog and the Pair dialog

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts`
- Test: `apps/dashboard/src/screens/devices-screen.test.ts`, `apps/dashboard/src/screens/devices-screen.a11y.test.ts`

**Interfaces:**
- Consumes: Task 4's client methods and `PairingHold`; `toDataURL` from `qrcode` (as
  `apps/dashboard/src/screens/profile-screen.ts` uses it).
- Produces: `data-test` hooks the tests use — `open-add-device`, `add-device-modal`, `device-qr`,
  `device-address`, `waiting-row-<id>`, `pair-<id>`, `being-paired-<id>`, `waiting-empty`,
  `added-device`, `hold-lapsed`, `hold-restart`, `pair-modal`, `[data-choice]`, `pair-name`,
  `pair-profile`, `pair-binding`, `pair-submit`, `pair-cancel`.

Screen behaviour (spec §3):

- The page heading row holds `wt-button variant="primary" data-test="open-add-device"`
  (`devices.add`); the empty list also offers it. The `#renderPairing` card, the join panel,
  `armedDenyId`, `#onDeny`, `#deny`'s row button, `#openPairing`, `#closePairing`,
  `#renderJoinRequest` and the old `#renderAcceptDialog` go.
- Opening: `addingDevice = true`, `void this.#hold.start()`, read `this.api.pairingMode()` once for
  `deviceAddress`, then `this.qr = await this.qrFor(address)`, where
  `@property({ attribute: false }) qrFor = (text: string) => toDataURL(text, { margin: 1, width: 192 })`
  lets a test see what the code encodes.
  Closing (Close button, Escape, leaving the screen in `disconnectedCallback`): `this.#hold.stop()`,
  clear `addedName`, close any Pair dialog after discarding its request (below).
- The Add dialog (`wt-modal data-test="add-device-modal" heading=${t("devices.add_title")}`):
  1. `<img data-test="device-qr" src=${this.qr} alt=${t("devices.qr_alt")}>` and
     `<p class="hint">` with `devices.add_hint` where `{address}` is
     `<code data-test="device-address">${address}</code>`.
  2. When `holdStatus === "lapsed"`, the `hold-lapsed` notice and `hold-restart` button (Task 4's
     strings). When `holdStatus === "failed"` (the take was refused, or the login lapsed), the
     same `hold-restart` button with the failure's `codeMessage` instead of `pairing.hold_lapsed`.
     While there is no live hold (`this.#hold.holdId === null`) every Pair button is disabled.
  3. `addedName !== null` → `<p role="status" data-test="added-device">` with `devices.added`.
  4. A list of `pendingJoins` (live `joinRequests("device")` query, already watched): each row the
     request's label and, if `pairingBy !== null && !pairingBy.mine`, `<span data-test="being-paired-…">`
     with `devices.being_paired_by` (`{name}`); otherwise `wt-button data-test="pair-<id>"`
     (`devices.pair`, `aria-label` = `devices.pair` + label). No Deny. Empty →
     `<p data-test="waiting-empty">` with a `wt-spinner` and `devices.waiting`.
  5. Footer `wt-form-actions` with Close in its `cancel` slot and the bottom message
     (`bottomMessage(refusal(this.addError))`) — where a mismatch is reported.
- The Pair dialog (`wt-modal data-test="pair-modal" heading=${t("devices.pair_title").replace("{name}", label)}`),
  `pairStep: "number" | "settings"`:
  - Opening from `pair-<id>`: if `pairingBy?.mine` go straight to `settings`, else fetch
    `joinChallenge(id)` and show `devices.join_match_prompt` and the three `size="lg"` number
    buttons (`data-choice`, `aria-label` `devices.join_choice_label`). A tap calls
    `checkDeviceJoinNumber(id, { choice, holdId })` (with `holdId = this.#hold.holdId`; if it is
    null, show `codeMessage("device.pairing_hold_lapsed")` and send nothing) with every number
    disabled while it is in flight. `device.join_mismatch` → close the Pair dialog and set `addError` to it.
    Any other refusal → bottom message in the Pair dialog. Success → `pairStep = "settings"`, name
    field pre-filled with the request's label.
  - Settings form: `wt-input name="name" required` (`devices.name`), `wt-combobox name="profileId"
    required` (`devices.device_profile`), and for a `kds` profile the existing binding picker
    (`name="binding"`, required). Field errors follow the Forms contract, modelled on
    `printers-screen.ts`'s `#renderEditAgent` (`formAttempted`, `nameError`): blank name →
    `form.name_required` under Name; no profile → under Profile; kitchen screen with no binding →
    `device.station_required`'s message under Shows. Refusals go under the field they name
    (CLAUDE.md §3, "by what the error CARRIES"): `device.name_taken` → Name;
    `device.station_required`, `station.not_found`, `watcher.not_found` → Shows;
    `device_profile.not_found` → Profile; `management.request_invalid` → the field its
    `params.field` names (`name` → Name, `profileId` → Profile, `stationId`/`watcherId` → Shows);
    anything else → bottom message. Pair stays disabled
    while a field is invalid or a submit is in flight.
  - Pair → `acceptDeviceJoinRequest(id, { name, profileId, stationId?/watcherId? })` → close the Pair
    dialog, `addedName = result.name`, and reload devices.
  - Cancel (button, Escape, backdrop) at either step → `denyJoinRequest(id)` (errors ignored: the
    request may already be gone), close the Pair dialog.

- [ ] **Step 1: Write the failing tests.** In `devices-screen.test.ts`, replace the pairing cases
(granted list) with a describe `add a device`; the stub API gains `takePairingHold`,
`renewPairingHold`, `releasePairingHold`, `checkDeviceJoinNumber`, and `pairingMode` returns
`{ open: false, openUntil: null, deviceAddress: "https://waitron.local" }`. Cases:

1. "Add a device takes a hold and shows the QR code and address" — click `open-add-device`;
   `takePairingHold` called once; `device-address` text is `https://waitron.local`; a spy `qrFor`
   was called with exactly `https://waitron.local` and `device-qr`'s `src` is what it returned. A
   second case with the real `qrFor` checks the `src` starts with `data:image/png`.
2. "closing the dialog releases the hold" — open, click Close → `releasePairingHold("h1")`.
3. "leaving the screen releases the hold" — open, remove the element → `releasePairingHold("h1")`.
4. "lists waiting devices with Pair and no Deny" — two requests; each has `pair-<id>`;
   no `[data-test^=join-deny]` exists.
5. "shows a row another manager is pairing without Pair" — `pairingBy: { name: "Ana", mine: false }`
   → `being-paired-<id>` text is `Being paired by Ana`, no `pair-<id>`.
6. "a right number moves to settings with the name filled in" — click `pair-r1`, click
   `[data-choice="47"]` → `checkDeviceJoinNumber("r1", { choice: "47", holdId: "h1" })`;
   `pair-name`'s value is the request's label.
7. "a wrong number closes Pair and says so in the Add dialog" — `checkDeviceJoinNumber` rejects
   `device.join_mismatch` → no `pair-modal`; the Add dialog's bottom message is
   `codeMessage("device.join_mismatch")`.
8. "Pair sends the typed name, profile and binding, then says Added" — kds profile, pick station s1,
   type `Barra 2`, click `pair-submit` → `acceptDeviceJoinRequest("r1", { name: "Barra 2", profileId: "dpk", stationId: "s1" })`;
   `added-device` text is `Added Barra 2`.
9. "a taken name is shown under Name and Pair stays open" — accept rejects `device.name_taken` →
   the Name field's error is `codeMessage("device.name_taken")`; `pair-modal` still open.
10. "Pair is disabled while the name is blank" — clear the name → `pair-submit` disabled, and after a
    submit attempt the Name error is `t("form.name_required")`.
11. "Cancel discards the request" — at the number step and at the settings step:
    `denyJoinRequest("r1")` called; `pair-modal` gone.
12. "a lapsed hold shows the notice, and Start again takes a new hold" — the controller's renewal
    rejects `device.pairing_hold_lapsed`; fake only the interval timers
    (`vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })`, so animation frames stay real —
    CLAUDE.md §4) and advance 60 s → `hold-lapsed` shown and every Pair button disabled; click
    `hold-restart` → `takePairingHold` called twice in all. The stub must answer through
    `background` too, or set `background` to itself — the controller falls back to the API, but
    say which the test relies on.
13. "a refused take offers Start again" — `takePairingHold` rejects `connection.failed` → its
    `codeMessage` and `hold-restart` shown; Pair disabled.
14. "a refusal naming the station goes under Shows" — accept rejects `station.not_found` → the
    Shows field's error, not the bottom message.

In `devices-screen.a11y.test.ts` replace the "open pairing window" and accept-dialog states with:
the Add dialog with two waiting rows (one being paired by someone else), the Add dialog with
nothing waiting (spinner), the Add dialog with the lapsed notice, the Pair dialog at the number
step, and at the settings step with a Name error — each in both themes, as the file's other states
are scanned.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/devices-screen.test.ts -t "add a device"`
Expected: FAIL — no `open-add-device`.

- [ ] **Step 3: Implement** the screen as described above. Strings to add (EN, then ES), and delete
every `devices.pairing_*`, `devices.join_review`, `devices.join_deny*`, `devices.join_waiting_title`,
`devices.join_none`, `devices.join_dialog_title`, `devices.join_pick_first` key in both locales:

```ts
  "devices.add": "Add a device",
  "devices.add_title": "Add a device",
  "devices.add_hint": "Scan this with the device's camera, or open {address} in its browser, then choose Ask to join.",
  "devices.qr_alt": "QR code with the address devices open to ask to join",
  "devices.waiting": "Waiting for devices…",
  "devices.pair": "Pair",
  "devices.pair_title": "Pair {name}",
  "devices.being_paired_by": "Being paired by {name}",
  "devices.added": "Added {name}",
  "devices.name": "Name",
// es-ES
  "devices.add": "Añadir un dispositivo",
  "devices.add_title": "Añadir un dispositivo",
  "devices.add_hint": "Escanéalo con la cámara del dispositivo, o abre {address} en su navegador, y elige «Solicitar alta».",
  "devices.qr_alt": "Código QR con la dirección que abren los dispositivos para solicitar el alta",
  "devices.waiting": "Esperando dispositivos…",
  "devices.pair": "Emparejar",
  "devices.pair_title": "Emparejar {name}",
  "devices.being_paired_by": "Lo está emparejando {name}",
  "devices.added": "{name} añadido",
  "devices.name": "Nombre",
```

Check the Spanish "Ask to join" label against `apps/till/src/i18n/strings.ts`'s
`device.join_submit` in its `es-ES` block and quote it exactly in `devices.add_hint` (it is «Solicitar alta» at main `501842559`).
Change `device.name_taken` in `codes.ts` to EN "An active device here already has that name —
choose another", ES "Ya hay un dispositivo activo con ese nombre aquí. Elige otro".

- [ ] **Step 4: Run**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/devices-screen.test.ts src/screens/devices-screen.a11y.test.ts`
Expected: PASS. Then `pnpm --filter @waitron/dashboard typecheck` — PASS.

- [ ] **Step 5: Look at it.** Start the stack (`wa-wt demo <worktree-name>`), open Devices, Add a
device. On the dev stack the QR address does not serve the till (the till runs on Vite, port 5190
by default, and `WAITRON_TILL_APP_DIR` is set only in `deploy/Dockerfile`), so pair from a second
browser or a private window opened at the till's dev address instead. Dev mode auto-accepts a
knock (Global Constraints), so to walk the Pair steps run the stack with `WAITRON_ENV` other than
`dev` or exercise them against the stubbed screen in the browser test harness; say in the PR which
you did. Check
the Add dialog, both Pair steps, a wrong number, and a name clash in light and dark at 1280 and 390
px. Save screenshots to the lane's shots folder.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src
git commit -s -m "Add devices through an Add a device dialog with a two-step Pair"
```

### Task 6: The till's message, the docs and the backlog

**Files:**
- Modify: `apps/till/src/i18n/codes.ts:353-356`
- Test: `apps/till/src/i18n/codes.test.ts:42-46`
- Modify: `docs/backlog.md` (A268 → W104 landed, A5 already updated)
- Modify: `docs/developers/conventions-ui.md` only if it describes the 15-minute window or "Allow new
  devices" (grep first: `git grep -n -i "allow new devices\|pairing window\|fifteen minutes" docs/developers`)

- [ ] **Step 1: Write the failing test** — change the two expectations in `codes.test.ts` (granted)
to the new wording below.

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts`
Expected: FAIL on the old wording.

- [ ] **Step 3: Implement**

```ts
  "device.pairing_closed": {
    en: "New devices aren't being accepted right now. Ask a manager to open Add a device in the dashboard.",
    es: "Ahora mismo no se aceptan dispositivos nuevos. Pide a un responsable que abra «Añadir un dispositivo» en el panel.",
  },
```

- [ ] **Step 4: Run** the same command — PASS; then
`pnpm --filter @waitron/till exec vitest run src/screens/till-enrol-screen.test.ts` — PASS (it
compares against `codeMessage`, so it needs no change).

- [ ] **Step 5: Sweep stale claims.** `git grep -n -i -E "allow new devices|refusedRecently|noteRefused|pairing-mode/renew|openPairingMode|closePairingMode|join_review|tried to join" -- apps packages docs/developers README.md`
must print nothing outside historical plans and specs. Update the backlog's A268 entry to say W104
landed (PR number) and what W105 and W106 still owe.

- [ ] **Step 6: Commit**

```bash
git add apps/till/src/i18n docs
git commit -s -m "Tell a refused device to ask for Add a device"
```

Then `/finish-branch` (FULL wave: auth and permissions are a risk trigger, so two Codex run-it
seats).

---

## W105 — The device table and the Edit dialog

### Task 7: One route edits a device

**Files:**
- Modify: `apps/server/src/device-api.ts` (add `PATCH`, delete `assign-device-profile` and `made-here` routes)
- Test: `apps/server/src/device-api.test.ts`

**Interfaces:**
- Consumes: `requireDeviceName` (Task 3), `resolveDeviceBinding`, `firstUsablePrinters`,
  `chooseDevicePrinter` (`@waitron/layouts`), `setMadeHereStations` (`./made-here.js`).
- Produces: `PATCH /management-api/devices/:id` (`device.manage`), body
  `{ name: string; profileId: string; stationId?: string|null; watcherId?: string|null; receiptPrinterId: string|null; paymentSlipPrinterId: string|null; madeHereStationIds: string[] }`
  → `204` | `404 device.not_found` (unknown, malformed or revoked) | `409 device.name_taken` |
  `400 device.binding_invalid { field }` | `400 device.station_required` | `400 management.request_invalid { field }`.

Semantics, all in one `withTransaction`:
1. Read the device; refuse unknown or `active = false` as `device.not_found`.
2. `requireDeviceName(body.name)`; resolve the binding with `resolveDeviceBinding(tx, cfg, { profileId, stationId, watcherId })`.
3. If the profile changed, start from `firstUsablePrinters(tx, profileId, locationId)`. Then, after
   the profile update (`chooseDevicePrinter` reads the profile from the device row,
   `packages/layouts/src/device-printers.ts`), apply a body printer with
   `chooseDevicePrinter(tx, id, role, printerId)` ONLY when it differs from what the row holds at
   that point. `chooseDevicePrinter` accepts only active printers, and a device may still sit on a
   listed printer since switched off: re-sending it unchanged would make every edit of that device
   fail. A refused printer is `device.binding_invalid { field }`.
4. Update `label`, `deviceProfileId`, `stationId`, `watcherId`; a `device.name_taken` from the
   unique index maps as `insertDevice` maps it (factor the try/catch in `device.ts` into
   `mapDeviceNameTaken(error)` and use it in both).
5. `setMadeHereStations(tx, cfg, id, madeHereStationIds)` (validate every id is a UUID first,
   `management.request_invalid { field: "madeHereStationIds" }`).

- [ ] **Step 1: Write the failing tests** (new describe `PATCH /management-api/devices/:id`):
"renames a device whose receipt printer has since been switched off" (the unchanged printer is not
re-checked); renames; "refuses a blank name on edit" (`field: "name"`); a clash with another active device →
409 `device.name_taken`; "a name differing only by surrounding spaces clashes" (" Barra " against
"Barra"); reuses a revoked device's name; refuses a revoked device → 404; changes the
profile and moves the printers to the new profile's first (assert both columns) in the same
request; refuses a printer not on the profile with `device.binding_invalid` and changes nothing
(re-read the row: label unchanged — proves one transaction); kitchen profile without a binding →
`device.station_required`; sets made-here stations; a stored made-here station since disabled is
refused as `setMadeHereStations` refuses it today (`apps/server/src/made-here.ts`) — the dialog must
not send it (Task 8); staff → 403. Delete the `assign-device-profile`
and `made-here` describes (granted list) after porting each of their behavioural assertions that
still applies (the "keeps the device's chosen printers when reassigned to the profile it already
has" case becomes "keeps the printers when the profile is unchanged").

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts -t "PATCH"`; expected 404.
- [ ] **Step 3: Implement** as specified above; delete the two old routes and their imports.
`requireDeviceBinding` (`device.ts`) loses its only caller: delete it and its header comment, which
names the deleted route.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/device.test.ts` — PASS; typecheck — PASS.
- [ ] **Step 5: Prove the one transaction by deletion** — temporarily run the printer check in its
own `withTransaction` after the label update has committed; the "changes nothing" case must fail
(the label changed); restore. Record the experiment in the PR.
- [ ] **Step 6: Commit** — `git commit -s -m "Edit a device's name, profile, printers and made-here stations in one request"`

### Task 8: The device table and the Edit dialog

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts`
- Modify: `packages/ui/src/components/wt-data-table.ts` (`rowClickable`), with
  `wt-data-table.test.ts` and `wt-data-table.a11y.test.ts`
- Modify: `apps/dashboard/src/api/client.ts` (add `updateDevice`; delete `reassignDeviceProfile`, `setDeviceMadeHere`)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/screens/devices-screen.test.ts`, `devices-screen.a11y.test.ts`, `apps/dashboard/src/api/client.test.ts`

**Interfaces:**
- Consumes: Task 7's route; `getDeviceReader` / `setDeviceReader` (existing).
- Produces: `updateDevice(id: string, input: { name: string; profileId: string; stationId?: string | null; watcherId?: string | null; receiptPrinterId: string | null; paymentSlipPrinterId: string | null; madeHereStationIds: string[] }): Promise<void>`;
  `data-test` hooks `devices-table`, `edit-device-modal`, `edit-name`, `edit-profile`,
  `edit-binding`, `edit-receipt-printer`, `edit-slip-printer`, `edit-made-here`, `edit-reader`,
  `edit-save`, `remove-<id>` (in the row menu).

Behaviour (spec §5):
- `wt-data-table data-test="devices-table" viewKey="devices"` with the table labels
  `printers-screen.ts`'s agents table passes. Columns: `name` (label), `profile`, `shows`
  (`#bindingName`, empty for non-kitchen), `status`, `lastSeen`, and `actions` (`pinned: "end"`)
  rendering `dashboard-row-actions` like `#agentActions`: Edit, and two-press Remove
  (`devices.revoke` / `devices.revoke_confirm`) — active devices only. `rowClick` opens Edit for an
  active device only. A flat table has no per-row opt-out today: `rowActivation` is read only on the
  tree path (`packages/ui/src/components/wt-data-table.ts`, `const mode = this.rowActivation?.(row)`),
  and a removed row with an activator that does nothing is an inert button. So add
  `@property({ attribute: false }) rowClickable?: (row: Row) => boolean` to `wt-data-table`, read on
  the flat path where the activator and the `clickable` class are decided, with its own tests in
  `wt-data-table.test.ts` (a row it refuses has no activator and no `clickable` class; others
  unchanged) and an a11y case. `packages/ui` is mutation-tested at 90 (weekly run), so the new
  branch needs a test that fails if it is deleted.
- Edit dialog (`wt-modal`), fields in this order: Name (required), Profile (required, no "none"
  option), Shows (kitchen profiles, required), Receipt printer and Payment slip printer (options =
  the chosen profile's `receiptPrinterIds` / `paymentSlipPrinterIds` mapped to printers, plus "None";
  changing the profile resets each to the first ACTIVE printer in the new profile's list, or None,
  matching the server's `firstUsablePrinters`), Made here (checkboxes, hidden for a kitchen screen as
  today; a stored station that is no longer active is left out of what Save sends, as the deleted
  inline control did — carry over "omits a disabled stored station when saving…" as an Edit dialog
  case), Default card reader (read with `getDeviceReader(id)` when the Edit dialog opens; on a 403,
  hide the field). Delete the list watcher's per-device `getDeviceReader` fetch
  (`devices-screen.ts`, inside the `listDevices` watch): it ran once per active device on every list
  change, and W106's battery reports make list changes frequent.
- Save: `updateDevice(...)`; on success, if the reader changed, `setDeviceReader(...)`. If that
  second call fails, keep the dialog open with the error under the reader field (the device changes
  are saved). Commented decision at the call: one line, "Saved separately: the reader belongs to
  the payments module and its own permission (spec §5)".
- Field errors as in Task 5: `device.name_taken` under Name; `device.binding_invalid` under the
  field its `params.field` names; `device.station_required` under Shows; others at the bottom.
- The device name shows its new value on a running till the next time the till reads its own
  details, at start (`apps/till/src/till-app.ts`, the `getDeviceIdentity` call in its boot); no
  change there.
- Delete the inline controls and their state: `madeHereRefusals`, `madeHerePending`,
  `#madeHereSaving`, `#onMadeHereChange`, `#saveMadeHere`, `#onReassign`, `#renderHardware`,
  `#onReaderChange`, the reassign combobox.

- [ ] **Step 1: Write the failing tests** (replacing the granted list-row cases): the table renders
one row per device with name, profile, shows, status, last seen; clicking an active row opens Edit;
a removed row's click opens nothing and its menu has no Edit; Remove needs two presses and calls
`revokeDevice`; Edit pre-fills every field; changing the profile resets both printers to the new
profile's first; Save sends exactly the `updateDevice` body; a name clash shows under Name; a
printer refusal shows under that printer; a failed reader save leaves the dialog open with the
error under the reader and `updateDevice` called once; without `payments.manage` the reader field is
absent. a11y: the table and the Edit dialog (with a Name error), both themes.
`client.test.ts`: `updateDevice` sends `PATCH` with the body.
- [ ] **Step 2: Run to see them fail** — `pnpm --filter @waitron/dashboard exec vitest run src/screens/devices-screen.test.ts`.
- [ ] **Step 3: Implement.** Strings: `devices.edit_title` "Edit {name}" / "Editar {name}",
`devices.edit` "Edit" / "Editar", `devices.remove` "Remove" / "Quitar", `devices.remove_confirm`
"Confirm remove?" / "¿Confirmar?", `devices.column_shows` "Shows" / "Muestra",
`devices.column_last_seen` "Last seen" / "Visto por última vez", `devices.column_status` "Status" /
"Estado". Replace `devices.revoke*` uses with `devices.remove*` and delete the old keys and
`devices.reassign`, `devices.device_profile_none`, `devices.hardware`.
- [ ] **Step 4: Run** the dashboard tests above and typecheck — PASS.
- [ ] **Step 5: Look at it** — the table and Edit dialog, both themes, 1280 and 390 px; confirm the
row menu stays on screen at 390 px.
- [ ] **Step 6: Commit, update the backlog (A268: W105 landed), `/finish-branch` (FULL wave:
permissions).**

---

## W106 — Battery

### Task 9: Store a device's battery report

**Files:**
- Modify: `packages/db/src/schema/devices.ts`
- Create: `packages/db/drizzle/<next>_device_battery.sql` and its snapshot (generated)
- Modify: `apps/server/src/device-api.ts` (route, list fields)
- Test: `apps/server/src/device-api.test.ts`

**Interfaces:**
- Produces: columns `battery_level` (`smallCount`), `battery_charging` (`flag`),
  `battery_reported_at` (`tsString`), all nullable; `PUT /api/device/battery` (device cookie,
  `requireDevice`) body `{ level: number; charging: boolean }` → `204` | `400 management.request_invalid { field }`;
  `GET /management-api/devices` rows gain `batteryLevel: number | null`, `batteryCharging: boolean | null`,
  `batteryReportedAt: string | null`.

- [ ] **Step 1: Write the failing tests:** a report is stored (all three columns); a second report
within 60 s with the same charging state is not stored (the level stays the first); a charging
change within 60 s is stored; a report after 60 s is stored; `level: 101`, `-1`, `50.5` and
`"50"` are refused naming `level`; `charging: "yes"` refused naming `charging`; no device cookie →
401 `device.unauthorized`; the management list carries the three fields (a whole-shape pin gaining
keys is allowed). Use an injectable clock: add `now?: () => Date` to `DeviceApiDeps` if the file
has none (fixture growth).
- [ ] **Step 2: Run to see them fail** — 404.
- [ ] **Step 3: Add the columns** to `devices.ts`:

```ts
    batteryLevel: smallCount("battery_level"),
    batteryCharging: flag("battery_charging"),
    batteryReportedAt: tsString("battery_reported_at"),
```

Run `pnpm --filter @waitron/db db:generate --name device_battery`. **Read the generated SQL: it must
be exactly three `ALTER TABLE \`devices\` ADD \`…\`` statements.** If drizzle-kit wrote a table
rebuild (`__new_devices`), stop: a rebuild of `devices` deletes or refuses rows in every table
keyed to it (CLAUDE.md §3). Then run `pnpm exec vitest run scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts`
from the root — PASS.
- [ ] **Step 4: Add the route:**

```ts
  app.put("/api/device/battery", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      const body = await readJsonBody<{ level?: unknown; charging?: unknown }>(c);
      const level = body.level;
      if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 100)
        throw new AppError("management.request_invalid", { field: "level" });
      if (typeof body.charging !== "boolean")
        throw new AppError("management.request_invalid", { field: "charging" });
      const charging = body.charging;
      const at = (deps.now?.() ?? new Date()).toISOString();
      await withTransaction(deps.db, async (tx) => {
        const [row] = await tx
          .select({ charging: devices.batteryCharging, reportedAt: devices.batteryReportedAt })
          .from(devices)
          .where(ownDeviceById(device.deviceId));
        // At most one stored report a minute, as for last-seen, unless the charger was plugged or unplugged.
        if (row?.reportedAt != null && row.charging === charging && !sightingDue(row.reportedAt, at)) return;
        await tx
          .update(devices)
          .set({ batteryLevel: level, batteryCharging: charging, batteryReportedAt: at })
          .where(ownDeviceById(device.deviceId));
      });
      return c.body(null, 204);
    }),
  );
```

(`sightingDue` from `./device-session.js`.) Add the three fields to the list route's `select`.
- [ ] **Step 5: Run** the device-api tests and the server typecheck — PASS.
- [ ] **Step 6: Commit** — `git commit -s -m "Store each device's battery level and charging state"`

### Task 10: The till reports its battery

**Files:**
- Create: `apps/till/src/api/battery-report.ts`, `apps/till/src/api/battery-report.test.ts`
- Modify: `apps/till/src/api/client.ts` (`reportBattery`)
- Modify: `apps/till/src/till-app.ts` (start after the device identity is read; stop at the start of
  the next boot and in `disconnectedCallback`)

**Interfaces:**
- Produces:

```ts
// client.ts
reportBattery(report: { level: number; charging: boolean }): Promise<void>; // PUT /api/device/battery
// battery-report.ts
export interface BatteryLike extends EventTarget { level: number; charging: boolean }
export function startBatteryReport(
  send: (report: { level: number; charging: boolean }) => Promise<void>,
  getBattery: (() => Promise<BatteryLike>) | undefined,
): { stop(): void };
```

- [ ] **Step 1: Write the failing tests** with a fake `BatteryLike` (`new EventTarget()` plus
fields): sends `{ level: 82, charging: false }` for `level: 0.82` once ready; sends again on
`levelchange` and on `chargingchange`; rounds `0.825` to `83`; sends nothing when `getBattery` is
`undefined`; sends nothing after `stop()`; a rejected `send` is swallowed (the next change still
sends).
- [ ] **Step 2: Run to see them fail** — `pnpm --filter @waitron/till exec vitest run src/api/battery-report.test.ts`.
- [ ] **Step 3: Implement:**

```ts
export interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
}

/** Reports the battery where the browser exposes it (Chromium-based browsers, over HTTPS). The
 * server stores at most one report a minute, so every change is sent. */
export function startBatteryReport(
  send: (report: { level: number; charging: boolean }) => Promise<void>,
  getBattery: (() => Promise<BatteryLike>) | undefined,
): { stop(): void } {
  let stopped = false;
  let battery: BatteryLike | undefined;
  const report = (): void => {
    if (stopped || battery === undefined) return;
    void send({ level: Math.round(battery.level * 100), charging: battery.charging }).catch(() => undefined);
  };
  if (getBattery !== undefined)
    void getBattery()
      .then((b) => {
        if (stopped) return;
        battery = b;
        b.addEventListener("levelchange", report);
        b.addEventListener("chargingchange", report);
        report();
      })
      .catch(() => undefined);
  return {
    stop() {
      stopped = true;
      battery?.removeEventListener("levelchange", report);
      battery?.removeEventListener("chargingchange", report);
    },
  };
}
```

> **2026-10-05, finish-branch review:** the shipped reporter differs. It sends one report at a time,
> and a change or tick while one is out sends the battery's reading as it is once that send settles;
> a send with no answer is given up after a time limit. It re-sends every five minutes from the
> first report, so while the page runs and its sends are answered a steady battery is stored again
> before it greys at ten minutes. The shipped `#boot` starts the reporter only while the app is
> connected and its boot is still the current one, without the `this.#battery?.stop()` line the
> snippet below puts beside the start; the stop at the top of the boot method stays.

In `till-app.ts`, after `this.deviceId = identity.deviceId;` in the boot sequence:

```ts
      this.#battery?.stop();
      const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
      this.#battery = startBatteryReport(
        (r) => this.api.reportBattery(r),
        nav.getBattery === undefined ? undefined : () => nav.getBattery!(),
      );
```

with `#battery?: { stop(): void }`, and `this.#battery?.stop()` at the top of the boot method and in
`disconnectedCallback`.
- [ ] **Step 4: Run** the new test and `pnpm --filter @waitron/till typecheck` — PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "Report the device's battery from the till"`

### Task 11: The Battery column

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`DeviceRow` gains the three fields)
- Modify: `apps/dashboard/src/screens/devices-screen.ts` (a `battery` column after `shows`)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/screens/devices-screen.test.ts`, `devices-screen.a11y.test.ts`

- [ ] **Step 1: Write the failing tests:** `82%` with a charging mark and `devices.battery_charging`
as its accessible text for a charging device; `82%` alone when not charging; `Not reported` when
`batteryLevel` is null; a report 11 minutes old (inject the screen's clock — add a `now` property
defaulting to `() => new Date()` if the screen has none) is rendered with `part="battery-stale"` and
the text `as of {time}`; a 9-minute-old report is not. a11y: the table with all three states, both
themes.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** the column, placed after Shows and before Status (spec §5's order:
Name, Profile, Shows, Battery, Status, Last seen) (`key: "battery"`, `choosable: "shown"`,
`sortValue: (d) => d.batteryLevel`), styling the stale state through `part="battery-stale"` in the
table cell and `::part(battery-stale)` with `color: var(--wt-color-text-muted)`. Strings:
`devices.column_battery` "Battery" / "Batería", `devices.battery_not_reported` "Not reported" / "Sin
datos", `devices.battery_charging` "Charging" / "Cargando", `devices.battery_as_of` "as of {time}" /
"a las {time}".
- [ ] **Step 4: Run** the dashboard tests and typecheck — PASS.
- [ ] **Step 5: Look at it** on the dev stack with a Chromium tab as a paired device (its battery, or
the "100%, charging" a battery-less machine reports) and a Safari or Firefox device ("Not
reported"), both themes, 390 px.
- [ ] **Step 6: Commit, mark A268 done in the backlog (and that A272 stays open),
`/finish-branch` (FULL wave: migration).**
