# A681 — a Light / Dark / Follow device theme choice in the apps: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard, the till and setup each get a Theme choice (Light, Dark, Follow device —
the default). The choice is saved in that browser, so it belongs to the device, not the person and
not the venue's database, and every screen and the dashboard's logo follow it.

**Architecture:** One small module in `@waitron/ui` (`packages/ui/src/theme-choice.ts`) owns the
saved choice: it reads and writes one `localStorage` key and sets or removes `data-theme` on the
page's theme root (`document.documentElement`). Each app's `main.ts` applies the saved choice on
the line after `applyTokens`, before anything renders. A new `wt-theme-chooser` primitive draws an
icon trigger and a menu of three `menuitemradio` options; it never applies anything itself, it sends
`wt-theme-selected`, and each app's root element saves and applies it through a Lit controller from
the same module. The menu mechanics (`popover` placement, outside press, Escape, arrow keys) move out
of `wt-language-chooser` into one shared helper both choosers use. On the signed-in dashboard, where
the banner has no room for another button, the choice lives in the account menu instead.

**Tech Stack:** TypeScript, Lit 3, Vitest 4.1.11 in browser mode (real headless Chromium through
Playwright) for `packages/ui`, `apps/dashboard`, `apps/setup` and `apps/till`.

**Spec:** the A681 entries in `docs/backlog.md` (top list item 7 and the entry under "Users, sign-in
and the dashboard shell") and `docs/backlog/dashboard.md` → "A681", quoted below because Task 8
deletes them, plus the design decisions in this header. Review path: LIGHT (no risk trigger: no
fiscal code, no database, no migration, no server change, no auth). The plan-vs-spec read and the
Codex run-it seat in `/finish-branch` still run.

### The item (owner, 2026-10-14), verbatim

> Today every screen follows the device's own light or dark setting: the token layer honours a
> `data-theme` attribute (`packages/ui-core/src/tokens/colors.css`), but outside tests and the UI
> demo nothing in the product sets it. So staff on a locked-down till or a kiosk tablet cannot
> change it. Add a Theme choice with three options (Light, Dark, Follow device, the default) to the
> dashboard, the till and setup. It is saved in that browser on that device, not in the venue's
> database. Open: one choice per device, or one per person on a shared till (suggested: per
> device).

Owner answer, 2026-10-16: **one choice per device.** Owner standing rule: product text as short as
the meaning allows.

### Decisions (state these in the PR description)

1. **Placement.** A new primitive `wt-theme-chooser` sits **immediately before** (on the leading
   side of) `wt-language-chooser` in these places, found with
   `grep -rln wt-language-chooser apps packages --include='*.ts'` on e52c997c0:
   - the dashboard banner **while nobody is signed in** — `apps/dashboard/src/dashboard-app.ts:1719`
     (signed in, see decision 1a);
   - setup's card header — `apps/setup/src/setup-app.ts:1481`;
   - the till shell bar, and its kitchen-display / kiosk corner — `apps/till/src/widgets/till-shell.ts:504-509`
     (`#chooser()`, rendered at `:721` and `:767`);
     **Changed 2026-10-17 after Task 9's look:** the bar's chooser cut the "Sala" tab at 360 px, so a
     signed-in till holds Theme in the person's menu instead, as decision 1a does for the dashboard;
     the kitchen-display corner keeps the chooser;
   - the till sign-in screen — `apps/till/src/screens/till-lock-screen.ts:311`;
   - the till join screen — `apps/till/src/screens/till-enrol-screen.ts:188`;
   - the UI workbench — `packages/ui/demo/main.ts:273` (not product UI; design-system.md →
     "Adding a primitive" step 7 asks for it).

   **Not** added to the till counter screen's own header (`till-counter-screen.ts:461`): the till
   only ever mounts that screen `embedded` (`apps/till/src/till-app.ts:12636-12637`), and an
   embedded counter screen draws no header of its own, so its language chooser is never on screen in
   the product; the shell's bar carries both choosers above it. Consistency does not need it.

   "Before", not "after", so every existing check that the language chooser is at the trailing
   edge, or just before the operator's name, still holds (`apps/setup/src/setup-app.test.ts:2700-2727`,
   `apps/till/src/widgets/till-shell.test.ts:258-277`).

   The trigger is a `wt-button variant="secondary"` (the language chooser's trigger,
   `packages/ui/src/components/wt-language-chooser.ts:298-306`, so the two read as a pair) holding
   one `wt-icon size="lg"` for the current choice, named by `aria-label` "Theme: Dark" (the label,
   a colon, the choice). No tooltip, like the dashboard banner's other icon buttons. Focus handling
   follows the language chooser: no `delegatesFocus` of its own; the trigger is a `wt-button`, which
   delegates focus to its inner `<button>` (`packages/ui-core/src/components/wt-button.ts:17`).
   No suitable icons exist (a grep for sun, moon, contrast or theme icons in `apps/*/src` and
   `packages/*/src` found none), so the component registers three drawings of its own at module
   load, the way `wt-data-table` does (`packages/ui/src/components/wt-data-table.ts:22`):
   `theme-light` (a sun), `theme-dark` (a crescent), `theme-device` (a half-filled circle). They
   are drawn for this change, not copied from an icon set, so no licence notice is owed.

   **1a. Signed-in dashboard: Theme lives in the account menu, at every width (driver's decision,
   2026-10-17, owner away).** The banner has no room for a second button beside the alerts bell
   and the account menu at phone width: the plan review measured a 52 px stand-in in the signed-in
   banner and the lockup fell to 15 px at 360 px and 45 px at 390 px, failing
   `apps/dashboard/src/dashboard-app.test.ts:5584`'s 60 px floor in all 8 cases, with the Spanish
   text wrapping. So, signed in, the account menu (`wt-row-actions`, `dashboard-app.ts:1747-1768`)
   gains a "Theme" group of three choices with the current one marked, between Account settings and
   Log out — not width-dependent, so the banner's signed-in item lists and every signed-in banner-fit
   test stay exactly as they are.

   What `wt-row-actions` supports (`packages/ui/src/components/wt-row-actions.ts`): an icon trigger
   with `aria-label` and `aria-expanded`; a native auto `popover` holding slotted content in a
   column; light dismiss; Escape closes it and returns focus to the trigger (`:185-192`); a click on
   a slotted `button`, `a[href]` or `wt-button` closes it unless that element is inside
   `[data-keep-open]` (`:147-164`). It sets no `menu` role and moves focus with no arrow keys, so
   menu or radio roles inside it would promise keys it does not have. The group is therefore a
   `<div role="group" aria-labelledby=…>` with a visible "Theme" label and three native
   `<button type="button" aria-pressed>` toggle buttons (Light, Dark, Follow device), each with its
   `theme-*` icon; the current one is `aria-pressed="true"` and drawn with the border the language
   chooser uses for its checked option. Tab moves through them as through the menu's other actions;
   a pick closes the menu like any other action. Native buttons, because `wt-button` forwards no
   `aria-pressed` (`wt-button.ts:140-144`) and changing it means changing `@waitron/ui-core`; the
   buttons are styled in `dashboard-app.ts` from tokens to match the menu's ghost `wt-button`s. (A
   native button is not one of the field elements `scripts/native-form-fields.test.ts` holds back.)
   **Changed 2026-10-17 after the re-look:** the group is one row — the visible label, then three
   icon-only `aria-pressed` buttons, the pressed one filled with `--wt-color-primary` — shared as
   `themeChoices` in `packages/ui/src/theme-choices.ts`; on the till it sits after Log out. See
   design-system.md → Dashboard banner.

   **Signed out, the banner has room — measured, not estimated.** On 2026-10-17, in this worktree on
   e52c997c0, a scratch browser test (deleted after; never committed) mounted `dashboard-app` signed
   out (`getMe` refusing with `management_session.required`), gave the host the 24 px padding the
   banner-fit tests use, and inserted a `wt-button variant="secondary"` holding a
   `wt-icon size="lg"` — the planned trigger, 52 px wide — before the language chooser. Across
   intents `prepare` and `live`, `en-GB` and `es-ES`, and widths 320, 360 and 390 px (24 runs, with
   and without the stand-in): the lockup stayed at its full 128 px in every case, the banner's
   `scrollWidth` equalled its `clientWidth` (272 / 312 / 342), and the stand-in's and the language
   trigger's tops equalled each other on the lockup's row. What a failure would have printed: a
   lockup narrower than 128 px, or a `scrollWidth` above `clientWidth`. Spare room by subtraction:
   about 3 px at 320, 43 at 360, 73 at 390. Task 4b pins this with its own fit test.

   **Shared menu mechanics: yes, through a helper.** The menu code moves out of
   `wt-language-chooser` into `packages/ui/src/menu-popover.ts`, on the condition that
   `wt-language-chooser.test.ts` and `wt-language-chooser.a11y.test.ts` stay byte-identical and
   pass before and after with the same count — 62 tests in 2 files, measured 2026-10-17 on
   e52c997c0 (Task 2 checks both). Why: the alternative is a second copy of about 120 lines
   (placement, scroll and resize following, outside press, Escape, arrow keys) that would need its
   own copy of the language chooser's ~30 placement, keyboard and dismissal tests to hold
   `packages/ui`'s mutation floor of 90. With the helper those tests already exercise the shared
   code, and the theme chooser's tests cover only its wiring. Backlog item A781
   (`docs/backlog.md:3548-3552`) asks for this kind of helper across the pop-up `wt-*` fields; this
   change does not take A781 on, and Task 8 only notes there that the language chooser now uses
   `menu-popover.ts`. **Fallback:** if Task 2 cannot keep both language-chooser test files unedited
   and green, revert Task 2's changes, and Task 3 builds the theme chooser with its own copy of the
   mechanics plus the tests listed in Task 3's fallback note. Record which path was taken in the
   ledger and the PR.

