# Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the monorepo scaffolding and a themeable token + primitive design system in `packages/ui`, so every later screen is built on tokens rather than hardcoded chrome.

**Architecture:** A CSS custom property token layer (`--wt-*`) applied at a theme root, consumed by thin Lit primitives (`wt-*`) that never hardcode colour, spacing, radius or font. Light and dark are both shipped, selected by `prefers-color-scheme` and overridable by a `data-theme` attribute that wins in either direction. Deployments retheme by overriding tokens — never by patching component styles.

**Tech Stack:** TypeScript, Lit 3, Vite 6, Vitest 3 (browser mode via Playwright/Chromium), pnpm workspaces, GitHub Actions.

## Global Constraints

- Node version pinned in `.nvmrc` to `26` — matches the verified local toolchain.
- Package manager: pnpm, declared via `packageManager` in root `package.json`.
- **No Turborepo.** Plain pnpm scripts until build times justify otherwise.
- **No Storybook.** A Vite-served kitchen-sink page provides the workbench.
- Element prefix `wt-`; token prefix `--wt-`.
- **No hardcoded chrome in any component**: no hex colours, no px spacing, no font sizes, no radii outside the token definitions. Every such value reads a token.
- Tests run in **real Chromium** via Vitest browser mode. jsdom cannot compute CSS custom properties and must not be used for this package.
- Minimum interactive target: `--wt-tap-min` = `44px`. POS screens are touched, not clicked.
- Every task ends with a commit.

---

### Task 1: Workspace scaffolding and browser test harness

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/vitest.config.ts`
- Test: `packages/ui/src/harness.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working `pnpm test` that executes tests in headless Chromium. All later tasks depend on this command.

- [ ] **Step 1: Verify pnpm is available**

Run: `pnpm --version`

If it errors, install it: `npm install -g pnpm@9.15.0`, then re-run. Expected: prints a version number.

- [ ] **Step 2: Create the root workspace files**

`.nvmrc`:

```text
26
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`package.json`:

```json
{
  "name": "waitron",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "build": "pnpm -r build"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "skipLibCheck": true,
    "declaration": true,
    "isolatedModules": true
  }
}
```

Note: `experimentalDecorators` with `useDefineForClassFields: false` is required by Lit 3's decorators. Getting this wrong causes `@property` to silently not react.

- [ ] **Step 3: Create the ui package**

`packages/ui/package.json`:

```json
{
  "name": "@waitron/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "lit": "^3.2.0"
  },
  "devDependencies": {
    "@vitest/browser": "^3.0.0",
    "playwright": "^1.49.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

`packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
```

- [ ] **Step 4: Write the failing harness test**

`packages/ui/src/harness.test.ts`:

```ts
import { expect, test } from "vitest";

test("runs in a real browser with computed styles available", () => {
  const el = document.createElement("div");
  el.style.setProperty("--probe", "42px");
  document.body.appendChild(el);

  const value = getComputedStyle(el).getPropertyValue("--probe").trim();

  expect(value).toBe("42px");
  el.remove();
});
```

This test exists to prove the harness itself works. If custom properties do not resolve, every later token test is meaningless.

- [ ] **Step 5: Install dependencies and browser**

Run:

```bash
pnpm install
pnpm exec playwright install chromium
```

Expected: install completes; Chromium downloads.

- [ ] **Step 6: Run the test**

Run: `pnpm test`

Expected: PASS, 1 test. If it fails with a provider error, Chromium did not install — re-run step 5.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .nvmrc packages/ui pnpm-lock.yaml
git commit -m "chore: scaffold pnpm workspace and browser test harness"
```

---

### Task 2: Colour tokens with light and dark

**Files:**
- Create: `packages/ui/src/tokens/colors.css`
- Create: `packages/ui/src/tokens/index.ts`
- Test: `packages/ui/src/tokens/colors.test.ts`

**Interfaces:**
- Consumes: the test harness from Task 1.
- Produces: `applyTokens(root: HTMLElement): void` and the `--wt-color-*` contract used by every primitive.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/tokens/colors.test.ts`:

```ts
import { expect, test, afterEach } from "vitest";
import { applyTokens } from "./index.js";

let host: HTMLElement;

function mount(theme?: "light" | "dark"): HTMLElement {
  host = document.createElement("div");
  if (theme) host.setAttribute("data-theme", theme);
  document.body.appendChild(host);
  applyTokens(host);
  return host;
}

afterEach(() => host?.remove());

function token(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

test("defines the core colour contract", () => {
  const el = mount("light");
  for (const name of [
    "--wt-color-bg",
    "--wt-color-surface",
    "--wt-color-text",
    "--wt-color-text-muted",
    "--wt-color-primary",
    "--wt-color-on-primary",
    "--wt-color-danger",
    "--wt-color-on-danger",
    "--wt-color-border",
    "--wt-color-focus",
  ]) {
    expect(token(el, name), `${name} should be defined`).not.toBe("");
  }
});

test("light and dark resolve to different backgrounds", () => {
  const light = mount("light");
  const lightBg = token(light, "--wt-color-bg");
  light.remove();

  const dark = mount("dark");
  const darkBg = token(dark, "--wt-color-bg");

  expect(lightBg).not.toBe(darkBg);
});

test("data-theme overrides the media preference in both directions", () => {
  const el = mount("dark");
  const darkText = token(el, "--wt-color-text");
  el.setAttribute("data-theme", "light");
  const lightText = token(el, "--wt-color-text");

  expect(darkText).not.toBe(lightText);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 3: Write the token stylesheet**

`packages/ui/src/tokens/colors.css`:

```css
:where([data-wt-theme-root]) {
  --wt-color-bg: #f7f7f8;
  --wt-color-surface: #ffffff;
  --wt-color-surface-raised: #ffffff;
  --wt-color-text: #16181d;
  --wt-color-text-muted: #5c626e;
  --wt-color-primary: #1f6feb;
  --wt-color-on-primary: #ffffff;
  --wt-color-danger: #b3261e;
  --wt-color-on-danger: #ffffff;
  --wt-color-success: #1a7f5a;
  --wt-color-border: #d6d9e0;
  --wt-color-focus: #1f6feb;
}

@media (prefers-color-scheme: dark) {
  :where([data-wt-theme-root]) {
    --wt-color-bg: #101216;
    --wt-color-surface: #191c22;
    --wt-color-surface-raised: #22262e;
    --wt-color-text: #eceef2;
    --wt-color-text-muted: #a1a7b3;
    --wt-color-primary: #4c8dff;
    --wt-color-on-primary: #06101f;
    --wt-color-danger: #ff6b5e;
    --wt-color-on-danger: #2a0705;
    --wt-color-success: #4ac08d;
    --wt-color-border: #333945;
    --wt-color-focus: #4c8dff;
  }
}

[data-wt-theme-root][data-theme="light"] {
  --wt-color-bg: #f7f7f8;
  --wt-color-surface: #ffffff;
  --wt-color-surface-raised: #ffffff;
  --wt-color-text: #16181d;
  --wt-color-text-muted: #5c626e;
  --wt-color-primary: #1f6feb;
  --wt-color-on-primary: #ffffff;
  --wt-color-danger: #b3261e;
  --wt-color-on-danger: #ffffff;
  --wt-color-success: #1a7f5a;
  --wt-color-border: #d6d9e0;
  --wt-color-focus: #1f6feb;
}

[data-wt-theme-root][data-theme="dark"] {
  --wt-color-bg: #101216;
  --wt-color-surface: #191c22;
  --wt-color-surface-raised: #22262e;
  --wt-color-text: #eceef2;
  --wt-color-text-muted: #a1a7b3;
  --wt-color-primary: #4c8dff;
  --wt-color-on-primary: #06101f;
  --wt-color-danger: #ff6b5e;
  --wt-color-on-danger: #2a0705;
  --wt-color-success: #4ac08d;
  --wt-color-border: #333945;
  --wt-color-focus: #4c8dff;
}
```

The `:where()` wrapper keeps specificity at zero so the explicit `[data-theme]` rules always win. Values are placeholders — a deployment overrides them without touching this file.

- [ ] **Step 4: Write the token applier**

`packages/ui/src/tokens/index.ts`:

```ts
import colors from "./colors.css?inline";

let sheet: CSSStyleSheet | undefined;

function tokenSheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(colors);
  }
  return sheet;
}

