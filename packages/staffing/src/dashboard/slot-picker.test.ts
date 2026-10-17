import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { LitElement } from "lit";
import type { WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import { clockChangeWeek, rotaWeek } from "../testing/rota-fixture.js";
import type { RotaWeek } from "../staffing-types.js";
import type { Slot } from "../slots.js";
import { STAFFING_STRINGS, tf } from "./strings.js";
import { STAFFING_DASHBOARD } from "./index.js";
void STAFFING_DASHBOARD;
const frames: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
type Picker = LitElement & { week: RotaWeek; pickedSlot: Slot; busy: boolean; error: string };
async function mount() {
  const f = document.createElement("div");
  document.body.append(f);
  applyTokens(f);
  frames.push(f);
  const el = document.createElement("slot-picker") as Picker;
  el.week = rotaWeek();
  el.pickedSlot = el.week.days[4]!.areas[0]!.match.slots[0]!.slot;
  f.append(el);
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("[data-person=marc]")).toBeTruthy());
  return el;
}
const rules: WorkTimeRuleset = {
  workingDaysPerWeek: 5,
  overtimeModel: "daily-accrual",
  referencePeriodDays: null,
  compensationWindowDays: null,
  dailyTargetMinutes: null,
  maxWeeklyMinutes: 2400,
  minInterShiftRestMinutes: 720,
  maxOrdinaryDailyMinutes: 540,
  breakThresholdMinutes: 360,
  minBreakMinutes: 15,
  weeklyRestMinutes: 2160,
  annualOvertimeCapHours: 80,
  nightWindowStartMinute: 1320,
  nightWindowEndMinute: 360,
  nightPremiumPct: null,
  splitShiftPremium: null,
  breaksCountAsWorked: false,
};
describe("the slot picker", () => {
  it("lists staff-role holders first with leave, overlapping work and week hours, then shows everyone else", async () => {
    const el = await mount();
    const r = el.shadowRoot!;
    expect(
      [...r.querySelectorAll("[data-person]")].map((p) => (p as HTMLElement).dataset.person),
    ).toEqual(["marc", "laia", "joan"]);
    expect(r.querySelector("[data-person=marc]")!.textContent).toContain("free");
    expect(r.querySelector("[data-person=laia]")!.textContent).toContain("on leave");
    expect(r.querySelector("[data-person=joan]")!.textContent).toContain("41 / 40 h");
    r.querySelector<HTMLElement>("[data-test=show-everyone]")!.click();
    await el.updateComplete;
    expect(
      [...r.querySelectorAll("[data-person]")].map((p) => (p as HTMLElement).dataset.person),
    ).toEqual(["marc", "laia", "joan", "ana", "ibra"]);
  });
  it("shows each listed person only the warnings filling the slot would add, with Show everyone too", async () => {
    const el = await mount();
    const late = {
      ...el.week.shifts[0]!,
      shiftId: "late",
      personId: "marc",
      businessDay: "2026-12-03",
      startsAt: "2026-12-03T17:00:00Z",
      endsAt: "2026-12-03T23:00:00Z",
    };
    el.week = { ...el.week, shifts: [late] };
    (el as Picker & { ruleset: WorkTimeRuleset | null }).ruleset = rules;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=show-everyone]")!.click();
    await el.updateComplete;
    const person = (id: string) =>
      el.shadowRoot!.querySelector(`[data-person=${id}]`)!.textContent!;
    expect(person("marc")).toContain("9 h rest; minimum 12 h");
    expect(person("marc")).not.toContain("night work");
    for (const id of ["laia", "joan", "ana", "ibra"]) {
      expect(person(id)).not.toContain("rest; minimum");
      expect(person(id)).not.toContain("night work");
    }
  });
  it("reports actual overlapping shifts, including another area's overnight shift", async () => {
    const el = await mount();
    el.week = {
      ...el.week,
      shifts: [
        ...el.week.shifts,
        {
          ...el.week.shifts[0]!,
          shiftId: "overlap",
          personId: "marc",
          businessDay: "2026-12-03",
          start: 1080,
          end: 1740,
          startsAt: "2026-12-03T23:00:00Z",
          endsAt: "2026-12-04T10:00:00Z",
        },
      ],
    };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-person=marc]")!.textContent).toContain(
      "working 00:00–11:00",
    );
  });
  it("dispatches a person choice with detail and keeps a refusal available for retry", async () => {
    const el = await mount();
    const choose = vi.fn();
    el.addEventListener("choose", choose);
    el.shadowRoot!.querySelector<HTMLElement>("[data-person=marc]")!.click();
    expect(choose.mock.calls[0]![0].detail).toEqual({ personId: "marc" });
    el.error = "Could not save";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain("Could not save");
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>("[data-person=marc]")!.disabled).toBe(
      false,
    );
    el.busy = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>("[data-person=marc]")!.disabled).toBe(
      true,
    );
  });
  it("says when the slot would take someone over their contract", async () => {
    const el = await mount();
    el.week = {
      ...el.week,
      people: el.week.people.map((p) =>
        p.personId === "laia" ? { ...p, plannedMinutes: 2100 } : p,
      ),
    };
    await el.updateComplete;
    const r = el.shadowRoot!;
    const over = r.querySelector("[data-person=laia] [data-test=would-go-over]")!;
    expect(over.textContent!.trim()).toBe("would go over 40 h contract");
    const painted = getComputedStyle(over).color;
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-danger)";
    frames[0]!.append(probe);
    expect(painted).toBe(getComputedStyle(probe).color);
    el.pickedSlot = { ...el.pickedSlot, end: el.pickedSlot.start + 60, endsAt: "10:00" };
    await el.updateComplete;
    expect(r.querySelector("[data-person=marc]")!.textContent).toContain("39 / 40 h");
    expect(r.querySelector("[data-person=marc] [data-test=would-go-over]")).toBeNull();
    expect(r.querySelector("[data-person=laia] [data-test=would-go-over]")).toBeNull();
    setLocale("es");
    el.pickedSlot = { ...el.pickedSlot, end: el.pickedSlot.start + 480, endsAt: "17:00" };
    await el.updateComplete;
    expect(
      r.querySelector("[data-person=laia] [data-test=would-go-over]")!.textContent!.trim(),
    ).toBe(tf("staffing.rota.would_go_over", { contract: "40" }, "es"));
  });
  it("counts a night slot across the autumn clock change as the nine hours it lasts", async () => {
    const el = await mount();
    const { week, slot } = clockChangeWeek("autumn");
    week.people.find((p) => p.personId === "laia")!.plannedMinutes = 1920;
    el.week = week;
    el.pickedSlot = slot;
    await el.updateComplete;
    expect(
      el
        .shadowRoot!.querySelector("[data-person=laia] [data-test=would-go-over]")!
        .textContent!.trim(),
    ).toBe("would go over 40 h contract");
  });
  it("counts a night slot across the spring clock change as the seven hours it lasts", async () => {
    const el = await mount();
    const { week, slot } = clockChangeWeek("spring");
    week.people.find((p) => p.personId === "laia")!.plannedMinutes = 1980;
    el.week = week;
    el.pickedSlot = slot;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-person=laia]")!.textContent).toContain("33 / 40 h");
    expect(el.shadowRoot!.querySelector("[data-person=laia] [data-test=would-go-over]")).toBeNull();
  });
  it("names the area and says holders come first under its heading", async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector("[data-test=picker-sub]")!.textContent!.trim()).toBe(
      "Kitchen · holders of the staff role first",
    );
    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=picker-sub]")!.textContent!.trim()).toBe(
      tf("staffing.rota.picker_sub", { area: "Kitchen" }, "es"),
    );
  });
  it("has no Close button beside a slot, and Cancel in a sheet", async () => {
    const el = (await mount()) as Picker & { sheet: boolean };
    const buttons = () =>
      [...el.shadowRoot!.querySelectorAll("wt-button")].map((b) => b.textContent!.trim());
    expect(buttons()).toEqual(["Show everyone"]);
    expect(el.shadowRoot!.textContent).not.toContain("Close");
    const close = vi.fn();
    el.addEventListener("close-picker", close);
    el.sheet = true;
    await el.updateComplete;
    expect(buttons()).toEqual(["Show everyone", "Cancel"]);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("in Spanish, the sentence for a staff role nobody holds names the team as its Show everyone button does", async () => {
    setLocale("es");
    const f = document.createElement("div");
    document.body.append(f);
    applyTokens(f);
    frames.push(f);
    const el = document.createElement("slot-picker") as Picker;
    el.week = rotaWeek();
    el.pickedSlot = el.week.days[4]!.areas[0]!.match.slots[0]!.slot;
    const role = el.week.staffRoles.find((r) => r.id === el.pickedSlot!.staffRoleId)!;
    role.holderIds = [];
    for (const p of el.week.people) p.staffRoleIds = p.staffRoleIds.filter((id) => id !== role.id);
    f.append(el);
    const nobody = () =>
      [...(el.shadowRoot?.querySelectorAll("p") ?? [])].find((p) =>
        p.textContent!.includes("Nadie tiene este rol de personal."),
      );
    await vi.waitFor(() => expect(nobody()).toBeTruthy());
    const sentence = nobody()!.textContent!;
    expect(sentence).toContain("todo el equipo");
    expect(sentence).not.toContain("todo el mundo");
  });
  it("shows the same chooser in Spanish", async () => {
    setLocale("es");
    const el = await mount();
    expect(el.shadowRoot!.textContent).toContain("Mostrar a todo el equipo");
    expect(el.shadowRoot!.textContent).toContain(STAFFING_STRINGS.es["staffing.rota.leave"]);
  });
});

