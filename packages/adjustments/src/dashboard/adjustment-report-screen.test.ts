import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { AdjustmentsApi } from "./client.js";
import { ADJUSTMENTS_STRINGS } from "./strings.js";
import type { AdjustmentReportScreen } from "./adjustment-report-screen.js";
import "./adjustment-report-screen.js";
import {
  ALEX,
  alexEntries,
  emptyReport,
  fixtureReport,
  onePage,
  samEntry,
  SAM,
} from "../../test/report-fixtures.js";

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
  liveData: LiveData | undefined;
  background?: Fake;
};

type Range = { from: string; to: string };

/** The routes answer a request without a range with the venue's current business day. */
function answer(report: typeof fixtureReport, range?: Range) {
  return range === undefined ? report("2026-09-29") : report(range.from, range.to);
}

function fakeApi(overrides: Partial<Fake> = {}): Fake {
  const api: Fake = {
    liveData: undefined,
    getReport: vi.fn((range?: Range) => Promise.resolve(answer(fixtureReport, range))),
    listEntries: vi.fn().mockResolvedValue(onePage(alexEntries())),
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

/** Each line of a breakdown table: its label, then its figures. */
function breakdown(el: AdjustmentReportScreen, test: string): string[][] {
  return [...part(el, test)!.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("th, td")].map((cell) => text(cell)),
  );
}

type DayField = HTMLElement & { value: string; type: string; label: string; error: string };

function day(el: AdjustmentReportScreen, field: "from" | "to"): DayField {
  return el.shadowRoot!.querySelector<DayField>(`wt-input[name="${field}"]`)!;
}

/** The native date box inside the shared field. */
function dayBox(el: AdjustmentReportScreen, field: "from" | "to"): HTMLInputElement {
  return day(el, field).shadowRoot!.querySelector<HTMLInputElement>("input")!;
}

async function pick(
  el: AdjustmentReportScreen,
  field: "from" | "to",
  value: string,
): Promise<void> {
  const input = dayBox(el, field);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await settle(el);
}

describe("the adjustment report", () => {
  it("first asks for the venue's current business day, and shows the days the answer covers", async () => {
    const api = fakeApi();
    const el = await mount(api);
    expect(api.getReport).toHaveBeenCalledTimes(1);
    expect(api.getReport).toHaveBeenCalledWith(undefined);
    expect(day(el, "from").value).toBe("2026-09-29");
    expect(day(el, "to").value).toBe("2026-09-29");
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

  it("breaks down only the open person's adjustments, under headings that name them", async () => {
    const el = await mount(fakeApi());
    await open(el, ALEX);
    expect(text(part(el, "by-action-heading"))).toBe("Alex's adjustments by action");
    expect(text(part(el, "by-stage-heading"))).toBe("Alex's adjustments by stage");
    expect(text(part(el, "by-reason-heading"))).toBe("Alex's adjustments by reason");
    expect(breakdown(el, "by-action")).toEqual([
      ["Cancellations", "2", "€25.00", "€37.00"],
      ["Give-aways", "1", "€12.00", "€0.00"],
      ["Percentage discounts", "0", "€0.00", "€0.00"],
      ["Amount discounts", "0", "€0.00", "€0.00"],
    ]);
    expect(breakdown(el, "by-stage")).toEqual([
      ["Before firing", "0", "€0.00", "€0.00"],
      ["After firing", "1", "€25.00", "€25.00"],
      ["After serving", "2", "€12.00", "€12.00"],
      ["Whole bill", "0", "€0.00", "€0.00"],
    ]);
    expect(breakdown(el, "by-reason")).toEqual([
      ["Entry error", "2", "€25.00", "€37.00"],
      ["Cold food", "1", "€12.00", "€0.00"],
    ]);
    await open(el, SAM);
    expect(text(part(el, "by-action-heading"))).toBe("Sam's adjustments by action");
    expect(breakdown(el, "by-action")).toEqual([
      ["Cancellations", "0", "€0.00", "€0.00"],
      ["Give-aways", "0", "€0.00", "€0.00"],
      ["Percentage discounts", "0", "€0.00", "€0.00"],
      ["Amount discounts", "1", "€3.00", "€0.00"],
    ]);
    expect(breakdown(el, "by-stage")[3]).toEqual(["Whole bill", "1", "€3.00", "€0.00"]);
    expect(breakdown(el, "by-reason")).toEqual([["Staff meal", "1", "€3.00", "€0.00"]]);
  });

  it("breaks down the guests' adjustments apart, and everyone's again once the list shows everyone or closes", async () => {
    const el = await mount(fakeApi({ listEntries: vi.fn().mockResolvedValue(onePage([])) }));
    await open(el, "guests");
    expect(text(part(el, "by-action-heading"))).toBe("Guests' adjustments by action");
    expect(text(part(el, "by-stage-heading"))).toBe("Guests' adjustments by stage");
    expect(text(part(el, "by-reason-heading"))).toBe("Guests' adjustments by reason");
    expect(breakdown(el, "by-action").map((line) => line[1])).toEqual(["0", "0", "0", "0"]);
    expect(part(el, "no-reasons")).not.toBeNull();
    part(el, "show-all")!.click();
    await settle(el);
    expect(text(part(el, "by-action-heading"))).toBe("By action");
    expect(breakdown(el, "by-reason")).toHaveLength(3);
    await open(el, ALEX);
    part(el, "close-entries")!.click();
    await settle(el);
    expect(text(part(el, "by-action-heading"))).toBe("By action");
    expect(text(part(el, "by-stage-heading"))).toBe("By stage");
    expect(text(part(el, "by-reason-heading"))).toBe("By reason");
    expect(breakdown(el, "by-action")[3]).toEqual(["Amount discounts", "1", "€3.00", "€0.00"]);
  });

  it("breaks down nothing for an open person the range holds no row for", async () => {
    const getReport = vi
      .fn()
      .mockImplementationOnce((range?: Range) => Promise.resolve(answer(fixtureReport, range)))
      .mockImplementation((range?: Range) => Promise.resolve(answer(emptyReport, range)));
    const el = await mount(fakeApi({ getReport }));
    await open(el, ALEX);
    await pick(el, "from", "2026-09-01");
    expect(text(part(el, "by-action-heading"))).toBe("Alex's adjustments by action");
    expect(breakdown(el, "by-action").map((line) => line[1])).toEqual(["0", "0", "0", "0"]);
    expect(part(el, "no-reasons")).not.toBeNull();
  });

  it("names the open person in Spanish breakdown headings", async () => {
    setLocale("es-ES");
    const el = await mount(fakeApi());
    await open(el, ALEX);
    expect(text(part(el, "by-action-heading"))).toBe("Ajustes de Alex por acción");
    expect(text(part(el, "by-stage-heading"))).toBe("Ajustes de Alex por momento");
    expect(text(part(el, "by-reason-heading"))).toBe("Ajustes de Alex por motivo");
    await open(el, "guests");
    expect(text(part(el, "by-action-heading"))).toBe(
      ADJUSTMENTS_STRINGS.es["adjustment_report.guests_by_action"],
    );
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
    expect(api.getReport).toHaveBeenLastCalledWith({ from: "2026-09-01", to: "2026-09-29" });
    expect(api.getReport).toHaveBeenCalledTimes(2);
  });

  it("keeps a range chosen before the first answer arrives", async () => {
    let first!: (report: ReturnType<typeof fixtureReport>) => void;
    const getReport = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (first = resolve)))
      .mockImplementation((range?: Range) => Promise.resolve(answer(fixtureReport, range)));
    const el = await mount(fakeApi({ getReport }));
    await pick(el, "from", "2026-09-01");
    await pick(el, "to", "2026-09-02");
    first(fixtureReport("2026-09-29"));
    await settle(el);
    expect(getReport).toHaveBeenLastCalledWith({ from: "2026-09-01", to: "2026-09-02" });
    expect(day(el, "from").value).toBe("2026-09-01");
    expect(day(el, "to").value).toBe("2026-09-02");
  });

  it("leaves the days empty when the first read is refused, and reads the days then chosen", async () => {
    const getReport = vi
      .fn()
      .mockRejectedValueOnce({ code: "x" })
      .mockImplementation((range?: Range) => Promise.resolve(answer(fixtureReport, range)));
    const el = await mount(fakeApi({ getReport }));
    expect(part(el, "load-error")).not.toBeNull();
    expect(day(el, "from").value).toBe("");
    await pick(el, "from", "2026-09-01");
    expect(getReport).toHaveBeenCalledTimes(1);
    await pick(el, "to", "2026-09-03");
    expect(getReport).toHaveBeenLastCalledWith({ from: "2026-09-01", to: "2026-09-03" });
    expect(part(el, "load-error")).toBeNull();
    expect(part(el, "people")).not.toBeNull();
  });

  it("follows the current business day while no day has been chosen", async () => {
    const liveData = new LiveData();
    const getReport = vi
      .fn()
      .mockResolvedValueOnce(fixtureReport("2026-09-29"))
      .mockResolvedValue(fixtureReport("2026-09-30"));
    const api = fakeApi({ liveData, getReport });
    const el = await mount(api);
    await open(el, ALEX);
    liveData.invalidate([{ type: "adjustments" }]);
    await vi.waitFor(() => expect(day(el, "to").value).toBe("2026-09-30"));
    await vi.waitFor(() =>
      expect(api.listEntries).toHaveBeenLastCalledWith("2026-09-30", "2026-09-30", {
        personId: ALEX,
      }),
    );
    liveData.clear();
  });

  it("draws both days as the shared date field, and a day typed into one asks for that range", async () => {
    const api = fakeApi();
    const el = await mount(api);
    expect(day(el, "from").type).toBe("date");
    expect(day(el, "to").type).toBe("date");
    expect(day(el, "from").label).toBe("From");
    expect(day(el, "to").label).toBe("To");
    await pick(el, "from", "2026-09-01");
    expect(api.getReport).toHaveBeenLastCalledWith({ from: "2026-09-01", to: "2026-09-29" });
    expect(day(el, "from").value).toBe("2026-09-01");
  });

  it("marks the last day too while a range runs backwards, and says why once, under the first day", async () => {
    const el = await mount(fakeApi());
    await pick(el, "from", "2026-09-30");
    expect(dayBox(el, "to").getAttribute("aria-invalid")).toBe("true");
    expect(day(el, "to").error).toBe("");
    expect(part(el, "range-error")).toBeNull();
    await pick(el, "from", "2026-09-29");
    expect(dayBox(el, "from").getAttribute("aria-invalid")).toBe("false");
    expect(dayBox(el, "to").getAttribute("aria-invalid")).toBe("false");
  });

  it("names the days in Spanish", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    expect(day(el, "from").label).toBe("Desde");
    expect(day(el, "to").label).toBe("Hasta");
  });

  it("keeps the report, and says nothing is wrong, while a day is cleared or not yet whole", async () => {
    const el = await mount(fakeApi());
    await pick(el, "to", "");
    expect(part(el, "people")).not.toBeNull();
    expect(day(el, "from").error).toBe("");
    expect(dayBox(el, "to").getAttribute("aria-invalid")).toBe("false");
  });

  it("keeps a day's change inside the screen", async () => {
    const el = await mount(fakeApi());
    const heard = vi.fn();
    document.addEventListener("wt-change", heard);
    try {
      await pick(el, "from", "2026-09-01");
    } finally {
      document.removeEventListener("wt-change", heard);
    }
    expect(heard).not.toHaveBeenCalled();
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
    expect(day(el, "from").error).toBe("Choose a first day on or before the last day.");
    const from = dayBox(el, "from");
    expect(from.getAttribute("aria-invalid")).toBe("true");
    expect(
      day(el, "from").shadowRoot!.getElementById(from.getAttribute("aria-describedby")!)!
        .textContent,
    ).toBe("Choose a first day on or before the last day.");
    expect(part(el, "people")).toBeNull();
    await pick(el, "to", "2026-09-30");
    expect(day(el, "from").error).toBe("");
    expect(api.getReport).toHaveBeenLastCalledWith({ from: "2026-09-30", to: "2026-09-30" });
  });

  it("shows a refusal in words and no stale report", async () => {
    const getReport = vi
      .fn()
      .mockImplementationOnce((range?: Range) => Promise.resolve(answer(fixtureReport, range)))
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
    const api = fakeApi({ listEntries: vi.fn().mockResolvedValue(onePage([samEntry()])) });
    const el = await mount(api);
    part(el, "show-all")!.click();
    await settle(el);
    expect(api.listEntries).toHaveBeenCalledWith("2026-09-29", "2026-09-29", "everyone");
    expect(text(part(el, "entries-heading"))).toBe("Every adjustment");
    const cells = row(part(el, "entries")!, "e4");
    expect(cells.Action).toBe("Amount discount");
    expect(cells.When).toBe("Whole bill");
    expect(cells.Item).toBe("Whole bill");
    expect(cells.Quantity).toBe("—");
  });

  it("writes a percentage discount's percentage beside its action", async () => {
    const entry = { ...samEntry(), action: "discount_percent" as const, percentBp: 1250 };
    const el = await mount(fakeApi({ listEntries: vi.fn().mockResolvedValue(onePage([entry])) }));
    part(el, "show-all")!.click();
    await settle(el);
    expect(row(part(el, "entries")!, "e4").Action).toBe("Percentage discount (12.5%)");
  });

  it("lists the guests' adjustments, and says so in words when there are none", async () => {
    const api = fakeApi({ listEntries: vi.fn().mockResolvedValue(onePage([])) });
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
    const el = await mount(fakeApi({ listEntries: vi.fn().mockResolvedValue(onePage([entry])) }));
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
      .mockImplementationOnce((range?: Range) => Promise.resolve(answer(fixtureReport, range)))
      .mockImplementation((range?: Range) => Promise.resolve(answer(emptyReport, range)));
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

describe("more of a long list", () => {
  /** The first page is Alex's three rows and names a cursor; the second is Sam's row, and the last. */
  function twoPages(second: () => Promise<unknown> = () => Promise.resolve(onePage([samEntry()]))) {
    return vi.fn((_from: string, _to: string, _of: unknown, page?: { after?: string }) =>
      page?.after === "c1" ? second() : Promise.resolve({ entries: alexEntries(), next: "c1" }),
    );
  }

  async function showAll(el: AdjustmentReportScreen): Promise<void> {
    part(el, "show-all")!.click();
    await settle(el);
  }

  async function showMore(el: AdjustmentReportScreen): Promise<void> {
    part(el, "show-more")!.click();
    await settle(el);
  }

  const keys = (el: AdjustmentReportScreen) => rows(part(el, "entries")!).map((each) => each.key);

  it("adds the next page below the rows already shown, then offers no more after the last", async () => {
    const api = fakeApi({ listEntries: twoPages() });
    const el = await mount(api);
    await showAll(el);
    expect(keys(el)).toEqual(["e3", "e2", "e1"]);
    expect(text(part(el, "show-more"))).toBe("Show more");
    part(el, "show-more")!.focus();
    await showMore(el);
    expect(api.listEntries).toHaveBeenLastCalledWith("2026-09-29", "2026-09-29", "everyone", {
      after: "c1",
    });
    expect(keys(el)).toEqual(["e3", "e2", "e1", "e4"]);
    expect(part(el, "show-more")).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(part(el, "entries-heading"));
  });

  it("offers no more when the first page is the last", async () => {
    const el = await mount(fakeApi());
    await open(el, ALEX);
    expect(keys(el)).toEqual(["e3", "e2", "e1"]);
    expect(part(el, "show-more")).toBeNull();
  });

  it("keeps focus on Show more while there is still more", async () => {
    const listEntries = vi.fn((_f: string, _t: string, _o: unknown, page?: { after?: string }) =>
      Promise.resolve(
        page?.after === undefined
          ? { entries: alexEntries(), next: "c1" }
          : { entries: [samEntry()], next: "c2" },
      ),
    );
    const el = await mount(fakeApi({ listEntries }));
    await showAll(el);
    part(el, "show-more")!.focus();
    await showMore(el);
    expect(keys(el)).toEqual(["e3", "e2", "e1", "e4"]);
    expect(el.shadowRoot!.activeElement).toBe(part(el, "show-more"));
  });

  it("marks Show more busy while the next page loads", async () => {
    let resolve!: (page: unknown) => void;
    const el = await mount(
      fakeApi({ listEntries: twoPages(() => new Promise((done) => (resolve = done))) }),
    );
    await showAll(el);
    await showMore(el);
    expect(part(el, "show-more")!.hasAttribute("loading")).toBe(true);
    resolve(onePage([samEntry()]));
    await settle(el);
    expect(part(el, "show-more")).toBeNull();
  });

  it("says why a further page could not be loaded, and keeps the rows already shown", async () => {
    const el = await mount(fakeApi({ listEntries: twoPages(() => Promise.reject({ code: "x" })) }));
    await showAll(el);
    await showMore(el);
    const alert = part(el, "more-error")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(text(alert)).toBe(
      "More adjustments could not be loaded: Something went wrong, try again",
    );
    expect(keys(el)).toEqual(["e3", "e2", "e1"]);
    expect(part(el, "show-more")!.hasAttribute("loading")).toBe(false);
  });

  /** A fake that answers the next page after each cursor it is given, and none without one. */
  function pagesAfter(pages: Record<string, { entries: unknown[]; next: string | null }>) {
    return vi.fn((_f: string, _t: string, _o: unknown, page?: { after?: string }) => {
      const answer = pages[page?.after ?? ""];
      return answer === undefined ? new Promise(() => {}) : Promise.resolve(answer);
    });
  }

  /** Watches the list with live data, the refreshes answered by `background`. */
  async function watchedList(
    listEntries: ReturnType<typeof vi.fn>,
    background: ReturnType<typeof vi.fn>,
  ): Promise<{ el: AdjustmentReportScreen; liveData: LiveData; api: Fake; refresh: Fake }> {
    const liveData = new LiveData();
    const refresh = fakeApi({ listEntries: background });
    const api = fakeApi({ liveData, listEntries });
    api.background = refresh;
    const el = await mount(api);
    await showAll(el);
    return { el, liveData, api, refresh };
  }

  /** Live data reads the list again, and the screen takes what it read. */
  async function refreshed(
    el: AdjustmentReportScreen,
    liveData: LiveData,
    refresh: Fake,
    requests: number,
  ): Promise<void> {
    liveData.invalidate([{ type: "adjustments" }]);
    await vi.waitFor(() => expect(refresh.listEntries).toHaveBeenCalledTimes(requests));
    await settle(el);
  }

  const EVERYONE = ["2026-09-29", "2026-09-29", "everyone"] as const;
  const newer = (id: string) => ({ ...samEntry(), id, createdAt: "2026-09-29T21:30:00.000Z" });
  const many = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => newer(`m${from + i}`));

  it("reads only the first page again when it holds a row already shown", async () => {
    const { el, liveData, refresh } = await watchedList(twoPages(), twoPages());
    await showMore(el);
    expect(keys(el)).toEqual(["e3", "e2", "e1", "e4"]);
    await refreshed(el, liveData, refresh, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refresh.listEntries.mock.calls).toEqual([[...EVERYONE]]);
    expect(keys(el)).toEqual(["e3", "e2", "e1", "e4"]);
    expect(part(el, "show-more")).toBeNull();
    liveData.clear();
  });

  it("puts a new adjustment on top, and keeps the rows loaded below it and where the list goes on", async () => {
    const { el, liveData, api, refresh } = await watchedList(
      pagesAfter({
        "": { entries: alexEntries(), next: "c1" },
        c1: { entries: [samEntry()], next: "c4" },
      }),
      pagesAfter({ "": { entries: [newer("e5"), ...alexEntries().slice(0, 2)], next: "c2" } }),
    );
    await showMore(el);
    await refreshed(el, liveData, refresh, 1);
    expect(keys(el)).toEqual(["e5", "e3", "e2", "e1", "e4"]);
    part(el, "show-more")!.click();
    expect(api.listEntries).toHaveBeenLastCalledWith(...EVERYONE, { after: "c4" });
    liveData.clear();
  });

  it("reads further pages only until it meets a row already shown", async () => {
    const { el, liveData, refresh } = await watchedList(
      twoPages(),
      pagesAfter({
        "": { entries: [newer("e6"), newer("e5")], next: "cx" },
        cx: { entries: alexEntries(), next: "c1" },
      }),
    );
    await showMore(el);
    await refreshed(el, liveData, refresh, 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refresh.listEntries.mock.calls).toEqual([
      [...EVERYONE],
      [...EVERYONE, { after: "cx", limit: 498 }],
    ]);
    expect(keys(el)).toEqual(["e6", "e5", "e3", "e2", "e1", "e4"]);
    expect(part(el, "show-more")).toBeNull();
    liveData.clear();
  });

  it("shows the rows it read again as they now read", async () => {
    const renamed = alexEntries().map((entry) => ({
      ...entry,
      requestedBy: { ...entry.requestedBy, name: "Alexandra" },
    }));
    const { el, liveData, refresh } = await watchedList(
      twoPages(),
      pagesAfter({ "": { entries: renamed, next: "c1" } }),
    );
    await refreshed(el, liveData, refresh, 1);
    expect(row(part(el, "entries")!, "e3")["Requested by"]).toBe("Alexandra");
    liveData.clear();
  });

  it("starts again from what it read once the new rows fill the largest page, dropping a page on its way", async () => {
    let resolve!: (page: unknown) => void;
    const { el, liveData, api, refresh } = await watchedList(
      twoPages(() => new Promise((done) => (resolve = done))),
      pagesAfter({
        "": { entries: many(0, 200), next: "p1" },
        p1: { entries: many(200, 300), next: "p2" },
        p2: { entries: alexEntries(), next: "c1" },
      }),
    );
    await showMore(el);
    await refreshed(el, liveData, refresh, 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refresh.listEntries.mock.calls).toEqual([
      [...EVERYONE],
      [...EVERYONE, { after: "p1", limit: 300 }],
    ]);
    expect(keys(el)).toEqual(many(0, 500).map((entry) => entry.id));
    resolve(onePage([samEntry()]));
    await settle(el);
    expect(keys(el)).toHaveLength(500);
    expect(part(el, "show-more")!.hasAttribute("loading")).toBe(false);
    part(el, "show-more")!.click();
    expect(api.listEntries).toHaveBeenLastCalledWith(...EVERYONE, { after: "p2" });
    liveData.clear();
  });

  it("starts again from what it read when none of the rows shown come back", async () => {
    const { el, liveData, refresh } = await watchedList(
      twoPages(),
      pagesAfter({ "": { entries: [newer("e5")], next: null } }),
    );
    await refreshed(el, liveData, refresh, 1);
    expect(keys(el)).toEqual(["e5"]);
    expect(part(el, "show-more")).toBeNull();
    liveData.clear();
  });

  it("stops reading once a new range starts the list again", async () => {
    let first!: (page: unknown) => void;
    const background = vi.fn((_f: string, _t: string, _o: unknown, page?: { after?: string }) =>
      page?.after === undefined
        ? new Promise((done) => (first = done))
        : Promise.resolve(onePage([])),
    );
    const { el, liveData } = await watchedList(twoPages(), background);
    liveData.invalidate([{ type: "adjustments" }]);
    await vi.waitFor(() => expect(background).toHaveBeenCalledOnce());
    await pick(el, "to", "2026-09-30");
    first({ entries: [newer("e5")], next: "cx" });
    await settle(el);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(background).toHaveBeenCalledOnce();
    expect(keys(el)).toEqual(["e3", "e2", "e1"]);
    liveData.clear();
  });

  it("adds, once, a page that arrives after live data read the list again", async () => {
    let resolve!: (page: unknown) => void;
    const { el, liveData, refresh } = await watchedList(
      twoPages(() => new Promise((done) => (resolve = done))),
      pagesAfter({ "": { entries: [newer("e5"), ...alexEntries().slice(0, 2)], next: "c2" } }),
    );
    await showMore(el);
    await refreshed(el, liveData, refresh, 1);
    expect(keys(el)).toEqual(["e5", "e3", "e2", "e1"]);
    expect(part(el, "show-more")!.hasAttribute("loading")).toBe(true);
    resolve(onePage([samEntry()]));
    await settle(el);
    expect(keys(el)).toEqual(["e5", "e3", "e2", "e1", "e4"]);
    expect(part(el, "show-more")).toBeNull();
    liveData.clear();
  });

  it("keeps a page added while live data was reading the list again", async () => {
    let answer!: (page: unknown) => void;
    const background = vi.fn(() => new Promise((done) => (answer = done)));
    const { el, liveData } = await watchedList(twoPages(), background);
    liveData.invalidate([{ type: "adjustments" }]);
    await vi.waitFor(() => expect(background).toHaveBeenCalledOnce());
    await showMore(el);
    expect(keys(el)).toEqual(["e3", "e2", "e1", "e4"]);
    answer({ entries: [newer("e5"), ...alexEntries().slice(0, 2)], next: "c2" });
    await settle(el);
    expect(keys(el)).toEqual(["e5", "e3", "e2", "e1", "e4"]);
    expect(part(el, "show-more")).toBeNull();
    liveData.clear();
  });

  it("leaves rows it read past the last one shown to Show more, which adds them once", async () => {
    let resolve!: (page: unknown) => void;
    const { el, liveData, refresh } = await watchedList(
      twoPages(() => new Promise((done) => (resolve = done))),
      pagesAfter({ "": { entries: [...alexEntries(), samEntry()], next: "c9" } }),
    );
    await showMore(el);
    await refreshed(el, liveData, refresh, 1);
    expect(keys(el)).toEqual(["e3", "e2", "e1"]);
    resolve(onePage([samEntry()]));
    await settle(el);
    expect(keys(el)).toEqual(["e3", "e2", "e1", "e4"]);
    expect(part(el, "show-more")).toBeNull();
    liveData.clear();
  });

  it("shows a row read below the whole list, and goes on where the read says", async () => {
    const { el, liveData, api, refresh } = await watchedList(
      pagesAfter({ "": { entries: alexEntries(), next: null } }),
      pagesAfter({ "": { entries: [...alexEntries(), samEntry()], next: "c9" } }),
    );
    expect(part(el, "show-more")).toBeNull();
    await refreshed(el, liveData, refresh, 1);
    expect(keys(el)).toEqual(["e3", "e2", "e1", "e4"]);
    part(el, "show-more")!.click();
    expect(api.listEntries).toHaveBeenLastCalledWith(...EVERYONE, { after: "c9" });
    liveData.clear();
  });

  it("offers no more once a further page comes back empty and the last", async () => {
    const el = await mount(
      fakeApi({ listEntries: twoPages(() => Promise.resolve({ entries: [], next: null })) }),
    );
    await showAll(el);
    await showMore(el);
    expect(keys(el)).toEqual(["e3", "e2", "e1"]);
    expect(part(el, "show-more")).toBeNull();
  });

  it("keeps focus on Show more when live data reads the list again", async () => {
    const { el, liveData, refresh } = await watchedList(
      twoPages(),
      pagesAfter({ "": { entries: [newer("e5"), ...alexEntries().slice(0, 2)], next: "c2" } }),
    );
    part(el, "show-more")!.focus();
    await refreshed(el, liveData, refresh, 1);
    expect(keys(el)).toEqual(["e5", "e3", "e2", "e1"]);
    expect(el.shadowRoot!.activeElement).toBe(part(el, "show-more"));
    liveData.clear();
  });

  it("drops a page, or its refusal, that arrives after another list was opened", async () => {
    let refuse!: (error: unknown) => void;
    const listEntries = vi.fn((_f: string, _t: string, of: unknown, page?: { after?: string }) =>
      of === "everyone" && page?.after === "c1"
        ? new Promise((_done, fail) => (refuse = fail))
        : Promise.resolve(
            of === "everyone" ? { entries: alexEntries(), next: "c1" } : onePage([samEntry()]),
          ),
    );
    const el = await mount(fakeApi({ listEntries }));
    await showAll(el);
    await showMore(el);
    await open(el, SAM);
    refuse({ code: "x" });
    await settle(el);
    expect(keys(el)).toEqual(["e4"]);
    expect(part(el, "more-error")).toBeNull();
    expect(part(el, "show-more")).toBeNull();
  });

  it("drops a page that arrives after a new range started the list again", async () => {
    let resolve!: (page: unknown) => void;
    const el = await mount(
      fakeApi({ listEntries: twoPages(() => new Promise((done) => (resolve = done))) }),
    );
    await showAll(el);
    await showMore(el);
    await pick(el, "to", "2026-09-30");
    resolve(onePage([samEntry()]));
    await settle(el);
    expect(keys(el)).toEqual(["e3", "e2", "e1"]);
    expect(part(el, "show-more")!.hasAttribute("loading")).toBe(false);
  });

  it("asks for the next page again over a new range, from its first page", async () => {
    const api = fakeApi({ listEntries: twoPages() });
    const el = await mount(api);
    await showAll(el);
    await showMore(el);
    await pick(el, "to", "2026-09-30");
    expect(api.listEntries).toHaveBeenLastCalledWith("2026-09-29", "2026-09-30", "everyone");
    expect(keys(el)).toEqual(["e3", "e2", "e1"]);
    await showMore(el);
    expect(api.listEntries).toHaveBeenLastCalledWith("2026-09-29", "2026-09-30", "everyone", {
      after: "c1",
    });
  });

  it("offers no more once the list is closed", async () => {
    const el = await mount(fakeApi({ listEntries: twoPages() }));
    await showAll(el);
    part(el, "close-entries")!.click();
    await settle(el);
    expect(part(el, "show-more")).toBeNull();
  });

  it("offers more in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount(fakeApi({ listEntries: twoPages(() => Promise.reject({ code: "x" })) }));
    await showAll(el);
    expect(text(part(el, "show-more"))).toBe("Mostrar más");
    await showMore(el);
    expect(text(part(el, "more-error"))).toMatch(/^No se pudieron cargar más ajustes: /);
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
      fakeApi({ listEntries: vi.fn().mockResolvedValue(onePage([...alexEntries(), samEntry()])) }),
    );
    part(el, "show-all")!.click();
    await settle(el);
    const orders: [string, string[]][] = [
      ["time", ["e1", "e2", "e3", "e4"]],
      ["action", ["e4", "e3", "e2", "e1"]],
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
      fakeApi({ listEntries: vi.fn().mockResolvedValue(onePage([...alexEntries(), samEntry()])) }),
    );
    part(el, "show-all")!.click();
    await settle(el);
    const table = part(el, "entries")!;
    expect(row(table, "e1")["Credited to"]).toBe("Alex");
    expect(row(table, "e4")["Credited to"]).toBe("—");
  });
});

describe("live data", () => {
  async function watched(): Promise<{ liveData: LiveData; background: Fake }> {
    const liveData = new LiveData();
    const background = fakeApi();
    const api = fakeApi({ liveData });
    api.background = background;
    const el = await mount(api);
    await open(el, ALEX);
    return { liveData, background };
  }

  it.each(["adjustments", "working_orders", "working_order_lines", "persons", "locations"])(
    "reads the report again, passively, when %s changes",
    async (type) => {
      const { liveData, background } = await watched();
      liveData.invalidate([{ type }]);
      await vi.waitFor(() => expect(background.getReport).toHaveBeenCalledOnce());
      liveData.clear();
    },
  );

  it.each(["adjustments", "working_orders", "persons", "locations"])(
    "reads the open list again, passively, when %s changes",
    async (type) => {
      const { liveData, background } = await watched();
      liveData.invalidate([{ type }]);
      await vi.waitFor(() => expect(background.listEntries).toHaveBeenCalledOnce());
      liveData.clear();
    },
  );

  it("does not read the open list again when only a credited line changes", async () => {
    const { liveData, background } = await watched();
    liveData.invalidate([{ type: "working_order_lines" }]);
    await vi.waitFor(() => expect(background.getReport).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(background.listEntries).not.toHaveBeenCalled();
    liveData.clear();
  });

  it("reads nothing again when an adjustment reason changes", async () => {
    const { liveData, background } = await watched();
    liveData.invalidate([{ type: "adjustment_reasons" }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(background.getReport).not.toHaveBeenCalled();
    expect(background.listEntries).not.toHaveBeenCalled();
    liveData.clear();
  });

  it("leaves nothing observed when the screen closes before its first answer", async () => {
    const liveData = new LiveData();
    let first!: (report: ReturnType<typeof fixtureReport>) => void;
    const pending = new Promise((resolve) => (first = resolve));
    const getReport = vi.fn(() => pending);
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    const el = document.createElement(
      "dashboard-adjustment-report-screen",
    ) as AdjustmentReportScreen;
    el.api = fakeApi({ liveData, getReport }) as unknown as AdjustmentsApi;
    host.appendChild(el);
    el.remove();
    first(fixtureReport("2026-09-29"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(liveData.interests).toEqual([]);
    const reads = getReport.mock.calls.length;
    liveData.invalidate([{ type: "adjustments" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getReport).toHaveBeenCalledTimes(reads);
  });

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
      expect(background.getReport).toHaveBeenCalledWith(undefined);
      expect(background.listEntries).toHaveBeenCalledWith("2026-09-29", "2026-09-29", {
        personId: ALEX,
      });
    });
    expect(api.getReport).toHaveBeenCalledTimes(1);
    expect(api.listEntries).toHaveBeenCalledTimes(1);
    liveData.clear();
  });
});
