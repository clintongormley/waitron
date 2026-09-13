# Onboarding flow corrections — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct what the real-machine walk of the box setup wizard found — its width, the account step, tooltip placement, a misplaced derived line, the language the dashboard opens in, a missing passkey offer, and a venue that ends up with one product language when it needs three.

**Architecture:** Mostly local edits to existing files. Three shared components change (`wt-dialog`, `wt-help-tooltip`, the dashboard's person form); the wizard shell gains a modal wrapper and its screens shed their own card; the provision request grows three optional admin fields that flow through the existing plan/apply path; one nullable column lands on `persons`; the catalogue module's seed stops deriving the venue's product languages from geography for Spain.

**Tech Stack:** TypeScript, Lit 3, Vitest (real headless Chromium for the browser packages, PGlite and Testcontainers PostgreSQL for the server ones), Drizzle, Hono, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-09-13-onboarding-flow-corrections-design.md](../specs/2026-09-13-onboarding-flow-corrections-design.md)

## Global Constraints

- Work in the existing worktree `/Users/clintongormley/workspace/worktrees/waitron-onboarding` on branch `onboarding`. Do not create another worktree.
- Every commit uses `git commit -s`. Commit messages are plain English (CLAUDE.md §6): say what changed and why, name exact identifiers once as pointers, never paraphrase a command that was run.
- Failing test first, watch it fail, then the minimal implementation. A rejected write asserts its domain error code, never just `toBeInstanceOf(Error)`.
- Every colour, spacing, radius and font in CSS reads a `--wt-*` token. No hex, no named colours, no `rem`/`em` in component CSS. Viewport-clamping arithmetic in **JavaScript** may use numeric pixel margins — `wt-row-actions.ts:75` is the precedent the guard does not scan.
- Error codes name the domain concept, never the throwing package. Any file that throws a code imports its registry (`import "./errors.js"`).
- The four browser packages (`@waitron/ui`, `@waitron/dashboard`, `@waitron/till`, `@waitron/setup`) run Vitest in real headless Chromium. Before a run, check free memory (`memory_pressure | grep free`) and the heaviest processes (`ps -axo rss,command | sort -nr | head`), and check nothing else on the machine is already running a browser suite. Scale `--workspace-concurrency` to what is free.
- `TESTCONTAINERS_RYUK_DISABLED=true` is required locally for real-PostgreSQL suites. If a run is interrupted, `pnpm reap`.
- Run focused suites while implementing. Do not add a whole-workspace local run to finish the branch — CI owns the mandatory package suites and coverage.
- `apps/*` is out of scope for the english-only guard, so English UI copy in `apps/setup` and `apps/dashboard` is allowed and deliberate.
- Comments state the invariant and the non-obvious why, never the history. The receipt lives in the commit message.

---

### Task 1: `wt-dialog` can refuse to be dismissed

A native `<dialog>` opened with `showModal()` closes on Escape. The setup wizard must not vanish and leave the operator on an empty page, so the shared dialog gains an opt-out. Default stays `true`, so every existing caller is unchanged.

**Files:**
- Modify: `packages/ui/src/components/wt-dialog.ts:50-51` (properties), `:93-95` (the `<dialog>` element)
- Test: `packages/ui/src/components/wt-dialog.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WtDialog.dismissible: boolean` (default `true`). Because an absent boolean attribute reads as `false` in Lit while the field initializer reads as `true`, callers turn it off with a **property** binding — `.dismissible=${false}` — never the `?dismissible` attribute form. `WtModal` inherits it.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/src/components/wt-dialog.test.ts`:

```ts
test("closes on Escape by default", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  // A cancel that nobody prevents is what the browser turns into a close.
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(false);
});

