import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorAnswer, FloorZone, TableState, TableToday, TillApi } from "../api/client.js";
import { mergeLabel } from "@waitron/ui";
import { nextFloorMoment } from "../state/floor-today.js";

const zone: FloorZone = {
  id: "z1",
  name: "Comedor",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
};

function table(
  id: string,
  label: string,
  x: number,
  over: Partial<TableToday> = {},
  busy: Partial<TableState> = {},
): TableState {
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
      zoneRevision: 0,
      ...over,
    },
    signals: [],
    party: null,
    ...busy,
  };
}

const held: Partial<TableState> = { condition: "held" };

const longTable = (parts: string[], splitOff: string[], id = "long", label = "Long table") =>
  table(id, label, 10, {
    seats: 10,
    joined: { parts, splitOff, apart: parts.length < 2 },
  });
const part = (id: string, label: string, joinedLabel = "Long table") =>
  table(id, label, 10, { placement: null, inJoinedTable: joinedLabel });
const splitOff = (
  id: string,
  label: string,
  x: number,
  busy: Partial<TableState> = {},
  from = "long",
) => table(id, label, x, { splitOffFrom: from }, busy);

/** Counter 5 split off and free: Reset table takes it back at once. */
const oneFree = () => [
  longTable(["c3", "c4"], ["c5"]),
  part("c3", "Counter 3"),
  part("c4", "Counter 4"),
  splitOff("c5", "Counter 5", 30),
];

/** Every table split off; Counter 3 has guests, so it stays apart. */
const counter3Busy = () => [
  longTable([], ["c3", "c4", "c5"]),
  splitOff("c3", "Counter 3", 50, held),
  splitOff("c4", "Counter 4", 60),
  splitOff("c5", "Counter 5", 70),
];

/** Counter 3 still joined; `busy` names which of Counter 4 and 5 has guests. */
const oneOfTwoBusy = (busy: "c4" | "c5") => [
  longTable(["c3"], ["c4", "c5"]),
  part("c3", "Counter 3"),
  splitOff("c4", "Counter 4", 60, busy === "c4" ? held : {}),
  splitOff("c5", "Counter 5", 70, busy === "c5" ? held : {}),
];

const allFree = () => [
  longTable([], ["c3", "c4", "c5"]),
  splitOff("c3", "Counter 3", 50),
  splitOff("c4", "Counter 4", 60),
  splitOff("c5", "Counter 5", 70),
];

const withBar = () => [
  ...counter3Busy(),
  longTable([], ["b1", "b2", "b3"], "bar", "Bar table"),
  splitOff("b1", "Bar 1", 80, held, "bar"),
  splitOff("b2", "Bar 2", 90, {}, "bar"),
  splitOff("b3", "Bar 3", 100, {}, "bar"),
];

function stubApi() {
  return {
    resetTableToday: vi.fn<TillApi["resetTableToday"]>(() =>
      Promise.resolve({ zoneId: "z1", revision: 0 }),
    ),
  };
}

type Stub = ReturnType<typeof stubApi>;

interface Answer {
  done(): void;
  refuse(refusal: { code: string; field?: string }): void;
}