2. **Storage and application.** Home: `@waitron/ui`, as `packages/ui/src/theme-choice.ts`. Not
   `@waitron/ui-core`: that package is private too, but it is built into a tarball for another
   repository and checked by `pnpm --filter @waitron/ui-core test:package`, and its stated boundary
   is account-form controls plus tokens, with "Venue controls … stay in `packages/ui`"
   (`docs/developers/design-system.md:8-12`). A product storage key and a top-bar control are this
   repository's venue concerns. `@waitron/ui` is also what every app's `main.ts` already imports
   `applyTokens` from. One key, `waitron-theme` (the dashboard's spelling,
   `apps/dashboard/src/dashboard-app.ts:151`, `apps/dashboard/src/login-preference.ts:15`), holding
   `light` or `dark`; Follow device REMOVES the key, so "nothing saved" and "Follow device" are the
   same state. Light and Dark set `data-theme` on the theme root; Follow device removes it, and the
   `@media (prefers-color-scheme: dark)` block (`packages/ui-core/src/tokens/colors.css:124`) then
   applies. The attribute must be on the SAME element as `data-wt-theme-root`
   (`colors.css:242` and `:358` select `:where([data-wt-theme-root][data-theme=…])`), and every app
   makes `document.documentElement` that root (`apps/dashboard/src/main.ts:17`,
   `apps/setup/src/main.ts:6`, `apps/till/src/main.ts:16`). Blocked storage, a refused write and a
   garbage value all fall back to Follow device without throwing, in the
   `apps/dashboard/src/login-preference.ts` pattern (storage getter and each call in `try`). A pick
   whose save is refused still applies to the open page. Because `startThemeChoice` removes
   `data-theme` when nothing is saved, a screenshot script must save `waitron-theme` rather than set
   the attribute before `main.ts` runs (Task 8 updates the testing guide).

   **Same origin — read, not run.** An origin is scheme, host and port. On a box the till and the
   dashboard are served by one server on one port — the dashboard at `/manage`, the till at `/`
   (`apps/server/src/boot.ts:2280-2290`), through `startListening` on `config.httpPort`
   (`boot.ts:575-588`) with `resolveTradingTls` (`boot.ts:631-637`, `apps/server/src/trading-tls.ts:10-11`:
   the operator's TLS, else the box's minted leaf, else none). Setup mode serves setup at `/`
   (`apps/server/src/setup-api.ts:1410`) through the same `startListening` and port, but with its own
   TLS choice: the operator's, else the leaf `ensureBoxSecrets` just made (`boot.ts:954`,
   `:1223-1224`), so setup is always HTTPS. So the three share one origin on a box only when the
   trading listener also serves HTTPS (operator TLS, or the leaf setup minted being found by
   `mintedBoxLeaf`) and the browser uses the same host name. Not run on a box. Consequences, stated
   as limits in design-system.md (Task 8), not fixed: one box reached by two names (its IP address
   and `waitron.local`) keeps two choices; a trading listener without a leaf serves HTTP and keeps a
   separate choice from setup; in the dev stack the three apps are three Vite servers on three ports
   (5190 till, 5191 dashboard, 5192 setup — `docs/ui-review.md:11-13`), so in dev each app keeps its
   own choice. Task 9 sets the choice per port for that reason.

   **Other open tabs follow, through the `storage` event: included.** It is a few lines in the
   module and testable by dispatching a `StorageEvent` on `window` (Task 1).

3. **What reads the device's light or dark setting today, and must follow the choice instead.**
   Found with `grep -rn "prefers-color-scheme\|matchMedia\|color-scheme\|light-dark("` over the
   tree (excluding `node_modules`, `dist`, `docs`):
   - the dashboard banner's `<picture>` — `apps/dashboard/src/dashboard-app.ts:1701-1704`,
     `<source media="(prefers-color-scheme: dark)">`. **In scope** (Task 4a): the source's `media`
     becomes `all` for Dark, `not all` for Light and stays `(prefers-color-scheme: dark)` for Follow
     device, so Follow device still tracks the operating system with no script.
   - the dashboard's printable node recovery page — `apps/dashboard/src/screens/node-recovery-print.ts:30`,
     `:root { color-scheme: light dark }`. It copies its colours from the screen's tokens (which
     follow the choice) but lets the browser draw native parts (scrollbars) from the operating
     system. **In scope** (Task 4a): its first `:root` rule takes the `color-scheme` the source
     element resolves to. Its `@media print` rule (`:38`, `color-scheme: light`) stays.
   - setup's logo already follows the tokens (`apps/setup/src/setup-app.ts:457-465` paints the inlined
     lockup from `--wt-color-primary` and `--wt-color-text`): no change.
   - every other `matchMedia` in app and package code reads reduced motion, pointer, hover or a
     width (`till-shell.ts:313`, `till-counter-screen.ts:255`, `dashboard-app.ts:994`, …), not colour.
   - **Out of scope, listed as a backlog limit (Task 8):** the box's own server-rendered pages —
     the trust page (`apps/server/src/trust-page.ts:98-122`, `light-dark()` and
     `color-scheme: light dark`) and its logo (`apps/server/src/trust-page-logo.ts:12`); the
     favicon (`packages/ui/brand/public/favicon.svg`), which the browser draws from the operating
     system's setting.

4. **Text, English and Spanish, in each app's own string table** (all three use the same pattern:
   `en` is the source, `es: Record<StringKey, string>` — `apps/dashboard/src/i18n/strings.ts:1,2958`,
   `apps/till/src/i18n/strings.ts:4,1565`, `apps/setup/src/i18n/strings.ts:9,23`):
   | key (dashboard, till) | key (setup, in `strings/shell.ts`) | English | Spanish |
   | --- | --- | --- | --- |
   | `theme.label` | `shell.theme.label` | Theme | Tema |
   | `theme.light` | `shell.theme.light` | Light | Claro |
   | `theme.dark` | `shell.theme.dark` | Dark | Oscuro |
   | `theme.device` | `shell.theme.device` | Follow device | Según el dispositivo |

   "Según el dispositivo" matches the dashboard's existing "Según su rol" for "follows role"
   (`apps/dashboard/src/i18n/strings.ts:5258`). The dashboard's account-menu group uses the same
   four keys.

5. **LIGHT review path; no migration; no server change.**

**Points where the code differs from the brief this plan was first written from:** the dashboard's
printable recovery page is a second app-side reader of the operating system's setting (decision 3).
"All three apps are served from the same origin" holds on a box only under one host name and with
the trading listener on HTTPS, not in the dev stack (decision 2). The till shell also draws the
language chooser in a corner on a kitchen display and a kiosk (`till-shell.ts:719-721`). The till
counter screen's own header never shows in the product (decision 1). The signed-in dashboard banner
has no room for the button (decision 1a). Some existing app tests pin the exact contents of the till
bar and must change; each task lists them under "Changed test checks".

## Global Constraints

- Storage key `waitron-theme`; stored values `light` | `dark`; no key means Follow device.
- Event `wt-theme-selected`, `detail: { choice: "light" | "dark" | "device" }`, `bubbles: true,
  composed: true`; the option's own `click` is stopped before it is sent (CLAUDE.md §3).
- The trigger's accessible name is `${labels.theme}: ${labels[active]}` ("Theme: Follow device",
  "Tema: Oscuro"). Menu order: Light, Dark, Follow device.
- `data-test` hooks: `theme-trigger`, `theme-light`, `theme-dark`, `theme-device` inside the
  component; `theme-chooser` on each app's element; on the dashboard's account menu,
  `theme-choices` on the group and `theme-choice-light`, `theme-choice-dark`, `theme-choice-device`
  on its buttons.
- Every colour, spacing, radius and font reads a `--wt-*` token; no literal breakpoint in
  `packages/ui` (`packages/ui/src/no-hardcoded-chrome.test.ts`).
- No server, database, migration or fiscal change.
- **Coverage:** every package touched (`@waitron/ui`, `@waitron/dashboard`, `@waitron/setup`,
  `@waitron/till`) holds `98/98/98/95`, and CI's coverage and `-merge` jobs are the gate. No
  implementer task runs a package's whole `test:coverage`. A task that CREATES a source file checks
  that file's coverage from its own tests:
  `pnpm --filter <pkg> exec vitest run --coverage --coverage.include=<new file> <its test files>`,
  reading the per-file row. A task that only changes an existing file relies on its focused tests
  and on CI. `main.ts` is excluded from coverage in all three apps (`apps/*/vitest.config.ts`), so
  the line each app's task adds there is checked by Task 9's probe, not by a test.
- **Changed test checks.** Any task that changes an EXISTING test's assertion, selector, count or
  title lists it under a "Changed test checks" note — `file:line`, before → after, and why — and the
  implementer copies that list into its commit body for the PR. Adding a new test needs no note.
  An existing assertion is never removed or loosened.
