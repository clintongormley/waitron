# A1185 — the Cloud services screen shows the venue's plan and prices — plan

Backlog: "A1185" (`docs/backlog.md`). Owner, 2026-10-29: show the venue's level (registered,
connected or hosted), its billing state (trial, active, payment failing, lapsed), the trial or paid
period's end, the other levels and their prices, and a link to the owner's Cloud account. Display
only: the box never switches a service on or off from these values.

**The contract is Cloud's, and it is agreed and landed.** `docs/waitron-integration-contract.md` §
"Venue billing display, version 1" on waitron-cloud `main` (section digest
`71757eb4b99ab863513c67086cc3458cce3bdbcbaa688b342017056f4cb6e503`, provider PR745 at
`5276593620774037973499fddd82bf7c780ba1c5`). The fixed signing vector is
`packages/registration/test/billing-display-vector.json` at that commit (SHA-256 `a3bbd105…cfb94`).
This plan quotes the parts the box must obey; where it paraphrases, the contract wins.

Method: inline-coding trial, `inline` (lane A). FULL path: a new manager-only route (permissions)
and a consumer of a cross-repository wire contract. No migration, no fiscal file.

## What the contract requires of the box (the checklist each task cites)

- C1 Request: POST `${origin}/api/installations/billing-display`, `content-type: application/json`,
  body `{payload,signature}` — the existing `waitron-cloud-machine-v1` envelope
  (`machinePayload`, `apps/server/src/cloud-installation.ts`) with action `billing-display`, a fresh
  operation UUID, the saved control lease as JSON, signed body exactly `{"version":1}`.
- C2 Reply limits: refuse redirects (`redirect: "error"`), whole read within 8 s, at most 16,384
  bytes, UTF-8 fatal decode. Malformed, oversized, redirected or wrongly bound replies → local
  `cloud.unavailable`, never fallback facts.
- C3 Refusals: 400 (`invalid_input`, `invalid_request`, `unsupported_billing_version`), 405, 413,
  415 → `cloud.request_invalid`; 401, 403, 408, 429, 503 and anything else → `cloud.unavailable`.
  403 `revoked` and 401 `invalid_proof` are reported to the connection exactly as the translation
  calls do (`recordRefusal` in `apps/server/src/cloud-client.ts`).
- C4 Closed reply: exact keys at every level (`BillingDisplayV1`, `Billing`, `Period`, `Prices`);
  `version` 1; `installationId`/`venueId` equal the saved registration's; `countryCode` `ES`;
  `calendarTimeZone` a time zone `Intl.DateTimeFormat` accepts; `asOf` canonical ISO UTC with
  milliseconds (`new Date(asOf).toISOString() === asOf`); `CivilDate` a real `YYYY-MM-DD` day;
  money fields nonnegative safe integers, `registeredMonthlyCents` 0, `currency` `EUR`,
  `taxExclusive` true, `hostedDayDivisor` 30, `vatRateBasisPoints` nonnegative safe integer,
  `revision` nonnegative safe integer; `accountUrl` exactly the saved origin + `/account`
  (complete-string equality, not hostname).
- C5 Combination table (ready billing): every period has `from < until` and `coversAsOf` equal to
  whether the calendar day containing `asOf` **in `calendarTimeZone`** lies in `[from, until)`.
  `registered` + `active`/`payment_failing` → period null. `connected`/`hosted` + `trial` → a
  `trial` period of the same level with `coversAsOf: true`. `connected`/`hosted` +
  `active`/`payment_failing` → null or a `paid` period of the same level. Any level + `lapsed` →
  null, or a `paid` period (same level when the level is paid; for `registered`, a paid level), or a
  `trial` period (the completed-trial fallback; `coversAsOf` false is the expected case but the
  table states no constraint beyond the membership rule, so none is added). Anything else → the
  whole billing section is unavailable. `{status:"unavailable",reason:"state_not_ready"}` has no
  other keys.
- C6 `until` is the first excluded day. The screen shows the LAST INCLUDED day (`until` − 1 day),
  computed as a civil date and formatted in UTC so the browser's zone cannot move it.
