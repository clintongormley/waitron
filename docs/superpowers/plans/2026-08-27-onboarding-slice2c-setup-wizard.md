# Onboarding Slice 2c: the `apps/setup` setup wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **READ `.superpowers/notes/2c-frontend-map.md` in this worktree first** — it has every exact pattern (file:line) this plan references.

**Goal:** A new `apps/setup` Vite+Lit SPA — the browser **setup wizard** — that walks a non-technical operator from an unprovisioned box to a trading venue by consuming slice 2b's `/setup-api` endpoints, and is **served in setup mode** by the box (over the 2a self-signed HTTPS). On success the box provisions the venue and restarts into trading mode.

**Architecture:** A `LitElement` shell (`setup-app`) with an in-memory `@state() screen` machine (URL never changes — the codebase convention) that owns one accumulated **request-draft** object; screens are side-effect-imported custom elements built from `@waitron/ui` primitives (`wt-input`/`wt-button`/`wt-card` + `--wt-*` tokens) that emit patches up to the shell; a `SetupApi` client funnels `GET /setup-api/status` + `POST /setup-api/provision` through one typed `#request` (surfacing `params.field` for per-field validation). The server grows a `setupAppDir` config so the setup branch serves the built bundle via the existing `mountSpa` instead of the placeholder.

**Tech Stack:** TypeScript, Lit 3.x, `@waitron/ui` (design system), Vite 6, Vitest **browser mode** (real Chromium via Playwright) + `axe-core` a11y. Server side: Hono, the existing `mountSpa`/`assertBuiltApp`.

**Spec:** [docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md](../specs/2026-08-26-appliance-onboarding-design.md) §4 (the flow), §10 (admin/tenant/location + AEAT cert), §11 (pairing — deferred), §16 (slice 2c = this app). Builds on 2a (#141) + 2b (#142). **Map:** `.superpowers/notes/2c-frontend-map.md`.

---

## Scope rulings (decided at planning; surfaced for the owner to revise)

- **R1 — 6 in-memory screens:** `mode` → `admin` → `venue` (tenant + location + series in one form) → `cert` (rendered only when `mode==="live" && fiscalTerritory==="ES-common"`) → `review` → `provisioning`/`done`. The welcome/"you're setting up this box" + cert-warning copy folds into the `mode` screen header.
- **R2 — trust UX is slice 3, NOT 2c.** The operator already reached the wizard over HTTPS (clicked through the self-signed warning). 2c shows only a one-line "the browser warning is expected — this box uses its own certificate" note; the full per-device trust instructions + the pairing QR are **slice 3** (per spec §16). Recorded so the owner can pull trust UX forward if wanted.
- **R3 — English-only chrome for the 2c MVP.** The wizard is the (technical) owner's one-time setup flow, not customer-facing; a light `es-ES` localisation pass (mirroring the dashboard's `t()`) is a deferred follow-up. Identifiers stay English regardless (the `english-only` guard skips `apps/*` but the convention holds); fiscal field names in the request body (`taxId`, `seriesCode`, …) are the API contract, not new Spanish identifiers.
- **R4 — serve via Option A:** extend `mountSetup` with an optional `setupAppDir`; when present it calls `mountSpa(basePath:"")` at the end instead of the `GET *` placeholder; when absent (dev/no bundle) it keeps the placeholder. `WAITRON_SETUP_APP_DIR` config + `assertBuiltApp` fail-fast, mirroring `tillAppDir`.
- **R5 — functional MVP + non-negotiable a11y/theming.** Every screen gets a `.a11y.test.ts` (axe) and a behaviour `.test.ts`; tokens only (no hardcoded chrome colour/spacing/radius/font); `prefers-color-scheme` respected via `applyTokens`. No animations, no drag-drop, no live progress bar.
- **R6 — no CI bundle-smoke for the wizard** (matches the existing convention: no front-end is `vite build`-ed in CI; the served path is covered by the boot/spa server tests). A cross-front-end build-smoke is a separate later cleanup.

## What this slice is NOT (defer)

- **No per-device trust UI / pairing QR / mDNS** (slice 3, R2). **No `es-ES` app localisation** (R3, deferred). **No installable-PWA** (service worker/manifest — a later slice per the spec). **No new `@waitron/ui` primitive** — reuse what exists; a small `field()` render helper stays inside `apps/setup`.

