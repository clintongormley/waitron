import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { HourPeriod } from "../hours-types.js";
import {
  cellChecks,
  cellText,
  type CellDraft,
  type HoursCellEditor,
  weekChecks,
} from "./hours-cell-editor.js";
import "./hours-cell-editor.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

const period = (id: string, opensAt: string, closesAt: string): HourPeriod => ({
  id,
  opensAt,
  closesAt,
});

async function mount(props: Partial<HoursCellEditor>): Promise<{
  el: HoursCellEditor;
  changes: CellDraft[];
}> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("hours-cell-editor");
  Object.assign(el, { label: "Monday", fieldPrefix: "monday", ...props });
  const changes: CellDraft[] = [];
  el.addEventListener("hours-cell-change", (event) => {
    const cell = (event as CustomEvent<{ cell: CellDraft }>).detail.cell;
    changes.push(cell);
    el.cell = cell;
  });
  host.append(el);
  await el.updateComplete;
  return { el, changes };
}

const field = <T extends HTMLElement = HTMLElement & { value: string; error: string }>(
  el: HoursCellEditor,
  name: string,
) => el.shadowRoot!.querySelector<T>(`[name="${name}"]`);

async function type(el: HoursCellEditor, name: string, value: string): Promise<void> {
  const input = field(el, name)!;
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

describe("hours-cell-editor", () => {
  it("offers Closed, Open all day and periods for a standard week day, never 'not set'", async () => {
    const { el } = await mount({
      modes: ["closed", "all_day", "periods"],
      cell: { mode: "closed", periods: [] },
    });
    const mode = field<HTMLElement & { options: { value: string; label: string }[] }>(
      el,
      "monday.mode",
    )!;
    expect(mode.options.map((option) => [option.value, option.label])).toEqual([
      ["closed", "Closed"],
      ["all_day", "Open all day"],
      ["periods", "Opening periods"],
    ]);
    expect(el.shadowRoot!.querySelector("legend")!.textContent).toBe("Monday");
  });

  it("offers a blank choice that keeps the standard hours, shown in grey, on a special date", async () => {
    const { el, changes } = await mount({
      modes: ["inherit", "closed", "all_day", "periods"],
      inherited: "12:00–16:00",
      cell: { mode: "inherit", periods: [] },
    });
    const mode = field<
      HTMLElement & {
        options: { value: string; label: string }[];
        value: string;
        placeholder: string;
      }
    >(el, "monday.mode")!;
    expect(mode.options.map((option) => [option.value, option.label])).toEqual([
      ["", "Standard hours (12:00–16:00)"],
      ["closed", "Closed"],
      ["all_day", "Open all day"],
      ["periods", "Opening periods"],
    ]);
    expect(mode.value).toBe("");
    expect(mode.placeholder).toBe("Standard hours (12:00–16:00)");
    await chooseOption(mode, "closed");
    expect(changes.at(-1)).toEqual({ mode: "closed", periods: [] });
    await chooseOption(mode, "");
    expect(changes.at(-1)).toEqual({ mode: "inherit", periods: [] });
  });

  it("starts one empty period, adds and removes several, and keeps each period's id", async () => {
    const { el, changes } = await mount({
      modes: ["closed", "all_day", "periods"],
      cell: { mode: "closed", periods: [] },
    });
    await chooseOption(field(el, "monday.mode")!, "periods");
    expect(changes.at(-1)!.mode).toBe("periods");
    expect(changes.at(-1)!.periods).toHaveLength(1);
    const first = changes.at(-1)!.periods[0]!.id;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    await type(el, "monday.periods.0.opensAt", "12:00");
    await type(el, "monday.periods.0.closesAt", "16:00");
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-period"]')!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-period"]')!.click();
    await el.updateComplete;
    expect(el.cell.periods).toHaveLength(3);
    await type(el, "monday.periods.1.opensAt", "18:00");
    await type(el, "monday.periods.1.closesAt", "20:00");
    await type(el, "monday.periods.2.opensAt", "21:00");
    await type(el, "monday.periods.2.closesAt", "23:00");
    const ids = el.cell.periods.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(first);
    const remove = el.shadowRoot!.querySelectorAll<HTMLElement>('[data-test="remove-period"]');
    expect(remove[1]!.getAttribute("aria-label")).toBe("Remove period 2");
    remove[1]!.click();
    await el.updateComplete;
    expect(el.cell.periods).toEqual([
      period(ids[0]!, "12:00", "16:00"),
      period(ids[2]!, "21:00", "23:00"),
    ]);
    expect(field(el, "monday.periods.1.opensAt")!.value).toBe("21:00");
  });

  it("keeps the last period: its Remove is disabled", async () => {
    const { el } = await mount({
      modes: ["closed", "all_day", "periods"],
      cell: { mode: "periods", periods: [period("p1", "12:00", "16:00")] },
    });
    const remove = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      '[data-test="remove-period"]',
    )!;
    expect(remove.disabled).toBe(true);
  });

  it("keeps entered periods while another choice is made, and brings them back", async () => {
    const { el } = await mount({
      modes: ["closed", "all_day", "periods"],
      cell: { mode: "periods", periods: [period("p1", "12:00", "16:00")] },
    });
    await chooseOption(field(el, "monday.mode")!, "all_day");
    expect(field(el, "monday.periods.0.opensAt")).toBeNull();
    await chooseOption(field(el, "monday.mode")!, "periods");
    expect(el.cell.periods).toEqual([period("p1", "12:00", "16:00")]);
  });

  it("shows each field's message and locks every control when disabled", async () => {
    const { el } = await mount({
      modes: ["closed", "all_day", "periods"],
      cell: { mode: "periods", periods: [period("p1", "12:00", "")] },
      errors: {
        "monday.mode": "These hours overlap Sunday's hours past midnight.",
        "monday.periods.0.closesAt": "Enter a time.",
      },
    });
    expect(field(el, "monday.mode")!.error).toBe(
      "These hours overlap Sunday's hours past midnight.",
    );
    expect(field(el, "monday.periods.0.closesAt")!.error).toBe("Enter a time.");
    expect(field(el, "monday.periods.0.opensAt")!.error).toBe("");
    el.disabled = true;
    await el.updateComplete;
    for (const control of el.shadowRoot!.querySelectorAll<HTMLElement & { disabled: boolean }>(
      "wt-combobox, wt-input, wt-button",
    ))
      expect(control.disabled, control.outerHTML).toBe(true);
  });

  it("says the hours in Spanish", async () => {
    setLocale("es");
    const { el } = await mount({
      label: "Lunes",
      modes: ["inherit", "closed", "all_day", "periods"],
      inherited: "Cerrado",
      cell: { mode: "periods", periods: [period("p1", "12:00", "16:00")] },
    });
    const mode = field<HTMLElement & { options: { label: string }[]; label: string }>(
      el,
      "monday.mode",
    )!;
    expect(mode.options.map((option) => option.label)).toEqual([
      "Horario habitual (Cerrado)",
      "Cerrado",
      "Abierto todo el día",
      "Periodos de apertura",
    ]);
    expect(field<HTMLElement & { label: string }>(el, "monday.periods.0.opensAt")!.label).toBe(
      "Abre",
    );
    expect(el.shadowRoot!.querySelector('[data-test="add-period"]')!.textContent!.trim()).toBe(
      "Añadir un periodo",
    );
  });
});