test("refuses Escape when dismissible is off", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable & { dismissible: boolean };
  el.dismissible = false;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(el.open).toBe(true);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm --filter @waitron/ui test -- wt-dialog.test.ts
```

Expected: both new tests FAIL — the second because nothing prevents the cancel, the first passing only by accident until the handler exists. If the *first* test also fails, stop: the baseline is not what this plan assumes.

- [ ] **Step 3: Add the property and the handler**

In `packages/ui/src/components/wt-dialog.ts`, beside the existing `open`/`heading` properties:

```ts
  /** Whether Escape may close this dialog. Off for a surface with nothing behind it — the setup
   * wizard is the whole page, so a dismissed dialog would strand the operator on an empty document.
   * An absent boolean attribute reads as false in Lit, so a caller turns this off with the property
   * binding `.dismissible=${false}`, never `?dismissible`. */
  @property({ type: Boolean }) dismissible = true;
```

Add the handler beside `onClose`:

```ts
  private onCancel(event: Event): void {
    if (!this.dismissible) event.preventDefault();
  }
```

And wire it on the `<dialog>`, beside the existing `@close`:

```ts
      <dialog
        @close=${this.onClose}
        @cancel=${this.onCancel}
        role="dialog"
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm --filter @waitron/ui test -- wt-dialog.test.ts wt-modal.test.ts wt-dialog.a11y.test.ts
```

Expected: PASS, including the existing dialog and modal suites.

- [ ] **Step 5: Prove the default by deletion**

Temporarily change the initializer to `dismissible = false`. Re-run the command from step 4. Expected: the "closes on Escape by default" test goes RED. Restore `= true` and confirm green again. This is the control that proves the test can tell the two states apart.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/wt-dialog.ts packages/ui/src/components/wt-dialog.test.ts
git commit -s -m "A dialog can refuse to close on Escape

The setup wizard is about to become a modal covering the whole page. If
Escape dismissed it the operator would be left on an empty document with
no way back, so wt-dialog gains a dismissible switch. It defaults to on,
so every dialog and modal in the dashboard and the till behaves exactly
as before; the wizard is the only caller that turns it off."
```

---

### Task 2: the wizard renders inside a modal

**Files:**
- Modify: `apps/setup/src/setup-app.ts:176-187` (styles), `:700-725` (render)
- Modify: `apps/setup/index.html` (body padding)
- Modify, each dropping its outer plain `<wt-card>`: `apps/setup/src/screens/admin-screen.ts`, `cert-screen.ts`, `configuration-preview-screen.ts`, `connect-screen.ts`, `connection-screen.ts`, `done-screen.ts`, `fiscal-test-screen.ts`, `mode-screen.ts`, `provisioning-screen.ts` (**two** — one per render branch), `restore-screen.ts`, `review-screen.ts`, `role-screen.ts`, `venue-screen.ts`
- Leave alone: `apps/setup/src/screens/live-source-screen.ts` has no outer plain card
- Test: `apps/setup/src/setup-app.test.ts`

**Interfaces:**
- Consumes: `WtDialog.dismissible` from Task 1.
- Produces: nothing later tasks rely on.

**The distinction that matters.** A plain `<wt-card>` is the screen's own wrapper and comes out — the modal now supplies that surface and padding. A `<wt-card raised>` is a clickable choice tile *inside* a screen (`mode-screen` has five, `role-screen` two, `live-source-screen` two, `configuration-preview-screen` one) and **stays**. Keep the `wt-card.js` import in any screen that still renders a raised card; drop it from the rest.

- [ ] **Step 1: Write the failing tests**

Append to `apps/setup/src/setup-app.test.ts`, using the file's own `mountSetupApp()` helper (line 48) and its `stubApi()`:

```ts
it("renders the wizard inside an open, non-dismissible modal", async () => {
  const el = await mountSetupApp();
  const modal = el.shadowRoot!.querySelector("wt-modal") as HTMLElement & {
    open: boolean;
    dismissible: boolean;
  };
  expect(modal).not.toBeNull();
  expect(modal.open).toBe(true);
  expect(modal.dismissible).toBe(false);
  // The screens keep their own h1, so the modal is named by a label rather than its heading —
  // setting `heading` would paint a second title above the first.
  expect(modal.getAttribute("aria-label")).toBe("Set up your box");
  expect(modal.getAttribute("heading")).toBeNull();
});

it("mounts the current screen inside the modal, not beside it", async () => {
  const el = await mountSetupApp();
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  expect(modal.querySelector("[data-test^=screen-]")).not.toBeNull();
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm --filter @waitron/setup test -- setup-app.test.ts
```

Expected: FAIL — `modal` is null, because the shell still renders a `<div class="wizard">`.

- [ ] **Step 3: Wrap the shell in the modal**

In `apps/setup/src/setup-app.ts`, add the import beside the other component imports:

```ts
import "@waitron/ui/src/components/wt-modal.js";
```

Replace the styles block (`:176-187`) with:

```ts
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];
```

Replace the opening and closing of the render's container — keep every `@…` listener exactly as it is, only the element changes:

```ts
    return html`<wt-modal
      open
      .dismissible=${false}
      aria-label="Set up your box"
      @setup-defaults-requested=${(event: CustomEvent) => {
```

…and close with `</wt-modal>` instead of `</div>`.

- [ ] **Step 4: Drop the page padding**

In `apps/setup/index.html`, the body rule becomes:

```css
      body {
        margin: 0;
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        font-family: var(--wt-font-family);
      }
```

A modal sits in the browser's top layer, so page padding no longer positions anything; leaving it in would only shift the backdrop's content behind the scrim.

- [ ] **Step 5: Remove each screen's own plain card**

For each file in the Files list above, delete the outer `<wt-card>` and its matching `</wt-card>` and outdent the contents. `provisioning-screen.ts` has one in each of its two render branches — both go. Drop `import "@waitron/ui/src/components/wt-card.js";` **only** from screens with no remaining `<wt-card raised>`.

- [ ] **Step 6: Run the setup suite**

```bash
pnpm --filter @waitron/setup test
```

Expected: PASS. Existing screen tests that query inside the screen's own shadow root are unaffected; any test asserting on a `wt-card` wrapper needs its assertion moved to the content, not deleted — a test rewritten to match the new code hides the regression it was there to catch.

- [ ] **Step 7: Run the accessibility suites in both themes**

```bash
pnpm --filter @waitron/setup test -- a11y
```

Expected: PASS. If axe reports a nameless dialog, the `aria-label` did not reach the inner `<dialog>` — check `WtDialog`'s `ariaLabel` property forwarding.

- [ ] **Step 8: Commit**

```bash
git add apps/setup/index.html apps/setup/src/setup-app.ts apps/setup/src/setup-app.test.ts apps/setup/src/screens
git commit -s -m "Put the setup wizard in a modal so it stops filling the browser

The wizard stretched to whatever width the window happened to be, which
made every form line uncomfortably long on a laptop. It now sits in the
same modal the dashboard uses to edit a person, so it is a centred box of
a readable width on every screen, certificate pages included.

Each screen drops the card it wrapped itself in, because the modal now
supplies that surface and padding. The raised cards inside the mode, role,
live-source and configuration-preview screens are the clickable choices,
not screen chrome, and stay. Escape does not dismiss the wizard."
```

---

### Task 3: tooltips stay on screen

**Files:**
- Modify: `packages/ui/src/components/wt-help-tooltip.ts` (whole component)
- Test: create `packages/ui/src/components/wt-help-tooltip.test.ts` if absent, otherwise extend it
- Check: `packages/ui/src/components/wt-help-tooltip.a11y.test.ts` if present

**Interfaces:**
- Consumes: nothing.
- Produces: no API change. `aria-label`, the slotted content and the `?` trigger all behave as before.

**Why a popover.** The tooltip is absolutely positioned inside its host and centred with `translateX(-50%)`, so one near the right edge of the window runs off it. `wt-row-actions` already solves exactly this with a native popover positioned in JavaScript and clamped to the viewport; copying it keeps one mechanism rather than two. Native popovers also give Escape and outside-click dismissal for free, so the two `document` listeners come out.

- [ ] **Step 1: Write the failing test**

Create or extend `packages/ui/src/components/wt-help-tooltip.test.ts`:

```ts
import { expect, test, afterEach } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import "./wt-help-tooltip.js";

afterEach(cleanup);

test("keeps an edge-anchored tooltip inside the viewport", async () => {
  const el = await mount(
    '<wt-help-tooltip aria-label="Help with province">The province sets the fiscal territory and the time zone.</wt-help-tooltip>',
  );
  // Push the trigger hard against the right edge, which is where the overflow shows up.
  el.style.position = "fixed";
  el.style.insetInlineEnd = "0";
  el.style.insetBlockStart = "0";
  const button = el.shadowRoot!.querySelector("button")!;
  button.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const tip = el.shadowRoot!.querySelector("[popover]") as HTMLElement;
  const box = tip.getBoundingClientRect();
  expect(box.right).toBeLessThanOrEqual(window.innerWidth);
  expect(box.left).toBeGreaterThanOrEqual(0);
});

test("names the tooltip to its trigger while open", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help with province">Body</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  button.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const tip = el.shadowRoot!.querySelector("[popover]") as HTMLElement;
  expect(tip.id).not.toBe("");
  expect(button.getAttribute("aria-describedby")).toBe(tip.id);
  expect(button.getAttribute("aria-expanded")).toBe("true");
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @waitron/ui test -- wt-help-tooltip
```

Expected: FAIL — there is no `[popover]` element, and the current tooltip's right edge exceeds `window.innerWidth`.

- [ ] **Step 3: Rewrite the component over a popover**

Replace `packages/ui/src/components/wt-help-tooltip.ts` with:

```ts
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { uniqueId } from "../interactive.js";

@customElement("wt-help-tooltip")
export class WtHelpTooltip extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
      }

      button {
        display: inline-grid;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-text-muted);
        cursor: pointer;
        place-items: center;
      }

      button:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      .icon {
        display: inline-grid;
        width: calc(var(--wt-space-6) - var(--wt-space-2));
        height: calc(var(--wt-space-6) - var(--wt-space-2));
        border: 1px solid currentColor;
        border-radius: var(--wt-radius-full);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        place-items: center;
      }

      /* Fixed, because positionTooltip writes viewport coordinates onto it. */
      [popover] {
        position: fixed;
        margin: 0;
        max-width: var(--wt-dialog-max-width);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
    `,
  ];

  @property({ attribute: "aria-label" }) override ariaLabel: string | null = null;
  @state() private open = false;

  private readonly tooltipId = uniqueId("wt-help-tooltip");

  @query("button") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;

  private onToggle(event: ToggleEvent): void {
    this.open = event.newState === "open";
  }

  private onTriggerClick(): void {
    if (this.popup.matches(":popover-open")) {
      this.popup.hidePopover();
      return;
    }
    // Show synchronously so the box has real dimensions to position against before the first paint.
    this.popup.showPopover();
    this.positionTooltip();
  }

  /** Centre under the trigger, then clamp to the viewport so an edge-anchored tooltip stays readable.
   * Pixel margins live here rather than in CSS because the arithmetic is viewport-relative; this is
   * the same shape as wt-row-actions. */
  private positionTooltip(): void {
    const anchor = this.trigger.getBoundingClientRect();
    const popup = this.popup.getBoundingClientRect();
    const centred = anchor.left + anchor.width / 2 - popup.width / 2;
    this.popup.style.left = `${Math.max(8, Math.min(centred, innerWidth - popup.width - 8))}px`;
    this.popup.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, innerHeight - popup.height - 8))}px`;
  }

  override render() {
    return html`
      <button
        type="button"
        aria-label=${this.ariaLabel ?? nothing}
        aria-expanded=${this.open}
        aria-describedby=${this.open ? this.tooltipId : nothing}
        @click=${this.onTriggerClick}
      >
        <span class="icon" aria-hidden="true">?</span>
      </button>
      <div id=${this.tooltipId} popover role="tooltip" @toggle=${this.onToggle}>
        <slot></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-help-tooltip": WtHelpTooltip;
  }
}
```

- [ ] **Step 4: Run the tooltip tests**

```bash
pnpm --filter @waitron/ui test -- wt-help-tooltip
```

Expected: PASS.

- [ ] **Step 5: Run every suite that mounts a tooltip**

```bash
pnpm --filter @waitron/ui test
pnpm --filter @waitron/setup test
pnpm --filter @waitron/dashboard test
```

Expected: PASS. Check the memory and other-sessions rule in Global Constraints before starting — these are three browser suites.

Two things to watch for and fix, not paper over: the old component closed on `Escape` via a `document` listener that called `preventDefault()` so an enclosing modal would not also close; a native popover consumes Escape itself, so any test asserting on that listener should now assert the popover closed and the enclosing dialog stayed open. And the popover is always in the DOM now, so a test asserting the tooltip element is *absent* while closed should assert `:popover-open` instead.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/wt-help-tooltip.ts packages/ui/src/components/wt-help-tooltip.test.ts
git commit -s -m "Stop help tooltips running off the edge of the window

A tooltip was pinned dead-centre under its own question mark with nothing
keeping it inside the window, so one on a field near the right edge opened
partly off screen. It now opens as a popover positioned and clamped to the
viewport, the same way the row-actions menu already does it.

Escape and clicking away are now handled by the browser rather than two
document listeners, so the component also stops listening on the document
for as long as the page is alive. The dashboard and the till get the fix
along with the setup wizard."
```

---

### Task 4: the venue screen's territory line and its receipt languages

Two independent corrections on one screen, landing together because they touch the same handful of lines.

**Files:**
- Modify: `apps/setup/src/screens/venue-screen.ts:326-334` (`#seedFromDraft`), `:356-358` (`#onField` postal-code branch), `:369-371` (`#onCountry`), `:382-384` (`#onProvince`), `:608-611` (the territory line), `:678` (the time-zone line)
- Test: `apps/setup/src/screens/venue-screen.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a module-level helper in `venue-screen.ts`:
  `function defaultInvoiceLocales(pack: CountryPack | undefined, area: AdministrativeArea | undefined): string[]`

- [ ] **Step 1: Write the failing tests**

The file already has everything needed except one reader: `mountWidget<SetupVenueScreen>("setup-venue-screen", {})`, `q`, `type` (which handles a native `<select>` as well as a `wt-input`, so the province is `type(el, "province", "08")`), and `toggleLocale(el, locale, checked)`. Do **not** add a second copy of any of them. Add only this, beside the file's other helpers:

```ts
/** The invoice-locale checkboxes currently ticked, in render order. */
const ticked = (el: SetupVenueScreen): string[] =>
  [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="invoiceLocales"]')]
    .filter((input) => input.checked)
    .map((input) => input.value);
```

Then append:

```ts
it("shows the fiscal territory under the province, not above the address", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  const nodes = [...el.shadowRoot!.querySelectorAll("[data-test]")].map((n) =>
    n.getAttribute("data-test"),
  );
  // The line that answers "which fiscal territory?" must come after the control that decides it.
  expect(nodes.indexOf("fiscalTerritory")).toBeGreaterThan(nodes.indexOf("province"));
  // And it sits with the other province-derived fact.
  expect(Math.abs(nodes.indexOf("fiscalTerritory") - nodes.indexOf("timeZone"))).toBe(1);
});

it("pre-ticks Spanish alongside a regional language", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "country", "ES");
  await type(el, "province", "08"); // Barcelona — Catalan
  expect(ticked(el)).toEqual(["es-ES", "ca-ES"]);
});

it("pre-ticks only Spanish where there is no regional language", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "country", "ES");
  await type(el, "province", "28"); // Madrid
  expect(ticked(el)).toEqual(["es-ES"]);
});

it("keeps the operator's own choice when the province changes", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "country", "ES");
  await type(el, "province", "08");
  await toggleLocale(el, "ca-ES", false); // the operator unticks Catalan
  await type(el, "province", "17"); // Girona — also Catalan
  expect(ticked(el)).toEqual(["es-ES"]);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm --filter @waitron/setup test -- venue-screen.test.ts
```

Expected: FAIL — the territory line currently precedes the province control, and Barcelona ticks `ca-ES` alone.

- [ ] **Step 3: Add the default-languages helper**

Near the top of `apps/setup/src/screens/venue-screen.ts`, beside the other module-level constants:

```ts
/**
 * The receipt languages a location starts with. A province with its own language gets that language
 * AND the country's, country first, because a Spanish business issuing in Catalonia issues in both.
 * A province with no language of its own gets the country's alone. Both are defaults the operator can
 * untick; the 1–2 cardinality the server and the database both enforce is what bounds this list.
 */
