import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, mount, mountInShadowRoot } from "../test-helpers.js";
import { applyTokens } from "../tokens/index.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";
import "./wt-input.js";

type Row = { id: string; name: string; state: string };
type Query = {
  search: string;
  sortKey: string;
  sortDirection: "ascending" | "descending";
  filters: Record<string, string | string[]>;
};
const rows: Row[] = [
  { id: "z", name: "Zed", state: "held" },
  { id: "a", name: "Ada", state: "unpaid" },
];
const columns: DataTableColumn<Row>[] = [
  {
    key: "name",
    label: "Name",
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    searchValue: (row) => row.name,
  },
  {
    key: "state",
    label: "State",
    cell: (row) => row.state,
    sortValue: (row) => row.state,
    filter: {
      label: "State",
      allLabel: "Every state",
      value: (row) => row.state,
      options: [
        { value: "held", label: "Held" },
        { value: "unpaid", label: "Unpaid" },
      ],
    },
  },
];

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function table(props: Partial<WtDataTable<Row>> = {}) {
  const el = (await mount(
    '<wt-data-table aria-label="Bills"></wt-data-table>',
  )) as WtDataTable<Row>;
  const queries: Query[] = [];
  el.addEventListener("wt-query-change", (event) =>
    queries.push((event as CustomEvent<Query>).detail),
  );
  Object.assign(el, {
    rows,
    columns,
    rowKey: (row: Row) => row.id,
    searchable: true,
    sortKey: "name",
    sortDirection: "ascending",
    serverPaging: { page: 1, pageSize: 50, total: 2314 },
    ...props,
  });
  await el.updateComplete;
  return { el, queries };
}
const shown = (el: WtDataTable<Row>) =>
  [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-row-key"));

test("server pages retain supplied row order while search and filters describe the next query", async () => {
  const { el } = await table();
  expect(shown(el)).toEqual(["z", "a"]);
  await userEvent.fill(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!),
    "missing",
  );
  el.chooseFilter("state", ["held"]);
  await el.updateComplete;
  expect(shown(el)).toEqual(["z", "a"]);
});

test("server query events carry effective state and do not repeat for page responses", async () => {
  const { el, queries } = await table();
  expect(queries).toEqual([
    { search: "", sortKey: "name", sortDirection: "ascending", filters: {} },
  ]);
  await userEvent.fill(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!),
    "Zed ",
  );
  el.chooseFilter("state", ["held"]);
  await el.updateComplete;
  expect(queries.at(-1)).toEqual({
    search: "Zed ",
    sortKey: "name",
    sortDirection: "ascending",
    filters: { state: "held" },
  });
  const count = queries.length;
  el.rows = [...rows];
  el.serverPaging = { page: 2, pageSize: 50, total: 2315 };
  el.loading = true;
  await el.updateComplete;
  el.loading = false;
  await el.updateComplete;
  expect(queries).toHaveLength(count);
});

test("paging is controlled and announces the server total", async () => {
  const { el } = await table();
  const pages: number[] = [];
  el.addEventListener("wt-page-change", (event) =>
    pages.push((event as CustomEvent<{ page: number }>).detail.page),
  );
  expect(el.shadowRoot!.textContent).toContain("51–100 of 2,314");
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLButtonElement>("[data-next-page]")!),
  );
  expect(pages).toEqual([2]);
  expect(el.serverPaging?.page).toBe(1);
  expect(shown(el)).toEqual(["z", "a"]);
  el.loading = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<HTMLButtonElement>("[data-next-page]")!.disabled).toBe(true);
  expect(el.shadowRoot!.querySelector<HTMLButtonElement>("[data-previous-page]")!.disabled).toBe(
    true,
  );
});

test.each(["empty", "loading", "error"])(
  "server %s state retains the toolbar and open filters",
  async (state) => {
    const { el } = await table();
    await userEvent.click(
      page.elementLocator(el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!),
    );
    expect(el.shadowRoot!.querySelector(".filters-trigger")!.getAttribute("aria-expanded")).toBe(
      "true",
    );
    if (state === "empty") el.rows = [];
    if (state === "loading") el.loading = true;
    if (state === "error") el.errorMessage = "Read failed";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".table-search")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".filters-trigger")!.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(el.shadowRoot!.querySelector("[data-previous-page]")).not.toBeNull();
  },
);

