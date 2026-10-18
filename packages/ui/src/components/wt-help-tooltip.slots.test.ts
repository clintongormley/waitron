import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import "./wt-help-tooltip.js";
import "./wt-input.js";
import "./wt-textarea.js";
import "./wt-combobox.js";
import "./wt-price-input.js";
import "./wt-number-stepper.js";
import "./wt-file-input.js";

afterEach(() => {
  cleanup();
  setHelpMode(false);
});

type Updating = HTMLElement & { updateComplete: Promise<unknown> };

const HOSTS = [
  ["wt-input", ""],
  ["wt-textarea", ""],
  ["wt-combobox", ""],
  ["wt-price-input", 'unit="Each"'],
  ["wt-number-stepper", ""],
  ["wt-file-input", ""],
] as const;

function badgeMarkup(mode: "help-mode" | "always"): string {
  return `<wt-help-tooltip slot="help" mode="${mode}" aria-label="Help: Name">What it is called.</wt-help-tooltip>`;
}

async function mountHost(
  tag: string,
  attributes: string,
  badge: string,
): Promise<{ el: Updating; field: HTMLElement; tooltip: WtHelpTooltip | null }> {
  const el = (await mount(
    `<${tag} label="Name" name="name" ${attributes}>${badge}</${tag}>`,
  )) as Updating;
  // Narrower than the page and below its top, so the field's corner is not the page's.
  host.style.width = "400px";
  host.style.marginBlockStart = "40px";
  const tooltip = el.querySelector<WtHelpTooltip>("wt-help-tooltip");
  await tooltip?.updateComplete;
  await el.updateComplete;
  const field = el.shadowRoot!.querySelector<HTMLElement>("[part=field]")!;
  return { el, field, tooltip };
}

async function turnHelp(on: boolean, ...elements: Array<Updating | null>): Promise<void> {
  setHelpMode(on);
  for (const element of elements) await element?.updateComplete;
}

function boxOf(element: Element) {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

function expectSameBox(actual: ReturnType<typeof boxOf>, expected: ReturnType<typeof boxOf>) {
  for (const key of ["left", "top", "width", "height"] as const) {
    expect(Math.abs(actual[key] - expected[key]), key).toBeLessThanOrEqual(0.5);
  }
}

function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

describe.each(HOSTS)("%s", (tag, attributes) => {
  test(`${tag}: a help-mode badge takes no room, off or on`, async () => {
    const bare = await mountHost(tag, attributes, "");
    const without = boxOf(bare.field);
    cleanup();

    const { el, field, tooltip } = await mountHost(tag, attributes, badgeMarkup("help-mode"));
    expectSameBox(boxOf(field), without);
    await turnHelp(true, tooltip, el);
    expectSameBox(boxOf(field), without);
  });

  test(`${tag}: with help on the badge hangs over the field's top trailing corner`, async () => {
    const { el, field, tooltip } = await mountHost(tag, attributes, badgeMarkup("help-mode"));
    await turnHelp(true, tooltip, el);
    const button = tooltip!.shadowRoot!.querySelector("button")!;
    const corner = field.getBoundingClientRect();
    const centre = centreOf(button);
    expect(Math.abs(centre.x - corner.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - corner.top)).toBeLessThanOrEqual(1);
  });

  test(`${tag}: an always-mode "?" in the help slot sits beside the field box`, async () => {
    const { field, tooltip } = await mountHost(tag, attributes, badgeMarkup("always"));
    expect(tooltip!.assignedSlot?.name).toBe("help");
    const fieldBox = field.getBoundingClientRect();
    const badgeBox = tooltip!.getBoundingClientRect();
    expect(badgeBox.width).toBeGreaterThan(0);
    expect(badgeBox.left).toBeGreaterThanOrEqual(fieldBox.right);
    expect(Math.abs(centreOf(tooltip!).y - centreOf(field).y)).toBeLessThanOrEqual(1);
  });
});

test("wt-number-stepper: stretched to its column by --wt-stepper-field-width: 100%, it keeps its width with a badge, off or on", async () => {
  const stretched = async (badge: string) => {
    const column = await mount(
      '<div style="display: flex; flex-direction: column; width: 400px">' +
        `<wt-number-stepper style="--wt-stepper-field-width: 100%" label="Guests" name="guests">${badge}</wt-number-stepper>` +
        "</div>",
    );
    const el = column.querySelector<Updating>("wt-number-stepper")!;
    await el.updateComplete;
    const tooltip = el.querySelector<WtHelpTooltip>("wt-help-tooltip");
    await tooltip?.updateComplete;
    return { el, tooltip, field: el.shadowRoot!.querySelector<HTMLElement>("[part=field]")! };
  };

  expect((await stretched("")).field.getBoundingClientRect().width).toBe(400);
  cleanup();

  const { el, tooltip, field } = await stretched(badgeMarkup("help-mode"));
  expect(field.getBoundingClientRect().width).toBe(400);
  await turnHelp(true, tooltip, el);
  expect(field.getBoundingClientRect().width).toBe(400);
});
