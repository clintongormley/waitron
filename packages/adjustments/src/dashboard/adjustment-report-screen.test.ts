import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { AdjustmentsApi } from "./client.js";
import type { AdjustmentReportScreen } from "./adjustment-report-screen.js";
import "./adjustment-report-screen.js";
import { ALEX, alexEntries, emptyReport, fixtureReport, samEntry, SAM } from "./test-helpers.js";

const hosts: HTMLElement[] = [];
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setLocale("en");
});
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setLocale("en");
  for (const host of hosts.splice(0)) host.remove();
});

type Fake = {
  getReport: ReturnType<typeof vi.fn>;
  listEntries: ReturnType<typeof vi.fn>;
  currentBusinessDay: ReturnType<typeof vi.fn>;
  liveData: LiveData | undefined;
  background?: Fake;
};

function fakeApi(overrides: Partial<Fake> = {}): Fake {
  const api: Fake = {
    liveData: undefined,
    currentBusinessDay: vi.fn().mockResolvedValue("2026-09-29"),
    getReport: vi.fn((from: string, to: string) => Promise.resolve(fixtureReport(from, to))),
    listEntries: vi.fn().mockResolvedValue(alexEntries()),
    ...overrides,
  };
  api.background = api;
  return api;
}

async function settle(el: AdjustmentReportScreen): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  for (const table of el.shadowRoot!.querySelectorAll<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("wt-data-table"))
    await table.updateComplete;
}

async function mount(api: Fake): Promise<AdjustmentReportScreen> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.appendChild(host);
  hosts.push(host);
  const el = document.createElement("dashboard-adjustment-report-screen") as AdjustmentReportScreen;
  el.api = api as unknown as AdjustmentsApi;
  host.appendChild(el);
  await settle(el);
  return el;
}

