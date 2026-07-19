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
- **Component test files import `mount`, `host` and `cleanup` from `../test-helpers.js`** and must not define their own. The exception is `src/tokens/*.test.ts`, which tests `applyTokens` itself and cannot depend on a helper that calls it.
- **Red before green, observed per test, not per file.** Before accepting any new or changed test, run it and confirm — individually — that it fails while its target behaviour is absent. Seeing the whole file report *some* failures is not sufficient: a vacuous test can pass in the very same run as its failing siblings and hide there undetected — this is exactly how four earlier defects in this plan (Tasks 1–3) shipped. Where a test targets behaviour that is already implemented (so no red state is possible — e.g. a new regression guard added against existing, working code), confirm the equivalent by mutation instead: temporarily remove or break the behaviour, re-run, confirm the test now fails, then restore it and confirm it passes again — the pattern already used in Task 3 Step 6. A test that passes before its feature exists, or that keeps passing after the feature is deliberately broken, is a defect in the test itself and must be fixed or replaced — never accepted as a green result.
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
import type { BrowserCommand } from "vitest/node";

type ColorScheme = "light" | "dark" | null;

interface PlaywrightPage {
  emulateMedia(options: { colorScheme?: ColorScheme }): Promise<void>;
}

/**
 * Emulates the OS `prefers-color-scheme` media feature for the current test.
 * Only the playwright provider's command context carries a `page` (see
 * `provider.getCommandsContext` in @vitest/browser), which is why this isn't
 * typed on `BrowserCommandContext` itself — cast narrowly at the boundary.
 */
const emulateColorScheme: BrowserCommand<[colorScheme: ColorScheme]> = async (
  context,
  colorScheme,
) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.emulateMedia({ colorScheme });
};

export default defineConfig({
  test: {
    globals: true,
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: {
        emulateColorScheme,
      },
    },
  },
});
```

`emulateColorScheme` is a custom Vitest browser command (`test.browser.commands`, see the [Vitest browser commands guide](https://vitest.dev/guide/browser/commands)) that reaches into the Playwright `page` to call `page.emulateMedia({ colorScheme })`, so tests can put `prefers-color-scheme` into a real, conflicting state instead of only toggling the `data-theme` attribute. It's consumed from tests via `commands.emulateColorScheme(...)` imported from `@vitest/browser/context` — see Task 2, which is the only place that currently calls it.

- [ ] **Step 4: Write the failing harness test**

`packages/ui/src/harness.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";

let sheet: CSSStyleSheet | undefined;
let probe: HTMLElement | undefined;

afterEach(() => {
  probe?.remove();
  probe = undefined;
  if (sheet) {
    const stale = sheet;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== stale);
    sheet = undefined;
  }
});