- Every commit `git commit -s`, staging explicit paths only. One commit per task at least.
- Every implementer runs focused tests only (`pnpm --filter <pkg> exec vitest run <file>`), plus
  `pnpm format:check`, `pnpm --filter <pkg> typecheck` and `pnpm --filter <pkg> lint` for the
  packages it touched. Read the `Tests` count of every run; a run with no count proved nothing.
  These packages run real headless Chromium: check `memory_pressure | grep free` before running
  several at once.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly red point, commits, and returns a handover (done, left, files, each check's state).
- The lane keeps its ledger in `docs/handoffs/2026-10-17-a681-theme-choice.md`.

## Review Focus

1. **Storage the browser refuses** (Safari private browsing, storage blocked by policy): starting
   and picking never throw, the page still starts on Follow device, and a pick still changes the
   open page even though it cannot be saved. → Task 1, "reading blocked storage…" and "a save the
   browser refuses…".
2. **Two tabs of one browser** (dashboard in one, till in the other, on one box): a pick in one
   changes the other without a reload, and a cleared storage (`localStorage.clear()`, key `null`)
   returns the other to Follow device. → Task 1, "follows a choice made in another tab…".
3. **The operating system switches between light and dark while a page is open:** on Follow device
   the page and the dashboard logo follow at once; on Light or Dark nothing changes. → Task 4a,
   the three logo cases flip `emulateColorScheme` inside one test.
4. **Phone width (320, 360 and 390 px):** the signed-out dashboard banner, setup's header and the
   till bar still fit with nothing overlapping, the dashboard lockup at full width signed out; the
   signed-in banner is unchanged. → Task 4b's signed-out fit test (the existing signed-in fit tests
   untouched), Task 5's and Task 7's phone-width cases.
5. **A pick while the till has an unsent order open:** unlike a language change on the till
   (`apps/till/src/till-app.ts:13222-13225`, which asks before leaving unsaved work), a theme pick
   asks nothing and loses nothing. → Task 7, "picking a theme with an unsent order open…".

## File structure

| File | Responsibility |
| --- | --- |
| `packages/ui/src/theme-choice.ts` (new) | the saved choice: read, save, apply, notify, follow other tabs; `ThemeChoiceController` |
| `packages/ui/src/menu-popover.ts` (new) | the shared popover-menu mechanics and their CSS, moved from `wt-language-chooser` |
| `packages/ui/src/components/wt-language-chooser.ts` | uses `menu-popover.ts`; behaviour unchanged |
| `packages/ui/src/components/wt-theme-chooser.ts` (new) | the primitive and its three icons |
| `packages/ui/src/index.ts` | exports the new module and component |
| `packages/ui/demo/main.ts` | workbench entry |
| `apps/{dashboard,setup,till}/src/main.ts` | `startThemeChoice(document.documentElement)` on the line after `applyTokens` |
| `apps/dashboard/src/dashboard-app.ts` | logo `media` (4a); signed-out banner chooser, account-menu group, applies picks (4b) |
| `apps/dashboard/src/screens/node-recovery-print.ts` | `color-scheme` from the source (4a) |
| `apps/setup/src/setup-app.ts` | header placement, applies picks |
| `apps/till/src/widgets/theme-chooser.ts` (new) | `themeChooser()`: the till's one way to draw the chooser with its labels |
| `apps/till/src/till-app.ts` | applies picks |
| `apps/till/src/screens/till-{lock,enrol}-screen.ts`, `apps/till/src/widgets/till-shell.ts` | placement |
| `apps/till/src/widgets/language-chooser-styles.ts` | `.language-corner` spaces two choosers |
| string tables in each app | the four labels |

---

### Task 1: The saved theme choice (`packages/ui/src/theme-choice.ts`)

**Files:**
- Create: `packages/ui/src/theme-choice.ts`
- Create: `packages/ui/src/theme-choice.test.ts`
- Modify: `packages/ui/src/index.ts` (the export block holding `ContentLanguageController`, `:102-107`)

**Interfaces:**
- Produces (all exported from `@waitron/ui`):
  - `type ThemeChoice = "light" | "dark" | "device"`
  - `const THEME_CHOICES: readonly ThemeChoice[]` = `["light", "dark", "device"]` (menu order)
  - `const THEME_STORAGE_KEY = "waitron-theme"`
  - `const THEME_SELECTED_EVENT = "wt-theme-selected"`
  - `function isThemeChoice(value: unknown): value is ThemeChoice`
  - `function startThemeChoice(root: HTMLElement): void` — remembers `root` as the theme root, reads
    the saved choice, applies it, **notifies subscribers when the saved choice differs from the
    current one**, and installs ONE `window` `storage` listener however often it is called.
  - `function currentThemeChoice(): ThemeChoice`
  - `function chooseTheme(choice: ThemeChoice): void` — saves (Light/Dark write the word, Follow
    device removes the key; a refused write is swallowed), applies to the remembered root (or
    `document.documentElement` if `startThemeChoice` never ran), and notifies subscribers when the
    choice changed.
  - `function subscribeThemeChoice(listener: () => void): () => void`
  - `class ThemeChoiceController implements ReactiveController` —
    `constructor(host: ReactiveControllerHost & HTMLElement, options?: { applies?: boolean })`;
    `get choice(): ThemeChoice`. While its host is connected it requests a host update on every
    change; with `applies: true` it also listens on the host for `wt-theme-selected` and calls
    `chooseTheme(event.detail.choice)` when `isThemeChoice` accepts it. Both stop on disconnect.

- [ ] **Step 1: Write the failing tests** in `packages/ui/src/theme-choice.test.ts`. Each test
  makes a fresh `root` (`document.createElement("div")`, appended to `document.body`); `afterEach`
  restores mocks, calls `chooseTheme("device")`, removes `THEME_STORAGE_KEY` and removes `root`.
  Define two test-only `LitElement`s, `theme-choice-probe` (`#theme = new ThemeChoiceController(this)`)
  and `theme-choice-applying-probe` (`new ThemeChoiceController(this, { applies: true })`), each
  rendering `<span>${this.#theme.choice}</span>`; the `<span>` is what events are dispatched from.
  - `starts on Follow device with nothing saved, and leaves data-theme off` —
    `startThemeChoice(root)`; `currentThemeChoice()` is `"device"`; `root.hasAttribute("data-theme")` is `false`.
  - `it.each(["light", "dark"])("applies a saved %s choice to the root as it starts")` —
    `localStorage.setItem(THEME_STORAGE_KEY, choice)`; `startThemeChoice(root)`;
    `root.getAttribute("data-theme")` is `choice`; `currentThemeChoice()` is `choice`.
  - `starting tells subscribers when the saved choice differs, and only then` — subscribe first;
    with `"dark"` saved, `startThemeChoice(root)` calls the listener once; a second
    `startThemeChoice(root)` with `"dark"` still saved calls it no more; with nothing saved after
    `chooseTheme("device")` reset, `startThemeChoice(root)` does not call it.
  - `it.each(["Dark", "", "auto", "device", '{"theme":"dark"}'])("treats a saved %j as Follow device")`
    — no attribute, `"device"`.
  - `reading blocked storage falls back to Follow device without throwing` — run twice: once with
    `vi.spyOn(window, "localStorage", "get")` throwing `new DOMException("Denied", "SecurityError")`,
    once with `vi.spyOn(Storage.prototype, "getItem")` throwing the same; each time a saved `"dark"`
    is present, `expect(() => startThemeChoice(root)).not.toThrow()`, the choice is `"device"` and
    there is no attribute.
  - `it.each(["light", "dark"])("a choice of %s is saved under waitron-theme and applied at once")`
    — `localStorage.getItem("waitron-theme")` is `choice` (the literal key, so a renamed constant
    fails); `root.getAttribute("data-theme")` is `choice`.
  - `Follow device removes the saved value and the attribute` — after `chooseTheme("dark")`,
    `chooseTheme("device")`: `getItem` is `null`, no attribute.
  - `a save the browser refuses still changes the open page` — `Storage.prototype.setItem` and
    `removeItem` throw `new DOMException("Full", "QuotaExceededError")`; `chooseTheme("dark")` does
    not throw, `data-theme` is `"dark"`, `currentThemeChoice()` is `"dark"`; then
    `chooseTheme("device")` does not throw and removes the attribute.
  - `tells subscribers once per change, and nothing after they unsubscribe` — `chooseTheme("dark")`
    twice calls the listener once; after the returned unsubscribe, `chooseTheme("light")` calls it
    no more.
  - `follows a choice made in another tab of this browser` — after `startThemeChoice(root)` and a
    subscriber: `window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }))`
    → attribute `"dark"`, choice `"dark"`, subscriber called once; an event with `key: "other", newValue: "light"`
    changes nothing; an event with `key: null` (another tab cleared storage) → `"device"`, no
    attribute. None of these writes to storage (spy `Storage.prototype.setItem`: not called).
  - `starting twice still follows other tabs only once` — `startThemeChoice(root)` twice, one
    `storage` event → subscriber called once.
  - `a host with the controller redraws when the choice changes` — mount a probe, `chooseTheme("dark")`,
    `await probe.updateComplete`, its shadow text is `"dark"`.
  - `a host that applies picks saves and applies a wt-theme-selected sent from inside its shadow root`
    — `startThemeChoice(root)`, mount an applying probe, dispatch
    `new CustomEvent("wt-theme-selected", { detail: { choice: "light" }, bubbles: true, composed: true })`
    from the `<span>` in its shadow root → choice `"light"`, `root` attribute `"light"`, stored `"light"`.
  - `a host that does not apply picks leaves the choice alone` — same event on a non-applying probe → `"device"`.
  - `a wt-theme-selected naming no known choice changes nothing` — `detail: { choice: "sepia" }` and
    `detail: null` on an applying probe → `"device"`, nothing stored.
  - `once its host leaves the page it neither redraws nor applies picks` — remove an applying probe;
    spy its `requestUpdate`; `chooseTheme("dark")` → spy not called; the event dispatched on the
    removed probe leaves `"dark"` unchanged.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/ui exec vitest run src/theme-choice.test.ts`
  Expected: FAIL — the import `./theme-choice.js` does not resolve.

- [ ] **Step 3: Implement `packages/ui/src/theme-choice.ts`** with the interface above. Private
  `readSaved(): ThemeChoice` wraps both the `window.localStorage` access and `getItem` in one
  `try`, and accepts only `"light"` and `"dark"`. Private `apply(root, choice)` sets
  `data-theme` for Light/Dark and removes it for Follow device. The `storage` listener parses
  `event.newValue` with the same rule when `event.key === THEME_STORAGE_KEY`, treats `event.key === null`
  as Follow device, applies, notifies, and never writes. Export everything from `packages/ui/src/index.ts`.

- [ ] **Step 4: Run the tests to see them pass**

  Run: `pnpm --filter @waitron/ui exec vitest run src/theme-choice.test.ts`
  Expected: PASS, with the `Tests` count equal to the number of cases written.

- [ ] **Step 5: Prove the guards by deletion.** (a) Remove the `try`/`catch` from `readSaved` and
  re-run: "reading blocked storage…" must FAIL with `SecurityError: Denied` thrown out of
  `startThemeChoice`. (b) Make `readSaved` return any stored string unchecked: "treats a saved … as
  Follow device" must FAIL with `data-theme` `"Dark"`, `""` or `"auto"` present. (c) Remove the
  `try` around the write in `chooseTheme`: "a save the browser refuses…" must FAIL with
  `QuotaExceededError`. (d) Remove the notify from `startThemeChoice`: "starting tells subscribers…"
  must FAIL with the listener called 0 times. Restore each and re-run to PASS. Write the four
  outcomes in the commit message.

- [ ] **Step 6: Coverage of the new file, typecheck, lint, format, commit**

  Run: `pnpm --filter @waitron/ui exec vitest run --coverage --coverage.include=src/theme-choice.ts src/theme-choice.test.ts`
  (the `theme-choice.ts` row at or above 98/98/98/95), then
  `pnpm --filter @waitron/ui typecheck && pnpm --filter @waitron/ui lint && pnpm format:check`.
  ```bash
  git add packages/ui/src/theme-choice.ts packages/ui/src/theme-choice.test.ts packages/ui/src/index.ts
  git commit -s -m "Add the saved theme choice: one browser setting that sets or clears data-theme (A681)"
  ```

Changed test checks: none.

---

### Task 2: Move the language chooser's menu mechanics into a shared helper

**Files:**
- Create: `packages/ui/src/menu-popover.ts`
- Modify: `packages/ui/src/components/wt-language-chooser.ts`
- Test (must NOT change): `packages/ui/src/components/wt-language-chooser.test.ts`,
  `packages/ui/src/components/wt-language-chooser.a11y.test.ts`

**Interfaces:**
- Produces (internal to `packages/ui`, not exported from `index.ts`):
  - `const menuPopoverStyles: CSSResult` — the `.menu`, `.menu:popover-open`, `.option`,
    `.option:hover` and `.option[aria-checked="true"]` rules moved verbatim from
    `wt-language-chooser.ts:45-87`.
  - `class MenuPopover implements ReactiveController`, constructed in the host's field initialiser
    as `new MenuPopover(this, { trigger: () => HTMLElement, close: () => void })`:
    - `listen(): void` / `unlisten(): void` — the document `pointerdown` (capture) and `focusin`
      listeners, the `scroll` (capture) listeners on `window` and on every shadow root between the
      host and the document, and the `window` `resize` listener, exactly as
      `wt-language-chooser.ts:165-195` adds and removes them; each idempotent. An outside press or
      focus (`!event.composedPath().includes(host)`) calls `parts.close()`.
    - `hostUpdated(): void` — when the host's render root holds `[role="menu"]`: `showPopover()` if
      it is not open, then `place()` (moved from `updated()`, `:120-125`).
    - `place: () => void` — the placement at `:198-218`, unchanged.
    - `keydown(event: KeyboardEvent): void` — the body of `#onKeydown` (`:232-265`) after its "is it
      open" guard: Escape (honouring `defaultPrevented`, then `preventDefault`, `stopPropagation`,
      `parts.close()`, focus the trigger) and ArrowDown/ArrowUp (wrapping), Home, End among the
      render root's `[role="menuitemradio"]`.
    - `focusChecked(): void` — focuses the `aria-checked="true"` option, else the first (`:158-162`).