function part(el: AdjustmentReportScreen, test: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`);
}

function text(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Each row's cells by column heading, in the order the table shows the rows. */
function rows(table: HTMLElement): { key: string; cells: Record<string, string> }[] {
  const root = table.shadowRoot!;
  const headings = [...root.querySelectorAll("thead th")].map((th) => text(th));
  return [...root.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")].map((row) => ({
    key: row.dataset.rowKey!,
    cells: Object.fromEntries(
      [...row.querySelectorAll("td")].map((td, index) => [headings[index]!, text(td)]),
    ),
  }));
}

function row(table: HTMLElement, key: string): Record<string, string> {
  const found = rows(table).find((each) => each.key === key);
  expect(found, key).toBeDefined();
  return found!.cells;
}

async function open(el: AdjustmentReportScreen, key: string): Promise<void> {
  part(el, "people")!
    .shadowRoot!.querySelector<HTMLButtonElement>(`tr[data-row-key="${key}"] .row-activate`)!
    .click();
  await settle(el);
}

async function pick(
  el: AdjustmentReportScreen,
  field: "from" | "to",
  value: string,
): Promise<void> {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(`input[name="${field}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event("change"));
  await settle(el);
}

describe("the adjustment report", () => {
  it("reads the venue's current business day, then the report over that one day", async () => {
    const api = fakeApi();
    const el = await mount(api);
    expect(api.currentBusinessDay).toHaveBeenCalledTimes(1);
    expect(api.getReport).toHaveBeenCalledTimes(1);
    expect(api.getReport).toHaveBeenCalledWith("2026-09-29", "2026-09-29");
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('input[name="from"]')!.value).toBe(
      "2026-09-29",
    );
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('input[name="to"]')!.value).toBe(
      "2026-09-29",
    );
  });

  it("says which bills are counted and what the rate measures", async () => {
    const el = await mount(fakeApi());
    expect(text(part(el, "intro"))).toBe(
      "Counts the cancellations, give-aways and discounts on the bills opened on these business days. A person's rate is what their own adjustments took off, as a share of the sales credited to them at prices before any adjustment.",
    );
  });

  it("shows the day's totals, with the cancelled items' list value apart from what was taken off", async () => {
    const el = await mount(fakeApi());
    const summary = part(el, "summary")!;
    const figure = (name: string) => text(summary.querySelector(`[data-figure="${name}"] dd`));
    expect(figure("count")).toBe("4");
    expect(figure("reduction")).toBe("€40.00");
    expect(figure("sales")).toBe("€1,000.00");
    expect(figure("rate")).toBe("4.0%");
    expect(figure("cancelled")).toBe("€37.00");
  });

  it("gives each person a row: Alex's three actions, €37.00 off, 4.6% and one approved by Mia; Sam 1.5%", async () => {
    const el = await mount(fakeApi());
    const table = part(el, "people")!;
    expect(rows(table).map((each) => each.key)).toEqual([ALEX, expect.any(String), SAM, "guests"]);
    const alex = row(table, ALEX);
    expect(alex.Name).toBe("Alex");
    expect(alex.Adjustments).toBe("3");
    expect(alex["Taken off"]).toBe("€37.00");
    expect(alex["Credited sales"]).toBe("€800.00");
    expect(alex.Rate).toBe("4.6%");
    expect(alex["List value cancelled"]).toBe("€37.00");
    expect(alex["Before firing"]).toBe("0");
    expect(alex["After firing"]).toBe("1 · €25.00");
    expect(alex["After serving"]).toBe("2 · €12.00");
    expect(alex["Approved by"]).toBe("Mia (1)");
    expect(row(table, SAM).Rate).toBe("1.5%");
    expect(row(table, SAM)["Whole bill"]).toBe("1 · €3.00");
  });

  it("shows a person with no credited sales without a rate", async () => {
    const el = await mount(fakeApi());
    const mia = rows(part(el, "people")!).find((each) => each.cells.Name === "Mia")!.cells;
    expect(mia["Credited sales"]).toBe("€0.00");
    expect(mia.Rate).toBe("—");
  });

  it("always shows the guests' row, labelled, even when guests adjusted nothing", async () => {
    const el = await mount(fakeApi());
    const guests = row(part(el, "people")!, "guests");
    expect(guests.Name).toBe("Guests");
    expect(guests.Adjustments).toBe("0");
    expect(guests["Taken off"]).toBe("€0.00");
    expect(guests["Credited sales"]).toBe("—");
    expect(guests.Rate).toBe("—");
  });

  it("names a person the directory no longer holds", async () => {
    const report = fixtureReport();
    report.people[0]!.name = null;
    const el = await mount(fakeApi({ getReport: vi.fn().mockResolvedValue(report) }));
    expect(row(part(el, "people")!, ALEX).Name).toBe("Unknown person");
  });

  it("offers the per-person columns in a chooser, and never the name", async () => {
    const el = await mount(fakeApi());
    const table = part(el, "people") as HTMLElement & {
      viewKey: string;
      columns: { key: string; choosable?: string }[];
    };
    expect(table.viewKey).toBe("waitron.adjustments.report.people");
    const choosable = Object.fromEntries(table.columns.map((c) => [c.key, c.choosable]));
    expect(choosable.name).toBeUndefined();
    expect(Object.entries(choosable).filter(([, value]) => value === undefined)).toEqual([
      ["name", undefined],
    ]);
    expect(choosable.approvalsGiven).toBe("hidden");
  });

  it("breaks the totals down by action, by stage and by reason, reasons as they were recorded", async () => {
    const el = await mount(fakeApi());
    const lines = (test: string) =>
      [...part(el, test)!.querySelectorAll("tbody tr")].map((tr) =>
        [...tr.querySelectorAll("th, td")].map((cell) => text(cell)),
      );
    expect(lines("by-action")).toEqual([
      ["Cancellations", "2", "€25.00", "€37.00"],
      ["Give-aways", "1", "€12.00", "€0.00"],
      ["Percentage discounts", "0", "€0.00", "€0.00"],
      ["Amount discounts", "1", "€3.00", "€0.00"],
    ]);
    expect(lines("by-stage")).toEqual([
      ["Before firing", "0", "€0.00", "€0.00"],
      ["After firing", "1", "€25.00", "€25.00"],
      ["After serving", "2", "€12.00", "€12.00"],
      ["Whole bill", "1", "€3.00", "€0.00"],
    ]);
    expect(lines("by-reason")).toEqual([
      ["Entry error", "2", "€25.00", "€37.00"],
      ["Cold food", "1", "€12.00", "€0.00"],
      ["Staff meal", "1", "€3.00", "€0.00"],
    ]);
  });

  it("says so in words when there were no adjustments, and keeps the guests' row", async () => {
    const el = await mount(fakeApi({ getReport: vi.fn().mockResolvedValue(emptyReport()) }));
    expect(text(part(el, "none"))).toBe("No adjustments on these days.");
    expect(rows(part(el, "people")!).map((each) => each.key)).toEqual(["guests"]);
    expect(text(part(el, "no-reasons"))).toBe("No reason was used on these days.");
    expect(part(el, "by-reason")).toBeNull();
  });

  it("writes rates with the language's decimal mark and percent sign", async () => {
    setLocale("es-ES");
    const el = await mount(fakeApi());
    const alex = rows(part(el, "people")!).find((each) => each.key === ALEX)!.cells;
    expect(alex.Tasa).toBe("4,6 %");
    expect(alex.Descontado).toBe("37,00 €");
    expect(text(part(el, "heading"))).toBe("Informe de ajustes");
  });
});

