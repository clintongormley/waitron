# Dashboard alerts: somewhere for things that went wrong to show up

Status: design approved by the owner in a brainstorm on 2026-09-14. Backlog item A5 (both halves).
Fiscal-adjacent: it reads fiscal submission state, so each branch takes owner sign-off at land.

## The problem

Several parts of the system record that something went wrong, and nothing shows it to anyone.

- `incidents` has producers and no reader. `openIncidents` (`packages/core/src/incidents.ts`) is the
  only read and has no production caller; nothing writes `acknowledged_at`. Producers, found by a
  whole-repo search on 2026-09-14: the chain and clock checks in `packages/core/src/record-sale.ts`,
  `record-void.ts`, `record-correction.ts` and `record-substitution.ts`; the fiscal drain
  (`packages/fiscal-verifactu/src/drain.ts`, including AEAT rejections); the fiscal record-totals
  check (`packages/fiscal-verifactu/src/chain.ts`); fiscal reconcile
  (`packages/fiscal-verifactu/src/reconcile.ts`); the payments reconciler
  (`packages/payments/src/reconcile.ts`, driven by `packages/payments-stripe/src/reconciler.ts`); the
  Stripe device provider (`packages/payments-stripe/src/device-provider.ts`); and SumUp's pending
  outcome path (`packages/payments-sumup/src/provider.ts`, via `apps/server/src/card-provider-pool.ts`).
- Other problems are never recorded at all: a backup that failed or is overdue (log lines in
  `apps/server/src/backup-sweep.ts`, a `stale` flag from `apps/server/src/backup-status.ts`), fiscal
  records not reaching AEAT (`/health` duty staleness and log lines only), a print agent that stopped
  pulling or jobs that are not printing (`print_agents.last_seen_at`, `print_jobs`), and a card
  reader's battery (read on demand from the provider, shown only on the payments screen).

A real venue's operator has no terminal, so a log line or a table row reaches nobody.

## Decisions (owner, 2026-09-14)

1. **One place for both kinds of alert.** Recorded events and live ongoing problems share one bell,
   one panel and one screen.
2. **Who sees what follows each area's permission** (table below), with one new permission for
   fiscal alerts. Whoever can see an alert can mark it handled.
3. **Delivery is in the dashboard only:** a bell with a count in the banner, and a brief pop-up when a
   new alert arrives while the dashboard is open. No email or phone push in this work.
4. **Dashboard only, not the till or handhelds.**
5. **Ongoing checks in the first build:** backups, fiscal submission, printing, and card-reader
   battery.
6. **Ongoing problems are worked out when asked, never stored** (approach A of three). Rejected: a
   background job writing alert rows (it adds a thing that can itself go quiet and hide every alert,
   and a delay), and moving events into a new table (it touches every producer, including fiscal code,
   for no user-visible gain).
7. **Layout C:** the bell opens a short panel of open alerts; "See all" opens an Alerts screen with
   Open and Handled tabs.
8. **`till.configure` is split first, in its own branch** (see *Order of work*). Backup alerts use the
   new `system.manage`.

## Order of work

0. **Split `till.configure`** into permissions named for what they guard — for example
   `layout.configure` (till screens, receipts, themes, table placement, device profiles),
   `system.manage` (backups, the recovery bundle, retiring the box, box status, configuration export)
   and `venue.configure` (location and venue settings). Every role keeps exactly the access it has
   today. It is its own short design and branch; this spec only depends on `system.manage` existing.
   It touches authorization, so it takes the full review path.
1. **Alerts branch 1 — the framework and recorded events:** the alert model, the source seats,
   `fiscal.view`, the three server routes, marking handled, the bell, panel, screen and pop-up, the new
   shared components, and wording for every incident code in use.
2. **Alerts branch 2 — the ongoing checks:** backups, fiscal submission, printing, card-reader battery.