- The language chooser keeps its own state: `open`, `locales`, `#loading`, `#openWhenLoaded`,
  `#toggle`, `#load`, `#pick`, and the "is it open" guard in front of `keydown`. Its `#close()`
  resets its own state and calls `unlisten()`.

- [ ] **Step 1: Record the baseline.** Run:
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-language-chooser.test.ts src/components/wt-language-chooser.a11y.test.ts`
  Expected: PASS, `Test Files 2 passed (2)`, `Tests 62 passed (62)` (measured 2026-10-17 on
  e52c997c0). If the count differs, write the new count in the ledger before going on.

- [ ] **Step 2: Move the mechanics** into `packages/ui/src/menu-popover.ts` with the interface
  above, and make `wt-language-chooser.ts` use it (`static styles = [baseStyles, menuPopoverStyles, css`…its remaining rules…`]`).
  This is a move, not a rewrite: keep each listener's type, target and options as they are, because
  "listens on the document only while open…" and "listens to the window's scrolling and resizing
  only while open" (`wt-language-chooser.test.ts:590-616`, `:830-855`) count them.

- [ ] **Step 3: Prove the tests did not move and still pass**

  Run: `git diff --exit-code e52c997c0 -- packages/ui/src/components/wt-language-chooser.test.ts packages/ui/src/components/wt-language-chooser.a11y.test.ts`
  Expected: exit 0, no output.
  Run the Step 1 command again. Expected: `Tests 62 passed (62)`.
  Also run the `packages/ui` guards that mount every component:
  `pnpm --filter @waitron/ui exec vitest run src/tap-target-and-focus.test.ts src/no-hardcoded-chrome.test.ts`
  Expected: PASS.

- [ ] **Step 4: Prove the language chooser now depends on the helper.** Temporarily make
  `MenuPopover.place` return at once and re-run `wt-language-chooser.test.ts`: the placement cases
  (for example "at the trailing end of a top bar, opens its menu downwards…") must FAIL. Restore;
  PASS.

- [ ] **Step 5: If Step 3 cannot pass without editing a language-chooser test**, stop: run
  `git checkout -- packages/ui/src/components/wt-language-chooser.ts && rm packages/ui/src/menu-popover.ts`,
  note "fallback: separate copy" in the ledger, and go on to Task 3, which then follows its
  fallback note.

- [ ] **Step 6: Coverage of the new file, typecheck, lint, format, commit**

  Run: `pnpm --filter @waitron/ui exec vitest run --coverage --coverage.include=src/menu-popover.ts src/components/wt-language-chooser.test.ts`
  (the `menu-popover.ts` row at or above 98/98/98/95), then the three checks.
  ```bash
  git add packages/ui/src/menu-popover.ts packages/ui/src/components/wt-language-chooser.ts
  git commit -s -m "Move the language chooser's menu placement, dismissal and arrow keys into a shared helper (A681)"
  ```
  The commit body states: the two language-chooser test files are unchanged (the `git diff
  --exit-code` command, verbatim) and their `Tests` count before and after (62 and 62).

Changed test checks: none (that is the point of this task).

---

### Task 3: The `wt-theme-chooser` primitive

**Files:**
- Create: `packages/ui/src/components/wt-theme-chooser.ts`
- Create: `packages/ui/src/components/wt-theme-chooser.test.ts`
- Create: `packages/ui/src/components/wt-theme-chooser.a11y.test.ts`
- Modify: `packages/ui/src/index.ts` (beside `WtLanguageChooser`, `:135`), `packages/ui/demo/main.ts`
  (import beside `:43`; draw it beside the language chooser at `:273`)

**Interfaces:**
- Consumes: `ThemeChoice`, `THEME_CHOICES`, `THEME_SELECTED_EVENT` (Task 1); `MenuPopover`,
  `menuPopoverStyles` (Task 2); `registerIcons` from `./wt-icon.js`.
- Produces:
  - `export interface WtThemeLabels { theme: string; light: string; dark: string; device: string }`
  - `@customElement("wt-theme-chooser") export class WtThemeChooser` with
    `@property() active: ThemeChoice = "device"` (any other value draws as Follow device) and
    `@property({ attribute: false }) labels: WtThemeLabels` defaulting to
    `{ theme: "Theme", light: "Light", dark: "Dark", device: "Follow device" }`.
  - Event `wt-theme-selected`, `detail: { choice: ThemeChoice }` (Global Constraints).
  - Icons registered at module load (the dashboard's account-menu group draws them too):
    - `theme-light`: `M8 5a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z M7.25 .5h1.5V3h-1.5Z M7.25 13h1.5v2.5h-1.5Z M.5 7.25H3v1.5H.5Z M13 7.25h2.5v1.5H13Z M11.78 10.72 13.27 12.21 12.21 13.27 10.72 11.78Z M4.22 5.28 2.73 3.79 3.79 2.73 5.28 4.22Z M11.78 5.28 13.27 3.79 12.21 2.73 10.72 4.22Z M4.22 10.72 2.73 12.21 3.79 13.27 5.28 11.78Z`
    - `theme-dark`: `M6.82 1.61A6.5 6.5 0 1 0 14.39 9.18A5.5 5.5 0 0 1 6.82 1.61Z`
    - `theme-device`: `M8 1a7 7 0 1 1 0 14A7 7 0 1 1 8 1Z M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11Z M8 2.5v11a5.5 5.5 0 0 1 0-11Z`

    These are first drafts on the 16×16 grid `wt-icon` uses; Task 9 looks at them, and a drawing
    that reads badly is redrawn there.
- Render: `<div class="chooser" @keydown>` holding the trigger
  `<wt-button variant="secondary" data-test="theme-trigger" aria-haspopup="menu" aria-expanded=… aria-label=…><wt-icon name="theme-<active>" size="lg"></wt-icon></wt-button>`
  and, while open, `<div class="menu" role="menu" popover="manual">` with one
  `<button type="button" class="option" role="menuitemradio" aria-checked data-test="theme-<choice>">`
  per entry of `THEME_CHOICES`, each holding `<wt-icon name="theme-<choice>">` then the label. A pick
  stops the click, closes, focuses the trigger, then dispatches. No loading state: the menu opens on
  the first press. No `shadowRootOptions` override — focus delegation follows the language chooser
  (decision 1).

- [ ] **Step 1: Write the failing behaviour tests** in `wt-theme-chooser.test.ts`, mounting with
  `mount` / `mountInShadowRoot` from `../test-helpers.js` the way `wt-language-chooser.test.ts:13-63`
  does, and checking names with `expect.element(page.elementLocator(innerButton)).toHaveAccessibleName(…)`:
  - `registers as a custom element`.
  - `draws the active choice's icon and names its trigger with the label and the choice` —
    `active="dark"` → the trigger's `wt-icon` has `name="theme-dark"`; the inner button's name is
    `"Theme: Dark"`; with `labels = { theme: "Tema", light: "Claro", dark: "Oscuro", device: "Según el dispositivo" }`
    it is `"Tema: Oscuro"`.
  - `draws Follow device for no choice or a choice it does not know` — no `active`, and `active="sepia"`:
    icon `theme-device`, name `"Theme: Follow device"`.
  - `tells a screen reader the trigger opens a menu, and whether it is open` — inner button
    `aria-haspopup="menu"`, `aria-expanded` `"false"` then `"true"` after a press.
  - `opens a menu of Light, Dark and Follow device, in that order, with the active one checked` —
    three `[role="menuitemradio"]`, texts `["Light", "Dark", "Follow device"]`, `aria-checked`
    `["false", "true", "false"]` for `active="dark"`; each option's `wt-icon` is
    `theme-light`, `theme-dark`, `theme-device`.
  - `follows its parent when the active choice changes` — set `active = "light"` while open: the
    checked option and the trigger's icon follow.
  - `a pick closes the menu, returns focus to the trigger, and sends wt-theme-selected, leaving the theme alone`
    — a `document` listener receives one event with `detail` `{ choice: "light" }`, `bubbles` and
    `composed` `true`; the menu is gone; focus (followed through shadow roots) is on the trigger's
    inner button; `document.documentElement.hasAttribute("data-theme")` and the test host's
    `data-theme` are unchanged.
  - `does not let the option's own click escape the component` — a `click` listener on the host
    hears no click whose `composedPath()[0]` is the option.
  - `wt-theme-selected crosses shadow boundaries` — mounted with `mountInShadowRoot`, a listener
    on `document` still hears it.
  - `opening focuses the checked option; arrow keys wrap; Home and End reach the ends; Escape closes and returns focus`
    — one test with `userEvent.keyboard`.
  - `a press outside closes the menu, and so does focus moving outside` — one test.
  - `at the trailing end of a top bar, opens below its trigger, trailing edges lined up, on screen`
    — in a `display:flex; justify-content:flex-end` bar: menu top ≈ trigger bottom + `--wt-space-1`
    (within 1 px), menu right = trigger right, menu inside the viewport.
  - `paints its menu from the surface, text and border tokens` (the token-painting test CLAUDE.md
    §3 requires) — set `--wt-color-surface: rgb(1, 2, 3)`, `--wt-color-text: rgb(4, 5, 6)` and
    `--wt-color-border: rgb(7, 8, 9)` on the test host, open: the menu's computed
    `background-color` is `rgb(1, 2, 3)`, an option's `color` `rgb(4, 5, 6)`, the menu's
    `border-top-color` `rgb(7, 8, 9)`.
  - `draws each of its three icons` — for each `theme-*` name a bare `<wt-icon>` renders a `path`
    whose `d` is non-empty (proves the module registered them).

  **Fallback note (only if Task 2 took the fallback):** also copy, adapted to this component, the
  language chooser's scroll-following, viewport-clamping, right-to-left, resize, listener-counting
  and "an Escape something inside already handled" cases (`wt-language-chooser.test.ts:415-616`,
  `:729-855`), because then nothing else tests this copy.