describe("the range", () => {
  it("reads the report again when a day changes", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await pick(el, "from", "2026-09-01");
    expect(api.getReport).toHaveBeenLastCalledWith("2026-09-01", "2026-09-29");
    expect(api.getReport).toHaveBeenCalledTimes(2);
  });

  it("keeps a range chosen before the business day arrives", async () => {
    let answer!: (day: string) => void;
    const api = fakeApi({
      currentBusinessDay: vi.fn(() => new Promise<string>((resolve) => (answer = resolve))),
    });
    const el = await mount(api);
    await pick(el, "from", "2026-09-01");
    await pick(el, "to", "2026-09-02");
    answer("2026-09-29");
    await settle(el);
    expect(api.getReport).toHaveBeenLastCalledWith("2026-09-01", "2026-09-02");
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('input[name="from"]')!.value).toBe(
      "2026-09-01",
    );
  });

  it("falls back to today when the business day cannot be read", async () => {
    const api = fakeApi({ currentBusinessDay: vi.fn().mockRejectedValue({ code: "x" }) });
    await mount(api);
    const today = new Date().toISOString().slice(0, 10);
    expect(api.getReport).toHaveBeenCalledWith(today, today);
  });

  it("ignores a cleared day", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await pick(el, "to", "");
    expect(api.getReport).toHaveBeenCalledTimes(1);
  });

  it("explains a range that runs backwards beside the days, and asks nothing", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await pick(el, "from", "2026-09-30");
    expect(api.getReport).toHaveBeenCalledTimes(1);
    expect(text(part(el, "range-error"))).toBe("Choose a first day on or before the last day.");
    const from = el.shadowRoot!.querySelector<HTMLInputElement>('input[name="from"]')!;
    expect(from.getAttribute("aria-invalid")).toBe("true");
    expect(from.getAttribute("aria-describedby")).toBe("range-error");
    expect(part(el, "people")).toBeNull();
    await pick(el, "to", "2026-09-30");
    expect(part(el, "range-error")).toBeNull();
    expect(api.getReport).toHaveBeenLastCalledWith("2026-09-30", "2026-09-30");
  });

  it("shows a refusal in words and no stale report", async () => {
    const getReport = vi
      .fn()
      .mockImplementationOnce((from: string, to: string) =>
        Promise.resolve(fixtureReport(from, to)),
      )
      .mockRejectedValue({ code: "management.forbidden" });
    const el = await mount(fakeApi({ getReport }));
    await pick(el, "from", "2026-09-28");
    const alert = part(el, "load-error")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(text(alert)).toBe(
      "The adjustment report could not be loaded: Something went wrong, try again",
    );
    expect(part(el, "people")).toBeNull();
    expect(part(el, "summary")).toBeNull();
  });
});

