import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import type { WtRelativeTime } from "./wt-relative-time.js";
import "./wt-relative-time.js";
import "./wt-dialog.js";

// Alone in its own file, as wt-help-tooltip.guard.test.ts is and for the same reason: user activation
// is sticky, and once a real click or keypress sets it the browser's own Escape handling closes the
// popover first, so the component's handler goes unexercised.
test("Escape on an exact time shown without a real click closes it and leaves an enclosing dialog open", async () => {
  expect(navigator.userActivation.hasBeenActive).toBe(false);
  const dialogHost = await mount(
    '<wt-dialog open heading="Devices"><wt-relative-time datetime="2026-10-05T11:49:00.000Z" locale="en-GB"></wt-relative-time></wt-dialog>',
  );
  await (dialogHost as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const dialog = dialogHost.shadowRoot!.querySelector("dialog")!;
  const el = dialogHost.querySelector("wt-relative-time") as WtRelativeTime;
  await el.updateComplete;
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;

  button.click(); // synthetic: grants no user activation
  expect(tip.matches(":popover-open")).toBe(true);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
  expect(dialog.matches(":modal")).toBe(true);
  expect(el.shadowRoot!.activeElement).toBe(button);
  cleanup();
});
