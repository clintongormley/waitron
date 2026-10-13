import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TableParty, TableState, TableToday } from "../api/client.js";
import { groupSplitOf } from "../state/floor-today.js";
import "./split-joined-dialog.js";
import type { SplitJoinedDetail, TillSplitJoinedDialog } from "./split-joined-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function today(seats: number | null, over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x: 0, y: 0, width: 2, height: 2, shape: "rect", rotation: 0 },
    seats,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
    ...over,
  };
}

function table(id: string, label: string, over: Partial<TableState> = {}): TableState {
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
    today: today(4),
    signals: [],
    party: null,
    ...over,
  };
}

const party: TableParty = {
  id: "p1",
  revision: 1,
  guestCount: 6,
  state: "open",
  name: null,
  displayName: "Long table",
  mainBillId: null,
  outstanding: "0.00",
  billCount: 1,
  tableIds: ["long"],
  unsentDrafts: [],
  reminder: null,
};

const longTable = (over: Partial<TableState> = {}) =>
  table("long", "Long table", {
    today: today(10, { joined: { parts: ["c3", "c4", "c5"], splitOff: [], apart: false } }),
    ...over,
  });
const part = (id: string, label: string, seats: number | null) =>
  table(id, label, { today: today(seats, { inJoinedTable: "Long table" }) });
const parts = () => [
  part("c3", "Counter 3", 2),
  part("c4", "Counter 4", 6),
  part("c5", "Counter 5", 4),
];

async function mount(props: Partial<TillSplitJoinedDialog> = {}): Promise<TillSplitJoinedDialog> {
  const { el } = await mountWidget<TillSplitJoinedDialog>("till-split-joined-dialog", {
    joined: longTable(),
    parts: parts(),
    name: "Long table",
    ...props,
  });
  return el;
}

const pick = (el: TillSplitJoinedDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=split-off]")!;
const seatsField = (el: TillSplitJoinedDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]");
const action = (el: TillSplitJoinedDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-split-action]")!;
const cancelButton = (el: TillSplitJoinedDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-split-cancel]")!;
const foot = (el: TillSplitJoinedDialog) => el.shadowRoot!.querySelector("wt-form-actions")!;
const text = (el: TillSplitJoinedDialog) => el.shadowRoot!.textContent!.replace(/\s+/g, " ");

