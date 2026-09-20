import { expect, test, afterEach, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import "./wt-help-tooltip.js";
import "./wt-dialog.js";

afterEach(cleanup);

// First in this file on purpose: it opens the tooltip with a synthetic click, so no real click has
// happened in this document yet. That is the case the document keydown handler exists for — once a
// real click has granted user activation, the browser's own popover Escape-dismiss closes the
// tooltip anyway and the handler's work is invisible.
test("Escape closes a tooltip that was opened without a real click, moves focus to its button and goes no further", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  const elsewhere = document.createElement("input");
  host.append(elsewhere);
  elsewhere.focus();

  button.click();
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
  expect(document.activeElement).toBe(elsewhere);

  const seenByThePage: string[] = [];
  const record = (event: KeyboardEvent) => seenByThePage.push(event.key);
  document.addEventListener("keydown", record);
  try {
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
  } finally {
    document.removeEventListener("keydown", record);
  }
  expect(el.shadowRoot!.activeElement).toBe(button);
  expect(seenByThePage).toEqual([]);
});

test("toggles closed on a second click and back open on a third", async () => {
  // A real click triggers an "auto" popover's light-dismiss between pointerdown and click UNLESS
  // the trigger is the popover's declared invoker (popovertarget) — without that, onTriggerClick
  // always observed the popover already closed and reopened it, so a second tap on "?" just made
  // the bubble flash instead of closing it. Proven with three real userEvent.click calls (a
  // synthetic button.click() does not exercise light-dismiss at all, which is why the other tests
  // in this file that use it would not have caught this).
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;

  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));

  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
});

test("opens explanatory content from an accessible question-mark button", async () => {
  const el = await mount(
    '<wt-help-tooltip aria-label="About email addresses">Use the address this person checks.</wt-help-tooltip>',
  );
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  expect(button.textContent?.trim()).toBe("?");
  expect(button.getAttribute("aria-label")).toBe("About email addresses");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  // The popover element is now always in the DOM (that's what lets showPopover() measure it
  // before the first paint) — closed is ":popover-open" being false, not the element being absent.
  expect(tip.matches(":popover-open")).toBe(false);

  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-describedby")).toBe(tip.id);
  const content = tip
    .querySelector("slot")!
    .assignedNodes()
    .map((node) => node.textContent)
    .join("")
    .trim();
  expect(content).toBe("Use the address this person checks.");
});

test("closes when the user clicks anywhere outside it", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

  const outside = document.createElement("button");
  outside.textContent = "Outside";
  host.append(outside);
  // A native "auto" popover's own light-dismiss only reacts to a real, trusted click — a
  // synthetic dispatchEvent would not exercise it, so this goes through userEvent like
  // wt-row-actions' equivalent test.
  await userEvent.click(outside);
  expect(tip.matches(":popover-open")).toBe(false);
});

test("a click inside the tooltip does not close it", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

  await userEvent.click(tip);
  expect(tip.matches(":popover-open")).toBe(true);
});

test("Escape closes it and returns focus to its button", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  // A real click, not the synthetic button.click() the positioning/aria tests below use, so the
  // trigger is actually focused — Escape is a real keypress and the browser delivers it to
  // whatever has focus.
  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
  expect(el.shadowRoot!.activeElement).toBe(button);
});

test("the question-mark button meets the minimum tap target", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const rect = el.shadowRoot!.querySelector("button")!.getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
});

test("keeps an edge-anchored tooltip inside the viewport", async () => {
  const el = await mount(
    '<wt-help-tooltip aria-label="Help with province">The province sets the fiscal territory and the time zone.</wt-help-tooltip>',
  );
  // Push the trigger hard against the right edge, which is where the overflow shows up.
  el.style.position = "fixed";
  el.style.insetInlineEnd = "0";
  el.style.insetBlockStart = "0";
  const edgeButton = el.shadowRoot!.querySelector("button")!;
  const edgeTip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(edgeButton);
  await vi.waitFor(() => expect(edgeTip.matches(":popover-open")).toBe(true));
  const box = edgeTip.getBoundingClientRect();
  // The exact 8px margin from positionTooltip(), not a bare "inside the window" check: a
  // shrink-to-fit fixed box WRAPS narrower at the viewport edge instead of overflowing, so
  // `right <= innerWidth` alone holds even with the clamp deleted entirely. Pinning the exact
  // margin is what catches that.
  expect(box.right).toBeLessThanOrEqual(innerWidth - 8);
  expect(box.left).toBeGreaterThanOrEqual(8);

  // A reference instance with room on every side, so an edge box cannot satisfy the margin check
  // above by shrinking (wrapping its text) instead of actually being repositioned.
  const reference = await mount(
    '<wt-help-tooltip aria-label="Help with province">The province sets the fiscal territory and the time zone.</wt-help-tooltip>',
  );
  const referenceButton = reference.shadowRoot!.querySelector("button")!;
  const referenceTip = reference.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(referenceButton);
  await vi.waitFor(() => expect(referenceTip.matches(":popover-open")).toBe(true));
  expect(box.width).toBeCloseTo(referenceTip.getBoundingClientRect().width, 0);
});

