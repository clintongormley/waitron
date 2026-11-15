import { html } from "lit";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, mount, host } from "./test-helpers.js";
import { startWithPopover } from "./popover-startup.js";
import type { WtCombobox } from "./components/wt-combobox.js";
import type { WtColourChooser } from "./components/wt-colour-chooser.js";
import type { WtDialog } from "./components/wt-dialog.js";
import type { WtDataTable } from "./components/wt-data-table.js";
import "./components/wt-row-actions.js";
import "./components/wt-help-tooltip.js";
import "./components/wt-combobox.js";
import "./components/wt-colour-chooser.js";
import "./components/wt-relative-time.js";
import "./components/wt-language-chooser.js";
import "./components/wt-theme-chooser.js";
import "./components/wt-data-table.js";
import "./components/wt-dialog.js";

beforeAll(async () => {
  expect(Object.hasOwn(HTMLElement.prototype, "popover")).toBe(false);
  await new Promise<void>((ready, failed) => startWithPopover(ready, failed));
});
afterEach(async () => {
  cleanup();
  await page.viewport(1280, 720);
});

const families = [
  [
    "row actions",
    '<wt-row-actions label="Actions"><button>Edit</button><button>Delete</button></wt-row-actions>',
    "button",
  ],
  ["help", '<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>', "button"],
  ["combobox", '<wt-combobox label="Station"></wt-combobox>', "button.trigger"],
  ["colour", '<wt-colour-chooser label="Colour"></wt-colour-chooser>', '[part="field"]'],
  [
    "time",
    '<wt-relative-time datetime="2026-11-15T12:00:00Z" locale="en-GB"></wt-relative-time>',
    "button",
  ],
  ["language", '<wt-language-chooser active="en-GB"></wt-language-chooser>', "wt-button"],
  ["theme", "<wt-theme-chooser></wt-theme-chooser>", "wt-button"],
] as const;

function visible(popup: HTMLElement): void {
  expect(popup.matches(":popover-open")).toBe(true);
  const rect = popup.getBoundingClientRect();
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(innerWidth);
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.bottom).toBeLessThanOrEqual(innerHeight);
}

for (const width of [390, 1280]) {
  test.each(families)(
    `%s opens, re-clicks and dismisses at ${width}px`,
    async (name, markup, selector) => {
      await page.viewport(width, 844);
      const el = await mount(markup);
      host.style.padding = "48px";
      if (name === "combobox") (el as WtCombobox).options = [{ value: "bar", label: "Bar" }];
      if (name === "colour")
        (el as WtColourChooser).choices = [
          { value: "red", label: "Red", fill: "var(--wt-color-palette-red)" },
        ];
      await (el as WtCombobox).updateComplete;
      const trigger = el.shadowRoot!.querySelector<HTMLElement>(selector)!;
      expect(el.shadowRoot!.querySelector("[popover]")?.matches(":popover-open") ?? false).toBe(
        false,
      );
      const closed = el.shadowRoot!.querySelector<HTMLElement>("[popover]");
      if (closed) expect(getComputedStyle(closed).display).toBe("none");
      await userEvent.click(trigger);
      await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[popover]")).not.toBeNull());
      const popup = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      await vi.waitFor(() => visible(popup));
      if (name === "language" || name === "theme")
        expect(getComputedStyle(popup).display).toBe("flex");
      expect(popup.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        trigger.getBoundingClientRect().bottom,
      );
      await userEvent.click(trigger);
      await vi.waitFor(() =>
        expect(popup.isConnected && popup.matches(":popover-open")).toBe(false),
      );
      await userEvent.click(trigger);
      await vi.waitFor(() => visible(el.shadowRoot!.querySelector<HTMLElement>("[popover]")!));
      const outside = document.createElement("button");
      outside.textContent = "Outside";
      outside.style.cssText = "position:fixed;bottom:8px;left:8px";
      host.append(outside);
      await userEvent.click(outside);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[popover]")?.matches(":popover-open") ?? false).toBe(
          false,
        ),
      );
    },
  );
}

