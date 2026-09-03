# SP-B2 — Till tab shell + bespoke-screen card wrap — design

- **Track:** Layout designer & device profiles (owner-inserted 2026-09-02).
- **Parent design:** [`2026-09-03-sp-b-grid-editor-and-rendering-design.md`](2026-09-03-sp-b-grid-editor-and-rendering-design.md)
  (SP-B); grand-parent [`2026-09-02-layout-designer-and-device-profiles-design.md`](2026-09-02-layout-designer-and-device-profiles-design.md).
- **Status:** Design drafted 2026-09-03 (owner present; slicing decision resolved below). SP-B1 landed
  #204; SP-B2 is the next slice of SP-B.
- **Author:** brainstormed 2026-09-03, grounded on a full structural map of the post-B1 till.
- **Fiscal gate:** **Not H2.** SP-B2 changes *rendering and navigation*, not sale recording or the
  fiscal chain — but it **must preserve the sale path** (§9): the counter must always render a working
  product-grid/basket/total/tender-pay, and nothing new may block a sale.

---

## 1. Summary

SP-B1 made the till **counter** render its small cards from the device's layout `ProfileDef` (a fluid
CSS grid), with the old region model kept as fallback. Everything else on the till still runs through
the hand-rolled `screen`-enum state machine in `till-app.ts` (`type Screen = "lock" | "counter" |
"ticket" | "schedule" | "floor" | "table-order" | "station" | "expo"`, `till-app.ts:66-67`), and the
four bespoke full-screen elements still carry their own header + Back chrome.

SP-B2 does three things:

1. **A tab shell + drill-in navigation stack** in `till-app`, driven by `profile.tabs`, that replaces
   the `screen`-enum switch for the authenticated operator surfaces. The bespoke header chrome the
   counter carries today relocates to the shell so every tab shares it.
2. **All tabs render through the grid** (not just the counter), and the two **self-contained bespoke
   screens** — **expo** and **floor-plan** — become real full-span cards (their own header/Back chrome
   removed in favour of the shell).
3. **Card gating at render time** — capability→ABSENT and permission→LOCKED (both deferred from B1) —
   plus `visibleWhen` state for the big cards, and the four B1-review follow-ups (§8).

The two **heaviest** bespoke screens — **station** (kds-board; carries device-mode/enrol paths) and
**table-order** (1395 lines, an internal `WorkingOrderStore`, the largest event surface) — are wrapped
in a **second slice, B2.2**.

**Out of scope (later SP-B slices / follow-ons):** the dashboard grid editor + reassign route (**B3**);
old-widget-model removal + `tenant_receipts` rehoming (**B4**); the visual theme editor; NFC
pairing/payment routing; community profile sharing; live card renders in the editor. **Default-profile
*content* changes** (e.g. promoting station/expo to authored tabs, or capability-driven reachability)
are deliberately **not** in SP-B2 — see the decision in §4.3.

## 2. Slicing decision (owner, 2026-09-03)

SP-B2 is the design's flagged **"main schedule risk"** (SP-B §3.4). The sale path runs through the nav
rewrite, and the four bespoke screens total ~3600 lines of ascending complexity. The owner chose a
**two-PR** split (one SP-B2 spec, two implementation plans):