describe("cellText", () => {
  it("names every kind of cell", () => {
    expect(cellText({ mode: "closed", periods: [] })).toBe("Closed");
    expect(cellText({ mode: "all_day", periods: [] })).toBe("Open all day");
    expect(
      cellText({
        mode: "periods",
        periods: [period("a", "12:00", "16:00"), period("b", "20:00", "01:00")],
      }),
    ).toBe("12:00–16:00, 20:00–01:00");
    setLocale("es");
    expect(cellText({ mode: "closed", periods: [] })).toBe("Cerrado");
  });
});

describe("cellChecks", () => {
  it("marks every missing, equal and overlapping time, each under its own field", () => {
    expect(
      cellChecks("monday", {
        mode: "periods",
        periods: [
          period("a", "", "16:00"),
          period("b", "18:00", ""),
          period("c", "19:00", "19:00"),
          period("d", "12:00", "14:00"),
          period("e", "13:00", "15:00"),
        ],
      }),
    ).toEqual({
      "monday.periods.0.opensAt": "Enter a time.",
      "monday.periods.1.closesAt": "Enter a time.",
      "monday.periods.2.closesAt": "Choose a closing time different from the opening time.",
      "monday.periods.4.opensAt": "This period overlaps another one on the same day.",
    });
  });

  it("finds nothing wrong with periods past midnight, Closed or all day", () => {
    expect(
      cellChecks("monday", {
        mode: "periods",
        periods: [period("a", "12:00", "16:00"), period("b", "20:00", "02:00")],
      }),
    ).toEqual({});
    expect(cellChecks("monday", { mode: "closed", periods: [period("a", "", "")] })).toEqual({});
  });
});

describe("weekChecks", () => {
  const closed: CellDraft = { mode: "closed", periods: [] };
  it("marks the later day when the earlier day's hours run into it, Saturday into Sunday too", () => {
    const week: CellDraft[] = Array.from({ length: 7 }, () => closed);
    week[1] = { mode: "periods", periods: [period("a", "20:00", "03:00")] };
    week[2] = { mode: "periods", periods: [period("b", "02:00", "05:00")] };
    week[6] = { mode: "periods", periods: [period("c", "22:00", "01:00")] };
    week[0] = { mode: "all_day", periods: [] };
    expect(weekChecks(week, (weekday) => `day-${weekday}`)).toEqual({
      "day-2.mode": "These hours overlap Monday's hours past midnight.",
      "day-0.mode": "These hours overlap Saturday's hours past midnight.",
    });
  });

  it("puts a clash on the one day being edited, whichever side of midnight it is on", () => {
    const week: CellDraft[] = Array.from({ length: 7 }, () => closed);
    week[0] = { mode: "periods", periods: [period("z", "01:00", "03:00")] };
    week[6] = { mode: "periods", periods: [period("c", "22:00", "02:00")] };
    week[5] = { mode: "periods", periods: [period("f", "20:00", "23:00")] };
    expect(weekChecks(week, () => "cell", 6)).toEqual({
      "cell.mode": "These hours run past midnight into Sunday's hours.",
    });
    expect(weekChecks(week, () => "cell", 0)).toEqual({
      "cell.mode": "These hours overlap Saturday's hours past midnight.",
    });
    expect(weekChecks(week, () => "cell", 5)).toEqual({});
  });
});
