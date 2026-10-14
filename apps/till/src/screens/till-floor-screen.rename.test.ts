import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
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
      zoneRevision: 7,
      ...over,
    },
    signals: [],
    party: null,
  };
}

const bar = () => [table("bar", "Bar", 40), table("c3", "Counter 3", 10)];

/** Bar, Counter 3, Counter 4 and Counter 5 in one group; `today` adds to each member. */
const group = (today: Record<string, Partial<TableToday>> = {}) =>
  [
    ["bar", "Bar", 2],
    ["c3", "Counter 3", 4],
    ["c4", "Counter 4", 6],
    ["c5", "Counter 5", 8],
  ].map(([id, label, x]) =>
    table(id as string, label as string, x as number, {
      joinId: "g",
      ...today[id as string],
    }),
  );

function stubApi() {
  return {
    nameToday: vi.fn<TillApi["nameToday"]>(() => Promise.resolve({ zoneId: "z1", revision: 8 })),
    rotateToday: vi.fn<TillApi["rotateToday"]>(() =>
      Promise.resolve({ zoneId: "z1", revision: 9 }),
    ),
  };
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

async function press(el: TillFloorScreen, tableId: string, action: string): Promise<void> {
  send(el.shadowRoot!.querySelector("wt-floor-map")!, "wt-table-details", { tableId });
  await el.updateComplete;
  const sheet = el.shadowRoot!.querySelector("till-table-details-sheet")!;
  await sheet.updateComplete;
  sheet.shadowRoot!.querySelector<HTMLElement>(`[data-today-action="${action}"]`)!.click();
  await settle(el);
}

async function pressRename(el: TillFloorScreen, tableId: string) {
  await press(el, tableId, "rename");
  const opened = windowOf(el)!;
  await opened.updateComplete;
  return opened;
}

const windowOf = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-today-name-dialog"]>(
    "till-today-name-dialog",
  );

const fieldOf = (opened: HTMLElementTagNameMap["till-today-name-dialog"]) =>
  opened.shadowRoot!.querySelector("wt-input")!;

const shown = (opened: HTMLElementTagNameMap["till-today-name-dialog"]) => ({
  heading: opened.shadowRoot!.querySelector("wt-dialog")!.heading,
  value: fieldOf(opened).value,
  hint: fieldOf(opened).hint,
});

async function typeName(
  opened: HTMLElementTagNameMap["till-today-name-dialog"],
  name: string,
): Promise<void> {
  const input = fieldOf(opened).shadowRoot!.querySelector("input")!;
  input.value = name;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await opened.updateComplete;
}

function countRefreshes(el: TillFloorScreen): { count: number } {
  const seen = { count: 0 };
  el.addEventListener("floor-refresh", () => seen.count++);
  return seen;
}

const floorRefusal = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector("[data-floor-refusal]")?.textContent?.trim() ?? null;

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

