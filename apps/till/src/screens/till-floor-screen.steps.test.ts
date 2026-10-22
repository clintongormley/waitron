import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { FloorMapTable, WtFloorMap } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { mapLook } from "../state/floor-look.js";
import { dueStepSignal } from "../../test/service-steps.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableParty, TableState, TableToday } from "../api/client.js";

const now = Date.parse("2026-10-22T20:00:00.000Z");
const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

function zone(hasPlan: boolean): FloorZone {
  return {
    id: "z1",
    name: "Dining room",
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan,
    layoutSetName: null,
    layoutDue: null,
    serviceMode: "table_tab",
  };
}

function today(): TableToday {
  return {
    placement: { x: 2, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
  };
}

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    id: "p9",
    kitchenNote: { scope: { partyId: "p9" }, note: null, revision: 0, ownerRevision: 1 },
    revision: 1,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: "T9",
    mainBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds: ["t9"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function seated(over: Partial<TableState> = {}): TableState {
  return {
    id: "t9",
    label: "T9",
    zoneId: "z1",
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabLineCount: 2,
    tabTotal: "20.00",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals: [],
    party: party(),
    ...over,
  };
}

async function mount(
  tables: TableState[],
  options: { canMarkSteps?: boolean; clock?: number | "real"; map?: boolean } = {},
) {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone(options.map ?? false)],
    tables,
    canMarkSteps: options.canMarkSteps ?? true,
    now: options.clock === "real" ? undefined : (options.clock ?? now),
    reducedMotion: true,
  });
  return el;
}