- [ ] **Step 2: Write the failing a11y test** in `wt-theme-chooser.a11y.test.ts`, shaped like
  `wt-language-chooser.a11y.test.ts`:
  `describe.each(["light", "dark"] as const)("wt-theme-chooser a11y (%s theme)", (theme) => …)` with
  `test.each(["light", "dark", "device"] as const)("closed, showing %s", …)` and
  `test("open, with the active choice checked", …)`, each mounting through `mountThemed` and ending
  in `await expectNoA11yViolations(host)`.

- [ ] **Step 3: Run both to see them fail**

  Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-theme-chooser.test.ts src/components/wt-theme-chooser.a11y.test.ts`
  Expected: FAIL — `./wt-theme-chooser.js` does not resolve.

- [ ] **Step 4: Implement** `wt-theme-chooser.ts` per the interface, with `MenuPopover` for the
  mechanics and `menuPopoverStyles` plus `.option { display: flex; align-items: center; gap: var(--wt-space-2) }`
  for the icon beside each label. Export `WtThemeChooser` and `type WtThemeLabels` from
  `packages/ui/src/index.ts`. Add it to the workbench beside the language chooser.

- [ ] **Step 5: Run to see them pass**, then the guards that discover every component:

  Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-theme-chooser.test.ts src/components/wt-theme-chooser.a11y.test.ts src/tap-target-and-focus.test.ts src/no-hardcoded-chrome.test.ts src/components/wt-language-chooser.test.ts`
  Expected: PASS.
  Run, from the worktree root (the root Vitest project includes only `scripts/**/*.test.{ts,mjs}`,
  root `vitest.config.ts:71`): `pnpm exec vitest run scripts/style-token-names.test.ts scripts/native-form-fields.test.ts scripts/english-only.test.ts`
  Expected: PASS.

- [ ] **Step 6: Prove the a11y test can fail.** Remove the trigger's `aria-label`: the a11y test
  must FAIL with axe's `button-name` rule. Restore; PASS.

- [ ] **Step 7: Coverage of the new file, typecheck, lint, format, commit**

  Run: `pnpm --filter @waitron/ui exec vitest run --coverage --coverage.include=src/components/wt-theme-chooser.ts src/components/wt-theme-chooser.test.ts src/components/wt-theme-chooser.a11y.test.ts`
  (that row at or above 98/98/98/95), then the three checks.
  ```bash
  git add packages/ui/src/components/wt-theme-chooser.ts packages/ui/src/components/wt-theme-chooser.test.ts packages/ui/src/components/wt-theme-chooser.a11y.test.ts packages/ui/src/index.ts packages/ui/demo/main.ts
  git commit -s -m "Add wt-theme-chooser: an icon trigger and a Light, Dark, Follow device menu (A681)"
  ```

Changed test checks: none.

---

### Task 4a: The dashboard follows the choice — start-up, logo, recovery page

**Files:**
- Modify: `apps/dashboard/src/main.ts:17` (`startThemeChoice(document.documentElement)` on the line
  after `applyTokens`)
- Modify: `apps/dashboard/src/dashboard-app.ts` — `#theme = new ThemeChoiceController(this)`; the
  logo source (`:1702`) takes `media=${darkLogoMedia(this.#theme.choice)}`
- Modify: `apps/dashboard/src/screens/node-recovery-print.ts:30`
- Create: `apps/dashboard/src/dashboard-app.theme.test.ts`
- Modify: `apps/dashboard/src/screens/node-recovery-print.test.ts` (a new case)

**Interfaces:**
- Consumes: Task 1's `startThemeChoice`, `chooseTheme`, `ThemeChoiceController`, `THEME_STORAGE_KEY`.
- Produces: `function darkLogoMedia(choice: ThemeChoice): string` in `dashboard-app.ts` (module
  scope): `"all"` for dark, `"not all"` for light, `"(prefers-color-scheme: dark)"` for device.

- [ ] **Step 1: Write the failing tests.** In `apps/dashboard/src/dashboard-app.theme.test.ts`
  (mount with `mountWidget` from `./widgets/test-helpers.js`, which makes the host a theme root;
  stub the api as `dashboard-app.test.ts:104-206` does — copy what is needed; `afterEach`:
  `chooseTheme("device")`, `localStorage.removeItem(THEME_STORAGE_KEY)`,
  `commands.emulateColorScheme(null)`, cleanup). Reuse `dashboard-app.test.ts:761-785`'s `drawing` /
  `served` comparison (copy the two helpers), and use `expect.poll`:
  - `with Dark chosen the banner shows the dark lockup, whatever the computer is set to` —
    `chooseTheme("dark")` after mounting; emulate `"light"` → dark drawing; emulate `"dark"` → dark drawing.
  - `with Light chosen it shows the light lockup, whatever the computer is set to`.
  - `on Follow device it follows the computer, and a change of choice applies at once` — emulate
    dark → dark drawing; `chooseTheme("light")` → light drawing with the OS still dark;
    `chooseTheme("device")` → dark drawing again.
  - `a choice saved before the page started is what the logo shows` — mount, then
    `localStorage.setItem(THEME_STORAGE_KEY, "dark")` and `startThemeChoice(host)` (which notifies,
    Task 1) with the OS light → dark drawing.

  In `node-recovery-print.test.ts`, add `gives the printed page the colour scheme of the screen it
  copies its colours from`: parse the returned HTML with `DOMParser`, take the `<style>` text, load
  it into `const sheet = new CSSStyleSheet(); sheet.replaceSync(text)`, take the FIRST top-level
  rule that is a `CSSStyleRule` with `selectorText === ":root"` (so the `@media print` rule at `:38`
  is never the one read), and assert `rule.style.getPropertyValue("color-scheme")` EXACTLY:
  - source a `div` with `applyTokens` and `data-theme="dark"` → `"dark"`;
  - the same with `data-theme="light"` → `"light"`;
  - source `document.body`, which is no theme root (computed `color-scheme` `normal`) → `"light dark"`.

  What each would print against code that is wrong: today's code gives `"light dark"` in the first
  two cases; an implementation that copies the computed value unchecked gives `"normal"` in the third.

