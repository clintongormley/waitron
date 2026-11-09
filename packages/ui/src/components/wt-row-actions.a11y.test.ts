import { registerIcons } from "./wt-icon.js";
import axe from "axe-core";
import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-row-actions.js";
import "./wt-button.js";

registerIcons({
  bin: "M6 1.75H10V3.25H13.5V4.75H2.5V3.25H6ZM3.75 4.75H12.25V13a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1ZM5 4.75V12.75H11V4.75ZM6.5 6.5H7.5V11H6.5ZM8.5 6.5H9.5V11H8.5Z",
});

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-row-actions a11y (%s theme)", (theme) => {
  test.each([false, true])("direct Delete, disabled=%s", async (disabled) => {
    const el = await mountThemed(
      `<wt-row-actions label="Actions: Starters"><wt-button data-action="delete" aria-label="Delete: Starters" ${disabled ? "disabled" : ""}>Delete</wt-button></wt-row-actions>`,
      theme,
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("button")!.getAttribute("aria-label"))
      .toBe("Delete: Starters");
    await expectNoA11yViolations(host);
  });
  test.each(["Ann: Working", "Ann: Trabajando"])(
    "a named trigger (%s), closed and open",
    async (label) => {
      const el = await mountThemed(
        `<wt-row-actions label="${label}"><span slot="trigger">${label}</span><wt-button>Log out</wt-button></wt-row-actions>`,
        theme,
      );
      const trigger = el.shadowRoot!.querySelector("button")!;
      expect(
        trigger.querySelector<HTMLSlotElement>('slot[name="trigger"]')?.assignedElements(),
      ).toHaveLength(1);
      await expectNoA11yViolations(host);
      await userEvent.click(trigger);
      await expectNoA11yViolations(host);
    },
  );
  test("announces a role menu with its checked choice in both closed and open states", async () => {
    const el = await mountThemed(
      `<wt-row-actions label="Bills"><div role="menu" aria-label="Bills">
      <button role="menuitemradio" aria-checked="true">Bill 1</button>
      <button role="menuitemradio" aria-checked="false">Bill 2</button>
    </div></wt-row-actions>`,
      theme,
    );
    await expectNoA11yViolations(host);
    await userEvent.click(el.shadowRoot!.querySelector("button")!);
    await expectNoA11yViolations(host);
  });

  test("names the hamburger and its open create, edit and delete actions", async () => {
    const el = await mountThemed(
      `<wt-row-actions label="Department actions">
      <wt-button>Create department</wt-button><wt-button>Edit</wt-button>
      <wt-button variant="danger">Delete</wt-button>
    </wt-row-actions>`,
      theme,
    );
    await expectNoA11yViolations(host);
    await userEvent.click(el.shadowRoot!.querySelector("button")!);
    await expectNoA11yViolations(host);
  });

  test("an open menu holding a link entry beside button entries", async () => {
    const el = await mountThemed(
      `<wt-row-actions label="Actions for Wine">
        <a href="#wine">Open Wine</a>
        <wt-button variant="secondary" align="start">Edit</wt-button>
        <wt-button variant="secondary" align="start">Remove</wt-button>
      </wt-row-actions>`,
      theme,
    );
    (el as unknown as { show(): void }).show();
    expect(el.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await expectNoA11yViolations(host);
  });

  test("an open menu taller than the room under its trigger, which opens below and scrolls", async () => {
    const actions = Array.from(
      { length: 30 },
      (_, index) => `<wt-button variant="ghost" align="start">Action ${index + 1}</wt-button>`,
    ).join("");
    const el = await mountThemed(
      `<wt-row-actions label="Table actions" opens-below>${actions}</wt-row-actions>`,
      theme,
    );
    (el as unknown as { show(): void }).show();
    const popup = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
    await expectNoA11yViolations(host);
  });

  test("detects a missing accessible name on the hamburger", async () => {
    const el = await mountThemed(
      '<wt-row-actions label="Department actions"></wt-row-actions>',
      theme,
    );
    el.shadowRoot!.querySelector("button")!.removeAttribute("aria-label");
    const result = await axe.run(host);
    expect(result.violations.map(({ id }) => id)).toContain("button-name");
  });

  test("a trigger carrying a badge, closed and open", async () => {
    const el = await mountThemed(
      `<wt-row-actions label="Alerts, 3 open"><span slot="badge">3</span>
        <wt-button>See all alerts</wt-button></wt-row-actions>`,
      theme,
    );
    await expectNoA11yViolations(host);
    (el as unknown as { show(): void }).show();
    await expectNoA11yViolations(host);
  });
});