test("resolves custom properties through the cascade, which jsdom cannot do", () => {
  sheet = new CSSStyleSheet();
  sheet.replaceSync(".probe { --probe: 42px; padding: var(--probe); }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  probe = document.createElement("div");
  probe.className = "probe";
  document.body.appendChild(probe);

  // Why this needs a real browser, verified empirically against jsdom 29.1.1:
  // document.adoptedStyleSheets is unimplemented there (jsdom/jsdom#2985), so this
  // test throws outright rather than mismatching. jsdom's var() resolution is also
  // incomplete and version-dependent (25 returns the literal "var(--probe)", 29
  // returns "0"), so neither assertion below would hold.
  const styles = getComputedStyle(probe);
  expect(styles.getPropertyValue("--probe").trim()).toBe("42px");
  expect(styles.padding).toBe("42px");
});
```

This test exists to prove the harness itself works. The gate is `document.adoptedStyleSheets`, which is unimplemented in jsdom (see jsdom/jsdom#2985) — the test throws outright there rather than asserting. In a real browser, it proves the token layer's cascade works: custom properties resolve through adopted stylesheets, and downstream assertions depend on that.

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
import { commands } from "@vitest/browser/context";
import { applyTokens } from "./index.js";

declare module "@vitest/browser/context" {
  interface BrowserCommands {
    emulateColorScheme: (
      colorScheme: "light" | "dark" | null,
    ) => Promise<void>;
  }
}

let host: HTMLElement;

function mount(theme?: "light" | "dark"): HTMLElement {
  host = document.createElement("div");
  if (theme) host.setAttribute("data-theme", theme);
  document.body.appendChild(host);
  applyTokens(host);
  return host;
}

afterEach(async () => {
  host?.remove();
  // Reset OS colour-scheme emulation so it can't leak into other test files.
  await commands.emulateColorScheme(null);
});

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

test("prefers-color-scheme sets the default theme when data-theme is absent", async () => {
  // No data-theme attribute at all: the @media (prefers-color-scheme: dark)
  // block is the only thing that can make this element resolve to dark.
  const el = mount();

  await commands.emulateColorScheme("dark");
  expect(token(el, "--wt-color-bg")).toBe("#101216");

  await commands.emulateColorScheme("light");
  expect(token(el, "--wt-color-bg")).toBe("#f7f7f8");
});

test("data-theme overrides the media preference in both directions", async () => {
  // OS prefers dark, but an explicit data-theme="light" must still win.
  await commands.emulateColorScheme("dark");
  const light = mount("light");
  expect(token(light, "--wt-color-bg")).toBe("#f7f7f8");
  light.remove();

  // OS prefers light, but an explicit data-theme="dark" must still win.
  await commands.emulateColorScheme("light");
  const dark = mount("dark");
  expect(token(dark, "--wt-color-bg")).toBe("#101216");
});
```

This test file uses `commands.emulateColorScheme(...)` (defined in Task 1's `vitest.config.ts`) to put the browser's `prefers-color-scheme` into a real, conflicting state — rather than only flipping the `data-theme` attribute and observing that two readings differ, which would pass identically even if the `@media (prefers-color-scheme: dark)` block in `colors.css` were deleted.

Note the split across two tests, which matters for what each one actually proves:

- **"prefers-color-scheme sets the default theme when data-theme is absent"** mounts with *no* `data-theme` attribute, so `--wt-color-bg` can only come from the base rule or the `@media` block. This is the test that depends on the media query — delete it from `colors.css` and this test fails (resolves to the light default instead of dark).
- **"data-theme overrides the media preference in both directions"** asserts against the real hex values (`#f7f7f8` / `#101216`), not merely that two readings differ, while a conflicting OS preference is emulated. Note this test passes regardless of whether the `@media` block exists: `colors.css`'s `[data-wt-theme-root][data-theme="light"]` / `[data-theme="dark"]` rules carry higher specificity than the `:where()`-wrapped base/media rules, so an explicit `data-theme` always wins on specificity alone. It still earns its keep as a regression guard on that override behaviour (e.g. against someone weakening those selectors), but the first test above is what actually exercises the media query.

Reset the emulation in `afterEach` so it can't leak into other test files.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 3: Write the token stylesheet**

> **Follow-up commit required (added post-implementation):** Task 2 was already implemented and committed before the Task 5–14 test-audit pass added `--wt-color-scrim` below. Task 9's `wt-dialog` backdrop needs a token instead of the literal `rgb(0 0 0 / 0.4)` the original draft hardcoded (caught by the widened guard in Task 11). Apply the `--wt-color-scrim` addition below — in all four blocks of `colors.css`, plus the one-line addition to the contract list in `colors.test.ts` noted after this block — as a small follow-up commit against the already-merged Task 2 code. Do not re-run Task 2 from scratch.

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
  --wt-color-scrim: rgb(0 0 0 / 0.4);
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
    --wt-color-scrim: rgb(0 0 0 / 0.4);
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
  --wt-color-scrim: rgb(0 0 0 / 0.4);
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
  --wt-color-scrim: rgb(0 0 0 / 0.4);
}
```

The `:where()` wrapper keeps specificity at zero so the explicit `[data-theme]` rules always win. Values are placeholders — a deployment overrides them without touching this file. `--wt-color-scrim` is intentionally identical across all four blocks (it reproduces the exact value the original `wt-dialog.ts` draft hardcoded) — it exists so no component ever writes a literal `rgb(...)` for a backdrop/scrim, not to make the scrim theme-dependent; a future deployment can still override it like any other token.

Also add `--wt-color-scrim` to the `defines the core colour contract` test's token list in `colors.test.ts` (same follow-up commit), so a regression that drops the token is caught the same way the other nine are.

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
Expected: PASS, 5 tests (including the harness test).

- [ ] **Step 6: Verify the media-dependent test actually has teeth**

Temporarily delete the `@media (prefers-color-scheme: dark) { ... }` block from `colors.css` and re-run `pnpm --filter @waitron/ui test`. Expected: FAIL — "prefers-color-scheme sets the default theme when data-theme is absent" fails (`--wt-color-bg` resolves to the light default instead of dark); "data-theme overrides the media preference in both directions" still passes, per the note in Step 1 above. Restore the block afterwards and confirm all 5 tests pass again.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/tokens packages/ui/vitest.config.ts
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

test("deployment rules override the token layer's defaults", () => {
  const el = mount();
  el.classList.add("wt-structure-override-target");

  // First, prove the token layer itself is supplying the default value.
  // Without this, the override assertion below would pass even if the
  // token layer defined nothing at all.
  expect(token(el, "--wt-radius-md")).toBe("8px");

  // Then prove a selector-based deployment rule — the way retheming
  // actually works (see "Retheming a deployment" below, e.g.
  // `#app { --wt-radius-md: 0px; }`) — overrides that default. This must
  // be a stylesheet rule competing with the `:where()`-wrapped token
  // definitions, not an inline style: an inline style always wins for a
  // custom property regardless of whether any rule defines it, so it
  // can't distinguish "a deployment override beats the token layer" from
  // "there is no token layer at all".
  overrideSheet = new CSSStyleSheet();
  overrideSheet.replaceSync(".wt-structure-override-target { --wt-radius-md: 0px; }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, overrideSheet];

  expect(token(el, "--wt-radius-md")).toBe("0px");
});
```

`overrideSheet` is a module-level `CSSStyleSheet | undefined`, cleaned up in `afterEach` alongside `host` (same pattern as `harness.test.ts`) so it cannot leak into other test files.

Note: an earlier draft of this test set `--wt-radius-md` via `el.style.setProperty(...)` and read it back. That passes even with no token layer applied at all — an inline style always wins over any stylesheet rule for a custom property, so it only proves CSSOM inline-style behaviour, not that a deployment override beats the token layer's cascade. The version above asserts both halves: the default comes from the token layer, and a competing selector-based rule can override it.

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
Expected: PASS, 8 tests.

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

- [ ] **Step 5: Create the shared test helpers**

Every component test file uses these. Defining them once avoids six identical copies.

`host` is an ESM live binding — importers see the current value after each `mount()`, so
tests can read and write it directly.

`packages/ui/src/test-helpers.ts`:

```ts
import { applyTokens } from "./tokens/index.js";

/** The wrapper element of the most recent mount. Live binding — reassigned by mount(). */
export let host: HTMLElement;

const mounted: HTMLElement[] = [];

/**
 * Mounts `html` inside a fresh themed host and waits for the element to render.
 * Returns the first child — the component under test.
 */
export async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanup)`. */
export function cleanup(): void {
  for (const el of mounted.splice(0)) el.remove();
}
```

Note this file is **not** used by `tokens/*.test.ts`. Those test `applyTokens` itself and must
not depend on a helper that calls it.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 10 tests.

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
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-button.js";

afterEach(cleanup);

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
Expected: PASS, 16 tests.

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
import { cleanup, host, mount } from "../test-helpers.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-icon.js";

afterEach(cleanup);

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
Expected: PASS, 19 tests.

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
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-card.js";

afterEach(cleanup);

test("renders default and header slots", async () => {
  const el = await mount(
    '<wt-card><span slot="header">Total</span><span>12,40 €</span></wt-card>',
  );
  const slots = [...el.shadowRoot!.querySelectorAll("slot")].map((s) => s.getAttribute("name"));
  expect(slots).toContain("header");
  expect(slots).toContain(null);
});