const cardOf = (el: TillFloorScreen, id = "t9") =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-table="${id}"]`)!;
const stepChipOf = (el: TillFloorScreen, id = "t9") =>
  cardOf(el, id).querySelector<HTMLElement>('[data-chip="service-step"]');
const doneOf = (el: TillFloorScreen, id = "t9") =>
  cardOf(el, id).querySelector<HTMLButtonElement>("[data-step-done]");

function record(el: TillFloorScreen, type: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale("en");
  cleanupWidgets();
});

describe("till-floor-screen: a table's due service step", () => {
  it("draws the card as a box with a cover button named like the map, and the chip with Done", async () => {
    const table = seated({ signals: [dueStepSignal("Dessert?")] });
    const el = await mount([table]);
    const card = cardOf(el);
    expect(card.tagName).toBe("DIV");
    expect(card.classList.contains("step-card")).toBe(true);
    expect(card.classList.contains("card")).toBe(true);
    const cover = card.querySelector<HTMLButtonElement>("button.card-open")!;
    expect(cover.getAttribute("aria-label")).toBe(`T9, ${mapLook([table], now).description}`);
    expect(cover.getAttribute("aria-label")).toBe("T9, Seated, Dessert?");
    expect(stepChipOf(el)!.querySelector(".step-name")!.textContent!.trim()).toBe("Dessert?");
    expect(doneOf(el)!.getAttribute("aria-label")).toBe("Done: Dessert?");
    expect(card.querySelectorAll("button button")).toHaveLength(0);
  });

  it("opens the table from a click on the box and on the cover", async () => {
    const el = await mount([seated({ signals: [dueStepSignal("Dessert?")] })]);
    const opened = record(el, "open-table");
    cardOf(el).click();
    await userEvent.click(cardOf(el).querySelector<HTMLButtonElement>("button.card-open")!);
    expect(opened).toEqual([
      { tableId: "t9", seated: true },
      { tableId: "t9", seated: true },
    ]);
  });

  it("sends service-step-done with the ids from Done, and does not open the table", async () => {
    const el = await mount([seated({ signals: [dueStepSignal("Dessert?")] })]);
    const opened = record(el, "open-table");
    const done = record(el, "service-step-done");
    await userEvent.click(doneOf(el)!);
    expect(done).toEqual([{ partyId: "p9", stepId: "step-Dessert?", tableId: "t9" }]);
    expect(opened).toEqual([]);
  });

  it("puts the step chip in its precedence place among the marks", async () => {
    const el = await mount([
      seated({
        readyToServe: 2,
        nextReservation: { time: "21:30" },
        signals: [
          dueStepSignal("Dessert?"),
          { kind: "ready", byStation: [{ stationId: "bar", stationName: "Bar", count: 2 }] },
          { kind: "bill_requested", requestedAt: inMinutes(-1) },
        ],
      }),
    ]);
    const marks = [...cardOf(el).querySelector(".badges")!.children].map(
      (mark) =>
        mark.getAttribute("data-chip") ??
        mark.getAttributeNames().find((name) => name.startsWith("data-")),
    );
    expect(marks).toEqual(["bill-requested", "ready", "service-step", "data-reserved"]);
  });

  it("keeps a long step name and a whole Done inside a narrow card", async () => {
    setLocale("es");
    const el = await mount([
      seated({ signals: [dueStepSignal("Preguntar por los postres y los cafés de toda la mesa")] }),
    ]);
    el.style.width = "150px";
    el.style.display = "block";
    await el.updateComplete;
    const card = cardOf(el).getBoundingClientRect();
    const chip = stepChipOf(el)!.getBoundingClientRect();
    const done = doneOf(el)!;
    const doneBox = done.getBoundingClientRect();
    expect(done.textContent!.trim()).toBe(es["floor.step_done"]);
    expect(chip.right).toBeLessThanOrEqual(card.right);
    expect(doneBox.right).toBeLessThanOrEqual(card.right);
    expect(done.scrollWidth).toBeLessThanOrEqual(done.clientWidth);
    const name = stepChipOf(el)!.querySelector<HTMLElement>(".step-name")!;
    expect(card.width).toBeLessThan(160);
    expect(name.getBoundingClientRect().height).toBeGreaterThan(
      3 * parseFloat(getComputedStyle(done).minHeight),
    );
  });

  it("keeps the plain chip on a button card when the device cannot mark steps", async () => {
    const el = await mount([seated({ signals: [dueStepSignal("Dessert?")] })], {
      canMarkSteps: false,
    });
    expect(cardOf(el).tagName).toBe("BUTTON");
    expect(cardOf(el).classList.contains("card")).toBe(true);
    expect(stepChipOf(el)!.textContent!.trim()).toBe("Dessert?");
    expect(doneOf(el)).toBeNull();
    expect(cardOf(el).querySelector(".card-open")).toBeNull();
  });

  it("shows an unplaced table's step as the plain filled chip on its token, with no Done", async () => {
    const el = await mount(
      [
        seated({ id: "t1", label: "T1", party: null, signals: [], today: today() }),
        seated({ today: { ...today(), placement: null }, signals: [dueStepSignal("Dessert?")] }),
      ],
      { map: true },
    );
    const token = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      '[data-tray-table="t9"] wt-table-token',
    )!;
    await token.updateComplete;
    const chip = token.shadowRoot!.querySelector('[data-chip="service-step"]')!;
    expect(chip.textContent!.trim()).toBe("Dessert?");
    expect(chip.classList.contains("tone-primary-filled")).toBe(true);
    expect(token.shadowRoot!.querySelector("[data-step-done]")).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-tray-table="t9"] [data-step-done]')).toBeNull();
  });

  it.each([true, false])(
    "hands the table's details canMarkSteps %s, as the cards have it",
    async (canMarkSteps) => {
      const el = await mount([seated({ today: today(), signals: [dueStepSignal("Dessert?")] })], {
        canMarkSteps,
        map: true,
      });
      el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
        new CustomEvent("wt-table-details", {
          detail: { tableId: "t9" },
          bubbles: true,
          composed: true,
        }),
      );
      await el.updateComplete;
      const sheet = el.shadowRoot!.querySelector("till-table-details-sheet")!;
      expect(sheet.canMarkSteps).toBe(canMarkSteps);
    },
  );

  it("keeps a button card for a table with no step", async () => {
    const el = await mount([seated()]);
    expect(cardOf(el).tagName).toBe("BUTTON");
    expect(cardOf(el).querySelector(".card-open")).toBeNull();
  });

  describe("on the screen's own clock", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("draws a step not yet due when its minute comes, with no new floor read", async () => {
      const el = await mount([seated({ signals: [dueStepSignal("Dessert?", inMinutes(5))] })], {
        clock: "real",
      });
      const reads = record(el, "floor-refresh");
      expect(stepChipOf(el)).toBeNull();
      expect(cardOf(el).tagName).toBe("BUTTON");
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      await el.updateComplete;
      expect(stepChipOf(el)).toBeNull();
      await vi.advanceTimersByTimeAsync(60_000);
      await el.updateComplete;
      expect(cardOf(el).tagName).toBe("DIV");
      expect(doneOf(el)!.getAttribute("aria-label")).toBe("Done: Dessert?");
      expect(reads).toEqual([]);
    });

    it("changes the map's look when a step falls due, with no new floor read", async () => {
      const el = await mount(
        [seated({ today: today(), signals: [dueStepSignal("Dessert?", inMinutes(5))] })],
        { clock: "real", map: true },
      );
      const reads = record(el, "floor-refresh");
      const drawn = (): FloorMapTable =>
        el
          .shadowRoot!.querySelector<WtFloorMap>("wt-floor-map")!
          .tables.find((each) => each.id === "t9")!;
      expect(drawn().cue?.icon).not.toBe("floor-step");
      expect(drawn().description).not.toContain("Dessert?");
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      await el.updateComplete;
      expect(drawn().cue?.icon).not.toBe("floor-step");
      await vi.advanceTimersByTimeAsync(60_000);
      await el.updateComplete;
      expect(drawn().cue).toEqual({ icon: "floor-step", text: "Dessert?" });
      expect(drawn().description).toBe("Seated, Dessert?");
      expect(reads).toEqual([]);
    });
  });
});
