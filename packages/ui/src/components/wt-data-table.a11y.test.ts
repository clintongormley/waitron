import { html } from "lit";
import { afterEach, describe, test } from "vitest";
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
});
