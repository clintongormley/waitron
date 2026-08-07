# Dashboard Slice 1c — Dashboard App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/dashboard` — a browser management console (Lit + Vite) that logs a manager in with password (+ TOTP if enrolled) and administers staff — consuming the slice-1b `/management-api/*` routes.

**Architecture:** A new app cloning `apps/till`'s toolchain verbatim (Lit 3.2, Vite 6, Vitest 3 browser mode via Playwright/Chromium, `@waitron/ui` for primitives + tokens). A `DashboardApi` client mirrors `TillApi` (same-origin `fetch`, `credentials: "include"`, `{ error: { code } }` envelope). A `<dashboard-app>` shell owns a `login → staff` screen machine. Remote access is *below* the app (slice 1a–1d transport phases), so the app only ever talks to `/management-api/*`.

**Tech Stack:** `lit ^3.2.0`, `vite ^6.0.0`, `vitest ^3` + `@vitest/browser` (Playwright/Chromium, headless), `axe-core`, `@waitron/ui`, `@waitron/shared`.

**Depends on:** slice 1b (the `/management-api/*` routes) for real end-to-end use; the app itself is unit-tested against a stubbed `fetch`/API and needs no running server.

## Global Constraints

- **Package `@waitron/dashboard`**, `apps/dashboard`. It is under `apps/*`, so the `english-only` guard does NOT scan it (Spanish user-facing copy is allowed) and the `no-hardcoded-chrome` guard (scoped to `packages/ui`) does NOT scan it — but **use `var(--wt-*)` tokens anyway** (global design convention: no hardcoded chrome colours/spacing).
- **Coverage thresholds: 95 / 95 / 90 / 88** (match `apps/till` and `packages/ui`, the browser tier — not the 98/98/98/95 of Node packages). Set in `apps/dashboard/vitest.config.ts`.
- **Reuse `@waitron/ui`; do not hand-roll buttons/inputs/dialogs.** There is **no `wt-select`** — use a native `<select>` styled with tokens for the role picker (the only control the primitive set lacks).
- **Mount components by assigning properties** (`@property({ attribute: false })` objects can't pass through markup) — clone `apps/till/src/widgets/test-helpers.ts`.
- **This is a pointer/keyboard app, not touch** — the 44px tap-target rule relaxes, but keyboard/focus a11y matters more; every screen has a `.a11y.test.ts` running both themes.
- **Every commit `-s`.** Before green: `pnpm --filter @waitron/dashboard test:coverage`.

---

### Task 1: Scaffold `apps/dashboard` (toolchain + empty shell + smoke test)

**Files:**
- Create: `apps/dashboard/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/vite-env.d.ts`, `src/main.ts`, `src/dashboard-app.ts`, `src/smoke.test.ts`, `src/widgets/test-helpers.ts`

- [ ] **Step 1: `package.json`** — clone `apps/till/package.json`, renamed:

```json
{
  "name": "@waitron/dashboard",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@waitron/ui": "workspace:*",
    "@waitron/shared": "workspace:*",
    "lit": "^3.2.0"
  },
  "devDependencies": {
    "@vitest/browser": "^3.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "axe-core": "^4.12.1",
    "playwright": "^1.49.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`** (identical to `apps/till/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["vitest/globals"] },
  "include": ["src"]
}
```

- [ ] **Step 3: `vite.config.ts`** (own dev port 5191, proxy `/management-api`):

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5191, proxy: { "/management-api": "http://127.0.0.1:8080" } },
});
```

- [ ] **Step 4: `vitest.config.ts`** — clone `apps/till/vitest.config.ts` (browser mode, `emulateColorScheme` command, coverage exclude `src/main.ts` + `src/widgets/test-helpers.ts`, thresholds 95/95/90/88). Copy it verbatim, changing only comments referencing "till".

- [ ] **Step 5: `index.html`** (clone `apps/till/index.html`): a `<div id="app"></div>` + `<script type="module" src="/src/main.ts">`, body painting `var(--wt-color-bg)`/`var(--wt-color-text)`/`var(--wt-font-family)`.

- [ ] **Step 6: `src/vite-env.d.ts`**: `/// <reference types="vite/client" />`.

