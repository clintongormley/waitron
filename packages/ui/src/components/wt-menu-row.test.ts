import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtButton } from "./wt-button.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import type { WtMenuRow } from "./wt-menu-row.js";
import type { WtRowActions } from "./wt-row-actions.js";
import "./wt-button.js";
import "./wt-menu-row.js";
import "./wt-row-actions.js";

afterEach(() => {
  cleanup();
  setHelpMode(false);
});

const MENU =
  '<wt-row-actions label="Actions" align="end">' +
  '<wt-menu-row help="Edits it." help-label="Help: Edit"><wt-button variant="ghost" align="start">Edit</wt-button></wt-menu-row>' +
  '<wt-button variant="ghost" align="start">Delete</wt-button>' +
  "</wt-row-actions>";

async function mountMenu(help = "Edits it.") {
  const menu = (await mount(MENU)) as WtRowActions;
  const row = menu.querySelector<WtMenuRow>("wt-menu-row")!;
  row.help = help;
  await row.updateComplete;
  const [edit, remove] = [...menu.querySelectorAll<WtButton>("wt-button")] as [WtButton, WtButton];
  await Promise.all([edit.updateComplete, remove.updateComplete]);
  let editClicks = 0;
  edit.addEventListener("click", () => editClicks++);
  const trigger = menu.shadowRoot!.querySelector("button")!;
  const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  return {
    menu,
    row,
    edit,
    remove,
    trigger,
    popup,
    editClicks: () => editClicks,
    badge: () => row.shadowRoot!.querySelector<WtHelpTooltip>("wt-help-tooltip"),
  };
}

function parts(badge: WtHelpTooltip) {
  const root = badge.shadowRoot!;
  return {
    button: root.querySelector("button")!,
    icon: root.querySelector<HTMLElement>(".icon")!,
    box: root.querySelector<HTMLElement>("[popover]")!,
  };
}

async function turnHelp(on: boolean, badge: WtHelpTooltip | null): Promise<void> {
  setHelpMode(on);
  await badge?.updateComplete;
}

function tapMin(): number {
  return parseFloat(getComputedStyle(host).getPropertyValue("--wt-tap-min"));
}

function deepActiveElement(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}

function innerButton(button: WtButton): HTMLButtonElement {
  return button.shadowRoot!.querySelector("button")!;
}

async function open(menu: WtRowActions, popup: HTMLElement): Promise<void> {
  menu.show();
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
}

test("while help is off it draws only the option, as wide as the row", async () => {
  const { menu, row, edit, popup, badge } = await mountMenu();
  await open(menu, popup);
  const rowWidth = row.getBoundingClientRect().width;
  expect(edit.getBoundingClientRect().width).toBe(rowWidth);
  expect(badge()!.checkVisibility()).toBe(false);

  await turnHelp(true, badge());
  expect(row.getBoundingClientRect().width - edit.getBoundingClientRect().width).toBeCloseTo(
    tapMin(),
    0,
  );
});

test("while help is on the badge takes its own --wt-tap-min square at the trailing end, beside the option", async () => {
  const { menu, row, edit, popup, badge } = await mountMenu();
  await turnHelp(true, badge());
  await open(menu, popup);
  const size = tapMin();
  const button = parts(badge()!).button.getBoundingClientRect();
  const option = edit.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  expect(button.width).toBe(size);
  expect(button.height).toBe(size);
  expect(button.left).toBeGreaterThanOrEqual(option.right);
  expect(button.right).toBeCloseTo(rowBox.right, 0);
  expect(option.height).toBeCloseTo(rowBox.height, 0);
});

test("a right-to-left menu puts the badge at the left", async () => {
  const { menu, row, edit, popup, badge } = await mountMenu();
  host.setAttribute("dir", "rtl");
  await turnHelp(true, badge());
  await open(menu, popup);
  const button = parts(badge()!).button.getBoundingClientRect();
  const option = edit.getBoundingClientRect();
  expect(button.right).toBeLessThanOrEqual(option.left);
  expect(button.left).toBeCloseTo(row.getBoundingClientRect().left, 0);
});

test("a tap on the badge opens its box, leaves the menu open and does not run the option", async () => {
  const { menu, popup, badge, editClicks } = await mountMenu();
  await turnHelp(true, badge());
  await open(menu, popup);
  const { button, box } = parts(badge()!);
  await userEvent.click(button);
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(true));
  expect(popup.matches(":popover-open")).toBe(true);
  expect(editClicks()).toBe(0);
});

test("a tap on the option runs it and closes the menu, and an open box with it", async () => {
  const { menu, edit, popup, badge, editClicks } = await mountMenu();
  await turnHelp(true, badge());
  await open(menu, popup);
  const { button, box } = parts(badge()!);
  await userEvent.click(button);
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(true));
  await userEvent.click(innerButton(edit));
  expect(editClicks()).toBe(1);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  expect(box.matches(":popover-open")).toBe(false);
});

