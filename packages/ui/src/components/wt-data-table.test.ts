import { html } from "lit";
import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(cleanup);

type Row = { id: string; name: string; count: number };

const rows: Row[] = [
  { id: "b", name: "Bea", count: 2 },
  { id: "a", name: "Ada", count: 10 },
];

const columns: DataTableColumn<Row>[] = [
  { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
  { key: "count", label: "Count", cell: (row) => row.count, sortValue: (row) => row.count },
  {
    key: "action",
    label: "Actions",
    cell: (row) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
  },
];

function rowText(table: WtDataTable<Row>): string[] {
  return [...table.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.textContent!.replace(/\s+/g, ""),
  );
}

async function table(props: Partial<WtDataTable<Row>> = {}): Promise<WtDataTable<Row>> {
  const el = (await mount(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id, ...props });
  await el.updateComplete;
  return el;
}

test("renders native table semantics and consumer-provided cells", async () => {
  const el = await table();
  const native = el.shadowRoot!.querySelector("table")!;
  expect(native.getAttribute("aria-label")).toBe("Users");
  expect([...native.querySelectorAll("th")].map((cell) => cell.textContent?.trim())).toEqual([
    "Name",
    "Count",
    "Actions",
  ]);
  expect(rowText(el)).toEqual(["Bea2Edit", "Ada10Edit"]);
  expect(native.querySelector('button[aria-label="Edit Bea"]')).not.toBeNull();
});

test("updates its accessible name when the host label changes", async () => {
  const el = await table();
  el.setAttribute("aria-label", "Devices");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("table")!.getAttribute("aria-label")).toBe("Devices");
});

test("sorts without mutating the consumer's rows and toggles the direction", async () => {
  const input = [...rows];
  const el = await table({ rows: input });
  const name = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="name"]')!;
  name.click();
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]);
  expect(name.closest("th")!.getAttribute("aria-sort")).toBe("ascending");
  name.click();
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Bea2Edit", "Ada10Edit"]);
  expect(name.closest("th")!.getAttribute("aria-sort")).toBe("descending");
  expect(input).toEqual(rows);
});

test("sorts numbers numerically", async () => {
  const el = await table();
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="count"]')!.click();
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Bea2Edit", "Ada10Edit"]);
});

test("renders loading, error and empty states supplied by the consumer", async () => {
  const loading = await table({ loading: true, loadingMessage: "Loading users" });
  expect(loading.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(
    "Loading users",
  );
  expect(loading.shadowRoot!.querySelector("table")).toBeNull();

  const failed = await table({ errorMessage: "Could not load users" });
  expect(failed.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
    "Could not load users",
  );
  expect(failed.shadowRoot!.querySelector("table")).toBeNull();

  const empty = await table({ rows: [], emptyMessage: "No users" });
  expect(empty.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain("No users");
  expect(empty.shadowRoot!.querySelector("table")).toBeNull();
});

test("keeps the table in a horizontally scrollable region", async () => {
  const el = await table();
  const region = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  expect(getComputedStyle(region).overflowX).toBe("auto");
  expect(region.tabIndex).toBe(0);
});