- [ ] **Step 7: `src/widgets/test-helpers.ts`** — copy `apps/till/src/widgets/test-helpers.ts` verbatim (`mountWidget`, `cleanupWidgets`, `expectNoA11yViolations`, `formatViolations`).

- [ ] **Step 8: `src/dashboard-app.ts`** — minimal shell that registers the element:

```ts
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";

@customElement("dashboard-app")
export class DashboardApp extends LitElement {
  static override styles = [baseStyles];
  override render() {
    return html`<main></main>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "dashboard-app": DashboardApp }
}
```

- [ ] **Step 9: `src/main.ts`** (clone `apps/till/src/main.ts`):

```ts
import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import { DashboardApi } from "./api/client.js";
import "./dashboard-app.js";

applyTokens(document.documentElement);
const app = document.querySelector<HTMLElement>("#app")!;
render(html`<dashboard-app .api=${new DashboardApi()}></dashboard-app>`, app);
```

(`main.ts` is coverage-excluded; the `DashboardApi` import resolves after Task 2.)

- [ ] **Step 10: `src/smoke.test.ts`** — proves the element registers:

```ts
import { describe, expect, it } from "vitest";
import "./dashboard-app.js";

describe("dashboard app", () => {
  it("registers the custom element", () => {
    expect(customElements.get("dashboard-app")).toBeTruthy();
  });
});
```

- [ ] **Step 11: Install + run** — Run: `pnpm install && pnpm --filter @waitron/dashboard test smoke` · Expected: PASS. Commit the lockfile.

- [ ] **Step 12: Commit**

```bash
git add apps/dashboard ../../pnpm-lock.yaml
git commit -s -m "feat(dashboard): scaffold apps/dashboard (Lit/Vite/Vitest, empty shell)"
```

---

### Task 2: `DashboardApi` client

**Files:**
- Create: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/client.test.ts`

**Interfaces:**
- Produces `class DashboardApi` with: `getStaffRoster(): Promise<RosterEntry[]>`, `login(input: { personId: string; password: string; totp?: string }): Promise<{ personId: string }>`, `logout(): Promise<void>`, `listStaff(): Promise<PersonSummary[]>`, `createPerson(input: { displayName: string; role: PersonRole; pin: string }): Promise<{ id: string }>`, `updatePerson(id: string, patch: { role?: PersonRole; status?: "active" | "suspended" }): Promise<void>`, `resetPin(id: string, pin: string): Promise<void>`, `setPassword(id: string, password: string): Promise<void>`. Local types `RosterEntry`, `PersonSummary`, `PersonRole` (NOT imported from `@waitron/*` — keep server code out of the browser bundle, exactly as `apps/till/src/api/client.ts` does).

- [ ] **Step 1: Write the failing test** — `apps/dashboard/src/api/client.test.ts` (inject a stub `fetch`, exactly as `apps/till/src/api/client.test.ts`):

```ts
import { describe, expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("DashboardApi", () => {
  it("posts login credentials with cookies included", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ personId: "p1" }));
    const api = new DashboardApi("", fetchImpl);
    const out = await api.login({ personId: "p1", password: "correct horse" });
    expect(out).toEqual({ personId: "p1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: "p1", password: "correct horse" }),
    });
  });

  it("throws the envelope code on a non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "password.invalid" } }, false, 401));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.login({ personId: "p1", password: "x" })).rejects.toMatchObject({ code: "password.invalid" });
  });

  it("lists staff with credentials", async () => {
    const roster = [{ personId: "p1", displayName: "Ada", role: "manager", status: "active", hasPassword: true, hasTotp: false }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(roster));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listStaff()).toEqual(roster);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff", { method: "GET", credentials: "include" });
  });
});
```

- [ ] **Step 2: Run, verify it fails** — Run: `pnpm --filter @waitron/dashboard test client` · Expected: FAIL, module not found.

