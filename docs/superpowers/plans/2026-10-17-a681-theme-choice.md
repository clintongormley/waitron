# A681 — a Light / Dark / Follow device theme choice in the apps: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard, the till and setup each get a Theme menu (Light, Dark, Follow device — the
default). The choice is saved in that browser, so it belongs to the device, not the person and not
the venue's database, and every screen and the dashboard's logo follow it.

**Architecture:** One small module in `@waitron/ui` (`packages/ui/src/theme-choice.ts`) owns the
saved choice: it reads and writes one `localStorage` key and sets or removes `data-theme` on the
page's theme root (`document.documentElement`). Each app's `main.ts` applies the saved choice right
after `applyTokens`, before anything renders. A new `wt-theme-chooser` primitive draws an icon
trigger and a menu of three `menuitemradio` options; it never applies anything itself, it sends
`wt-theme-selected`, and each app's root element saves and applies it through a Lit controller from
the same module. The menu mechanics (`popover` placement, outside press, Escape, arrow keys) move out
of `wt-language-chooser` into one shared helper both choosers use.

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
   side of) `wt-language-chooser` everywhere that chooser appears in product UI. Verified with
   `grep -rln wt-language-chooser apps packages --include='*.ts'` on e52c997c0:
   - dashboard banner, signed in and signed out — `apps/dashboard/src/dashboard-app.ts:1719`;
   - setup's card header — `apps/setup/src/setup-app.ts:1481`;
   - till shell bar, and the kitchen-display / kiosk corner — `apps/till/src/widgets/till-shell.ts:504-509`
     (`#chooser()`, rendered at `:721` and `:767`);
   - till sign-in screen — `apps/till/src/screens/till-lock-screen.ts:311`;
   - till join screen — `apps/till/src/screens/till-enrol-screen.ts:188`;
   - till counter screen's own header — `apps/till/src/screens/till-counter-screen.ts:461`;
   - the UI workbench — `packages/ui/demo/main.ts:273` (not product UI; the primitive is added
     there because design-system.md → "Adding a primitive" step 7 asks for it).

   "Before", not "after", so every existing check that the language chooser is at the trailing
   edge, or just before the operator's name, still holds (`apps/setup/src/setup-app.test.ts:2700-2727`,
   `apps/till/src/widgets/till-shell.test.ts:258-277`).

   The trigger is a `wt-button variant="secondary"` (the language chooser's trigger,
   `packages/ui/src/components/wt-language-chooser.ts:298-306`, so the two read as a pair) holding
   one `wt-icon size="lg"` for the current choice, named by `aria-label` "Theme: Dark" (the label,
   a colon, the choice). No tooltip, like the alerts bell and account menu beside it in the
   dashboard banner. No suitable icons exist (a grep for sun, moon, contrast or theme icons in
   `apps/*/src` and `packages/*/src` found none), so the component registers three drawings of its
   own at module load, the way `wt-data-table` does (`packages/ui/src/components/wt-data-table.ts:22`):
   `theme-light` (a sun), `theme-dark` (a crescent), `theme-device` (a half-filled circle). They are
   drawn for this change, not copied from an icon set, so no licence notice is owed.

   **Shared menu mechanics: yes, through a helper.** The menu code moves out of
   `wt-language-chooser` into `packages/ui/src/menu-popover.ts`, on the condition that
   `wt-language-chooser.test.ts` and `wt-language-chooser.a11y.test.ts` stay byte-identical and
   pass before and after (Task 2 checks this with `git diff --exit-code`). Why: the alternative is a
   second copy of about 120 lines (placement, scroll and resize following, outside press, Escape,
   arrow keys) that would need its own copy of the language chooser's ~30 placement, keyboard and
   dismissal tests to survive `packages/ui`'s mutation floor of 90. With the helper those tests
   already exercise the shared code, and the theme chooser's tests cover only its wiring. Backlog
   item A781 (`docs/backlog.md:3548-3552`) asks for exactly this kind of helper across the pop-up
   `wt-*` fields; this change is its first slice, and Task 8 narrows A781 to what is left
   (`wt-combobox`, `wt-colour-chooser`). **Fallback:** if Task 2 cannot keep both language-chooser
   test files unedited and green, revert Task 2's changes, and Task 3 builds the theme chooser with
   its own copy of the mechanics plus the placement, keyboard and dismissal tests listed in Task 3's
   fallback note. Record which path was taken in the ledger and the PR.

