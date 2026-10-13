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

function stubApi() {
  return { splitOffToday: vi.fn<TillApi["splitOffToday"]>(() => Promise.resolve()) };
}

type Stub = ReturnType<typeof stubApi>;

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

async function openSplit(el: TillFloorScreen) {
  send(el.shadowRoot!.querySelector("wt-floor-map")!, "wt-table-details", { tableId: "long" });
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

  it("Cancel closes the window and sends nothing", async () => {
    const api = stubApi();
    const el = await mount(floor(), api);
    send(await openSplit(el), "split-joined-cancel");
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(api.splitOffToday).not.toHaveBeenCalled();
  });
});