- **B2.1 — tab shell + nav + gating + light wraps (this slice's core, and the risk).** Build the tab
  shell and the transient drill-in stack; render every tab through `till-card-grid`; relocate the
  header chrome to the shell; add capability→ABSENT + permission→LOCKED gating and the big-card
  `visibleWhen` states; and wrap the **two self-contained screens (expo, floor-plan)** as full-span
  cards. Fold in all four B1-review follow-ups (§8). Front-loads the risky nav core with the two easy
  wraps so the model is proven before the heavy screens.
- **B2.2 — wrap the two heavy screens.** Wrap **station** (kds-board — device-mode/enrol paths) and
  **table-order** (the heaviest prop + event surface, internal `WorkingOrderStore`) as full-span
  cards, removing their chrome in favour of the shell. Order: station → table-order (SP-B §6's
  ascending-effort order, minus the two already done in B2.1).

Rejected: **one monolithic B2 PR** (≈4000 lines touched, the sale path exposed throughout a single
un-reviewable diff) and a **finer four-way split** (one landing cycle per screen — more ceremony than
the risk warrants once the nav core is proven).

---

## 3. Current state (grounded, post-B1)

Every reference below is from the current working tree.

### 3.1 The `screen`-enum state machine (to be replaced)

- `type Screen` — eight values (`till-app.ts:66-67`). Single state field `@state() screen` (`:206`);
  the sole mutators are `#setScreen` (`:1728-1731`, records a `diag` nav trail) and the face-gated
  `#goToScreen` (`:1719-1722`), which filters through `HANDHELD_FACES = ["lock","floor","table-order"]`
  (`:79`) — today's only "reachable tab-set" seam.
- `#renderScreen()` (`:1908-1997`) — an exhaustive `switch` mounting one element per screen. Wrapped by
  `keyed(currentLocale(), …)` (`:1902`) so a locale switch rebuilds the subtree. Two enrol **overlays**
  (`handheldEnrolling`/`tillEnrolling`, `:1889-1898`) and a supervisor-override dialog (`:1877-1884`)
  render above the switch.
- **Navigation is event-driven.** Composed events wired on the outer `<div class="app">` (`:1826-1872`)
  drive `#setScreen`/`#goToScreen`: `show-station`→`station`, `show-expo`→`expo`,
  `show-schedule`→`schedule`, `show-floor`→(load then)`floor`, `open-table`→(load then)`table-order`,
  `back-to-floor`→`floor`, `back-to-counter`→`counter` (face-gated), `new-sale`→`counter`,
  `logout`→`lock`. Payment success sets `ticket` (`confirm-payment`/`collect-card`/`collect-order`/
  `pay-tab`). There is **no** literal `open-ticket`/`open-schedule` event — ticket is reached only via
  payment; schedule via `show-schedule`.
- `#boot()` (`:519-619`): `api.getTill()` populates fields incl. **`this.profile = till.profile`**
  (`:562`, B1); then a device probe sets `handheldMode`/`deviceMode`/`tillEnrolled` and, for a
  `kds_station`, prefetches the station and `#setScreen("station")`.
- `#counterTab()` (`:1820-1822`) — `this.profile?.tabs.find(t => t.key === "counter")` — the **only**
  place `profile.tabs` is read; `profile.capabilities` is **never read** anywhere in the till today.

### 3.2 The header/nav chrome lives in the counter screen

`till-app` renders no operator chrome of its own; all of it lives in `till-counter-screen`'s header
(`till-counter-screen.ts:383-411`): the `Waitron` wordmark (`:386`), six `wt-button`s — **Allergens**
(local overlay), **Floor** (`show-floor`), **Station** (`show-station`), **Expo** (`show-expo`),
**Schedule** (`show-schedule`), **Logout** (`logout`) — the operator name, and a `till-language-chooser`
(`locale-selected`). B1 added `#gridBody(tab)` (`:360-378`) which renders the menu controls then
`<till-card-grid>` when `counterTab` is set, region fallback otherwise (`:421-422`).

### 3.3 The four bespoke screens (chrome to remove; seams that already exist)

Each renders its own `<header class="head">` + `.back` button and emits its own `back-*` event — the
chrome B2 removes in favour of the shell. Three already carry a partial "embeddable" seam.

| screen (lines) | self-fetches? | own back event | embeddable seam today | card type(s) |
| --- | --- | --- | --- | --- |
| `till-expo-screen` (813) | **yes** (`getExpoQueue`, `reprintOrder`, fire levers) | `back-to-counter` | — | `expo` |
| `till-floor-screen` (785) | mostly props; `.api` only in edit-mode | `open-table`, `back-to-counter`, `floor-refresh` | **`canExitToCounter`** (`:345`) | `floor-plan`, `table-layout-editor` (edit mode) |
| `till-station-screen` (614) | **yes** (heavy) | `back-to-counter` | `deviceMode`→`showBack:false` | `kds-board` |
| `till-table-order-screen` (1395) | **no** (all writes via app) | `back-to-floor`, `pay-tab`, `send-round`, `serve-line`, `set-status`, `move-tab`, `merge-tabs`, `transfer-lines`, … | **`canSettle`** (`:364`) | `table-order` |

**B2.1 wraps `expo` + `floor-plan` (both self-contained/props-driven, low event surface).** **B2.2
wraps `station` + `table-order`.** `table-layout-editor` (floor's edit mode) rides along with
`floor-plan` in B2.1 and is the one **permission→LOCKED** case reachable in B2.1 (`requiredPermission:
till.configure`, `card-contract.ts:94`).

### 3.4 The renderer + gating gaps (B1 left these for B2)

- `card-grid.ts` (`:91-137`) returns `nothing` for the five big card types + `notifications`, installs
  **no capability/permission gating**, and computes **no `visibleWhen` state** for the big cards
  (`#currentState` `default → undefined`, `:148-157`) — so a big card carrying a `visibleWhen` gate
  would silently fail **closed** today (B1-review follow-up (d)).
- The only client permission signal is `canConfigureTill` → `this.canEdit` (`till-app.ts:642`,
  from the session's server-computed `roleHasPermission(role,"till.configure")`). No general permission
  set reaches the till. **This is sufficient**: `till.configure` (`table-layout-editor`) is the **only**
  `requiredPermission` in the whole card catalogue (`card-contract.ts`), so permission→LOCKED maps to
  exactly this one signal.
- Capabilities: `tender-pay` needs `integrated-card-payment` (but is sale-critical and **also takes
  cash** — it must **always render**, B1 constraint); `kds-board` needs `act-as-kds`. So capability→
  ABSENT has one real card case (`kds-board`, arriving in B2.2) plus the always-render exception
  (`tender-pay`). The **mechanism** is built in B2.1; its first gated card lands in B2.2.

---

## 4. B2.1 — the tab shell + navigation

### 4.1 The tab shell

The authenticated, non-drill-in surface becomes a **shell** that renders: (1) a **tab bar** from
`profile.tabs` (key/title; the active tab is app state), (2) the **relocated header chrome** (§4.2),
and (3) the active tab's **grid** via `till-card-grid` (every tab, not just the counter). The shell
replaces the `counter`/`floor`/`station`/`expo` arms of `#renderScreen`; `lock` and the enrol/override
overlays continue to render **instead of** the shell (they are pre-login or modal).

- **Fluid width, no reflow** (SP-B §2(a)): each tab renders at its authored `columns` count with
  `repeat(columns, 1fr)`; the column count never changes at runtime. Already true of B1's grid.
- **Tab switching** is both user-driven (tapping the bar) and programmatic (a card event can request a
  tab, §4.4).
- **`keyed(currentLocale(), …)`** stays wrapped around the shell body so a locale switch still rebuilds.

### 4.2 Header-chrome relocation (behaviour-preserving)

The counter header's chrome moves to the shell so it is shared by every tab. It splits into two kinds:

- **Tab bar** — one entry per `profile.tabs` entry (e.g. the default till's `counter`, `floor`).
- **App-level affordances** — the buttons for surfaces the profile does **not** author as a tab, plus
  session controls: **Allergens** (overlay, unchanged), **Schedule** (drill-in), **Logout**,
  the **language chooser**, and the operator name. **Station** and **Expo** are also relocated here as
  affordances **on a till** (see §4.3), each pushing its wrapped screen as a drill-in. An affordance is
  suppressed when its surface is already an authored tab (no duplicate Floor button when `floor` is a
  tab) — the affordance set is `{all today's buttons} − {surfaces present as tabs}`.

The `till-counter-screen` header is **emptied** of this chrome (it moves up to the shell); its body —
menu controls + `till-card-grid` (or the region fallback until B4) — is what the counter tab renders.

### 4.3 Reachability decision — keep it profile-neutral in B2.1

A pure tab model would let a device reach **only** its authored tabs. The default till profile has
`counter` + `floor` only (`default-profiles.ts`), so a naive rewrite would **drop** today's access to
**station / expo / schedule** from the counter header — a behaviour change, and worse, one entangled
with capability semantics (a non-`act-as-kds` till's kds-board would be absent).

**Decision: B2.1 preserves today's reachability exactly and does not change profile *content* or
introduce capability-driven reachability.** Station/Expo/Schedule stay reachable as **relocated
app-level affordances** (§4.2) that push the wrapped screens as **drill-ins** (§4.4) — the same
"one element, two mount points" duality SP-B §5 already grants `table-order`. `profile.tabs` drives the
tab bar; the affordances cover everything a tab does not. Nothing a till can reach today becomes
unreachable.

Deferred to **B3** (the editor, where the owner authors profiles): promoting station/expo to authored
tabs, and any capability-gated *reachability* (a till without `act-as-kds` not surfacing kds-board).
Card-level capability→ABSENT gating (§5) still ships in B2.1 as a **mechanism**; it simply has no
till-reachable card to hide until a profile authors a kds-board card (B2.2 wraps the card; B3 authors
it). Rejected alternative: change `DEFAULT_PROFILES` in B2.1 — rejected because it couples the nav
rewrite to a product decision about default content (which B1 explicitly deferred: "revisit
default-profile content separately if wanted", backlog #204 note) and would make the risky slice also
the one that silently changes what a device can reach.

### 4.4 The drill-in stack

A small **app-level stack** of transient surfaces the profile does **not** author, layered over the
shell (SP-B §5). Members: a chosen table's **table-order**, the **ticket/receipt** view, the
**schedule**, and — per §4.3 — a till's **station** and **expo** when reached from an affordance rather
than an authored tab. Each existing composed event maps onto push/pop with **no flow lost**:

| today (`screen` transition) | B2.1 (drill-in stack) |
| --- | --- |
| `open-table` → `table-order` | push `table-order` (with the loaded tab context) |
| `back-to-floor` | pop to the `floor` tab |
| `back-to-counter` | pop to the `counter` tab (drops the face-gate; see below) |
| `show-schedule` → `schedule` | push `schedule` |
| `show-station`/`show-expo` | push `station`/`expo` (till affordance) |
| payment success → `ticket` | push `ticket` |
| `new-sale` | pop to `counter`, clear basket |

- The stack holds the **transient** surface; the underlying active **tab** is unchanged beneath it, so
  a pop returns exactly where the operator was. The `diag` nav trail (`#setScreen` today) is preserved
  by recording pushes/pops.
- **Handheld faces.** `HANDHELD_FACES` (`:79`) is superseded by the handheld's **profile.tabs** (a
  handheld profile authors the tabs it should show — e.g. `floor`, `order`). B2.1 wires the handheld's
  reachable set from its profile's tabs; a handheld's `order` tab mounts `table-order` as a **card**
  (SP-B §5's other mount point). Where a handheld today lands on `floor` after login, it lands on its
  profile's first/`floor` tab.
- The **enrol overlays** and **override dialog** are unchanged — they remain full-surface, above the
  shell and stack.

---

## 5. Card gating at render — B2.1 builds the mechanism (SP-B §7)

Three axes, kept separate so the fiscal-sensitive path stays safe:

1. **Capability → ABSENT.** The renderer skips a card whose `requiredCapability` is not present,
   collapsing its grid cell (as B1 already collapses a `nothing` cell). "Present" = the card's
   capability is in the resolved **`profile.capabilities`** the client received. **Exception:**
   `tender-pay` is sale-critical and takes cash — it **always renders** regardless of
   `integrated-card-payment` (a hard-coded carve-out with a test pinning it; §9). First non-exception
   card is `kds-board` (`act-as-kds`), whose wrap lands in B2.2 — B2.1 ships and tests the mechanism
   with a synthetic gated card and the `tender-pay` exception.
2. **Permission → LOCKED in place.** A card whose `requiredPermission` the operator lacks renders a
   **locked overlay** (visible but non-interactive) rather than being absent — never "looks usable,
   fails on tap". The only `requiredPermission` in the catalogue is `till.configure`
   (`table-layout-editor`), mapped from the session `canConfigureTill` → `canEdit` the app already
   learns (`till-app.ts:642`). B2.1 has a **real** case here: floor's edit-mode
   (`table-layout-editor`) card is locked when `canEdit` is false.
3. **Runtime data → `visibleWhen`.** Each card computes its declared states; a card renders only when
   its current state is in `visibleWhen` (absent/empty ⇒ always). B2.1 **adds the state computations
   for the big cards it wraps** — `expo`/`kds-board` declare `has-tickets`/`idle` (`card-contract.ts:
   102-116`); `floor-plan` declares none (always shown). This closes B1-review follow-up (d): a big
   card with a `visibleWhen` gate no longer silently fails **closed** for want of a state mapping.

The gating lives at the **grid/card-host seam** (`card-grid.ts`), so the same seam the B3 editor's
placeholder tiles will occupy stays the single place gating is expressed.

Capability/permission inputs reach `till-card-grid` as new props threaded from `till-app` (the
resolved `profile.capabilities` and `canEdit`), keeping the grid dumb (server is authoritative on
validation; the client trusts the shape and gates the view).

---

## 6. Wrapping expo + floor-plan as cards — B2.1 (SP-B §6)

For each of the two screens:

- A **thin full-span card** in the card registry mounts the existing Lit element in the card host. The
  element keeps its internals; only its **outer chrome** changes.
- The screen's own `<header class="head">` + `.back` button are **removed**; the shell's tab bar / the
  drill-in stack's back affordance provide navigation (floor's `canExitToCounter` seam is the
  precedent — generalised to "the shell owns chrome").
- **Data at the card/host boundary.** `expo` self-fetches via `.api` (needs only `api` + `fireControl`
  threaded through the card). `floor-plan` renders from `zones`/`tables` props the app already loads on
  `show-floor`; the card threads them plus `api`/`canEdit`. Floor's functional chrome that is **not**
  Back — its `view-toggle` and `edit-toggle` (`floor-screen.ts:522-555`) — stays **inside** the card
  (it is body function, not shell chrome).
- **Behaviour preserved.** Every composed event each screen emits keeps working against the shell/stack
  (expo's `back-to-counter`; floor's `open-table`/`floor-refresh`/`back-to-counter`). The screens' own
  behavioural test assertions are **kept** and re-pointed at the wrapped mount (a rewritten-to-match
  test hides the regression — CLAUDE.md §4).

`floor-plan` as a card can be placed in the `floor` **tab** (default) and also pushed as a drill-in;
`expo` is reached as a till affordance drill-in in B2.1 (an authored `expo` tab is a B3 authoring
choice, §4.3).

## 7. B2.2 — wrapping station + table-order

Same wrapping recipe (§6), applied to the two heavy screens; ships as the second PR.

- **station (`kds-board`).** Remove the `#renderQueueSurface` header + `.back` (`station-screen.ts:
  493-517`) and the enrol view's header. The **device-mode/enrol** paths (`deviceMode` →
  `#renderDevice`, the `deviceView:"enrol"` flow) are **retained** — a `kds_station` device still boots
  straight into the station surface (`till-app` `#boot` device probe, §3.1), which in the shell model
  means booting into the profile's kds-board tab. `kds-board`'s `act-as-kds` capability→ABSENT gate
  (mechanism from B2.1) gets its **first real card** here; `has-tickets`/`idle` `visibleWhen` states
  are wired.
- **table-order.** The heaviest: ~12 props, an internal round-composing `WorkingOrderStore`, and the
  largest event surface (`send-round`/`serve-line`/`set-status`/`move-tab`/`merge-tabs`/
  `transfer-lines`/`pay-tab`/… — `table-order-screen.ts`). Mounted **two ways** (SP-B §5): a full-span
  **card** in a handheld's `order` tab, and a **drill-in** on a till (pushed from floor's `open-table`).
  Its `canSettle` seam (`:364`) is the precedent for the shell owning settle context. Its `.drawer-handle`
  (pending badge) stays inside the card (body function). All composed events keep working against the
  app handlers unchanged (the app still owns every write — §3.3, it does not self-fetch).

B2.2 is planned as its **own** implementation plan once B2.1 has landed and proven the shell/stack.

---

## 8. B1-review follow-ups, folded in (all B2.1)

From the backlog (#204 review):

- **(a) capability→ABSENT + permission→LOCKED gating** — §5. Mechanism in B2.1; `table-layout-editor`
  permission-lock is a real B2.1 case; `kds-board` capability-absent's first real card is B2.2.
- **(b) an app-level sale test driven through the grid path** — B1 covered the sale via the region-model
  test + a card-grid composed-event bubble test; B2.1 makes the counter render **in the shell** for
  real, so an end-to-end "place items → tender → ticket" test now runs through the shell + grid path.
  This is the **sale-path guard** for the nav rewrite (§9).
- **(c) reconcile `profile.capabilities` with server-enforced capabilities for a default-fallback
  device** — B2.1 is where the client first **reads** `profile.capabilities` (for §5's gating). The
  reconciliation: the client gate is **advisory** (hides/locks the view); the **server** remains
  authoritative (`assertDeviceCapability`, SP-A.2). A default-fallback device's `profile.capabilities`
  is whatever `getProfileForFormFactor` returns; where the client-gated view and server enforcement
  could disagree, server fencing is the safe direction (a card shown that the server refuses fails
  closed at the API, never a silent sale). Recorded as a test + a comment at the gating seam.
- **(d) `visibleWhen` fails closed for a card type with no state mapping** — §5.3 adds the big-card
  state computations so the newly-rendered big cards do not silently fail closed; the awareness note
  stays at `#currentState`.

---

## 9. Boundaries & invariants to preserve

- **Sale path (fiscal §5).** The one hard invariant. The counter must always render a working
  product-grid/basket/total/tender-pay; `tender-pay` **always renders** (cash path) regardless of
  `integrated-card-payment` (§5 exception, test-pinned). `SALE_CRITICAL_CARDS` stays mandatory on a
  till profile (`validateProfile` `missing_required`, already enforced server-side). The nav rewrite
  must not lose or block the "place → tender → ticket" flow — guarded by follow-up (b)'s shell-path
  sale test.
- **No flow lost.** Every `screen`-enum transition maps onto a tab-switch or a drill-in push/pop
  (§4.4); every bespoke screen's composed events keep working (§6). The screens' existing behavioural
  assertions are preserved, not rewritten.
- **Not fiscal / not H2.** No sale-recording, chain, migration, or DB-schema change in SP-B2 (no
  `tenant_receipts` — that is B4). The inmutabilidad suite stays green (no `tenant_id` table added);
  run it anyway as a cheap guard.
- **Bundle rule.** `apps/till` never imports `@waitron/layouts`; it uses the local `ProfileDef`/`TabDef`/
  `CardInstance`/`CardType`/`CapabilityFlag` mirror (`layout.ts:56-105`, added in B1). Gating reads the
  mirror shapes.
- **No hardcoded chrome.** The shell, tab bar, drill-in stack, and card hosts use `--wt-*` tokens only
  (enforced for `@waitron/ui` by `no-hardcoded-chrome.test.ts`; keep the till's own CSS token-only).
- **Error codes name the domain concept** — reuse `profile.*`/`device.*`; coin none without grepping
  siblings; never rename a shipped code; every throwing file imports its registry.
- **Coverage thresholds.** `apps/till` `95/95/90/88`; `apps/server` `98/98/98/95`. Run
  `pnpm --filter <pkg> test:coverage`. Browser-mode vitest (`apps/till`) is memory-heavy — do not run
  its `test:coverage` concurrently with `apps/ui`/`apps/dashboard`.

## 10. Testing strategy

- **TDD throughout** (failing test first, watch it fail, minimal implementation). Browser-mode vitest
  for `apps/till`.
- **Tab shell / nav:** a profile → rendered tab bar; tab switching; each old `screen` transition's
  drill-in equivalent (open-table push, back-to-floor/counter pop, schedule push, payment→ticket push,
  new-sale pop); the handheld's tab set comes from its profile.
- **Card gating (the three axes):** capability→absent collapses a synthetic gated card's cell **and**
  the `tender-pay` always-render exception; permission→locked overlays `table-layout-editor` when
  `canEdit` is false and unlocks it when true; `visibleWhen` show/hide for a big card with a state
  mapping. **Prove each gate by deletion** (remove the gate, watch the test fail, restore).
- **Sale-path guard (follow-up (b)):** an app-level "place items → tender → ticket" test through the
  shell + grid path (the nav rewrite's safety net).
- **Wrapped screens (expo, floor-plan):** each screen's existing behavioural assertions are **kept**
  and re-pointed at the wrapped mount (update mounts/props, keep the assertions). Composed events still
  fire against the shell/stack.
- **Reconciliation (follow-up (c)):** a test that a client-shown-but-server-refused capability fails
  closed at the API, documented at the gating seam.
- **Cheap fiscal guard:** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` stays green (no
  schema change).

## 11. Open items (for the plan, not blockers)

- **Shell as a new `till-tab-shell` element vs. a render region inside `till-app`.** The plan decides;
  a component is cleaner to test in isolation, but the drill-in stack + the app-owned data threading may
  argue for keeping it in `till-app`. Settled against the `till-card-grid` precedent during B2.1.
- **Drill-in stack shape** — a single active-drill-in field vs. a real stack. Today's depth is one
  (floor → table-order → back), so a single field may suffice; the plan picks the minimal shape that
  preserves every transition.
- **Exact affordance-button set** post-relocation, and whether Allergens stays an overlay or becomes a
  drill-in (it is a local overlay today — likely unchanged). Plan-time detail.
- **`table-order` mount duality mechanics** (card vs drill-in) — deferred to the B2.2 plan.

## 12. References

- Parent: `2026-09-03-sp-b-grid-editor-and-rendering-design.md` (§4 runtime rendering, §5 nav, §6
  wrapping, §7 card semantics, §10 invariants); grand-parent
  `2026-09-02-layout-designer-and-device-profiles-design.md`.
- B1 plan (landed #204): `2026-09-03-sp-b1-grid-renderer-and-counter.md`.
- Code — till: `apps/till/src/{till-app.ts, api/client.ts, layout.ts, widgets/card-grid.ts,
  screens/{till-counter-screen,till-expo-screen,till-floor-screen,till-station-screen,
  till-table-order-screen}.ts}`. Model: `packages/layouts/src/{profile,card-contract,default-profiles}.ts`.
  UI: `packages/ui/src/{components/*,tokens/*}`, `docs/developers/design-system.md`.
- Backlog row: *Layout designer & device profiles → SP-B → B2* (+ the four B1-review follow-ups).