- [ ] **Step 3: Implement `client.ts`** (mirror `apps/till/src/api/client.ts`'s `#request` funnel):

```ts
export type PersonRole = "staff" | "supervisor" | "manager" | "admin";
export interface RosterEntry { personId: string; displayName: string }
export interface PersonSummary {
  personId: string; displayName: string; role: PersonRole;
  status: "active" | "suspended"; hasPassword: boolean; hasTotp: boolean;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class DashboardApi {
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;
  constructor(baseUrl = "", fetchImpl: FetchLike = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetchImpl = fetchImpl;
  }
  getStaffRoster(): Promise<RosterEntry[]> { return this.#request("/management-api/staff-roster", "GET"); }
  login(input: { personId: string; password: string; totp?: string }): Promise<{ personId: string }> {
    return this.#request("/management-api/session", "POST", input);
  }
  logout(): Promise<void> { return this.#request("/management-api/session", "DELETE"); }
  listStaff(): Promise<PersonSummary[]> { return this.#request("/management-api/staff", "GET"); }
  createPerson(input: { displayName: string; role: PersonRole; pin: string }): Promise<{ id: string }> {
    return this.#request("/management-api/staff", "POST", input);
  }
  updatePerson(id: string, patch: { role?: PersonRole; status?: "active" | "suspended" }): Promise<void> {
    return this.#request(`/management-api/staff/${id}`, "PATCH", patch);
  }
  resetPin(id: string, pin: string): Promise<void> { return this.#request(`/management-api/staff/${id}/reset-pin`, "POST", { pin }); }
  setPassword(id: string, password: string): Promise<void> { return this.#request(`/management-api/staff/${id}/password`, "POST", { password }); }

  async #request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const init: RequestInit = body === undefined
      ? { method, credentials: "include" }
      : { method, credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const res = await this.#fetchImpl(this.#baseUrl + path, init);
    if (!res.ok) {
      const envelope = (await res.json()) as { error?: { code?: string } };
      throw { code: envelope.error?.code ?? "server.internal" };
    }
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }
}
```

- [ ] **Step 4: Run, verify pass** — Run: `pnpm --filter @waitron/dashboard test client` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api
git commit -s -m "feat(dashboard): DashboardApi client (login, staff CRUD)"
```

---

### Task 3: Login screen

**Files:**
- Create: `apps/dashboard/src/screens/login-screen.ts`, `login-screen.test.ts`, `login-screen.a11y.test.ts`

**Interfaces:**
- Consumes `DashboardApi` (`.api` property), emits `logged-in` (`CustomEvent<{ personId: string }>`, bubbles + composed) on success.

- [ ] **Step 1: Write the failing tests** — `login-screen.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { LoginScreen } from "./login-screen.js";

afterEach(cleanupWidgets);

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    ...overrides,
  } as unknown as DashboardApi;
}

describe("login-screen", () => {
  it("loads the roster and logs in the picked person", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await new Promise((r) => setTimeout(r)); // let getStaffRoster resolve
    await el.updateComplete;
    const loggedIn = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("logged-in", (e) => resolve((e as CustomEvent).detail)),
    );
    // select person p1, type password, submit
    (el as unknown as { selected: string }).selected = "p1";
    (el as unknown as { password: string }).password = "correct horse";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    expect((await loggedIn).personId).toBe("p1");
    expect(api.login).toHaveBeenCalledWith({ personId: "p1", password: "correct horse", totp: undefined });
  });

  it("shows an error key when login is rejected", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({ code: "password.invalid" }) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    (el as unknown as { selected: string }).selected = "p1";
    (el as unknown as { password: string }).password = "wrong";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await new Promise((r) => setTimeout(r));
    await el.updateComplete;
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("password.invalid");
  });
});
```

`login-screen.a11y.test.ts`:

```ts
import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js"; // or clone the till a11y helper import path
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import "./login-screen.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("login-screen a11y (%s)", (theme) => {
  test("renders accessibly", async () => {
    await mountThemed("<dashboard-login-screen></dashboard-login-screen>", theme);
    await expectNoA11yViolations(host);
  });
});
```

(If `@waitron/ui`'s `test-helpers`/`a11y-helpers` are not exported for deep import, clone them into `apps/dashboard/src/` as `apps/till` effectively does via its own `widgets/test-helpers.ts` — confirm which path resolves and use it consistently.)

- [ ] **Step 2: Run, verify it fails** — Run: `pnpm --filter @waitron/dashboard test login-screen` · Expected: FAIL, module not found.

- [ ] **Step 3: Implement `login-screen.ts`** — roster picker + password field + optional TOTP field + submit, using `@waitron/ui` (`wt-button`, `wt-input`) and tokens:

```ts
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DashboardApi, RosterEntry } from "../api/client.js";