/** The first Reset table's answer waits until the test gives it. */
function holdAnswer(api: Stub): Answer {
  const answer = {} as Answer;
  api.resetTableToday.mockImplementationOnce(
    () =>
      new Promise<FloorAnswer>((resolve, reject) => {
        answer.done = () => resolve({ zoneId: "z1", revision: 0 });
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

async function pressResetTable(el: TillFloorScreen, tableId = "long") {
  send(el.shadowRoot!.querySelector("wt-floor-map")!, "wt-table-details", { tableId });
  await el.updateComplete;
  const sheet = el.shadowRoot!.querySelector("till-table-details-sheet")!;
  await sheet.updateComplete;
  sheet.shadowRoot!.querySelector<HTMLElement>('[data-today-action="reset-table"]')!.click();
  await settle(el);
  return windowOf(el);
}

const windowOf = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-reset-table-dialog"]>(
    "till-reset-table-dialog",
  );

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

const apartIds = (el: TillFloorScreen) => windowOf(el)!.apart.map((each) => each.table.id);

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

describe("till-floor-screen: resetting a joined table", () => {
  it("Reset table with every table free sends at once, with the tables it expects back, and re-reads the floor", async () => {
    const api = stubApi();
    const el = await mount(oneFree(), api);
    const refreshes = countRefreshes(el);

    expect(await pressResetTable(el)).toBeNull();

    expect(api.resetTableToday).toHaveBeenCalledExactlyOnceWith("long", { partIds: ["c5"] }, 0);
    expect(refreshes.count).toBe(1);
    expect(floorRefusal(el)).toBeNull();
  });

  it("Reset table on Counter 5 sends for Long table", async () => {
    const api = stubApi();
    const el = await mount(oneFree(), api);

    expect(await pressResetTable(el, "c5")).toBeNull();

    expect(api.resetTableToday).toHaveBeenCalledExactlyOnceWith("long", { partIds: ["c5"] }, 0);
  });

  it("with Counter 5 apart for guests it opens the window naming it and asking seats, and sends Counter 4 back with them", async () => {
    const api = stubApi();
    const el = await mount(oneOfTwoBusy("c5"), api);

    const opened = (await pressResetTable(el))!;
    expect(opened).not.toBeNull();
    expect(api.resetTableToday).not.toHaveBeenCalled();
    expect(opened.joined.id).toBe("long");
    expect(opened.apart).toEqual([
      { table: expect.objectContaining({ id: "c5" }), reason: "guests" },
    ]);
    expect(opened.shadowRoot!.querySelector('wt-number-stepper[name="seats"]')).not.toBeNull();

    send(opened, "reset-table-confirm", { seats: 6 });
    await settle(el);
    expect(api.resetTableToday).toHaveBeenCalledExactlyOnceWith(
      "long",
      { partIds: ["c4"], seats: 6 },
      0,
    );
    expect(windowOf(el)).toBeNull();
  });

  it("on a free Counter 5 whose fellow tables are in a group with guests it sends at once, with no seats, and shows the refusal on the floor", async () => {
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({
      code: "joined_table.tables_in_group",
      status: 409,
      tableId: "long",
      partIds: ["c3", "c4"],
    });
    const inGroup = (id: string, label: string, x: number) =>
      table(id, label, x, { splitOffFrom: "long", joinId: "g" }, held);
    const el = await mount(
      [
        longTable([], ["c3", "c4", "c5"]),
        inGroup("c3", "Counter 3", 50),
        inGroup("c4", "Counter 4", 60),
        splitOff("c5", "Counter 5", 70),
        table("bar", "Bar", 80, { joinId: "g" }, held),
      ],
      api,
    );
    const refreshes = countRefreshes(el);

    expect(await pressResetTable(el, "c5")).toBeNull();

    expect(api.resetTableToday).toHaveBeenCalledExactlyOnceWith("long", { partIds: ["c5"] }, 0);
    expect(floorRefusal(el)).toBe(
      "Counter 3 and Counter 4 are in Bar+Counter 3+Counter 4. Split them off first, then Reset table.",
    );
    expect(refreshes.count).toBe(1);
  });

  it("with a table staying apart it opens the window naming it, and Reset table sends the seats, closes it and re-reads the floor", async () => {
    const api = stubApi();
    const el = await mount(counter3Busy(), api);
    const refreshes = countRefreshes(el);

    const opened = (await pressResetTable(el, "c4"))!;
    expect(opened).not.toBeNull();
    expect(api.resetTableToday).not.toHaveBeenCalled();
    expect(opened.joined.id).toBe("long");
    expect(opened.apart).toEqual([
      { table: expect.objectContaining({ id: "c3" }), reason: "guests" },
    ]);
    expect(opened.busy).toBe(false);
    expect(opened.refusal).toBeNull();
    const commit = vi.spyOn(opened, "commit");

    send(opened, "reset-table-confirm", { seats: 8 });
    await settle(el);

    expect(api.resetTableToday).toHaveBeenCalledExactlyOnceWith(
      "long",
      {
        partIds: ["c4", "c5"],
        seats: 8,
      },
      0,
    );
    expect(commit).toHaveBeenCalledOnce();
    expect(windowOf(el)).toBeNull();
    expect(refreshes.count).toBe(1);
    expect(floorRefusal(el)).toBeNull();
  });

  it("keeps the window open while Reset table is sent", async () => {
    const api = stubApi();
    const answer = holdAnswer(api);
    const el = await mount(counter3Busy(), api);
    const refreshes = countRefreshes(el);

    send((await pressResetTable(el, "c4"))!, "reset-table-confirm", { seats: 6 });
    await settle(el);

    expect(api.resetTableToday).toHaveBeenCalledOnce();
    expect(windowOf(el)).not.toBeNull();
    expect(windowOf(el)!.busy).toBe(true);
    expect(refreshes.count).toBe(0);

    answer.done();
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(refreshes.count).toBe(1);
  });

  it("an out-of-date refusal shows at the window's foot, the window stays open and the floor is re-read; the next press sends the tables the new read offers", async () => {
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({
      code: "joined_table.out_of_date",
      status: 409,
      tableId: "long",
    });
    const el = await mount(oneOfTwoBusy("c4"), api);
    const refreshes = countRefreshes(el);

    const opened = (await pressResetTable(el, "c5"))!;
    expect(apartIds(el)).toEqual(["c4"]);
    send(opened, "reset-table-confirm", { seats: 6 });
    await settle(el);

    expect(api.resetTableToday).toHaveBeenLastCalledWith("long", { partIds: ["c5"], seats: 6 }, 0);
    const open = windowOf(el)!;
    expect(open).toBe(opened);
    expect(open.busy).toBe(false);
    expect(open.refusal).toEqual({ code: "joined_table.out_of_date" });
    await open.updateComplete;
    expect(footError(el)).toBe(codeMessage("joined_table.out_of_date"));
    expect(floorRefusal(el)).toBeNull();
    expect(refreshes.count).toBe(1);

    el.tables = oneOfTwoBusy("c5");
    await settle(el);
    expect(windowOf(el)).toBe(opened);
    expect(apartIds(el)).toEqual(["c5"]);

    send(opened, "reset-table-confirm", { seats: 6 });
    await settle(el);
    expect(api.resetTableToday).toHaveBeenLastCalledWith("long", { partIds: ["c4"], seats: 6 }, 0);
    expect(windowOf(el)).toBeNull();
  });

  it("an out-of-date refusal to the one-tap Reset table shows on the floor", async () => {
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({
      code: "joined_table.out_of_date",
      status: 409,
      tableId: "long",
    });
    const el = await mount(allFree(), api);
    const refreshes = countRefreshes(el);

    expect(await pressResetTable(el, "c3")).toBeNull();
    expect(api.resetTableToday).toHaveBeenCalledExactlyOnceWith(
      "long",
      {
        partIds: ["c3", "c4", "c5"],
      },
      0,
    );
    expect(floorRefusal(el)).toBe(codeMessage("joined_table.out_of_date"));
    expect(refreshes.count).toBe(1);

    el.tables = [
      longTable([], ["c3", "c4", "c5"]),
      splitOff("c3", "Counter 3", 50),
      splitOff("c4", "Counter 4", 60),
      splitOff("c5", "Counter 5", 70, held),
    ];
    await settle(el);
    expect(await pressResetTable(el, "c3")).not.toBeNull();
    expect(apartIds(el)).toEqual(["c5"]);
  });

  it.each([
    ["every table split off becomes free", allFree],
    ["the joined table leaves the read", () => counter3Busy().filter((each) => each.id !== "long")],
  ])("closes the window when %s", async (_, next) => {
    const el = await mount(counter3Busy(), stubApi());
    expect(await pressResetTable(el, "c4")).not.toBeNull();

    el.tables = next();
    await settle(el);
    expect(windowOf(el)).toBeNull();

    el.tables = counter3Busy();
    await settle(el);
    expect(windowOf(el)).toBeNull();
  });

  it("a floor read during the request keeps the window as it was sent; when it no longer applies, a refusal shows on the floor", async () => {
    const api = stubApi();
    const answer = holdAnswer(api);
    const el = await mount(counter3Busy(), api);
    const opened = (await pressResetTable(el, "c4"))!;
    send(opened, "reset-table-confirm", { seats: 6 });
    await settle(el);

    el.tables = allFree();
    await settle(el);
    expect(windowOf(el)).toBe(opened);
    expect(opened.busy).toBe(true);
    expect(apartIds(el)).toEqual(["c3"]);

    answer.refuse({ code: "joined_table.out_of_date" });
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(floorRefusal(el)).toBe(codeMessage("joined_table.out_of_date"));
  });

  it("a floor read during the request that still leaves a table apart keeps the window, and a refusal shows at its foot over the new read", async () => {
    const api = stubApi();
    const answer = holdAnswer(api);
    const el = await mount(oneOfTwoBusy("c4"), api);
    const opened = (await pressResetTable(el, "c5"))!;
    send(opened, "reset-table-confirm", { seats: 6 });
    await settle(el);

    el.tables = oneOfTwoBusy("c5");
    await settle(el);
    expect(windowOf(el)).toBe(opened);
    expect(apartIds(el)).toEqual(["c4"]);

    answer.refuse({ code: "joined_table.out_of_date" });
    await settle(el);
    expect(windowOf(el)).toBe(opened);
    expect(apartIds(el)).toEqual(["c5"]);
    await opened.updateComplete;
    expect(footError(el)).toBe(codeMessage("joined_table.out_of_date"));
    expect(floorRefusal(el)).toBeNull();
  });

  it("a refusal shown in the window moves to the floor when the next floor read closes the window", async () => {
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({ code: "joined_table.out_of_date" });
    const el = await mount(counter3Busy(), api);
    const opened = (await pressResetTable(el, "c4"))!;
    send(opened, "reset-table-confirm", { seats: 6 });
    await settle(el);
    expect(windowOf(el)).toBe(opened);
    expect(opened.refusal).toEqual({ code: "joined_table.out_of_date" });
    expect(floorRefusal(el)).toBeNull();

    el.tables = allFree();
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(floorRefusal(el)).toBe(codeMessage("joined_table.out_of_date"));
  });

  it("a done answer closes a window kept through a floor read that made it obsolete", async () => {
    const api = stubApi();
    const answer = holdAnswer(api);
    const el = await mount(counter3Busy(), api);
    const opened = (await pressResetTable(el, "c4"))!;
    const commit = vi.spyOn(opened, "commit");
    send(opened, "reset-table-confirm", { seats: 6 });
    await settle(el);
    el.tables = allFree();
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
    const el = await mount(counter3Busy(), api);
    send((await pressResetTable(el, "c4"))!, "reset-table-confirm", { seats: 6 });
    await settle(el);
    el.tables = counter3Busy().filter((each) => each.id !== "long");
    await settle(el);
    expect(windowOf(el)).toBeNull();

    answer.refuse({ code: "joined_table.out_of_date" });
    await settle(el);
    expect(floorRefusal(el)).toBe(codeMessage("joined_table.out_of_date"));
  });

  it.each([
    ["refused", (answer: Answer) => answer.refuse({ code: "joined_table.out_of_date" })],
    ["done", (answer: Answer) => answer.done()],
  ])(
    "an answer that arrives %s after its window has gone leaves the window open now as it is",
    async (_, arrive) => {
      const api = stubApi();
      const answer = holdAnswer(api);
      const el = await mount(withBar(), api);

      send((await pressResetTable(el, "c4"))!, "reset-table-confirm", { seats: 6 });
      await settle(el);
      el.tables = withBar().filter((each) => each.id !== "long");
      await settle(el);
      expect(windowOf(el)).toBeNull();

      const bar = (await pressResetTable(el, "b2"))!;
      const stepper = bar.shadowRoot!.querySelector("wt-number-stepper")!;
      send(stepper, "wt-change", { value: "5" });
      await settle(el);
      await bar.updateComplete;

      arrive(answer);
      await settle(el);
      await bar.updateComplete;

      expect(windowOf(el)).toBe(bar);
      expect(bar.joined.id).toBe("bar");
      expect(bar.busy).toBe(false);
      expect(bar.refusal).toBeNull();
      expect(stepper.value).toBe("5");
      expect(floorRefusal(el)).toBeNull();
    },
  );

  it("Cancel closes the window and sends nothing", async () => {
    const api = stubApi();
    const el = await mount(counter3Busy(), api);
    send((await pressResetTable(el, "c4"))!, "reset-table-cancel");
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(api.resetTableToday).not.toHaveBeenCalled();
  });
});

/** Counter 3 and Counter 4 split off from Long table and in a group with Bar's guests; Counter 5 free. */
const inBarGroup = () => {
  const inGroup = (id: string, label: string, x: number) =>
    table(id, label, x, { splitOffFrom: "long", joinId: "g" }, held);
  return [
    longTable([], ["c3", "c4", "c5"]),
    inGroup("c3", "Counter 3", 50),
    inGroup("c4", "Counter 4", 60),
    splitOff("c5", "Counter 5", 70),
    table("bar", "Bar", 80, { joinId: "g" }, held),
  ];
};

/** Counter 5 split off and free, with Terrace 9 standing where Long table was saved. */
const standingInPlace = () => [...oneFree(), table("t9", "Terrace 9", 10)];

describe("till-floor-screen: Reset table's refusals name the tables", () => {
  it.each([
    [
      "en",
      ["c3", "c4"],
      "Counter 3 and Counter 4 are in Bar+Counter 3+Counter 4. Split them off first, then Reset table.",
    ],
    [
      "es",
      ["c3", "c4"],
      "Counter 3 y Counter 4 están en Bar+Counter 3+Counter 4. Sepáralas primero y luego restablece.",
    ],
    [
      "en",
      ["c4"],
      "Counter 4 is in Bar+Counter 3+Counter 4. Split it off first, then Reset table.",
    ],
    [
      "es",
      ["c4"],
      "Counter 4 está en Bar+Counter 3+Counter 4. Sepárala primero y luego restablece.",
    ],
  ])(
    "in %s, tables in a group with guests are named with the group",
    async (locale, partIds, words) => {
      setLocale(locale);
      const api = stubApi();
      api.resetTableToday.mockRejectedValueOnce({
        code: "joined_table.tables_in_group",
        status: 409,
        tableId: "long",
        partIds,
      });
      const el = await mount(inBarGroup(), api);

      await pressResetTable(el, "c5");
      expect(floorRefusal(el)).toBe(words);
    },
  );

  it.each([
    ["en", "Terrace 9 is standing in Long table's place. Move Terrace 9, then Reset table again."],
    ["es", "Terrace 9 ocupa el sitio de Long table. Muévela y vuelve a restablecer."],
  ])("in %s, a table standing in the joined table's place is named", async (locale, words) => {
    setLocale(locale);
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({
      code: "table.place_taken",
      status: 409,
      tableId: "long",
      standingId: "t9",
    });
    const el = await mount(standingInPlace(), api);

    await pressResetTable(el);
    expect(floorRefusal(el)).toBe(words);
  });

  it("names neither the tables nor a group when the tables in the refusal are in different groups", async () => {
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({
      code: "joined_table.tables_in_group",
      status: 409,
      tableId: "long",
      partIds: ["c3", "c4"],
    });
    const tables = inBarGroup().map((each) =>
      each.id === "c4" ? { ...each, today: { ...each.today!, joinId: "h" } } : each,
    );
    tables.push(table("patio", "Patio", 90, { joinId: "h" }, held));
    const el = await mount(tables, api);

    await pressResetTable(el, "c5");
    expect(floorRefusal(el)).toBe(codeMessage("joined_table.tables_in_group"));
  });

  it("names neither the tables nor a group when the tables in the refusal are in different groups drawn with the same name", async () => {
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({
      code: "joined_table.tables_in_group",
      status: 409,
      tableId: "long",
      partIds: ["c3", "c4"],
    });
    const tables = [
      longTable([], ["c3", "c4", "c5"]),
      table("c3", "A", 50, { splitOffFrom: "long", joinId: "g" }, held),
      table("c4", "A+B", 60, { splitOffFrom: "long", joinId: "h" }, held),
      splitOff("c5", "Counter 5", 70),
      table("bar", "B+C", 80, { joinId: "g" }, held),
      table("patio", "C", 90, { joinId: "h" }, held),
    ];
    expect(mergeLabel(["A", "B+C"])).toBe(mergeLabel(["A+B", "C"]));
    const el = await mount(tables, api);

    await pressResetTable(el, "c5");
    expect(floorRefusal(el)).toBe(codeMessage("joined_table.tables_in_group"));
  });

  it.each([
    ["en", "That table was split off. Reset Long table first."],
    ["es", "Esa mesa está separada. Restablece Long table primero."],
  ])(
    "in %s, Back to saved place on a table another till has split off names the table it was split off from",
    async (locale, words) => {
      setLocale(locale);
      const api = { ...stubApi(), backToSavedToday: vi.fn<TillApi["backToSavedToday"]>() };
      let refuse!: (refusal: unknown) => void;
      api.backToSavedToday.mockImplementationOnce(
        () => new Promise<FloorAnswer>((_, reject) => (refuse = reject)),
      );
      const el = await mount([longTable(["c3", "c4"], []), table("c5", "Counter 5", 30)], api);

      send(el.shadowRoot!.querySelector("wt-floor-map")!, "wt-table-details", { tableId: "c5" });
      await el.updateComplete;
      const sheet = el.shadowRoot!.querySelector("till-table-details-sheet")!;
      await sheet.updateComplete;
      sheet.shadowRoot!.querySelector<HTMLElement>('[data-today-action="back"]')!.click();
      await settle(el);
      expect(api.backToSavedToday).toHaveBeenCalledExactlyOnceWith("c5", 0);

      el.tables = oneFree();
      await settle(el);
      refuse({ code: "table.split_off", status: 409, tableId: "c5" });
      await settle(el);
      expect(floorRefusal(el)).toBe(words);
    },
  );

  it("a named refusal shows at the window's foot, and moves to the floor when the window closes", async () => {
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({
      code: "table.place_taken",
      status: 409,
      tableId: "long",
      standingId: "t9",
    });
    const el = await mount([...counter3Busy(), table("t9", "Terrace 9", 10)], api);
    const opened = (await pressResetTable(el, "c4"))!;
    send(opened, "reset-table-confirm", { seats: 6 });
    await settle(el);
    await opened.updateComplete;

    const words =
      "Terrace 9 is standing in Long table's place. Move Terrace 9, then Reset table again.";
    expect(windowOf(el)).toBe(opened);
    expect(footError(el)).toBe(words);
    expect(floorRefusal(el)).toBeNull();

    el.tables = [...allFree(), table("t9", "Terrace 9", 10)];
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(floorRefusal(el)).toBe(words);
  });

  it.each([
    [
      "a table standing in its place",
      { code: "table.place_taken", tableId: "long", standingId: "gone" },
      oneFree,
    ],
    [
      "the joined table",
      { code: "table.place_taken", tableId: "gone", standingId: "t9" },
      standingInPlace,
    ],
    [
      "a table in the group",
      { code: "joined_table.tables_in_group", tableId: "long", partIds: ["c4", "gone"] },
      inBarGroup,
    ],
    [
      "the group a table is in",
      { code: "joined_table.tables_in_group", tableId: "long", partIds: ["c5"] },
      inBarGroup,
    ],
    ["the split-off table", { code: "table.split_off", tableId: "gone" }, oneFree],
    [
      "what a table was split off from",
      { code: "table.split_off", tableId: "c9" },
      () => [...oneFree(), splitOff("c9", "Counter 9", 90, {}, "gone")],
    ],
  ])(
    "falls back to the plain sentence when the read no longer has %s",
    async (_, refused, tables) => {
      const api = stubApi();
      api.resetTableToday.mockRejectedValueOnce({ status: 409, ...refused });
      const el = await mount(tables(), api);

      await pressResetTable(el, tables === inBarGroup ? "c5" : "long");
      expect(floorRefusal(el)).toBe(codeMessage(refused.code));
    },
  );
});

/** `tables` as a floor read at the room's revision `revision`. */
const atRevision = (tables: TableState[], revision: number): TableState[] =>
  tables.map((each) => ({ ...each, today: { ...each.today!, zoneRevision: revision } }));

describe("till-floor-screen: Reset table and the room's revision", () => {
  it("Reset table with every table free sends the read's revision", async () => {
    const api = stubApi();
    const el = await mount(atRevision(oneFree(), 7), api);
    await pressResetTable(el);
    expect(api.resetTableToday).toHaveBeenCalledExactlyOnceWith("long", { partIds: ["c5"] }, 7);
  });

  it("Reset table's window sends the revision of the read current at the press, not at its opening", async () => {
    const api = stubApi();
    const el = await mount(atRevision(counter3Busy(), 7), api);
    const opened = (await pressResetTable(el, "c4"))!;

    el.tablesReadAt = nextFloorMoment();
    el.tables = atRevision(counter3Busy(), 8);
    await el.updateComplete;
    send(opened, "reset-table-confirm", { seats: 8 });
    await settle(el);

    expect(api.resetTableToday).toHaveBeenCalledExactlyOnceWith(
      "long",
      { partIds: ["c4", "c5"], seats: 8 },
      8,
    );
  });
});

describe("till-floor-screen: Reset table names tables by today's names", () => {
  const renamed = (tables: TableState[], names: Record<string, Partial<TableToday>>) =>
    tables.map((each) =>
      names[each.id] === undefined
        ? each
        : { ...each, today: { ...each.today!, ...names[each.id] } },
    );

  it("heads the window with the joined table's name for today and names a table staying apart by its own", async () => {
    const el = await mount(
      renamed(counter3Busy(), { long: { name: "Window table" }, c3: { name: "Corner" } }),
      stubApi(),
    );
    const opened = (await pressResetTable(el, "c4"))!;
    await opened.updateComplete;
    expect(opened.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Reset Window table");
    expect(
      opened.shadowRoot!.querySelector("[data-stays-apart]")!.textContent!.replace(/\s+/g, " "),
    ).toContain("Corner stays apart");
  });

  it("names the table standing in a renamed joined table's place by their names for today", async () => {
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({
      code: "table.place_taken",
      status: 409,
      tableId: "long",
      standingId: "t9",
    });
    const el = await mount(
      renamed(standingInPlace(), { long: { name: "Window table" }, t9: { name: "Patio" } }),
      api,
    );
    await pressResetTable(el);
    expect(floorRefusal(el)).toBe(
      "Patio is standing in Window table's place. Move Patio, then Reset table again.",
    );
  });

  it("names a renamed table in a renamed group by its own name and the group's", async () => {
    const api = stubApi();
    api.resetTableToday.mockRejectedValueOnce({
      code: "joined_table.tables_in_group",
      status: 409,
      tableId: "long",
      partIds: ["c4"],
    });
    const group = { joinName: "García birthday" };
    const el = await mount(
      renamed(inBarGroup(), {
        c3: group,
        c4: { ...group, name: "Window" },
        bar: group,
      }),
      api,
    );
    await pressResetTable(el, "c5");
    expect(floorRefusal(el)).toBe(
      "Window is in García birthday. Split it off first, then Reset table.",
    );
  });

  it("names the renamed joined table a table was split off from", async () => {
    const api = { ...stubApi(), backToSavedToday: vi.fn<TillApi["backToSavedToday"]>() };
    let refuse!: (refusal: unknown) => void;
    api.backToSavedToday.mockImplementationOnce(
      () => new Promise<FloorAnswer>((_, reject) => (refuse = reject)),
    );
    const name = { long: { name: "Window table" } };
    const el = await mount(
      renamed([longTable(["c3", "c4"], []), table("c5", "Counter 5", 30)], name),
      api,
    );
    send(el.shadowRoot!.querySelector("wt-floor-map")!, "wt-table-details", { tableId: "c5" });
    await el.updateComplete;
    const sheet = el.shadowRoot!.querySelector("till-table-details-sheet")!;
    await sheet.updateComplete;
    sheet.shadowRoot!.querySelector<HTMLElement>('[data-today-action="back"]')!.click();
    await settle(el);
    el.tables = renamed(oneFree(), name);
    await settle(el);
    refuse({ code: "table.split_off", status: 409, tableId: "c5" });
    await settle(el);
    expect(floorRefusal(el)).toBe("That table was split off. Reset Window table first.");
  });
});