/**
 * Marks `root` as a theme root and makes the token layer available to it
 * and everything beneath it. Call once per app host.
 */
export function applyTokens(root: HTMLElement): void {
  root.setAttribute("data-wt-theme-root", "");
  const doc = root.getRootNode() as Document | ShadowRoot;
  const target = "adoptedStyleSheets" in doc ? doc : document;
  if (!target.adoptedStyleSheets.includes(tokenSheet())) {
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, tokenSheet()];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 4 tests (including the harness test).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/tokens
git commit -m "feat(ui): add colour token layer with light and dark themes"
```

---

### Task 3: Structural tokens

**Files:**
- Create: `packages/ui/src/tokens/structure.css`
- Modify: `packages/ui/src/tokens/index.ts`
- Test: `packages/ui/src/tokens/structure.test.ts`

**Interfaces:**
- Consumes: `applyTokens` from Task 2.
- Produces: `--wt-space-*`, `--wt-radius-*`, `--wt-font-*`, `--wt-tap-min`, `--wt-shadow-*`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/tokens/structure.test.ts`:

```ts
import { expect, test, afterEach } from "vitest";
import { applyTokens } from "./index.js";

let host: HTMLElement;

afterEach(() => host?.remove());

function mount(): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  return host;
}

function token(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

test("defines the structural contract", () => {
  const el = mount();
  for (const name of [
    "--wt-space-1",
    "--wt-space-2",
    "--wt-space-3",
    "--wt-space-4",
    "--wt-space-5",
    "--wt-radius-sm",
    "--wt-radius-md",
    "--wt-radius-lg",
    "--wt-font-family",
    "--wt-font-size-sm",
    "--wt-font-size-md",
    "--wt-font-size-lg",
    "--wt-tap-min",
  ]) {
    expect(token(el, name), `${name} should be defined`).not.toBe("");
  }
});

test("minimum tap target is at least 44px", () => {
  const el = mount();
  const tap = parseInt(token(el, "--wt-tap-min"), 10);
  expect(tap).toBeGreaterThanOrEqual(44);
});

test("structural tokens are overridable per deployment", () => {
  const el = mount();
  el.style.setProperty("--wt-radius-md", "0px");
  expect(token(el, "--wt-radius-md")).toBe("0px");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test structure`
Expected: FAIL — tokens resolve to empty strings.

- [ ] **Step 3: Write the structural tokens**

`packages/ui/src/tokens/structure.css`:

```css
:where([data-wt-theme-root]) {
  --wt-space-1: 4px;
  --wt-space-2: 8px;
  --wt-space-3: 12px;
  --wt-space-4: 16px;
  --wt-space-5: 24px;
  --wt-space-6: 32px;

  --wt-radius-sm: 4px;
  --wt-radius-md: 8px;
  --wt-radius-lg: 16px;

  --wt-font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  --wt-font-size-sm: 13px;
  --wt-font-size-md: 15px;
  --wt-font-size-lg: 19px;
  --wt-font-size-xl: 24px;
  --wt-font-weight-normal: 400;
  --wt-font-weight-bold: 600;

  --wt-tap-min: 44px;

  --wt-shadow-1: 0 1px 2px rgb(0 0 0 / 0.08);
  --wt-shadow-2: 0 8px 24px rgb(0 0 0 / 0.16);

  --wt-focus-ring: 2px solid var(--wt-color-focus);
  --wt-focus-offset: 2px;
}
```

- [ ] **Step 4: Include it in the applier**

Modify `packages/ui/src/tokens/index.ts` — change the import block and `replaceSync` call:

```ts
import colors from "./colors.css?inline";
import structure from "./structure.css?inline";

let sheet: CSSStyleSheet | undefined;

function tokenSheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(`${colors}\n${structure}`);
  }
  return sheet;
}
```

Leave `applyTokens` unchanged.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/tokens
git commit -m "feat(ui): add structural tokens for spacing, radius, type and tap targets"
```

---

### Task 4: Shared base styles

**Files:**
- Create: `packages/ui/src/base-styles.ts`
- Create: `packages/ui/src/index.ts`
- Test: `packages/ui/src/base-styles.test.ts`

**Interfaces:**
- Consumes: tokens from Tasks 2–3.
- Produces: `baseStyles: CSSResult`, imported by every primitive's `static styles`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/base-styles.test.ts`:

```ts
import { expect, test } from "vitest";
import { baseStyles } from "./base-styles.js";

test("exports a Lit stylesheet", () => {
  expect(baseStyles.cssText).toContain("box-sizing");
});

test("declares no literal colours", () => {
  expect(baseStyles.cssText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});
```

The second test is the enforcement mechanism for "no hardcoded chrome". It is repeated for each primitive.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test base-styles`
Expected: FAIL — cannot resolve `./base-styles.js`.

- [ ] **Step 3: Write the base styles**

`packages/ui/src/base-styles.ts`:

```ts
import { css } from "lit";

export const baseStyles = css`
  :host,
  :host *,
  :host *::before,
  :host *::after {
    box-sizing: border-box;
  }

  :host {
    font-family: var(--wt-font-family);
    font-size: var(--wt-font-size-md);
    color: var(--wt-color-text);
  }

  :host([hidden]) {
    display: none;
  }

  :focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
`;
```

- [ ] **Step 4: Create the package entry point**

`packages/ui/src/index.ts`:

```ts
export { applyTokens } from "./tokens/index.js";
export { baseStyles } from "./base-styles.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/base-styles.ts packages/ui/src/base-styles.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add shared base styles and package entry point"
```

---

### Task 5: Button primitive

**Files:**
- Create: `packages/ui/src/components/wt-button.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/components/wt-button.test.ts`

**Interfaces:**
- Consumes: `baseStyles` from Task 4, `applyTokens` from Task 2.
- Produces: `<wt-button>` with `variant: "primary" | "secondary" | "danger" | "ghost"`, `size: "sm" | "md" | "lg"`, `disabled: boolean`, `type: "button" | "submit"`. Class `WtButton`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/components/wt-button.test.ts`:

```ts
import { expect, test, afterEach } from "vitest";
import { applyTokens } from "../tokens/index.js";
import "./wt-button.js";

let host: HTMLElement;

afterEach(() => host?.remove());

async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

test("renders slotted content", async () => {
  const el = await mount("<wt-button>Cobrar</wt-button>");
  expect(el.textContent?.trim()).toBe("Cobrar");
});

test("defaults to the secondary variant", async () => {
  const el = await mount("<wt-button>x</wt-button>");
  expect(el.getAttribute("variant")).toBe("secondary");
});

test("meets the minimum tap target at default size", async () => {
  const el = await mount("<wt-button>x</wt-button>");
  const height = el.getBoundingClientRect().height;
  expect(height).toBeGreaterThanOrEqual(44);
});

test("does not emit click when disabled", async () => {
  const el = await mount("<wt-button disabled>x</wt-button>");
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  (el.shadowRoot!.querySelector("button") as HTMLButtonElement).click();
  expect(clicks).toBe(0);
});

test("emits click when enabled", async () => {
  const el = await mount("<wt-button>x</wt-button>");
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  (el.shadowRoot!.querySelector("button") as HTMLButtonElement).click();
  expect(clicks).toBe(1);
});

test("primary variant paints from the primary token", async () => {
  const el = await mount('<wt-button variant="primary">x</wt-button>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  const inner = el.shadowRoot!.querySelector("button")!;
  expect(getComputedStyle(inner).backgroundColor).toBe("rgb(1, 2, 3)");
});
```

The last test is the important one: it proves the component is themeable rather than merely styled.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test wt-button`
Expected: FAIL — cannot resolve `./wt-button.js`.

- [ ] **Step 3: Write the component**

`packages/ui/src/components/wt-button.ts`:

```ts
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export type WtButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type WtButtonSize = "sm" | "md" | "lg";

@customElement("wt-button")
export class WtButton extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--wt-space-2);
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-md);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      :host([size="sm"]) button {
        min-height: var(--wt-space-6);
        padding: var(--wt-space-1) var(--wt-space-3);
        font-size: var(--wt-font-size-sm);
      }

      :host([size="lg"]) button {
        min-height: calc(var(--wt-tap-min) * 1.4);
        padding: var(--wt-space-3) var(--wt-space-5);
        font-size: var(--wt-font-size-lg);
      }

      :host([variant="primary"]) button {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }

      :host([variant="secondary"]) button {
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        border-color: var(--wt-color-border);
      }

      :host([variant="danger"]) button {
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
      }

      :host([variant="ghost"]) button {
        background: transparent;
        color: var(--wt-color-text);
      }
    `,
  ];

  @property({ reflect: true }) variant: WtButtonVariant = "secondary";
  @property({ reflect: true }) size: WtButtonSize = "md";
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property() type: "button" | "submit" = "button";

  override render() {
    return html`
      <button type=${this.type} ?disabled=${this.disabled}>
        <slot></slot>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-button": WtButton;
  }
}
```

- [ ] **Step 4: Export it**

Add to `packages/ui/src/index.ts`:

```ts
export { WtButton } from "./components/wt-button.js";
export type { WtButtonVariant, WtButtonSize } from "./components/wt-button.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components packages/ui/src/index.ts
git commit -m "feat(ui): add wt-button primitive"
```

---

### Task 6: Icon primitive

**Files:**
- Create: `packages/ui/src/components/wt-icon.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/components/wt-icon.test.ts`

**Interfaces:**
- Consumes: `baseStyles` from Task 4.
- Produces: `<wt-icon>` with `name: string`, `size: "sm" | "md" | "lg"`, and `registerIcons(icons: Record<string, string>): void` where values are raw SVG path data. Class `WtIcon`.

Icons are registered rather than bundled so consuming apps choose their own set without `packages/ui` depending on an icon library.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/components/wt-icon.test.ts`:

```ts
import { expect, test, afterEach } from "vitest";
import { applyTokens } from "../tokens/index.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-icon.js";

let host: HTMLElement;

afterEach(() => host?.remove());

async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

test("renders a registered icon", async () => {
  registerIcons({ check: "M2 8 L6 12 L14 4" });
  const el = await mount('<wt-icon name="check"></wt-icon>');
  const path = el.shadowRoot!.querySelector("path");
  expect(path?.getAttribute("d")).toBe("M2 8 L6 12 L14 4");
});

test("renders nothing for an unregistered icon", async () => {
  const el = await mount('<wt-icon name="nope"></wt-icon>');
  expect(el.shadowRoot!.querySelector("path")).toBeNull();
});

test("inherits colour from its context", async () => {
  registerIcons({ check: "M2 8 L6 12 L14 4" });
  const el = await mount('<wt-icon name="check"></wt-icon>');
  el.style.color = "rgb(4, 5, 6)";
  const svg = el.shadowRoot!.querySelector("svg")!;
  expect(getComputedStyle(svg).fill).toBe("rgb(4, 5, 6)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test wt-icon`
Expected: FAIL — cannot resolve `./wt-icon.js`.

- [ ] **Step 3: Write the component**

`packages/ui/src/components/wt-icon.ts`:

```ts
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export type WtIconSize = "sm" | "md" | "lg";

const registry = new Map<string, string>();

/** Registers icon path data by name. Values are the `d` attribute of a 16x16 SVG path. */
export function registerIcons(icons: Record<string, string>): void {
  for (const [name, path] of Object.entries(icons)) {
    registry.set(name, path);
  }
}

@customElement("wt-icon")
export class WtIcon extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        width: var(--wt-font-size-md);
        height: var(--wt-font-size-md);
      }

      :host([size="sm"]) {
        width: var(--wt-font-size-sm);
        height: var(--wt-font-size-sm);
      }

      :host([size="lg"]) {
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
      }

      svg {
        width: 100%;
        height: 100%;
        fill: currentColor;
      }
    `,
  ];

  @property({ reflect: true }) name = "";
  @property({ reflect: true }) size: WtIconSize = "md";

  override render() {
    const path = registry.get(this.name);
    if (!path) return nothing;
    return html`
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d=${path}></path>
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-icon": WtIcon;
  }
}
```

- [ ] **Step 4: Export it**

Add to `packages/ui/src/index.ts`:

```ts
export { WtIcon, registerIcons } from "./components/wt-icon.js";
export type { WtIconSize } from "./components/wt-icon.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 18 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/wt-icon.ts packages/ui/src/components/wt-icon.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add wt-icon primitive with a pluggable icon registry"
```

---

### Task 7: Card primitive

**Files:**
- Create: `packages/ui/src/components/wt-card.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/components/wt-card.test.ts`

**Interfaces:**
- Consumes: `baseStyles` from Task 4.
- Produces: `<wt-card>` with `raised: boolean` and a `header` named slot. Class `WtCard`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/components/wt-card.test.ts`:

```ts
import { expect, test, afterEach } from "vitest";
import { applyTokens } from "../tokens/index.js";
import "./wt-card.js";

let host: HTMLElement;

afterEach(() => host?.remove());

async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

test("renders default and header slots", async () => {
  const el = await mount(
    '<wt-card><span slot="header">Total</span><span>12,40 €</span></wt-card>',
  );
  const slots = [...el.shadowRoot!.querySelectorAll("slot")].map((s) => s.getAttribute("name"));
  expect(slots).toContain("header");
  expect(slots).toContain(null);
});

test("paints from the surface token", async () => {
  const el = await mount("<wt-card>x</wt-card>");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  const inner = el.shadowRoot!.querySelector(".card")!;
  expect(getComputedStyle(inner).backgroundColor).toBe("rgb(7, 8, 9)");
});

test("raised uses the raised surface token", async () => {
  const el = await mount("<wt-card raised>x</wt-card>");
  host.style.setProperty("--wt-color-surface-raised", "rgb(10, 11, 12)");
  const inner = el.shadowRoot!.querySelector(".card")!;
  expect(getComputedStyle(inner).backgroundColor).toBe("rgb(10, 11, 12)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test wt-card`
Expected: FAIL — cannot resolve `./wt-card.js`.

- [ ] **Step 3: Write the component**

`packages/ui/src/components/wt-card.ts`:

```ts
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

@customElement("wt-card")
export class WtCard extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .card {
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        padding: var(--wt-space-4);
      }

      :host([raised]) .card {
        background: var(--wt-color-surface-raised);
        box-shadow: var(--wt-shadow-1);
      }

      .header {
        margin-bottom: var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) raised = false;

  override render() {
    return html`
      <div class="card">
        <div class="header"><slot name="header"></slot></div>
        <slot></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-card": WtCard;
  }
}
```

- [ ] **Step 4: Export it**

Add to `packages/ui/src/index.ts`:

```ts
export { WtCard } from "./components/wt-card.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 21 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/wt-card.ts packages/ui/src/components/wt-card.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add wt-card primitive"
```

---

### Task 8: Input primitive

**Files:**
- Create: `packages/ui/src/components/wt-input.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/components/wt-input.test.ts`

**Interfaces:**
- Consumes: `baseStyles` from Task 4.
- Produces: `<wt-input>` with `value: string`, `label: string`, `type: string`, `placeholder: string`, `disabled: boolean`, `invalid: boolean`. Emits `wt-change` with `detail: { value: string }`. Class `WtInput`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/components/wt-input.test.ts`:

```ts
import { expect, test, afterEach } from "vitest";
import { applyTokens } from "../tokens/index.js";
import "./wt-input.js";

let host: HTMLElement;

afterEach(() => host?.remove());

async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

test("renders its label", async () => {
  const el = await mount('<wt-input label="Peso"></wt-input>');
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Peso");
});

test("reflects the initial value into the native input", async () => {
  const el = await mount('<wt-input value="1.25"></wt-input>');
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.value).toBe("1.25");
});

test("emits wt-change with the new value", async () => {
  const el = await mount("<wt-input></wt-input>");
  let received: string | undefined;
  el.addEventListener("wt-change", (e) => {
    received = (e as CustomEvent<{ value: string }>).detail.value;
  });

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.value = "2.50";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

  expect(received).toBe("2.50");
});

test("does not leak the native input event outside the component", async () => {
  const el = await mount("<wt-input></wt-input>");
  let native = 0;
  host.addEventListener("input", () => native++);

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

  expect(native).toBe(0);
});

test("invalid state paints from the danger token", async () => {
  const el = await mount("<wt-input invalid></wt-input>");
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(getComputedStyle(input).borderColor).toBe("rgb(13, 14, 15)");
});
```

The fourth test enforces the shadow-DOM event discipline: re-emitted events must not double-fire.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test wt-input`
Expected: FAIL — cannot resolve `./wt-input.js`.

- [ ] **Step 3: Write the component**

`packages/ui/src/components/wt-input.ts`:

```ts
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

@customElement("wt-input")
export class WtInput extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      label {
        display: block;
        margin-bottom: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      input {
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }

      input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      :host([invalid]) input {
        border-color: var(--wt-color-danger);
      }
    `,
  ];

  @property() value = "";
  @property() label = "";
  @property() type = "text";
  @property() placeholder = "";
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) invalid = false;

  private onInput(event: Event): void {
    // HA-style discipline: stop the native composed event so it cannot
    // double-fire across the shadow boundary, then re-emit our own.
    event.stopPropagation();
    this.value = (event.target as HTMLInputElement).value;
    this.dispatchEvent(
      new CustomEvent<{ value: string }>("wt-change", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      ${this.label ? html`<label>${this.label}</label>` : nothing}
      <input
        .value=${this.value}
        type=${this.type}
        placeholder=${this.placeholder}
        ?disabled=${this.disabled}
        @input=${this.onInput}
      />
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-input": WtInput;
  }
}
```

- [ ] **Step 4: Export it**

Add to `packages/ui/src/index.ts`:

```ts
export { WtInput } from "./components/wt-input.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 26 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/wt-input.ts packages/ui/src/components/wt-input.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add wt-input primitive"
```

---

### Task 9: Dialog primitive

**Files:**
- Create: `packages/ui/src/components/wt-dialog.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/components/wt-dialog.test.ts`

**Interfaces:**
- Consumes: `baseStyles` from Task 4.
- Produces: `<wt-dialog>` with `open: boolean`, `heading: string`, and a `footer` named slot. Emits `wt-close`. Wraps native `<dialog>` for focus trapping and top-layer rendering. Class `WtDialog`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/components/wt-dialog.test.ts`:

```ts
import { expect, test, afterEach } from "vitest";
import { applyTokens } from "../tokens/index.js";
import "./wt-dialog.js";

let host: HTMLElement;

afterEach(() => host?.remove());

async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

test("is closed by default", async () => {
  const el = await mount("<wt-dialog>body</wt-dialog>");
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.open).toBe(false);
});

test("opens when the open property is set", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as HTMLElement & {
    open: boolean;
    updateComplete: Promise<unknown>;
  };
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.open).toBe(true);
});

