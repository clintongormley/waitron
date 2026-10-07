import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import {
  slotChecks,
  slotDraftOf,
  weekSlotChecks,
  wireSlots,
  type MenuSlotEditor,
  type SlotDraft,
} from "./menu-slot-editor.js";
import "./menu-slot-editor.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

const PERIODS = [
  { id: "mananas", name: "Mañanas", menuId: "m1", menuName: "Desayunos" },
  { id: "mediodia", name: "Mediodía", menuId: "m2", menuName: "Almuerzo" },
];
const row = (id: string, periodId: string, startsAt: string, endsAt: string) => ({
  id,
  periodId,
  startsAt,
  endsAt,
});

async function mount(props: Partial<MenuSlotEditor>) {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("menu-slot-editor");
  Object.assign(el, { label: "Monday", fieldPrefix: "monday", periods: PERIODS, ...props });
  const changes: SlotDraft[] = [];
  el.addEventListener("menu-slot-change", (event) => {
    changes.push(event.detail.draft);
    el.draft = event.detail.draft;
  });
  host.append(el);
  await el.updateComplete;
  return { el, changes };
}

/** Searches every shadow root under the editor. */
function find<T extends HTMLElement>(el: Element, selector: string): T | null {
  const search = (root: ParentNode): T | null => {
    const hit = root.querySelector<T>(selector);
    if (hit) return hit;
    for (const child of root.querySelectorAll("*"))
      if (child.shadowRoot) {
        const found = search(child.shadowRoot);
        if (found) return found;
      }
    return null;
  };
  return search(el.shadowRoot!);
}
type Field = HTMLElement & {
  value: string;
  label: string;
  error: string;
  options: { value: string; label: string }[];
};
const field = (el: Element, name: string) => find<Field>(el, `[name="${name}"]`);
async function settle(el: MenuSlotEditor) {
  await el.updateComplete;
  await el.shadowRoot!.querySelector("hours-cell-editor")!.updateComplete;
}

describe("menu slot editor", () => {
  it("draws a period choice before each slot's times, in a timetable's words", async () => {
    const { el } = await mount({
      draft: { mode: "periods", slots: [row("a", "mananas", "08:00", "12:00")] },
    });
    await settle(el);
    const period = field(el, "monday.periods.0.periodId")!;
    expect(period.value).toBe("mananas");
    expect(period.options.map((option) => option.label)).toEqual([
      "Mañanas (Desayunos)",
      "Mediodía (Almuerzo)",
    ]);
    expect(field(el, "monday.periods.0.opensAt")!.label).toBe("Starts");
    expect(field(el, "monday.periods.0.closesAt")!.label).toBe("Ends");
    const mode = field(el, "monday.mode")!;
    expect(mode.label).toBe("Menus");
    expect(mode.options.map((option) => option.label)).toEqual([
      "No periods: the all-day menu",
      "Periods",
    ]);
    expect(find(el, '[data-test="add-period"]')!.textContent!.trim()).toBe("Add a time");
    expect(find(el, '[data-test="remove-period"]')!.getAttribute("aria-label")).toBe(
      "Remove time 1",
    );
  });

  it("offers a special date's normal week first", async () => {
    const { el } = await mount({
      modes: ["inherit", "all_day", "periods"],
      draft: slotDraftOf(null),
    });
    await settle(el);
    expect(field(el, "monday.mode")!.options[0]).toEqual({ value: "", label: "Normal week" });
  });

  it("keeps each row's period through time changes and gives a new row none", async () => {
    const { el, changes } = await mount({
      draft: { mode: "periods", slots: [row("a", "mananas", "08:00", "12:00")] },
    });
    await settle(el);
    await chooseOption(field(el, "monday.periods.0.periodId")!, "mediodia");
    await settle(el);
    find(el, '[data-test="add-period"]')!.click();
    await settle(el);
    expect(changes.at(-1)!.slots.map((slot) => slot.periodId)).toEqual(["mediodia", ""]);
    expect(changes.at(-1)!.slots[0]).toMatchObject({ startsAt: "08:00", endsAt: "12:00" });
  });

  it("leaves the chosen periods out of an all-day day's saved slots", () => {
    const slots = [row("a", "mananas", "08:00", "12:00")];
    expect(wireSlots({ mode: "periods", slots })).toEqual([
      { periodId: "mananas", startsAt: "08:00", endsAt: "12:00" },
    ]);
    expect(wireSlots({ mode: "all_day", slots })).toEqual([]);
    expect(slotDraftOf([]).mode).toBe("all_day");
    expect(slotDraftOf([{ periodId: "p", startsAt: "08:00", endsAt: "09:00" }]).mode).toBe(
      "periods",
    );
  });
});

describe("slot checks", () => {
  it("asks for a period, and says the Hours faults in a timetable's words", () => {
    const draft: SlotDraft = {
      mode: "periods",
      slots: [
        row("a", "", "08:00", "12:00"),
        row("b", "mediodia", "11:00", "13:00"),
        row("c", "mananas", "15:00", "15:00"),
      ],
    };
    expect(slotChecks("monday", draft)).toEqual({
      "monday.periods.0.periodId": "Choose a period.",
      "monday.periods.1.opensAt": "This time overlaps another one on the same day.",
      "monday.periods.2.closesAt": "Choose an end different from the start.",
    });
    expect(slotChecks("monday", { ...draft, mode: "all_day" })).toEqual({});
  });

  it("says which neighbouring day a day's slots overlap past midnight", () => {
    const empty = slotDraftOf([]);
    const late: SlotDraft = { mode: "periods", slots: [row("a", "p", "22:00", "02:00")] };
    const early: SlotDraft = { mode: "periods", slots: [row("b", "p", "01:00", "05:00")] };
    const week = (friday: SlotDraft, saturday: SlotDraft) =>
      [0, 1, 2, 3, 4, 5, 6].map((day) => (day === 5 ? friday : day === 6 ? saturday : empty));
    expect(weekSlotChecks(week(late, early), "friday", 5)).toEqual({
      "friday.mode": "These times run past midnight into Saturday's.",
    });
    expect(weekSlotChecks(week(late, early), "saturday", 6)).toEqual({
      "saturday.mode": "These times overlap Friday's past midnight.",
    });
    expect(weekSlotChecks(week(late, empty), "friday", 5)).toEqual({});
  });
});