test("does not add a spurious gap when no header content is provided", async () => {
  const el = await mount("<wt-card>x</wt-card>");
  const header = el.shadowRoot!.querySelector(".header")!;
  expect(getComputedStyle(header).marginBottom).toBe("0px");
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

The second test guards against a real defect an earlier draft of this component shipped with: the
`.header` div rendered unconditionally, and its `margin-bottom` applied whether or not any content
was actually slotted into `header` — so every headerless card got a spurious 12px gap before its
body. Confirmed against the code below with the margin left on `.header` itself: the test fails
with `"12px"` instead of `"0px"`. The fix (also below) moves the margin onto `.header ::slotted(*)`
instead of the wrapper itself; since only elements can carry a `slot` attribute, anything actually
assigned to the `header` slot is always matched by `::slotted(*)`, so this is fully reactive to
content being added or removed later with no extra JS needed.

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
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
      }

      /* Only content actually projected into the header slot gets the gap
         below it — an empty header (no "header" slot content) collapses to
         zero height instead of leaving a spurious margin before the body. */
      .header ::slotted(*) {
        margin-bottom: var(--wt-space-3);
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
Expected: PASS, 23 tests.

- [ ] **Step 6: Verify the empty-header test actually has teeth**

Temporarily move `margin-bottom: var(--wt-space-3);` back onto the `.header` rule itself (instead
of `.header ::slotted(*)`) and re-run `pnpm --filter @waitron/ui test wt-card`. Expected: FAIL —
"does not add a spurious gap when no header content is provided" fails (`marginBottom` is `"12px"`
instead of `"0px"`), while the other three tests still pass. Restore the `::slotted(*)` version and
confirm all 4 tests pass again.

- [ ] **Step 7: Commit**

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
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-input.js";

afterEach(cleanup);

test("renders its label", async () => {
  const el = await mount('<wt-input label="Peso"></wt-input>');
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Peso");
});

test("associates the label with the input so it has an accessible name", async () => {
  const el = await mount('<wt-input label="Peso"></wt-input>');
  const label = el.shadowRoot!.querySelector("label")!;
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.id).not.toBe("");
  expect(label.htmlFor).toBe(input.id);
});

test("gives each instance a unique id so labels never collide", async () => {
  const a = await mount('<wt-input label="Peso"></wt-input>');
  const b = await mount('<wt-input label="Precio"></wt-input>');
  const inputA = a.shadowRoot!.querySelector("input")!;
  const inputB = b.shadowRoot!.querySelector("input")!;
  expect(inputA.id).not.toBe(inputB.id);
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

test("meets the minimum tap target", async () => {
  const el = await mount("<wt-input></wt-input>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});
```

The "associates the label" and "gives each instance a unique id" tests guard against a real defect
an earlier draft of this component shipped with: `<label>` and `<input>` rendered as unconnected
siblings — no `for`/`id`, no `aria-label` — so every `wt-input` was silent to a screen reader.
Confirmed against that code: `label.htmlFor === ""`, `input.id === ""`. The fix (below) generates a
module-level, per-instance id (`wt-input-${++instanceCount}`) and wires `for`/`id` between the
label and the input — chosen over wrapping the input inside the label so the existing "label above
the field" layout, and the input's own font sizing, are untouched.

The "does not leak the native input event" test enforces the shadow-DOM event discipline:
re-emitted events must not double-fire. The "meets the minimum tap target" test matches the
equivalent tap-target test already present on `wt-button` (Task 5) and `wt-switch` (Task 10) — a
text field is tapped on a POS screen just as much as a button or switch, and until now nothing
pinned that down for `wt-input`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test wt-input`
Expected: FAIL — cannot resolve `./wt-input.js`.

- [ ] **Step 3: Write the component**

`packages/ui/src/components/wt-input.ts`:

```ts
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

let instanceCount = 0;

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

  // Unique per instance so a page with multiple wt-input elements never
  // collides label `for`/input `id` pairs.
  private readonly inputId = `wt-input-${++instanceCount}`;

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
      ${this.label ? html`<label for=${this.inputId}>${this.label}</label>` : nothing}
      <input
        id=${this.inputId}
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
Expected: PASS, 31 tests.

- [ ] **Step 6: Verify the tap-target test actually has teeth**

Temporarily delete `min-height: var(--wt-tap-min);` from the `input` rule in `wt-input.ts` and
re-run `pnpm --filter @waitron/ui test wt-input`. Expected: FAIL — "meets the minimum tap
target" fails (the native input's height collapses below 44px). Restore the rule and confirm
all tests pass again. Per the Global Constraint on observing new tests fail individually — this
is that check for this test.

- [ ] **Step 7: Verify the accessible-name tests actually have teeth**

Temporarily remove the `for=${this.inputId}` attribute from the label and the `id=${this.inputId}`
attribute from the input in `render()`, then re-run `pnpm --filter @waitron/ui test wt-input`.
Expected: FAIL — both "associates the label with the input" and "gives each instance a unique id"
fail (`input.id` is an empty string). Restore both attributes and confirm all tests pass again.

- [ ] **Step 8: Commit**

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
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-dialog.js";

afterEach(cleanup);

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

  const closed = new Promise<void>((resolve) => {
    el.addEventListener("wt-close", () => resolve(), { once: true });
  });

  el.shadowRoot!.querySelector("dialog")!.close();
  await closed; // will hang/time out if wt-close never fires — a real signal either way
});

test("opens as a modal (top layer, not just visible)", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as HTMLElement & {
    open: boolean;
    updateComplete: Promise<unknown>;
  };
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.matches(":modal")).toBe(true);
});

test("does not render a footer bar when no footer content is provided", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as HTMLElement & {
    open: boolean;
    updateComplete: Promise<unknown>;
  };
  el.open = true;
  await el.updateComplete;
  const footer = el.shadowRoot!.querySelector(".footer")!;
  expect(footer.getBoundingClientRect().height).toBe(0);
});

test("renders a footer bar when footer content is provided", async () => {
  const el = (await mount(
    '<wt-dialog><button slot="footer">OK</button></wt-dialog>',
  )) as HTMLElement & { open: boolean; updateComplete: Promise<unknown> };
  el.open = true;
  await el.updateComplete;
  const footer = el.shadowRoot!.querySelector(".footer")!;
  expect(footer.getBoundingClientRect().height).toBeGreaterThan(0);
});

test("paints from the raised surface token", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as HTMLElement & {
    open: boolean;
    updateComplete: Promise<unknown>;
  };
  el.open = true;
  await el.updateComplete;
  host.style.setProperty("--wt-color-surface-raised", "rgb(30, 31, 32)");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(30, 31, 32)");
});

test("paints its border from the border token", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as HTMLElement & {
    open: boolean;
    updateComplete: Promise<unknown>;
  };
  el.open = true;
  await el.updateComplete;
  host.style.setProperty("--wt-color-border", "rgb(20, 21, 22)");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(dialog).borderColor).toBe("rgb(20, 21, 22)");
});

test("paints its shadow from the shadow-2 token", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as HTMLElement & {
    open: boolean;
    updateComplete: Promise<unknown>;
  };
  el.open = true;
  await el.updateComplete;
  host.style.setProperty("--wt-shadow-2", "1px 2px 3px 4px rgb(9, 10, 11)");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(dialog).boxShadow).toBe("rgb(9, 10, 11) 1px 2px 3px 4px");
});

test("backdrop paints from the scrim token", async () => {
  // The backdrop pseudo-element only exists once the dialog is a genuine
  // modal (showModal(), not just `open`), so this must open it first.
  // getComputedStyle(el, "::backdrop") is a real, working read in this
  // browser-mode (Playwright/Chromium) test setup — confirmed empirically
  // before writing this test.
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as HTMLElement & {
    open: boolean;
    updateComplete: Promise<unknown>;
  };
  el.open = true;
  await el.updateComplete;
  host.style.setProperty("--wt-color-scrim", "rgb(9, 10, 11)");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(dialog, "::backdrop").backgroundColor).toBe("rgb(9, 10, 11)");
});
```

Note the import line now pulls in `host` alongside `cleanup` and `mount` — the token-consumption
tests below need it to override CSS custom properties on the theme root, the same pattern every
other primitive's "paints from token X" tests already use.

Three things about this file that are easy to get wrong, all confirmed empirically against the
reference implementation below:

- **The "emits wt-close" test must `await` the event, not assert synchronously.** Per the HTML
  spec, `HTMLDialogElement.close()` fires its `close` event on a queued task, not synchronously —
  not even a `setTimeout(0)` is soon enough, only a later tick is. A synchronous assertion right
  after calling `close()` fails against a *correct* implementation and will never pass, which
  would push whoever implements this task toward "fixing" it by firing `wt-close` from somewhere
  other than the native `close` event — silently breaking Escape-key and backdrop dismissal, which
  are the paths that actually rely on that event. Do not change the component to fire the event
  synchronously; await it in the test instead, as above.
- **"opens when the open property is set" (below) only proves `dialog.open` becomes `true` — it
  passes identically for `showModal()` and non-modal `show()`.** The interface spec for this
  component requires focus trapping and top-layer rendering, which only `showModal()` provides.
  "opens as a modal" above is the test that can only pass for a genuinely modal dialog: it fails
  if `updated()` is changed to call `dialog.show()` instead.
- **The "does not render a footer bar" test needs the dialog actually open before measuring.**
  A closed `<dialog>` is `display: none` per the UA stylesheet, and while `getComputedStyle` still
  reports the specified border/padding on a `display: none` element, `getBoundingClientRect()`
  layout measurements do not reflect real box-model results until the element is actually
  rendered — hence `el.open = true` before reading `.footer`'s height, matching the "opens as a
  modal" test's own pattern.

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
        background: var(--wt-color-scrim);
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
      }

      /* The padding and divider only make sense once there is something to
         divide from the body — an empty footer slot must not leave a bare
         bar across the bottom of the dialog. */
      .footer.has-content {
        padding: var(--wt-space-3) var(--wt-space-5);
        border-top: 1px solid var(--wt-color-border);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property() heading = "";

  @query("dialog") private dialog!: HTMLDialogElement;
  @query(".footer") private footerEl!: HTMLElement;
  @query('slot[name="footer"]') private footerSlot!: HTMLSlotElement;

  override firstUpdated(): void {
    this.updateHasFooter();
  }

  override updated(changed: Map<string, unknown>): void {
    if (!changed.has("open")) return;
    if (this.open && !this.dialog.open) this.dialog.showModal();
    if (!this.open && this.dialog.open) this.dialog.close();
  }

  private onClose(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  }

  // Toggled imperatively (not via a reactive property) so that discovering
  // footer content — at first render and again on every later `slotchange` —
  // never schedules an extra Lit update cycle just to flip a CSS class. The
  // footer's padding/divider only apply once something is actually
  // projected into the "footer" slot; an empty footer must not leave a bare
  // bar across the bottom of the dialog.
  private updateHasFooter(): void {
    const hasFooter = this.footerSlot.assignedNodes({ flatten: true }).length > 0;
    this.footerEl.classList.toggle("has-content", hasFooter);
  }

  override render() {
    return html`
      <dialog @close=${this.onClose}>
        <div class="body">
          ${this.heading ? html`<h2>${this.heading}</h2>` : nothing}
          <slot></slot>
        </div>
        <div class="footer">
          <slot name="footer" @slotchange=${this.updateHasFooter}></slot>
        </div>
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

`updateHasFooter()` is called twice for two different reasons: once from `firstUpdated()`, which
runs synchronously right after the first render (by which point the slot has already received its
initial assignment, since slot assignment happens synchronously as part of shadow-tree
connection) — this is what makes the initial `has-content` state deterministic and already
settled by the time a test's `await el.updateComplete` resolves, with no race against the
browser's own asynchronous `slotchange` event. And again from the `slotchange` listener bound
directly on the `slot`, which is what keeps it correct if footer content is added or removed later
— a plain one-time `this.querySelector('[slot="footer"]')` check would not react to that. Toggling
`footerEl.classList` directly (rather than driving the class from a `@state()` property through
`render()`) avoids scheduling a second, unnecessary Lit update cycle purely to flip a CSS class —
setting a reactive property from inside `firstUpdated()` works, but Lit's dev mode logs a
"scheduled an update after an update completed" warning for it every time the value actually
changes; the imperative `classList.toggle` sidesteps that entirely.

- [ ] **Step 4: Export it**

Add to `packages/ui/src/index.ts`:

```ts
export { WtDialog } from "./components/wt-dialog.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui test`
Expected: PASS, 42 tests.

- [ ] **Step 6: Verify the modal and close tests actually have teeth**

Two mutations, each restored before moving on:

1. Temporarily change `updated()` to call `this.dialog.show()` instead of `this.dialog.showModal()`
   and re-run `pnpm --filter @waitron/ui test wt-dialog`. Expected: FAIL — "opens as a modal (top
   layer, not just visible)" fails (`dialog.matches(':modal')` is `false`), while "is closed by
   default", "opens when the open property is set" and "renders the heading" all still pass. This
   is what distinguishes the new test from the pre-existing "opens when the open property is set"
   test, which cannot tell `show()` from `showModal()`. Restore `showModal()`.
2. Temporarily remove the `dispatchEvent(new CustomEvent("wt-close", ...))` call from `onClose()`
   and re-run. Expected: FAIL / time out — "emits wt-close when the native dialog closes" never
   resolves its awaited promise. Restore the dispatch call.

Confirm all 42 tests pass again after restoring both.

- [ ] **Step 7: Verify the empty-footer test actually has teeth**

Temporarily move `padding: var(--wt-space-3) var(--wt-space-5);` and
`border-top: 1px solid var(--wt-color-border);` back onto the plain `.footer` rule (so they apply
unconditionally again, instead of only on `.footer.has-content`) and re-run
`pnpm --filter @waitron/ui test wt-dialog`. Expected: FAIL — "does not render a footer bar when no
footer content is provided" fails; the footer measures a 25px-tall bar with a 1px top border even
with nothing slotted into it. Restore the `.footer.has-content` version and confirm all tests pass
again.

- [ ] **Step 8: Verify the token-consumption tests actually have teeth**

Temporarily change `dialog::backdrop { background: var(--wt-color-scrim); }` back to
`background: rgb(0 0 0 / 0.4);` — the literal value this component originally shipped with before
commit `7cb39c5` introduced the `--wt-color-scrim` token — and re-run
`pnpm --filter @waitron/ui test wt-dialog`. Expected: FAIL — "backdrop paints from the scrim
token" fails (`rgba(0, 0, 0, 0.4)` instead of the overridden colour). This is the exact regression
nothing before this task's tests could catch. Restore `var(--wt-color-scrim)`. Optionally repeat
the same mutate/restore cycle for the `border`, `background` and `box-shadow` declarations on the
`dialog` rule against their respective tests, to confirm each one independently has teeth. Confirm
all 42 tests pass again.

- [ ] **Step 9: Commit**

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
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-switch.js";

afterEach(cleanup);

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
  // Dispatch a synthetic composed change event rather than input.click(): a
  // checkbox's native `change` event from real user activation is
  // composed: false by spec, so it can never cross the shadow boundary at
  // all, with or without stopPropagation() — that would make this
  // assertion pass unconditionally regardless of whether the component
  // guards against leaking. Constructing the event with composed: true
  // explicitly forces the code path this test actually exists to check,
  // matching the pattern wt-input's own (sound) leak test already uses.
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

  expect(native).toBe(0);
});

test("clicking the visible label toggles the switch", async () => {
  const el = (await mount('<wt-switch label="Modo formación"></wt-switch>')) as HTMLElement & {
    checked: boolean;
  };
  const label = el.shadowRoot!.querySelector("label")!;
  label.click();
  expect(el.checked).toBe(true);
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

The "clicking the visible label toggles the switch" test guards against a real defect an earlier
draft of this component shipped with: `label { cursor: pointer; }` made the label *look*
clickable, but with no `for`/`id` association, clicking it did nothing — confirmed against that
code, `label.click()` left `checked === false`. The switch already carries `aria-label` on the
input, so screen readers were never affected; this was a usability miss (a visibly-tappable target
that silently does nothing is exactly the kind of miss-tap staff will hit on a POS screen under
pressure), not an accessibility blindness. The fix (below) is the same unique-per-instance
`for`/`id` wiring used for `wt-input` in Task 8.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui test wt-switch`
Expected: FAIL — cannot resolve `./wt-switch.js`.

- [ ] **Step 3: Write the component**

`packages/ui/src/components/wt-switch.ts`:

```ts
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

let instanceCount = 0;

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

  // Unique per instance so a page with multiple wt-switch elements never
  // collides label `for`/input `id` pairs.
  private readonly inputId = `wt-switch-${++instanceCount}`;

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
          id=${this.inputId}
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
      ${this.label ? html`<label for=${this.inputId}>${this.label}</label>` : nothing}
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
Expected: PASS, 49 tests.

- [ ] **Step 6: Verify the leak test actually has teeth**

Temporarily remove `event.stopPropagation();` from `onChange` in `wt-switch.ts` and re-run
`pnpm --filter @waitron/ui test wt-switch`. Expected: FAIL — "does not leak the native change
event outside the component" fails (`native` becomes 1). This is the check the original version
of this test could never produce, because `input.click()`'s resulting `change` event is not
`composed` and cannot cross the shadow boundary regardless of `stopPropagation()` — see the
comment in the test above. Restore `stopPropagation()` and confirm all 49 tests pass again.

- [ ] **Step 7: Verify the label-click test actually has teeth**

Temporarily remove the `for=${this.inputId}` attribute from the label in `render()` (leave the
input's own `id` in place) and re-run `pnpm --filter @waitron/ui test wt-switch`. Expected: FAIL —
"clicking the visible label toggles the switch" fails (`el.checked` stays `false`). Restore the
`for` attribute and confirm all tests pass again.

- [ ] **Step 8: Commit**

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
  test(`${name} declares no literal colours`, () => {
    const css = cssOf(ctor.styles);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
    // Catches keyword colours too, narrowly, without flagging
    // transparent/currentColor/inherit (which are legitimate escape hatches,
    // not hardcoded chrome).
    expect(css).not.toMatch(
      /\b(red|blue|green|yellow|black|white|gray|grey|orange|purple|pink|brown)\b/i,
    );
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

The original draft of `declares no literal hex colours` only matched `/#[0-9a-fA-F]{3,8}\b/`,
which misses `rgb()`, `hsl()` and named colours entirely — and this was not theoretical: Task 9's
own reference implementation shipped `dialog::backdrop { background: rgb(0 0 0 / 0.4); }`, which
the hex-only regex let straight through undetected. The widened version above is what Task 9 was
written against (its backdrop now reads `var(--wt-color-scrim)` instead) — do not reintroduce the
narrower check.

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @waitron/ui test no-hardcoded-chrome`
Expected: PASS, 12 tests. If any fail, replace the offending literal in that component with a token — do not relax the test.

- [ ] **Step 3: Verify the widened guard actually has teeth**

Temporarily reintroduce the historical violation: in `wt-dialog.ts`, change
`background: var(--wt-color-scrim);` back to `background: rgb(0 0 0 / 0.4);` in the
`dialog::backdrop` rule, then re-run `pnpm --filter @waitron/ui test no-hardcoded-chrome`.
Expected: FAIL — "WtDialog declares no literal colours" now fails. This is the exact regression
the narrower hex-only check missed; confirming it fails here is the proof the widened guard would
actually have caught it. Restore `var(--wt-color-scrim)` and confirm all 12 tests pass again.

- [ ] **Step 4: Commit**

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
- Test: `packages/ui/src/tokens/multi-root.test.ts`

**Interfaces:**
- Consumes: all primitives and `applyTokens`.
- Produces: `pnpm --filter @waitron/ui dev` serving a page showing every primitive in both themes;
  an automated regression test pinning down the concurrent multi-root theming the workbench
  demonstrates manually.

- [ ] **Step 1: Add an automated regression test for concurrent multi-root theming**

The rest of this task demonstrates, manually, that two theme roots on one page can render
different themes at the same time ("Both panels must look correct simultaneously" in Step 4
below, and the same claim in Task 14's documentation). Nothing before this pinned that down with
a real assertion: `tokens/colors.test.ts` (Task 2) mounts one theme at a time and `.remove()`s the
first host before mounting the second, so it never proves two roots are live simultaneously. A
future refactor of `applyTokens` — e.g. caching a "current theme" flag instead of relying on pure
CSS-selector matching per element — could silently break multi-root support and nothing would
catch it.

This test targets `applyTokens`, which Task 2 already implemented and committed — there is no new
implementation to write, so there is no red step in the usual TDD sense. Per the Global Constraint
on observing new tests fail individually: since no red state is possible here, the equivalent
proof is running it once against the real, already-existing implementation and confirming it
passes — that pass is itself the evidence the current code supports two live theme roots. If it
fails, that is a real regression in the token layer and must be fixed there, not worked around
here.

`packages/ui/src/tokens/multi-root.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { applyTokens } from "./index.js";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

test("two theme roots render different themes simultaneously", () => {
  const a = document.createElement("div");
  a.setAttribute("data-theme", "light");
  document.body.appendChild(a);
  mounted.push(a);
  applyTokens(a);

  const b = document.createElement("div");
  b.setAttribute("data-theme", "dark");
  document.body.appendChild(b);
  mounted.push(b);
  applyTokens(b);

  // Both `a` and `b` stay mounted at once here — unlike tokens/colors.test.ts,
  // which removes the first host before mounting the second and so never
  // exercises two simultaneously live theme roots.
  expect(getComputedStyle(a).getPropertyValue("--wt-color-bg").trim()).toBe("#f7f7f8");
  expect(getComputedStyle(b).getPropertyValue("--wt-color-bg").trim()).toBe("#101216");
});
```

Run: `pnpm --filter @waitron/ui test multi-root`
Expected: PASS, 1 test — immediately, since `applyTokens` (Task 2) already supports this.

- [ ] **Step 2: Create the Vite config**

`packages/ui/vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5180 },
});
```

- [ ] **Step 3: Create the demo page**

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

- [ ] **Step 4: Add the dev script**

Add to `packages/ui/package.json` scripts:

```json
"dev": "vite"
```

And add `"vite": "^6.0.0"` to its `devDependencies`.

- [ ] **Step 5: Verify it runs**

Run:

```bash
pnpm install
pnpm --filter @waitron/ui dev
```

Open `http://localhost:5180`. Expected: light and dark panels side by side, every primitive visible, dialog opens. Both panels must look correct simultaneously — that is the proof the token layer works per-subtree rather than globally, and now also the manual counterpart to the automated "two theme roots render different themes simultaneously" test from Step 1.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/index.html packages/ui/demo packages/ui/vite.config.ts packages/ui/package.json packages/ui/src/tokens/multi-root.test.ts pnpm-lock.yaml
git commit -m "feat(ui): add kitchen-sink workbench for both themes, with a multi-root regression test"
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

      - run: pnpm --filter @waitron/ui exec playwright install --with-deps chromium

      - run: pnpm typecheck

      - run: pnpm test
```

Note: `--with-deps` is required on CI runners to install Chromium's system libraries. Without it the browser provider fails at launch.

**Correction found while implementing Task 13 (carried from the Task 1 progress notes):** plain
`pnpm exec playwright install ...` at the repo root fails with `Command "playwright" not found` —
root-level `pnpm exec` does not resolve a bin scoped to a workspace member (`playwright` is a
devDependency of `@waitron/ui`, not of the root package). It must either run from `packages/ui`
or, as shown above, be scoped with `pnpm --filter @waitron/ui exec ...` from the root. Verified
locally both ways before committing the workflow above (which uses the `--filter` form so no
`working-directory:` override is needed), and again by watching the workflow go green on a real
PR run.

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

Run: `gh run watch <run-id>` (the run id is required non-interactively; `gh run list --branch
<branch>` finds it).
Expected: the run completes successfully. If Chromium fails to launch, confirm `--with-deps` is
present.

**Correction found while implementing Task 13:** the workflow's trigger is `push: branches:
[main]` plus `pull_request` — pushing the feature branch itself does not start a run, since it
isn't `main` and a bare push isn't a `pull_request` event. Opened a PR against `main` to get a
`pull_request`-triggered run; that run went green (`pnpm install --frozen-lockfile` →
`pnpm --filter @waitron/ui exec playwright install --with-deps chromium` → `pnpm typecheck` →
`pnpm test`, all steps passing).

---

### Task 14: Design system documentation

**Files:**
- Create: `docs/developers/design-system.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the contract document that later sub-projects follow. Per project convention, its presence is what marks this repo as having a design system.

- [ ] **Step 1: Write the document**

`docs/developers/design-system.md`:

**Corrections found while implementing Task 14:** several things below changed during Tasks 5–11
and the original template here (copied verbatim into the brief) never caught up. The block below
is the actual, final content of `docs/developers/design-system.md`, verified line-by-line against
the shipped source rather than against the plan as originally written:

- `wt-input` and `wt-switch`'s label association was unspecified in the original template; both
  now use a real `for`/`id` pair (fixed for accessibility in commit `bdd9a1d`), and `wt-switch`
  additionally sets `aria-label` because it repurposes `role="switch"` on a checkbox.
- `wt-card` and `wt-dialog` suppress header/footer spacing when those slots are empty (fixed in
  `74ba885`) — worth documenting since it's the kind of thing a new primitive should copy.
- The properties/events table was accurate but incomplete: it didn't note which properties reflect
  to attributes, and `wt-icon`'s unregistered-name behaviour wasn't documented anywhere.
- Added a "Testing" section documenting the shared `mount`/`host`/`cleanup` helper API
  (`packages/ui/src/test-helpers.ts`), which every component test imports and which the "paints
  from a token" rule below depends on concretely (`host.style.setProperty(...)`).

````markdown
# Design system

Every screen in this project is built from `wt-*` primitives styled by `--wt-*` tokens.
This document is the contract. If you are building a view, read this first.

## The rule

**No hardcoded chrome.** No hex colours, no `rgb()`/`hsl()` colours, no named colours (`red`,
`blue`, …), no font sizes, no radii, and no px spacing above `1` in any component or view. Every
such value reads a token instead. `transparent`, `currentColor`, and `inherit` are legitimate
escape hatches, not chrome. This is enforced by `packages/ui/src/no-hardcoded-chrome.test.ts`,
which scans every primitive's `static styles` and fails the build on violations.

If a token you need does not exist, add it to the token layer — do not inline a value.

## Setting up a theme root

```ts
import { applyTokens } from "@waitron/ui";

applyTokens(document.querySelector("#app")!);
```

`applyTokens(root)` marks `root` with `data-wt-theme-root` and adopts the token stylesheet (a
single cached `CSSStyleSheet`, shared across every call) onto `root`'s document — or its shadow
root, if `root` lives inside one — via `adoptedStyleSheets`. The token CSS itself is written
entirely in attribute selectors (`:where([data-wt-theme-root])`,
`[data-wt-theme-root][data-theme="light"]`, etc.), so what a given theme root resolves depends only
on its own attributes. That means two elements on the same page can both be theme roots — one
`data-theme="light"`, one `data-theme="dark"` — and each resolves `--wt-*` independently and
simultaneously. That's what the workbench demonstrates, and what
`packages/ui/src/tokens/multi-root.test.ts` pins down with an assertion: two roots mounted at once,
each still reporting its own resolved `--wt-color-bg`.

## Themes

Light and dark ship by default. Selection order:

1. `prefers-color-scheme` — the default, read from the OS/browser.
2. `data-theme="light" | "dark"` on the theme root — always wins, in both directions. (The
   `data-theme` rules use plain attribute selectors; the `prefers-color-scheme` rule is wrapped in
   `:where(...)`, which contributes zero specificity — so an explicit `data-theme` wins the cascade
   regardless of which way the OS preference points.)

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
`--wt-color-on-danger`, `--wt-color-success`, `--wt-color-border`, `--wt-color-focus`,
`--wt-color-scrim`

Colours are semantic, not literal. There is no `--wt-color-blue`. `--wt-color-scrim` was added
after the rest of the palette to back `wt-dialog`'s `::backdrop` — if you need a similar
overlay/veil colour elsewhere, reuse it rather than inventing a new one.

### Structure

`--wt-space-1` … `--wt-space-6` (4–32px), `--wt-radius-sm|md|lg`, `--wt-font-family`,
`--wt-font-size-sm|md|lg|xl`, `--wt-font-weight-normal|bold`, `--wt-shadow-1|2`,
`--wt-focus-ring`, `--wt-focus-offset`

### `--wt-tap-min`

Minimum interactive target, 44px. POS screens are touched under time pressure by staff who are
not looking carefully. Every interactive primitive respects this.

## Primitives

| Element | Properties | Events |
| --- | --- | --- |
| `wt-button` | `variant` (`primary`\|`secondary`\|`danger`\|`ghost`), `size` (`sm`\|`md`\|`lg`), `disabled`, `type` (`button`\|`submit`) | native `click` |
| `wt-icon` | `name`, `size` (`sm`\|`md`\|`lg`) | — |
| `wt-card` | `raised`; default slot (body), `header` slot | — |
| `wt-input` | `value`, `label`, `type`, `placeholder`, `disabled`, `invalid` | `wt-change` — `detail: { value: string }` |
| `wt-switch` | `checked`, `disabled`, `label` | `wt-change` — `detail: { checked: boolean }` |
| `wt-dialog` | `open`, `heading`; default slot (body), `footer` slot | `wt-close` |

Variant- and state-like properties (`variant`, `size`, `name`, `raised`, `disabled`, `checked`,
`invalid`, `open`) all reflect to attributes, which is what makes `:host([variant="..."])`-style
styling possible — see "Adding a primitive" below.

Icons are registered by the consuming app, so `packages/ui` depends on no icon library:

```ts
import { registerIcons } from "@waitron/ui";
registerIcons({ check: "M2 8 L6 12 L14 4" });
```

An unregistered `name` renders nothing — there is no broken-icon fallback markup.

### Accessible, clickable labels (`wt-input`, `wt-switch`)

Both associate their visible `<label>` with the native control through a real `for`/`id` pair —
not by wrapping the control inside the `<label>` — so the existing layout and font sizing stay
untouched. The `id` comes from a module-level counter (`wt-input-N` / `wt-switch-N`), so multiple
instances on one page never collide.

- `wt-input`: `<label for="wt-input-N">` + `<input id="wt-input-N">`. The label supplies the
  input's accessible name purely through that native association.
- `wt-switch`: the same `for`/`id` pairing is what makes clicking the visible label text toggle the
  switch. Because the control also carries `role="switch"` (re-purposing a native checkbox), its
  `<input>` *additionally* sets `aria-label` directly from the `label` property, so the accessible
  name doesn't depend on how a given screen reader resolves a `for`/`id` pair against a
  non-default role.

This is a fix, not the original shape: both primitives used to render `<label>` and the control as
unconnected siblings — no `for`/`id`, no `aria-label` — which left every `wt-input` silent to a
screen reader and made `wt-switch`'s visibly pointer-cursored label inert on click. If you add a
labelled primitive, follow this pattern, not the unconnected-siblings one.

### Empty slots don't reserve space

`wt-card`'s `header` slot and `wt-dialog`'s `footer` slot only add their spacing/divider when
something is actually projected into them — an unused slot must not leave a spurious gap or a bare
bar in the layout. The two primitives get there differently:

- `wt-card` does it in pure CSS: the header's `margin-bottom` lives on `.header ::slotted(*)`, so
  it only applies when there is slotted content for that selector to match.
- `wt-dialog` does it imperatively: `updateHasFooter()` reads `assignedNodes({ flatten: true })`
  off the footer slot — once on first render, again on every `slotchange` — and toggles a
  `.has-content` class that the footer's padding and top border are conditioned on.

If you build a primitive with an optional slot that carries its own spacing, use one of these two
patterns rather than reserving space unconditionally.

## Event discipline

Custom events crossing a shadow boundary are `composed: true`, so a native event re-emitted
without care fires twice. **Always `stopPropagation()` the native event before dispatching your
own.** `wt-input` and `wt-switch` are the reference implementations.

Custom events are named `wt-*` and carry data in `detail`.

## Testing

Component tests run in real Chromium via `@vitest/browser` + Playwright, not jsdom — the things
being asserted (computed styles, `adoptedStyleSheets`, shadow-DOM event composition) don't exist
in a DOM simulator. Shared test helpers live in `packages/ui/src/test-helpers.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-button.js";

afterEach(cleanup);

test("paints from the primary token", async () => {
  const el = await mount('<wt-button variant="primary">Cobrar</wt-button>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  const button = el.shadowRoot!.querySelector("button")!;
  expect(getComputedStyle(button).backgroundColor).toBe("rgb(1, 2, 3)");
});
```

- `mount(html)` — creates a fresh `<div>`, appends it to `document.body`, calls `applyTokens` on it
  (making it its own theme root), sets `innerHTML` to `html`, awaits the mounted element's
  `updateComplete`, and returns that element (the markup's first child).
- `host` — a live binding to the wrapper `<div>` from the most recent `mount()` call. Set token
  overrides on it (`host.style.setProperty(...)`) to prove a component reads a token rather than
  hardcoding a value.
- `cleanup()` — removes every host mounted since the last call. Call it from `afterEach`.

## Adding a primitive

1. Write the test first, in a real browser. Include a test proving it paints from a token — set
   the token on the `host` (see Testing, above) and assert the computed style changes. A component
   that renders correctly but ignores tokens is not a primitive.
2. Extend `LitElement`, and put `baseStyles` first in `static styles`.
3. Reflect variant-like properties so they are styleable via `:host([variant="..."])`.
4. Add it to `no-hardcoded-chrome.test.ts` — this is what makes the guard's build-breaking
   coverage apply to it; an unlisted component is invisible to the guard no matter how it's
   written.
5. Add it to the workbench and to the table above.

## Workbench

```bash
pnpm --filter @waitron/ui dev
```

Serves `packages/ui/index.html` on `http://localhost:5180`, showing every primitive in light and
dark side by side, each panel driven by its own `applyTokens` call — the same two-roots-at-once
behaviour `multi-root.test.ts` asserts. Check both before committing.
````

- [ ] **Step 2: Commit**

```bash
git add docs/developers/design-system.md
git commit -m "docs: add design system contract"
```

---

## Post-Task-14 corrections: final pre-merge review (2026-07-18)

**The Task 14 fenced code block above is a historical snapshot, not the current contents of
`docs/developers/design-system.md`.** A final pre-merge review (empirical, in Chromium) found nine
blocking defects that shipped despite the "red before green, observed per test" discipline in
Global Constraints — every one of them is a case where the *file* containing a new test reported
failures, but the specific new/changed test itself was never individually confirmed red, so a
vacuous assertion passed unnoticed alongside its failing siblings. All nine were fixed as one
batch, each with its own test written first and confirmed to fail (`vitest run -t "<name>"`)
against the pre-fix code before the fix was applied — see the commits following Task 14's, and the
current `docs/developers/design-system.md`, which is the source of truth from here on. Do not
restore any of the following from the snapshot above:

1. **Retheming under `data-theme` silently failed.** `colors.css`'s two
   `[data-wt-theme-root][data-theme="light"|"dark"]` blocks used plain attribute selectors
   (specificity 0,2,0) while every other token rule was `:where()`-wrapped (specificity 0,0,0). A
   deployment override (`.brand { --wt-color-primary: purple }`, specificity 0,1,0) lost to those
   two blocks whenever `data-theme` was set — which is the shipped workbench's own configuration.
   Fix: wrap both blocks in `:where()` too, so `data-theme` still wins over `prefers-color-scheme`
   (now by source order, not specificity) while any deployment selector always wins over the whole
   token layer. The regression test for this (`structure.test.ts`, "deployment rules override the
   token layer's defaults even when data-theme is set") had to test a *colour* token, not a
   structural one — `structure.css` has no per-`data-theme` rules at all, so a structural-token
   override test can never observe this class of bug regardless of the CSS.
2. **`wt-switch`'s hit target overflowed its host and stole clicks** from anything stacked next to
   or below it: the native `<input>` had `position: absolute; inset: 0; height: 100%` plus its own
   `min-height: var(--wt-tap-min)`, stretching a 44px input inside an 18px host. Fix: `min-width`/
   `min-height: var(--wt-tap-min)` moved onto `:host` and `.control` (the input's actual containing
   block); the input itself now carries no min-size and just fills that box via `inset: 0`.
3. **`--wt-tap-min` was only enforced vertically.** `wt-button` and `wt-switch` both got
   `min-width: var(--wt-tap-min)` alongside their existing `min-height`; every tap-target test now
   asserts both axes. No existing layout expectation broke — `wt-button`'s `sm`/`lg` size variants
   only override `min-height`/padding/font-size, so they now also pick up the base rule's
   `min-width`, which no test constrained against.
4. **Icon-only buttons had no accessible name.** `wt-button` now has `@property({ attribute:
   "aria-label" }) override ariaLabel`, forwarded onto the inner `<button>` — the host's own
   `aria-label` attribute never reached it on its own.
5. **`wt-dialog` had no accessible name.** The `<h2>` now gets a unique id
   (`wt-dialog-heading-N`); the inner `<dialog>`'s `aria-labelledby` points at it when `heading` is
   set, falling back to a forwarded `aria-label` (same pattern as `wt-button`) when there is no
   heading.
6. **`wt-input`'s `invalid` was visual-only.** It now also sets `aria-invalid="true"|"false"` on
   the inner `<input>`, not just the red border.
7. **No focus delegation.** `wt-button`, `wt-input`, and `wt-switch` all now declare `static
   override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true }`, so
   `.focus()` on the host actually focuses the inner control — required constantly on a POS
   ("focus the quantity field").
8. **`wt-button`'s `type` property was documented but inert.** A shadow-DOM `<button
   type="submit">` is never form-associated: zero native submit events, and the enclosing
   `<form>`'s `.elements` never lists a `wt-input`/`wt-button` living in a shadow root. The `type`
   property is **removed** (not fixed — full form association via `ElementInternals` is out of
   scope); the properties table above and the "Primitives" table in
   `docs/developers/design-system.md` no longer list it. Forms are handled in JS via `wt-change`,
   documented in design-system.md's new "Forms" section.
9. **The chrome guard had blind spots and a manual registry.** It only matched `px`, so `rem`/`em`
   sizing (including inside `min()`/`max()`/`clamp()`) and modern colour functions
   (`oklch()`/`oklab()`/`lch()`/`lab()`/`hwb()`/`color-mix()`) passed through undetected — and
   `wt-dialog`'s `max-width: min(90vw, 32rem)` was a live, undetected violation. Fixes: widened the
   colour and sizing regexes; replaced the hand-maintained `{ WtButton, WtCard, ... }` object with
   `import.meta.glob(["./components/*.ts", "!./components/*.test.ts"], { eager: true })` so a new
   primitive is covered the moment its file exists (the negative pattern is load-bearing — without
   it, eagerly importing a sibling `*.test.ts` file re-executes its top-level `test(...)` calls
   into this file's run, which inflated the suite from 12 to 60 tests when first tried); added
   `--wt-dialog-max-width: min(90vw, 32rem)` to `structure.css` and pointed `wt-dialog.ts` at it.

`pnpm test` now passes **72 tests** (up from 62; net +10 — the existing height-only tap-target
tests on `wt-button`/`wt-switch` were extended in place to also assert width, so they are not
counted as new):

- `structure.test.ts`: +1 (the data-theme colour-override regression test).
- `wt-switch.test.ts`: +2 (hit-target-does-not-overflow-the-host test, focus-delegation test).
- `wt-button.test.ts`: +3 (type-not-forwarded regression test, aria-label-forwarding test,
  focus-delegation test).
- `wt-dialog.test.ts`: +2 (heading→aria-labelledby test, fallback-aria-label test).
- `wt-input.test.ts`: +2 (aria-invalid test, focus-delegation test).
- `--wt-dialog-max-width` added an assertion to the *existing* "defines the structural contract"
  test rather than a new test, so it isn't in the +10.

---

## Definition of done

- [ ] `pnpm install` succeeds from a clean checkout.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes — **72 tests**, all in real Chromium. (61 after Task 11, 62 after Task
  12's `multi-root.test.ts`, Tasks 13–14 added none, 72 after the post-Task-14 pre-merge-review
  fixes above.)
- [ ] `pnpm --filter @waitron/ui dev` shows both themes rendering correctly side by side.
  (Confirmed with a headless Playwright drive of the served page: both panels report their own
  `--wt-color-bg`, every primitive is present, the dialog opens on click, no console errors.)
- [ ] CI is green on `main`. The workflow triggers on `push: branches: [main]` and on
  `pull_request` — not on a push to a feature branch — so this was confirmed via a `pull_request`
  run against this branch's PR, which went green end-to-end. It will run again, against `main`
  itself, once the PR merges.
- [ ] `docs/developers/design-system.md` exists and matches what was built — this is a living
  document; treat it, not the Task 14 snapshot earlier in this file, as the source of truth.
- [ ] No primitive contains a literal colour or a spacing value above 1px, or any `rem`/`em` sizing
  at all.