## Global Constraints

- **TDD:** failing test first → red → minimal impl → green → commit. Prove guards by deletion (CLAUDE.md §4).
- **Coverage — `apps/setup` is a browser package: thresholds 95/95/90/88** (statements/lines/functions/branches, global not per-file — looser than the 98/98/98/95 Node packages; CLAUDE.md §2). `src/main.ts` + any `test-helpers.ts` are coverage-excluded. Run `pnpm --filter @waitron/setup test:coverage`. Browser tests run real Chromium (Playwright) — no Docker.
- **`@waitron/ui` design system:** `baseStyles` first in every `static styles`; only `--wt-*` tokens for chrome; `applyTokens(document.documentElement)` once in `main.ts`; every `wt-change` handler calls `event.stopPropagation()`; `data-test="…"` hooks for tests. Read `docs/developers/design-system.md` §Forms / §Event discipline / §Accessibility testing.
- **Client types are LOCAL hand-copies** of the server JSON shapes — do NOT import `@waitron/provisioning`/server barrels into the browser bundle (drags Node builtins in). Deps: only `lit`, `@waitron/ui`, `@waitron/shared`.
- **The exact `POST /setup-api/provision` request shape + error codes** are in the map §4b — match field names verbatim (`taxId`, `legalName`, `fiscalTerritory`, `invoiceLocales`, `operationDescription`, `addressLine1`/`addressLine2`(nullable), `postalCode`, `city`, `province`, `timeZone`, `dayCutover`, `tillName`, `seriesCode`, `rectificativeSeriesCode`, `admin.{displayName,pin,password}` PLAINTEXT; `aeatCert?.{pfxBase64,passphrase,certKind}` OMITTED when absent). Success `{provisioned:true,tenantId,restarting:true}` then the box SIGTERMs.
- **Server change is confined to the setup branch** + config + `mountSetup`. The trading boot path stays behaviourally unchanged.

---

## Task 1: Birth of `@waitron/setup` — package scaffold + CI partition wiring

The package must be a first-class, CI-integrated workspace member from its first commit, or the CI **partition tests go red** (a new package in no shard). So scaffold + CI wiring land together.