- [ ] **Step 2: Run to see them fail**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.theme.test.ts src/screens/node-recovery-print.test.ts`
  Expected: FAIL in the Dark, Light and saved-choice logo cases and the first two colour-scheme
  cases; the Follow device logo case's first step passes and its Light step fails.

- [ ] **Step 3: Implement**: `startThemeChoice` in `main.ts`; the controller and `darkLogoMedia` in
  `dashboard-app.ts`; in `renderNodeRecoveryPack`, read `getComputedStyle(source).colorScheme` and
  write it in the first `:root` rule when it is exactly `light` or `dark`, else `light dark`.

- [ ] **Step 4: Run to see them pass**, plus the existing logo test, which must pass UNCHANGED (with
  nothing saved it is the Follow device case):

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.theme.test.ts src/screens/node-recovery-print.test.ts src/screens/node-recovery-panel.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "dark-theme lockup"`.
  Expected: PASS.

- [ ] **Step 5: Prove the logo case by deletion.** Put the literal `"(prefers-color-scheme: dark)"`
  back in place of `darkLogoMedia(...)`: "with Dark chosen the banner shows the dark lockup…" must
  FAIL, showing the light drawing while the OS is light. Restore; PASS.

- [ ] **Step 6: Typecheck, lint, format, commit**

  ```bash
  git add apps/dashboard/src/main.ts apps/dashboard/src/dashboard-app.ts apps/dashboard/src/screens/node-recovery-print.ts apps/dashboard/src/dashboard-app.theme.test.ts apps/dashboard/src/screens/node-recovery-print.test.ts
  git commit -s -m "Dashboard: the logo and the printable recovery page follow the saved theme (A681)"
  ```

Changed test checks: none (the existing logo test at `dashboard-app.test.ts:761` is kept as is).

---

### Task 4b: The dashboard's Theme choice — signed-out banner and signed-in account menu

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts` — import `@waitron/ui/src/components/wt-theme-chooser.js`
  beside `:53`; the controller from Task 4a becomes `new ThemeChoiceController(this, { applies: true })`;
  in `#banner` (`:1718`), when `authenticated` is false, `<wt-theme-chooser data-test="theme-chooser" .active=${this.#theme.choice} .labels=${…}>`
  just before the language chooser; when it is true, no theme chooser in the banner, and inside the
  account menu's `wt-row-actions` (`:1747-1768`), between the `profile` and `logout` buttons:
  ```html
  <div class="theme-choices" role="group" aria-labelledby="theme-choices-label" data-test="theme-choices">
    <span id="theme-choices-label" class="theme-choices-label">${t("theme.label")}</span>
    <!-- one per THEME_CHOICES entry -->
    <button type="button" class="theme-choice" aria-pressed=${String(choice === this.#theme.choice)}
            data-test="theme-choice-${choice}" @click=${() => chooseTheme(choice)}>
      <wt-icon name="theme-${choice}"></wt-icon>${label}
    </button>
  </div>
  ```
  CSS, tokens only: `.theme-choices` a column with `gap: var(--wt-space-1)`; `.theme-choices-label`
  in `--wt-color-text-muted`, `--wt-font-size-sm`, padded like the menu's buttons;
  `.theme-choice` drawn like the menu's `wt-button variant="ghost" align="start"` (min height
  `--wt-tap-min`, padding `var(--wt-space-2) var(--wt-space-4)`, `--wt-radius-md`, bold, start
  aligned, transparent 1 px border, `--wt-color-primary-text` border on hover, `--wt-focus-ring`
  on `:focus-visible`), and `[aria-pressed="true"]` with a `--wt-color-border` border.
- Modify: `apps/dashboard/src/i18n/strings.ts` (the four keys in `en` near `nav.account_menu`, `:775`,
  and in `es`, `:3744`)
- Modify: `apps/dashboard/src/dashboard-app.theme.test.ts` (new cases)

**Interfaces:** Consumes Task 1, Task 3 (element, `WtThemeLabels`, and its registered icons).

- [ ] **Step 1: Write the failing tests** in `apps/dashboard/src/dashboard-app.theme.test.ts`:
  - `signed out, puts the theme chooser in the banner just before the language chooser` — the
    `.banner-actions` children's `data-test`s are `["theme-chooser", "language-chooser"]`.
  - `signed in, the banner has no theme chooser and the account menu holds the Theme choices
    between Account settings and Log out` — no `[data-test=theme-chooser]`; the menu's slotted
    children in order are `profile`, `theme-choices`, `logout`; the group has accessible name
    `"Theme"` (`toHaveAccessibleName` on the `role="group"` element) and three buttons named
    `"Light"`, `"Dark"`, `"Follow device"` with `aria-pressed` `["false", "false", "true"]`.
  - `signed out, a pick in the banner turns the dashboard dark and is kept` — `startThemeChoice(host)`;
    open `theme-trigger`, click `theme-dark` → `getComputedStyle(host).getPropertyValue("--wt-color-bg").trim()`
    is `"#101216"` (the dark value, `packages/ui-core/src/tokens/colors.css:127`), stored `"dark"`,
    the chooser's `active` `"dark"`; pick Follow device → no attribute, nothing stored.
  - `signed in, a pick in the account menu turns the dashboard dark, closes the menu, and is marked
    next time` — open the account menu, click `theme-choice-dark` → dark `--wt-color-bg`, stored
    `"dark"`, the popover closed; reopen → `theme-choice-dark` is `aria-pressed="true"`, the other two `"false"`.
  - `labels the Theme choices in Spanish` — `setLocale("es-ES")` (restored after): signed out, the
    trigger's name is `"Tema: Según el dispositivo"` and the menu reads
    `["Claro", "Oscuro", "Según el dispositivo"]`; signed in, the group is named `"Tema"` and its
    buttons read the same three words.
  - `it.each` over intents `prepare` and `live`, `en-GB` and `es-ES`, widths 320, 360 and 390:
    `signed out, fits the banner at %ipx with the theme and language choosers on the lockup's row`
    — with the host padded 24 px as `dashboard-app.test.ts:5396-5407`'s `atViewport` does (copy it):
    the lockup is at least 60 px wide, the banner's `scrollWidth <= clientWidth`, neither chooser
    overlaps the lockup or the other, and both choosers' tops are above the lockup's bottom.
  - `has no accessibility violations with the account menu open, in both themes` — mount signed in
    with `"light"`, then `"dark"` (the `mountWidget` theme argument), open the account menu,
    `await expectNoA11yViolations(host)` (from `./widgets/test-helpers.js`).

- [ ] **Step 2: Run to see them fail**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.theme.test.ts`
  Expected: FAIL in the new cases; Task 4a's cases still PASS.

- [ ] **Step 3: Implement** per the Files list: the four strings; `applies: true`; the banner
  chooser signed out with labels from `t("theme.label")` … `t("theme.device")`; the account-menu group.

- [ ] **Step 4: Run to see them pass**, then every dashboard suite that mounts the whole app, the
  banner or the account menu — the signed-in banner tests must pass with no edit:

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.theme.test.ts src/dashboard-app.test.ts src/dashboard-app.a11y.test.ts src/dashboard-app.sidebar-fold.test.ts src/dashboard-app.touch.test.ts src/dashboard-app.profile-unsaved.test.ts src/dashboard-app.backup-unsaved.test.ts src/dashboard-app.schedule-unsaved.test.ts`
  Expected: PASS, and `git diff e52c997c0 -- apps/dashboard/src/dashboard-app.test.ts` empty. If a
  signed-out fit case fails, do NOT lower the bar or drop the case: stop and report the measured
  widths in the handover.

- [ ] **Step 5: Prove the account-menu mark can fail.** Hard-code `aria-pressed="false"` on every
  `theme-choice` button: "signed in, a pick in the account menu … is marked next time" must FAIL.
  Restore; PASS.

- [ ] **Step 6: Typecheck, lint, format, commit**

  ```bash
  git add apps/dashboard/src/dashboard-app.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/dashboard-app.theme.test.ts
  git commit -s -m "Dashboard: Theme in the banner while signed out, and in the account menu while signed in (A681)"
  ```

Changed test checks: none. The signed-in banner's item lists and fit tests
(`dashboard-app.test.ts:5425-5437`, `:5439-5490`, `:5534-5604`) and the title at `:5425` stay true
and untouched, because signed in the banner gains nothing.

---

### Task 5: Setup

**Files:**
- Modify: `apps/setup/src/main.ts:6` (`startThemeChoice(document.documentElement)` on the line after `applyTokens`)
- Modify: `apps/setup/src/setup-app.ts` — import the component beside `:25`;
  `#theme = new ThemeChoiceController(this, { applies: true })`; in the header (`:1477-1485`) wrap
  the two choosers in `<div class="header-controls">` (theme chooser first); CSS beside
  `main > header` (`:434-439`): `.header-controls { display: flex; align-items: center; gap: var(--wt-space-1); }`
  — needed because the header is `justify-content: space-between`, which would otherwise spread
  three children apart.