**Overlap to watch:** `docs/superpowers/specs/2026-09-14-drop-tenant-id-design.md` removes
`tenant_id` from every table, including `incidents` and its dedup index. It had no branch when this
spec was written. Whichever lands second rebases onto the other; the alerts work follows the tenant
convention on `main` at the time — with `tenant_id` present, every by-id read and the handled update
scope to the tenant and the routes compare `authorizeManager`'s tenant with the configured one; once
it is gone, neither applies.

## The alert model

Every alert carries:

| Field | Meaning |
| --- | --- |
| `key` | Stable identity. An event: `incident:<id>`. An ongoing problem: `<code>:<subject>`, e.g. `backup.destination_overdue:local`. |
| `kind` | `event` (a row in `incidents`) or `ongoing` (worked out on this request). |
| `code` | A domain error code; also the key for its wording. |
| `params` | Values the wording fills in (printer name, count, hours). |
| `severity` | `warning` or `error`. |
| `since` | An event: `detected_at`. An ongoing problem: a time taken from the data (last good backup, oldest waiting record, agent last seen, oldest waiting job). |
| `area` | Which source produced it, for grouping and the "Go to" link. |
| `screen` | Ongoing only, optional: the dashboard screen that fixes it. |
| `handledAt`, `handledBy` | Events on the Handled tab only. |

An event stays until marked handled. An ongoing problem exists only while its check finds it.

## Sources

An **alert source** is `{ area, permission, read(ctx) → Alert[] }`. The alerts route asks every
source whose permission the session holds, and merges the results.

Generic code does not name modules (`CLAUDE.md` §3, composition). So:

- **Module-owned sources** travel on a new optional `alerts` seat on `WaitronModule`
  (`packages/module/src/module.ts`), assembled from `ALL_MODULES` like `routes` and `permissions`.
  `fiscal-verifactu` fills it with the fiscal-submission check. `fiscal-none` leaves it empty.
- **Server-owned sources** are registered by boot: recorded events (from `incidents`), backups,
  printing, and card-reader battery. Battery reads each active reader through the generic
  `CardProviderContribution` seat's `readers.status` and its `batteryPercent`, so it names no
  provider. Only SumUp reports a battery today (`packages/payments-sumup/src/sumup-client.ts`);
  a reader that reports none raises nothing.
- **Event codes are claimed by area.** Each area declares the code prefixes it owns and the
  permission they need: core claims `chain.` and `clock.` under `fiscal.view`; `payments` claims
  `payment.` under `payments.manage`; `fiscal-verifactu` claims `fiscal.` under `fiscal.view`. An
  incident whose code no area claims is shown under `diagnostics.view`, so a new code can never be
  recorded and then hidden from everyone.

**A source that throws** does not fail the request. Its alerts are replaced by one
`alert.source_unavailable` error naming the area, visible under that source's permission, and the
failure is logged with its code.

**Outside calls are cached.** Battery status (a provider API call per reader) is reused for 5
minutes; backup destination listings (a network call once an S3 destination exists) for 1 minute.
The cache is in server memory, shared by every session, and filled only when someone asks — with no
dashboard open, nothing is called.

## The checks (branch 2)

Every ongoing alert is one per subject — per destination, printer, agent or reader — never one per job
or record. The numbers are starting values, held as named constants.

**Backups** (area `backup`, `system.manage`, screen: `backup`)

- `backup.destination_overdue`, error — `readBackupStatus` reports the destination `stale` (after
  `WAITRON_BACKUP_STALE_AFTER_MS`, two days by default, `apps/server/src/backup-config.ts`). `since`:
  the last good backup, or absent if none.
- `backup.destination_failed`, warning — the most recent attempt at that destination failed. The sweep
  records each destination's last outcome in an in-memory holder shared with the source (the same
  shape as `AwaitingCertStatus` in `apps/server/src/pass.ts`). Cleared by the next success; empty
  after a restart, when the overdue check remains.
- `backup.disabled`, warning — backups are not configured (`{ configured: false }`).

**Fiscal submission** (area `fiscal`, `fiscal.view`, no screen)