test("renders the heading", async () => {
  const el = await mount('<wt-dialog heading="Anular venta">body</wt-dialog>');
  expect(el.shadowRoot!.querySelector("h2")?.textContent?.trim()).toBe("Anular venta");
});

test("emits wt-close when the native dialog closes", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as HTMLElement & {
    open: boolean;
    updateComplete: Promise<unknown>;
  };
  el.open = true;
  await el.updateComplete;

  let closed = 0;
  el.addEventListener("wt-close", () => closed++);

  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  dialog.close();

  expect(closed).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test wt-dialog`
Expected: FAIL — cannot resolve `./wt-dialog.js`.

- [ ] **Step 3: Write the component**

`packages/ui/src/components/wt-dialog.ts`:

```ts
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

@customElement("wt-dialog")
export class WtDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      dialog {
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
        max-width: min(90vw, 32rem);
      }

      dialog::backdrop {
        background: rgb(0 0 0 / 0.4);
      }

      .body {
        padding: var(--wt-space-5);
      }

      h2 {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-lg);
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3) var(--wt-space-5);
        border-top: 1px solid var(--wt-color-border);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property() heading = "";

  @query("dialog") private dialog!: HTMLDialogElement;

  override updated(changed: Map<string, unknown>): void {
    if (!changed.has("open")) return;
    if (this.open && !this.dialog.open) this.dialog.showModal();
    if (!this.open && this.dialog.open) this.dialog.close();
  }

  private onClose(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  }

  override render() {
    return html`
      <dialog @close=${this.onClose}>
        <div class="body">
          ${this.heading ? html`<h2>${this.heading}</h2>` : nothing}
          <slot></slot>
        </div>
        <div class="footer"><slot name="footer"></slot></div>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-dialog": WtDialog;
  }
}
```

- [ ] **Step 4: Export it**

Add to `packages/ui/src/index.ts`:

```ts
export { WtDialog } from "./components/wt-dialog.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 30 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/wt-dialog.ts packages/ui/src/components/wt-dialog.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add wt-dialog primitive"
```

---

### Task 10: Switch primitive

**Files:**
- Create: `packages/ui/src/components/wt-switch.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/components/wt-switch.test.ts`

**Interfaces:**
- Consumes: `baseStyles` from Task 4.
- Produces: `<wt-switch>` with `checked: boolean`, `disabled: boolean`, `label: string`. Emits `wt-change` with `detail: { checked: boolean }`. Class `WtSwitch`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/components/wt-switch.test.ts`:

```ts
import { expect, test, afterEach } from "vitest";
import { applyTokens } from "../tokens/index.js";
import "./wt-switch.js";

let host: HTMLElement;

afterEach(() => host?.remove());

async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

test("renders its label", async () => {
  const el = await mount('<wt-switch label="Modo formación"></wt-switch>');
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Modo formación");
});

test("exposes checked state to assistive technology", async () => {
  const el = await mount("<wt-switch checked></wt-switch>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.getAttribute("role")).toBe("switch");
  expect(input.checked).toBe(true);
});

test("emits wt-change with the new checked state", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  let received: boolean | undefined;
  el.addEventListener("wt-change", (e) => {
    received = (e as CustomEvent<{ checked: boolean }>).detail.checked;
  });

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.click();

  expect(received).toBe(true);
});

test("does not leak the native change event outside the component", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  let native = 0;
  host.addEventListener("change", () => native++);

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.click();

  expect(native).toBe(0);
});

