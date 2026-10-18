import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
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
import "./wt-disclosure.js";
import "./wt-dialog.js";
import "./wt-modal.js";
import "./wt-button.js";

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

// Each of these makes the stepper's own box wider than its field box.
test.each([
  ["a grid parent", "display: grid", "", ""],
  ["a flex column", "display: flex; flex-direction: column", "", ""],
  ["a grid parent, right to left", "display: grid", "", "rtl"],
  [
    "a flex column, stretched",
    "display: flex; flex-direction: column",
    'style="--wt-stepper-field-width: 100%"',
    "",
  ],
  [
    "a block parent, beside a long error",
    "",
    'error="Please enter a number greater than zero"',
    "",
  ],
])(
  "wt-number-stepper in %s: with help on the badge hangs over the field's top trailing corner",
  async (_, parentStyle, attributes, dir) => {
    const parent = await mount(
      `<div dir="${dir || "ltr"}" style="${parentStyle}; width: 400px; margin-block-start: 40px">` +
        `<wt-number-stepper label="Guests" name="guests" ${attributes}>${badgeMarkup("help-mode")}</wt-number-stepper>` +
        "</div>",
    );
    const el = parent.querySelector<Updating>("wt-number-stepper")!;
    const tooltip = el.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
    await tooltip.updateComplete;
    await el.updateComplete;
    await turnHelp(true, tooltip, el);
    const field = el
      .shadowRoot!.querySelector<HTMLElement>("[part=field]")!
      .getBoundingClientRect();
    expectCentreAt(badgeButton(tooltip), dir === "rtl" ? field.left : field.right, field.top);
  },
);

function badgeButton(tooltip: WtHelpTooltip): HTMLButtonElement {
  return tooltip.shadowRoot!.querySelector("button")!;
}

function expectCentreAt(element: Element, x: number, y: number) {
  const centre = centreOf(element);
  expect(Math.abs(centre.x - x), "x").toBeLessThanOrEqual(1);
  expect(Math.abs(centre.y - y), "y").toBeLessThanOrEqual(1);
}

async function mountDisclosure(
  attributes: string,
  badge: string,
): Promise<{
  el: Updating;
  header: HTMLElement;
  section: HTMLElement;
  tooltip: WtHelpTooltip | null;
}> {
  const el = (await mount(
    `<wt-disclosure heading="Selling" summary="Available" ${attributes}>${badge}<p>Anyone can order</p></wt-disclosure>`,
  )) as Updating;
  host.style.width = "400px";
  host.style.marginBlockStart = "40px";
  host.style.marginInlineStart = "40px";
  const tooltip = el.querySelector<WtHelpTooltip>("wt-help-tooltip");
  await tooltip?.updateComplete;
  await el.updateComplete;
  return {
    el,
    tooltip,
    header: el.shadowRoot!.querySelector<HTMLElement>(".header")!,
    section: el.shadowRoot!.querySelector<HTMLElement>("[part=section]")!,
  };
}

describe.each(["", "ruled"])("wt-disclosure %s", (attributes) => {
  test("wt-disclosure: a help-mode badge takes no room, off or on", async () => {
    const bare = await mountDisclosure(attributes, "");
    const without = boxOf(bare.header);
    expect(bare.header.getBoundingClientRect().width).toBe(
      bare.section.getBoundingClientRect().width,
    );
    cleanup();

    const { el, header, section, tooltip } = await mountDisclosure(
      attributes,
      badgeMarkup("help-mode"),
    );
    expectSameBox(boxOf(header), without);
    expect(header.getBoundingClientRect().width).toBe(section.getBoundingClientRect().width);
    await turnHelp(true, tooltip, el);
    expectSameBox(boxOf(header), without);
    expect(header.getBoundingClientRect().width).toBe(section.getBoundingClientRect().width);
  });
});

test("wt-disclosure: with help on the badge hangs over the heading row's top trailing corner", async () => {
  const { el, header, tooltip } = await mountDisclosure("", badgeMarkup("help-mode"));
  await turnHelp(true, tooltip, el);
  const corner = header.getBoundingClientRect();
  expectCentreAt(badgeButton(tooltip!), corner.right, corner.top);
});

test("wt-disclosure: tapping the badge opens its box and leaves the section as it was", async () => {
  const { el, header, tooltip } = await mountDisclosure("", badgeMarkup("help-mode"));
  await turnHelp(true, tooltip, el);
  const toggles: Event[] = [];
  el.addEventListener("wt-toggle", (event) => toggles.push(event));
  const expanded = header.getAttribute("aria-expanded");
  await userEvent.click(badgeButton(tooltip!));
  const popup = tooltip!.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  await el.updateComplete;
  expect(toggles).toHaveLength(0);
  expect(header.getAttribute("aria-expanded")).toBe(expanded);
});

test("wt-disclosure: with help on, Tab goes from the header to the badge", async () => {
  const { el, header, tooltip } = await mountDisclosure("", badgeMarkup("help-mode"));
  await turnHelp(true, tooltip, el);
  header.focus();
  expect(el.shadowRoot!.activeElement).toBe(header);
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement).toBe(tooltip);
  expect(tooltip!.shadowRoot!.activeElement).toBe(badgeButton(tooltip!));
});

type Openable = Updating & { open: boolean };