describe("the drill-down", () => {
  it("lists Alex's three adjustments with reason as recorded, note, time, requester and approver apart", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await open(el, ALEX);
    expect(api.listEntries).toHaveBeenCalledWith("2026-09-29", "2026-09-29", { personId: ALEX });
    expect(text(part(el, "entries-heading"))).toBe("Adjustments by Alex");
    const list = rows(part(el, "entries")!);
    expect(list.map((each) => each.key)).toEqual(["e3", "e2", "e1"]);
    const comp = list[2]!.cells;
    const at = new Date("2026-09-29T19:20:00.000Z");
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(comp.Time).toBe(
      `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`,
    );
    expect(comp.Action).toBe("Give away");
    expect(comp.When).toBe("After serving");
    expect(comp.Reason).toBe("Cold food");
    expect(comp.Note).toBe("Came out cold");
    expect(comp.Item).toBe("Burger");
    expect(comp.Quantity).toBe("1");
    expect(comp["Taken off"]).toBe("€12.00");
    expect(comp["List value"]).toBe("€12.00");
    expect(comp["Requested by"]).toBe("Alex");
    expect(comp["Approved by"]).toBe("Mia");
    expect(comp.Order).toBe("40");
    const cancel = list[1]!.cells;
    expect(cancel.Action).toBe("Cancel");
    expect(cancel["Taken off"]).toBe("€0.00");
    expect(cancel["List value"]).toBe("€12.00");
    expect(cancel.Note).toBe("—");
    expect(cancel["Approved by"]).toBe("—");
    expect(list[0]!.cells.When).toBe("After firing");
  });

  it("moves focus to the list's heading, and closes back to the report", async () => {
    const el = await mount(fakeApi());
    await open(el, ALEX);
    expect(el.shadowRoot!.activeElement).toBe(part(el, "entries-heading"));
    part(el, "close-entries")!.click();
    await settle(el);
    expect(part(el, "entries")).toBeNull();
  });

  it("lists every adjustment from the summary, and a whole-bill discount without an item", async () => {
    const api = fakeApi({ listEntries: vi.fn().mockResolvedValue([samEntry()]) });
    const el = await mount(api);
    part(el, "show-all")!.click();
    await settle(el);
    expect(api.listEntries).toHaveBeenCalledWith("2026-09-29", "2026-09-29", "everyone");
    expect(text(part(el, "entries-heading"))).toBe("Every adjustment");
    const cells = row(part(el, "entries")!, "e4");
    expect(cells.Action).toBe("Percentage discount (12.5%)");
    expect(cells.When).toBe("Whole bill");
    expect(cells.Item).toBe("Whole bill");
    expect(cells.Quantity).toBe("—");
  });

  it("lists the guests' adjustments, and says so in words when there are none", async () => {
    const api = fakeApi({ listEntries: vi.fn().mockResolvedValue([]) });
    const el = await mount(api);
    await open(el, "guests");
    expect(api.listEntries).toHaveBeenCalledWith("2026-09-29", "2026-09-29", "guests");
    expect(text(part(el, "entries-heading"))).toBe("Adjustments by guests");
    const table = part(el, "entries") as HTMLElement & { emptyMessage: string };
    expect(table.emptyMessage).toBe("No adjustments on these days.");
    expect(text(table.shadowRoot!.querySelector(".message"))).toBe("No adjustments on these days.");
  });

  it("names a guest as the requester of a guest's adjustment", async () => {
    const entry = { ...samEntry(), byGuest: true };
    const el = await mount(fakeApi({ listEntries: vi.fn().mockResolvedValue([entry]) }));
    await open(el, "guests");
    expect(row(part(el, "entries")!, "e4")["Requested by"]).toBe("Guest");
  });

  it("asks again only when a different list is chosen", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await open(el, ALEX);
    await open(el, ALEX);
    expect(api.listEntries).toHaveBeenCalledTimes(1);
    await open(el, SAM);
    part(el, "show-all")!.click();
    await settle(el);
    await open(el, "guests");
    await open(el, "guests");
    expect(api.listEntries.mock.calls.map((call) => call[2])).toEqual([
      { personId: ALEX },
      { personId: SAM },
      "everyone",
      "guests",
    ]);
    expect(text(part(el, "entries-heading"))).toBe("Adjustments by guests");
  });

  it("keeps the person's name over a range where they have no row", async () => {
    const getReport = vi
      .fn()
      .mockImplementationOnce((from: string, to: string) =>
        Promise.resolve(fixtureReport(from, to)),
      )
      .mockImplementation((from: string, to: string) => Promise.resolve(emptyReport(from, to)));
    const el = await mount(fakeApi({ getReport }));
    await open(el, ALEX);
    await pick(el, "from", "2026-09-01");
    expect(text(part(el, "entries-heading"))).toBe("Adjustments by Alex");
  });

  it("reads the open list again over a new range", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await open(el, ALEX);
    await pick(el, "to", "2026-09-30");
    expect(api.listEntries).toHaveBeenLastCalledWith("2026-09-29", "2026-09-30", {
      personId: ALEX,
    });
    expect(part(el, "entries")).not.toBeNull();
  });

  it("shows a refused list in words inside the list", async () => {
    const api = fakeApi({ listEntries: vi.fn().mockRejectedValue({ code: "x" }) });
    const el = await mount(api);
    await open(el, ALEX);
    const table = part(el, "entries") as HTMLElement & { errorMessage: string };
    expect(table.errorMessage).toBe(
      "These adjustments could not be loaded: Something went wrong, try again",
    );
  });

  it("names each row's opener after its person", async () => {
    const el = await mount(fakeApi());
    const activator = (key: string) =>
      part(el, "people")!.shadowRoot!.querySelector(`tr[data-row-key="${key}"] .row-activate`)!;
    expect(activator(ALEX).getAttribute("aria-label")).toBe("List Alex's adjustments");
    expect(activator("guests").getAttribute("aria-label")).toBe("List the guests' adjustments");
  });
});