The dashboard has no fiscal settings screen: the AEAT certificate is uploaded only in the setup wizard
(`apps/setup/src/screens/cert-screen.ts`, checked 2026-09-14). These alerts carry no "Go to" link, and
the wording says what to do instead.

- `fiscal.submission_delayed` — the oldest record whose `envios.estado` is `pendiente` or `enviando`
  was generated (`registros_facturacion.fecha_hora_huso_gen_registro`) more than **4 hours** ago
  (warning) or **24 hours** ago (error). Params: count and hours. Provided by `fiscal-verifactu`'s seat.
- `fiscal.submission_stopped`, error — one or more `envios` rows are `detenido`. Params: count.
- `fiscal.awaiting_certificate`, error — records are waiting and the drain skipped for a missing
  certificate. The pass already holds this flag (`AwaitingCertStatus`, `apps/server/src/pass.ts`),
  so this source is server-owned and is passed that holder.
- AEAT rejections are already events (`fiscal.registro_rechazado`); no check duplicates them.

**Printing** (area `printing`, `printer.manage`, screen: `printers`)

- `printing.agent_silent`, warning — an active print agent's `last_seen_at` is more than **5 minutes**
  old. `last_seen_at` is written at most once a minute on a pull (`packages/printing/src/agent.ts`).
- `printing.jobs_waiting`, error — per active printer: a `document` job `queued`, `printing` or
  `failed` for more than **2 minutes**, or a `failed` job at `MAX_DELIVERY_ATTEMPTS`
  (`packages/printing/src/runtime.ts`), which the pull no longer claims. Params: printer name, count.
  `since`: the oldest such job's `created_at`.

**Card readers** (area `card_reader`, `payments.manage`, screen: `payments`)

- `reader.battery_low` — an active reader reports `batteryPercent` at or below **20** (warning) or
  **10** (error). Params: reader name, percent.

Codes follow the siblings' singular domain prefixes and are registered in their packages' error
registries like any other code. The exact names are checked against siblings again when the plan is
written.

## Permissions

| Area | Permission | Held by today |
| --- | --- | --- |
| Backups | `system.manage` (from step 0) | manager, admin |
| Printing | `printer.manage` | manager, admin |
| Card readers and `payment.` events | `payments.manage` | manager, admin |
| Fiscal submission and `fiscal.`, `chain.`, `clock.` events | **`fiscal.view`** (new, core catalogue) | manager, admin |
| Unclaimed event codes and `alert.source_unavailable` for them | `diagnostics.view` | manager, admin |

`fiscal.view` joins `PERMISSIONS` in `packages/identity/src/permissions.ts` beside `report.view` and
`diagnostics.view`, granted from manager up.

## Marking handled

- Only events can be marked handled. It sets `acknowledged_at` and `acknowledged_by` — the two columns
  `app_user` may already update — and is shared by the whole venue.
- The route requires the permission of the incident's area, looked up from its code, so a person with
  only `payments.manage` is refused a fiscal incident with `authorization.not_permitted`.
- Handling an already-handled incident is a no-op success, so two managers clicking at once both
  succeed.
- Once handled, the dedup key is free (`incidents_open_dedup`), so a condition still present is
  recorded again only if its producer looks again. The reconcilers mostly do not. The daily payments
  check (`apps/server/src/reconcile-duty.ts`) checks each day once, and checks a day again only when
  it found a payment there that was both an orphan and a drift. The fiscal reconciliation sweep
  (`packages/fiscal-verifactu/src/reconcile.ts`) has no production caller. So no alert's wording
  promises that it comes back; the payment reconcile codes say instead that marking one handled does
  not fix it.
- The Handled tab lists events handled in the last 30 days, newest first, with who and when.
- No note field in this work.

## Server routes

- `GET /management-api/alerts` — open alerts for this session: events plus ongoing, filtered by
  permission, errors first then newest `since` first. A passive read (`x-waitron-live`,
  `withPassiveManagementRead`), so polling does not keep a session alive.