test("a modal's combobox is hittable and Escape closes only the list, then selection works", async () => {
  const dialog = (await mount(
    '<wt-dialog heading="Edit"><wt-combobox label="Station"></wt-combobox></wt-dialog>',
  )) as WtDialog;
  const combo = dialog.querySelector<WtCombobox>("wt-combobox")!;
  combo.options = [
    { value: "bar", label: "Bar" },
    { value: "kitchen", label: "Kitchen" },
  ];
  await combo.updateComplete;
  dialog.open = true;
  await dialog.updateComplete;
  const trigger = combo.shadowRoot!.querySelector<HTMLElement>("button.trigger")!;
  await userEvent.click(trigger);
  const popup = combo.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await vi.waitFor(() => visible(popup));
  const option = popup.querySelector<HTMLElement>('[role="option"]')!;
  const rect = option.getBoundingClientRect();
  expect(
    combo
      .shadowRoot!.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      ?.closest('[role="option"]'),
  ).toBe(option);
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
  expect(dialog.open).toBe(true);
  expect(combo.shadowRoot!.activeElement).toBe(trigger);
  await userEvent.click(trigger);
  const picks: unknown[] = [];
  combo.addEventListener("wt-change", (event) => picks.push((event as CustomEvent).detail));
  await userEvent.click(option);
  expect(picks).toEqual([{ value: "bar" }]);
});

test("phone filters open visibly and close on their own action", async () => {
  await page.viewport(390, 844);
  const table = (await mount(
    '<wt-data-table aria-label="Orders"></wt-data-table>',
  )) as WtDataTable<{ id: string }>;
  table.rowKey = (row) => row.id;
  table.columns = [
    {
      key: "id",
      label: "Order",
      cell: (row) => row.id,
      filter: {
        label: "Order",
        allLabel: "All",
        value: (row) => row.id,
        options: [{ value: "one", label: "One" }],
      },
    },
  ];
  table.rows = [{ id: "one" }];
  await table.updateComplete;
  const trigger = table.shadowRoot!.querySelector<HTMLElement>(".filters-trigger")!;
  await userEvent.click(trigger);
  const popup = table.shadowRoot!.querySelector<HTMLElement>(".filters-panel")!;
  await vi.waitFor(() => visible(popup));
  await userEvent.click(popup.querySelector<HTMLElement>(".filters-close")!);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
});

test("help inside an action menu keeps the parent open and both light-dismiss", async () => {
  const menu = await mount(
    '<wt-row-actions label="Actions"><button>Edit</button><button>Delete</button><wt-help-tooltip data-keep-open aria-label="Help">Explanation</wt-help-tooltip></wt-row-actions>',
  );
  const help = menu.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "wt-help-tooltip",
  )!;
  await help.updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(help.shadowRoot!.querySelector("button")!);
  const parent = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  const child = help.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  visible(parent);
  visible(child);
  const outside = document.createElement("button");
  outside.textContent = "Outside";
  outside.style.cssText = "position:fixed;bottom:8px;left:8px";
  host.append(outside);
  await userEvent.click(outside);
  await vi.waitFor(() =>
    expect([parent.matches(":popover-open"), child.matches(":popover-open")]).toEqual([
      false,
      false,
    ]),
  );
});