2. **Storage and application.** Home: `@waitron/ui`, as `packages/ui/src/theme-choice.ts`, not
   `@waitron/ui-core`: ui-core is the published package (`packages/ui-core/package.json` has a
   `build`, `prepack` and a `test:package` consumer test), and a product storage key does not belong
   in its public surface; `@waitron/ui` is private and is what every app's `main.ts` already
   imports `applyTokens` from. One key, `waitron-theme` (the dashboard's spelling,
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
   whose save is refused still applies to the open page.

   **Same origin, verified by reading:** on a box the till and the dashboard are served by one
   server on one port — the dashboard at `/manage`, the till at `/`
   (`apps/server/src/boot.ts:2280-2290`), both through `startListening` on `config.httpPort`
   (`boot.ts:575-588`, trading via `startTradingListener`, `boot.ts:631-637`). Setup is served by
   setup mode at `/` (`apps/server/src/setup-api.ts:1410`) on the same `startListening` and port
   (`boot.ts:1223-1224`). So on a box all three share one origin, and one saved choice, as long as
   the browser uses the same host name. Consequences, stated as limits in design-system.md (Task 8),
   not fixed: the same box reached by two names (its IP address and `waitron.local`) keeps two
   choices; in the dev stack the three apps are three Vite servers on three ports (5190 till, 5191
   dashboard, 5192 setup — `apps/*/vite.config.ts`, `docs/developers/workflow-guide.md` § the dev
   stack), so in dev each app keeps its own choice. Task 9 sets the choice per port for that reason.

   **Other open tabs follow, through the `storage` event: included.** It is a few lines in the
   module and testable by dispatching a `StorageEvent` on `window` (Task 1).

3. **What reads the device's light or dark setting today, and must follow the choice instead.**
   Found with `grep -rn "prefers-color-scheme\|matchMedia\|color-scheme\|light-dark("` over the
   tree (excluding `node_modules`, `dist`, `docs`):
   - the dashboard banner's `<picture>` — `apps/dashboard/src/dashboard-app.ts:1701-1704`,
     `<source media="(prefers-color-scheme: dark)">`. **In scope** (Task 4): the source's `media`
     becomes `all` for Dark, `not all` for Light and stays `(prefers-color-scheme: dark)` for Follow
     device, so Follow device still tracks the operating system with no script.
   - the dashboard's printable node recovery page — `apps/dashboard/src/screens/node-recovery-print.ts:30`,
     `:root { color-scheme: light dark }`. It copies its colours from the screen's tokens (which
     follow the choice) but lets the browser draw native parts (scrollbars) from the operating
     system. **In scope** (Task 4): it takes the `color-scheme` the source element resolves to.
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
   (`apps/dashboard/src/i18n/strings.ts:5258`).

5. **LIGHT review path; no migration; no server change.**

**Points where the code differs from the brief this plan was written from:** the brief named only
the dashboard logo as an app-side reader of the operating system's setting; the printable recovery
page is a second one (decision 3). The brief's "all three apps are served from the same origin"
holds on a box under one host name, not in the dev stack and not across host names (decision 2).
The till shell also draws the language chooser in a corner on a kitchen display and a kiosk, not
only in its bar (`till-shell.ts:719-721`). Some existing APP tests pin the exact contents of a bar
and must be extended, not left untouched: `apps/dashboard/src/dashboard-app.test.ts:5432-5436` (the
banner's children in order), `apps/till/src/widgets/till-shell.test.ts:815-833` (the session row
in order) and `:662` (the Tab key's path through the phone bar). Backlog A781 already asks for the
shared helper decision 1 introduces.

## Global Constraints

- Storage key `waitron-theme`; stored values `light` | `dark`; no key means Follow device.
- Event `wt-theme-selected`, `detail: { choice: "light" | "dark" | "device" }`, `bubbles: true,
  composed: true`; the option's own `click` is stopped before it is sent (CLAUDE.md §3).
- The trigger's accessible name is `${labels.theme}: ${labels[active]}` ("Theme: Follow device",
  "Tema: Oscuro"). Menu order: Light, Dark, Follow device.
- `data-test` hooks: `theme-trigger`, `theme-light`, `theme-dark`, `theme-device` inside the
  component; `theme-chooser` on each app's element.
- Every colour, spacing, radius and font reads a `--wt-*` token; no literal breakpoint in
  `packages/ui` (`packages/ui/src/no-hardcoded-chrome.test.ts`).
- No server, database, migration or fiscal change.
- Coverage holds `98/98/98/95` in every package touched: `@waitron/ui`, `@waitron/dashboard`,
  `@waitron/setup`, `@waitron/till`. `@waitron/ui-core` is not touched. `main.ts` is excluded from
  coverage in all three apps (`apps/*/vitest.config.ts`), so the one line each task adds there is
  verified by Task 9, not by a test.
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
   the page and the dashboard logo follow at once; on Light or Dark nothing changes. → Task 4,
   the three logo cases flip `emulateColorScheme` inside one test.
4. **Phone width (360 and 390 px):** the dashboard banner, setup's header and the till bar still
   fit on one row with nothing overlapping and the lockup at least 60 px wide. → Task 4 extends
   the existing banner-fit tests; Task 5 and Task 7 add phone-width cases.
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
| `apps/{dashboard,setup,till}/src/main.ts` | `startThemeChoice(document.documentElement)` after `applyTokens` |
| `apps/dashboard/src/dashboard-app.ts` | banner placement, applies picks, logo `media` |
| `apps/dashboard/src/screens/node-recovery-print.ts` | `color-scheme` from the source |
| `apps/setup/src/setup-app.ts` | header placement, applies picks |
| `apps/till/src/widgets/theme-chooser.ts` (new) | `themeChooser()`: the till's one way to draw the chooser with its labels |
| `apps/till/src/till-app.ts` | applies picks |
| `apps/till/src/screens/till-{lock,enrol,counter}-screen.ts`, `apps/till/src/widgets/till-shell.ts` | placement |
| `apps/till/src/widgets/language-chooser-styles.ts` | `.language-corner` spaces two choosers |
| string tables in each app | the four labels |

