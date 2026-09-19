import { expect, test, afterEach, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import "./wt-help-tooltip.js";
import "./wt-dialog.js";

afterEach(cleanup);

// This test lives in its OWN FILE, and that is the whole point of the file. "No real user
// activation" is a page-level, one-way, sticky browser flag
// (navigator.userActivation.hasBeenActive): once any test's userEvent.click/keyboard call sets it,
// it stays set for every later test sharing that page, and the scenario below becomes unreachable —
// proven by putting a real-click test above it, whereupon it passes with wt-help-tooltip's
// document-keydown guard deleted entirely. Vitest browser mode gives each test FILE its own page,
// so keeping this alone here makes that impossible rather than merely detected. Do not move it into
// wt-help-tooltip.test.ts, and do not add a test above it that clicks or types for real.
// The precondition assertion below is the backstop if either happens anyway.
test("guards a popover opened without a real click from taking an enclosing dismissible dialog down with it on Escape", async () => {
  expect(navigator.userActivation.hasBeenActive).toBe(false);
  // Unlike the real-click case in "closing a tooltip nested in an open modal dialog..." below, a
  // popover opened via a synthetic click (button.click() — the path a test harness or another
  // component driving this button programmatically would take, with no real user gesture) does
  // NOT grant user activation, and focus never lands inside this component either. Deleting
  // wt-help-tooltip's document-scoped keydown guard (added/removed in onToggle) lets a bare
  // Escape close both the popover and the enclosing dismissible dialog in one press. This is the
  // guard's actual justification: defence for a popover shown without going through a real click
  // on its own trigger, not for the tooltip's normal, real-click-only usage, where the browser's
  // own popover Escape-dismiss is already enough.
  const el = await mount(
    '<wt-dialog open heading="Venue"><wt-help-tooltip aria-label="Help with province">Body</wt-help-tooltip></wt-dialog>',
  );
  const dialogEl = el as HTMLElement & { open: boolean; updateComplete: Promise<unknown> };
  await dialogEl.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.matches(":modal")).toBe(true);

  const tooltip = el.querySelector("wt-help-tooltip") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await tooltip.updateComplete;
  const tip = tooltip.shadowRoot!.querySelector("[popover]") as HTMLElement;

  tooltip.shadowRoot!.querySelector("button")!.click(); // synthetic — grants no user activation
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
  expect(dialog.matches(":modal")).toBe(true);
});
