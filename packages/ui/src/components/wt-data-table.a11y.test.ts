import { html } from "lit";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption, chooseOptions, cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-button.js";
import "./wt-data-table.js";

afterEach(cleanup);

type Row = { id: string; name: string; status: string };

describe.each(["light", "dark"] as const)("wt-data-table a11y (%s theme)", (theme) => {
  test.each([false, true])("leading row controls with selection %s", async (selectable) => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [{ key: "name", label: "Name", cell: (row) => row.name }];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    el.rowControls = (row) => html`<button>Move ${row.name}</button>`;
    el.rowControlsLabel = "Move row";
    el.rowControlsAlign = "center";
    el.selectable = selectable;
    el.selectionLabel = (row) => `Select ${row.name}`;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("search field while focused", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [{ key: "name", label: "Name", cell: (row) => row.name }];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    el.searchable = true;
    el.searchLabel = "Search users";
    await el.updateComplete;
    const search = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
    search.focus();
    expect(search.matches(":focus-visible")).toBe(true);
    await expectNoA11yViolations(host);
  });

  test("sortable rows with an action", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
      { key: "status", label: "Status", cell: (row) => row.status },
      {
        key: "action",
        label: "Actions",
        cell: (row) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
      },
    ] satisfies DataTableColumn<Row>[];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("an empty table with the Add button its screen put in the empty-action slot", async () => {
    const el = (await mountThemed(
      `<wt-data-table aria-label="Users"
        ><wt-button slot="empty-action">Add user</wt-button></wt-data-table
      >`,
      theme,
    )) as WtDataTable<Row>;
    el.columns = [{ key: "name", label: "Name", cell: (row) => row.name }];
    el.rows = [];
    el.emptyMessage = "No users yet.";
    await el.updateComplete;
    expect(el.querySelector("wt-button")!.assignedSlot).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("clickable rows with a stretched row activator", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
      { key: "status", label: "Status", cell: (row) => row.status },
      {
        key: "action",
        label: "Actions",
        cell: (row) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
      },
    ] satisfies DataTableColumn<Row>[];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    el.rowClick = (row) => void row.id;
    el.rowClickLabel = (row) => `Open ${row.name}`;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("clickable rows beside a row rowClickable refuses", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name },
      { key: "status", label: "Status", cell: (row) => row.status },
    ] satisfies DataTableColumn<Row>[];
    el.rows = [
      { id: "1", name: "Ada", status: "Active" },
      { id: "2", name: "Bea", status: "Removed" },
    ];
    el.rowKey = (row) => row.id;
    el.rowClick = (row) => void row.id;
    el.rowClickLabel = (row) => `Open ${row.name}`;
    el.rowClickable = (row) => row.status === "Active";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll(".row-activate")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  test("selectable rows with a select-all and per-row checkboxes", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
      { key: "status", label: "Status", cell: (row) => row.status },
    ] satisfies DataTableColumn<Row>[];
    el.rows = [
      { id: "1", name: "Ada", status: "Active" },
      { id: "2", name: "Bea", status: "Inactive" },
    ];
    el.rowKey = (row) => row.id;
    el.selectable = true;
    el.selected = ["1"];
    el.selectionLabel = (row) => `Select ${row.name}`;
    el.selectAllLabel = "Select all products";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("unselectable rows preserve the selection column without a checkbox", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
      { key: "status", label: "Status", cell: (row) => row.status },
    ] satisfies DataTableColumn<Row>[];
    el.rows = [
      { id: "1", name: "Ada", status: "Active" },
      { id: "2", name: "Bea", status: "Inactive" },
    ];
    el.rowKey = (row) => row.id;
    el.selectable = true;
    el.rowSelectable = (row) => row.id !== "2";
    el.selected = ["1"];
    el.selectionLabel = (row) => `Select ${row.name}`;
    el.selectAllLabel = "Select all products";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("tree mode with a collapsed branch", async () => {
    type TreeRow = { id: string; parent: string | null; name: string };
    const el = (await mountThemed(
      '<wt-data-table aria-label="Categories"></wt-data-table>',
      theme,
    )) as WtDataTable<TreeRow>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
    ] satisfies DataTableColumn<TreeRow>[];
    el.rows = [
      { id: "food", parent: null, name: "Food" },
      { id: "break", parent: "food", name: "Breakfast" },
      { id: "eggs", parent: "break", name: "Eggs" },
      { id: "drinks", parent: null, name: "Drinks" },
    ];
    el.rowKey = (row) => row.id;
    el.rowParent = (row) => row.parent;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(
      'tbody tr[data-row-key="break"] button.tree-toggle',
    )!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("a phone-width tree with a toggle focused from the keyboard", async () => {
    type TreeRow = { id: string; parent: string | null; name: string };
    const el = (await mountThemed(
      '<wt-data-table aria-label="Categories"></wt-data-table>',
      theme,
    )) as WtDataTable<TreeRow>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
    ] satisfies DataTableColumn<TreeRow>[];
    el.rows = [
      { id: "food", parent: null, name: "Food" },
      { id: "break", parent: "food", name: "Breakfast" },
      { id: "eggs", parent: "break", name: "Eggs" },
    ];
    el.rowKey = (row) => row.id;
    el.rowParent = (row) => row.parent;
    el.style.width = "360px";
    await el.updateComplete;
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(el.hasAttribute("narrow")).toBe(true);
    const toggle = el.shadowRoot!.querySelector<HTMLButtonElement>(
      'tbody tr[data-row-key="food"] button.tree-toggle',
    )!;
    toggle.focus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await userEvent.keyboard("{Tab}");
    expect(toggle.matches(":focus-visible")).toBe(true);
    await expectNoA11yViolations(host);
  });

  test("tree mode with an always-open top branch", async () => {
    type TreeRow = { id: string; parent: string | null; name: string };
    const el = (await mountThemed(
      '<wt-data-table aria-label="Categories"></wt-data-table>',
      theme,
    )) as WtDataTable<TreeRow>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
    ] satisfies DataTableColumn<TreeRow>[];
    el.rows = [
      { id: "all", parent: null, name: "All products" },
      { id: "food", parent: "all", name: "Food" },
      { id: "eggs", parent: "food", name: "Eggs" },
    ];
    el.rowKey = (row) => row.id;
    el.rowParent = (row) => row.parent;
    el.rowCollapsible = (row) => row.id !== "all";
    el.initiallyCollapsed = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("tree mode with rows that toggle from the row and rows that open", async () => {
    type TreeRow = { id: string; parent: string | null; name: string };
    const el = (await mountThemed(
      '<wt-data-table aria-label="Categories"></wt-data-table>',
      theme,
    )) as WtDataTable<TreeRow>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
    ] satisfies DataTableColumn<TreeRow>[];
    el.rows = [
      { id: "food", parent: null, name: "Food" },
      { id: "break", parent: "food", name: "Breakfast" },
      { id: "eggs", parent: "break", name: "Eggs" },
    ];
    el.rowKey = (row) => row.id;
    el.rowParent = (row) => row.parent;
    el.rowActivation = (row) => (row.id === "eggs" ? "click" : "toggle");
    el.rowClick = (row) => void row.id;
    el.rowClickLabel = (row) => `Open ${row.name}`;
    el.rowToggleLabel = (row, expanded) => `${expanded ? "Close" : "Open"} ${row.name}`;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("tree mode with an opened branch whose children join it on the band", async () => {
    type TreeRow = { id: string; parent: string | null; name: string };
    const el = (await mountThemed(
      '<wt-data-table aria-label="Products"></wt-data-table>',
      theme,
    )) as WtDataTable<TreeRow>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
      {
        key: "actions",
        label: "Actions",
        pinned: "end",
        cell: (row) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
      },
    ] satisfies DataTableColumn<TreeRow>[];
    el.rows = [
      { id: "bun", parent: null, name: "Bun" },
      { id: "small", parent: "bun", name: "Small" },
      { id: "large", parent: "bun", name: "Large" },
    ];
    el.rowKey = (row) => row.id;
    el.rowParent = (row) => row.parent;
    el.rowJoinsParent = (row) => row.parent !== null;
    el.rowClick = (row) => void row.id;
    el.rowClickLabel = (row) => `Open ${row.name}`;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('tr[data-row-key="small"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('tr[data-row-key="small"]')!.matches(".joined")).toBe(true);
    await expectNoA11yViolations(host);
  });

  test("toolbar with a search box and a filter dropdown", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<{ id: string; name: string; status: string }>;
    el.columns = [
      { key: "name", label: "Name", cell: (r) => r.name, searchValue: (r) => r.name },
      {
        key: "status",
        label: "Status",
        cell: (r) => r.status,
        filter: {
          label: "Filter by status",
          allLabel: "Any status",
          value: (r) => r.status,
          options: [{ value: "a", label: "Active" }],
        },
      },
    ];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    el.searchable = true;
    el.searchLabel = "Search users";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("a phone-width searchable table with its search under its buttons", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users" style="width: 390px"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name },
      {
        key: "status",
        label: "Status",
        cell: (row) => row.status,
        filter: {
          label: "Filter by status",
          allLabel: "Any status",
          value: (row) => row.status,
          options: [{ value: "Active", label: "Active" }],
        },
      },
    ] satisfies DataTableColumn<Row>[];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    el.searchable = true;
    el.searchLabel = "Search users";
    await el.updateComplete;
    await vi.waitFor(() => expect(el.hasAttribute("stacked-search")).toBe(true));
    await expectNoA11yViolations(host);
  });

  test("an open full-screen Filters panel with a chosen filter", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users" style="width: 500px"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name },
      {
        key: "status",
        label: "Status",
        cell: (row) => row.status,
        filter: {
          label: "Filter by status",
          allLabel: "Any status",
          value: (row) => row.status,
          options: [{ value: "Active", label: "Active" }],
          initial: "Active",
        },
      },
    ];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
    const panel = el.shadowRoot!.querySelector<HTMLElement>(".filters-panel")!;
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(true));
    expect(panel.hasAttribute("data-fullscreen")).toBe(true);
    await expectNoA11yViolations(host);
  });

  test("toolbar with an active filter and a search that matches nothing", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (r) => r.name, searchValue: (r) => r.name },
      {
        key: "status",
        label: "Status",
        cell: (r) => r.status,
        filter: {
          label: "Filter by status",
          allLabel: "Any status",
          value: (r) => r.status,
          options: [
            { value: "Active", label: "Active" },
            { value: "Inactive", label: "Inactive" },
          ],
        },
      },
    ];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    el.searchable = true;
    el.searchLabel = "Search users";
    el.noMatchesMessage = "No users match";
    await el.updateComplete;
    const select = el.shadowRoot!.querySelector<WtCombobox>(".table-filter")!;
    await chooseOption(select, "Active");
    const search = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
    search.value = "zzz";
    search.dispatchEvent(new Event("input"));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[role=status]")!.textContent).toContain("No users match");
    await expectNoA11yViolations(host);
  });

  test("a filter dropdown with its list open", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (r) => r.name },
      {
        key: "status",
        label: "Status",
        cell: (r) => r.status,
        filter: {
          label: "Filter by status",
          allLabel: "Any status",
          value: (r) => r.status,
          options: [
            { value: "Active", label: "Active" },
            { value: "Inactive", label: "Inactive" },
          ],
        },
      },
    ];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
    const filter = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
    await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    await filter.updateComplete;
    expect(filter.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await expectNoA11yViolations(host);
  });

  test("an open Filters panel with a multi-select filter holding two values, its list open", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (r) => r.name },
      {
        key: "status",
        label: "Status",
        cell: (r) => r.status,
        filter: {
          label: "Filter by status",
          allLabel: "Any status",
          value: (r) => r.status,
          options: [
            { value: "Active", label: "Active" },
            { value: "Inactive", label: "Inactive" },
            { value: "Paused", label: "Paused" },
          ],
          multiple: { countLabel: (count) => `${count} statuses` },
        },
      },
    ];
    el.rows = [
      { id: "1", name: "Ada", status: "Active" },
      { id: "2", name: "Bea", status: "Paused" },
    ];
    el.rowKey = (row) => row.id;
    await el.updateComplete;
    const filter = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
    await chooseOptions(filter, ["Active", "Paused"]);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
    const panel = el.shadowRoot!.querySelector<HTMLElement>(".filters-panel")!;
    await vi.waitFor(() => expect(panel.hasAttribute("hidden")).toBe(false));
    await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    await filter.updateComplete;
    expect(filter.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    expect(filter.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe("2 statuses");
    await expectNoA11yViolations(host);
  });

  test.each([
    ["unscrolled", false],
    ["scrolled to the end", true],
  ])("a pinned action column over rows that scroll sideways, %s", async (_, scrolled) => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    const wide = "a status long enough to scroll the table sideways";
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
      { key: "status", label: "Status", cell: (row) => `${row.status}, ${wide}` },
      {
        key: "action",
        label: "Actions",
        pinned: "end",
        cell: (row) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
      },
    ] satisfies DataTableColumn<Row>[];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    el.style.width = "240px";
    await el.updateComplete;
    const scroll = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
    if (scrolled) scroll.scrollLeft = scroll.scrollWidth;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await expectNoA11yViolations(host);
  });

  async function chooserTable(): Promise<WtDataTable<Row>> {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, choosable: "shown" },
      { key: "status", label: "Status", cell: (row) => row.status, choosable: "shown" },
      { key: "id", label: "Code", cell: (row) => row.id, choosable: "hidden" },
    ] satisfies DataTableColumn<Row>[];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    await el.updateComplete;
    return el;
  }

  test("column chooser closed", async () => {
    await chooserTable();
    await expectNoA11yViolations(host);
  });

  test("Customise dialog open, with the first and unchoosable columns fixed", async () => {
    const el = await chooserTable();
    const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".columns-trigger")!;
    await userEvent.click(trigger);
    el.shadowRoot!.querySelector<HTMLInputElement>('input[data-column="status"]')!.click();
    await el.updateComplete;
    const panel = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(".columns-panel")!;
    expect(panel.open).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(el.shadowRoot!.querySelector('input[data-column="name"]')).toBeNull();
    await expectNoA11yViolations(host);
  });

  test("Customise dialog with always-shown columns and a refused last eye", async () => {
    const el = await chooserTable();
    el.columns = [
      ...el.columns,
      { key: "actions", label: "Actions", cell: () => "Edit", pinned: "end" },
    ];
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector<HTMLButtonElement>(".columns-trigger")!);
    const panel = el.shadowRoot!.querySelector<HTMLElement>(".columns-panel")!;
    expect(panel.querySelectorAll(".column-state")).toHaveLength(2);
    expect(panel.querySelector(".column-note")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("Customise dialog after a keyboard move and a hidden column", async () => {
    const el = await chooserTable();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLButtonElement>(".columns-trigger")!);
    const panel = el.shadowRoot!.querySelector<HTMLElement>(".columns-panel")!;
    const handle = panel.querySelector<HTMLButtonElement>('[data-reorder="id"]')!;
    handle.focus();
    await userEvent.keyboard("{ArrowUp}");
    el.shadowRoot!.querySelector<HTMLInputElement>('input[data-column="status"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("Customise dialog during a pointer drag", async () => {
    const el = await chooserTable();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLButtonElement>(".columns-trigger")!);
    const panel = el.shadowRoot!.querySelector<HTMLElement>(".columns-panel")!;
    const source = panel.querySelector<HTMLButtonElement>('[data-reorder="status"]')!;
    const destination = panel.querySelector<HTMLElement>('[data-column-row="id"]')!;
    const start = source.getBoundingClientRect();
    const end = destination.getBoundingClientRect();
    source.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 12,
        button: 0,
        clientX: start.left + start.width / 2,
        clientY: start.top + start.height / 2,
      }),
    );
    try {
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 12,
          clientX: end.left + end.width / 2,
          clientY: end.top + end.height / 2,
        }),
      );
      await el.updateComplete;
      expect(panel.querySelector(".column-drag-preview")).not.toBeNull();
      expect(destination.hasAttribute("data-drop-target")).toBe(true);
      await expectNoA11yViolations(host);
    } finally {
      document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 12 }));
    }
  });

  test("a tree's toolbar with Expand all and slotted controls", async () => {
    type TreeRow = { id: string; parent: string | null; name: string };
    const el = (await mountThemed(
      `<wt-data-table aria-label="Categories"
        ><input slot="toolbar-start" type="search" aria-label="Search categories" /><button
          slot="toolbar-end"
          type="button"
        >Select</button></wt-data-table
      >`,
      theme,
    )) as WtDataTable<TreeRow>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
    ] satisfies DataTableColumn<TreeRow>[];
    el.rows = [
      { id: "food", parent: null, name: "Food" },
      { id: "eggs", parent: "food", name: "Eggs" },
    ];
    el.rowKey = (row) => row.id;
    el.rowParent = (row) => row.parent;
    el.expandAllLabel = "Expand all";
    el.collapseAllLabel = "Collapse all";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  async function filteredTable(): Promise<WtDataTable<Row>> {
    const el = (await mountThemed(
      `<wt-data-table aria-label="Users" style="width: 900px"
        ><input slot="toolbar-start" type="search" aria-label="Search users"
      /></wt-data-table>`,
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name },
      {
        key: "status",
        label: "Status",
        cell: (row) => row.status,
        filter: {
          label: "Filter by status",
          allLabel: "Any status",
          value: (row) => row.status,
          options: [{ value: "Active", label: "Active" }],
          initial: "Active",
        },
      },
    ] satisfies DataTableColumn<Row>[];
    el.rows = [{ id: "1", name: "Ada", status: "Active" }];
    el.rowKey = (row) => row.id;
    await el.updateComplete;
    return el;
  }

  test("a Filters button with a count, its tooltip shown on keyboard focus", async () => {
    const el = await filteredTable();
    const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!;
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.tab();
    expect(el.shadowRoot!.activeElement).toBe(trigger);
    expect(getComputedStyle(trigger.querySelector(".icon-tooltip")!).display).toBe("block");
    expect(trigger.querySelector(".filters-count")!.textContent).toBe("1");
    await expectNoA11yViolations(host);
  });

  test("a Filters panel open beside the rows", async () => {
    const width = innerWidth,
      height = innerHeight;
    await page.viewport(1280, 900);
    try {
      const el = await filteredTable();
      const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!;
      await userEvent.click(trigger);
      await el.updateComplete;
      const panel = el.shadowRoot!.querySelector<HTMLElement>(".filters-panel")!;
      expect(panel.hasAttribute("data-side")).toBe(true);
      expect(getComputedStyle(panel).display).not.toBe("none");
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await expectNoA11yViolations(host);
    } finally {
      await page.viewport(width, height);
    }
  });

  test("sticky headings, one sorted and one filtered, with rows scrolled under them", async () => {
    const el = (await mountThemed(
      '<wt-data-table aria-label="Users" style="height: 480px"></wt-data-table>',
      theme,
    )) as WtDataTable<Row>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
      {
        key: "status",
        label: "Status",
        cell: (row) => row.status,
        filter: {
          label: "Status",
          allLabel: "Any status",
          value: (row) => row.status,
          options: [{ value: "Active", label: "Active" }],
          initial: "Active",
        },
      },
      {
        key: "actions",
        label: "Actions",
        pinned: "end",
        cell: (row) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
      },
    ] satisfies DataTableColumn<Row>[];
    el.rows = Array.from({ length: 30 }, (_, index) => ({
      id: String(index),
      name: `Person ${index}`,
      status: "Active",
    }));
    el.rowKey = (row) => row.id;
    el.sortKey = "name";
    el.stickyHeader = true;
    await el.updateComplete;
    const scroll = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    scroll.scrollTop = 200;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scroll.scrollTop).toBe(200);
    expect(el.shadowRoot!.querySelector("th[data-filtered]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