---

### Task 1: The saved theme choice (`packages/ui/src/theme-choice.ts`)

**Files:**
- Create: `packages/ui/src/theme-choice.ts`
- Create: `packages/ui/src/theme-choice.test.ts`
- Modify: `packages/ui/src/index.ts` (export block beside `ContentLanguageController`, `:113-118`)

**Interfaces:**
- Produces (all exported from `@waitron/ui`):
  - `type ThemeChoice = "light" | "dark" | "device"`
  - `const THEME_CHOICES: readonly ThemeChoice[]` = `["light", "dark", "device"]` (menu order)
  - `const THEME_STORAGE_KEY = "waitron-theme"`
  - `const THEME_SELECTED_EVENT = "wt-theme-selected"`
  - `function isThemeChoice(value: unknown): value is ThemeChoice`
  - `function startThemeChoice(root: HTMLElement): void` — remembers `root` as the theme root, reads
    the saved choice, applies it, and installs ONE `window` `storage` listener however often it is
    called.
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

- [ ] **Step 5: Prove the fallback guards by deletion.** (a) Remove the `try`/`catch` from
  `readSaved` and re-run: "reading blocked storage…" must FAIL with `SecurityError: Denied` thrown
  out of `startThemeChoice`. (b) Make `readSaved` return any stored string unchecked: "treats a
  saved … as Follow device" must FAIL with `data-theme` `"Dark"`, `""` or `"auto"` present.
  (c) Remove the `try` around the write in `chooseTheme`: "a save the browser refuses…" must FAIL
  with `QuotaExceededError`. Restore each and re-run to PASS. Write the three outcomes in the commit
  message.

- [ ] **Step 6: Typecheck, lint, format, commit**

  Run: `pnpm --filter @waitron/ui typecheck && pnpm --filter @waitron/ui lint && pnpm format:check`
  ```bash
  git add packages/ui/src/theme-choice.ts packages/ui/src/theme-choice.test.ts packages/ui/src/index.ts
  git commit -s -m "Add the saved theme choice: one browser setting that sets or clears data-theme (A681)"
  ```

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
  Expected: PASS. Write the `Tests` count down; it must be identical after Step 3.

- [ ] **Step 2: Move the mechanics** into `packages/ui/src/menu-popover.ts` with the interface
  above, and make `wt-language-chooser.ts` use it (`static styles = [baseStyles, menuPopoverStyles, css`…its remaining rules…`]`).
  This is a move, not a rewrite: keep each listener's type, target and options as they are, because
  "listens on the document only while open…" and "listens to the window's scrolling and resizing
  only while open" (`wt-language-chooser.test.ts:590-616`, `:830-855`) count them.

- [ ] **Step 3: Prove the tests did not move and still pass**

  Run: `git diff --exit-code e52c997c0 -- packages/ui/src/components/wt-language-chooser.test.ts packages/ui/src/components/wt-language-chooser.a11y.test.ts`
  Expected: exit 0, no output.
  Run the Step 1 command again. Expected: PASS with the same `Tests` count.
  Also run every other `packages/ui` suite that mounts the language chooser:
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

- [ ] **Step 6: Typecheck, lint, format, commit**

  Run: `pnpm --filter @waitron/ui typecheck && pnpm --filter @waitron/ui lint && pnpm format:check`
  ```bash
  git add packages/ui/src/menu-popover.ts packages/ui/src/components/wt-language-chooser.ts
  git commit -s -m "Move the language chooser's menu placement, dismissal and arrow keys into a shared helper (A681, first slice of A781)"
  ```
  The commit body states: the two language-chooser test files are unchanged (the `git diff
  --exit-code` command, verbatim) and their `Tests` count before and after.

---

### Task 3: The `wt-theme-chooser` primitive

**Files:**
- Create: `packages/ui/src/components/wt-theme-chooser.ts`
- Create: `packages/ui/src/components/wt-theme-chooser.test.ts`
- Create: `packages/ui/src/components/wt-theme-chooser.a11y.test.ts`
- Modify: `packages/ui/src/index.ts` (beside `WtLanguageChooser`, `:142`), `packages/ui/demo/main.ts`
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
  - Icons registered at module load:
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
  the first press.

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

- [ ] **Step 7: Coverage for the package**

  Run: `pnpm --filter @waitron/ui test:coverage`
  Expected: thresholds met; read the per-file rows for `theme-choice.ts`, `menu-popover.ts`,
  `wt-theme-chooser.ts` and `wt-language-chooser.ts` (each at or above 98/98/98/95).