test("address suggestions can be chosen with no native Popover", async () => {
  const { WtAddressLookup } = await import("./components/wt-address-lookup.js");
  const lookup = (await mount(
    '<wt-address-lookup label="Address" country-code="GB"></wt-address-lookup>',
  )) as InstanceType<typeof WtAddressLookup>;
  const address = {
    lines: ["1 High Street"],
    locality: "Oxford",
    postalCode: "OX1 1AA",
    countryCode: "GB",
  };
  lookup.delay = 0;
  lookup.provider = {
    suggest: async () => [{ id: "one", label: "1 High Street" }],
    resolve: async () => address,
  };
  const chosen: unknown[] = [];
  lookup.addEventListener("wt-address-chosen", (event) =>
    chosen.push((event as CustomEvent).detail),
  );
  await lookup.updateComplete;
  await userEvent.fill(lookup.shadowRoot!.querySelector("input")!, "High Street");
  await vi.waitFor(() =>
    expect(lookup.shadowRoot!.querySelector('[role="option"]')).not.toBeNull(),
  );
  await userEvent.click(lookup.shadowRoot!.querySelector<HTMLElement>('[role="option"]')!);
  await vi.waitFor(() => expect(chosen).toEqual([{ address }]));
});

test("a popup field over form actions does not scroll the form beneath it", async () => {
  await import("./components/wt-form-actions.js");
  const scroller = await mount(
    '<div style="height:200px;overflow:auto"><div style="height:1000px"></div><wt-form-actions error="Check the fields"><button>Save</button></wt-form-actions><div popover="manual" style="margin:0;padding:0;border:0;inset:auto"><input aria-label="Editor" style="display:block;width:300px;height:20px"></div></div>',
  );
  const row = scroller.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "wt-form-actions",
  )!;
  await row.updateComplete;
  const popup = scroller.querySelector<HTMLElement>("[popover]")!;
  const box = row.getBoundingClientRect();
  popup.style.top = `${box.top + 5}px`;
  popup.style.left = `${box.left}px`;
  popup.showPopover();
  const field = popup.querySelector("input")!;
  field.focus();
  expect(field.getBoundingClientRect().top).toBeGreaterThan(box.top);
  expect(field.getBoundingClientRect().top).toBeLessThan(box.bottom);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(scroller.scrollTop).toBe(0);
});

test("an overlay drag queues no scroll of its ancestor; closing it restores ancestor scrolling", async () => {
  const { DragEdgeScroll } = await import("./drag-edge-scroll.js");
  const box = await mount(
    '<div style="position:fixed;top:100px;left:100px;width:240px;height:200px;overflow:auto"><div style="height:1000px"></div><div popover="manual"><span>Drag</span></div></div>',
  );
  const popup = box.querySelector<HTMLElement>("[popover]")!;
  popup.showPopover();
  const edge = box.getBoundingClientRect();
  const queue: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => queue.push(callback));
  const scroll = new DragEdgeScroll();
  const start = () =>
    scroll.start(popup.firstElementChild!, { x: edge.left + 20, y: edge.bottom - 5 }, () => {});
  try {
    start();
    expect(queue).toHaveLength(0);
    popup.hidePopover();
    start();
    expect(queue).toHaveLength(1);
  } finally {
    scroll.stop();
    vi.restoreAllMocks();
  }
});

test.each([false, true])(
  "a pinned row menu receives clicks over the next row (clickable=%s)",
  async (clickable) => {
    const table = (await mount("<wt-data-table></wt-data-table>")) as WtDataTable<{ id: number }>;
    table.rowKey = (row) => String(row.id);
    if (clickable) table.rowClick = () => {};
    const picked: number[] = [];
    table.columns = [
      { key: "name", label: "Name", cell: (row) => `Order ${row.id}` },
      {
        key: "actions",
        label: "Actions",
        pinned: "end",
        cell: (row) =>
          html`<wt-row-actions label=${`Actions ${row.id}`}
            ><button>Edit ${row.id}</button
            ><button @click=${() => picked.push(row.id)}>Delete ${row.id}</button></wt-row-actions
          >`,
      },
    ];
    table.rows = Array.from({ length: 6 }, (_, index) => ({ id: index + 1 }));
    await table.updateComplete;
    const menu = table.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("wt-row-actions")!;
    await menu.updateComplete;
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    await userEvent.click(menu.querySelectorAll("button")[1]!);
    expect(picked).toEqual([1]);
    await vi.waitFor(() => expect(menu.hasAttribute("data-fallback-popover-open")).toBe(false));
  },
);