test("date-only filters have a trigger, count and a clear event with no column filter", async () => {
  const { el } = await table({ columns: [columns[0]], externalFilterCount: 1 });
  const dates = document.createElement("button");
  dates.slot = "filters-start";
  dates.textContent = "Today";
  el.appendChild(dates);
  el.requestUpdate();
  await el.updateComplete;
  const clear = vi.fn();
  el.addEventListener("wt-filters-clear", clear);
  const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger");
  expect(trigger).not.toBeNull();
  expect(el.shadowRoot!.querySelector(".filters-count")!.textContent).toBe("1");
  await userEvent.click(page.elementLocator(trigger!));
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-clear-all")!),
  );
  expect(clear).toHaveBeenCalledTimes(1);
  expect((clear.mock.calls[0]![0] as CustomEvent).detail).toEqual({});
});

test("local tables keep their sorting and filtering defaults without emitting server queries", async () => {
  const { el, queries } = await table({ serverPaging: undefined });
  expect(shown(el)).toEqual(["a", "z"]);
  await userEvent.fill(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!),
    "missing",
  );
  expect(shown(el)).toEqual([]);
  expect(queries).toEqual([]);
  expect(el.shadowRoot!.querySelector("[data-next-page]")).toBeNull();
});

test("server search consumes its native input before reporting one composed query", async () => {
  const { el } = await table();
  const input = vi.fn();
  const query = vi.fn();
  el.addEventListener("input", input);
  el.addEventListener("wt-query-change", query);
  await userEvent.fill(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!),
    "Zed",
  );
  expect(input).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledTimes(1);
  expect((query.mock.calls[0]![0] as CustomEvent).composed).toBe(true);
  expect((query.mock.calls[0]![0] as CustomEvent).bubbles).toBe(true);
});

test("page controls use surface and tap-size tokens", async () => {
  const { el } = await table();
  el.style.setProperty("--wt-color-surface", "rgb(24, 36, 48)");
  el.style.setProperty("--wt-tap-min", "58px");
  const button = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-next-page]")!;
  expect(getComputedStyle(button).backgroundColor).toBe("rgb(24, 36, 48)");
  expect(getComputedStyle(button).minHeight).toBe("58px");
});

function activeElement(): Element | null {
  let current = document.activeElement;
  while (current?.shadowRoot?.activeElement) current = current.shadowRoot.activeElement;
  return current;
}

test("phone Filters focuses slotted date fields and keeps their Tab sequence inside", async () => {
  const { el } = await table({ columns: [columns[0]], externalFilterCount: 1 });
  el.style.width = "390px";
  const dates = document.createElement("div");
  dates.slot = "filters-start";
  dates.innerHTML =
    '<wt-input name="from" label="From" type="date"></wt-input><wt-input name="to" label="To" type="date"></wt-input>';
  el.appendChild(dates);
  el.requestUpdate();
  await el.updateComplete;
  const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!;
  await userEvent.click(page.elementLocator(trigger));
  const fields = [...dates.querySelectorAll("wt-input")];
  const first = fields[0]!.shadowRoot!.querySelector("input")!;
  const last = fields[1]!.shadowRoot!.querySelector("input")!;
  await vi.waitFor(() => expect(activeElement()).toBe(first));
  last.focus();
  for (let segment = 0; segment < 6 && activeElement() === last; segment++) await userEvent.tab();
  const clear = el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-clear-all")!;
  expect(activeElement()).toBe(clear);
  await userEvent.tab({ shift: true });
  expect(activeElement()).toBe(last);
  await userEvent.keyboard("{Escape}");
  expect(activeElement()).toBe(trigger);
});

test.each([
  { page: 0, total: 0, label: "0–0 of 0", previous: true, next: true },
  { page: 0, total: 1, label: "1–1 of 1", previous: true, next: true },
  { page: 0, total: 51, label: "1–50 of 51", previous: true, next: false },
  { page: 1, total: 51, label: "51–51 of 51", previous: false, next: true },
])("page boundaries $page/$total", async ({ page: current, total, label, previous, next }) => {
  const { el } = await table({ serverPaging: { page: current, pageSize: 50, total } });
  expect(el.shadowRoot!.querySelector(".pagination")!.textContent).toContain(label);
  expect(el.shadowRoot!.querySelector<HTMLButtonElement>("[data-previous-page]")!.disabled).toBe(
    previous,
  );
  expect(el.shadowRoot!.querySelector<HTMLButtonElement>("[data-next-page]")!.disabled).toBe(next);
});

