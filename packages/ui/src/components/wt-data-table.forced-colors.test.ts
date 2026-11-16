import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import type { WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  sessionStorage.clear();
  await emulateForcedColours(null);
});

type Row = { name: string; parent: string | null; kind: string };
async function table() {
  const wrapper = await mount(
    '<div style="padding: 8px"><wt-data-table aria-label="Menu" style="width: 390px"></wt-data-table></div>',
  );
  const el = wrapper.querySelector<WtDataTable<Row>>("wt-data-table")!;
  el.rows = [
    { name: "Drinks", parent: null, kind: "drink" },
    { name: "Coffee", parent: "Drinks", kind: "drink" },
  ];
  el.rowKey = (row) => row.name;
  el.rowParent = (row) => row.parent;
  el.rowJoinsParent = () => true;
  el.columns = [
    { key: "name", label: "Name", cell: (row) => row.name, searchValue: (row) => row.name },
    {
      key: "kind",
      label: "Kind",
      cell: (row) => row.kind,
      filter: {
        label: "Kind",
        allLabel: "All kinds",
        value: (row) => row.kind,
        options: [{ value: "drink", label: "Drinks" }],
      },
    },
  ];
  el.searchable = true;
  await el.updateComplete;
  await expect.poll(() => el.hasAttribute("stacked-search")).toBe(true);
  return el;
}

test("a filtered heading draws a thicker line than an unfiltered heading", async () => {
  const el = await table();
  el.chooseFilter("kind", ["drink"]);
  await el.updateComplete;
  const [plain, filtered] = [...el.shadowRoot!.querySelectorAll("thead th")];
  expect(filtered!.hasAttribute("data-filtered")).toBe(true);
  const a = plain!.getBoundingClientRect();
  const b = filtered!.getBoundingClientRect();
  const at = await elementPixels(el.parentElement!);
  expect(at(b.left + b.width / 2, b.bottom - 2)).not.toEqual(
    at(a.left + a.width / 2, a.bottom - 2),
  );
});

test("the table search keeps a visible keyboard focus outline", async () => {
  const el = await table();
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  search.focus();
  const box = search.getBoundingClientRect();
  const at = await elementPixels(el.parentElement!);
  expect(at(box.left - 3, box.top + box.height / 2)).not.toEqual(
    at(box.left - 7, box.top + box.height / 2),
  );
});

test("a non-clickable joined row keeps its side mark", async () => {
  const el = await table();
  const row = el.shadowRoot!.querySelector('tr[data-row-key="Coffee"]')!.getBoundingClientRect();
  const parent = el.shadowRoot!.querySelector('tr[data-row-key="Drinks"]')!.getBoundingClientRect();
  const at = await elementPixels(el.parentElement!);
  expect(at(row.left + 1, row.top + row.height / 2)).not.toEqual(
    at(parent.left + 1, parent.top + parent.height / 2),
  );
});

test("joined rows keep a side mark and still open from their second cell", async () => {
  const el = await table();
  const opened = vi.fn();
  el.rowClick = opened;
  await el.updateComplete;
  const joined = el.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="Coffee"]')!;
  const tree = joined.querySelector<HTMLElement>(".tree-cell")!;
  const box = tree.getBoundingClientRect();
  const rowBox = joined.getBoundingClientRect();
  const at = await elementPixels(el.parentElement!);
  expect(at(rowBox.left + 1, box.top + box.height / 2)).not.toEqual(
    at(rowBox.left + 5, box.top + box.height / 2),
  );
  await userEvent.click(joined, {
    position: {
      x: box.left + box.width / 2 - rowBox.left,
      y: box.top + box.height / 2 - rowBox.top,
    },
  });
  expect(opened).toHaveBeenCalledExactlyOnceWith(el.rows[1]);
  const second = joined.querySelectorAll("td")[1]!.getBoundingClientRect();
  await userEvent.click(joined, {
    position: {
      x: second.left + second.width / 2 - rowBox.left,
      y: second.top + second.height / 2 - rowBox.top,
    },
  });
  expect(opened).toHaveBeenCalledTimes(2);
  expect(opened).toHaveBeenLastCalledWith(el.rows[1]);
});
