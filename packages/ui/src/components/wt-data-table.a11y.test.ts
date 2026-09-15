import { html } from "lit";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
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
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>(".table-filter")!;
    select.value = "Active";
    select.dispatchEvent(new Event("change"));
    const search = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
    search.value = "zzz";
    search.dispatchEvent(new Event("input"));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[role=status]")!.textContent).toContain("No users match");
    await expectNoA11yViolations(host);
  });
});
