import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { ReleaseReminder, TableState, TableParty, TableToday } from "../api/client.js";

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

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t4",
    label: "4",
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals: [],
    party: null,
    ...over,
  };
}

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: {
      scope: { partyId: over.id ?? "v1" },
      note: null,
      revision: 0,
      ownerRevision: over.revision ?? 3,
    },
    id: "v1",
    revision: 3,
    guestCount: 3,
    state: "open",
    name: null,
    displayName: "4",
    mainBillId: "wo-4",
    outstanding: "44.00",
    billCount: 2,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function seated(over: Partial<TableState> = {}, partyOver: Partial<TableParty> = {}): TableState {
  return table({
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabLineCount: 2,
    tabTotal: "14.00",
    party: party(partyOver),
    ...over,
  });
}

const now = Date.parse("2026-09-29T20:00:00.000Z");
const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const onMap = { today: today() };
type Token = HTMLElement & { updateComplete: Promise<unknown> };

function held(reminder: ReleaseReminder | null, over: Partial<TableState> = {}): TableState {
  return seated({ signals: [{ kind: "held", count: 2 }], ...over }, { reminder });
}

/** `clock: "real"` leaves the screen on its own clock. */
async function mountAt(tables: TableState[], clock: number | "real" = now) {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [
      {
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
      },
    ],
    tables,
    now: clock === "real" ? undefined : clock,
  });
  return el;
}

const card = (el: TillFloorScreen, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-table="${id}"]`)!;
const heldOn = (el: TillFloorScreen, id = "t4") =>
  card(el, id).querySelector<HTMLElement>('[data-chip="held"]');
const heldText = (el: TillFloorScreen, id = "t4") => heldOn(el, id)?.textContent?.trim();
const fireDue = (el: TillFloorScreen, id = "t4") =>
  card(el, id).querySelector<HTMLElement>("[data-fire-due]");

beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale("en");
  cleanupWidgets();
});

describe("till-floor-screen: a table holding dishes", () => {
  it("shows Held 2 on the card while the reminder has no time, and with reminders off", async () => {
    const el = await mountAt([
      held({ groupId: "g2", dueAt: null }),
      held(null, { id: "t5", label: "5" }),
    ]);
    for (const id of ["t4", "t5"]) {
      expect(heldText(el, id)).toBe("Held 2");
      expect(heldOn(el, id)!.querySelector("wt-icon[name=held]")).not.toBeNull();
      expect(fireDue(el, id)).toBeNull();
    }
  });

  it("counts down on the card: Held 2 · fire in 4 min", async () => {
    const el = await mountAt([
      held({ groupId: "g2", dueAt: at(240_000) }),
      held({ groupId: "g2", dueAt: at(1) }, { id: "t5", label: "5" }),
    ]);
    expect(heldText(el)).toBe("Held 2 · fire in 4 min");
    expect(heldText(el, "t5")).toBe("Held 2 · fire in 1 min");
    expect(fireDue(el)).toBeNull();
  });

  it("turns into the filled Time to fire when due, and drops the held chip", async () => {
    const el = await mountAt([held({ groupId: "g2", dueAt: at(0) })]);
    el.style.setProperty("--wt-color-warning", "rgb(10, 20, 30)");
    el.style.setProperty("--wt-color-on-warning", "rgb(200, 210, 220)");
    const badge = fireDue(el)!;
    expect(badge.textContent!.trim()).toBe("Time to fire");
    expect(badge.querySelector("wt-icon[name=fire]")).not.toBeNull();
    expect(heldOn(el)).toBeNull();
    const style = getComputedStyle(badge);
    expect(style.backgroundColor).toBe("rgb(10, 20, 30)");
    expect(style.borderTopColor).toBe("rgb(10, 20, 30)");
    expect(style.color).toBe("rgb(200, 210, 220)");
  });

  it("shows the held chip and its countdown on an unplaced table's token", async () => {
    const el = await mountAt([
      table({ id: "t5", label: "5", ...onMap }),
      held({ groupId: "g2", dueAt: at(240_000) }),
    ]);
    const token = el.shadowRoot!.querySelector<Token>('[data-tray-table="t4"] wt-table-token')!;
    await token.updateComplete;
    expect(token.shadowRoot!.querySelector('[data-chip="held"]')?.textContent?.trim()).toBe(
      "Held 2 · fire in 4 min",
    );
  });

  it("says it in Spanish", async () => {
    setLocale("es");
    const el = await mountAt([
      held({ groupId: "g2", dueAt: at(240_000) }),
      held(null, { id: "t5", label: "5" }),
    ]);
    expect(heldText(el)).toBe(es["floor.held_fire_in"].replace("{n}", "2").replace("{m}", "4"));
    expect(heldText(el, "t5")).toBe(es["floor.held"].replace("{n}", "2"));
  });

  describe("on the screen's own clock", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("redraws each minute the countdown changes, with no new floor read", async () => {
      const el = await mountAt([held({ groupId: "g2", dueAt: at(150_000) })], "real");
      const reads: unknown[] = [];
      el.addEventListener("floor-refresh", (event) => reads.push(event));
      expect(heldText(el)).toBe("Held 2 · fire in 3 min");
      await vi.advanceTimersByTimeAsync(30_000);
      await el.updateComplete;
      expect(heldText(el)).toBe("Held 2 · fire in 2 min");
      await vi.advanceTimersByTimeAsync(60_000);
      await el.updateComplete;
      expect(heldText(el)).toBe("Held 2 · fire in 1 min");
      await vi.advanceTimersByTimeAsync(60_000);
      await el.updateComplete;
      expect(heldOn(el)).toBeNull();
      expect(fireDue(el)).not.toBeNull();
      expect(reads).toEqual([]);
    });

    it("keeps no timer for a held table with no time or an unreadable one", async () => {
      const el = await mountAt(
        [
          held({ groupId: "g2", dueAt: null }),
          held({ groupId: "g2", dueAt: "not a time" }, { id: "t5", label: "5" }),
        ],
        "real",
      );
      const redraws = vi.spyOn(el, "requestUpdate");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(redraws).not.toHaveBeenCalled();
      expect(heldText(el)).toBe("Held 2");
      expect(heldText(el, "t5")).toBe("Held 2");
    });

    it("reads the time left now on coming back to the page", async () => {
      const el = await mountAt([held({ groupId: "g2", dueAt: at(300_000) })], "real");
      expect(heldText(el)).toBe("Held 2 · fire in 5 min");
      const parent = el.parentElement!;
      el.remove();
      await vi.advanceTimersByTimeAsync(120_000);
      parent.append(el);
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      expect(heldText(el)).toBe("Held 2 · fire in 3 min");
    });
  });
});
