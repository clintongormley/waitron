import { expect, test, afterEach, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import "./wt-help-tooltip.js";
import "./wt-dialog.js";

afterEach(cleanup);

// Alone in its own file: user activation (`navigator.userActivation.hasBeenActive`) is sticky, and
// once any real click or keypress sets it the scenario below is unreachable. A test file run after
// a clicking one starts with it unset (measured 2026-09-24), so do not move this into
// wt-help-tooltip.test.ts, and do not add a test above it that clicks or types for real; the
// precondition assertion is the backstop.
test("guards a popover opened without a real click from taking an enclosing dismissible dialog down with it on Escape", async () => {
  expect(navigator.userActivation.hasBeenActive).toBe(false);
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
