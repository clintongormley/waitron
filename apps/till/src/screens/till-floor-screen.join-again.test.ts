import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorAnswer, FloorZone, TableState, TableToday, TillApi } from "../api/client.js";

const zone: FloorZone = {
  id: "z1",
  name: "Comedor",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
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

/** Counter 5 split off and free: Join again takes it back at once. */
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
    joinAgainToday: vi.fn<TillApi["joinAgainToday"]>(() =>
      Promise.resolve({ zoneId: "z1", revision: 0 }),
    ),
  };
}

type Stub = ReturnType<typeof stubApi>;

interface Answer {
  done(): void;
  refuse(refusal: { code: string; field?: string }): void;
}

/** The first Join again's answer waits until the test gives it. */
function holdAnswer(api: Stub): Answer {
  const answer = {} as Answer;
  api.joinAgainToday.mockImplementationOnce(
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

async function pressJoinAgain(el: TillFloorScreen, tableId = "long") {
  send(el.shadowRoot!.querySelector("wt-floor-map")!, "wt-table-details", { tableId });
  await el.updateComplete;
  const sheet = el.shadowRoot!.querySelector("till-table-details-sheet")!;
  await sheet.updateComplete;
  sheet.shadowRoot!.querySelector<HTMLElement>('[data-today-action="join-again"]')!.click();
  await settle(el);
  return windowOf(el);
}

const windowOf = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-join-again-dialog"]>(
    "till-join-again-dialog",
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

describe("till-floor-screen: joining a joined table again", () => {
  it("Join again with every table free sends at once, with the tables it expects back, and re-reads the floor", async () => {
    const api = stubApi();
    const el = await mount(oneFree(), api);
    const refreshes = countRefreshes(el);

    expect(await pressJoinAgain(el)).toBeNull();

    expect(api.joinAgainToday).toHaveBeenCalledExactlyOnceWith("long", { partIds: ["c5"] }, 0);
    expect(refreshes.count).toBe(1);
    expect(floorRefusal(el)).toBeNull();
  });

  it("Join again on Counter 5 sends for Long table", async () => {
    const api = stubApi();
    const el = await mount(oneFree(), api);

    expect(await pressJoinAgain(el, "c5")).toBeNull();

    expect(api.joinAgainToday).toHaveBeenCalledExactlyOnceWith("long", { partIds: ["c5"] }, 0);
  });

  it("with a table staying apart it opens the window naming it, and Join again sends the seats, closes it and re-reads the floor", async () => {
    const api = stubApi();
    const el = await mount(counter3Busy(), api);
    const refreshes = countRefreshes(el);

    const opened = (await pressJoinAgain(el, "c4"))!;
    expect(opened).not.toBeNull();
    expect(api.joinAgainToday).not.toHaveBeenCalled();
    expect(opened.joined.id).toBe("long");
    expect(opened.apart).toEqual([
      { table: expect.objectContaining({ id: "c3" }), reason: "guests" },
    ]);
    expect(opened.busy).toBe(false);
    expect(opened.refusal).toBeNull();
    const commit = vi.spyOn(opened, "commit");

    send(opened, "join-again-confirm", { seats: 8 });
    await settle(el);

    expect(api.joinAgainToday).toHaveBeenCalledExactlyOnceWith(
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

  it("keeps the window open while Join again is sent", async () => {
    const api = stubApi();
    const answer = holdAnswer(api);
    const el = await mount(counter3Busy(), api);
    const refreshes = countRefreshes(el);

    send((await pressJoinAgain(el, "c4"))!, "join-again-confirm", { seats: 6 });
    await settle(el);

    expect(api.joinAgainToday).toHaveBeenCalledOnce();
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
    api.joinAgainToday.mockRejectedValueOnce({
      code: "joined_table.out_of_date",
      status: 409,
      tableId: "long",
    });
    const el = await mount(oneOfTwoBusy("c4"), api);
    const refreshes = countRefreshes(el);

    const opened = (await pressJoinAgain(el, "c5"))!;
    expect(apartIds(el)).toEqual(["c4"]);
    send(opened, "join-again-confirm", { seats: 6 });
    await settle(el);

    expect(api.joinAgainToday).toHaveBeenLastCalledWith("long", { partIds: ["c5"], seats: 6 }, 0);
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

    send(opened, "join-again-confirm", { seats: 6 });
    await settle(el);
    expect(api.joinAgainToday).toHaveBeenLastCalledWith("long", { partIds: ["c4"], seats: 6 }, 0);
    expect(windowOf(el)).toBeNull();
  });

  it("an out-of-date refusal to the one-tap Join again shows on the floor", async () => {
    const api = stubApi();
    api.joinAgainToday.mockRejectedValueOnce({
      code: "joined_table.out_of_date",
      status: 409,
      tableId: "long",
    });
    const el = await mount(allFree(), api);
    const refreshes = countRefreshes(el);

    expect(await pressJoinAgain(el, "c3")).toBeNull();
    expect(api.joinAgainToday).toHaveBeenCalledExactlyOnceWith(
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
    expect(await pressJoinAgain(el, "c3")).not.toBeNull();
    expect(apartIds(el)).toEqual(["c5"]);
  });

  it.each([
    ["every table split off becomes free", allFree],
    ["the joined table leaves the read", () => counter3Busy().filter((each) => each.id !== "long")],
  ])("closes the window when %s", async (_, next) => {
    const el = await mount(counter3Busy(), stubApi());
    expect(await pressJoinAgain(el, "c4")).not.toBeNull();

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
    const opened = (await pressJoinAgain(el, "c4"))!;
    send(opened, "join-again-confirm", { seats: 6 });
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
    const opened = (await pressJoinAgain(el, "c5"))!;
    send(opened, "join-again-confirm", { seats: 6 });
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
    api.joinAgainToday.mockRejectedValueOnce({ code: "joined_table.out_of_date" });
    const el = await mount(counter3Busy(), api);
    const opened = (await pressJoinAgain(el, "c4"))!;
    send(opened, "join-again-confirm", { seats: 6 });
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
    const opened = (await pressJoinAgain(el, "c4"))!;
    const commit = vi.spyOn(opened, "commit");
    send(opened, "join-again-confirm", { seats: 6 });
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
    send((await pressJoinAgain(el, "c4"))!, "join-again-confirm", { seats: 6 });
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

      send((await pressJoinAgain(el, "c4"))!, "join-again-confirm", { seats: 6 });
      await settle(el);
      el.tables = withBar().filter((each) => each.id !== "long");
      await settle(el);
      expect(windowOf(el)).toBeNull();

      const bar = (await pressJoinAgain(el, "b2"))!;
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
    send((await pressJoinAgain(el, "c4"))!, "join-again-cancel");
    await settle(el);
    expect(windowOf(el)).toBeNull();
    expect(api.joinAgainToday).not.toHaveBeenCalled();
  });
});

/** `tables` as a floor read at the room's revision `revision`. */
const atRevision = (tables: TableState[], revision: number): TableState[] =>
  tables.map((each) => ({ ...each, today: { ...each.today!, zoneRevision: revision } }));

describe("till-floor-screen: Join again and the room's revision", () => {
  it("Join again with every table free sends the read's revision", async () => {
    const api = stubApi();
    const el = await mount(atRevision(oneFree(), 7), api);
    await pressJoinAgain(el);
    expect(api.joinAgainToday).toHaveBeenCalledExactlyOnceWith("long", { partIds: ["c5"] }, 7);
  });

  it("Join again's window sends the revision of the read current at the press, not at its opening", async () => {
    const api = stubApi();
    const el = await mount(atRevision(counter3Busy(), 7), api);
    const opened = (await pressJoinAgain(el, "c4"))!;

    el.tablesReadAt = performance.now();
    el.tables = atRevision(counter3Busy(), 8);
    await el.updateComplete;
    send(opened, "join-again-confirm", { seats: 8 });
    await settle(el);

    expect(api.joinAgainToday).toHaveBeenCalledExactlyOnceWith(
      "long",
      { partIds: ["c4", "c5"], seats: 8 },
      8,
    );
  });
});