@customElement("dashboard-login-screen")
export class LoginScreen extends LitElement {
  static override styles = [baseStyles, css`
    .field { display: block; margin-bottom: var(--wt-space-4); }
    .error { color: var(--wt-color-danger); margin-top: var(--wt-space-3); }
    select { font: inherit; padding: var(--wt-space-2); border-radius: var(--wt-radius-md);
             border: var(--wt-space-1) solid var(--wt-color-border); background: var(--wt-color-surface);
             color: var(--wt-color-text); width: 100%; }
  `];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private roster: RosterEntry[] = [];
  @state() private selected = "";
  @state() private password = "";
  @state() private totp = "";
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#loadRoster();
  }
  async #loadRoster(): Promise<void> {
    this.roster = await this.api.getStaffRoster();
    if (this.roster[0]) this.selected = this.roster[0].personId;
  }
  async #submit(): Promise<void> {
    this.errorKey = null;
    try {
      const out = await this.api.login({
        personId: this.selected, password: this.password,
        totp: this.totp === "" ? undefined : this.totp,
      });
      this.dispatchEvent(new CustomEvent("logged-in", { detail: out, bubbles: true, composed: true }));
    } catch (error) {
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    }
  }
  override render() {
    return html`
      <label class="field">Usuario
        <select .value=${this.selected} @change=${(e: Event) => (this.selected = (e.target as HTMLSelectElement).value)}>
          ${this.roster.map((p) => html`<option value=${p.personId}>${p.displayName}</option>`)}
        </select>
      </label>
      <wt-input class="field" label="Contraseña" type="password" .value=${this.password}
        @wt-change=${(e: CustomEvent<{ value: string }>) => (this.password = e.detail.value)}></wt-input>
      <wt-input class="field" label="Código (si procede)" .value=${this.totp}
        @wt-change=${(e: CustomEvent<{ value: string }>) => (this.totp = e.detail.value)}></wt-input>
      <wt-button variant="primary" data-test="submit" @click=${() => void this.#submit()}>Entrar</wt-button>
      ${this.errorKey ? html`<p class="error" role="alert">${this.errorKey}</p>` : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { "dashboard-login-screen": LoginScreen }
}
```

(The `errorKey` is rendered raw here for the slice; a later i18n task maps codes → Spanish copy, exactly as `apps/till/src/i18n` does.)

- [ ] **Step 4: Run, verify pass** — Run: `pnpm --filter @waitron/dashboard test login-screen` · Expected: PASS (both spec + a11y).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/login-screen.ts apps/dashboard/src/screens/login-screen.test.ts apps/dashboard/src/screens/login-screen.a11y.test.ts
git commit -s -m "feat(dashboard): login screen (roster + password + optional TOTP)"
```

---

### Task 4: Staff list widget

**Files:**
- Create: `apps/dashboard/src/widgets/staff-list.ts`, `staff-list.test.ts`, `staff-list.a11y.test.ts`

**Interfaces:**
- `@property({ attribute: false }) people: PersonSummary[]`; emits `edit-person` (`CustomEvent<{ personId: string }>`) when a row's edit control is clicked; renders role, status, and credential badges (`hasPassword`/`hasTotp`).

- [ ] **Step 1: Write the failing test** — `staff-list.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { PersonSummary } from "../api/client.js";
import { StaffList } from "./staff-list.js";

afterEach(cleanupWidgets);
const people: PersonSummary[] = [
  { personId: "p1", displayName: "Ada", role: "manager", status: "active", hasPassword: true, hasTotp: false },
  { personId: "p2", displayName: "Bea", role: "staff", status: "suspended", hasPassword: false, hasTotp: false },
];

describe("staff-list", () => {
  it("renders one row per person with role and status", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const rows = el.shadowRoot!.querySelectorAll("[data-test=row]");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Ada");
    expect(rows[1]!.textContent).toContain("suspended");
  });
  it("emits edit-person when a row's edit control is clicked", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const detail = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("edit-person", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    expect((await detail).personId).toBe("p1");
  });
});
```

`staff-list.a11y.test.ts` — mirror Task 3's a11y test, mounting `<dashboard-staff-list>` with `people` assigned (use `mountWidget` + `expectNoA11yViolations(host)` both themes).

- [ ] **Step 2: Run, verify fails** — Run: `pnpm --filter @waitron/dashboard test staff-list` · Expected: FAIL.

- [ ] **Step 3: Implement `staff-list.ts`** using `wt-card` per row + a `wt-button variant="ghost"` edit control, token styling. Emit `edit-person` with `{ personId }` (bubbles + composed).

- [ ] **Step 4: Run, verify pass** — Run: `pnpm --filter @waitron/dashboard test staff-list` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/staff-list.ts apps/dashboard/src/widgets/staff-list.test.ts apps/dashboard/src/widgets/staff-list.a11y.test.ts
git commit -s -m "feat(dashboard): staff list widget"
```

