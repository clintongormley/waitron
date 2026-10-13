import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableState, TableToday, TillApi } from "../api/client.js";

const zone: FloorZone = {
  id: "z1",
  name: "Comedor",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
};

function table(id: string, label: string, x: number, over: Partial<TableToday> = {}): TableState {
  return {
    id,
    label,
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    today: {
      placement: { x, y: 20, width: 2, height: 2, shape: "rect", rotation: 0 },
      seats: 4,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      ...over,
    },
    signals: [],
    party: null,
  };
}

const longTable = (parts = ["c3", "c4", "c5"], splitOff: string[] = []) =>
  table("long", "Long table", 10, { seats: 10, joined: { parts, splitOff, apart: false } });
const part = (id: string, label: string) =>
  table(id, label, 10, { placement: null, inJoinedTable: "Long table" });
const floor = () => [
  longTable(),
  part("c3", "Counter 3"),
  part("c4", "Counter 4"),
  part("c5", "Counter 5"),
];

/** Another till has split every table off Long table. */
const splitDownToNone = () => [
  longTable([], ["c3", "c4", "c5"]),
  table("c3", "Counter 3", 10, { splitOffFrom: "long" }),
  table("c4", "Counter 4", 20, { splitOffFrom: "long" }),
  table("c5", "Counter 5", 30, { splitOffFrom: "long" }),
];

/** Another till has split Counter 5 off Long table. */
const c5SplitOff = () => [
  longTable(["c3", "c4"], ["c5"]),
  part("c3", "Counter 3"),
  part("c4", "Counter 4"),
  table("c5", "Counter 5", 30, { splitOffFrom: "long" }),
];

const barTable = () =>
  table("bar", "Bar table", 40, {
    seats: 6,
    joined: { parts: ["b1", "b2"], splitOff: [], apart: false },
  });
const barPart = (id: string, label: string) =>
  table(id, label, 40, { placement: null, inJoinedTable: "Bar table" });
const twoJoined = () => [...floor(), barTable(), barPart("b1", "Bar 1"), barPart("b2", "Bar 2")];

function stubApi() {
  return { splitOffToday: vi.fn<TillApi["splitOffToday"]>(() => Promise.resolve()) };
}

type Stub = ReturnType<typeof stubApi>;

interface Answer {
  done(): void;
  refuse(refusal: { code: string; field?: string }): void;
}

/** The first split's answer waits until the test gives it. */
function holdAnswer(api: Stub): Answer {
  const answer = {} as Answer;
  api.splitOffToday.mockImplementationOnce(
    () =>
      new Promise<void>((resolve, reject) => {
        answer.done = resolve;
        answer.refuse = reject;
      }),
  );
  return answer;
}

async function mount(tables: TableState[], api: Stub) {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone],
    tables,
    api: api as unknown as TillApi,
    canChangeToday: true,
  });
  return el;
}

function send(target: Element, type: string, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

async function settle(el: TillFloorScreen): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  await el.updateComplete;
}

async function openSplit(el: TillFloorScreen, tableId = "long") {
  send(el.shadowRoot!.querySelector("wt-floor-map")!, "wt-table-details", { tableId });
  await el.updateComplete;
  const sheet = el.shadowRoot!.querySelector("till-table-details-sheet")!;
  await sheet.updateComplete;
  sheet.shadowRoot!.querySelector<HTMLElement>('[data-today-action="split-off"]')!.click();
  await settle(el);
  return windowOf(el)!;
}

const windowOf = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-split-joined-dialog"]>(
    "till-split-joined-dialog",
  );