- Modify: `apps/setup/src/i18n/strings/shell.ts` (the four `shell.theme.*` keys in `shellEn` and `shellEs`)
- Create: `apps/setup/src/setup-app.theme.test.ts`
- Modify: `apps/setup/src/setup-app.chooser-clearance.test.ts` (add the theme chooser's cases)

**Interfaces:** Consumes Task 1 and Task 3.

- [ ] **Step 1: Write the failing tests** in `apps/setup/src/setup-app.theme.test.ts` (mount as
  `setup-app.test.ts:57-70` does; `afterEach` as in Task 4a):
  - `it.each([1280, 390])("puts the theme chooser just before the language chooser at the trailing end of the header, %ipx wide")`
    — the theme trigger's right edge is left of the language trigger's left edge, the gap between
    them is `--wt-space-1` (4 px, within 1 px), their vertical middles match the logo's within 1 px,
    and the language trigger's right edge still meets the header's (within 1 px).
  - `a pick applies and keeps the choice` — as in Task 4b (dark `--wt-color-bg` on the host, stored `"dark"`).
  - `labels the chooser in Spanish` — `"Tema: Según el dispositivo"`.
  - In `setup-app.chooser-clearance.test.ts`, add `describe("the theme chooser in the card's header", …)`
    with the same `cases` and the same two checks the language chooser has (`:63-84` "covers
    nothing interactive…" and `:86-125` "opens its menu on screen and over…"), read from
    `[data-test=theme-trigger]` in `wt-theme-chooser`, and in "covers nothing interactive" also
    check that the theme trigger does not overlap the language chooser. A `describe.each` over the
    two choosers is allowed only if every existing assertion survives unchanged.

- [ ] **Step 2: Run to see them fail**

  Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app.theme.test.ts src/setup-app.chooser-clearance.test.ts`
  Expected: FAIL in the new cases only.

- [ ] **Step 3: Implement** per the Files list.

- [ ] **Step 4: Run to see them pass**, with the suites that pin the header:

  Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app.theme.test.ts src/setup-app.chooser-clearance.test.ts src/setup-app.test.ts src/setup-app.a11y.test.ts src/i18n/strings.test.ts`
  Expected: PASS, the existing header cases at `setup-app.test.ts:2700-2755` unedited.

- [ ] **Step 5: Typecheck, lint, format, commit**

  ```bash
  git add apps/setup/src/main.ts apps/setup/src/setup-app.ts apps/setup/src/i18n/strings/shell.ts apps/setup/src/setup-app.theme.test.ts apps/setup/src/setup-app.chooser-clearance.test.ts
  git commit -s -m "Setup: a Theme menu beside the language menu (A681)"
  ```

Changed test checks: none, unless the `describe.each` route is taken; then list each moved case
with its old and new line.

---

### Task 6: The till — start, apply picks, the sign-in and join screens

**Files:**
- Modify: `apps/till/src/main.ts:16` (`startThemeChoice(document.documentElement)` on the line after
  `applyTokens`, at top level, before `void bootTill()`)
- Create: `apps/till/src/widgets/theme-chooser.ts`
- Modify: `apps/till/src/till-app.ts` (`new ThemeChoiceController(this, { applies: true })` as a field)
- Modify: `apps/till/src/screens/till-lock-screen.ts:309-315`, `till-enrol-screen.ts:186-192` —
  `${themeChooser()}` just before each `wt-language-chooser`, and `new ThemeChoiceController(this)`
  in each class
- Modify: `apps/till/src/widgets/language-chooser-styles.ts` — `.language-corner` gains
  `align-items: center; gap: var(--wt-space-1);`
- Modify: `apps/till/src/i18n/strings.ts` (the four `theme.*` keys in `en` and `es`)
- Create: `apps/till/src/till-app.theme.test.ts`
- Modify: `apps/till/src/screens/till-lock-screen.test.ts`, `till-enrol-screen.test.ts` (new
  cases; two titles)

**Interfaces:**
- Consumes: Task 1, Task 3.
- Produces: `export function themeChooser(): TemplateResult` in `apps/till/src/widgets/theme-chooser.ts`
  — imports `@waitron/ui/src/components/wt-theme-chooser.js` and returns
  `<wt-theme-chooser data-test="theme-chooser" .active=${currentThemeChoice()} .labels=${{ theme: t("theme.label"), light: t("theme.light"), dark: t("theme.dark"), device: t("theme.device") }}>`.
  Every till screen draws the chooser through it (Task 7 too). A host that calls it must hold a
  `ThemeChoiceController` (to redraw on a change) and a `LocaleChangeController` (each one does
  already — `till-shell.ts:6`, `till-lock-screen.ts:6`, `till-enrol-screen.ts:14`).

- [ ] **Step 1: Write the failing tests.**
  - `till-lock-screen.test.ts`: `shows the theme chooser just before the language chooser, at the top right`
    (same parent `.language-corner`, `nextElementSibling` is the language chooser, the corner's right
    edge holds the language chooser); `labels the theme chooser in Spanish`
    (`"Tema: Según el dispositivo"` after `setLocale("es-ES")`, restored after).
  - `till-enrol-screen.test.ts`: the same two cases.
  - `apps/till/src/till-app.theme.test.ts` (mount `till-app` the way `till-app.test.ts` reaches the
    lock screen; `afterEach` as in Task 4a): `a pick on the sign-in screen turns the till dark and
    keeps it, with nobody signed in` (`startThemeChoice(host)`; pick Dark in the lock screen's
    chooser → host `--wt-color-bg` `#101216`, stored `"dark"`, and the lock screen's chooser shows
    `active` `"dark"`); `a pick on the join screen does the same`.

- [ ] **Step 2: Run to see them fail**

  Run: `pnpm --filter @waitron/till exec vitest run src/till-app.theme.test.ts src/screens/till-lock-screen.test.ts src/screens/till-enrol-screen.test.ts`
  Expected: FAIL in the new cases only.

- [ ] **Step 3: Implement** per the Files list, and retitle the two tests below (titles only).

- [ ] **Step 4: Run to see them pass**, plus the suites that check those screens' layout and names:

  Run: `pnpm --filter @waitron/till exec vitest run src/till-app.theme.test.ts src/screens/till-lock-screen.test.ts src/screens/till-enrol-screen.test.ts src/screens/device-screens.phone-margin.test.ts src/till-app.a11y.test.ts src/i18n/strings.test.ts`
  Expected: PASS.

- [ ] **Step 5: Coverage of the new file, typecheck, lint, format, commit**

  Run: `pnpm --filter @waitron/till exec vitest run --coverage --coverage.include=src/widgets/theme-chooser.ts src/screens/till-lock-screen.test.ts`
  (that row at or above 98/98/98/95), then the three checks.
  ```bash
  git add apps/till/src/main.ts apps/till/src/widgets/theme-chooser.ts apps/till/src/till-app.ts apps/till/src/screens/till-lock-screen.ts apps/till/src/screens/till-enrol-screen.ts apps/till/src/widgets/language-chooser-styles.ts apps/till/src/i18n/strings.ts apps/till/src/till-app.theme.test.ts apps/till/src/screens/till-lock-screen.test.ts apps/till/src/screens/till-enrol-screen.test.ts
  git commit -s -m "Till: a Theme menu on the sign-in and join screens; the app applies picks (A681)"
  ```

Changed test checks (titles only, no assertion changes — the language chooser is no longer alone
in its corner):
- `apps/till/src/screens/till-lock-screen.test.ts:301` — "puts the language chooser at the top
  right on its own, above the sign-in content" → "puts the language chooser at the top right, after
  the theme chooser, above the sign-in content".
- `apps/till/src/screens/till-enrol-screen.test.ts:489` — "puts the language chooser at the top
  right on its own, above the join form" → "puts the language chooser at the top right, after the
  theme chooser, above the join form".

---

### Task 7: The till shell's bar and its kitchen-display corner

> 2026-10-17: superseded for the bar by the fix after Task 9's look (see decision 1); the
> kitchen-display corner part stands.

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts` — `#chooser()` (`:504-510`) returns
  `${themeChooser()}<wt-language-chooser …>` under its existing `loadLocales` condition, so both
  appear in the bar (`:767`) and the corner (`:721`); `#settled` (`:453-458`) also waits for
  `.head wt-theme-chooser`; add `new ThemeChoiceController(this)`. The ResizeObserver on the
  language chooser (`:426-431`) needs no twin: the theme chooser's width never changes.
- Modify: `apps/till/src/widgets/till-shell.test.ts` (the checks listed below, and new cases)
- Modify: `apps/till/src/till-app.theme.test.ts` (Review Focus 5)

**Interfaces:** Consumes `themeChooser()` (Task 6).

- [ ] **Step 1: Make the existing shell checks expect the new element** (the "Changed test checks"
  below, exactly as listed).

- [ ] **Step 2: Write the failing new tests** in `till-shell.test.ts`:
  - `places the theme chooser in the bar, just before the language chooser` (same parent
    `header .session`, `nextElementSibling` is the language chooser).
  - `keeps the theme chooser beside the language chooser on a kitchen display, at the top right`
    (mirrors `:473-489`).
  - `omits the theme chooser with the language chooser when loadLocales is not supplied` (mirrors `:332-338`).
  - In `till-app.theme.test.ts`: `picking a theme with an unsent order open asks nothing and keeps
    the order` — with a basket line added on the counter (reuse the setup of an unsaved-changes case
    in `till-app.unsaved-changes.test.ts`), pick Dark in the shell's chooser: no unsaved-changes
    dialog opens, the basket still holds the line, and the theme is dark. In the same test, a
    language pick then does ask (the existing behaviour at `till-app.ts:13222-13225`), so the test
    shows the two differ.

- [ ] **Step 3: Run to see them fail**

  Run: `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/till-app.theme.test.ts`
  Expected: FAIL in the new cases and in the changed checks.

- [ ] **Step 4: Implement** per the Files list.

- [ ] **Step 5: Run to see them pass**, plus everything that measures or walks the bar:

  Run: `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/widgets/till-shell.a11y.test.ts src/till-app.theme.test.ts src/till-app.test.ts src/till-app-boot-and-counter.test.ts`
  Expected: PASS. If any other existing check fails, stop and report it with its output; do not
  change its viewport, its counts or its expected items.

- [ ] **Step 6: Typecheck, lint, format, commit**

  ```bash
  git add apps/till/src/widgets/till-shell.ts apps/till/src/widgets/till-shell.test.ts apps/till/src/till-app.theme.test.ts
  git commit -s -m "Till: the Theme menu in the shell's bar and on the kitchen display (A681)"
  ```

Changed test checks (each a deliberate consequence of one more control in the bar; none loosened):
- `apps/till/src/widgets/till-shell.test.ts:409-434` ("fits the header, every button on screen, at
  phone width…") — selector `"wt-row-actions, .tab, wt-button, wt-language-chooser, .operator"` →
  the same plus `", wt-theme-chooser"`; expected count `formFactor === "till" ? 12 : 11` →
  `13 : 12`. Why: the theme chooser is a new control in the bar, and its own `wt-button` sits in
  its shadow root where the selector does not reach, so it must be named.
- `apps/till/src/widgets/till-shell.test.ts:565-596` ("keeps the header to one row at most 64 px
  tall") — `expect(visible.length).toBe(4)` → `toBe(5)`. Why: `header .session > *` now also
  matches the theme chooser; the row-height and inside-the-header checks are unchanged.
- `apps/till/src/widgets/till-shell.test.ts:662` ("reaches every action by keyboard") — one
  `await userEvent.tab(); // the theme chooser` added before the language chooser's. Why: one more
  stop on the Tab path.
- `apps/till/src/widgets/till-shell.test.ts:815-833` (the session row in order) — `"wt-theme-chooser"`
  inserted just before `"wt-language-chooser"`.
- `apps/till/src/widgets/till-shell.test.ts:473` — title "keeps the language chooser on a kitchen
  display, at the top right on its own, above the body" → "keeps the language chooser on a kitchen
  display, at the top right after the theme chooser, above the body" (title only).

---

### Task 8: Docs and backlog

**Files:**
- Modify: `docs/developers/design-system.md`, `docs/developers/testing-guide.md`
- Modify: `docs/backlog.md`, `docs/backlog/dashboard.md`

- [ ] **Step 1: design-system.md.**
  - "Themes" (`:59-90`): the selection order gains the product's own step — each app applies this
    browser's saved choice (`startThemeChoice`, `packages/ui/src/theme-choice.ts`) to
    `document.documentElement` before its first render; Light and Dark set `data-theme`, Follow
    device (the default, and the state with nothing saved) removes it and leaves the operating
    system's setting in charge. State the key, that other open tabs follow, that a refused save
    still applies to the open page, and decision 2's origin limits (two host names for one box keep
    two choices; a trading listener on HTTP keeps a separate one from setup; the dev stack's three
    ports keep three), labelled as read from the code, not tried on a box.
  - Primitives table: a `wt-theme-chooser` row after `wt-language-chooser` (`:691`), in that row's
    style: `active`, `labels`, the trigger's icon and name, the menu order, that it shares the
    language chooser's menu mechanics (`packages/ui/src/menu-popover.ts`) and behaviour (placement,
    Escape, outside press, arrow keys), focus as the language chooser's, the `data-test` hooks, and
    the event column `wt-theme-selected — detail: { choice }`.
  - "Dashboard banner" (`:3042-3060`): signed out, the theme chooser sits just before the language
    chooser; signed in, Theme is a group of three pressed-state buttons in the account menu, between
    Account settings and Log out, because the banner has no room at phone width (decision 1a, with
    its measurement).
  - "Navigation and language controls" (`:4539-4581`): the theme chooser sits just before the
    language chooser in setup's header, the till's bar and corner, and the till's sign-in and join
    screens; on the till's bar it stays on the bar with the tabs and the language chooser (changed
    2026-10-17: a signed-in till holds Theme in the person's menu instead, see decision 1a); a theme
    pick never asks about unsaved work, unlike a language pick on the till; the dashboard logo's
    `media` rule and the recovery page's `color-scheme` follow the choice.
  - Check every other sentence the change makes false: `grep -n "prefers-color-scheme\|data-theme\|follows the device\|language chooser" docs/developers/*.md`
    and read each hit.
- [ ] **Step 2: testing-guide.md `:1673-1677`.** The dashboard capture instruction says to set
  `data-theme` on `document.documentElement`. `startThemeChoice` now removes that attribute when
  nothing is saved, so a capture that sets it before `main.ts` runs is undone. Rewrite it: save the
  choice before the page loads (Playwright `addInitScript(() => localStorage.setItem("waitron-theme", "dark"))`
  on the app's origin), or set the attribute only after the page has started; keep the existing rule
  to read the computed colours and reject a capture whose light and dark colours match.
- [ ] **Step 3: backlog.** Delete A681's item 7 from "What to work on next" (`docs/backlog.md:101-102`)
  and replace the count in "they now come after the eight above" with words that do not go stale
  ("after the list above"); delete the A681 entry under "Users, sign-in and the dashboard shell"
  (`:3554-3558`) and the `## A681…` section in `docs/backlog/dashboard.md` (`:1141-1149`); grep
  `a681` afterwards and fix any anchor left pointing at it. In A781 (`docs/backlog.md:3548-3552`)
  add one sentence only: `wt-language-chooser`'s menu placement, dismissal and arrow keys now live
  in `packages/ui/src/menu-popover.ts`, which `wt-theme-chooser` also uses. Do not otherwise change
  A781's scope. Add one short entry in the same area: **the box's own pages and the favicon still
  follow the device's setting** — the trust page (`apps/server/src/trust-page.ts`,
  `trust-page-logo.ts`) and the other server-rendered pages cannot read a browser's saved choice
  before any app script runs, and the favicon is drawn by the browser from the operating system's
  setting; open. Add any other point the tasks left open as its own short entry.
- [ ] **Step 4: Commit.** `docs/` is ignored by prettier, so no format check applies
  (CLAUDE.md §2). This branch is not docs-only, so it goes in the PR.
  ```bash
  git add docs/developers/design-system.md docs/developers/testing-guide.md docs/backlog.md docs/backlog/dashboard.md
  git commit -s -m "Docs: the Theme choice, where it sits, its saved setting and its limits; A681 done"
  ```

Changed test checks: none.

---

### Task 9: Look at it in a real browser

**Files:** screenshots and the look script in `/Users/clintongormley/waitron-campaign-c/a681-shots/`
(outside the worktree; nothing committed).

- [ ] **Step 1: Start the stack.** `wa-wt demo waitron-feat-a681-theme-choice` (the worktree's
  directory name; `wa-wt ls` shows its URLs — first slot: till 5190, dashboard 5191 at `/manage/`,
  setup 5192). Before a `wa-wt reset`, `lsof` the venue folder and port 8080. Dashboard sign-in
  `owner@demo.waitron.local` / `dashPass123`; till PIN `5555` (`docs/ui-review.md:13-16`). If the
  till shows the dev device picker, pick a till device.
- [ ] **Step 2: Write `look.mjs` there**, loading Playwright from the worktree:
  `createRequire("/Users/clintongormley/workspace/worktrees/waitron-feat-a681-theme-choice/packages/ui/package.json")("playwright")`.
  For each surface — dashboard signed out, dashboard signed in (with the account menu open once),
  setup, till sign-in screen, till shell after sign-in — at 1280×800 and 390×844, take one
  screenshot per case:
  - Light with the OS dark (`colorScheme: "dark"` context, `waitron-theme` = `light` saved through
    `addInitScript` on that app's origin),
  - Dark with the OS light,
  - Follow device with the OS light, and again with the OS dark,
  - the menu open (one per surface, 390 wide),
  - one pick made through the UI (the menu, or the account menu signed in), shot after the pick.
  Name files `<surface>-<width>-<choice>-os<scheme>.png`. Each app is its own origin in dev
  (decision 2), so save the choice per origin.
- [ ] **Step 3: The no-flash probe (it can fail).** For each app, with `light` OS and `dark` saved,
  install before navigation (`addInitScript`) a `MutationObserver` on `document.documentElement`
  watching `attributes`, which pushes, per callback, the list of attribute names changed in that
  callback into `window.__themeBatches`. After load, read it. PASS: `data-wt-theme-root` and
  `data-theme` appear in the SAME callback batch, so they were set in one task with no rendering
  opportunity between them. What failure prints: the two names in separate batches — which is what
  a `startThemeChoice` placed after an `await` (for example inside the till's `bootTill`, after
  `isTrustBroken`) would give. Control: run the probe once against a page where the attribute is
  set after a `setTimeout(…, 0)` (a one-off `addInitScript` that does so on a blank page served by
  the same Vite server is enough) and confirm it reports two batches.
- [ ] **Step 4: Look at every screenshot** and check: the whole page, not only the chrome, takes
  the chosen theme (no light card on a dark page); the dashboard logo matches the theme; the three
  icons read as sun, moon and half-circle at both widths and in both themes; the theme trigger and
  the language trigger are the same height and spaced like their neighbours; the account menu's
  Theme group reads as one labelled group with the current choice marked; nothing overlaps or wraps
  at 390; each menu opens on screen.
- [ ] **Step 5: Report.** Fix any defect in the task that owns it (with a test where one can catch
  it), then re-shoot. Note in the ledger what was looked at, on which commit, the probe's output and
  the directory of screenshots. Stop the stack with `wa-wt down waitron-feat-a681-theme-choice`.

---

After Task 9: tell the owner the branch is ready for `/finish-branch`
(`/finish-branch /Users/clintongormley/workspace/worktrees/waitron-feat-a681-theme-choice plan docs/superpowers/plans/2026-10-17-a681-theme-choice.md`).