async function choose(el: TillSplitJoinedDialog, values: string[]): Promise<void> {
  pick(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { values }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function typeSeats(el: TillSplitJoinedDialog, value: string): Promise<void> {
  const input = seatsField(el)!.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}
async function press(el: TillSplitJoinedDialog): Promise<void> {
  action(el).click();
  await el.updateComplete;
}
function captured(el: TillSplitJoinedDialog) {
  const seen: { confirmed: SplitJoinedDetail[]; cancelled: number } = {
    confirmed: [],
    cancelled: 0,
  };
  el.addEventListener("split-joined-confirm", (event) =>
    seen.confirmed.push((event as CustomEvent<SplitJoinedDetail>).detail),
  );
  el.addEventListener("split-joined-cancel", () => (seen.cancelled += 1));
  return seen;
}

it("lists the parts still joined in the order given, each with its seats", async () => {
  const el = await mount({
    parts: [part("c5", "Counter 5", 4), part("c3", "Counter 3", 1), part("c4", "Counter 4", null)],
  });
  expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Split Long table");
  expect(pick(el).label).toBe("Tables to split off");
  expect(pick(el).multiple).toBe(true);
  expect(pick(el).required).toBe(true);
  expect(pick(el).search).toBe("never");
  expect(pick(el).options).toEqual([
    { value: "c5", label: "Counter 5", description: "4 seats" },
    { value: "c3", label: "Counter 3", description: "1 seat" },
    { value: "c4", label: "Counter 4" },
  ]);
  expect(pick(el).countLabel(2)).toBe("2 tables");
});

it("opens with nothing chosen and Split quiet and disabled", async () => {
  const el = await mount();
  expect(pick(el).values).toEqual([]);
  expect(action(el).textContent!.trim()).toBe("Split");
  expect([action(el).variant, action(el).disabled]).toEqual(["secondary", true]);
  await choose(el, ["c5"]);
  expect([action(el).variant, action(el).disabled]).toEqual(["primary", false]);
});

it("asks Long table's seats, empty and required, only while two or more would stay", async () => {
  const el = await mount();
  await choose(el, ["c5"]);
  const seats = seatsField(el)!;
  expect(seats).not.toBeNull();
  expect(seats.required).toBe(true);
  expect(seats.value).toBe("");
  expect([seats.min, seats.max]).toEqual([1, 999]);
  expect(seats.label).toBe("Seats for Long table");
  await choose(el, ["c5", "c4"]);
  expect(seatsField(el)).toBeNull();
});

it("explains a Split with every part chosen, beside the field and at the foot, and keeps Split disabled until fixed", async () => {
  const el = await mount();
  const seen = captured(el);
  await choose(el, ["c3", "c4", "c5"]);
  await press(el);
  expect(seen.confirmed).toEqual([]);
  expect(pick(el).error).toBe("Leave at least 1 table joined.");
  expect(foot(el).error).toBe("Correct the highlighted fields to continue.");
  expect(action(el).disabled).toBe(true);
  await choose(el, ["c4", "c5"]);
  expect(pick(el).error).toBe("");
  expect(foot(el).error).toBe("");
  expect(action(el).disabled).toBe(false);
});

it("explains a Split with no table chosen beside the field", async () => {
  const el = await mount();
  const seen = captured(el);
  await typeSeats(el, "6");
  await press(el);
  expect(seen.confirmed).toEqual([]);
  expect(pick(el).error).toBe("Choose at least 1 table.");
  expect(foot(el).error).toBe("Correct the highlighted fields to continue.");
});

it("explains a Split with no seats beside Seats", async () => {
  const el = await mount();
  const seen = captured(el);
  await choose(el, ["c5"]);
  await press(el);
  expect(seen.confirmed).toEqual([]);
  expect(seatsField(el)!.error).toBe("Enter 1 to 999");
  expect(pick(el).error).toBe("");
  expect(foot(el).error).toBe("Correct the highlighted fields to continue.");
  expect(action(el).disabled).toBe(true);
});

it("sends the parts and the seats", async () => {
  const el = await mount();
  const seen = captured(el);
  await choose(el, ["c5"]);
  await typeSeats(el, "6");
  await press(el);
  expect(seen.confirmed).toEqual([{ partIds: ["c5"], seats: 6 }]);
});

it("sends no seats when one part would be left", async () => {
  const el = await mount();
  const seen = captured(el);
  await choose(el, ["c5"]);
  await typeSeats(el, "6");
  await choose(el, ["c5", "c4"]);
  await press(el);
  expect(seen.confirmed).toEqual([{ partIds: ["c4", "c5"], seats: null }]);
});

it("says Long table is reserved today", async () => {
  const el = await mount({ joined: longTable({ nextReservation: { time: "21:00" } }) });
  expect(text(el)).toContain("Reserved 21:00");
  const plain = await mount();
  expect(text(plain)).not.toContain("Reserved");
});

it("says the guests move to the part left", async () => {
  const el = await mount({ joined: longTable({ party, condition: "held", state: "open-tab" }) });
  await choose(el, ["c5"]);
  expect(text(el)).not.toContain("Guests move");
  await choose(el, ["c3", "c5"]);
  expect(text(el)).toContain("Guests move to Counter 4");
  const empty = await mount();
  await choose(empty, ["c3", "c5"]);
  expect(text(empty)).not.toContain("Guests move");
});

it("shows a refusal naming partIds under Tables to split off until the choice changes", async () => {
  const el = await mount();
  await choose(el, ["c4", "c5"]);
  el.refusal = { code: "joined_table.part_invalid", field: "partIds" };
  await el.updateComplete;
  expect(pick(el).error).toBe(codeMessage("joined_table.part_invalid"));
  expect(foot(el).error).toBe("Correct the highlighted fields to continue.");
  expect(action(el).disabled).toBe(false);
  await choose(el, ["c5"]);
  expect(pick(el).error).toBe("");
  expect(foot(el).error).toBe("");

  el.refusal = { code: "joined_table.part_invalid", field: "partIds" };
  await el.updateComplete;
  await choose(el, ["c4", "c5"]);
  el.refusal = { code: "joined_table.part_invalid", field: "partIds" };
  await el.updateComplete;
  await press(el);
  expect(pick(el).error).toBe("");
  expect(foot(el).error).toBe("");
});

it("shows a refusal naming Seats under Seats until the number changes", async () => {
  const el = await mount();
  await choose(el, ["c5"]);
  await typeSeats(el, "6");
  el.refusal = { code: "joined_table.seats_required", field: "seats" };
  await el.updateComplete;
  expect(seatsField(el)!.error).toBe(codeMessage("joined_table.seats_required"));
  expect(pick(el).error).toBe("");
  expect(foot(el).error).toBe("Correct the highlighted fields to continue.");
  await typeSeats(el, "7");
  expect(seatsField(el)!.error).toBe("");
  expect(foot(el).error).toBe("");
});

it("shows a refusal naming Seats at the foot while Seats is not shown", async () => {
  const el = await mount();
  await choose(el, ["c4", "c5"]);
  el.refusal = { code: "management.request_invalid", field: "seats" };
  await el.updateComplete;
  expect(seatsField(el)).toBeNull();
  expect(foot(el).error).toBe(codeMessage("management.request_invalid"));
  expect(pick(el).error).toBe("");
});

it("shows a refusal naming no field at the foot", async () => {
  const el = await mount();
  await choose(el, ["c5"]);
  el.refusal = { code: "table.taken_off" };
  await el.updateComplete;
  expect(foot(el).error).toBe(codeMessage("table.taken_off"));
  expect(pick(el).error).toBe("");
  await choose(el, ["c4"]);
  expect(foot(el).error).toBe(codeMessage("table.taken_off"));
});

it("disables every field and refuses to close while busy", async () => {
  const el = await mount();
  const seen = captured(el);
  await choose(el, ["c5"]);
  await typeSeats(el, "6");
  el.busy = true;
  await el.updateComplete;
  expect(pick(el).disabled).toBe(true);
  expect(seatsField(el)!.disabled).toBe(true);
  expect(cancelButton(el).disabled).toBe(true);
  expect([action(el).variant, action(el).disabled]).toEqual(["primary", true]);
  await press(el);
  expect(seen.confirmed).toEqual([]);
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await dialog.requestClose("cancel");
  await el.updateComplete;
  expect(dialog.open).toBe(true);
  expect(seen.cancelled).toBe(0);
});

it("names every field", async () => {
  const el = await mount();
  expect(pick(el).name).toBe("split-off");
  expect(seatsField(el)!.name).toBe("seats");
});

it("speaks Spanish", async () => {
  setLocale("es-ES");
  const el = await mount({ joined: longTable({ party, condition: "held", state: "open-tab" }) });
  expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Separar Long table");
  expect(pick(el).label).toBe("Mesas que se separan");
  expect(pick(el).countLabel(2)).toBe("2 mesas");
  expect(pick(el).options[0]).toEqual({ value: "c3", label: "Counter 3", description: "2 plazas" });
  expect(action(el).textContent!.trim()).toBe("Separar");
  expect(seatsField(el)!.label).toBe("Plazas para Long table");
  await choose(el, ["c3", "c4", "c5"]);
  await press(el);
  expect(pick(el).error).toBe("Deja al menos 1 mesa unida.");
  await choose(el, ["c3", "c4"]);
  expect(text(el)).toContain("Los clientes pasan a Counter 5");
  await choose(el, []);
  await typeSeats(el, "4");
  await press(el);
  expect(pick(el).error).toBe("Elige al menos 1 mesa.");
});

for (const [width, height] of [
  [1280, 720],
  [390, 844],
] as const) {
  it(`keeps one width at ${width}px, its fields' right edges aligned and its label whole`, async () => {
    await page.viewport(width, height);
    try {
      for (const locale of ["en", "es"] as const) {
        setLocale(locale);
        const el = await mount();
        const window = el
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector("dialog")!;
        const label = pick(el).shadowRoot!.querySelector<HTMLElement>(".field-label-text")!;
        const empty = window.getBoundingClientRect().width;
        expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
        const box = (field: HTMLElement) =>
          field.shadowRoot!.querySelector(".field")!.getBoundingClientRect().right;
        expect(box(seatsField(el)!)).toBeCloseTo(box(pick(el)), 0);
        expect(window.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        await choose(el, ["c3", "c4", "c5"]);
        await press(el);
        expect(pick(el).error).not.toBe("");
        expect(window.getBoundingClientRect().width).toBeCloseTo(empty, 0);
        cleanupWidgets();
      }
    } finally {
      await page.viewport(1280, 720);
    }
  });
}

describe("on a group", () => {
  const inGroup = (id: string, label: string, seats: number, over: Partial<TableToday> = {}) =>
    table(id, label, { today: today(seats, { joinId: "g", ...over }) });
  const splitOff = { splitOffFrom: "long" };
  const bar = inGroup("bar", "Bar", 4);
  const zone = [
    inGroup("c5", "Counter 5", 4, splitOff),
    table("long", "Long table", {
      today: today(10, {
        placement: null,
        joined: { parts: [], splitOff: ["c3", "c4", "c5"], apart: true },
      }),
    }),
    inGroup("c3", "Counter 3", 2, splitOff),
    bar,
    inGroup("c4", "Counter 4", 6, splitOff),
  ];
  const group = groupSplitOf(bar, zone)!;
  const mountGroup = (props: Partial<TillSplitJoinedDialog> = {}) =>
    mount({
      joined: bar,
      parts: group.members,
      name: group.name,
      asksSeats: group.asksSeats,
      ...props,
    });

  it("lists the group's tables with their seats, under the group's name", async () => {
    const el = await mountGroup();
    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
      "Split Bar+Counter 3+Counter 4+Counter 5",
    );
    expect(pick(el).options).toEqual([
      { value: "bar", label: "Bar", description: "4 seats" },
      { value: "c3", label: "Counter 3", description: "2 seats" },
      { value: "c4", label: "Counter 4", description: "6 seats" },
      { value: "c5", label: "Counter 5", description: "4 seats" },
    ]);
  });

  it("asks no seats when Bar is ticked, and sends none", async () => {
    const el = await mountGroup();
    const seen = captured(el);
    await choose(el, ["bar"]);
    expect(seatsField(el)).toBeNull();
    await press(el);
    expect(seen.confirmed).toEqual([{ partIds: ["bar"], seats: null }]);
  });

  it("asks the seats for what stays when Counter 5 is ticked, and sends them", async () => {
    const el = await mountGroup();
    const seen = captured(el);
    await choose(el, ["c5"]);
    const seats = seatsField(el)!;
    expect(seats.required).toBe(true);
    expect(seats.label).toBe("Seats for what stays");
    await press(el);
    expect(seats.error).toBe("Enter 1 to 999");
    await typeSeats(el, "10");
    await press(el);
    expect(seen.confirmed).toEqual([{ partIds: ["c5"], seats: 10 }]);
  });

  it("asks the seats when its host says they are required, whatever is ticked", async () => {
    const el = await mountGroup({ seatsRequired: true });
    const seen = captured(el);
    await choose(el, ["bar"]);
    const seats = seatsField(el)!;
    expect(seats.required).toBe(true);
    expect(seats.label).toBe("Seats for what stays");
    await press(el);
    expect(seen.confirmed).toEqual([]);
    await typeSeats(el, "10");
    await press(el);
    expect(seen.confirmed).toEqual([{ partIds: ["bar"], seats: 10 }]);
  });

  it("asks no seats when its host says they are required but only one table stays, and sends none", async () => {
    const el = await mountGroup({ seatsRequired: true });
    const seen = captured(el);
    await choose(el, ["c3", "c4", "c5"]);
    expect(seatsField(el)).toBeNull();
    await press(el);
    expect(seen.confirmed).toEqual([{ partIds: ["c3", "c4", "c5"], seats: null }]);
  });

  it("says where the guests go when a ticked table holds them, as its host names it", async () => {
    const el = await mountGroup({
      guestsMoveTo: (ticked) => (ticked.includes("c3") ? ["Counter 4"] : []),
    });
    await choose(el, ["c5"]);
    expect(text(el)).not.toContain("Guests move");
    await choose(el, ["c3"]);
    expect(el.shadowRoot!.querySelector("[data-guests-move]")!.textContent!.trim()).toBe(
      "Guests move to Counter 4",
    );
  });

  it("says nothing of guests when Bar's guests keep Bar and the counters are ticked", async () => {
    const seated = { ...bar, party: { ...party, tableIds: ["bar"] } };
    const el = await mountGroup({ joined: seated });
    await choose(el, ["c3", "c4", "c5"]);
    expect(text(el)).not.toContain("Guests move");
  });

  const seatedAt = (...ids: string[]) =>
    zone.map((each) =>
      ids.includes(each.id)
        ? { ...each, condition: "held" as const, party: { ...party, tableIds: ids } }
        : each,
    );
  const mountSeated = (...ids: string[]) => {
    const tables = seatedAt(...ids);
    const seated = groupSplitOf(
      tables.find((each) => each.id === "bar")!,
      tables,
    )!;
    return mountGroup({
      joined: seated.members[0],
      parts: seated.members,
      asksSeats: seated.asksSeats,
      guestsMoveTo: seated.guestsMoveTo,
      strandsGuests: seated.strandsGuests,
    });
  };

  it("explains a Split ticking every table the guests hold, beside the field and at the foot, and keeps Split disabled until fixed", async () => {
    const el = await mountSeated("bar");
    const seen = captured(el);
    await choose(el, ["bar"]);
    expect(pick(el).error).toBe("");
    await press(el);
    expect(seen.confirmed).toEqual([]);
    expect(pick(el).error).toBe("Leave one of the guests' tables.");
    expect(foot(el).error).toBe("Correct the highlighted fields to continue.");
    expect(action(el).disabled).toBe(true);
    await choose(el, ["c3"]);
    expect(pick(el).error).toBe("");
    await typeSeats(el, "8");
    expect(foot(el).error).toBe("");
    expect(action(el).disabled).toBe(false);
  });

  it("lets Bar go when its guests also hold Counter 3", async () => {
    const el = await mountSeated("bar", "c3");
    const seen = captured(el);
    await choose(el, ["bar"]);
    await typeSeats(el, "8");
    await press(el);
    expect(pick(el).error).toBe("");
    expect(seen.confirmed).toEqual([{ partIds: ["bar"], seats: 8 }]);
  });

  it("shows a merge.strands_party refusal under the list as the guests' tables, until the choice changes, without disabling Split", async () => {
    const el = await mountGroup();
    await choose(el, ["bar"]);
    el.refusal = { code: "merge.strands_party", field: "partIds" };
    await el.updateComplete;
    expect(pick(el).error).toBe("Leave one of the guests' tables");
    expect(foot(el).error).toBe("Correct the highlighted fields to continue.");
    expect(action(el).disabled).toBe(false);
    await choose(el, ["c3"]);
    expect(pick(el).error).toBe("");
    expect(foot(el).error).toBe("");
  });

  it("keeps a tab.already_open refusal's own words in a joined table's window", async () => {
    const el = await mount();
    await choose(el, ["c5"]);
    el.refusal = { code: "tab.already_open" };
    await el.updateComplete;
    expect(foot(el).error).toBe(codeMessage("tab.already_open"));
    expect(pick(el).error).toBe("");
  });

  it("labels Seats as a joined table's when the joined table in a group still has tables joined", async () => {
    const el = await mount({
      joined: longTable({
        today: today(10, {
          joinId: "g",
          joined: { parts: ["c3", "c4", "c5"], splitOff: [], apart: false },
        }),
      }),
    });
    await choose(el, ["c5"]);
    expect(seatsField(el)!.label).toBe("Seats for Long table");
  });

  it("speaks Spanish", async () => {
    setLocale("es-ES");
    const el = await mountGroup();
    await choose(el, ["c5"]);
    expect(seatsField(el)!.label).toBe("Plazas para lo que queda");
    el.refusal = { code: "merge.strands_party", field: "partIds" };
    await el.updateComplete;
    expect(pick(el).error).toBe("Deja una de las mesas de los clientes");
  });
});