test("checked track paints from the primary token", async () => {
  const el = await mount("<wt-switch checked></wt-switch>");
  host.style.setProperty("--wt-color-primary", "rgb(16, 17, 18)");
  const track = el.shadowRoot!.querySelector(".track")!;
  expect(getComputedStyle(track).backgroundColor).toBe("rgb(16, 17, 18)");
});

test("meets the minimum tap target", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test wt-switch`
Expected: FAIL — cannot resolve `./wt-switch.js`.

- [ ] **Step 3: Write the component**

`packages/ui/src/components/wt-switch.ts`:

```ts
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

@customElement("wt-switch")
export class WtSwitch extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-3);
      }

      .control {
        position: relative;
        display: inline-flex;
        align-items: center;
      }

      /* The native input covers the control so it stays the hit target
         and keeps keyboard and assistive-technology behaviour. */
      input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        min-height: var(--wt-tap-min);
        margin: 0;
        opacity: 0;
        cursor: pointer;
      }

      input:disabled {
        cursor: not-allowed;
      }

      .track {
        width: var(--wt-space-6);
        height: var(--wt-space-4);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-border);
        transition: background 120ms ease;
      }

      .thumb {
        position: absolute;
        left: 0;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface);
        box-shadow: var(--wt-shadow-1);
        transition: transform 120ms ease;
      }

      :host([checked]) .track {
        background: var(--wt-color-primary);
      }

      :host([checked]) .thumb {
        transform: translateX(var(--wt-space-4));
      }

      :host([disabled]) {
        opacity: 0.5;
      }

      input:focus-visible ~ .track {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      label {
        cursor: pointer;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property() label = "";

  private onChange(event: Event): void {
    event.stopPropagation();
    this.checked = (event.target as HTMLInputElement).checked;
    this.dispatchEvent(
      new CustomEvent<{ checked: boolean }>("wt-change", {
        detail: { checked: this.checked },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <span class="control">
        <input
          type="checkbox"
          role="switch"
          .checked=${this.checked}
          ?disabled=${this.disabled}
          aria-label=${this.label || nothing}
          @change=${this.onChange}
        />
        <span class="track"></span>
        <span class="thumb"></span>
      </span>
      ${this.label ? html`<label>${this.label}</label>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-switch": WtSwitch;
  }
}
```

- [ ] **Step 4: Export it**

Add to `packages/ui/src/index.ts`:

```ts
export { WtSwitch } from "./components/wt-switch.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 36 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/wt-switch.ts packages/ui/src/components/wt-switch.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add wt-switch primitive"
```

---

### Task 11: No-hardcoded-chrome guard

**Files:**
- Create: `packages/ui/src/no-hardcoded-chrome.test.ts`

**Interfaces:**
- Consumes: every component from Tasks 5–10.
- Produces: a regression test that fails when any primitive introduces a literal colour or spacing value.

This replaces a lint rule with something simpler and stricter: a test that reads the components' own `cssText`.

- [ ] **Step 1: Write the test**

`packages/ui/src/no-hardcoded-chrome.test.ts`:

```ts
import { expect, test } from "vitest";
import type { CSSResult } from "lit";
import { WtButton } from "./components/wt-button.js";
import { WtCard } from "./components/wt-card.js";
import { WtDialog } from "./components/wt-dialog.js";
import { WtIcon } from "./components/wt-icon.js";
import { WtInput } from "./components/wt-input.js";
import { WtSwitch } from "./components/wt-switch.js";

const components = { WtButton, WtCard, WtDialog, WtIcon, WtInput, WtSwitch };

function cssOf(styles: unknown): string {
  const list = Array.isArray(styles) ? styles : [styles];
  return list.map((s) => (s as CSSResult).cssText).join("\n");
}

for (const [name, ctor] of Object.entries(components)) {
  test(`${name} declares no literal hex colours`, () => {
    expect(cssOf(ctor.styles)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test(`${name} declares no literal px spacing`, () => {
    // 1px borders and 0 are permitted; anything larger must be a token.
    const css = cssOf(ctor.styles);
    const offenders = [...css.matchAll(/(?<![\w-])(\d+)px/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n > 1);
    expect(offenders).toEqual([]);
  });
}
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @waitron/ui test no-hardcoded-chrome`
Expected: PASS, 12 tests. If any fail, replace the offending literal in that component with a token — do not relax the test.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/no-hardcoded-chrome.test.ts
git commit -m "test(ui): guard against hardcoded colours and spacing in primitives"
```

---

### Task 12: Kitchen-sink workbench

**Files:**
- Create: `packages/ui/index.html`
- Create: `packages/ui/demo/main.ts`
- Modify: `packages/ui/package.json`
- Create: `packages/ui/vite.config.ts`

**Interfaces:**
- Consumes: all primitives and `applyTokens`.
- Produces: `pnpm --filter @waitron/ui dev` serving a page showing every primitive in both themes.

- [ ] **Step 1: Create the Vite config**

`packages/ui/vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5180 },
});
```

- [ ] **Step 2: Create the demo page**

`packages/ui/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Waitron UI</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        font-family: var(--wt-font-family);
      }
      .panels { display: flex; gap: 24px; flex-wrap: wrap; }
      .panel { flex: 1 1 320px; padding: 16px; background: var(--wt-color-bg); }
      .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/demo/main.ts"></script>
  </body>
</html>
```

`packages/ui/demo/main.ts`:

```ts
import { applyTokens, registerIcons } from "../src/index.js";
import "../src/components/wt-button.js";
import "../src/components/wt-card.js";
import "../src/components/wt-dialog.js";
import "../src/components/wt-icon.js";
import "../src/components/wt-input.js";
import "../src/components/wt-switch.js";

registerIcons({
  check: "M2 8 L6 12 L14 4",
  cart: "M1 2 h3 l2 8 h7 l2 -6 H5",
});

const panel = (theme: "light" | "dark") => `
  <div class="panel" data-theme="${theme}">
    <h2>${theme}</h2>
    <div class="row">
      <wt-button variant="primary">Cobrar</wt-button>
      <wt-button variant="secondary">Cancelar</wt-button>
      <wt-button variant="danger">Anular</wt-button>
      <wt-button variant="ghost"><wt-icon name="cart"></wt-icon> Cesta</wt-button>
    </div>
    <div class="row">
      <wt-button size="sm">sm</wt-button>
      <wt-button size="md">md</wt-button>
      <wt-button size="lg">lg</wt-button>
    </div>
    <wt-card raised>
      <span slot="header">Ticket</span>
      <wt-input label="Peso (kg)" value="1.25"></wt-input>
      <div class="row" style="margin-top:16px">
        <wt-switch label="Modo formación"></wt-switch>
        <wt-switch label="Activado" checked></wt-switch>
      </div>
    </wt-card>
    <div class="row" style="margin-top:16px">
      <wt-button class="open-dialog">Abrir diálogo</wt-button>
    </div>
    <wt-dialog heading="Anular venta">
      Esto generará un registro rectificativo.
      <wt-button slot="footer" variant="danger">Anular</wt-button>
    </wt-dialog>
  </div>
`;

const app = document.querySelector("#app")!;
app.innerHTML = `<div class="panels">${panel("light")}${panel("dark")}</div>`;

for (const el of app.querySelectorAll<HTMLElement>(".panel")) {
  applyTokens(el);
}

for (const trigger of app.querySelectorAll<HTMLElement>(".open-dialog")) {
  trigger.addEventListener("click", () => {
    const dialog = trigger.closest(".panel")!.querySelector("wt-dialog") as HTMLElement & {
      open: boolean;
    };
    dialog.open = true;
  });
}
```

- [ ] **Step 3: Add the dev script**

Add to `packages/ui/package.json` scripts:

```json
"dev": "vite"
```

And add `"vite": "^6.0.0"` to its `devDependencies`.

- [ ] **Step 4: Verify it runs**

Run:

```bash
pnpm install
pnpm --filter @waitron/ui dev
```

Open `http://localhost:5180`. Expected: light and dark panels side by side, every primitive visible, dialog opens. Both panels must look correct simultaneously — that is the proof the token layer works per-subtree rather than globally.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/index.html packages/ui/demo packages/ui/vite.config.ts packages/ui/package.json pnpm-lock.yaml
git commit -m "feat(ui): add kitchen-sink workbench for both themes"
```

---

### Task 13: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm test` and `pnpm typecheck` from Task 1.
- Produces: CI that runs typecheck and browser tests on every push and pull request.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0

      - uses: actions/setup-node@v5
        with:
          node-version-file: ".nvmrc"
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm exec playwright install --with-deps chromium

      - run: pnpm typecheck

      - run: pnpm test
```

Note: `--with-deps` is required on CI runners to install Chromium's system libraries. Without it the browser provider fails at launch.

- [ ] **Step 2: Verify locally first**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected: both pass. Do not push a workflow whose commands you have not run locally.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run typecheck and browser tests"
git push
```

- [ ] **Step 4: Confirm CI is green**

Run: `gh run watch`
Expected: the run completes successfully. If Chromium fails to launch, confirm `--with-deps` is present.

---

### Task 14: Design system documentation

**Files:**
- Create: `docs/developers/design-system.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the contract document that later sub-projects follow. Per project convention, its presence is what marks this repo as having a design system.

- [ ] **Step 1: Write the document**

`docs/developers/design-system.md`:

````markdown
# Design system

Every screen in this project is built from `wt-*` primitives styled by `--wt-*` tokens.
This document is the contract. If you are building a view, read this first.

## The rule

**No hardcoded chrome.** No hex colours, no font sizes, no radii, and no spacing above
1px in any component or view. Every such value reads a token. This is enforced by
`packages/ui/src/no-hardcoded-chrome.test.ts`, which fails the build on violations.

If a token you need does not exist, add it to the token layer — do not inline a value.

## Setting up a theme root

```ts
import { applyTokens } from "@waitron/ui";

applyTokens(document.querySelector("#app")!);
```

This marks the element as a theme root and makes tokens available to it and everything
beneath it. Tokens are scoped per subtree, so two theme roots on one page can render in
different themes simultaneously — see the workbench.

## Themes

Light and dark ship by default. Selection order:

1. `prefers-color-scheme` — the default.
2. `data-theme="light" | "dark"` on the theme root — wins in both directions.

## Retheming a deployment

Override tokens on the theme root. Never patch component styles.

```css
#app {
  --wt-color-primary: #7c3aed;
  --wt-radius-md: 0px;
}
```

## Tokens

### Colour

`--wt-color-bg`, `--wt-color-surface`, `--wt-color-surface-raised`, `--wt-color-text`,
`--wt-color-text-muted`, `--wt-color-primary`, `--wt-color-on-primary`, `--wt-color-danger`,
`--wt-color-on-danger`, `--wt-color-success`, `--wt-color-border`, `--wt-color-focus`

Colours are semantic, not literal. There is no `--wt-color-blue`.

### Structure

`--wt-space-1` … `--wt-space-6` (4–32px), `--wt-radius-sm|md|lg`, `--wt-font-family`,
`--wt-font-size-sm|md|lg|xl`, `--wt-font-weight-normal|bold`, `--wt-shadow-1|2`,
`--wt-focus-ring`, `--wt-focus-offset`

### `--wt-tap-min`

Minimum interactive target, 44px. POS screens are touched under time pressure by staff
who are not looking carefully. Every interactive primitive respects this.

## Primitives

| Element | Properties | Events |
| --- | --- | --- |
| `wt-button` | `variant`, `size`, `disabled`, `type` | native `click` |
| `wt-icon` | `name`, `size` | — |
| `wt-card` | `raised`; `header` slot | — |
| `wt-input` | `value`, `label`, `type`, `placeholder`, `disabled`, `invalid` | `wt-change` |
| `wt-switch` | `checked`, `disabled`, `label` | `wt-change` |
| `wt-dialog` | `open`, `heading`; `footer` slot | `wt-close` |

Icons are registered by the consuming app, so `packages/ui` depends on no icon library:

```ts
import { registerIcons } from "@waitron/ui";
registerIcons({ check: "M2 8 L6 12 L14 4" });
```

## Event discipline

Custom events crossing a shadow boundary are `composed: true`, so a native event re-emitted
without care fires twice. **Always `stopPropagation()` the native event before dispatching
your own.** `wt-input` is the reference implementation.

Custom events are named `wt-*` and carry data in `detail`.

## Adding a primitive

1. Write the test first, in a real browser. Include a test proving it paints from a token —
   set the token on the host and assert the computed style changes. A component that renders
   correctly but ignores tokens is not a primitive.
2. Extend `LitElement`, and put `baseStyles` first in `static styles`.
3. Reflect variant-like properties so they are styleable via `:host([variant="..."])`.
4. Add it to `no-hardcoded-chrome.test.ts`.
5. Add it to the workbench and to the table above.

## Workbench

```bash
pnpm --filter @waitron/ui dev
```

Shows every primitive in light and dark simultaneously. Check both before committing.
````

- [ ] **Step 2: Commit**

```bash
git add docs/developers/design-system.md
git commit -m "docs: add design system contract"
```

---

## Definition of done

- [ ] `pnpm install` succeeds from a clean checkout.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes — 48 tests, all in real Chromium.
- [ ] `pnpm --filter @waitron/ui dev` shows both themes rendering correctly side by side.
- [ ] CI is green on `main`.
- [ ] `docs/developers/design-system.md` exists and matches what was built.
- [ ] No primitive contains a literal colour or a spacing value above 1px.