**Files (create, copying `apps/dashboard` and renaming):** `apps/setup/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `src/vite-env.d.ts`, `src/setup-app.ts` (minimal shell), `src/setup-app.test.ts` (one trivial browser test). **Modify (CI):** `scripts/changed-scope.mjs`, `.github/workflows/ci.yml`, `scripts/ci-workflow.test.mjs`, `scripts/changed-scope.test.mjs`.

- [ ] **Step 1 — scaffold the package** (map §1a, §5a): `package.json` `"@waitron/setup"`, scripts identical to dashboard, deps `lit`/`@waitron/ui`/`@waitron/shared`, devDeps as dashboard. `tsconfig.json`, `vite.config.ts` (port **5192**, `base:"/"`, proxy `/setup-api` → **`{ target: "https://127.0.0.1:8080", secure: false }`** — the box is self-signed HTTPS), `vitest.config.ts` (copy dashboard's browser+coverage block, **thresholds 95/95/90/88**, exclude `src/main.ts`), `index.html` (change `<title>` to "Waitron — set up your box"), `src/vite-env.d.ts`. `src/main.ts`: `applyTokens(document.documentElement)` then `render(html\`<setup-app .api=${new SetupApi()}></setup-app>\`, app)` — **but SetupApi is Task 2**, so for Task 1 render `<setup-app>` with no api and a minimal shell. `src/setup-app.ts`: a `@customElement("setup-app")` LitElement, `static styles=[baseStyles, css\`:host{display:block}\`]`, renders a `wt-card` with an `<h1>Set up this Waitron box</h1>` placeholder. `setup-app.test.ts`: mount `<setup-app>`, assert the heading renders (real Chromium).
- [ ] **Step 2 — run it:** `pnpm install` (picks up the new workspace member), `pnpm --filter @waitron/setup build` (vite build succeeds), `pnpm --filter @waitron/setup typecheck`, `pnpm --filter @waitron/setup test:coverage` (the trivial test passes at ≥ thresholds — a one-element shell is fully covered).
- [ ] **Step 3 — CI partition wiring** (map §5b/§5c): in `scripts/changed-scope.mjs` add `export const SETUP_PACKAGE = "@waitron/setup";`, add it to `OWN_SHARD_PACKAGES`, add a `{ output:"setup", covers: membership(SETUP_PACKAGE) }` gate to `SCOPE_GATES`. In `.github/workflows/ci.yml`: add `setup:` to the `changes` job outputs; add a `test-setup` job cloned from `test-till` (gate on `code=='true' && setup=='true'`, Playwright cache keyed on `@waitron/setup`, `playwright install chromium`, runnable-guard + `pnpm --filter "@waitron/setup" test:coverage`, no Docker/Ryuk); add `--filter "!@waitron/setup"` to BOTH `test-light-a` and `test-light-b` exclusion lists; add `- test-setup` to the `ci` aggregate `needs`. Update `scripts/ci-workflow.test.mjs` + `scripts/changed-scope.test.mjs` expected sets (SETUP_PACKAGE in OWN_SHARD, excluded from both light shards, `excludedBy` lists match the new `--filter` args).
- [ ] **Step 4 — prove the partition is consistent:** `pnpm vitest run scripts/ci-workflow.test.mjs scripts/changed-scope.test.mjs` green (they police every-package-in-exactly-one-bin + own-shard exclusion + ci.yml `--filter` parity). Also `node scripts/changed-scope.mjs` over a `apps/setup`-touching path resolves `setup=true` (grep how the test invokes it).
- [ ] **Step 5 — commit** `-s`: `feat(setup): scaffold @waitron/setup app + wire its own CI browser shard (onboarding 2c)`.

---

## Task 2: `SetupApi` client + the shell screen-state machine + boot status

**Files:** Create `apps/setup/src/api/client.ts`, `apps/setup/src/api/client.test.ts`; Modify `apps/setup/src/setup-app.ts`, `src/setup-app.test.ts`, `src/main.ts` (wire `new SetupApi()`).

**Interfaces (map §1d, §4):**
```ts
// client.ts — LOCAL types (do NOT import @waitron/provisioning)
export interface SetupStatus { provisioned: boolean; environment: "production" | "preproduction"; needs: string[]; }
export interface AdminDraft { displayName: string; pin: string; password: string; }
export interface LocationDraft { name: string; fiscalTerritory: "ES-common"; invoiceLocales: string[]; operationDescription: string; addressLine1: string; addressLine2: string | null; postalCode: string; city: string; province: string; timeZone: string; dayCutover: string; }
export interface AeatCertDraft { pfxBase64: string; passphrase: string; certKind: "sello" | "representante"; }
export interface ProvisionBody { mode: "demo" | "live"; venue: { country: string; taxId: string; legalName: string; location: LocationDraft; tillName: string; seriesCode: string; rectificativeSeriesCode: string; admin: AdminDraft; }; aeatCert?: AeatCertDraft; }
export interface ProvisionResult { provisioned: true; tenantId: string; restarting: true; }
export interface ApiError { code: string; params?: Record<string, unknown>; } // #request throws this — surfaces params.field
export class SetupApi {
  constructor(baseUrl?: string, fetchImpl?: typeof fetch);
  getStatus(): Promise<SetupStatus>;
  provision(body: ProvisionBody): Promise<ProvisionResult>;
}
```
`#request<T>` funnels both (map §1d): `credentials:"include"`, JSON body when present, non-2xx → read `{error:{code,params}}` and `throw { code, params }` (surface `params` — the divergence the wizard needs), 2xx empty → `undefined`.

- [ ] **Step 1 — failing client tests** (inject a stub fetch, as till's client.test does): `getStatus` returns the parsed status; `provision` posts the body and returns the result; a 400 `{error:{code:"setup.request_invalid",params:{field:"taxId"}}}` → the thrown error carries BOTH `code` and `params.field`; an empty 200 → resolves. Run — FAIL.
- [ ] **Step 2 — implement `client.ts`.** Then GREEN.
- [ ] **Step 3 — the shell state machine** (map §1c): in `setup-app.ts`, `type Screen = "mode"|"admin"|"venue"|"cert"|"review"|"provisioning"|"done"`; `@state() private screen: Screen = "mode"`; `@property({attribute:false}) api!: SetupApi`; a `@state() private draft: Partial<ProvisionBody>` (the accumulated request-draft, initialised with sensible defaults — `location.fiscalTerritory:"ES-common"`, `location.timeZone:"Europe/Madrid"`, `invoiceLocales:["es-ES"]`); a `@state() environment` read from `GET /setup-api/status` in `firstUpdated`→`#boot()` (fully try/catch'd). `#renderScreen()` = `switch(this.screen)`. For Task 2, only the `mode` placeholder need render richly; the other screens can be stubs advanced later — but wire the `#onPatch(patch)` handler (merges a screen's emitted patch into `draft`) and `#goto(screen)` nav. Update `main.ts` to pass `new SetupApi()`.
- [ ] **Step 4 — shell test:** boot calls `getStatus` (stub api) and stores `environment`; `#onPatch` merges; `#goto` flips `screen`. Prove the boot try/catch by making `getStatus` reject → the shell still renders (no unhandled rejection).
- [ ] **Step 5 — coverage + commit** `-s`: `feat(setup): SetupApi client + shell screen-state machine + boot status (onboarding 2c)`.

---

## Task 3: Server serve wiring — serve the built wizard in setup mode

**Files:** Modify `apps/server/src/config.ts` (`setupAppDir`), `apps/server/src/setup-api.ts` (`mountSetup` Option A), `apps/server/src/boot.ts` (assertBuiltApp + thread `setupAppDir`); Tests `apps/server/src/config.test.ts`, `apps/server/src/setup-api.test.ts`.

- [ ] **Step 1 — failing tests:** `config.test.ts`: `WAITRON_SETUP_APP_DIR` set → `config.setupAppDir` is it; unset/empty → `undefined` (mirror the `tillAppDir` cases). `setup-api.test.ts`: `mountSetup(app, { …, setupAppDir: <a dir with an index.html> }, log)` → `GET /setup-api/status` still 200 JSON, `POST /setup-api/provision` still routed, and a stray `GET /somewhere` serves the wizard `index.html` (NOT the placeholder, NOT 404); with `setupAppDir` absent → the stray path serves the placeholder (unchanged).
- [ ] **Step 2 — run: FAIL.**
- [ ] **Step 3 — implement** (map §3b/§3d): `config.ts` add `setupAppDir?: string` (mirror `tillAppDir`'s field + `isUnset(env.WAITRON_SETUP_APP_DIR) ? undefined : env.WAITRON_SETUP_APP_DIR`). `setup-api.ts`: `SetupDeps` gains `setupAppDir?: string`; at the END of `mountSetup`, `if (deps.setupAppDir !== undefined) mountSpa(app, { root: deps.setupAppDir, basePath: "" }, log); else app.get("*", …placeholder…)`. (Import `mountSpa` from `./spa-api.js`.) `boot.ts`: in the fail-fast group add `if (config.setupAppDir !== undefined) assertBuiltApp(config.setupAppDir, "WAITRON_SETUP_APP_DIR");`, and thread `setupAppDir: config.setupAppDir` into the setup-branch `mountSetup(...)` call. Do NOT touch the trading branch.
- [ ] **Step 4 — run: PASS.** Prove the ordering by deletion (register the SPA catch-all BEFORE the status route → the status test fails → restore). Confirm the trading full-boot test is unchanged.
- [ ] **Step 5 — coverage + commit** `-s`: `feat(server): serve the built setup wizard in setup mode via WAITRON_SETUP_APP_DIR (onboarding 2c)`.

---

## Task 4: The `mode`, `admin`, and `review` screens + shell navigation

**Files:** Create `apps/setup/src/screens/mode-screen.ts`(+`.test.ts`,+`.a11y.test.ts`), `admin-screen.ts`(+tests), `review-screen.ts`(+tests); `apps/setup/src/widgets/test-helpers.ts` (mount/cleanup/axe — copy dashboard's, coverage-excluded); Modify `setup-app.ts` (render these screens, Next/Back, conditional cert step). Follow `apps/dashboard/src/screens/login-screen.ts` exactly for the form/error/token/a11y patterns.

- **`mode-screen`**: header with the welcome + "browser warning is expected" note (R2); two `wt-card`/`wt-button` choices **Demo** vs **Live**; choosing **Live** shows a LOUD irreversibility warning ("a live box files real invoices and can never become a demo — fiscal §5") and requires an explicit confirm before emitting `mode:"live"`. Emits `step-complete { patch:{ mode } }` up; shell advances to `admin`.
- **`admin-screen`**: `displayName` (text), `password` (`wt-input type="password"`), `pin` (`type="password"`); client-validate non-empty; emit `patch:{ venue:{ admin:{…} } }` (or a flat patch the shell nests). Back → `mode`, Next → `venue`.
- **`review-screen`**: renders a read-only summary of the draft (mode, tenant, location, series, whether a cert is attached — NEVER show the PIN/password/passphrase/pfx values) + a **Provision** `wt-button` that emits `provision-requested`; the shell switches to `provisioning`. Back → `venue` (or `cert`).
- Shell: Next from `admin` → `venue`; after `venue`, if `mode==="live" && draft.venue.location.fiscalTerritory==="ES-common"` → `cert`, else → `review`.

- [ ] Per screen: **failing behaviour test** (renders, `wt-change`→state, Next/Back emits the right event/patch, live-confirm gate) → red → implement (tokens only, `baseStyles`, `data-test` hooks, `stopPropagation` on `wt-change`) → green; **a11y test** (`axe` clean, every input has a label). Prove the live-confirm gate by deletion. Then coverage + commit each screen (or batch the three in one commit).
- [ ] **Commit** `-s`: `feat(setup): mode/admin/review screens + wizard navigation (onboarding 2c)`.

---

## Task 5: The `venue` screen (tenant + location + series form)

The field-heavy step. **Files:** Create `apps/setup/src/screens/venue-screen.ts`(+`.test.ts`,+`.a11y.test.ts`), `apps/setup/src/select-styles.ts` (copy dashboard's); Modify `setup-app.ts` if needed.

- Fields (map §4b, exact names): `country` (default "ES"), `taxId`, `legalName`; location `name`, `fiscalTerritory` (native `<select>`, only `ES-common`), `invoiceLocales` (a small hand-rolled multi-value control — checkbox list of common locales or a comma field; 1–2, default `["es-ES"]`), `operationDescription`, `addressLine1`, `addressLine2` (optional → `null` when blank), `postalCode`, `city`, `province`, `timeZone` (`<select>`, default `Europe/Madrid`), `dayCutover` (`type="time"` or text `HH:MM`); `tillName`, `seriesCode`, `rectificativeSeriesCode`. Use a small in-screen `field(label,key,type?)` render helper to cut repetition (R stays inside the app).
- Client validation before Next: required non-empty; `seriesCode !== rectificativeSeriesCode`; `invoiceLocales.length` 1–2 — surface a `role="alert"` banner + mark the offending field `invalid`.
- Emits `patch` merging tenant + `location` + series into the draft. Back → `admin`.

- [ ] **Failing test** (all fields render + bind; the seriesCode==rectificative validation blocks Next with a banner; addressLine2 blank → null in the patch) → red → implement → green; **a11y test** (axe clean; every field labelled; the `<select>`s have accessible names). Prove the seriesCode-equality guard by deletion.
- [ ] **Commit** `-s`: `feat(setup): venue screen — tenant/location/series form with validation (onboarding 2c)`.

---

## Task 6: The `cert` + `provisioning`/`done` screens (the POST + restart-reconnect) + design-spec note

**Files:** Create `apps/setup/src/screens/cert-screen.ts`(+tests), `provisioning-screen.ts`(+tests); Modify `setup-app.ts` (the provision flow); the design spec §16 note (append at land, not here).

- **`cert-screen`** (rendered only when live+ES-common): `<input type="file">` → read to base64 in-browser via `FileReader` (`readAsDataURL` → strip the `data:…;base64,` prefix) into `pfxBase64`; `passphrase` (`type="password"`); `certKind` (`<select>` sello/representante). Emit `patch:{ aeatCert:{…} }`. Back → `venue`, Next → `review`.
- **`provisioning-screen`** (the shell drives this on `provision-requested`): the shell calls `api.provision(assembleBody(draft))`. On the **200** → switch to `done`. On error → return to the relevant screen (or stay) and show the mapped message: `setup.request_invalid` → banner + mark `params.field` invalid on whichever screen owns it (or a generic banner on review); `setup.aeat_cert_required` → back to cert; `setup.already_provisioning` (409) → "already in progress"; `setup.already_provisioned`/`deployment.already_stamped` (409) → "this box is already set up"; `setup.not_ready` (503) → "the box isn't ready"; `setup.provision_failed` (500) → generic. Client pre-validation runs before POST (restart-on-success makes retry the only recovery). While the request is in flight, disable the Provision button + show a spinner-less "Provisioning…" state.
- **`done` screen** (part of provisioning-screen or its own): "Setup complete — the box is restarting into trading mode." After a short delay, poll `GET /setup-api/status` (or `GET /`) on an interval; once the setup route stops answering / the till HTML appears, prompt "Reload to open the till" (a `wt-button` that does `location.reload()`), or auto-reload after ~20–30s. Handle the expected fetch failures during the restart window (they're normal — do not surface them as errors).

- [ ] **Failing tests:** cert file→base64 (feed a `File`/`Blob`, assert the emitted `pfxBase64` has no `data:` prefix); the shell's provision success → `done`; each error code → the mapped UX (stub `api.provision` to reject with `{code,params}`); the done-screen poll → reload prompt (stub `getStatus` to start failing → the prompt appears). → red → implement → green; **a11y tests**. Prove the cert-only-when-live-ES-common render gate by deletion.
- [ ] **Manual verification (documented, best-effort):** `pnpm dev:onboard`, `pnpm --filter @waitron/server dev` (HTTPS setup box), `pnpm --filter @waitron/setup dev` (Vite 5192, proxy), walk the wizard → demo venue → 200 → box restarts → reload → till. Record output; the browser tests are the gate if the manual run is flaky.
- [ ] **Design-spec §16 note** (at land, per CLAUDE.md §6 dated pointer): record 2c landed — the `apps/setup` wizard, R2 (trust UX deferred to slice 3), R3 (English-only MVP).
- [ ] **Commit** `-s`: `feat(setup): cert + provisioning/done screens — POST provision, error UX, restart-reconnect (onboarding 2c)`.

---

## Self-Review

**1. Spec coverage:** §4 flow → the 6 screens (T2/T4/T5/T6). §10 admin/tenant/location + AEAT cert → T4 (admin/venue) + T6 (cert), matching the 2b request contract exactly (map §4b). §5 served-in-setup-mode → T3. §16 = the `apps/setup` wizard → the whole slice. **Deferred (stated):** trust UX + pairing QR (slice 3, R2); es-ES localisation (R3); installable PWA.

**2. Placeholder scan:** each screen task names its fields, events, validation, and a11y requirement; the map file carries the exact `wt-input`/`login-screen` patterns the implementers copy. No "TODO/handle errors" — the error table (map §4b) enumerates every code.

**3. Type consistency:** `SetupApi.provision(ProvisionBody): Promise<ProvisionResult>` (T2) is what the shell calls in T6; `ProvisionBody` field names match the server contract (map §4b, verified against `parseVenue`/`VenueRequest`); the shell's `draft: Partial<ProvisionBody>` is assembled from the screen patches (T4/T5/T6) and posted in T6. `config.setupAppDir` (T3) is threaded into `mountSetup`'s `setupAppDir` (T3) — server-side, independent of the app.

**Risk note for the fix/review loop:** the server change (T3) touches `boot.ts` + `mountSetup` — confirm the trading branch + the existing setup placeholder path (no `setupAppDir`) are unchanged, and the `/setup-api/*` routes still win their paths over the SPA catch-all (ordering test). The CI wiring (T1) must keep `ci-workflow.test.mjs`/`changed-scope.test.mjs` green — a browser package MUST be own-shard (light shards have no Playwright). Client types must not import server/Node barrels into the browser bundle. Secrets (PIN/password/passphrase/pfx) must never be rendered in the review screen or logged.