const pickError = (el: TillFloorScreen) =>
  windowOf(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!
    .error;

const footError = (el: TillFloorScreen) =>
  windowOf(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
    "wt-form-actions",
  )!.error;

function countRefreshes(el: TillFloorScreen): { count: number } {
  const seen = { count: 0 };
  el.addEventListener("floor-refresh", () => seen.count++);
  return seen;
}

const floorRefusal = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector("[data-floor-refusal]")?.textContent?.trim() ?? null;

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

describe("till-floor-screen: splitting tables off a joined table", () => {
  it("Split tables… opens the window, and Split sends the parts and seats, closes it and re-reads the floor", async () => {
    const api = stubApi();
    const el = await mount(floor(), api);
    const refreshes = countRefreshes(el);

    const opened = await openSplit(el);
    expect(opened.joined.id).toBe("long");
    expect(opened.parts.map((each) => each.id)).toEqual(["c3", "c4", "c5"]);
    expect(opened.busy).toBe(false);
    expect(opened.refusal).toBeNull();
    const commit = vi.spyOn(opened, "commit");

    send(opened, "split-joined-confirm", { partIds: ["c5"], seats: 8 });
    await settle(el);

    expect(api.splitOffToday).toHaveBeenCalledExactlyOnceWith("long", {
      partIds: ["c5"],
      seats: 8,
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(windowOf(el)).toBeNull();
    expect(refreshes.count).toBe(1);
    expect(floorRefusal(el)).toBeNull();
  });

  it("keeps the window open while the split is sent", async () => {
    const api = stubApi();
    let answer!: () => void;
    api.splitOffToday.mockImplementation(() => new Promise<void>((resolve) => (answer = resolve)));
    const el = await mount(floor(), api);
    const refreshes = countRefreshes(el);

    send(await openSplit(el), "split-joined-confirm", { partIds: ["c4", "c5"], seats: null });
    await settle(el);

    expect(api.splitOffToday).toHaveBeenCalledExactlyOnceWith("long", { partIds: ["c4", "c5"] });
    expect(windowOf(el)).not.toBeNull();
    expect(windowOf(el)!.busy).toBe(true);
    expect(refreshes.count).toBe(0);

    answer();
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(refreshes.count).toBe(1);
  });

  it("a part_invalid refusal shows under Tables to split off, the window stays open, and the floor is re-read", async () => {
    const api = stubApi();
    api.splitOffToday.mockRejectedValue({
      code: "joined_table.part_invalid",
      status: 400,
      tableId: "c5",
      field: "partIds",
    });
    const el = await mount(floor(), api);
    const refreshes = countRefreshes(el);

    const opened = await openSplit(el);
    send(opened, "split-joined-confirm", { partIds: ["c5"], seats: 6 });
    await settle(el);

    const open = windowOf(el)!;
    expect(open).toBe(opened);
    expect(open.busy).toBe(false);
    expect(open.refusal).toEqual({ code: "joined_table.part_invalid", field: "partIds" });
    await open.updateComplete;
    expect(pickError(el)).toBe(codeMessage("joined_table.part_invalid"));
    expect(footError(el)).toBe("Correct the highlighted fields to continue.");
    expect(floorRefusal(el)).toBeNull();
    expect(refreshes.count).toBe(1);

    el.tables = [
      longTable(["c3", "c4"], ["c5"]),
      part("c3", "Counter 3"),
      part("c4", "Counter 4"),
      table("c5", "Counter 5", 30, { splitOffFrom: "long" }),
    ];
    await settle(el);
    expect(windowOf(el)!.parts.map((each) => each.id)).toEqual(["c3", "c4"]);
  });

  it("a refusal naming no field shows at the window's foot", async () => {
    const api = stubApi();
    api.splitOffToday.mockRejectedValue({
      code: "table.in_joined_table",
      status: 409,
      tableId: "long",
    });
    const el = await mount(floor(), api);

    send(await openSplit(el), "split-joined-confirm", { partIds: ["c5"], seats: 6 });
    await settle(el);

    const open = windowOf(el)!;
    expect(open.refusal).toEqual({ code: "table.in_joined_table" });
    await open.updateComplete;
    expect(footError(el)).toBe(codeMessage("table.in_joined_table"));
    expect(pickError(el)).toBe("");
    expect(floorRefusal(el)).toBeNull();
  });

  it("closes the window when its joined table leaves the floor read, and does not open it again when it comes back", async () => {
    const el = await mount(floor(), stubApi());
    await openSplit(el);

    el.tables = floor().filter((each) => each.id !== "long");
    await settle(el);
    expect(windowOf(el)).toBeNull();

    el.tables = floor();
    await settle(el);
    expect(windowOf(el)).toBeNull();
  });

  it("closes the window when another till splits its joined table down to one part", async () => {
    const el = await mount(floor(), stubApi());
    await openSplit(el);

    el.tables = [
      table("long", "Long table", 10, {
        seats: 10,
        joined: { parts: [], splitOff: ["c3", "c4", "c5"], apart: true },
      }),
      table("c3", "Counter 3", 10, { splitOffFrom: "long" }),
      table("c4", "Counter 4", 20, { splitOffFrom: "long" }),
      table("c5", "Counter 5", 30, { splitOffFrom: "long" }),
    ];
    await settle(el);
    expect(windowOf(el)).toBeNull();
  });

  it("a floor read during the split keeps the window as it was sent; when it no longer applies, a refusal shows on the floor", async () => {
    const api = stubApi();
    const answer = holdAnswer(api);
    const el = await mount(floor(), api);
    const opened = await openSplit(el);
    send(opened, "split-joined-confirm", { partIds: ["c5"], seats: 6 });
    await settle(el);

    el.tables = splitDownToNone();
    await settle(el);
    expect(windowOf(el)).toBe(opened);
    expect(opened.busy).toBe(true);
    expect(opened.parts.map((each) => each.id)).toEqual(["c3", "c4", "c5"]);

    answer.refuse({ code: "joined_table.part_invalid", field: "partIds" });
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(floorRefusal(el)).toBe(codeMessage("joined_table.part_invalid"));
  });

  it("a floor read during the split that still offers Split tables… keeps the window, and a refusal shows in it over the new read", async () => {
    const api = stubApi();
    const answer = holdAnswer(api);
    const el = await mount(floor(), api);
    const opened = await openSplit(el);
    send(opened, "split-joined-confirm", { partIds: ["c5"], seats: 6 });
    await settle(el);

    el.tables = c5SplitOff();
    await settle(el);
    expect(windowOf(el)).toBe(opened);
    expect(opened.parts.map((each) => each.id)).toEqual(["c3", "c4", "c5"]);

    answer.refuse({ code: "table.in_joined_table" });
    await settle(el);
    expect(windowOf(el)).toBe(opened);
    expect(opened.parts.map((each) => each.id)).toEqual(["c3", "c4"]);
    await opened.updateComplete;
    expect(footError(el)).toBe(codeMessage("table.in_joined_table"));
    expect(floorRefusal(el)).toBeNull();
  });

  it("a done answer closes a window kept through a floor read that made it obsolete", async () => {
    const api = stubApi();
    const answer = holdAnswer(api);
    const el = await mount(floor(), api);
    const opened = await openSplit(el);
    const commit = vi.spyOn(opened, "commit");
    send(opened, "split-joined-confirm", { partIds: ["c5"], seats: 6 });
    await settle(el);
    el.tables = splitDownToNone();
    await settle(el);

    answer.done();
    await settle(el);
    expect(commit).toHaveBeenCalledOnce();
    expect(windowOf(el)).toBeNull();
    expect(floorRefusal(el)).toBeNull();
  });

  it("a refusal whose window closed because its joined table left the floor read shows on the floor", async () => {
    const api = stubApi();
    const answer = holdAnswer(api);
    const el = await mount(floor(), api);
    send(await openSplit(el), "split-joined-confirm", { partIds: ["c5"], seats: 6 });
    await settle(el);
    el.tables = floor().filter((each) => each.id !== "long");
    await settle(el);
    expect(windowOf(el)).toBeNull();

    answer.refuse({ code: "table.in_joined_table" });
    await settle(el);
    expect(floorRefusal(el)).toBe(codeMessage("table.in_joined_table"));
  });

  it.each([
    [
      "refused",
      (answer: Answer) => answer.refuse({ code: "joined_table.part_invalid", field: "partIds" }),
    ],
    ["done", (answer: Answer) => answer.done()],
  ])(
    "an answer that arrives %s after its window has gone leaves the window open now as it is",
    async (_, arrive) => {
      const api = stubApi();
      const answer = holdAnswer(api);
      const el = await mount(twoJoined(), api);

      send(await openSplit(el), "split-joined-confirm", { partIds: ["c5"], seats: 6 });
      await settle(el);
      el.tables = twoJoined().filter((each) => each.id !== "long");
      await settle(el);
      expect(windowOf(el)).toBeNull();

      const bar = await openSplit(el, "bar");
      const pick = bar.shadowRoot!.querySelector("wt-combobox")!;
      send(pick, "wt-change", { values: ["b1"] });
      await settle(el);
      await bar.updateComplete;

      arrive(answer);
      await settle(el);
      await bar.updateComplete;

      expect(windowOf(el)).toBe(bar);
      expect(bar.joined.id).toBe("bar");
      expect(bar.busy).toBe(false);
      expect(bar.refusal).toBeNull();
      expect(pick.values).toEqual(["b1"]);
      expect(floorRefusal(el)).toBeNull();
    },
  );

  it("Cancel closes the window and sends nothing", async () => {
    const api = stubApi();
    const el = await mount(floor(), api);
    send(await openSplit(el), "split-joined-cancel");
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(api.splitOffToday).not.toHaveBeenCalled();
  });
});