function defaultInvoiceLocales(
  pack: CountryPack | undefined,
  area: AdministrativeArea | undefined,
): string[] {
  if (pack === undefined) return [];
  const regional = area?.defaultLocale;
  return regional === undefined || regional === pack.defaultLocale
    ? [pack.defaultLocale]
    : [pack.defaultLocale, regional];
}
```

- [ ] **Step 4: Route the four seeding sites through it**

In `#seedFromDraft` (`:326-334`), replace the locale block with:

```ts
    const defaults = defaultInvoiceLocales(pack, area);
    this.invoiceLocales = loc.invoiceLocales ?? (defaults.length > 0 ? defaults : ["es-ES"]);
    if (loc.invoiceLocales !== undefined) {
      this.#invoiceLocalesFollowAreaDefault =
        pack !== undefined && JSON.stringify(loc.invoiceLocales) === JSON.stringify(defaults);
    }
```

In `#onField`'s postal-code branch (`:356-358`):

```ts
      if (pack !== undefined && area !== undefined && this.#invoiceLocalesFollowAreaDefault) {
        this.invoiceLocales = defaultInvoiceLocales(pack, area);
      }
```

In `#onCountry` (`:369-371`):

```ts
    if (pack !== undefined) {
      this.invoiceLocales = defaultInvoiceLocales(pack, undefined);
      this.#invoiceLocalesFollowAreaDefault = true;
    }
```

In `#onProvince` (`:382-384`):

```ts
    if (this.#invoiceLocalesFollowAreaDefault) {
      this.invoiceLocales = defaultInvoiceLocales(pack, area);
    }
```

- [ ] **Step 5: Move the territory line**

Delete the `<p data-test="fiscalTerritory">` block at `:608-611`, and put it directly **above** the time-zone line at `:678`:

```ts
        <p data-test="fiscalTerritory">
          Fiscal territory: ${jurisdiction?.id ?? "Select province"}
        </p>
        <p data-test="timeZone">Time zone: ${area?.timeZone ?? pack?.defaultTimeZone ?? "—"}</p>
```

- [ ] **Step 6: Run the venue tests**

```bash
pnpm --filter @waitron/setup test -- venue-screen
```

Expected: PASS, including the existing suite. An existing test that asserted a single default locale is asserting the old behaviour deliberately — update the expectation, and keep whatever else it was checking.

- [ ] **Step 7: Commit**

```bash
git add apps/setup/src/screens/venue-screen.ts apps/setup/src/screens/venue-screen.test.ts
git commit -s -m "Ask about the province before reporting what it decided

The shop form announced the fiscal territory about fifteen fields above
the province selector that decides it, so on a fresh form it just read
\"Select province\" with no province in sight. It now sits directly above
the time zone, underneath the selector, with the other thing the province
settles.

Receipt languages also start differently: a province with its own language
now pre-ticks Spanish as well, Spanish first, so a Barcelona shop starts
with Spanish and Catalan rather than Catalan alone. Galicia and the Basque
Country come out the same way. It is still only a default, and unticking
one still stops the province from putting it back."
```

---

### Task 5: "Your account", with first and last names

**Files:**
- Modify: `apps/setup/src/screens/admin-screen.ts` (field union, state, seeding, validation, emit, render)
- Modify: `apps/setup/src/api/client.ts:45-50` (`AdminDraft`)
- Test: `apps/setup/src/screens/admin-screen.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AdminDraft` in `apps/setup/src/api/client.ts` gains two required fields:
  ```ts
  export interface AdminDraft {
    firstNames: string;
    lastNames: string;
    displayName: string;
    email: string;
    pin: string;
    password: string;
  }
  ```
  Task 7 consumes the wire shape these produce: `venue.admin.firstNames` and `venue.admin.lastNames`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/setup/src/screens/admin-screen.test.ts`:

```ts
it("is titled for the person filling it in", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  expect(q(el, "h1")!.textContent!.trim()).toBe("Your account");
});

it("fills the display name in from both names while it is untouched", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  await type(el, "firstNames", "Clinton");
  await type(el, "lastNames", "Gormley");
  expect((q(el, "[data-test=displayName]") as HTMLElement & { value: string }).value).toBe(
    "Clinton Gormley",
  );
});

it("stops following the names once the display name is edited by hand", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  await type(el, "firstNames", "Clinton");
  await type(el, "displayName", "Clint");
  await type(el, "lastNames", "Gormley");
  expect((q(el, "[data-test=displayName]") as HTMLElement & { value: string }).value).toBe("Clint");
});

it("does not advance without both names", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  const events = collect(el);
  await type(el, "firstNames", "Clinton");
  await type(el, "email", "clinton@example.com");
  await type(el, "password", "correct horse battery");
  await type(el, "pin", "1234");
  q(el, "[data-test=next]")!.click();
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(q(el, "[data-test=error]")).not.toBeNull();
});

it("carries both names up in the patch", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  const events = collect(el);
  await type(el, "firstNames", "Clinton");
  await type(el, "lastNames", "Gormley");
  await type(el, "email", "clinton@example.com");
  await type(el, "password", "correct horse battery");
  await type(el, "pin", "1234");
  q(el, "[data-test=next]")!.click();
  await el.updateComplete;
  const patch = events.find((e) => e.kind === "patch")!.detail as {
    patch: { venue: { admin: Record<string, string> } };
  };
  expect(patch.patch.venue.admin).toMatchObject({
    firstNames: "Clinton",
    lastNames: "Gormley",
    displayName: "Clinton Gormley",
  });
});