describe("sorting and columns", () => {
  const keys = (table: HTMLElement) => rows(table).map((each) => each.key);
  async function sortBy(el: AdjustmentReportScreen, test: string, key: string): Promise<void> {
    part(el, test)!
      .shadowRoot!.querySelector<HTMLButtonElement>(`button[data-sort="${key}"]`)!
      .click();
    await settle(el);
  }

  it("sorts the people by each column, a figure that does not apply last", async () => {
    localStorage.setItem(
      "waitron.adjustments.report.people:columns",
      JSON.stringify({ approvalsGiven: true }),
    );
    const el = await mount(fakeApi());
    const mia = rows(part(el, "people")!)[1]!.key;
    const orders: [string, string[]][] = [
      ["name", [ALEX, "guests", mia, SAM]],
      ["count", [mia, "guests", SAM, ALEX]],
      ["reduction", [mia, "guests", SAM, ALEX]],
      ["sales", [mia, SAM, ALEX, "guests"]],
      ["rate", [SAM, ALEX, mia, "guests"]],
      ["cancelled", [mia, SAM, "guests", ALEX]],
      ["afterFiring", [mia, SAM, "guests", ALEX]],
      ["approvalsGiven", [ALEX, SAM, mia, "guests"]],
    ];
    for (const [key, order] of orders) {
      await sortBy(el, "people", key);
      expect(keys(part(el, "people")!), key).toEqual(order);
    }
  });

  it("shows the approvals each person gave once that column is chosen", async () => {
    localStorage.setItem(
      "waitron.adjustments.report.people:columns",
      JSON.stringify({ approvalsGiven: true }),
    );
    const el = await mount(fakeApi());
    const table = part(el, "people")!;
    const mia = rows(table).find((each) => each.cells.Name === "Mia")!.cells;
    expect(mia["Approvals given"]).toBe("1");
    expect(row(table, ALEX)["Approvals given"]).toBe("0");
    expect(row(table, "guests")["Approvals given"]).toBe("—");
  });

  it("sorts the listed adjustments by each column", async () => {
    const el = await mount(
      fakeApi({ listEntries: vi.fn().mockResolvedValue([...alexEntries(), samEntry()]) }),
    );
    part(el, "show-all")!.click();
    await settle(el);
    const orders: [string, string[]][] = [
      ["time", ["e1", "e2", "e3", "e4"]],
      ["action", ["e3", "e2", "e1", "e4"]],
      ["reason", ["e1", "e3", "e2", "e4"]],
      ["reduction", ["e2", "e4", "e1", "e3"]],
      ["listValue", ["e2", "e1", "e4", "e3"]],
      ["order", ["e2", "e1", "e3", "e4"]],
    ];
    for (const [key, order] of orders) {
      await sortBy(el, "entries", key);
      expect(keys(part(el, "entries")!), key).toEqual(order);
    }
  });

  it("shows whom each adjustment's item was credited to once that column is chosen", async () => {
    localStorage.setItem(
      "waitron.adjustments.report.entries:columns",
      JSON.stringify({ creditedTo: true }),
    );
    const el = await mount(
      fakeApi({ listEntries: vi.fn().mockResolvedValue([...alexEntries(), samEntry()]) }),
    );
    part(el, "show-all")!.click();
    await settle(el);
    const table = part(el, "entries")!;
    expect(row(table, "e1")["Credited to"]).toBe("Alex");
    expect(row(table, "e4")["Credited to"]).toBe("—");
  });
});

describe("live data", () => {
  it("reads the report and the open list again, passively, when an adjustment changes", async () => {
    const liveData = new LiveData();
    const background = fakeApi();
    const api = fakeApi({ liveData });
    api.background = background;
    const el = await mount(api);
    await open(el, ALEX);
    expect(api.getReport).toHaveBeenCalledTimes(1);
    expect(api.listEntries).toHaveBeenCalledTimes(1);
    liveData.invalidate([{ type: "adjustments" }]);
    await vi.waitFor(() => {
      expect(background.getReport).toHaveBeenCalledWith("2026-09-29", "2026-09-29");
      expect(background.listEntries).toHaveBeenCalledWith("2026-09-29", "2026-09-29", {
        personId: ALEX,
      });
    });
    expect(api.getReport).toHaveBeenCalledTimes(1);
    expect(api.listEntries).toHaveBeenCalledTimes(1);
    liveData.clear();
  });
});