describe("till-floor-screen: Rename", () => {
  it("Rename on Bar opens the window for Bar, sends its name with the room's revision, closes and re-reads", async () => {
    const api = stubApi();
    const el = await mount(bar(), api);
    const refreshes = countRefreshes(el);

    const opened = await pressRename(el, "bar");
    expect(shown(opened)).toEqual({
      heading: "Rename Bar",
      value: "",
      hint: "Leave it empty for Bar",
    });
    const commit = vi.spyOn(opened, "commit");

    send(opened, "today-name-confirm", { name: "Window" });
    await settle(el);

    expect(api.nameToday).toHaveBeenCalledExactlyOnceWith("bar", "Window", 7);
    expect(commit).toHaveBeenCalledOnce();
    expect(windowOf(el)).toBeNull();
    expect(refreshes.count).toBe(1);
    expect(floorRefusal(el)).toBeNull();
  });

  it("starts from a table's own name for today", async () => {
    const el = await mount([table("bar", "Bar", 40, { name: "Window" })], stubApi());
    expect(shown(await pressRename(el, "bar"))).toEqual({
      heading: "Rename Window",
      value: "Window",
      hint: "Leave it empty for Bar",
    });
  });

  it("on a member of an unnamed group heads the window with the group's name and hints it", async () => {
    const api = stubApi();
    const el = await mount(group(), api);

    const opened = await pressRename(el, "c4");
    expect(shown(opened)).toEqual({
      heading: "Rename Bar+Counter 3+Counter 4+Counter 5",
      value: "",
      hint: "Leave it empty for Bar+Counter 3+Counter 4+Counter 5",
    });

    send(opened, "today-name-confirm", { name: "García birthday" });
    await settle(el);
    expect(api.nameToday).toHaveBeenCalledExactlyOnceWith("c4", "García birthday", 7);
  });

  it("hints a group's normal name from its tables' names for today", async () => {
    const el = await mount(
      [
        table("bar", "Bar", 2, { joinId: "g" }),
        table("c4", "Counter 4", 4, { joinId: "g", name: "Window" }),
      ],
      stubApi(),
    );
    expect(shown(await pressRename(el, "bar"))).toEqual({
      heading: "Rename Bar+Window",
      value: "",
      hint: "Leave it empty for Bar+Window",
    });
  });

  it("on a group named García birthday starts from that name and hints the normal group name", async () => {
    const el = await mount(
      group({
        bar: { joinName: "García birthday" },
        c3: { joinName: "García birthday" },
        c4: { joinName: "García birthday", name: "Window" },
        c5: { joinName: "García birthday" },
      }),
      stubApi(),
    );
    expect(shown(await pressRename(el, "c3"))).toEqual({
      heading: "Rename García birthday",
      value: "García birthday",
      hint: "Leave it empty for Bar+Counter 3+Counter 5+Window",
    });
  });

  it("keeps the window open with a name-in-use refusal under the field, and re-reads", async () => {
    const api = stubApi();
    api.nameToday.mockRejectedValueOnce({
      code: "table.label_taken",
      status: 409,
      label: "Window",
      field: "name",
    });
    const el = await mount(bar(), api);
    const refreshes = countRefreshes(el);
    const opened = await pressRename(el, "bar");
    const commit = vi.spyOn(opened, "commit");

    send(opened, "today-name-confirm", { name: "Window" });
    await settle(el);
    await opened.updateComplete;

    expect(windowOf(el)).toBe(opened);
    expect(opened.busy).toBe(false);
    expect(opened.refusal).toEqual({ code: "table.label_taken", field: "name" });
    expect(fieldOf(opened).error).toBe("Another table already has that name");
    expect(commit).not.toHaveBeenCalled();
    expect(floorRefusal(el)).toBeNull();
    expect(refreshes.count).toBe(1);
  });

  it("keeps the window busy while the name is sent", async () => {
    const api = stubApi();
    let done!: (answer: FloorAnswer) => void;
    api.nameToday.mockImplementationOnce(() => new Promise((resolve) => (done = resolve)));
    const el = await mount(bar(), api);
    const opened = await pressRename(el, "bar");

    send(opened, "today-name-confirm", { name: "Window" });
    await settle(el);
    expect(windowOf(el)!.busy).toBe(true);

    done({ zoneId: "z1", revision: 8 });
    await settle(el);
    expect(windowOf(el)).toBeNull();
  });

  it("an out-of-date refusal closes the window, says so on the floor and re-reads", async () => {
    const api = stubApi();
    api.nameToday.mockRejectedValueOnce({ code: "floor_today.out_of_date", status: 409 });
    const el = await mount(bar(), api);
    const refreshes = countRefreshes(el);
    const opened = await pressRename(el, "bar");

    send(opened, "today-name-confirm", { name: "Window" });
    await settle(el);

    expect(windowOf(el)).toBeNull();
    expect(floorRefusal(el)).toBe("The floor has changed. Check and try again");
    expect(refreshes.count).toBe(1);
  });

  it("sends the waiter's next change with the rename's answer's revision, not the read's", async () => {
    const api = stubApi();
    const el = await mount(bar(), api);
    send(await pressRename(el, "bar"), "today-name-confirm", { name: "Window" });
    await settle(el);

    await press(el, "bar", "rotate");

    expect(api.rotateToday).toHaveBeenCalledExactlyOnceWith("bar", 8);
  });

  it("keeps what the waiter typed when another till renames the table meanwhile", async () => {
    const el = await mount(bar(), stubApi());
    const opened = await pressRename(el, "bar");
    await typeName(opened, "Window");

    el.tables = [table("bar", "Bar", 40, { name: "Terrace" }), table("c3", "Counter 3", 10)];
    await settle(el);
    await opened.updateComplete;

    expect(windowOf(el)).toBe(opened);
    expect(fieldOf(opened).shadowRoot!.querySelector("input")!.value).toBe("Window");
    expect(opened.value).toBe("Window");
  });

  it("keeps the window open with a too-long refusal under the field", async () => {
    const api = stubApi();
    api.nameToday.mockRejectedValueOnce({
      code: "management.request_invalid",
      status: 400,
      field: "name",
    });
    const el = await mount(bar(), api);
    const opened = await pressRename(el, "bar");

    send(opened, "today-name-confirm", { name: "Window" });
    await settle(el);

    expect(windowOf(el)).toBe(opened);
    expect(opened.refusal).toEqual({ code: "management.request_invalid", field: "name" });
    expect(floorRefusal(el)).toBeNull();
  });

  it("moves a refusal under the field to the floor when the table stops offering Rename", async () => {
    const api = stubApi();
    api.nameToday.mockRejectedValueOnce({
      code: "table.label_taken",
      status: 409,
      label: "Window",
      field: "name",
    });
    const el = await mount(bar(), api);
    send(await pressRename(el, "bar"), "today-name-confirm", { name: "Window" });
    await settle(el);

    el.tables = [table("bar", "Bar", 40, { takenOff: true }), table("c3", "Counter 3", 10)];
    await settle(el);

    expect(windowOf(el)).toBeNull();
    expect(floorRefusal(el)).toBe("Another table already has that name");
  });

  it("closes the window, sending nothing, when another till joins its table into a group", async () => {
    const api = stubApi();
    const el = await mount(bar(), api);
    const opened = await pressRename(el, "bar");
    await typeName(opened, "Window");

    el.tables = [
      table("bar", "Bar", 40, { joinId: "g" }),
      table("c3", "Counter 3", 42, { joinId: "g" }),
    ];
    await settle(el);
    send(opened, "today-name-confirm", { name: "Window" });
    await settle(el);

    expect(windowOf(el)).toBeNull();
    expect(api.nameToday).not.toHaveBeenCalled();
  });

  it("keeps a group member's window open across a re-read listing the group in another order", async () => {
    const api = stubApi();
    const el = await mount(group(), api);
    const opened = await pressRename(el, "c4");
    await typeName(opened, "García birthday");

    el.tables = group({ c3: { name: "Corner" } }).reverse();
    await settle(el);
    expect(windowOf(el)).toBe(opened);
    send(opened, "today-name-confirm", { name: "García birthday" });
    await settle(el);

    expect(api.nameToday).toHaveBeenCalledExactlyOnceWith("c4", "García birthday", 7);
  });

  it("closes the window, sending nothing, when its table's group ends", async () => {
    const api = stubApi();
    const el = await mount(group(), api);
    const opened = await pressRename(el, "c4");

    el.tables = group().map((each) =>
      each.id === "c4" ? { ...each, today: { ...each.today!, joinId: null } } : each,
    );
    await settle(el);
    send(opened, "today-name-confirm", { name: "Window" });
    await settle(el);

    expect(windowOf(el)).toBeNull();
    expect(api.nameToday).not.toHaveBeenCalled();
  });

  it("moves a refusal under the field to the floor when its table joins a group", async () => {
    const api = stubApi();
    api.nameToday.mockRejectedValueOnce({
      code: "table.label_taken",
      status: 409,
      label: "Window",
      field: "name",
    });
    const el = await mount(bar(), api);
    send(await pressRename(el, "bar"), "today-name-confirm", { name: "Window" });
    await settle(el);

    el.tables = [
      table("bar", "Bar", 40, { joinId: "g" }),
      table("c3", "Counter 3", 42, { joinId: "g" }),
    ];
    await settle(el);

    expect(windowOf(el)).toBeNull();
    expect(floorRefusal(el)).toBe("Another table already has that name");
  });

  it("closes the window when its table leaves the floor read", async () => {
    const el = await mount(bar(), stubApi());
    await pressRename(el, "bar");

    el.tables = [table("c3", "Counter 3", 10)];
    await settle(el);

    expect(windowOf(el)).toBeNull();
  });

  it("Cancel closes the window and sends nothing", async () => {
    const api = stubApi();
    const el = await mount(bar(), api);
    send(await pressRename(el, "bar"), "today-name-cancel");
    await settle(el);

    expect(windowOf(el)).toBeNull();
    expect(api.nameToday).not.toHaveBeenCalled();
  });
});