- [ ] **Step 8: Typecheck, lint, format, commit**

  ```bash
  git add packages/ui/src/components/wt-theme-chooser.ts packages/ui/src/components/wt-theme-chooser.test.ts packages/ui/src/components/wt-theme-chooser.a11y.test.ts packages/ui/src/index.ts packages/ui/demo/main.ts
  git commit -s -m "Add wt-theme-chooser: an icon trigger and a Light, Dark, Follow device menu (A681)"
  ```

---

### Task 4: The dashboard

**Files:**
- Modify: `apps/dashboard/src/main.ts:17` (`startThemeChoice(document.documentElement)` on the line
  after `applyTokens`)
- Modify: `apps/dashboard/src/dashboard-app.ts` — import `@waitron/ui/src/components/wt-theme-chooser.js`
  beside `:53`; `#theme = new ThemeChoiceController(this, { applies: true })`; in `#banner`
  (`:1718`) draw `<wt-theme-chooser data-test="theme-chooser" .active=${this.#theme.choice} .labels=${…}>`
  just before the language chooser; the logo source (`:1702`) takes `media=${darkLogoMedia(this.#theme.choice)}`
- Modify: `apps/dashboard/src/screens/node-recovery-print.ts:30`
- Modify: `apps/dashboard/src/i18n/strings.ts` (the four keys in `en` near `nav.account_menu`, `:775`,
  and in `es`, `:3744`)
- Create: `apps/dashboard/src/dashboard-app.theme.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.test.ts` (`:5432-5436`, and the two banner-fit tests at
  `:5439` and `:5534`), `apps/dashboard/src/screens/node-recovery-print.test.ts`

**Interfaces:**
- Consumes: Task 1's `startThemeChoice`, `ThemeChoiceController`, `THEME_STORAGE_KEY`,
  `chooseTheme`; Task 3's element and `WtThemeLabels`.
- Produces: `function darkLogoMedia(choice: ThemeChoice): string` in `dashboard-app.ts` (module
  scope, not exported unless a test needs it): `"all"` for dark, `"not all"` for light,
  `"(prefers-color-scheme: dark)"` for device.

- [ ] **Step 1: Write the failing tests** in `apps/dashboard/src/dashboard-app.theme.test.ts`
  (mount with `mountWidget` from `./widgets/test-helpers.js`, stub the api as
  `dashboard-app.test.ts` does; `afterEach`: `chooseTheme("device")`,
  `localStorage.removeItem(THEME_STORAGE_KEY)`, `commands.emulateColorScheme(null)`, cleanup):
  - `puts the theme chooser in the banner just before the language chooser, signed out and signed in`.
  - `shows the saved choice` — `localStorage.setItem(THEME_STORAGE_KEY, "dark")`,
    `startThemeChoice(host)` before mounting → the chooser's `active` is `"dark"`.
  - `a pick turns the dashboard dark and is kept for the next visit` — `startThemeChoice(host)`;
    open `theme-trigger`, click `theme-dark` → `getComputedStyle(host).getPropertyValue("--wt-color-bg").trim()`
    is `"#101216"` (the dark value, `packages/ui-core/src/tokens/colors.css:127`), stored `"dark"`,
    the chooser's `active` `"dark"`; then pick Follow device → the attribute is gone and nothing is
    stored.
  - `labels the chooser in Spanish` — `setLocale("es-ES")` (restored after): the trigger's name is
    `"Tema: Según el dispositivo"` and the options read `["Claro", "Oscuro", "Según el dispositivo"]`.
  - Logo, reusing `dashboard-app.test.ts:761-785`'s `drawing` / `served` comparison (copy the two
    helpers): `with Dark chosen the banner shows the dark lockup, whatever the computer is set to`
    (emulate `"light"`, then `"dark"`: dark drawing both times); `with Light chosen it shows the
    light lockup, whatever the computer is set to`; `on Follow device it follows the computer, and
    picks change it at once` (emulate dark → dark drawing; pick Light → light drawing with the OS
    still dark; pick Follow device → dark drawing again). Use `expect.poll`.
  - In `node-recovery-print.test.ts`: `gives the printed page the colour scheme of the screen it
    copies its colours from` — a source `div` with `applyTokens` and `data-theme="dark"` → the
    rendered string contains `color-scheme: dark`; `"light"` → `color-scheme: light`; a plain
    `document.body` source (no theme root, computed `normal`) → `color-scheme: light dark`.

- [ ] **Step 2: Extend the existing banner tests (adding, never removing an assertion):** at
  `dashboard-app.test.ts:5432-5436` the expected children become
  `["theme-chooser", "language-chooser", "alerts-bell", "account-menu"]`; in both banner-fit tests
  append `"[data-test=theme-chooser]"` as the LAST entry of `items`, so the index destructuring
  (`:5481`, `:5579`, `:5597-5598`) still points at the same items, and add
  `expect(items.at(-1)!.box.top, "the theme chooser shares the lockup's row").toBeLessThan(logo.bottom)`.
  Leave the existing logo test at `:761` exactly as it is: with nothing saved it is the Follow
  device case.