- `GET /management-api/alerts/handled` — handled events from the last 30 days, filtered the same way.
- `POST /management-api/alerts/incidents/:id/handled` — marks one event handled. Unknown id:
  `alert.not_found`.

Each route opens one transaction and authorizes inside it, following the management routes' existing
shape.

## The dashboard

- **Bell** in the banner beside the account menu, shown only when the session holds at least one
  alert permission. The count is open alerts; red if any is an error, amber otherwise.
- **Panel** — a native popover, positioned before first paint (`CLAUDE.md` §4), full width at phone
  width. Lists open alerts, each with its wording, area and `since`, and either "Mark handled" (an
  event) or "Go to …" (an ongoing problem whose screen the session may open). A "See all" link opens
  the screen.
- **Alerts screen** — Open and Handled tabs with full wording and params. Not in the navigation; the
  bell is on every screen.
- **Pop-up** — for an alert whose `key` was not in this tab's previous read. The first read in a tab
  raises none. About 8 seconds; clicking opens the panel; several at once become one "N new alerts".
  Announced politely, assertively for an error.
- **Updates** — one live query depending on the `incidents` change source (already published through
  `CORE_CHANGE_SOURCES`), with a 60-second refresh for the ongoing checks. It must go through the
  shared query controller so background reads stay passive.
- **Wording** — every alert code has an English and a Spanish sentence with `{param}` placeholders,
  registered by its area as modules register their strings today. `codeMessage`
  (`packages/dashboard-kit/src/codes.ts`) takes no params; alerts gain a params-aware lookup beside it.
  An unregistered code shows a generic "Something needs attention" sentence with the raw code in the
  detail line — unlike an error banner, an alert with no wording is still worth identifying.
- **New shared components** in `packages/ui`: a count badge and a toast. Each takes a token-painting
  test and an axe test in a sibling `*.a11y.test.ts` covering each state in both themes
  (`CLAUDE.md` §3). The panel reuses the existing popover and list pieces. Anything the design system
  does not yet say about badges or toasts is written into
  [design-system.md](../../developers/design-system.md) in the same change.

## Testing

- **Each check:** a firing case and a control on the other side of the threshold — e.g. an agent last
  seen 4 minutes ago raises nothing, 6 minutes ago raises `printing.agent_silent`, and a fresh
  check-in clears it. Fiscal: waiting records at 3, 5 and 25 hours; a `detenido` record; waiting records
  with the certificate flag set. Backups: a failed last attempt, an overdue destination, backups off.
  PGlite is enough: no check involves concurrent writers.
- **Battery cache:** against the fake SumUp server, two reads within 5 minutes make one provider call,
  and a read after 5 minutes makes another.
- **Routes:** a session with only `payments.manage` receives only payment alerts, and marking a fiscal
  incident handled is refused with `authorization.not_permitted` (asserting the code, not just an
  error). A throwing source leaves the other sources' alerts intact plus `alert.source_unavailable`.
  The poll carries the passive header. While `tenant_id` exists: a two-tenant probe marking the other
  tenant's incident answers `alert.not_found`.
- **Coverage of codes:** a root guard lists every incident code recorded in production source and
  fails if one is unclaimed by an area or lacks English or Spanish wording. It reads source text, so a
  code assembled at runtime escapes it; the test says so.
- **Dashboard, in browser mode:** bell count and colour, panel contents and phone-width layout, no
  pop-up on the first read and one on a new key, marking handled moves an event to the Handled tab,
  "Go to" hidden without the screen's permission, axe in both themes.
- **Look at it:** open the bell, panel and screen in both themes and at phone width before calling it
  done (`CLAUDE.md` §4).

## Not in this work

Email or phone push; the till showing alerts; a reader that is offline; devices knocking while
pairing is shut; a note when marking handled; per-person read state; alerts on a mirror (the mirror
comes afterwards — when it does, the ongoing checks must describe the node the dashboard is talking
to, and marking handled follows the mirror's write rules).
