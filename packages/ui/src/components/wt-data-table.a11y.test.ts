import { html } from "lit";
import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { chooseOption, cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-button.js";
import "./wt-data-table.js";

afterEach(cleanup);

type Row = { id: string; name: string; status: string };

describe.each(["light", "dark"] as const)("wt-data-table a11y (%s theme)", (theme) => {
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
    const filter = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
    await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    await filter.updateComplete;
    expect(filter.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
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
    el.columnsLabel = "Columns shown";
    await el.updateComplete;
    return el;
  }

  test("column chooser closed", async () => {
    await chooserTable();
    await expectNoA11yViolations(host);
  });

  test("column chooser open, with the last shown column's box disabled", async () => {
    const el = await chooserTable();
    const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".columns-trigger")!;
    await userEvent.click(trigger);
    el.shadowRoot!.querySelector<HTMLInputElement>('input[data-column="status"]')!.click();
    await el.updateComplete;
    const panel = el.shadowRoot!.querySelector<HTMLElement>(".columns-panel")!;
    expect(panel.matches(":popover-open")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>('input[data-column="name"]')!.disabled,
    ).toBe(true);
    await expectNoA11yViolations(host);
  });
});