- [ ] **Step 3: Run to see the new and extended tests fail**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.theme.test.ts src/dashboard-app.test.ts src/screens/node-recovery-print.test.ts`
  Expected: FAIL in the new cases and the extended ones (no `theme-chooser`); the rest PASS.

- [ ] **Step 4: Implement** per the Files list: the four strings; the controller; the chooser in
  `#banner` with labels from `t("theme.label")` … `t("theme.device")`; `darkLogoMedia`; and in
  `renderNodeRecoveryPack` read `getComputedStyle(source).colorScheme` and write it when it is
  `light` or `dark`, else `light dark`.

- [ ] **Step 5: Run to see them pass**, then every dashboard suite that mounts the whole app or the banner:

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.theme.test.ts src/dashboard-app.test.ts src/screens/node-recovery-print.test.ts src/dashboard-app.a11y.test.ts src/dashboard-app.sidebar-fold.test.ts src/dashboard-app.touch.test.ts`
  Expected: PASS. If a 360 px banner-fit case fails because the lockup falls under 60 px, do NOT
  lower the bar or drop the item: stop and report it in the handover as a layout decision for the
  owner, with the measured widths.

- [ ] **Step 6: Prove the logo case by deletion.** Put the literal `"(prefers-color-scheme: dark)"`
  back in place of `darkLogoMedia(...)`: "with Dark chosen the banner shows the dark lockup…" must
  FAIL, showing the light drawing while the OS is light. Restore; PASS.

- [ ] **Step 7: Coverage, typecheck, lint, format, commit**

  Run: `pnpm --filter @waitron/dashboard test:coverage` (thresholds met) and
  `pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/dashboard lint && pnpm format:check`
  ```bash
  git add apps/dashboard/src/main.ts apps/dashboard/src/dashboard-app.ts apps/dashboard/src/screens/node-recovery-print.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/dashboard-app.theme.test.ts apps/dashboard/src/dashboard-app.test.ts apps/dashboard/src/screens/node-recovery-print.test.ts
  git commit -s -m "Dashboard: a Theme menu in the banner, and the logo and recovery page follow it (A681)"
  ```

---

### Task 5: Setup

**Files:**
- Modify: `apps/setup/src/main.ts:6` (`startThemeChoice(document.documentElement)` after `applyTokens`)
- Modify: `apps/setup/src/setup-app.ts` — import the component beside `:25`;
  `#theme = new ThemeChoiceController(this, { applies: true })`; in the header (`:1477-1485`) wrap
  the two choosers in `<div class="header-controls">` (theme chooser first); CSS beside
  `main > header` (`:434-439`): `.header-controls { display: flex; align-items: center; gap: var(--wt-space-1); }`
  — needed because the header is `justify-content: space-between`, which would otherwise spread
  three children apart.
