import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-button.js";
import type { WtFormActions } from "./wt-form-actions.js";
import "./wt-form-actions.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-form-actions a11y (%s theme)", (theme) => {
  test("cancel and primary actions", async () => {
    await mountThemed(
      '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button slot="cancel" variant="danger">Delete</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with the form's message above the actions", async () => {
    const el = (await mountThemed(
      '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary" disabled>Save</wt-button></wt-form-actions>',
      theme,
    )) as WtFormActions;
    el.error = "Correct the highlighted fields to continue.";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("held at the bottom of a scrolling form, with its message and line", async () => {
    const scroller = (await mountThemed(
      `<div style="height: 200px; overflow-y: auto; color: var(--wt-color-text)">
        <div style="height: 1000px">Fields</div>
        <wt-form-actions error="Correct the highlighted fields to continue."><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary" disabled>Save</wt-button></wt-form-actions>
      </div>`,
      theme,
    )) as HTMLElement;
    const el = scroller.querySelector<WtFormActions>("wt-form-actions")!;
    await el.updateComplete;
    const bar = el.shadowRoot!.querySelector<HTMLElement>("[data-bar]")!;
    await vi.waitFor(() => expect(getComputedStyle(bar).borderTopWidth).toBe("1px"));
    await expectNoA11yViolations(host);
  });
});