it("restores both names when the operator steps back", async () => {
  const draft: DeepPartial<ProvisionBody> = {
    venue: { admin: { firstNames: "Clinton", lastNames: "Gormley", displayName: "Clint" } },
  };
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", { draft });
  const value = (key: string) =>
    (q(el, `[data-test=${key}]`) as HTMLElement & { value: string }).value;
  expect([value("firstNames"), value("lastNames"), value("displayName")]).toEqual([
    "Clinton",
    "Gormley",
    "Clint",
  ]);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm --filter @waitron/setup test -- admin-screen.test.ts
```

Expected: FAIL — the heading is "The first operator" and there are no name fields.

- [ ] **Step 3: Widen `AdminDraft`**

In `apps/setup/src/api/client.ts`, replace the `AdminDraft` interface body with the shape in **Interfaces** above, keeping the existing doc comment and adding one line to it:

```ts
 * `firstNames`/`lastNames` are the person's real name, required here as they are everywhere else a
 * person is created; `displayName` is what colleagues see and defaults to "First Last".
```

- [ ] **Step 4: Extend the admin screen**

In `apps/setup/src/screens/admin-screen.ts`:

```ts
type AdminField = "firstNames" | "lastNames" | "displayName" | "email" | "password" | "pin";
```

State:

```ts
  @state() private values: Record<AdminField, string> = {
    firstNames: "",
    lastNames: "",
    displayName: "",
    email: "",
    password: "",
    pin: "",
  };
```

Add beside `#seeded`:

```ts
  /** Once the operator types into Display name it stops following the two name fields. Seeding from a
   * draft counts as edited: stepping back must not overwrite a name they chose. */
  #displayNameEdited = false;
```

`#seedFromDraft` gains the two fields and sets the flag:

```ts
    this.values = {
      firstNames: admin.firstNames ?? this.values.firstNames,
      lastNames: admin.lastNames ?? this.values.lastNames,
      displayName: admin.displayName ?? this.values.displayName,
      email: admin.email ?? this.values.email,
      password: admin.password ?? this.values.password,
      pin: admin.pin ?? this.values.pin,
    };
    if (admin.displayName !== undefined) this.#displayNameEdited = true;
```

`#onField` grows the follow rule:

```ts
  #onField(key: AdminField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const values = { ...this.values, [key]: event.detail.value };
    if (key === "displayName") this.#displayNameEdited = true;
    else if (!this.#displayNameEdited && (key === "firstNames" || key === "lastNames")) {
      values.displayName = `${values.firstNames} ${values.lastNames}`.trim();
    }
    this.values = values;
  }
```

`#next` validates the two new fields — replace the four `if` lines with a loop over every field, since all six are required:

```ts
    const invalid = new Set<AdminField>();
    for (const key of ["firstNames", "lastNames", "displayName", "email", "password", "pin"] as const) {
      if (this.values[key].trim() === "") invalid.add(key);
    }
```

and the emit carries them:

```ts
    dispatchSetupPatch(this, {
      venue: {
        admin: {
          firstNames: this.values.firstNames,
          lastNames: this.values.lastNames,
          displayName: this.values.displayName,
          email: this.values.email,
          pin: this.values.pin,
          password: this.values.password,
        },
      },
    });
```

- [ ] **Step 5: Extend the field map, the help text and the render**

`#field`'s `fieldPurpose` map gains:

```ts
      firstNames: { name: "given-name", autocomplete: "given-name" },
      lastNames: { name: "family-name", autocomplete: "family-name" },
```

The help map gains:

```ts
          firstNames: "Your first name, or names, as they appear on your ID.",
          lastNames: "Your surname, or surnames, as they appear on your ID.",
```

The error-summary label map gains `firstNames: "first name"` and `lastNames: "last name"`.

The render's heading and fields become:

```ts
        <h1>Your account</h1>
        <p>Create the account that manages this box. You can add more people later.</p>
        ${this.#field("First name(s)", "firstNames")} ${this.#field("Last name(s)", "lastNames")}
        ${this.#field("Display name", "displayName")} ${this.#field("Email", "email", "email")}
        ${this.#field("Password", "password", "password")} ${this.#field("PIN", "pin", "password")}
```

- [ ] **Step 6: Run the admin and shell tests**

```bash
pnpm --filter @waitron/setup test -- admin-screen setup-app review-screen
```

Expected: PASS. The review screen summarises the draft — if it lists the admin, add the two names there too rather than leaving the summary incomplete.

- [ ] **Step 7: Run the accessibility test for the screen**

```bash
pnpm --filter @waitron/setup test -- admin-screen.a11y
```

Expected: PASS in both themes.

- [ ] **Step 8: Commit**

```bash
git add apps/setup/src/screens/admin-screen.ts apps/setup/src/screens/admin-screen.test.ts apps/setup/src/api/client.ts apps/setup/src/screens/review-screen.ts
git commit -s -m "Ask who you are before asking what to call you

The account step was headed \"The first operator\", which is how the code
thinks about it rather than how the person filling it in does, and it asked
for a display name without ever asking for a name. It is now \"Your account\"
and collects first and last names, which is what the dashboard already
requires of everyone else and what the persons table has always had columns
for.

The display name fills itself in as \"First Last\" while you type and stops
following the moment you edit it, so stepping back and forward never
overwrites a name you chose."
```

---

### Task 6: the dashboard's person form uses both names

**Files:**
- Modify: `apps/dashboard/src/widgets/person-form.ts:66-69`
- Test: `apps/dashboard/src/widgets/person-form.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

The form already fills the display name in, but only from the first names, so "Clinton" + "Gormley" leaves "Clinton". The setup wizard now uses "First Last"; the two places should not disagree.

- [ ] **Step 1: Write the failing test**

Append to `apps/dashboard/src/widgets/person-form.test.ts`, using the file's own `change(el, testId, value)` helper and the `mountWidget<PersonForm>("dashboard-person-form", { open: true })` call its other tests use. Add one reader beside the existing helpers:

```ts
const displayName = (el: PersonForm): string =>
  (el.shadowRoot!.querySelector("[data-test=display-name]") as HTMLElement & { value: string })
    .value;
```

Then:

```ts
it("fills the display name in from both names", async () => {
  const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
  change(el, "first-names", "Clinton");
  change(el, "last-names", "Gormley");
  await el.updateComplete;
  expect(displayName(el)).toBe("Clinton Gormley");
});

it("stops following the names once the display name is edited", async () => {
  const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
  change(el, "first-names", "Clinton");
  change(el, "display-name", "Clint");
  change(el, "last-names", "Gormley");
  await el.updateComplete;
  expect(displayName(el)).toBe("Clint");
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @waitron/dashboard test -- person-form
```

Expected: the first test FAILS with "Clinton"; the second passes already.

- [ ] **Step 3: Make the display name follow both names**

In `apps/dashboard/src/widgets/person-form.ts`, replace the first three branches of `#change`:

```ts
    if (field === "firstNames" || field === "lastNames") {
      if (field === "firstNames") this.firstNames = value;
      else this.lastNames = value;
      if (!this.#displayNameEdited)
        this.displayName = `${this.firstNames} ${this.lastNames}`.trim();
    } else if (field === "displayName") {
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm --filter @waitron/dashboard test -- person-form person-edit staff-screen
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/person-form.ts apps/dashboard/src/widgets/person-form.test.ts
git commit -s -m "The staff form suggests a full name, not just a first name

Adding a person filled the display name in from their first names only, so
\"Clinton\" plus \"Gormley\" suggested \"Clinton\". It now suggests \"Clinton
Gormley\", matching what the setup wizard's account step does, and still
stops following the moment you edit it."
```

---

### Task 7: both names reach the database

**Files:**
- Modify: `packages/provisioning/src/venue-plan.ts:51` (`VenueRequest.admin`), `:35-41` (the `seed-admin` action), `:159-166` (where the action is built)
- Modify: `packages/provisioning/src/venue-apply.ts:98-102` (the insert)
- Modify: `packages/provisioning/src/cli.ts:477` (the request it builds)
- Modify: `apps/server/src/setup-api.ts:363-375` (`parseVenue`'s admin block)
- Modify: `apps/server/src/testing/venue-fixtures.ts:98`
- Test: `packages/provisioning/src/venue-plan.test.ts`, a real-PostgreSQL apply test in `packages/provisioning/src`, `apps/server/src/setup-api.test.ts`

**Interfaces:**
- Consumes: the wire fields Task 5 produces (`venue.admin.firstNames`, `venue.admin.lastNames`).
- Produces:
  ```ts
  // VenueRequest["admin"]
  {
    displayName: string;
    pinHash: string;
    passwordHash: string;
    email: string;
    firstNames?: string | null;
    lastNames?: string | null;
  }
  // VenueAction, kind "seed-admin" — same six fields
  ```
  Optional, so `packages/provisioning`'s CLI keeps compiling and its non-interactive callers keep working without new prompts. The wizard always sends them.

- [ ] **Step 1: Write the failing plan test**

Append to `packages/provisioning/src/venue-plan.test.ts` (reuse the file's existing request fixture builder):

```ts
it("carries the admin's real names into the seed-admin action", () => {
  const actions = planVenue({
    ...sampleRequest(),
    admin: {
      displayName: "Clint",
      firstNames: "Clinton",
      lastNames: "Gormley",
      pinHash: "pin-hash",
      passwordHash: "password-hash",
      email: "clinton@example.com",
    },
  });
  expect(actions.find((a) => a.kind === "seed-admin")).toMatchObject({
    displayName: "Clint",
    firstNames: "Clinton",
    lastNames: "Gormley",
  });
});

it("plans an admin with no real names as null rather than dropping the field", () => {
  const actions = planVenue(sampleRequest()); // no firstNames/lastNames
  expect(actions.find((a) => a.kind === "seed-admin")).toMatchObject({
    firstNames: null,
    lastNames: null,
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @waitron/provisioning test -- venue-plan
```

Expected: FAIL — the action has no such fields.

- [ ] **Step 3: Widen the request and the action**

In `packages/provisioning/src/venue-plan.ts`, `VenueRequest.admin` becomes:

```ts
  /** … existing doc comment … `firstNames`/`lastNames` are the person's real name, optional because
   * the CLI does not prompt for them; the setup wizard always sends both. */
  admin: {
    displayName: string;
    pinHash: string;
    passwordHash: string;
    email: string;
    firstNames?: string | null;
    lastNames?: string | null;
  };
```

The `seed-admin` variant of `VenueAction` gains `firstNames: string | null;` and `lastNames: string | null;` — **not** optional on the action, so the applier never has to guess.

Where the action is built (`:159-166`):

```ts
    {
      kind: "seed-admin",
      displayName: request.admin.displayName,
      firstNames: request.admin.firstNames ?? null,
      lastNames: request.admin.lastNames ?? null,
      pinHash: request.admin.pinHash,
      passwordHash: request.admin.passwordHash,
      email: request.admin.email,
    },
```

- [ ] **Step 4: Widen the insert**

In `packages/provisioning/src/venue-apply.ts`, the `seed-admin` case:

```ts
          await tx.execute(sql`
            insert into persons (tenant_id, display_name, first_names, last_names, pin_hash, password_hash, email, role)
            select ${tenantId}, ${action.displayName}, ${action.firstNames}, ${action.lastNames},
                   ${action.pinHash}, ${action.passwordHash}, ${action.email}, 'admin'
            where not exists (
              select 1 from persons where tenant_id = ${tenantId} and role = 'admin')`);
```

The columns are nullable and carry a `length > 0` check, so `null` is accepted and an empty string is not — which is why the planner normalises to `null` rather than `""`.

- [ ] **Step 5: Write the failing apply test**

Find the existing real-PostgreSQL `applyVenue` suite in `packages/provisioning/src` (the `.pg.test.ts` the `seed-device-profiles` comment refers to) and add:

```ts
it("writes the admin's real names onto the seeded person", async () => {
  await applyVenue(tx, tenantId, planVenue({
    ...sampleRequest(),
    admin: {
      displayName: "Clint",
      firstNames: "Clinton",
      lastNames: "Gormley",
      pinHash: "pin-hash",
      passwordHash: "password-hash",
      email: "clinton@example.com",
    },
  }));
  const { rows } = await tx.execute<{ first_names: string | null; last_names: string | null }>(
    sql`select first_names, last_names from persons where tenant_id = ${tenantId} and role = 'admin'`,
  );
  expect(rows[0]).toEqual({ first_names: "Clinton", last_names: "Gormley" });
});
```

Real PostgreSQL, not PGlite: this asserts what a write as the deployment role actually stores.

- [ ] **Step 6: Accept the fields at the request boundary**

In `apps/server/src/setup-api.ts`, `parseVenue`'s admin block gains an optional-string reader. Add the helper beside `asString`/`asNullableString` if `asNullableString` does not already accept an absent value — read those two helpers first and reuse rather than duplicate. The admin block becomes:

```ts
    admin: {
      displayName: asString(admin.displayName, "admin.displayName"),
      // The person's real name. Optional on the wire so the provisioning CLI's request shape still
      // validates; the wizard always sends both, and an empty string is refused rather than stored,
      // because the column's check refuses it too.
      firstNames: asOptionalNonEmptyString(admin.firstNames, "admin.firstNames"),
      lastNames: asOptionalNonEmptyString(admin.lastNames, "admin.lastNames"),
      pinHash: hashPin(asString(admin.pin, "admin.pin")),
      passwordHash: hashPassword(asString(admin.password, "admin.password")),
      email: normalizeAndValidateEmail(asString(admin.email, "admin.email")),
    },
```

with:

```ts
/** An absent field reads as `null`; a present one must be a non-empty string, because the column it
 * lands in refuses an empty value. */
function asOptionalNonEmptyString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) invalidRequest(field);
  return value;
}
```

- [ ] **Step 7: Write the failing boundary test**

Append to `apps/server/src/setup-api.test.ts`, following the file's existing provision-request helpers:

```ts
it("refuses an empty first name rather than storing it", async () => {
  const response = await postProvision(app, provisionBody({ admin: { firstNames: "" } }));
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: "setup.request_invalid" });
});

it("accepts a provision with no real names", async () => {
  const response = await postProvision(app, provisionBody({ admin: { firstNames: undefined, lastNames: undefined } }));
  expect(response.status).toBe(200);
});
```

- [ ] **Step 8: Update the CLI and the fixtures**

`packages/provisioning/src/cli.ts` — beside the existing `--admin-name` resolution, read two optional flags **without prompting**, so a script driving the CLI non-interactively does not block on a new question:

```ts
    // Optional and never prompted: an existing non-interactive caller must not gain a new question.
    // The setup wizard always supplies both; a CLI-seeded admin can fill them in from the dashboard.
    const adminFirstNames = values["admin-first-names"] ?? null;
    const adminLastNames = values["admin-last-names"] ?? null;
```

Register both in the same `parseArgs` options object as `--admin-name`, as `{ type: "string" }`, and pass them into the `admin` block of the `VenueRequest` it builds.

`apps/server/src/testing/venue-fixtures.ts:98` — add `firstNames: "Test", lastNames: "Operator",` to the fixture's admin so the seeded fixture exercises the new path rather than only the null one.

- [ ] **Step 9: Run every affected suite**

```bash
pnpm --filter @waitron/provisioning test
pnpm --filter @waitron/server test -- setup-api
```

Expected: PASS. If the provisioning suite's real-PostgreSQL tests hang at a 180-second `beforeAll`, `TESTCONTAINERS_RYUK_DISABLED=true` is missing from the environment.

- [ ] **Step 10: Commit**

```bash
git add packages/provisioning/src apps/server/src/setup-api.ts apps/server/src/setup-api.test.ts apps/server/src/testing/venue-fixtures.ts
git commit -s -m "Store the first operator's real name

The wizard now asks for first and last names, so provisioning carries them
into the persons row it seeds. The columns already existed and were simply
never filled, which left the account the box creates as the only person in
the system without a real name against it.

Both are optional in the provisioning request so waitron-provision keeps
working unchanged; it gains two flags and asks no new questions, so a
script driving it non-interactively does not stop at a prompt. An empty
name is refused at the request boundary rather than stored, because the
column refuses it too."
```

---

### Task 8: the account setup creates gets a language

**Files:**
- Modify: `packages/provisioning/src/venue-plan.ts` (`admin.locale` on request and action), `venue-apply.ts` (the insert), `cli.ts`
- Modify: `apps/server/src/setup-api.ts` (`parseVenue` signature and the two `parseProvisionPayload` call sites at `:544` and `:620`)
- Modify: `apps/server/src/login-locale.ts` — no change to its behaviour, only reused
- Test: `apps/server/src/setup-api.test.ts`, the provisioning apply test from Task 7

**Interfaces:**
- Consumes: `VenueRequest.admin` and the `seed-admin` action from Task 7.
- Produces: `VenueRequest["admin"].locale?: string | null` and `seed-admin`'s `locale: string | null`.

**Why the header and not a wizard question.** The provision request is sent by the operator's own browser, so its `Accept-Language` header *is* their language preference. The wizard has no translated text and no chooser, so a visible question would be a language picker on an English-only form. When the browser asks for a language Waitron does not ship, the venue's own geography-derived locale is the fallback — the same chain `readVenueLocale` applies at boot.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/src/setup-api.test.ts`:

```ts
it("gives the admin the language their browser asked for", async () => {
  const response = await postProvision(app, provisionBody(), {
    "Accept-Language": "en-GB,en;q=0.9,es;q=0.8",
  });
  expect(response.status).toBe(200);
  expect(captured.request.admin.locale).toBe("en-GB");
});

it("falls back to the venue's own language when the browser asks for one we do not ship", async () => {
  const response = await postProvision(app, provisionBody(), { "Accept-Language": "fr-FR,fr;q=0.9" });
  expect(response.status).toBe(200);
  // A Barcelona venue: Spanish, not the English floor.
  expect(captured.request.admin.locale).toBe("es-ES");
});

it("falls back to the venue's own language when the browser sends no preference", async () => {
  const response = await postProvision(app, provisionBody(), {});
  expect(response.status).toBe(200);
  expect(captured.request.admin.locale).toBe("es-ES");
});
```

`captured` is whatever the file already uses to record the `ProvisionRequest` handed to `deps.provision` — read the suite's existing stub and reuse it rather than adding a second one.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @waitron/server test -- setup-api
```

Expected: FAIL — `admin.locale` is `undefined`.

- [ ] **Step 3: Thread the header into the parser**

In `apps/server/src/setup-api.ts`, add the imports:

```ts
import { resolveInstalledCountryLocale } from "@waitron/country-packs";
import { FALLBACK_LOCALE, SUPPORTED_LOCALE_CODES } from "@waitron/shared";
import { resolveLoginLocale } from "./login-locale.js";
```

`parseVenue` takes the header, and resolves the locale after it has the country pack and area in hand:

```ts
function parseVenue(venueRaw: unknown, acceptLanguage: string | undefined): VenueRequest {
```

and, inside the returned `admin` block:

```ts
      // The provision request comes from the operator's own browser, so its Accept-Language is their
      // preference. Nothing else in setup asks: the wizard has no translated text and no chooser, and
      // an account with no language falls back to the venue default, which is how a box set up from an
      // English browser used to open the dashboard in Spanish. An unshipped language falls back to the
      // venue's own geography-derived locale — the same chain readVenueLocale applies at boot.
      locale: resolveLoginLocale(
        acceptLanguage,
        resolveInstalledCountryLocale(SUPPORTED_LOCALE_CODES, {
          area: area?.name ?? provinceInput,
          country: country.countryCode,
          fallback: FALLBACK_LOCALE,
        }),
      ),
```

`parseProvisionPayload` takes and forwards it:

```ts
function parseProvisionPayload(
  parsed: unknown,
  devMode: boolean,
  acceptLanguage: string | undefined,
): {
```

and internally `const venue = parseVenue(body.venue, acceptLanguage);`.

Both call sites (`:544` and `:620`) become:

```ts
        const payload = parseProvisionPayload(
          parsed,
          deps.devMode === true,
          c.req.header("Accept-Language"),
        );
```

- [ ] **Step 4: Carry it to the row**

`packages/provisioning/src/venue-plan.ts` — `admin` gains `locale?: string | null;`, the `seed-admin` action gains `locale: string | null;`, and the builder gains `locale: request.admin.locale ?? null,`.

`packages/provisioning/src/venue-apply.ts` — the insert gains the column:

```ts
          await tx.execute(sql`
            insert into persons (tenant_id, display_name, first_names, last_names, locale, pin_hash, password_hash, email, role)
            select ${tenantId}, ${action.displayName}, ${action.firstNames}, ${action.lastNames},
                   ${action.locale}, ${action.pinHash}, ${action.passwordHash}, ${action.email}, 'admin'
            where not exists (
              select 1 from persons where tenant_id = ${tenantId} and role = 'admin')`);
```

`packages/provisioning/src/cli.ts` — pass `locale: null` in its `admin` block, with a one-line comment saying the CLI has no browser to read a preference from.

- [ ] **Step 5: Extend the apply test**

Add `locale: "en-GB"` to the admin in the Task 7 apply test and assert the stored `locale` column alongside the names.

- [ ] **Step 6: Run the suites**

```bash
pnpm --filter @waitron/server test -- setup-api
pnpm --filter @waitron/provisioning test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/setup-api.ts apps/server/src/setup-api.test.ts packages/provisioning/src
git commit -s -m "Set up the box in English and the dashboard opens in English

Setting the box up from an English browser still landed you in a Spanish
dashboard. Nothing in setup ever wrote a language onto the account it
creates, and an account with no language of its own falls back to the venue
default, which geography derives as Spanish for a Spanish venue.

The provision request comes from the operator's own browser, so its
Accept-Language header is read as their preference and written to the
account. A language Waitron does not ship falls back to the venue's own,
using the same chain the server applies at boot. The wizard gains no new
question: it has no translated text to offer a choice between."
```

---

### Task 9: a signed-in person with no saved language gets their browser's

**Files:**
- Modify: `apps/server/src/me-api.ts:412-441` (the `session/me` handler)
- Modify: `apps/dashboard/src/dashboard-app.ts:751-795` (the probe's locale application), `apps/dashboard/src/api/client.ts` (the `getMe` return type)
- Test: `apps/server/src/me-api.test.ts`, `apps/dashboard/src/dashboard-app.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GET /management-api/session/me` gains `sessionDefault: string` — the `Accept-Language` match for this request, already falling back to the venue default. `venueLocale` stays exactly as it is, so nothing that reads it breaks.

Task 8 fixes the account setup creates. This fixes everyone else — anyone invited, or created before this change, still has no saved language.

- [ ] **Step 1: Write the failing server test**

Append to `apps/server/src/me-api.test.ts`:

```ts
it("matches the browser's language for a signed-in person", async () => {
  const response = await getMe(app, session, { "Accept-Language": "en-GB,en;q=0.9" });
  await expect(response.json()).resolves.toMatchObject({ sessionDefault: "en-GB" });
});

it("falls back to the venue's language when the browser asks for one we do not ship", async () => {
  const response = await getMe(app, session, { "Accept-Language": "fr-FR" });
  await expect(response.json()).resolves.toMatchObject({ sessionDefault: "es-ES" });
});

it("varies on the language header so a cache cannot serve one browser's match to another", async () => {
  const response = await getMe(app, session, { "Accept-Language": "en-GB" });
  expect(response.headers.get("Vary")).toContain("Accept-Language");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @waitron/server test -- me-api
```

Expected: FAIL — no such field, no such header.

- [ ] **Step 3: Add the field**

In `apps/server/src/me-api.ts`'s `session/me` handler, before the `c.json`:

```ts
      // The browser's own preference, for a person who has never chosen a language. It is NOT a
      // preference we store: an explicit choice still wins, and this only displaces the venue default.
      c.header("Vary", "Accept-Language");
```

and in the response body, beside `venueLocale`:

```ts
        sessionDefault: resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
```

`resolveLoginLocale` is already imported in this file.

- [ ] **Step 4: Write the failing dashboard test**

Append to `apps/dashboard/src/dashboard-app.test.ts`, using the file's own `stubApi(overrides)` (line 85) and `flush(el)` (line 260) and the `mountWidget<DashboardApp>("dashboard-app", { api })` call its other tests use. Import `currentLocale` from `./i18n/t.js`, and read the file's existing `getMe` stub so these overrides extend it rather than replace fields it needs:

```ts
it("opens in the browser's language when the person has never chosen one", async () => {
  const api = stubApi({
    getMe: async () => ({ ...meResponse, locale: null, venueLocale: "es-ES", sessionDefault: "en-GB" }),
  });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  await flush(el);
  expect(currentLocale()).toBe("en-GB");
});

it("keeps an explicit choice whatever the browser asks for", async () => {
  const api = stubApi({
    getMe: async () => ({ ...meResponse, locale: "es-ES", venueLocale: "es-ES", sessionDefault: "en-GB" }),
  });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  await flush(el);
  expect(currentLocale()).toBe("es-ES");
});
```

`meResponse` is whatever the file's `stubApi` already returns from `getMe` — lift it to a named constant if it is currently inline, rather than writing a second fixture that can drift from it. `setLocale` is module-global, so reset it in an `afterEach` if the file does not already.

- [ ] **Step 5: Run it and watch it fail**

```bash
pnpm --filter @waitron/dashboard test -- dashboard-app
```

Expected: the first test FAILS with `es-ES`.

- [ ] **Step 6: Prefer the browser match over the venue default**

In `apps/dashboard/src/api/client.ts`, add `sessionDefault: string;` to the `getMe` return type beside `venueLocale`.

In `apps/dashboard/src/dashboard-app.ts`, add the field to the `#probeSession` destructured type and change the one line at `:795`:

```ts
    // A person's own choice wins; otherwise their browser's language, and only then the venue's.
    setLocale(resolveActiveLocale(me.locale, me.sessionDefault));
```

`resolveActiveLocale` already floors an unsupported value at English, and `sessionDefault` already falls back to `venueLocale` server-side, so the venue default is still reached — one step later in the chain.

- [ ] **Step 7: Run the suites**

```bash
pnpm --filter @waitron/server test -- me-api
pnpm --filter @waitron/dashboard test
```

Expected: PASS. The till is deliberately untouched: a till is a shared device, so its browser's preference describes the device, not whoever is standing at it.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/me-api.ts apps/server/src/me-api.test.ts apps/dashboard/src/dashboard-app.ts apps/dashboard/src/api/client.ts apps/dashboard/src/dashboard-app.test.ts
git commit -s -m "Match the browser's language for anyone who never chose one

The sign-in screen already matched the browser's language, but the moment
you signed in the dashboard switched to the venue default, because that is
what an account with no saved language fell back to. Anyone invited, or
created before today, is in exactly that position.

The whoami response now carries the same browser match it already computes
for the sign-in screen, and the dashboard prefers it over the venue
default. An explicit choice still wins over both, and the venue default is
still where an unrecognised language lands. The till is left alone: a till
is shared, so its browser's preference describes the device rather than
whoever is standing at it."
```

---

### Task 10: remembering that a passkey was offered

**Files:**
- Modify: `packages/identity/src/schema/persons.ts` (one column)
- Create: `packages/identity/drizzle/0016_passkey_offered.sql` (generated, not hand-written)
- Create: `packages/identity/src/passkey-offer.ts`
- Modify: `packages/identity/src/index.ts` (exports)
- Test: `packages/identity/src/passkey-offer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, both exported from `@waitron/identity`:
  ```ts
  export async function shouldOfferPasskey(
    tx: Transaction,
    input: { tenantId: string; personId: string },
  ): Promise<boolean>;

  export async function markPasskeyOffered(
    tx: Transaction,
    input: { tenantId: string; personId: string },
  ): Promise<void>;
  ```

There is no record of whether anyone has signed in before — `persons` has no last-login column and sessions are removed — so "have we offered yet" is the durable fact to store, and it is also the one the behaviour actually needs.

- [ ] **Step 1: Add the column to the schema**

In `packages/identity/src/schema/persons.ts`, beside `locale`:

```ts
    /** When this person was last offered a passkey at sign-in. Null = never offered, which is what
     * makes the offer appear exactly once: it is stamped when they resolve it, by adding one or by
     * skipping, so a browser that dies mid-offer asks again. Nullable and unstamped for everyone who
     * existed before the offer did, so each of them is offered once too. */
    passkeyOfferedAt: timestamp("passkey_offered_at", { withTimezone: true, mode: "string" }),
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm --filter @waitron/identity db:generate
```

Expected: a new `packages/identity/drizzle/0016_passkey_offered.sql` containing a single `ALTER TABLE "persons" ADD COLUMN "passkey_offered_at" timestamp with time zone;`, plus a `meta/_journal.json` entry at `idx: 16`. **Do not hand-write either.** Read the generated SQL before continuing; if it contains anything beyond that one column, the schema edit was wrong.

`app_user` already holds `SELECT, INSERT, UPDATE` on `persons`, so the new column needs no grant — the privilege is on the table. Do not add one.

- [ ] **Step 3: Write the failing tests**

Create `packages/identity/src/passkey-offer.test.ts`. Use the shared PGlite helper (`usePgliteDb`) — this asserts behaviour, not privileges, so the lighter target is right, and say so in a comment:

```ts
// PGlite, not real PostgreSQL: these assert what the two verbs do, not what a grant permits. Every
// PGlite connection is a superuser, so a privilege claim here would prove nothing (CLAUDE.md §4).
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { usePgliteDb } from "…"; // the package's existing helper — match its sibling suites
import { markPasskeyOffered, shouldOfferPasskey } from "./passkey-offer.js";

describe("the passkey offer", () => {
  it("offers a person who holds no passkey and has never been offered", async () => {
    const { tx, tenantId, personId } = await seedPerson();
    await expect(shouldOfferPasskey(tx, { tenantId, personId })).resolves.toBe(true);
  });

  it("does not offer twice", async () => {
    const { tx, tenantId, personId } = await seedPerson();
    await markPasskeyOffered(tx, { tenantId, personId });
    await expect(shouldOfferPasskey(tx, { tenantId, personId })).resolves.toBe(false);
  });

  it("does not offer a person who already holds a passkey", async () => {
    const { tx, tenantId, personId } = await seedPerson();
    await seedPasskey(tx, { tenantId, personId });
    await expect(shouldOfferPasskey(tx, { tenantId, personId })).resolves.toBe(false);
  });

  it("does not offer for another tenant's person of the same id", async () => {
    const { tx, tenantId, personId } = await seedPerson();
    const other = await seedTenant(tx);
    await expect(shouldOfferPasskey(tx, { tenantId: other, personId })).resolves.toBe(false);
  });

  it("stamps only the named person", async () => {
    const { tx, tenantId, personId } = await seedPerson();
    const colleague = await seedPerson(tx, tenantId);
    await markPasskeyOffered(tx, { tenantId, personId });
    await expect(shouldOfferPasskey(tx, { tenantId, personId: colleague.personId })).resolves.toBe(true);
  });
});
```

Write `seedPerson`, `seedPasskey` and `seedTenant` against the package's existing fixture helpers; do not invent a second seeding path.

The fourth test is the one that matters most: a by-id read still needs its own tenant predicate. One database per tenant is not the query's isolation boundary.

- [ ] **Step 4: Run them and watch them fail**

```bash
pnpm --filter @waitron/identity test -- passkey-offer
```

Expected: FAIL — the module does not exist.

- [ ] **Step 5: Write the two verbs**

Create `packages/identity/src/passkey-offer.ts`:

```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons } from "./schema/persons.js";
import { webauthnCredentials } from "./schema/webauthn.js";

/**
 * Whether to offer this person a passkey at sign-in: they hold none, and have never been offered one.
 * Both reads carry their own tenant predicate — a by-id read is not isolated by one-tenant-per-database.
 */
export async function shouldOfferPasskey(
  tx: Transaction,
  input: { tenantId: string; personId: string },
): Promise<boolean> {
  const [person] = await tx
    .select({ personId: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.tenantId, input.tenantId),
        eq(persons.id, input.personId),
        isNull(persons.passkeyOfferedAt),
      ),
    );
  if (person === undefined) return false;
  const [credential] = await tx
    .select({ id: webauthnCredentials.id })
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.tenantId, input.tenantId),
        eq(webauthnCredentials.personId, input.personId),
      ),
    )
    .limit(1);
  return credential === undefined;
}

/** Record that the offer was made and resolved, so it is never made again. */
export async function markPasskeyOffered(
  tx: Transaction,
  input: { tenantId: string; personId: string },
): Promise<void> {
  await tx
    .update(persons)
    .set({ passkeyOfferedAt: sql`now()` })
    .where(and(eq(persons.tenantId, input.tenantId), eq(persons.id, input.personId)));
}
```

Export both from `packages/identity/src/index.ts`, following the file's existing export style.

- [ ] **Step 6: Run them and watch them pass**

```bash
pnpm --filter @waitron/identity test -- passkey-offer
```

Expected: PASS.

- [ ] **Step 7: Prove the tenant predicate by deletion**

Remove `eq(persons.tenantId, input.tenantId)` from `shouldOfferPasskey`. Re-run. Expected: "does not offer for another tenant's person of the same id" goes RED. Restore it and confirm green. Without this control the test cannot tell a scoped read from an unscoped one.

- [ ] **Step 8: Run the whole identity suite and the schema guards**

```bash
pnpm --filter @waitron/identity test
pnpm test -- classification-complete append-only-enable-always journal-monotonic
```

Expected: PASS. `persons` is an existing classified table and this adds no new one, so the classification list needs no entry — but run the guards to confirm rather than assume, and confirm the journal stayed monotonic after the generate.

- [ ] **Step 9: Commit**

```bash
git add packages/identity/src packages/identity/drizzle
git commit -s -m "Remember whether someone has been offered a passkey

Nothing recorded whether a person had signed in before — persons has no
last-login column and sessions are removed when they end — so there was no
way to offer a passkey once and then stop. A nullable passkey_offered_at
on persons is the fact the behaviour actually needs, and it is stamped when
the offer is resolved rather than when it is shown, so a browser that dies
mid-offer asks again.

Both reads carry their own tenant predicate: a read by person id is not
isolated by one-tenant-per-database. Proven by deleting the predicate and
watching the two-tenant test go red."
```

---

### Task 11: the server tells the dashboard when to offer

**Files:**
- Modify: `apps/server/src/management-api.ts:800-846` (the login route)
- Modify: `apps/server/src/me-api.ts` (the new skip route)
- Test: `apps/server/src/management-api.test.ts`, `apps/server/src/me-api.test.ts`

No new error code: the skip route's only refusal is the existing `management_session.required` that `requireManagementSession` already throws, so `apps/server/src/errors.ts` is untouched.

**Interfaces:**
- Consumes: `shouldOfferPasskey`, `markPasskeyOffered` from Task 10.
- Produces:
  - `POST /management-api/session` response becomes `{ personId: string; offerPasskey: boolean }`.
  - `POST /management-api/session/me/passkey-offer` → `204`, no body. Requires a management session; stamps the session's own person, never a body field.

**One deliberate gap.** The offer rides on the password login response, not on whoami, so a Google sign-in does not trigger it — that path lands through a redirect the sign-in screen never sees a response from. Linking Google happens from the profile screen *after* signing in, so a genuinely first sign-in is always a password sign-in. Anyone who wants a passkey later adds one from their profile. Record this in the spec's Out of scope, which already carries it.

- [ ] **Step 1: Write the failing login test**

Append to `apps/server/src/management-api.test.ts`:

```ts
it("tells a first-time signer-in to offer a passkey", async () => {
  const response = await postLogin(app, { email: admin.email, password: admin.password });
  await expect(response.json()).resolves.toMatchObject({ offerPasskey: true });
});

it("does not offer again once the offer was resolved", async () => {
  await postLogin(app, { email: admin.email, password: admin.password });
  const session = cookieFrom(await postLogin(app, { email: admin.email, password: admin.password }));
  const skip = await postPasskeyOfferSeen(app, session);
  expect(skip.status).toBe(204);
  const again = await postLogin(app, { email: admin.email, password: admin.password });
  await expect(again.json()).resolves.toMatchObject({ offerPasskey: false });
});

it("refuses to record a skip without a session", async () => {
  const response = await postPasskeyOfferSeen(app, null);
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ code: "management_session.required" });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @waitron/server test -- management-api
```

Expected: FAIL — no `offerPasskey`, and the skip route 404s.

- [ ] **Step 3: Compute the offer inside the login transaction**

In `apps/server/src/management-api.ts`, import `shouldOfferPasskey` from `@waitron/identity` beside the existing identity imports, and change the login route's transaction and response:

```ts
        session = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          const opened = await loginManager(tx, {
            tenantId: deps.cfg.tenantId,
            email,
            password,
            totp,
            recoveryCode,
            totpKeyRing: credentialKeyRing,
          });
          // In the same transaction as the login: whether this person should be offered a passkey.
          return {
            ...opened,
            offerPasskey: await shouldOfferPasskey(tx, {
              tenantId: deps.cfg.tenantId,
              personId: opened.personId,
            }),
          };
        });
```

and:

```ts
      return c.json({ personId: session.personId, offerPasskey: session.offerPasskey });
```

- [ ] **Step 4: Add the skip route**

In `apps/server/src/me-api.ts`, beside the other `session/me/*` verbs, following the locale route's shape exactly — identity comes from the session, never from the body:

```ts
  // Record that the sign-in passkey offer was resolved, by adding one or by skipping, so it is never
  // made again. Identity is the SESSION's person, never a body field, so nobody can stamp anyone else.
  // 204 like the other verbs on this surface; the body is ignored entirely.
  app.post("/management-api/session/me/passkey-offer", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        await markPasskeyOffered(tx, { tenantId: deps.cfg.tenantId, personId });
      });
      return c.body(null, 204);
    }),
  );
```

Import `markPasskeyOffered` from `@waitron/identity`.

- [ ] **Step 5: Run the suites**

```bash
pnpm --filter @waitron/server test -- management-api me-api
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/management-api.ts apps/server/src/me-api.ts apps/server/src/management-api.test.ts apps/server/src/me-api.test.ts
git commit -s -m "Sign-in says whether to offer a passkey

The sign-in response now carries whether this person should be offered a
passkey, worked out in the same transaction as the sign-in itself, and a
new route records that the offer was resolved. Who gets stamped comes from
the session, never from the request body, so nobody can mark anyone else.

This rides on the password sign-in response rather than on whoami, so a
Google sign-in does not trigger it — that path comes back as a redirect the
sign-in screen never reads. Linking a Google account happens from the
profile screen after signing in, so a genuinely first sign-in is a password
one. Noted in the design's out-of-scope list."
```

---

### Task 12: the dashboard offers the passkey

**Files:**
- Modify: `apps/dashboard/src/api/client.ts:1600-1607` (`login` return type), plus a new `passkeyOfferSeen()` method
- Modify: `apps/dashboard/src/screens/login-screen.ts:399-432` (`#submit`), `:538-547` (`#offerPasskey`), `:549-591` (`#setupPasskey`), `:966-977` (the Skip button)
- Test: `apps/dashboard/src/screens/login-screen.test.ts`

**Interfaces:**
- Consumes: `POST /management-api/session`'s `offerPasskey`, and `POST /management-api/session/me/passkey-offer`, both from Task 11.
- Produces: nothing.

The offer screen already exists at `login-screen.ts:932` and is reachable only after a password reset or an invitation. This gives it an ordinary-sign-in path and makes both exits record the resolution.

- [ ] **Step 1: Write the failing tests**

Append to `apps/dashboard/src/screens/login-screen.test.ts`, using the file's own `stubApi(overrides)` (line 50), `openPassword(el, email)` (line 98), `input(el, name, value)` (line 103) and `flush(el)` (line 81). Add one helper beside them, since every new test signs in the same way:

```ts
/** Mounts the screen, opens the password step and submits — an ordinary sign-in. */
async function signInWithPassword(overrides: Partial<DashboardApi> = {}) {
  const api = stubApi(overrides);
  const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
  await flush(el);
  await openPassword(el, "clinton@example.com");
  input(el, "current-password", "correct horse battery");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=sign-in]")!.click();
  await flush(el);
  return { el, api };
}
```

Read the password step's render before writing this: use the actual `name` of its password `wt-input` and the actual `data-test` of its submit button rather than the two guessed above, and correct the helper to match.

```ts
it("offers a passkey when the server says to", async () => {
  const { el } = await signInWithPassword({
    login: async () => ({ personId: "p1", offerPasskey: true }),
  });
  expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).not.toBeNull();
});

it("signs straight in when the server says not to", async () => {
  const events: Event[] = [];
  const api = stubApi({ login: async () => ({ personId: "p1", offerPasskey: false }) });
  const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
  el.addEventListener("logged-in", (e) => events.push(e));
  await flush(el);
  await openPassword(el, "clinton@example.com");
  input(el, "current-password", "correct horse battery");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=sign-in]")!.click();
  await flush(el);
  expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).toBeNull();
  expect(events).toHaveLength(1);
});

it("records the resolution when the offer is skipped, then signs in", async () => {
  const seen: number[] = [];
  const { el } = await signInWithPassword({
    login: async () => ({ personId: "p1", offerPasskey: true }),
    passkeyOfferSeen: async () => void seen.push(1),
  });
  const events: Event[] = [];
  el.addEventListener("logged-in", (e) => events.push(e));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
  await flush(el);
  expect(seen).toHaveLength(1);
  expect(events).toHaveLength(1);
});

it("still signs in when recording the skip fails", async () => {
  const { el } = await signInWithPassword({
    login: async () => ({ personId: "p1", offerPasskey: true }),
    passkeyOfferSeen: async () => {
      throw new Error("network");
    },
  });
  const events: Event[] = [];
  el.addEventListener("logged-in", (e) => events.push(e));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
  await flush(el);
  expect(events).toHaveLength(1);
});
```

The `logged-in` listener goes on after the sign-in in the last two, because the offer is showing and the event has not fired yet — attaching it earlier would work too, but this makes it obvious which event the assertion is counting.

The last test is the one that stops a bookkeeping call becoming a way to be locked out of your own dashboard.

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @waitron/dashboard test -- login-screen
```

Expected: FAIL — the offer never appears for an ordinary sign-in.

- [ ] **Step 3: Widen the client**

In `apps/dashboard/src/api/client.ts`:

```ts
  }): Promise<{ personId: string; offerPasskey: boolean }> {
    return this.#request<{ personId: string; offerPasskey: boolean }>(
      "/management-api/session",
      "POST",
      input,
    );
  }

  /** Record that the sign-in passkey offer was resolved, by adding one or by skipping. */
  passkeyOfferSeen(): Promise<void> {
    return this.#request<void>("/management-api/session/me/passkey-offer", "POST");
  }
```

Match the file's existing `#request` signature for a body-less POST rather than inventing one.

- [ ] **Step 4: Offer on an ordinary sign-in**

In `apps/dashboard/src/screens/login-screen.ts`, in `#submit`, destructure rather than spread so the extra field cannot leak into `CompletedLogin`:

```ts
      const { personId, offerPasskey } = await this.api.login({
        email: this.email,
        password: this.password,
        ...(this.secondFactor === ""
          ? {}
          : this.factorMode === "totp"
            ? { totp: this.secondFactor }
            : { recoveryCode: this.secondFactor }),
      });
      if (!this.isConnected) return;
      const detail: CompletedLogin = {
        personId,
        accountSetup: false,
        loginMethod: "password",
        ...this.#preferenceDetail(),
      };
      if (this.offerAfterLogin || offerPasskey) this.#offerPasskey(detail);
      else this.#announceLogin(detail);
```

- [ ] **Step 5: Record the resolution on both exits**

Add one method beside `#offerPasskey`:

```ts
  /** Record that the offer was resolved, then sign in regardless. A failed bookkeeping call must never
   * be a reason somebody cannot reach their own dashboard; the worst case is being offered once more. */
  async #resolvePasskeyOffer(detail: CompletedLogin): Promise<void> {
    try {
      await this.api.passkeyOfferSeen();
    } catch {
      // Deliberately swallowed — see above.
    }
    if (this.isConnected) this.#announceLogin(detail);
  }
```

The Skip button's handler becomes:

```ts
                    @click=${() => {
                      if (!this.busy && this.completedLogin !== null)
                        void this.#resolvePasskeyOffer(this.completedLogin);
                    }}
```

And in `#setupPasskey`, the success line `this.#announceLogin(this.completedLogin);` becomes:

```ts
      await this.#resolvePasskeyOffer(this.completedLogin);
```

- [ ] **Step 6: Run the suites**

```bash
pnpm --filter @waitron/dashboard test -- login-screen dashboard-app
pnpm --filter @waitron/dashboard test -- a11y
```

Expected: PASS. The existing password-reset and invitation paths already reach `#offerPasskey` and must keep working — if one of their tests now fails, the fix is in this change, not in the test.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/screens/login-screen.ts apps/dashboard/src/screens/login-screen.test.ts
git commit -s -m "Offer a passkey the first time you sign in

The screen offering to set up a passkey already existed but was only
reachable after a password reset or an invitation, so the account the setup
wizard creates was never offered one. It now appears on a first ordinary
sign-in for anyone who holds no passkey, and asks exactly once: both exits,
adding one and skipping, record that the offer was resolved.

If recording that fails, you are signed in anyway. The worst case is being
asked once more, which is much better than a bookkeeping call standing
between somebody and their own dashboard."
```

---

### Task 13: a Spanish venue starts with three product languages

**Files:**
- Modify: `packages/catalogue/src/provisioning.ts:28-50` (the seed)
- Test: `packages/catalogue/src/provisioning.test.ts:45-65` (the existing parameterised table)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

**What is hard-coded, and why it says so.** The seed derives the venue's product languages from geography, so a Barcelona venue ends up with Catalan alone and a Madrid one with Spanish alone. The deli needs Spanish as the default with Catalan and English alongside. This is hard-coded for Spain on purpose and is wrong for a Spanish venue outside Catalonia; getting it right needs the venue's region and its chosen languages to drive it, which is the backlog entry Task 14 adds. Non-Spanish countries keep the existing derivation, so the hard-code does not spread.

- [ ] **Step 1: Write the failing test**

`packages/catalogue/src/provisioning.test.ts:45-65` already has a parameterised table over exactly this behaviour — `it.each` of `[country, province, receiptLocale, expectedLanguage]`, asserting the seeded content languages and that the receipt locale is untouched. **Change that table; do not add a second one beside it.** Its title — "seeds %s/%s content independently of the %s receipt locale" — stays true and is the assertion worth keeping.

Widen the table's last column from one language to the whole expected set:

```ts
  it.each([
    // Spain is hard-coded to the deli's three languages, whatever the province — see the comment in
    // provisioning.ts and docs/backlog.md → A9. The four Spanish rows differ only in province, and
    // all four now expect the same set: that sameness IS the hard-code, stated where it can be read.
    ["ES", "Madrid", "en-GB", "es", ["es", "ca", "en"]],
    ["ES", "Barcelona", "es-ES", "es", ["es", "ca", "en"]],
    ["ES", "A Coruña", "en-GB", "es", ["es", "ca", "en"]],
    ["ES", "Bizkaia", "en-GB", "es", ["es", "ca", "en"]],
    // Everywhere else still derives its language from geography.
    ["GB", "London", "es-ES", "en", ["en"]],
    ["XX", "Unknown", "es-ES", "en", ["en"]],
  ])(
    "seeds %s/%s content independently of the %s receipt locale",
    async (country, province, receipt, language, languages) => {
      const node = await venue(country, province, receipt);
      await suite.db.transaction((tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
      expect(await storedLanguages(node.tenantId)).toEqual([
        { default_language: language, languages },
      ]);
      const location = await suite.db.execute<{ invoice_locales: string[] }>(sql`
      select invoice_locales from locations where tenant_id = ${node.tenantId} and id = ${node.locationId}`);
      expect(location.rows).toEqual([{ invoice_locales: [receipt] }]);
    },
  );
```

The four Spanish rows expecting one identical set is the honest way to pin a hard-code: whoever fixes this later sees four rows that should differ and do not, which is exactly the thing to change.

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @waitron/catalogue test -- provisioning
```

Expected: the four Spanish rows FAIL — Madrid seeds `es` alone, Barcelona `ca` alone, A Coruña `gl`, Bizkaia `eu`. The two non-Spanish rows PASS unchanged, which is the control: if `GB` also fails, the table edit broke the derivation rather than the hard-code.

- [ ] **Step 3: Hard-code the Spanish set**

In `packages/catalogue/src/provisioning.ts`, replace the `defaultLanguage` derivation and the insert with:

```ts
      const country = location.rows[0]?.country;
      // HARD-CODED for Spain, and wrong for a Spanish venue outside Catalonia: the deli writes its
      // menu in Spanish, Catalan and English, and nothing in setup asks. Doing this properly means
      // driving the list from the venue's region and the languages it actually chose — see
      // docs/backlog.md → A9, "Product languages are hard-coded at setup". Every other country keeps
      // the geography derivation, so the hard-code does not spread.
      const languages =
        country === "ES"
          ? ["es", "ca", "en"]
          : [
              contentLanguageCode(
                resolveInstalledCountryLocale(geographicLocales, {
                  country,
                  area: location.rows[0]?.province,
                  fallback: FALLBACK_LOCALE,
                }),
              ),
            ];
      const defaultLanguage = languages[0]!;
      const languageArray = sql`array[${sql.join(
        languages.map((language) => sql`${language}`),
        sql`, `,
      )}]`;
      await tx.execute(sql`
        insert into content_languages (tenant_id, default_language, languages)
        values (${node.tenantId}, ${defaultLanguage}, ${languageArray})
        on conflict (tenant_id) do nothing`);
```

The array is built with `sql.join`, not interpolated as one value — Drizzle expands a JavaScript array into a parameter list, which is the same trap `venue-apply.ts:165` documents.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm --filter @waitron/catalogue test
```

Expected: PASS. The `content_languages_default_ck` constraint requires the default to be one of the languages, and `es` is first in the list, so it holds.

- [ ] **Step 5: Commit**

```bash
git add packages/catalogue/src/provisioning.ts packages/catalogue/src/provisioning.test.ts
git commit -s -m "A Spanish venue starts with three product languages

Setup gave a venue one language for its product and menu text, derived
from the province, so a Barcelona shop started with Catalan alone. The deli
writes its menu in Spanish, Catalan and English, and nothing in setup asks
which languages you want.

Spain is hard-coded to Spanish as the default with Catalan and English
alongside. This is wrong for a Spanish venue outside Catalonia and says so
where it is written, with a pointer to the backlog entry for doing it
properly. Every other country keeps deriving its language from geography,
so the hard-code does not spread. All of it stays changeable from the
dashboard afterwards."
```

---

### Task 14: record what this left open

**Files:**
- Modify: `docs/backlog.md` — the A2 section at `:458` and the A9 section at `:655`
- Modify: `docs/ui-review.md:66` (the setup-wizard row)
- Modify: `docs/superpowers/specs/2026-09-13-onboarding-flow-corrections-design.md` (Out of scope)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

CLAUDE.md §6: the backlog is updated in the same change that makes it stale.

- [ ] **Step 1: Add the two entries to the backlog**

Under `### A2. The setup wizard`, in the **Still open after #334** list, add:

```markdown
- *The wizard has no translated text and no language chooser.* It is English only, on a box whose
  venue may well not be. The account it creates now gets the operator's browser language, so the
  dashboard opens in the right language, but the wizard itself does not. Translating it means every
  visible string across its fourteen screens plus the per-operating-system certificate instructions,
  into English and Spanish, using the same catalogue the dashboard registers through
  `@waitron/dashboard-kit`, and a chooser seeded from the browser's preference. Deferred from the
  2026-09-13 corrections by owner decision, as much bigger than everything else in that branch put
  together.
```

Under `### A9. Product depth — after the primary works`, add:

```markdown
- **Product languages are hard-coded at setup** (owner, 2026-09-13). A Spanish venue is seeded with
  Spanish as its default product language and Catalan and English alongside, whatever its province —
  right for the deli, wrong for a Spanish venue outside Catalonia. It replaced a derivation that gave
  a Barcelona venue Catalan alone, which was worse. The proper fix drives the list from the venue's
  region and the languages it actually chose, which probably means setup asking. Do it when there is
  a second region or a second country to be wrong about. The hard-code is in
  `packages/catalogue/src/provisioning.ts` and names this entry; every other country still derives
  its language from geography. Receipt languages are a separate setting and already follow the
  province.
```

- [ ] **Step 2: Update the setup-wizard row in the UI review**

At `docs/ui-review.md:66`, extend the setup row's note so it records what the 2026-09-13 walk found and what was fixed, rather than leaving the row reading as though nothing had happened since. Keep the existing "device trust walkthrough" item, which is still open. Read the surrounding table's column shape first and match it.

- [ ] **Step 3: Add the Google gap to the spec**

In the design document's **Out of scope** list, add:

```markdown
- Offering a passkey after a Google sign-in. The offer rides on the password sign-in response; the
  Google path returns through a redirect the sign-in screen never reads. Linking a Google account
  happens from the profile screen after signing in, so a genuinely first sign-in is a password one.
```

- [ ] **Step 4: Check the documentation guard**

```bash
pnpm test -- claude-md-pointers
```

Expected: PASS. It checks every markdown link and backticked path under `apps/`, `packages/`, `docs/`, `scripts/`, `deploy/`, `bench/`, `.github/` and `.husky/` actually exists.

- [ ] **Step 5: Commit**

```bash
git add docs/backlog.md docs/ui-review.md docs/superpowers/specs/2026-09-13-onboarding-flow-corrections-design.md
git commit -s -m "Record what the setup corrections left open

Two entries. The wizard still has no translated text and no chooser, which
was deferred deliberately as being bigger than everything else in this
branch together. And a Spanish venue's product languages are hard-coded to
Spanish, Catalan and English whatever its province, which is right for the
deli and wrong for anyone else in Spain; the entry says what the proper fix
needs and when it is worth doing.

Also records in the design that a Google sign-in does not trigger the
passkey offer, and updates the setup row in the UI review."
```

---

### Task 15: finish the branch

- [ ] **Step 1: Confirm what changed**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected: the fourteen commits above and nothing else.

- [ ] **Step 2: Run the focused suites for everything touched, together**

Check free memory and what else is testing on the machine first — four of these are browser suites.

```bash
memory_pressure | grep free
ps -axo rss,command | sort -nr | head
pnpm --filter @waitron/ui --filter @waitron/setup --filter @waitron/dashboard --filter @waitron/identity --filter @waitron/catalogue --filter @waitron/provisioning --filter @waitron/server test
```

Expected: PASS. Any failure gets diagnosed and fixed at the root — a flaky test is a defect to fix, never something to re-run past.

- [ ] **Step 3: Hand over to `/finish-branch`**

Do not open the pull request by hand. `/finish-branch` rebases, runs the review wave, applies what it finds, opens the PR and polls CI. This branch touches no fiscal invariant, no tenant isolation, no grant, no migration of an existing table's meaning and no cross-package contract beyond the provision request — but it *does* add a migration and change a by-id read's scoping, so let the skill's own risk assessment decide the weight rather than pre-empting it.

- [ ] **Step 4: Report**

Tell the owner the branch is ready to run `finish-branch`, or — if it is already underway — report its result.