- Modify: `apps/setup/src/i18n/strings/shell.ts` (the four `shell.theme.*` keys in `shellEn` and `shellEs`)
- Create: `apps/setup/src/setup-app.theme.test.ts`
- Modify: `apps/setup/src/setup-app.chooser-clearance.test.ts` (add the theme chooser's cases)

**Interfaces:** Consumes Task 1 and Task 3, as in Task 4.

- [ ] **Step 1: Write the failing tests** in `apps/setup/src/setup-app.theme.test.ts` (mount as
  `setup-app.test.ts:57-70` does; same `afterEach` as Task 4):
  - `it.each([1280, 390])("puts the theme chooser just before the language chooser at the trailing end of the header, %ipx wide")`
    — the theme trigger's right edge is left of the language trigger's left edge, the gap between
    them is `--wt-space-1` (4 px, within 1 px), their vertical middles match the logo's within 1 px,
    and the language trigger's right edge still meets the header's (within 1 px).
  - `a pick applies and keeps the choice` — as in Task 4 (dark `--wt-color-bg` on the host, stored `"dark"`).
  - `labels the chooser in Spanish` — `"Tema: Según el dispositivo"`.
  - In `setup-app.chooser-clearance.test.ts`, add `describe("the theme chooser in the card's header", …)`
    with the same `cases` and the same two checks the language chooser has (`:63-84` "covers
    nothing interactive…" and `:86-125` "opens its menu on screen and over…"), read from
    `[data-test=theme-trigger]` in `wt-theme-chooser`. Extend the "covers nothing interactive" list
    of things a trigger must not cover with the OTHER chooser, so the two never overlap. A
    `describe.each` over the two choosers is fine if every existing assertion survives.

- [ ] **Step 2: Run to see them fail**

  Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app.theme.test.ts src/setup-app.chooser-clearance.test.ts`
  Expected: FAIL in the new cases only.

- [ ] **Step 3: Implement** per the Files list.

- [ ] **Step 4: Run to see them pass**, with the suites that pin the header:

  Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app.theme.test.ts src/setup-app.chooser-clearance.test.ts src/setup-app.test.ts src/setup-app.a11y.test.ts src/i18n/strings.test.ts`
  Expected: PASS, the existing header cases at `setup-app.test.ts:2700-2755` unedited.

- [ ] **Step 5: Coverage, typecheck, lint, format, commit**

  Run: `pnpm --filter @waitron/setup test:coverage` and the three checks.
  ```bash
  git add apps/setup/src/main.ts apps/setup/src/setup-app.ts apps/setup/src/i18n/strings/shell.ts apps/setup/src/setup-app.theme.test.ts apps/setup/src/setup-app.chooser-clearance.test.ts
  git commit -s -m "Setup: a Theme menu beside the language menu (A681)"
  ```

---

### Task 6: The till — start, apply picks, the sign-in, join and counter screens

**Files:**
- Modify: `apps/till/src/main.ts:16` (`startThemeChoice(document.documentElement)` after `applyTokens`)
- Create: `apps/till/src/widgets/theme-chooser.ts`
- Modify: `apps/till/src/till-app.ts` (`new ThemeChoiceController(this, { applies: true })` as a field)
- Modify: `apps/till/src/screens/till-lock-screen.ts:309-315`, `till-enrol-screen.ts:186-192`,
  `till-counter-screen.ts:461-464` — `${themeChooser()}` just before each `wt-language-chooser`,
  and `new ThemeChoiceController(this)` in each class
- Modify: `apps/till/src/widgets/language-chooser-styles.ts` — `.language-corner` gains
  `align-items: center; gap: var(--wt-space-1);`
- Modify: `apps/till/src/i18n/strings.ts` (the four `theme.*` keys in `en` and `es`)
- Create: `apps/till/src/till-app.theme.test.ts`
- Modify: `apps/till/src/screens/till-lock-screen.test.ts`, `till-enrol-screen.test.ts`,
  `till-counter-screen.test.ts` (add cases)

**Interfaces:**
- Consumes: Task 1, Task 3.
- Produces: `export function themeChooser(): TemplateResult` in `apps/till/src/widgets/theme-chooser.ts`
  — imports `@waitron/ui/src/components/wt-theme-chooser.js` and returns
  `<wt-theme-chooser data-test="theme-chooser" .active=${currentThemeChoice()} .labels=${{ theme: t("theme.label"), light: t("theme.light"), dark: t("theme.dark"), device: t("theme.device") }}>`.
  Every till screen draws the chooser through it (Task 7 too). A host that calls it must hold a
  `ThemeChoiceController` (to redraw on a change) and a `LocaleChangeController` (each of the four
  already does — `till-shell.ts:6`, `till-lock-screen.ts:6`, `till-enrol-screen.ts:14`,
  `till-counter-screen.ts:9`).

- [ ] **Step 1: Write the failing tests.**
  - `till-lock-screen.test.ts`: `shows the theme chooser just before the language chooser, at the top right`
    (same parent `.language-corner`, `nextElementSibling` is the language chooser, the corner's right
    edge holds the language chooser); `labels the theme chooser in Spanish`
    (`"Tema: Según el dispositivo"` after `setLocale("es-ES")`, restored after).
  - `till-enrol-screen.test.ts` and `till-counter-screen.test.ts`: the same two cases for their
    placements (the counter one only where its own header is drawn, as its existing language cases
    at `:469-536` do).
  - `apps/till/src/till-app.theme.test.ts` (mount `till-app` the way `till-app.test.ts` reaches the
    lock screen; `afterEach` as in Task 4): `a pick on the sign-in screen turns the till dark and
    keeps it, with nobody signed in` (`startThemeChoice(host)`; pick Dark in the lock screen's
    chooser → host `--wt-color-bg` `#101216`, stored `"dark"`, and the lock screen's chooser shows
    `active` `"dark"`); `a pick on the join screen does the same`.

- [ ] **Step 2: Run to see them fail**

  Run: `pnpm --filter @waitron/till exec vitest run src/till-app.theme.test.ts src/screens/till-lock-screen.test.ts src/screens/till-enrol-screen.test.ts src/screens/till-counter-screen.test.ts`
  Expected: FAIL in the new cases only.

- [ ] **Step 3: Implement** per the Files list.

- [ ] **Step 4: Run to see them pass**, plus the suites that check those screens' layout and names:

  Run: `pnpm --filter @waitron/till exec vitest run src/till-app.theme.test.ts src/screens/till-lock-screen.test.ts src/screens/till-enrol-screen.test.ts src/screens/till-counter-screen.test.ts src/screens/device-screens.phone-margin.test.ts src/till-app.a11y.test.ts src/i18n/strings.test.ts`
  Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format, commit** (`till` coverage runs at the end of Task 7)

  ```bash
  git add apps/till/src/main.ts apps/till/src/widgets/theme-chooser.ts apps/till/src/till-app.ts apps/till/src/screens/till-lock-screen.ts apps/till/src/screens/till-enrol-screen.ts apps/till/src/screens/till-counter-screen.ts apps/till/src/widgets/language-chooser-styles.ts apps/till/src/i18n/strings.ts apps/till/src/till-app.theme.test.ts apps/till/src/screens/till-lock-screen.test.ts apps/till/src/screens/till-enrol-screen.test.ts apps/till/src/screens/till-counter-screen.test.ts
  git commit -s -m "Till: a Theme menu on the sign-in, join and counter screens; the app applies picks (A681)"
  ```

---

### Task 7: The till shell's bar and its kitchen-display corner

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts` — `#chooser()` (`:504-510`) returns
  `${themeChooser()}<wt-language-chooser …>` under its existing `loadLocales` condition, so both
  appear in the bar (`:767`) and the corner (`:721`); `#settled` (`:453-458`) also waits for
  `.head wt-theme-chooser`; add `new ThemeChoiceController(this)`. The ResizeObserver on the
  language chooser (`:426-431`) needs no twin: the theme chooser's width never changes.
- Modify: `apps/till/src/widgets/till-shell.test.ts` (`:815-833` order, `:662` tab path, new cases)
- Modify: `apps/till/src/till-app.theme.test.ts` (Review Focus 5)

**Interfaces:** Consumes `themeChooser()` (Task 6).

- [ ] **Step 1: Extend the existing shell tests (adding, never removing an assertion):** at
  `:815-833` insert `"wt-theme-chooser"` just before `"wt-language-chooser"` in the expected row;
  at `:662` add one `await userEvent.tab(); // the theme chooser` before the language chooser's.

- [ ] **Step 2: Write the failing new tests** in `till-shell.test.ts`:
  - `places the theme chooser in the bar, just before the language chooser` (same parent
    `header .session`, `nextElementSibling` is the language chooser).
  - `keeps the theme chooser beside the language chooser on a kitchen display, at the top right`
    (mirrors `:473-489`).
  - `omits the theme chooser with the language chooser when loadLocales is not supplied` (mirrors `:332-338`).
  - `at 390 wide the bar is one row holding the tabs, both choosers and More, with nothing overlapping`
    — header height ≤ one row (compare with the 1280 px header's height, within 1 px), no two of
    `.tab`, `wt-theme-chooser`, `wt-language-chooser` and `[data-test=more-menu]` overlap, and
    `header.scrollWidth <= header.clientWidth`.
  - In `till-app.theme.test.ts`: `picking a theme with an unsent order open asks nothing and keeps
    the order` — with a basket line added on the counter (reuse the setup of an unsaved-changes case
    in `till-app.unsaved-changes.test.ts`), pick Dark in the shell's chooser: no unsaved-changes
    dialog appears (`wt-unsaved-changes` not open), the basket still holds the line, and the theme
    is dark. Contrast it in the same test with a language pick, which does ask (the existing
    behaviour at `till-app.ts:13222-13225`), so the test shows the two differ.

- [ ] **Step 3: Run to see them fail**

  Run: `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/till-app.theme.test.ts`
  Expected: FAIL in the new and extended cases.

- [ ] **Step 4: Implement** per the Files list.

- [ ] **Step 5: Run to see them pass**, plus everything that measures or walks the bar:

  Run: `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/widgets/till-shell.a11y.test.ts src/till-app.theme.test.ts src/till-app.test.ts src/till-app-boot-and-counter.test.ts`
  Expected: PASS. A bar-fitting case that now moves an item into More one step earlier at a pinned
  width is a real consequence of a wider bar: widen that case's viewport by the theme chooser's
  measured width rather than change its expected items, and say so in the commit. If a case fails
  for any other reason, stop and report it.

- [ ] **Step 6: Coverage, typecheck, lint, format, commit**

  Run: `pnpm --filter @waitron/till test:coverage` (thresholds met) and the three checks.
  ```bash
  git add apps/till/src/widgets/till-shell.ts apps/till/src/widgets/till-shell.test.ts apps/till/src/till-app.theme.test.ts
  git commit -s -m "Till: the Theme menu in the shell's bar and on the kitchen display (A681)"
  ```

---

### Task 8: Docs and backlog

**Files:**
- Modify: `docs/developers/design-system.md`
- Modify: `docs/backlog.md`, `docs/backlog/dashboard.md`

- [ ] **Step 1: design-system.md.**
  - "Themes" (`:59-90`): the selection order gains the product's own step — each app applies this
    browser's saved choice (`startThemeChoice`, `packages/ui/src/theme-choice.ts`) to
    `document.documentElement` before its first render; Light and Dark set `data-theme`, Follow device
    (the default, and the state with nothing saved) leaves the operating system's setting in charge.
    State the key, that other open tabs follow, that a refused save still applies to the open page,
    and the origin limits from decision 2 (two host names for one box keep two choices; the dev
    stack's three ports keep three).
  - Primitives table: a `wt-theme-chooser` row after `wt-language-chooser` (`:691`), in that row's
    style: `active`, `labels`, the trigger's icon and name, the menu order, that it shares the
    language chooser's menu mechanics (`packages/ui/src/menu-popover.ts`) and behaviour (placement,
    Escape, outside press, arrow keys), the `data-test` hooks, and the event column
    `wt-theme-selected — detail: { choice }`.
  - "Dashboard banner" (`:3055`): the theme chooser sits just before the language chooser.
  - "Navigation and language controls" (`:4539-4581`): each place the language chooser is listed,
    the theme chooser sits just before it; on the till's bar it stays on the bar with the tabs and
    the language chooser; a theme pick never asks about unsaved work, unlike a language pick on the
    till; the dashboard logo's `media` rule and the recovery page's `color-scheme` follow the choice.
  - Check every other sentence the change makes false: `grep -n "prefers-color-scheme\|data-theme\|follows the device\|language chooser" docs/developers/*.md`
    and read each hit.
- [ ] **Step 2: backlog.** Delete A681's item 7 from "What to work on next" (`docs/backlog.md:101-102`)
  and replace the count in "they now come after the eight above" with words that do not go stale
  ("after the list above"); delete the A681 entry under "Users, sign-in and the dashboard shell"
  (`:3554-3558`) and the `## A681…` section in `docs/backlog/dashboard.md` (`:1141-1149`); grep
  `a681` afterwards and fix any anchor left pointing at it. Narrow A781 (`docs/backlog.md:3548-3552`):
  `wt-language-chooser` and `wt-theme-chooser` now share `packages/ui/src/menu-popover.ts`;
  what is left is `wt-combobox` and `wt-colour-chooser` (whose grid keys differ). Add one short entry
  in the same area: **the box's own pages and the favicon still follow the device's setting** —
  the trust page (`apps/server/src/trust-page.ts`, `trust-page-logo.ts`) and the other
  server-rendered pages cannot read a browser's saved choice before any app script runs, and the
  favicon is drawn by the browser from the operating system's setting; open. Add any other point the
  tasks left open (for example a 360 px layout question from Task 4 Step 5) as its own short entry.
- [ ] **Step 3: Check and commit.** `docs/` is ignored by prettier, so no format check applies
  (CLAUDE.md §2). This branch is not docs-only, so it goes in the PR.
  ```bash
  git add docs/developers/design-system.md docs/backlog.md docs/backlog/dashboard.md
  git commit -s -m "Docs: the Theme menu, its saved choice and its limits; A681 done, A781 narrowed"
  ```

---

### Task 9: Look at it in a real browser

**Files:** screenshots and the look script in `/Users/clintongormley/waitron-campaign-c/a681-shots/`
(outside the worktree; nothing committed).

- [ ] **Step 1: Start the stack.** `wa-wt demo waitron-feat-a681-theme-choice` (the worktree's
  directory name; `wa-wt ls` shows its URLs — till, dashboard `/manage/`, setup; first slot
  5190, 5191, 5192). Before a `wa-wt reset`, `lsof` the venue folder and port 8080. Dashboard
  sign-in: `owner@demo.waitron.local` / `dashPass123`; till PIN `5555`
  (`docs/ui-review.md:11-16`). If the till shows the dev device picker, pick a till device.
- [ ] **Step 2: Write `look.mjs` there**, loading Playwright from the worktree:
  `createRequire("/Users/clintongormley/workspace/worktrees/waitron-feat-a681-theme-choice/packages/ui/package.json")("playwright")`.
  For each surface — dashboard signed out, dashboard signed in, setup, till sign-in screen — at
  1280×800 and 390×844, take one screenshot per case:
  - Light with the OS dark (`colorScheme: "dark"` context, saved `light` through `addInitScript`
    on that app's origin),
  - Dark with the OS light,
  - Follow device with the OS light, and again with the OS dark,
  - the menu open (one per surface, 390 wide),
  - one pick made through the menu (open, click Dark), screenshotted after the pick.
  Name files `<surface>-<width>-<choice>-os<scheme>.png`. Each app is its own origin in dev
  (decision 2), so set the saved choice per origin.
- [ ] **Step 3: Look at every screenshot** and check: the whole page, not only the chrome, takes
  the chosen theme (no light card on a dark page); the dashboard logo matches the theme; the three
  icons read as sun, moon and half-circle at both widths and in both themes; the trigger and the
  language trigger are the same height and spaced like their neighbours; nothing overlaps or
  wraps at 390; the menu opens below its trigger and on screen; no flash of the wrong theme on load
  (record the page once with `page.screenshot` immediately after `domcontentloaded` with Dark saved
  and the OS light: it must already be dark).
- [ ] **Step 4: Report.** Fix any defect in the task that owns it (with a test where one can
  catch it), then re-shoot. Note in the ledger what was looked at, on which commit, and the
  directory of screenshots. Stop the stack with `wa-wt down waitron-feat-a681-theme-choice`.

---

After Task 9: tell the owner the branch is ready for `/finish-branch`
(`/finish-branch /Users/clintongormley/workspace/worktrees/waitron-feat-a681-theme-choice plan docs/superpowers/plans/2026-10-17-a681-theme-choice.md`).