async function openDialog(
  markup: string,
): Promise<{ el: Openable; heading: HTMLElement | null; tooltip: WtHelpTooltip | null }> {
  const el = (await mount(markup)) as Openable;
  el.open = true;
  await el.updateComplete;
  const tooltip = el.querySelector<WtHelpTooltip>(":scope > wt-help-tooltip");
  await tooltip?.updateComplete;
  return { el, tooltip, heading: el.shadowRoot!.querySelector<HTMLElement>("h2") };
}

const dialogMarkup = (badge: string) =>
  `<wt-dialog heading="Void sale">${badge}<p>This will create a corrective record.</p></wt-dialog>`;

test("wt-dialog: a help-mode badge takes no room, off or on", async () => {
  const bare = await openDialog(dialogMarkup(""));
  const without = boxOf(bare.heading!);
  cleanup();

  const { el, heading, tooltip } = await openDialog(dialogMarkup(badgeMarkup("help-mode")));
  expectSameBox(boxOf(heading!), without);
  await turnHelp(true, tooltip, el);
  expectSameBox(boxOf(heading!), without);
});

test("wt-dialog: with help on the badge hangs over the heading's top trailing corner", async () => {
  const { el, heading, tooltip } = await openDialog(dialogMarkup(badgeMarkup("help-mode")));
  await turnHelp(true, tooltip, el);
  const corner = heading!.getBoundingClientRect();
  expectCentreAt(badgeButton(tooltip!), corner.right, corner.top);
});

test("wt-dialog: the dialog's name is still its heading alone", async () => {
  const { el, heading, tooltip } = await openDialog(dialogMarkup(badgeMarkup("help-mode")));
  await turnHelp(true, tooltip, el);
  expect(tooltip!.assignedSlot?.name).toBe("help");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(dialog.getAttribute("aria-labelledby")).toBe(heading!.id);
  expect(heading!.querySelector("slot")).toBeNull();
});

test("wt-dialog: opening with help on puts focus on the first body control, not the badge", async () => {
  setHelpMode(true);
  const { el } = await openDialog(
    `<wt-dialog heading="Rename">${badgeMarkup("help-mode")}<wt-input label="Name" name="name"></wt-input></wt-dialog>`,
  );
  const input = el.querySelector("wt-input")!;
  await vi.waitFor(() => expect(document.activeElement).toBe(input));
});

/** The focused element, looked for through every shadow root on the way down. */
function deepActiveElement(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}

test.each([
  [
    "only footer buttons",
    '<p>This will create a corrective record.</p><wt-button slot="footer" variant="secondary">Cancel</wt-button><wt-button slot="footer">Void</wt-button>',
  ],
  ["nothing focusable", "<p>This will create a corrective record.</p>"],
])(
  "wt-dialog: opening with help on puts focus where it goes with help off, when it holds %s",
  async (_, content) => {
    const markup = `<wt-dialog heading="Void sale">${badgeMarkup("help-mode")}${content}</wt-dialog>`;
    await openDialog(markup);
    const withHelpOff = deepActiveElement();
    expect(withHelpOff).not.toBeNull();
    const offPath = describeFocus(withHelpOff!);
    cleanup();

    setHelpMode(true);
    const { tooltip } = await openDialog(markup);
    expect(tooltip!.checkVisibility()).toBe(true);
    expect(describeFocus(deepActiveElement()!)).toBe(offPath);
  },
);

/** Where focus is, by position, so two separate mounts of the same markup can be compared. */
function describeFocus(element: Element): string {
  const path: string[] = [];
  let at: Node | null = element;
  while (at && at !== host) {
    const parent: Node | null = at.parentNode;
    if (at instanceof ShadowRoot) {
      path.unshift("#shadow");
      at = at.host;
      continue;
    }
    const index = parent ? Array.prototype.indexOf.call(parent.childNodes, at) : -1;
    path.unshift(`${(at as Element).tagName ?? "#text"}[${index}]`);
    at = parent;
  }
  return path.join(" > ");
}

test("wt-dialog: with no heading there is no help slot", async () => {
  const { tooltip } = await openDialog(
    `<wt-dialog aria-label="Log out">${badgeMarkup("help-mode")}<p>Are you sure?</p></wt-dialog>`,
  );
  expect(tooltip!.assignedSlot).toBeNull();
});

test("wt-modal at phone width: a full-width field's badge adds no sideways scroll", async () => {
  await page.viewport(390, 844);
  try {
    const measure = async (badgeStyle: string) => {
      const { el } = await openDialog(
        '<wt-modal heading="Product"><wt-input label="Name" name="name">' +
          `<wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Name" style="${badgeStyle}">What it is called.</wt-help-tooltip>` +
          "</wt-input></wt-modal>",
      );
      const tooltip = el.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
      await tooltip.updateComplete;
      await turnHelp(true, tooltip, el);
      expect(tooltip.checkVisibility()).toBe(true);
      const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
      return { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth };
    };

    const dashboard = await measure("");
    expect(dashboard.scrollWidth, JSON.stringify(dashboard)).toBe(dashboard.clientWidth);
    cleanup();
    setHelpMode(false);

    // A till's larger badge hangs further out than the padding, so the measurement can see overflow.
    const till = await measure("--wt-help-badge-target: 32px");
    expect(till.scrollWidth, JSON.stringify(till)).toBeGreaterThan(till.clientWidth);
  } finally {
    await page.viewport(1280, 900);
  }
});
