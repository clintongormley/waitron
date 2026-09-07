# Bookings SP2 — Dashboard Module-UI Seat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give any module a browser-safe way to contribute a dashboard screen + i18n + nav + permission gate without the dashboard importing the module's server package, and prove it by moving the bookings screen, widget, api and strings onto that seat so `apps/dashboard` names bookings nowhere.

**Architecture:** A new browser-safe `@waitron/dashboard-kit` holds the contribution contract, a shared `fetch` primitive, and the i18n + code-message registries lifted out of the app. Each module ships a `./dashboard` browser sub-path exporting a `DashboardContribution`; a browser-safe `@waitron/dashboard-modules` registry lists them (the browser mirror of `ALL_MODULES`). The app iterates the registry, activating the modules the server reports enabled and gating each on the user's effective permissions (added to `GET /management-api/session/me`). Build-time registry, runtime enable/disable, one Vite bundle — no code-splitting.

**Tech Stack:** TypeScript (ESM, `type: module`), Lit 3, Hono, Vitest (Node for the kit/registry; real headless Chromium for the app + the module's Lit code), pnpm workspaces, Drizzle (unaffected — no schema change).

**Spec:** `docs/superpowers/specs/2026-09-07-module-bookings-sp2-dashboard-ui-seat-design.md` — the plan argues from the spec; executors read both. Where this plan corrects the spec from the real code, it says so inline. Three known deltas: (1) `createRequest` does **not** do a 401→login redirect, only error decode; (2) the real client method is `markNoShow`, not `noShowBooking`; (3) `DashboardRequest` is **path-first** `(path, method, body?)` — matching the real `#request<T>(path, method, body?)` (`client.ts:2446`) — not the spec §6 `(method, path)`.

## Global Constraints

Every task's requirements implicitly include these (verbatim from the spec + CLAUDE.md):

- **No dynamic `import()` enters the app.** One Vite bundle; the registry is static and tree-shaken.
- **Browser purity is the load-bearing invariant.** No file reachable from a module's `./dashboard` export — nor `@waitron/dashboard-kit` / `@waitron/dashboard-modules` — may import a server-only specifier (`@waitron/db`, `hono`, `pg`, `drizzle-orm`, `node:*`) or a module's server entry. Proven by a guard **and** a Vite build.
- **Error codes and permissions are never renamed once shipped** (CLAUDE.md §3). `booking.*` codes and `booking.manage` are relocated, never renamed.
- **Bookings and the two new packages take the FLOOR coverage bar** `statements 90 / lines 90 / functions 85 / branches 85`; none is added to `HIGH_BAR_PACKAGES` in `scripts/coverage-thresholds.test.ts`.
- **URLs and request bodies stay byte-identical** (`/management-api/bookings…`); the moved wire test is the proof.
- **Behaviour-preserving moves.** Moved screen/widget/client/i18n tests travel WITH their assertions intact — never rewritten to match the new wiring (global CLAUDE.md).
- **Spanish only as translation VALUES.** `@waitron/dashboard-kit` / `@waitron/dashboard-modules` are generic English packages (identifiers + comments English); the `es` catalogue holds user-facing copy, which is data, not vocabulary.
- **Chromium/RAM coordination** (CLAUDE.md §2/§4): before any browser-mode run (`apps/dashboard`, `@waitron/bookings`'s Lit code, whole-workspace), check `memory_pressure | grep free` and `pgrep -fl "chromium_headless_shell|Chromium"`, and scale `--workspace-concurrency` to measured headroom.
- **Every commit `-s`.** Feature work in the worktree; the plan does not push or open the PR (that is `/finish-branch`).

## File Structure

**New — `@waitron/dashboard-kit`** (browser-safe; deps `@waitron/shared`, `lit`):
- `packages/dashboard-kit/package.json`, `tsconfig.json`, `vitest.config.ts` (Node vitest — no DOM)
- `src/i18n.ts` — locale state + pub/sub + `t` + `makeT` + `pickLocale` + `registerCatalogue`
- `src/codes.ts` — `codeMessage` + `codeOf` + `registerCodeMessages`
- `src/request.ts` — `createRequest`, `DashboardRequest`, `FetchLike`
- `src/contract.ts` — `DashboardContribution`, `DashboardModuleContext`, `DashboardScreenHandle`, `NavGroupId`
- `src/index.ts` — barrel
- `src/{i18n,codes,request}.test.ts` — the resolver tests (the app's i18n resolver test moves here)

**New sub-path — `@waitron/bookings/dashboard`** (browser-safe; deps add `lit`, `@waitron/ui`, `@waitron/dashboard-kit`):
- `packages/bookings/src/dashboard/bookings-screen.ts` + `booking-form.ts` (moved from `apps/dashboard`)
- `packages/bookings/src/dashboard/client.ts` — the module's own `BookingApi` + `Booking*` types (moved)
- `packages/bookings/src/dashboard/strings.ts` — `booking.*` + `nav.bookings` catalogue, `bookingStatusName`, `booking.*` code messages (moved)
- `packages/bookings/src/dashboard/index.ts` — exports `BOOKINGS_DASHBOARD: DashboardContribution`
- `packages/bookings/src/dashboard/*.test.ts` — moved screen/widget/client tests

**New — `@waitron/dashboard-modules`** (browser-safe; deps `@waitron/dashboard-kit`, `@waitron/bookings`):
- `packages/dashboard-modules/package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/index.ts` — `export const DASHBOARD_MODULES`
- `src/registry.test.ts` — the honesty pin

**New guard:** `scripts/dashboard-browser-purity.test.ts` (root project).

**Modified:**
- `apps/dashboard/src/i18n/t.ts`, `i18n/codes.ts`, `i18n/domain.ts` — re-point to the kit, register base catalogues on load
- `apps/dashboard/src/api/client.ts` — `#request` → `createRequest`; delete bookings methods + types
- `apps/dashboard/src/dashboard-app.ts` — generic module mount; delete bookings' four sites; nav-group ids
- `apps/dashboard/src/main.ts` — inject `.request`
- `apps/dashboard/package.json` — add `@waitron/dashboard-kit`, `@waitron/dashboard-modules`
- `packages/bookings/package.json` — `exports` map with `./dashboard`; add browser deps
- `apps/server/src/me-api.ts` — `permissions` + `modules` on `getMe`; `apps/server/src/boot.ts` — thread enabled-module names
- `packages/identity/src/permissions.ts` + `src/index.ts` — export `permissionsForRole`
- `scripts/module-seams.test.ts` — `apps/dashboard` imports no module server entry / composition
- `docs/backlog.md` — Track C item 3 SP2 landed

---

## Task 1: `@waitron/dashboard-kit` — the shared browser machinery

Scaffold the package and lift the i18n resolver, code-message resolver, and `fetch` primitive out of `apps/dashboard`, re-pointing the app so **every existing dashboard test still passes unchanged** (a behaviour-preserving lift). No contribution is consumed yet.

**Files:**
- Create: `packages/dashboard-kit/{package.json,tsconfig.json,vitest.config.ts}`, `src/{i18n,codes,request,contract,index}.ts`, `src/{i18n,codes,request}.test.ts`
- Modify: `apps/dashboard/src/i18n/t.ts`, `apps/dashboard/src/i18n/codes.ts`, `apps/dashboard/src/i18n/domain.ts`, `apps/dashboard/src/api/client.ts:1206-2466`, `apps/dashboard/package.json`

**Interfaces produced (later tasks rely on these exact signatures):**
```ts
// @waitron/dashboard-kit
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type DashboardRequest = <T>(path: string, method: string, body?: unknown) => Promise<T>;
export function createRequest(opts?: { baseUrl?: string; fetchImpl?: FetchLike }): DashboardRequest;

export function t(key: string, l?: string): string;
export function makeT<K extends string>(): (key: K, l?: string) => string;
export function pickLocale(entry: { en: string; es: string }, l?: string): string;
export function setLocale(l: string): void;
export function currentLocale(): string;
export function subscribeLocale(listener: () => void): () => void;
export function registerCatalogue(cat: { en: Record<string, string>; es: Record<string, string> }): void;

export function codeMessage(code: string, l?: string): string;
export function codeOf(err: unknown, fallback?: string): string; // real default "server.internal" (client tests pass a 2nd arg)
export function registerCodeMessages(table: Record<string, { en: string; es: string }>): void;

export type NavGroupId = string; // a dashboard nav-group id; the app validates against its known ids
export interface DashboardModuleContext { request: DashboardRequest }
export interface DashboardScreenHandle { render(): import("lit").TemplateResult }
export interface DashboardContribution {
  module: string;            // == the server descriptor name
  screen: {
    id: string;
    navLabelKey: string;
    group: NavGroupId;
    order?: number;
    requiresPermission: string;
  };
  strings: { en: Record<string, string>; es: Record<string, string> };
  create(ctx: DashboardModuleContext): DashboardScreenHandle;
}
```

- [ ] **Step 1: Scaffold the package.** Copy `packages/server-kit/{tsconfig.json,vitest.config.ts}` verbatim (Node vitest, `singleFork`, floor thresholds `90/90/85/85`, `src/index.ts` excluded from coverage). Write `package.json`:

```json
{
  "name": "@waitron/dashboard-kit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run", "test:watch": "vitest", "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit", "lint": "eslint ."
  },
  "dependencies": { "@waitron/shared": "workspace:*", "lit": "^3.2.0" },
  "devDependencies": {
    "@types/node": "^24.0.0", "@vitest/coverage-v8": "^3.0.0", "typescript": "^5.7.0", "vitest": "^3.0.0"
  }
}
```
Run `pnpm install` so the workspace links the new package.

- [ ] **Step 2: Write the failing i18n resolver test** (`src/i18n.test.ts`). This is the app's current resolution behaviour, region-strip included (`es-ES`→`es`, `en-GB`→`en`), asserted on the registry:

```ts
import { beforeEach, expect, it } from "vitest";
import { t, registerCatalogue, setLocale } from "./i18n.js";

beforeEach(() => {
  registerCatalogue({ en: { "x.hi": "Hi" }, es: { "x.hi": "Hola" } });
  setLocale("es-ES");
});
it("resolves the region-stripped locale, then English, then the key", () => {
  expect(t("x.hi")).toBe("Hola");          // es-ES -> es
  expect(t("x.hi", "en-GB")).toBe("Hi");   // en-GB -> en
  expect(t("x.missing")).toBe("x.missing"); // unknown key degrades to the key, never undefined
});
```

- [ ] **Step 3: Run it — Expected: FAIL** (`cannot find module ./i18n.js`).
Run: `pnpm --filter @waitron/dashboard-kit test src/i18n.test.ts`

- [ ] **Step 4: Write `src/i18n.ts`.** Lift `t.ts`'s locale state + pub/sub verbatim; replace the `strings.js`-bound `catalogues`/`en` with a mutable registry and region-strip resolution (behaviour-preserving — the old `catalogues` mapped `en-GB`/`es-ES` to the same maps region-strip now reaches):

```ts
type Catalogue = Record<string, Record<string, string>>;
const catalogues: Catalogue = { en: {}, es: {} };
let locale = "es-ES";
type LocaleListener = () => void;
const localeListeners = new Set<LocaleListener>();

export function subscribeLocale(listener: LocaleListener): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}
export function setLocale(l: string): void {
  locale = l;
  for (const listener of localeListeners) listener();
}
export function currentLocale(): string {
  return locale;
}
export function registerCatalogue(cat: { en: Record<string, string>; es: Record<string, string> }): void {
  Object.assign(catalogues.en, cat.en);
  Object.assign(catalogues.es, cat.es);
}
export function t(key: string, l: string = locale): string {
  const lang = l.replace(/-.*$/, "");
  return catalogues[lang]?.[key] ?? catalogues.en[key] ?? key;
}
export function makeT<K extends string>(): (key: K, l?: string) => string {
  return (key, l) => t(key, l);
}
export function pickLocale(entry: { en: string; es: string }, l: string = locale): string {
  const lang = l.replace(/-.*$/, "");
  return (entry as Record<string, string>)[lang] ?? entry.en;
}
```

- [ ] **Step 5: Run it — Expected: PASS.** `pnpm --filter @waitron/dashboard-kit test src/i18n.test.ts`

- [ ] **Step 6: Write `src/request.ts` with its test.** Port `client.ts:2446-2466` verbatim into a factory. **Spec correction:** the real `#request` does NOT redirect on 401 — it only decodes `{ error: { code } }` and throws `{ code }`. Keep exactly that.

```ts
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type DashboardRequest = <T>(path: string, method: string, body?: unknown) => Promise<T>;

export function createRequest(opts: { baseUrl?: string; fetchImpl?: FetchLike } = {}): DashboardRequest {
  const baseUrl = opts.baseUrl ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async <T>(path: string, method: string, body?: unknown): Promise<T> => {
    const init: RequestInit =
      body === undefined
        ? { method, credentials: "include" }
        : body instanceof FormData
          ? { method, credentials: "include", body }
          : { method, credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const res = await fetchImpl(baseUrl + path, init);
    if (!res.ok) {
      const envelope = (await res.json()) as { error?: { code?: string } };
      throw { code: envelope.error?.code ?? "server.internal" };
    }
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  };
}
```
Test (stub fetch): a 200 with JSON resolves the parsed body; a 204 empty body resolves `undefined`; a non-2xx throws `{ code }` from the envelope, `server.internal` when the body names none; a JSON body sends `content-type: application/json`, a `FormData` body sends none.

- [ ] **Step 7: Write `src/codes.ts` with its test.** Move `codeMessage`/`codeOf` from `apps/dashboard/src/i18n/codes.ts` (read that file) into the kit, backing the lookup with a registry instead of the module-level `CODE_MESSAGES` literal; keep the GENERIC degrade unchanged (an unmapped code is NEVER shown raw):

```ts
import { currentLocale, pickLocale } from "./i18n.js";
const GENERIC = { en: "Something went wrong, try again", es: "Algo salió mal, inténtalo de nuevo" }; // copy the app's exact GENERIC entry
const messages: Record<string, { en: string; es: string }> = {};
export function registerCodeMessages(table: Record<string, { en: string; es: string }>): void {
  Object.assign(messages, table);
}
export function codeMessage(code: string, l: string = currentLocale()): string {
  // Object.hasOwn, NOT `?? GENERIC`: a `??` over a plain object resolves inherited members
  // (`toString`, `constructor`, `hasOwnProperty`) as truthy, skips GENERIC and makes pickLocale
  // return undefined — the exact bug codes.ts:474-481 documents fixing. Behaviour-preserving move.
  return pickLocale(Object.hasOwn(messages, code) ? messages[code] : GENERIC, l);
}
// codeOf moves VERBATIM from apps/dashboard/src/i18n/codes.ts (the { code } extractor,
// signature `codeOf(error: unknown, fallback = "server.internal")` — keep the fallback param).
```
Test: a registered code resolves in es and en; an unregistered code degrades to GENERIC (never the raw code); a code equal to a prototype key (`"toString"`, `"constructor"`) ALSO degrades to GENERIC (the prototype-key case — prove the `Object.hasOwn` guard by deletion); `codeOf` extracts the code from a thrown `{ code }`, and `codeOf({}, "x")` returns the fallback `"x"`.

- [ ] **Step 8: Write `src/contract.ts` and `src/index.ts`.** `contract.ts` holds the `DashboardContribution` family (see Interfaces above). `index.ts` re-exports everything from `i18n`, `codes`, `request`, `contract`.

- [ ] **Step 9: Re-point the app onto the kit (behaviour-preserving).**
  - `apps/dashboard/src/i18n/t.ts` becomes a thin typed wrapper that registers the base catalogue on load:
    ```ts
    import { en, es, type StringKey } from "./strings.js";
    import { makeT, registerCatalogue } from "@waitron/dashboard-kit";
    export { setLocale, currentLocale, subscribeLocale, pickLocale } from "@waitron/dashboard-kit";
    registerCatalogue({ en, es });   // load-time: base catalogue present before any t()
    export const t = makeT<StringKey>();
    ```
    (If `strings.ts` exports `catalogues` rather than a bare `es`, adapt: register `{ en, es: catalogues.es }`. Read `strings.ts` first.)
  - `apps/dashboard/src/i18n/codes.ts`: keep the `CODE_MESSAGES` literal, delete the local `codeMessage`/`codeOf`, and register + re-export:
    ```ts
    import { registerCodeMessages, codeMessage, codeOf } from "@waitron/dashboard-kit";
    /* keep: const CODE_MESSAGES = { … } */
    registerCodeMessages(CODE_MESSAGES);
    export { codeMessage, codeOf };
    ```
  - `apps/dashboard/src/i18n/domain.ts`: import `pickLocale`/`currentLocale` from `@waitron/dashboard-kit` instead of `./t.js`.
  - `apps/dashboard/src/api/client.ts`: import `{ createRequest, type DashboardRequest, type FetchLike }` from the kit; delete `FetchLike` local (line 1207) and the `#baseUrl`/`#fetchImpl` fields; replace the `#request` **method** (2446-2466) with a field, keeping the ctor signature so all ~100 call sites and the client tests are unchanged:
    ```ts
    readonly #request: DashboardRequest;
    constructor(baseUrl = "", fetchImpl: FetchLike = fetch) {
      this.#request = createRequest({ baseUrl, fetchImpl });
    }
    ```
  - Add `@waitron/dashboard-kit: "workspace:*"` to `apps/dashboard/package.json` dependencies; `pnpm install`.
  - Move the app's i18n resolver test (if `apps/dashboard/src/i18n/t.test.ts` exists testing `t` resolution) into the kit; leave any app test that asserts `t` is typed to `StringKey`.

- [ ] **Step 10: Run the kit and the app (browser-mode — observe the Chromium/RAM rule).**
Run: `pnpm --filter @waitron/dashboard-kit test:coverage && pnpm --filter @waitron/dashboard test:coverage`
Expected: PASS — the app's existing screens, i18n and client tests are green with no assertion changes.

- [ ] **Step 11: Commit.**
```bash
git add packages/dashboard-kit apps/dashboard/src/i18n apps/dashboard/src/api/client.ts apps/dashboard/package.json pnpm-lock.yaml
git commit -s -m "feat(dashboard-kit): lift i18n, code-message and request helpers into a browser-safe kit"
```

---

## Task 2: `@waitron/bookings/dashboard` — move the bookings UI onto a contribution

Add the browser sub-path, move the screen/widget/client/strings, export the `DashboardContribution`, and add the browser-purity guard proving the sub-path never reaches server code.

**Files:**
- Create: `packages/bookings/src/dashboard/{bookings-screen.ts,booking-form.ts,client.ts,strings.ts,index.ts}` + their tests; `scripts/dashboard-browser-purity.test.ts`
- Modify: `packages/bookings/package.json` (exports map + browser deps)

**Interfaces produced:**
```ts
// @waitron/bookings/dashboard
export const BOOKINGS_DASHBOARD: DashboardContribution; // module "bookings", screen id "bookings", requiresPermission "booking.manage", group "service"
```
**Consumes:** `@waitron/dashboard-kit` (`DashboardContribution`, `DashboardRequest`, `t`/`makeT`, `codeMessage`/`codeOf`, `registerCatalogue`/`registerCodeMessages`).

- [ ] **Step 1: Add the `exports` map + browser deps + a SECOND vitest project to `@waitron/bookings`.**
```json
"exports": {
  ".": "./src/index.ts",
  "./dashboard": "./src/dashboard/index.ts"
},
```
Add to `dependencies`: `"@waitron/dashboard-kit": "workspace:*"`, `"@waitron/ui": "workspace:*"`, `"lit": "^3.2.0"`. Keep `"main": "./src/index.ts"`. Add `@vitest/browser` + `playwright` devDeps (copy from `packages/ui/package.json`). `pnpm install`.

  **The dual-project problem (plan review finding 7):** `packages/bookings/vitest.config.ts` is Node-only with a Postgres `globalSetup` that boots containers for every worker (`singleFork`, 120s timeout). Browser-mode Lit tests must NOT inherit that globalSetup (a pure-browser test must not try to boot Docker). So convert the package to **two Vitest projects** (a `vitest.workspace.ts` or the `projects` field):
  - the **existing Node project** — unchanged config (Postgres globalSetup, singleFork), scoped to everything EXCEPT `src/dashboard/**`;
  - a new **browser project** — mirror `packages/ui/vitest.config.ts` (`browser.enabled`, playwright, chromium, headless), NO globalSetup, scoped to `src/dashboard/**/*.test.ts`.
  Ensure `test:coverage` runs BOTH projects and merges coverage at the floor bar (`90/90/85/85`). Verify locally with `pnpm --filter @waitron/bookings test:coverage`.

  **CI shard (finding 7, second half):** `@waitron/bookings` runs today in a Node "light" shard (`scripts/changed-scope.mjs` bins — CLAUDE.md §2; the browser shards are `test-ui/till/dashboard/setup`). A light shard has no Chromium/playwright, so its new browser project would fail in CI. Read `scripts/changed-scope.mjs`; either move `@waitron/bookings` into a browser-capable bin or ensure the bin that runs it installs playwright's Chromium (mirror how `test-ui` does it). This is a required step, not optional — confirm on a real PR run (the pnpm changed-since filter is a no-op in a worktree, CLAUDE.md §2).

- [ ] **Step 2: Move the client + types.** `git mv` is not possible across the method boundary, so create `packages/bookings/src/dashboard/client.ts`: move `Booking`, `BookingInput`, `BookingPatch`, `BookingStatus` (client.ts:899-951) and the seven booking methods (client.ts:2327-2365) into a small class built on an injected `DashboardRequest`. **Spec correction:** the real method is `markNoShow` (not `noShowBooking`) — keep the shipped name.

```ts
import type { DashboardRequest } from "@waitron/dashboard-kit";
export type BookingStatus = "booked" | "seated" | "completed" | "no_show" | "cancelled";
export interface Booking { /* move client.ts:909-922 verbatim */ }
export interface BookingInput { /* move client.ts:930-938 verbatim */ }
export interface BookingPatch { /* move client.ts:943-951 verbatim */ }
export interface DashboardTable { /* copy client.ts's DashboardTable shape — the screen's table picker/seat prompt; also used by floor-screen, so COPY, don't move */ }

export class BookingApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) { this.#request = request; }
  listBookings(date: string) { return this.#request<Booking[]>(`/management-api/bookings?date=${date}`, "GET"); }
  createBooking(input: BookingInput) { return this.#request<{ id: string }>("/management-api/bookings", "POST", input); }
  updateBooking(id: string, patch: BookingPatch) { return this.#request<void>(`/management-api/bookings/${id}`, "PATCH", patch); }
  seatBooking(id: string, req: { tableId?: string } = {}) { return this.#request<{ tabId: string }>(`/management-api/bookings/${id}/seat`, "POST", req); }
  cancelBooking(id: string) { return this.#request<void>(`/management-api/bookings/${id}/cancel`, "POST"); }
  markNoShow(id: string) { return this.#request<void>(`/management-api/bookings/${id}/no-show`, "POST"); }
  completeBooking(id: string) { return this.#request<void>(`/management-api/bookings/${id}/complete`, "POST"); }
  // CRITICAL (plan review finding 1): the screen calls this.api.listTables() (bookings-screen.ts:149)
  // to populate the form's table picker + seat prompt. It is a core /management-api/tables method
  // (client.ts:1624), NOT one of the seven booking routes — but the screen's `.api` is retyped to
  // BookingApi, so BookingApi MUST carry it or the screen breaks.
  listTables() { return this.#request<DashboardTable[]>("/management-api/tables", "GET"); }
}
```
Delete the seven booking methods and the four booking types from `apps/dashboard/src/api/client.ts`. Do NOT delete `listTables` (client.ts:1624) or `DashboardTable` from the app — `floor-screen.ts` still uses them; `BookingApi` gets its own `listTables` + a local `DashboardTable` copy.

- [ ] **Step 3: Move the wire-pin test.** Move the bookings cases of `apps/dashboard/src/api/client.test.ts` into `packages/bookings/src/dashboard/client.test.ts`, retargeting `new DashboardApi("", stub)` → `new BookingApi(createRequest({ fetchImpl: stub }))`. Assertions on URLs/bodies/methods stay byte-identical — this is the proof the wire didn't move. Also **copy** (do not delete from the app) the `listTables` wire-pin case (`client.test.ts:1279`, `GET /management-api/tables`) into the module client test, since `BookingApi.listTables` now serves the screen. Run it: FAIL (module missing) → PASS after Step 2.

- [ ] **Step 4: Move the strings + status names + code messages** into `packages/bookings/src/dashboard/strings.ts`:
  - the `booking.*` keys (strings.ts:446-463 en, :997-1014 es) and `nav.bookings` (:53) as `{ en, es }` maps;
  - `bookingStatusName` (from `apps/dashboard/src/i18n/domain.ts`) verbatim;
  - the `booking.*` entries from the app's `CODE_MESSAGES` table (the booking error codes the screen surfaces).
  Export a `BOOKINGS_STRINGS = { en, es }`, `BOOKINGS_CODE_MESSAGES`, and a module-typed `t = makeT<keyof typeof en>()`. Delete these entries from the app's `strings.ts`, `domain.ts`, and `CODE_MESSAGES`.

- [ ] **Step 5: Move the screen + widget.** `git mv apps/dashboard/src/screens/bookings-screen.ts packages/bookings/src/dashboard/bookings-screen.ts` and `git mv apps/dashboard/src/widgets/booking-form.ts packages/bookings/src/dashboard/booking-form.ts` (and their tests). Re-point imports:
  - `import { t } from "../i18n/t.js"` → `import { t } from "./strings.js"` (the module's typed `t`)
  - `import { codeMessage, codeOf } from "../i18n/codes.js"` → `from "@waitron/dashboard-kit"`
  - `import { bookingStatusName } from "../i18n/domain.js"` → `from "./strings.js"`
  - `import type { Booking, BookingInput, DashboardApi, DashboardTable } from "../api/client.js"` → `Booking`/`BookingInput`/`DashboardTable` from `./client.js`; the screen's `.api` property type changes from `DashboardApi` to `BookingApi`. `DashboardTable` is **shared** (`floor-screen.ts` uses it too), so COPY it into the module `client.ts`, do not move it out of the app.
  - `import { today } from "../date-utils.js"` → `today` (`date-utils.ts:20`) is imported by four screens (`roster`, `dashboard-sales`, `planned-actual`, `bookings`), so **COPY** it into `packages/bookings/src/dashboard/` — leave `apps/dashboard/src/date-utils.ts` intact. (If it turns out to live in `@waitron/shared`, import from there; grep first.)
  - `import { bookingStatusName } from "../i18n/domain.js"` → move to `./strings.js`, and copy alongside it the module-private `resolve` helper + `BOOKING_STATUS_NAMES` table it depends on (`domain.ts:313` + its helpers), re-pointing `pickLocale`/`currentLocale` to `@waitron/dashboard-kit`. Leave the app's other `domain.ts` name tables (roles, allergens) in place.
  - `@waitron/ui` imports stay identical.
  Update the screen/widget tests' `stubApi` to implement `listTables` (the screen calls it on connect). Run the moved screen/widget tests (browser mode): PASS with assertions intact.

- [ ] **Step 6: Write the contribution** (`packages/bookings/src/dashboard/index.ts`):
```ts
import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { BookingApi } from "./client.js";
import { BOOKINGS_STRINGS, BOOKINGS_CODE_MESSAGES } from "./strings.js";
import { registerCodeMessages } from "@waitron/dashboard-kit";
import "./bookings-screen.js"; // side-effect: defines <dashboard-bookings-screen>
registerCodeMessages(BOOKINGS_CODE_MESSAGES);

export const BOOKINGS_DASHBOARD: DashboardContribution = {
  module: "bookings",
  screen: { id: "bookings", navLabelKey: "nav.bookings", group: "service", requiresPermission: "booking.manage" },
  strings: BOOKINGS_STRINGS,
  create(ctx) {
    const api = new BookingApi(ctx.request);
    return { render: () => html`<dashboard-bookings-screen .api=${api}></dashboard-bookings-screen>` };
  },
};
```

- [ ] **Step 7: Write the browser-purity guard test** (`scripts/dashboard-browser-purity.test.ts`, root project) FIRST as a failing negative control, then green. Model on `scripts/module-seams.test.ts` (text scan + positive control):

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..");
const FORBIDDEN = ["@waitron/db", "hono", "pg", "drizzle-orm", "node:"];
const SUBPATHS = [["@waitron/bookings", "packages/bookings/src/dashboard"]]; // grows as UI modules land

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}
function forbiddenImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return FORBIDDEN.filter((f) => text.includes(`from "${f}`) || text.includes(`import "${f}`));
}

describe("module dashboard sub-paths import no server-only specifier", () => {
  for (const [pkg, dir] of SUBPATHS) {
    const files = tsFiles(join(REPO, dir));
    it(`${pkg}/dashboard scans files (not vacuous)`, () => expect(files.length).toBeGreaterThan(0));
    it.each(files.map((f) => [relative(REPO, f), f]))("%s", (_rel, file) =>
      expect(forbiddenImports(file)).toEqual([]),
    );
    it(`${pkg}/dashboard imports no sibling server entry`, () => {
      for (const f of files) {
        const text = readFileSync(f, "utf8");
        expect(text.includes('from "../index.js"'), f).toBe(false);
        expect(text.includes('from "../bookings.js"'), f).toBe(false);
      }
    });
  }
  it("the two kit packages declare no server dependency", () => {
    for (const pkg of ["dashboard-kit", "dashboard-modules"]) {
      const m = JSON.parse(readFileSync(join(REPO, `packages/${pkg}/package.json`), "utf8")) as { dependencies: Record<string, string> };
      expect(Object.keys(m.dependencies).filter((d) => FORBIDDEN.includes(d))).toEqual([]);
    }
  });
  it("detects a planted server import (positive control)", () => {
    expect(forbiddenImports.length).toBeGreaterThan(0); // sanity
    const probe = 'import { x } from "@waitron/db";';
    expect(FORBIDDEN.filter((f) => probe.includes(`from "${f}`))).toEqual(["@waitron/db"]);
  });
});
```
Prove by DELETION: temporarily add `import { sql } from "drizzle-orm";` to `bookings-screen.ts`, run the guard, watch it go red for that file, then remove it. (The `dashboard-modules` package.json check will start passing in Task 3 when that package exists — until then, scope this `it` to `dashboard-kit` only, and widen it in Task 3.)

- [ ] **Step 8: Run the module + the guard.**
Run: `pnpm --filter @waitron/bookings test:coverage` and `pnpm --filter @waitron/root test scripts/dashboard-browser-purity.test.ts` (root project — confirm the filter name from `vitest.workspace`/root config).
Expected: PASS. Bookings stays at the floor bar.

- [ ] **Step 9: Commit.**
```bash
git add packages/bookings apps/dashboard/src/api/client.ts apps/dashboard/src/i18n scripts/dashboard-browser-purity.test.ts pnpm-lock.yaml
git commit -s -m "feat(bookings): ship the dashboard contribution behind a browser-safe ./dashboard sub-path"
```

---

## Task 3: `@waitron/dashboard-modules` registry + the generic mount

Create the registry, wire the app to iterate it and render bookings through the generic path, delete bookings' four hand-wired sites, and extend the seams guard. Gating stays out (Task 4) — every **bundled** module is active here, so bookings behaves exactly as today for a non-staff session.

**Files:**
- Create: `packages/dashboard-modules/{package.json,tsconfig.json,vitest.config.ts}`, `src/index.ts`, `src/registry.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts`, `apps/dashboard/src/main.ts`, `apps/dashboard/package.json`, `scripts/module-seams.test.ts`, `scripts/dashboard-browser-purity.test.ts`

**Interfaces produced:** `export const DASHBOARD_MODULES: readonly DashboardContribution[]`.

- [ ] **Step 1: Scaffold `@waitron/dashboard-modules`.** `package.json` deps `@waitron/dashboard-kit` + `@waitron/bookings` (`workspace:*`); Node `tsconfig.json`/`vitest.config.ts` copied from server-kit. `src/index.ts`:
```ts
import { BOOKINGS_DASHBOARD } from "@waitron/bookings/dashboard";
import type { DashboardContribution } from "@waitron/dashboard-kit";
export const DASHBOARD_MODULES: readonly DashboardContribution[] = [BOOKINGS_DASHBOARD];
```
`pnpm install`.

- [ ] **Step 2: Write the honesty pin** (`src/registry.test.ts`). Every registry entry's `module` is unique, and (the cross-package pin) matches a UI-bearing module `name` in `ALL_MODULES`:
```ts
import { expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { DASHBOARD_MODULES } from "./index.js";
it("every dashboard contribution names a real module and is unique", () => {
  const names = new Set(ALL_MODULES.map((m) => m.name));
  const ids = DASHBOARD_MODULES.map((c) => c.module);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(names.has(id)).toBe(true);
});
```
(Add `@waitron/composition` as a **devDependency** of `dashboard-modules` — test-only, so it never enters the browser bundle; the browser-purity guard checks `dependencies`, not `devDependencies`. Confirm the guard only reads `dependencies`.) **Note (plan review finding 8):** this pins only `DASHBOARD_MODULES ⊆ ALL_MODULES.name` + uniqueness. The spec §10 "and vice-versa" (a UI-bearing module silently missing from the dashboard) is NOT mechanically checkable — by design §3.3 the server descriptor carries no dashboard seat, so "UI-bearing" isn't a queryable property. This forward-only pin is the feasible guard; record the gap rather than claim the reverse guarantee.

- [ ] **Step 3: Extend the seams guard.** In `scripts/module-seams.test.ts`, add a describe block asserting no file under `apps/dashboard/src` imports `@waitron/composition`, `@waitron/module`, or `@waitron/bookings`. Use the existing `imports()` text helper — which matches on the PREFIX `from "<pkg>` (finding 9), so forbidding the bare `@waitron/bookings` prefix is correct: the app must import NEITHER the bare package NOR a subpath of it (the browser sub-path is reached only transitively via `@waitron/dashboard-modules`, which is a different specifier). The app imports none of these today (confirmed by grep), so this pin should pass as written once the app is wired through the registry; positive control included.

- [ ] **Step 4: Write the failing generic-mount test** (`apps/dashboard`, browser mode). With a stub `request` and the real `DASHBOARD_MODULES`, a non-staff session shows the bookings nav item and routing to `bookings` renders `<dashboard-bookings-screen>`:
```ts
it("renders a bundled module's screen and nav via the generic path", async () => {
  const app = await mountDashboard({ role: "manager" }); // existing test harness; stubs getMe + request
  expect(app.shadowRoot!.querySelector('[data-test="nav-bookings"]')).not.toBeNull();
  app.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-bookings"]')!.click();
  await app.updateComplete;
  expect(app.shadowRoot!.querySelector("dashboard-bookings-screen")).not.toBeNull();
});
```
Run: FAIL (bookings case deleted in Step 6 not yet present as generic; write the test to the target behaviour).

- [ ] **Step 5: Add the generic mount to `dashboard-app.ts`.**
  - Add a `.request` property: `@property({ attribute: false }) request!: DashboardRequest;` (import the type from the kit).
  - Give each `NAV_GROUPS` entry a stable `id` (`type NavGroup = { id: NavGroupId; headerKey?: StringKey; items: NavItem[] }`): `reports`, `menu`, `service`, `team`, `purchasing`, `configuration`. `NavItem.screen` widens to `CoreScreen | string`.
  - Rename the closed `Screen` union to `CoreScreen` **and remove the `| "bookings"` member** (line 62 — bookings is no longer a core screen; leaving it in fails the §9 grep receipt). The `screen` state becomes `CoreScreen | (string & {})`.
  - **Widen the helper signatures that carry a screen id**, or typecheck fails when a module id flows through them: `#permittedScreen(...): CoreScreen | (string & {})` (return), `#selectScreen(screen: CoreScreen | (string & {}))`, `#writeScreenUrl(screen: CoreScreen | (string & {}))` (`:571`, `:579`, `:594`); `#onHistory` reads through `#permittedScreen`, so it follows.
  - Activate bundled modules once, when a session resolves. Add:
    ```ts
    #activeContributions: DashboardContribution[] = [];
    #activeScreens = new Map<string, DashboardScreenHandle>();
    #activate(enabled: readonly string[]): void {
      if (this.#activeContributions.length) return; // once per session
      for (const c of DASHBOARD_MODULES) {
        if (!enabled.includes(c.module)) continue;
        registerCatalogue(c.strings);
        this.#activeContributions.push(c);
        this.#activeScreens.set(c.screen.id, c.create({ request: this.request }));
      }
    }
    ```
    In Task 3 (no enabled set yet) call `this.#activate(DASHBOARD_MODULES.map((c) => c.module))` from `#applyMe`; Task 4 replaces the argument with `me.modules`.
  - `#renderScreen`: before the `switch`, `const mod = this.#activeScreens.get(this.screen); if (mod) return mod.render();`. Delete the `case "bookings":` (681-682).
  - `#nav`: after each group's core items, append the active contributions whose `screen.group === group.id`, sorted by `order`, each rendered with the same `wt-button`/`data-test="nav-<id>"` shape. (Task 4 adds the permission filter.)
  - `#permittedScreen`: after the core lookup, allow a `requested` id that is in `#activeScreens` (Task 4 adds `&& this.#sessionPermissions.includes(contribution.requiresPermission)`).
  - A contribution naming an unknown `group` id throws in `#activate` (a test asserts it) — never a silent drop.
  - Delete the side-effect `import "./screens/bookings-screen.js"` (26) and the `NAV_GROUPS` bookings entry (112).

- [ ] **Step 6: Inject `.request` in `main.ts`** and add the registry dep. `main.ts` today builds the client as `new DashboardApi("", createInstrumentedFetch(fetch, diag))` (`main.ts:23`) — the module path must keep that same diagnostics instrumentation, so build the request from the SAME instrumented fetch (plan review finding 4): `const request = createRequest({ fetchImpl: createInstrumentedFetch(fetch, diag) });` then render `<dashboard-app .api=${api} .request=${request}>`. Add `@waitron/dashboard-modules: "workspace:*"` to `apps/dashboard/package.json`; `pnpm install`.

- [ ] **Step 7: Widen the browser-purity `dashboard-modules` check** (now that the package exists) and run guards + app.
Run: `pnpm --filter @waitron/dashboard-modules test:coverage`, the two root guards, and `pnpm --filter @waitron/dashboard test:coverage`.
Expected: PASS — bookings renders via the generic path; `apps/dashboard` imports no bookings server code; `grep -rn "bookings" apps/dashboard/src` returns only the generic machinery and the moved-out references gone.

- [ ] **Step 8: Commit.**
```bash
git add packages/dashboard-modules apps/dashboard scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts pnpm-lock.yaml
git commit -s -m "feat(dashboard): mount modules generically from a browser-safe registry; bookings off the hand-wired path"
```

---

## Task 4: `getMe` permission set + enabled set, and the gates

Add `permissions` + `modules` to `GET /management-api/session/me`, add `permissionsForRole`, and turn on the two runtime gates: activate only the enabled modules, show a module's nav/screen only when the user holds its permission.

**Files:**
- Modify: `packages/identity/src/permissions.ts`, `packages/identity/src/index.ts`, `apps/server/src/me-api.ts`, `apps/server/src/boot.ts`, `apps/dashboard/src/api/client.ts` (getMe type), `apps/dashboard/src/dashboard-app.ts`
- Test: `packages/identity/src/permissions.test.ts`, `apps/server/src/me-api*.test.ts`, `apps/dashboard` gate tests

- [ ] **Step 1: Write the failing `permissionsForRole` test** (`permissions.test.ts`):
```ts
it("permissionsForRole spans core + module permissions on the ladder", () => {
  registerModulePermissions([{ permission: "booking.manage", grantedFrom: "manager" }]);
  expect(permissionsForRole("staff")).toEqual([]);
  expect(permissionsForRole("supervisor")).toContain("report.view");
  expect(permissionsForRole("supervisor")).not.toContain("booking.manage");
  expect(permissionsForRole("manager")).toContain("booking.manage");
  expect(permissionsForRole("admin")).toContain("booking.manage");
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (not exported). `pnpm --filter @waitron/identity test permissions.test.ts`

- [ ] **Step 3: Add `permissionsForRole`** to `permissions.ts` (uses the existing `roleHasPermission`, `PERMISSIONS`, `MODULE_PERMISSIONS`):
```ts
export function permissionsForRole(role: PersonRoleValue): string[] {
  const ids = [...PERMISSIONS, ...MODULE_PERMISSIONS.keys()];
  return ids.filter((p) => roleHasPermission(role, p));
}
```
Export it from `packages/identity/src/index.ts`. Run: PASS.

- [ ] **Step 4: Add `permissions` + `modules` to `getMe`.** In `me-api.ts`: extend `MeApiDeps` with `modules: string[]` (the enabled module names); import `permissionsForRole`; change the `session/me` return (line 142) to:
```ts
return c.json({
  personId, role, locale, venueLocale: deps.venueLocale,
  permissions: permissionsForRole(role),
  modules: deps.modules,
});
```
In `boot.ts`, thread the enabled-module names into `mountMeApi`'s deps at the `mountMeApi(...)` call (`boot.ts:1378`): `modules: setsToMigrate.map((m) => m.name)` (the enabled set is `setsToMigrate`, `boot.ts:566`; it includes `"core"`, harmlessly — the browser registry only matches UI-bearing ids). Update `me-api*.test.ts` deps to pass `modules` and assert the two new fields for a manager (`booking.manage` present, `modules` includes `"bookings"`) and a staff role (`permissions` empty).

- [ ] **Step 5: Widen the client `getMe` type** (`client.ts:2217-2229`): add `permissions: string[]; modules: string[]` to both the return annotation and the `#request<…>` generic.

- [ ] **Step 6: Write the failing gate tests** (`apps/dashboard`, browser mode), both directions:
```ts
it("hides a module nav/screen when the permission is absent", async () => {
  const app = await mountDashboard({ role: "manager", permissions: [], modules: ["bookings"] });
  expect(app.shadowRoot!.querySelector('[data-test="nav-bookings"]')).toBeNull();
  // navigating to it falls back to overview
});
it("hides a module entirely when it is not in the enabled set", async () => {
  const app = await mountDashboard({ role: "manager", permissions: ["booking.manage"], modules: [] });
  expect(app.shadowRoot!.querySelector('[data-test="nav-bookings"]')).toBeNull();
});
it("shows it when enabled AND permitted", async () => {
  const app = await mountDashboard({ role: "manager", permissions: ["booking.manage"], modules: ["bookings"] });
  expect(app.shadowRoot!.querySelector('[data-test="nav-bookings"]')).not.toBeNull();
});
```
(Extend the dashboard test harness's `getMe` stub to accept `permissions`/`modules`.)

- [ ] **Step 7: Turn on the gates in `dashboard-app.ts`.**
  - `#applyMe` signature gains `permissions: string[]; modules: string[]`; store `this.#sessionPermissions = me.permissions`; call `this.#activate(me.modules)` (replacing Task 3's all-bundled argument).
  - `#nav`: filter active contributions by `this.#sessionPermissions.includes(c.screen.requiresPermission)`.
  - `#permittedScreen`: a module id is permitted iff `this.#activeScreens.has(id)` **and** the matching contribution's `requiresPermission` is in `this.#sessionPermissions`.
  Run the gate tests: PASS both directions.

- [ ] **Step 8: Run identity, server (me-api), and dashboard.**
Run: `pnpm --filter @waitron/identity test:coverage`, `pnpm --filter @waitron/server test:coverage` (or the me-api shard), `pnpm --filter @waitron/dashboard test:coverage` (Chromium/RAM rule).
Expected: PASS.

- [ ] **Step 9: Commit.**
```bash
git add packages/identity apps/server/src/me-api.ts apps/server/src/boot.ts apps/dashboard/src
git commit -s -m "feat(dashboard): gate module screens on the effective permission set and the enabled module set from /me"
```

---

## Task 5: Whole-branch proofs + backlog

The seat-inversion and gate proofs live in Tasks 3-4; this task is the cross-cutting verification the extraction demands and the doc update.

**Files:** Modify `docs/backlog.md`.

- [ ] **Step 1: Grep receipt (§9 proof).** `grep -rn "booking" apps/dashboard/src` returns only the generic module machinery — no screen, widget, api method, type, string, or `Screen`/`NAV_GROUPS`/`#renderScreen` reference. If anything else appears, it was missed; re-home it. Record the command + its output in the commit body.

- [ ] **Step 2: Vite bundle proof (browser-purity backstop).** Run `pnpm --filter @waitron/dashboard build`. Expected: the build succeeds and emits no Node-built-in externalisation warning (a server import would surface here). If it warns, a `./dashboard` graph reached server code — fix before proceeding.

- [ ] **Step 3: Whole-workspace run.** The extraction changed values more than one suite asserts (`strings.ts`, `DashboardApi`, the `session/me` shape, `permissions.ts`). Observe the Chromium/RAM rule, then:
Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
Expected: PASS across the workspace.

- [ ] **Step 4: Update `docs/backlog.md`.** Mark Track C item 3 SP2 landed; record the follow-ons SP2 unblocks (incremental core-screen migration onto the seat; core-screen permission migration off `requiresManager`).

- [ ] **Step 5: Commit.**
```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): bookings SP2 landed — dashboard module-UI seat; core-screen migration follow-ons recorded"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task: §3.1 kit → T1; §3.2 sub-path → T2; §3.3 registry → T3; §4 contract → T1(types)/T2(value); §5 discovery+routing+nav → T3, gating → T4; §6 api → T1(createRequest)+T2(BookingApi); §7 permissions → T4; §8 i18n → T1(registry)+T2(module strings); §9 what-leaves → T2/T3 + T5 grep; §10 guards → browser-purity T2, seams T3, registry pin T3; §11 testing → folded per task + T5; §13 slices → T1-T5 in order.

**Placeholder scan** — the only "read the file first" instructions are for genuine verbatim moves (the `Booking*` type bodies, `codeOf`, `bookingStatusName`, `today`, the `mountMeApi` call site, the bookings `vitest.config.ts`) where reproducing hundreds of lines here would be less reliable than moving them; each names the exact source location.

**Type consistency** — `DashboardRequest`, `DashboardContribution`, `BookingApi`, `permissionsForRole`, `registerCatalogue`/`registerCodeMessages`, `#activate`/`#activeScreens`/`#sessionPermissions`, and the `markNoShow` method name are used identically across tasks. The two spec deltas (no 401 redirect in `createRequest`; `markNoShow` not `noShowBooking`) are corrected consistently.

**Ordering constraint** — T1 (kit) precedes T2 (the module imports it) precedes T3 (the registry imports the module; the app mounts generically) precedes T4 (gating narrows the mount). T5 is last.