test("centres the tooltip under its trigger and sits just below it", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Short</wt-help-tooltip>');
  // Room on every side, so neither clamp in positionTooltip() applies and the unclamped
  // placement is what the measurements below see.
  el.style.position = "fixed";
  el.style.insetInlineStart = "50%";
  el.style.insetBlockStart = "50%";
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

  const anchor = button.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  expect(box.left + box.width / 2).toBeCloseTo(anchor.left + anchor.width / 2, 0);
  expect(box.top).toBeCloseTo(anchor.bottom + 4, 0);
});

test("holds a left-edge tooltip at the same margin as a right-edge one", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Short</wt-help-tooltip>');
  // Hard against the left edge: centring alone would put the box at a negative x.
  el.style.position = "fixed";
  el.style.insetInlineStart = "0";
  el.style.insetBlockStart = "0";
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

  expect(tip.getBoundingClientRect().left).toBeCloseTo(8, 0);
});

test("lifts a bottom-anchored tooltip back inside the viewport", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Short</wt-help-tooltip>');
  // Hard against the bottom edge: placing the box below the trigger would put it off screen.
  el.style.position = "fixed";
  el.style.insetInlineStart = "50%";
  el.style.insetBlockEnd = "0";
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

  const box = tip.getBoundingClientRect();
  expect(box.bottom).toBeCloseTo(innerHeight - 8, 0);
  expect(box.top).toBeLessThan(button.getBoundingClientRect().bottom);
});

test("names the tooltip to its trigger while open", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help with province">Body</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(button);
  // this.open only flips once the popover's asynchronous "toggle" event fires, so a single
  // updateComplete right after the click can race it — vi.waitFor polls past that race instead of
  // taking one snapshot, and fails on its own timeout rather than hanging on a missed event.
  await vi.waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("true"));
  expect(tip.id).not.toBe("");
  // The "wt-help-tooltip-N" shape, not just non-emptiness: uniqueId() always appends a "-N"
  // counter, so emptying the prefix still leaves a non-empty id such as "-3".
  expect(tip.id).toMatch(/^wt-help-tooltip-\d+$/);
  expect(button.getAttribute("aria-describedby")).toBe(tip.id);
});

test("closing a tooltip nested in an open modal dialog leaves the dialog open", async () => {
  // The setup wizard now puts every screen inside a modal <dialog> (showModal()), so every
  // tooltip in it is a popover nested inside a top-layer dialog — a case task-2 (the dialog) and
  // task-3 (this popover) each land without the other in view. Popovers and modal dialogs both
  // live in the browser's top layer, and Escape is meant to close only the topmost one; this
  // proves that holds for this specific nesting rather than assuming it from the spec.
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
  const button = tooltip.shadowRoot!.querySelector("button")!;
  const tip = tooltip.shadowRoot!.querySelector("[popover]") as HTMLElement;
  // A real click so the trigger is actually focused. With a real click, a bare Escape already
  // closes only the popover here even with wt-help-tooltip's own document-keydown guard removed
  // entirely — a real click grants user activation, and the browser's own popover Escape-dismiss
  // already respects the top-layer ordering in that case. The guard test at the top of this file
  // is the one with teeth for that handler: it needs no real click anywhere to have happened yet,
  // which is why it has to run first.
  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
  // The popover's own bounds stay on screen even nested inside the dialog's top-layer stacking
  // context — the same clamp exercised in the edge-anchored test above.
  const box = tip.getBoundingClientRect();
  expect(box.right).toBeLessThanOrEqual(window.innerWidth);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(box.top).toBeGreaterThanOrEqual(0);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
  expect(dialog.matches(":modal")).toBe(true);
});

test("says the tooltip is shut again once it closes", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;

  await userEvent.click(button);
  await vi.waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("true"));

  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
  await vi.waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("false"));
  expect(button.hasAttribute("aria-describedby")).toBe(false);
});

test("stops watching for Escape once the tooltip is closed", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  const elsewhere = document.createElement("input");
  host.append(elsewhere);

  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));

  elsewhere.focus();
  const seenByThePage: boolean[] = [];
  const record = (event: KeyboardEvent) => seenByThePage.push(event.defaultPrevented);
  document.addEventListener("keydown", record);
  try {
    await userEvent.keyboard("{Escape}");
  } finally {
    document.removeEventListener("keydown", record);
  }
  // One Escape, reaching the page untouched, and focus still where the reader put it.
  expect(seenByThePage).toEqual([false]);
  expect(document.activeElement).toBe(elsewhere);
});

test("leaves the tooltip open when the reader presses a key that is not Escape", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  const tip = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(button);
  await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

  const seenByThePage: boolean[] = [];
  const record = (event: KeyboardEvent) => seenByThePage.push(event.defaultPrevented);
  document.addEventListener("keydown", record);
  try {
    await userEvent.keyboard("a");
  } finally {
    document.removeEventListener("keydown", record);
  }
  expect(tip.matches(":popover-open")).toBe(true);
  expect(seenByThePage).toEqual([false]);
});

test("tells its controllers when the tooltip leaves the page", async () => {
  // A Lit element's controllers hear about removal only through the base class's
  // disconnectedCallback, which this component's own override has to pass the call on to.
  const el = (await mount(
    '<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>',
  )) as WtHelpTooltip;
  const stops: string[] = [];
  el.addController({ hostDisconnected: () => stops.push("stopped") });

  el.remove();

  expect(stops).toEqual(["stopped"]);
});