describe.each(["light", "dark"] as const)("the slot picker's busy people (%s)", (theme) => {
  it("draws a person working at that time or on leave muted on a sunken fill, still choosable; a free person is not", async () => {
    const el = await mount();
    frames[0]!.setAttribute("data-theme", theme);
    el.week = {
      ...el.week,
      shifts: [
        ...el.week.shifts,
        {
          ...el.week.shifts[0]!,
          shiftId: "joan-friday",
          personId: "joan",
          businessDay: "2026-12-04",
          startsAt: "2026-12-04T08:00:00Z",
          endsAt: "2026-12-04T12:00:00Z",
        },
      ],
    };
    await el.updateComplete;
    const token = (name: string, property: "color" | "background-color") => {
      const probe = document.createElement("span");
      probe.style.setProperty(property, `var(${name})`);
      frames[0]!.append(probe);
      return getComputedStyle(probe).getPropertyValue(property);
    };
    const person = (id: string) =>
      el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-person=${id}]`)!;
    const style = (id: string) => getComputedStyle(person(id));
    const nameColour = (id: string) => getComputedStyle(person(id).querySelector("strong")!).color;
    expect(person("joan").textContent).toContain("working");
    expect(person("laia").textContent).toContain("on leave");
    expect(person("marc").textContent).toContain("free");
    const muted = token("--wt-color-text-muted", "color");
    for (const id of ["joan", "laia"]) {
      expect(nameColour(id)).toBe(muted);
      expect(style(id).backgroundColor).toBe(token("--wt-color-bg", "background-color"));
      expect(person(id).disabled).toBe(false);
    }
    expect(nameColour("marc")).toBe(token("--wt-color-text", "color"));
    expect(style("marc").backgroundColor).toBe(token("--wt-color-surface", "background-color"));
    expect(style("marc").backgroundColor).not.toBe(style("joan").backgroundColor);
    const choose = vi.fn();
    el.addEventListener("choose", choose);
    person("joan").click();
    expect(choose.mock.calls[0]![0].detail).toEqual({ personId: "joan" });
  });
});

describe("the slot picker before and during a fill", () => {
  it("draws nothing until it has a week and a slot", async () => {
    const el = document.createElement("slot-picker") as Picker;
    document.body.append(el);
    frames.push(el);
    await el.updateComplete;
    expect(el.shadowRoot!.children).toHaveLength(0);
    el.week = rotaWeek();
    await el.updateComplete;
    expect(el.shadowRoot!.children).toHaveLength(0);
  });
  it("sends no choice for a press while a fill is in flight", async () => {
    const el = await mount();
    const choose = vi.fn();
    el.addEventListener("choose", choose);
    el.busy = true;
    await el.updateComplete;
    const marc = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-person=marc]")!;
    marc.disabled = false;
    marc.click();
    expect(choose).not.toHaveBeenCalled();
  });
});
