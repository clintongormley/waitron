import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TableState, TableToday } from "../api/client.js";
import "./split-joined-dialog.js";
import type { TillSplitJoinedDialog } from "./split-joined-dialog.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("en"));

function today(seats: number, over: Partial<TableToday> = {}): TableToday {
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
function table(id: string, label: string, todayRow: TableToday, over: Partial<TableState> = {}) {
  const state: TableState = {
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
    nextReservation: { time: "21:00" },
    today: todayRow,
    signals: [],
    party: null,
  };
  return { ...state, ...over };
}
const joined = table(
  "long",
  "Long table",
  today(10, { joined: { parts: ["c3", "c4", "c5"], splitOff: [], apart: false } }),
  {
    state: "open-tab",
    condition: "held",
    party: {
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
    },
  },
);
const parts = [
  table("c3", "Counter 3", today(2, { inJoinedTable: "Long table" })),
  table("c4", "Counter 4", today(6, { inJoinedTable: "Long table" })),
  table("c5", "Counter 5", today(4, { inJoinedTable: "Long table" })),
];

async function choose(el: TillSplitJoinedDialog, values: string[]) {
  el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("till-split-joined-dialog a11y (%s theme)", (theme) => {
  async function mount() {
    setLocale("es-ES");
    return mountWidget<TillSplitJoinedDialog>(
      "till-split-joined-dialog",
      { joined, parts, name: "Long table" },
      theme,
    );
  }

  it("has no violations on a group, with Seats for what stays shown", async () => {
    setLocale("es-ES");
    const inGroup = (id: string, label: string, seats: number) =>
      table(id, label, today(seats, { joinId: "g", splitOffFrom: "long" }));
    const bar = table("bar", "Bar", today(4, { joinId: "g" }));
    const { el, host } = await mountWidget<TillSplitJoinedDialog>(
      "till-split-joined-dialog",
      {
        joined: bar,
        parts: [bar, inGroup("c3", "Counter 3", 2), inGroup("c4", "Counter 4", 6)],
        name: "Bar+Counter 3+Counter 4",
      },
      theme,
    );
    await expectNoA11yViolations(host);
    await choose(el, ["c4"]);
    expect(el.shadowRoot!.querySelector("[name=seats]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on a group with every table the guests hold ticked", async () => {
    setLocale("es-ES");
    const bar = table("bar", "Bar", today(4, { joinId: "g" }));
    const c3 = table("c3", "Counter 3", today(2, { joinId: "g", splitOffFrom: "long" }));
    const { el, host } = await mountWidget<TillSplitJoinedDialog>(
      "till-split-joined-dialog",
      {
        joined: bar,
        parts: [bar, c3],
        name: "Bar+Counter 3",
        strandsGuests: (ticked: readonly string[]) => ticked.includes("bar"),
      },
      theme,
    );
    await choose(el, ["bar"]);
    el.shadowRoot!.querySelector<HTMLElement>("[data-split-action]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-combobox")!.error).toBe(
      "Deja una de las mesas de los clientes.",
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations empty, and with two chosen and Seats shown", async () => {
    const { el, host } = await mount();
    await expectNoA11yViolations(host);
    await choose(el, ["c4", "c5"]);
    await choose(el, ["c5"]);
    expect(el.shadowRoot!.querySelector("[name=seats]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations with every part chosen and refused", async () => {
    const { el, host } = await mount();
    await choose(el, ["c3", "c4", "c5"]);
    el.shadowRoot!.querySelector<HTMLElement>("[data-split-action]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-combobox")!.error).not.toBe("");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refusal under Tables to split off", async () => {
    const { el, host } = await mount();
    await choose(el, ["c4", "c5"]);
    el.refusal = { code: "joined_table.part_invalid", field: "partIds" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-combobox")!.error).not.toBe("");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the guests-move line", async () => {
    const { el, host } = await mount();
    await choose(el, ["c4", "c5"]);
    expect(el.shadowRoot!.textContent).toContain("Los clientes pasan a Counter 3");
    await expectNoA11yViolations(host);
  });
});