test("a full incoming page is neither sliced nor reordered, including its public shown keys", async () => {
  const supplied = Array.from({ length: 50 }, (_, index) => ({
    id: String(index),
    name: `Row ${50 - index}`,
    state: "held",
  }));
  const { el } = await table({ rows: supplied });
  expect(shown(el)).toEqual(supplied.map((row) => row.id));
  expect(el.shownKeys()).toEqual(supplied.map((row) => row.id));
});

test("query restoration reports initial and remembered filters before any page is loaded", async () => {
  sessionStorage.setItem(
    "paged",
    JSON.stringify({ sortKey: "state", sortDirection: "descending", filters: { state: "held" } }),
  );
  const { queries } = await table({ rows: [], viewKey: "paged" });
  expect(queries).toEqual([
    { search: "", sortKey: "state", sortDirection: "descending", filters: { state: "held" } },
  ]);
  const initial = await table({
    columns: [
      columns[0]!,
      { ...columns[1]!, filter: { ...columns[1]!.filter!, initial: "unpaid" } },
    ],
  });
  expect(initial.queries[0]!.filters).toEqual({ state: "unpaid" });
  initial.el.chooseFilter("state", []);
  await initial.el.updateComplete;
  expect(initial.queries.at(-1)!.filters).toEqual({});
});

test("hidden sort columns report no effective sort while retaining the filter", async () => {
  localStorage.setItem("hidden:columns", JSON.stringify({ state: false }));
  const { el, queries } = await table({
    viewKey: "hidden",
    sortKey: "state",
    columns: [
      columns[0]!,
      { ...columns[1]!, choosable: "shown" },
      { key: "other", label: "Other", cell: () => "Other", choosable: "shown" },
    ],
  });
  expect(queries[0]!.sortKey).toBe("");
  el.chooseFilter("state", ["held"]);
  await el.updateComplete;
  expect(queries.at(-1)!.filters).toEqual({ state: "held" });
});

test("blocked storage still reports the current query and keeps the page controls", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { el, queries } = await table({ viewKey: "blocked" });
  el.chooseFilter("state", ["held"]);
  await el.updateComplete;
  expect(queries.at(-1)!.filters).toEqual({ state: "held" });
  expect(shown(el)).toEqual(["z", "a"]);
});

test("page labels are supplied by the caller and page events cross an enclosing shadow root", async () => {
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Bills"></wt-data-table>',
  )) as WtDataTable<Row>;
  applyTokens(el);
  Object.assign(el, {
    rows,
    columns,
    rowKey: (row: Row) => row.id,
    serverPaging: { page: 1, pageSize: 50, total: 2314 },
    pageRangeLabel: (from: number, to: number, total: number) => `${from}/${to}/${total}`,
    previousPageLabel: "Anterior",
    nextPageLabel: "Siguiente",
  });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".pagination")!.textContent).toContain("51/100/2314");
  const pages = vi.fn();
  const clicks = vi.fn();
  document.addEventListener("wt-page-change", pages);
  el.addEventListener("click", clicks);
  try {
    const previous = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-previous-page]")!;
    expect(previous.textContent!.trim()).toBe("Anterior");
    expect(el.shadowRoot!.querySelector("[data-next-page]")!.textContent!.trim()).toBe("Siguiente");
    await userEvent.click(page.elementLocator(previous));
    expect(pages).toHaveBeenCalledTimes(1);
    expect((pages.mock.calls[0]![0] as CustomEvent).detail).toEqual({ page: 0 });
    expect(clicks).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener("wt-page-change", pages);
  }
});

test("a disconnected table does not request another server query", async () => {
  const { el, queries } = await table({ searchable: false });
  const count = queries.length;
  el.remove();
  el.searchTerm = "late";
  await el.updateComplete;
  expect(queries).toHaveLength(count);
});

test("server sorting and Clear all retain the existing events and never persist a page", async () => {
  const { el, queries } = await table({ viewKey: "events" });
  const sorts = vi.fn();
  const filters = vi.fn();
  el.addEventListener("wt-sort-change", sorts);
  el.addEventListener("wt-filter-change", filters);
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="state"]')!),
  );
  expect(sorts).toHaveBeenCalledTimes(1);
  expect(queries.at(-1)!.sortKey).toBe("state");
  el.chooseFilter("state", ["held"]);
  await el.updateComplete;
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!),
  );
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-clear-all")!),
  );
  expect(queries.at(-1)!.filters).toEqual({});
  expect(filters).toHaveBeenCalledTimes(2);
  expect(JSON.parse(sessionStorage.getItem("events")!)).toEqual({
    sortKey: "state",
    sortDirection: "ascending",
    filters: {},
  });
});