test("a second tap on the badge closes its box and leaves the menu open", async () => {
  const { menu, popup, badge } = await mountMenu();
  await turnHelp(true, badge());
  await open(menu, popup);
  const { button, box } = parts(badge()!);
  await userEvent.click(button);
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(true));
  await userEvent.click(button);
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(false));
  expect(popup.matches(":popover-open")).toBe(true);
});

test("the first Escape closes only the box and returns focus to the badge; the next closes the menu", async () => {
  const { menu, trigger, popup, badge } = await mountMenu();
  await turnHelp(true, badge());
  await open(menu, popup);
  const { button, box } = parts(badge()!);
  await userEvent.click(button);
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(true));

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(false));
  expect(popup.matches(":popover-open")).toBe(true);
  expect(deepActiveElement()).toBe(button);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  expect(deepActiveElement()).toBe(trigger);
});

test("Tab goes from the option to its badge, then to the next option", async () => {
  const { menu, edit, remove, trigger, popup, badge } = await mountMenu();
  await turnHelp(true, badge());
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  expect(menu.shadowRoot!.activeElement).toBe(trigger);

  await userEvent.keyboard("{Tab}");
  expect(deepActiveElement()).toBe(innerButton(edit));
  await userEvent.keyboard("{Tab}");
  expect(deepActiveElement()).toBe(parts(badge()!).button);
  await userEvent.keyboard("{Tab}");
  expect(deepActiveElement()).toBe(innerButton(remove));
});

test("Enter and Space on the badge open and close its box without running the option or closing the menu", async () => {
  const { menu, popup, badge, editClicks } = await mountMenu();
  await turnHelp(true, badge());
  await open(menu, popup);
  const { button, box } = parts(badge()!);
  button.focus();

  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(true));
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(false));
  await userEvent.keyboard(" ");
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(true));
  await userEvent.keyboard(" ");
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(false));

  expect(popup.matches(":popover-open")).toBe(true);
  expect(editClicks()).toBe(0);
});

test("with help off the badge adds no Tab stop", async () => {
  const { menu, edit, remove, popup } = await mountMenu();
  await open(menu, popup);
  innerButton(edit).focus();
  expect(deepActiveElement()).toBe(innerButton(edit));
  await userEvent.keyboard("{Tab}");
  expect(deepActiveElement()).toBe(innerButton(remove));
});

test("an open menu shows its badges when help is turned on, and hides them when it is turned off", async () => {
  const { menu, popup, badge } = await mountMenu();
  await open(menu, popup);
  expect(badge()!.checkVisibility()).toBe(false);

  await turnHelp(true, badge());
  expect(badge()!.checkVisibility()).toBe(true);
  expect(popup.matches(":popover-open")).toBe(true);

  await turnHelp(false, badge());
  expect(badge()!.checkVisibility()).toBe(false);
  expect(popup.matches(":popover-open")).toBe(true);

  await turnHelp(true, badge());
  const { button, box } = parts(badge()!);
  await userEvent.click(button);
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(true));
  await turnHelp(false, badge());
  await vi.waitFor(() => expect(box.matches(":popover-open")).toBe(false));
  expect(popup.matches(":popover-open")).toBe(true);
});

test("with no help text it draws no badge", async () => {
  const { menu, popup, badge } = await mountMenu("");
  setHelpMode(true);
  await open(menu, popup);
  expect(badge()).toBeNull();
});

test("the badge is named by help-label, says whether its box is open, and is described by the box once open", async () => {
  const { menu, popup, badge } = await mountMenu();
  await turnHelp(true, badge());
  await open(menu, popup);
  const tooltip = badge()!;
  const { button, box } = parts(tooltip);
  expect(button.getAttribute("aria-label")).toBe("Help: Edit");
  expect(button.getAttribute("aria-expanded")).toBe("false");

  await userEvent.click(button);
  await vi.waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("true"));
  expect(button.getAttribute("aria-describedby")).toBe(box.id);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("false"));
  expect(button.hasAttribute("aria-describedby")).toBe(false);
});

test("paints the badge from the tokens", async () => {
  const { menu, popup, badge } = await mountMenu();
  host.style.setProperty("--wt-tap-min", "50px");
  host.style.setProperty("--wt-help-badge-size", "30px");
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  await turnHelp(true, badge());
  await open(menu, popup);
  const { button, icon } = parts(badge()!);
  expect(button.getBoundingClientRect()).toMatchObject({ width: 50, height: 50 });
  expect(icon.getBoundingClientRect()).toMatchObject({ width: 30, height: 30 });
  expect(getComputedStyle(icon).backgroundColor).toBe("rgb(1, 2, 3)");
});
