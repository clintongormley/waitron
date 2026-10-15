import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { LitElement } from "lit";
import { rotaWeek } from "../testing/rota-fixture.js";
import type { RotaWeek } from "../staffing-types.js";
import type { Slot } from "../slots.js";
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
  it("shows the same chooser in Spanish", async () => {
    setLocale("es");
    const el = await mount();
    expect(el.shadowRoot!.textContent).toContain("Mostrar a todo el mundo");
    expect(el.shadowRoot!.textContent).toContain("de permiso");
  });
});