---

### Task 5: Person-form dialog (create)

**Files:**
- Create: `apps/dashboard/src/widgets/person-form.ts`, `person-form.test.ts`, `person-form.a11y.test.ts`

**Interfaces:**
- Uses `wt-dialog` (opened by setting `.open`); fields display name (`wt-input`), role (native `<select>`), PIN (`wt-input`); emits `create-person` (`CustomEvent<{ displayName: string; role: PersonRole; pin: string }>`) on confirm and `wt-close` closes it.

- [ ] **Step 1: Write the failing test** — assert that setting `.open = true`, filling fields, and clicking confirm emits `create-person` with the entered values; assert `wt-close` from the dialog resets `open`. (Mirror `packages/ui`'s `wt-dialog` demo interaction: `el.open = true`.)

- [ ] **Step 2: Run, verify fails.** Run: `pnpm --filter @waitron/dashboard test person-form` · Expected: FAIL.

- [ ] **Step 3: Implement `person-form.ts`** — `wt-dialog heading="Nuevo usuario"` with a `wt-button slot="footer" variant="primary"` confirm; token-styled `<select>` for role; emit `create-person`.

- [ ] **Step 4: Run, verify pass.** Run: `pnpm --filter @waitron/dashboard test person-form` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/person-form.ts apps/dashboard/src/widgets/person-form.test.ts apps/dashboard/src/widgets/person-form.a11y.test.ts
git commit -s -m "feat(dashboard): person-form create dialog"
```

---

### Task 6: Staff screen (compose list + create + refresh)

**Files:**
- Create: `apps/dashboard/src/screens/staff-screen.ts`, `staff-screen.test.ts`, `staff-screen.a11y.test.ts`

**Interfaces:**
- Consumes `DashboardApi`; loads `listStaff()` on connect, renders `<dashboard-staff-list>`, opens `<dashboard-person-form>` on "add", calls `createPerson` on the form's `create-person` event then reloads the list.

- [ ] **Step 1: Write the failing test** — stub `api.listStaff` (returns two people) and `api.createPerson`; assert the screen renders the list, that clicking "add" then confirming the form calls `api.createPerson` with the form values and re-calls `listStaff`. Include an a11y test (both themes).

- [ ] **Step 2: Run, verify fails.** Run: `pnpm --filter @waitron/dashboard test staff-screen` · Expected: FAIL.

- [ ] **Step 3: Implement `staff-screen.ts`** — `@state() people`, `#load()` on `connectedCallback`, an "Añadir usuario" `wt-button` toggling the form's `.open`, `@create-person` handler → `api.createPerson(detail)` → `#load()`.

- [ ] **Step 4: Run, verify pass.** Run: `pnpm --filter @waitron/dashboard test staff-screen` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/staff-screen.ts apps/dashboard/src/screens/staff-screen.test.ts apps/dashboard/src/screens/staff-screen.a11y.test.ts
git commit -s -m "feat(dashboard): staff screen (list + create + reload)"
```

---

### Task 7: App shell — session probe + screen machine

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts` (+ `dashboard-app.test.ts`, `dashboard-app.a11y.test.ts`)

**Interfaces:**
- `@property({ attribute: false }) api: DashboardApi`; `@state() screen: "login" | "staff"`. On `firstUpdated`, probe the session by calling `api.listStaff()` — success ⇒ `staff`, a `management_session.required`/`401`-coded rejection ⇒ `login` (wrap the await; learn from `apps/till`'s `#boot` unhandled-rejection follow-up). Wire `@logged-in` → `staff`; a logout `wt-button` → `api.logout()` → `login`.

- [ ] **Step 1: Write the failing test** — `dashboard-app.test.ts` using a `stubApi` factory (`vi.fn()` per method):

```ts
it("shows login when no session, staff after logged-in", async () => {
  const api = stubApi({ listStaff: vi.fn().mockRejectedValue({ code: "management_session.required" }) });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  await flush(el);
  expect(el.shadowRoot!.querySelector("dashboard-login-screen")).toBeTruthy();
  el.shadowRoot!.querySelector("dashboard-login-screen")!
    .dispatchEvent(new CustomEvent("logged-in", { detail: { personId: "p1" }, bubbles: true, composed: true }));
  await flush(el);
  expect(el.shadowRoot!.querySelector("dashboard-staff-screen")).toBeTruthy();
});

it("starts on staff when a session already exists", async () => {
  const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  await flush(el);
  expect(el.shadowRoot!.querySelector("dashboard-staff-screen")).toBeTruthy();
});
```

(Define `stubApi` and `flush` mirroring `apps/till/src/till-app.test.ts`.)

- [ ] **Step 2: Run, verify fails.** Run: `pnpm --filter @waitron/dashboard test dashboard-app` · Expected: FAIL.

- [ ] **Step 3: Implement the shell** — screen machine, `#probeSession()` wrapped in try/catch, `<dashboard-login-screen>` / `<dashboard-staff-screen>` switch, logout button. Import the screen modules for registration.

- [ ] **Step 4: Run, verify pass.** Run: `pnpm --filter @waitron/dashboard test dashboard-app` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts apps/dashboard/src/dashboard-app.a11y.test.ts
git commit -s -m "feat(dashboard): app shell (session probe + login/staff machine)"
```

---

### Task 8: Register the app in CI scope (own Chromium shard)

**Design note:** `@waitron/dashboard` is a Chromium/Playwright consumer like `@waitron/till` and `@waitron/ui`. Those get their own CI shard (`OWN_SHARD_PACKAGES`) because a wedged `chrome-headless-shell` under Testcontainers contention hung the shared `test-light` shard. The dashboard follows the same pattern.

**Files:**
- Modify: `scripts/changed-scope.mjs` (add `DASHBOARD_PACKAGE` to `OWN_SHARD_PACKAGES` + a `dashboard` gate)
- Modify: `.github/workflows/ci.yml` (a `test-dashboard` job gated on the dashboard scope, mirroring `test-ui`/`test-till`)
- Modify: `scripts/changed-scope.mjs` tests if they pin the shard list

- [ ] **Step 1: Read the current `scripts/changed-scope.mjs`** — find `HEAVY_PACKAGE`, `UI_PACKAGE`, `TILL_PACKAGE`, `OWN_SHARD_PACKAGES`, and the gate outputs (`heavy`, `ui`, `till`, `light`, …). Add:

```js
const DASHBOARD_PACKAGE = "@waitron/dashboard";
// …add to OWN_SHARD_PACKAGES:
const OWN_SHARD_PACKAGES = [HEAVY_PACKAGE, UI_PACKAGE, TILL_PACKAGE, DASHBOARD_PACKAGE];
// …emit a `dashboard` gate exactly as `till`/`ui` are emitted.
```

- [ ] **Step 2: Update the pinning test** — if `scripts/changed-scope.*.test.*` asserts the exact `OWN_SHARD_PACKAGES` list or the gate set, add `@waitron/dashboard` / `dashboard=` there. Run: `pnpm vitest run scripts/changed-scope` (from root) · Expected: PASS.

- [ ] **Step 3: Add the CI job** — in `.github/workflows/ci.yml`, clone the `test-ui` (or `test-till`) job as `test-dashboard`, gated on the `changes` job's `dashboard` output, running `pnpm --filter @waitron/dashboard test:coverage`. Match the existing job's `needs`, `if`, and Playwright setup steps exactly.

- [ ] **Step 4: Confirm scope resolves** — Run: `node scripts/changed-scope.mjs` against a diff touching `apps/dashboard` (or the project's documented way to exercise it) · Expected: `dashboard=true`. Also confirm a docs-only diff yields `dashboard=false`.

- [ ] **Step 5: Commit**

```bash
git add scripts/changed-scope.mjs .github/workflows/ci.yml
git commit -s -m "ci: give @waitron/dashboard its own Chromium test shard"
```

---

### Task 9: Full-app green + i18n follow-up note

- [ ] **Step 1: Coverage gate** — Run: `pnpm --filter @waitron/dashboard test:coverage` · Expected: PASS at 95/95/90/88.
- [ ] **Step 2: Workspace gate** — Run from root: `pnpm lint && pnpm typecheck && pnpm format:check` · Expected: PASS (lockfile committed for the new package).
- [ ] **Step 3: Manual dev smoke (optional, needs a running server + a seeded admin password)** — `pnpm --filter @waitron/server dev` (or the documented boot) + `pnpm --filter @waitron/dashboard dev`, open `http://127.0.0.1:5191`, log in, add a person. Record any gaps. **Blocked** until the first-admin password exists (slice 1b Task 8's provisioning follow-up).
- [ ] **Step 4: Record the i18n follow-up** — this slice renders error codes and a few Spanish literals inline; a follow-up should add an `i18n/` layer mapping codes → localised copy, exactly as `apps/till/src/i18n` does. Note it in the PR / *Debt and odd jobs*.
- [ ] **Step 5:** no commit — verification only.

---

## Self-Review

**Spec coverage (§2 the app, §3 staff admin surface, §4 login):**
- `apps/dashboard` as a transport-agnostic local-server client on `@waitron/ui` — Tasks 1–7. ✅
- Login with password (+ TOTP iff enrolled) — Task 3. ✅
- Staff list + create + row-edit seam (role/status/PIN/password all reachable via the API client) — Tasks 2, 4–6. ✅
- Session probe + logout, keyboard/focus a11y both themes — Tasks 3–7 (`.a11y.test.ts` each). ✅
- New Chromium package registered in CI scope — Task 8. ✅
- **Out of 1c (correctly):** passkeys UI (1d), TOTP self-enrollment UI, i18n layer (follow-up noted), federated login. The row-edit *actions* (change role/suspend/reset-PIN/set-password) beyond emitting `edit-person` are a thin follow-up on the `updatePerson`/`resetPin`/`setPassword` client methods (already built in Task 2) — wire in Task 6's screen or a fast-follow; noted so it is not assumed complete.

**Placeholder scan:** Tasks 4–6 give full tests + real code for the first of each kind and describe the sibling widget's implementation concretely against named `@waitron/ui` primitives; no "TBD". Where a helper import path (`@waitron/ui/src/test-helpers.js` vs a local clone) is uncertain, the step says to confirm which resolves and use it consistently. ✅

**Type consistency:** `PersonSummary`/`PersonRole`/`RosterEntry` defined once in `client.ts` (Task 2) and consumed by every widget/screen; event names (`logged-in`, `edit-person`, `create-person`) stable across tasks; `/management-api/*` paths match slice 1b exactly. ✅