- C7 Pacing: at most one read per minute across all dashboards, including screen open and refresh;
  periodic reads share the limit. 429: no new read before its `Retry-After` hint. No snapshot on
  disk; never read from a till, at start or on a sale path. Fence by saved registration and
  request generation: a reply for a registration that is no longer the saved one is dropped.
- C8 On error, partial unavailability, disconnect or revocation: show the affected section
  unavailable and clear its old values; keep the connection and service rows as they are. Never turn
  an error into `registered`, `lapsed`, zero prices or an entitlement.
- C9 Labels: the link reads "Open Cloud account" and promises no controls. An unconnected venue gets
  a link to the configured Cloud origin + `/signup` (not from any billing reply). No prices before
  connecting: the public price read is an open owner question (lane B's questions.md, 2026-10-29),
  so version 1 shows none.

## Decisions taken here (conservative, each recorded in the PR)

- D1 The pacing memo lives in memory inside `createCloudConnection` (one connection per server
  process). Within 60 s of the last read STARTED for the same registration (installation id +
  public key), every caller gets that read's settled outcome — success or error — without a new
  request; an in-flight read is shared. After a 429 the next read waits for
  `max(60 s, Retry-After)` (seconds form only; a missing or unreadable hint means 60 s; capped at one
  hour). A different saved registration starts fresh.
- D2 The lease comes from the existing `leaseState` (renews only when fewer than ten minutes are
  left, as translation does). An unpublished price list never triggers a renewal by itself.
- D3 The local route is `GET /management-api/cloud/billing`, `system.manage`, passive (an automatic
  read), checked again after the network wait, as `/management-api/cloud/status` does. It requires
  the primary (`cloud.not_primary`, 409), as Refresh does: getting a lease can renew it, flush a
  pending request and save the state file (`cloud-installation.ts` `ensureLease`), so the read is
  not side-effect free. It answers `{asOf, calendarTimeZone, billing, prices, accountUrl}`
  (no ids), 409 `cloud.not_configured` when there is no live registration (none saved, revoked, or
  no Cloud origin configured), 503 `cloud.unavailable`, 400 `cloud.request_invalid`.
- D4 The dashboard reads it through `dashboardQuery` with no table dependencies, so the shared
  query timer re-reads it every 60 s while the screen is open (`live-queries.ts`'s default) and the
  server's memo bounds it. Only while the status says connected and not revoked.
- D5 The Cloud services screen has no guide page (`apps/server/src/guide/{en,es}/` has none; only
  the nav label exists), so no guide changes. Not adding one: out of the item's scope.
- D6 `CloudConnectionStatus` gains `signupUrl` (configured origin + `/signup`, only when not
  connected) and `accountUrl` (configured origin + `/account`, only when connected). Neither comes
  from a billing reply. With no Cloud origin configured the status route answers before the
  connection exists (`cloud-api.ts` "not_connected"), so neither appears — correct, there is
  nowhere to link. The screen's "Open Cloud account" link uses the status's `accountUrl`, so it
  stays when the billing read fails (the refusal's next step); the reply's own `accountUrl` must
  equal it (C4).

## Tasks

### Task 1 — the signed billing read and its closed-reply check (server)

New `apps/server/src/cloud-billing.ts` + `cloud-billing.test.ts`.

- `billingEnvelope(state, operationId, lease, now)` built on `machinePayload` (C1).
- `readBillingDisplay(value, expected)` → typed display or `cloud.unavailable` (C4, C5).
- `fetchBillingDisplay(state, signal?, onRefusal?)` → the exchange (C1–C3), then
  `readBillingDisplay` with expected ids from `state.view.registration` and
  `accountUrl = state.origin + "/account"`.

Tests first, each watched failing:
- the vector: a key from `machineSeedByte` 31 reproduces the vector's public key, envelope payload
  and signature byte for byte (Ed25519 signatures are deterministic) — copy the vector into
  `apps/server/test/billing-display-vector.json` with its source pin in the test's describe name;
- the five contract replies are accepted unchanged (copy them into the test, ids substituted);
- rejections, one case each: an extra key at each level; a missing key; another installation or
  venue id; `accountUrl` with the same host but another path, with `http:`, with a trailing slash;
  `version` 2; `countryCode` `PT`; an unknown time zone; a non-canonical `asOf`; `2026-02-30`;
  `from == until`; each unlisted combination (`registered/trial`, `connected/trial` with a paid
  period, trial with `coversAsOf:false`, `hosted/active` with a connected period); unavailable
  billing carrying `level`; prices with `registeredMonthlyCents` 100, a negative or fractional cent
  value, `hostedDayDivisor` 31;
- `coversAsOf` judged in the reply's own zone: `asOf` `2026-10-31T23:30:00.000Z` is 1 November in
  `Europe/Madrid` — a period `[2026-11-01, 2026-12-01)` must say `true` and is refused with
  `false`, and the same reply with `calendarTimeZone` `UTC` must say `false` (control);
- the exchange against a local HTTP server (`node:http`, as `cloud-fixture.ts` does): the request's
  path, method, content type and envelope verify with the saved public key and carry the exact
  signed body; each refusal row of C3 maps as stated; a 302 is refused; a 16,385-byte reply is
  refused; a reply that never finishes is refused by the 8 s bound (fake the bound through an
  injected `AbortSignal` already aborted — do not wait 8 s); 403 `revoked` and 401 `invalid_proof`
  call `onRefusal` with the lease used and the public key.

### Task 2 — pacing and fencing in the connection (server)

`apps/server/src/cloud-client.ts`: `billing(signal?)` on the connection (D1, D2, C7).
Tests in `apps/server/src/cloud-client.test.ts` (or a new `cloud-client.billing.test.ts`) using
`cloudFixture`'s machine handler, with fake time (`vi.useFakeTimers({ toFake: ["Date"] })` or an
injected clock — whichever the file already uses):
- two calls within 60 s send ONE request and both get its answer; a call at 60 s sends a second;
- an error is shared for 60 s the same way (no retry storm);
- a 429 with `Retry-After: 120` blocks a new request until 120 s; with no hint, 60 s;
- no saved registration, or revoked → `cloud.not_configured` and no request;
- fencing: a registration that changes while the read waits (the fixture re-pairs during the
  handler) → `cloud.unavailable`, and the next call reads for the new registration at once;
- nothing is written to the state file by a billing read (compare the file's bytes before/after a
  successful read with a live lease).

### Task 3 — the manager-only local route (server)

`apps/server/src/cloud-api.ts`: `GET /management-api/cloud/billing` (D3); `signupUrl` in the
status when not connected (D6, C9).
Tests in `apps/server/src/cloud-api.test.ts`: a manager with `system.manage` gets the projected
answer (no ids); a person without it gets 403 `authorization.not_permitted`; no session 401; no
connection configured → 409 `cloud.not_configured`; the read is passive (follow how the status
route's passive case is tested in that file); `signupUrl` is `origin + "/signup"` when not connected
and absent once connected.

### Task 4 — the screen's "Plan and prices" section (dashboard)

`apps/dashboard/src/api/client.ts` (types + `getCloudBilling`), `api/live-queries.ts`
(`getCloudBilling: []` with a one-line why), `screens/cloud-services-screen.ts`,
`i18n/strings.ts` (English and Spanish, matching the file's existing Spanish register), tests in
`screens/cloud-services-screen.test.ts`.

Shown only when connected and not revoked, under the service rows:
- heading "Plan and prices" / «Plan y precios»;
- billing ready: "Plan" — Registered / Connected / Hosted (Registrado / Conectado / Alojado);
  "Status" — Free trial / Active / Payment failing / Lapsed (Prueba gratuita / Activo / Pago
  fallido / Caducado); when a period exists: "Last trial day" or "Last paid day" (Último día de
  prueba / Último día pagado) with the last included day (C6), and for a historical paid period of
  another level, the level named after the date;
- billing unavailable or an error: "Your plan's details are not available right now." (and the
  Spanish), values cleared (C8);
- prices published: Registered "Free"; Connected "€30.00 a month + 21% VAT"; Hosted "€90.00 per 30
  days, charged by the day + 21% VAT" — currency and percentage formatted with `Intl` in the screen
  language; prices unavailable: "Prices are not published yet.";
- link "Open Cloud account" (`target=_blank`, `rel=noopener noreferrer`) to `accountUrl`.
- not connected: a "Create a Cloud account" link to `signupUrl` beside the existing intro.

Tests: each of the five contract replies renders its rows (exact text in both languages for one
case); an error after a good read clears every billing value; the section is absent when revoked
and when not configured; an until of `2026-11-30` shows 29 November whatever the test browser's
zone (assert the formatted day); the link's `href` is the reply's `accountUrl`.

Then LOOK (CLAUDE.md §4): screenshots of the screen in light and dark and at phone width, for a
trial, a lapsed reply, and the unavailable state; save under
`~/waitron-campaign/a1185-shots/`.

### Task 5 — docs and backlog

- Delete the A1185 backlog entry; add short entries for what stays open: prices before connecting
  (owner's public-price question) and the production billing calendar (owner's question), if the
  backlog does not already hold them.
- Record the consumer's source pin and results for Cloud's contract section ("record its actual
  source pin and results here when supplied") in lane G's questions.md after landing — not in this
  repository.

## Checks

Focused: `pnpm --filter @waitron/server exec vitest run src/cloud-billing.test.ts
src/cloud-client.test.ts src/cloud-api.test.ts`; `pnpm --filter @waitron/dashboard exec vitest run
src/screens/cloud-services-screen.test.ts`; root guards touched: `scripts/live-subscriptions.test.ts`,
`scripts/errors-reachable.test.ts` (no new code planned), `scripts/native-form-fields.test.ts`.
`pnpm format:check`. CI owns the package suites and coverage (98/98/98/95).

## Revision 2 — the fresh plan review's findings folded (2026-10-29, 0C/8I/7M)

These override the task text above where they differ.

- R1 (I1) The screen watches billing with a SECOND `QueryController` whose error callback only
  clears the billing values and sets a billing-only flag; it never touches `readError`. The billing
  slot is watched only while the status is `complete` and not revoked (and the node is primary),
  started once when that becomes true and released when it stops — never re-watched on every status
  update (`watch` replaces the slot and forces a read). Test: billing fails while the status read
  succeeds → the top error stays empty and the billing section says unavailable.
- R2 (I2) `billing()` re-reads the saved state and refuses (`cloud.not_configured`) when there is
  no registration or it is revoked BEFORE serving the memo, and again after the network wait
  (beside the re-pairing check). Test: good read, revoke, read within 60 s → 409 and no request.
- R3 (I3) The shared in-flight read is bound only by its own 8 s limit; a caller's signal ends only
  that caller's wait. An aborted or not-yet-finished read is never memoised as a failure. Test: the
  first caller aborts, a second caller still gets the reply.
- R4 (I5) `fetchBillingDisplay` takes `{ timeoutMs = 8000 }`; the stall test uses a small value
  against a server that never ends the reply, and one case asserts the default is 8000 (spy on
  `AbortSignal.timeout`).
- R5 (I6) The last-included-day formatter takes the zone as a parameter defaulting to `"UTC"`; its
  test asserts the UTC answer and a control with `America/New_York` that gives the day before,
  proving the representative discriminates. Limit, stated in the PR: if the dashboard's browser
  tests run in UTC, deleting the default would not fail them.
- R6 (I7) A 1050-basis-point case shows "10.5%" / «10,5 %» (`maximumFractionDigits: 2`).
- R7 (I8) The passive case copies `cloud-api.test.ts`'s back-dated `lastSeenAt` pattern (around
  lines 99–124): set it 60 s back, read billing, assert unchanged.
- R8 (minor) Time zone: accept only when `new Intl.DateTimeFormat("en", { timeZone }).
  resolvedOptions().timeZone === timeZone` and the name contains no `+`/`-` offset form (so
  `"+01:00"` and `"europe/madrid"` are refused, `"UTC"` and `"Europe/Madrid"` accepted).
- R9 (minor) Combinations: every period also needs `from <= today` (no future interval is ever
  selected); a `trial` period's level equals the billing level when the level is paid; under
  `lapsed` a trial period needs `coversAsOf: false`. The combination test is table-driven over
  level × state × {none, trial, paid} × period level, with the allowed set written out once.
- R10 (minor) A valid reply padded with whitespace to exactly 16,384 bytes is accepted; 16,385 is
  refused.
- R11 (minor) Task 2 builds on `apps/server/test/translation-cloud-fixture.ts` (already pairs,
  issues leases and routes machine actions) rather than the bare `cloudFixture`.
