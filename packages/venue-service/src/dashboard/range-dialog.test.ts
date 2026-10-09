import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { RangeDialog } from "./range-dialog.js";
import "./range-dialog.js";

const hosts: HTMLElement[] = [];
const periods = [
  { id: "lunch", name: "Lunch" },
  { id: "dinner", name: "Dinner" },
];
beforeEach(() => setLocale("en"));
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
});
async function mount(edit = false) {
  const el = document.createElement("range-dialog");
  el.range = { startsAt: "09:00", endsAt: "10:00", periodId: edit ? "lunch" : "" };
  el.periods = periods;
  el.deletable = edit;
  el.open = true;
  applyTokens(el);
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  return el;
}
function field(el: RangeDialog, name: string) {
  const control = el.shadowRoot!.querySelector<
    HTMLElement &
      Pick<HTMLElementTagNameMap["wt-input"], "value" | "required" | "error" | "updateComplete"> &
      Pick<HTMLElementTagNameMap["wt-combobox"], "options">
  >(`[name="${name}"]`);
  expect(control, `range field ${name}`).not.toBeNull();
  return control!;
}
function save(el: RangeDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-range]",
  )!;
}
async function change(el: RangeDialog, name: string, value: string) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function writes(el: RangeDialog) {
  const results: unknown[] = [];
  el.addEventListener("range-save", (event) => results.push((event as CustomEvent).detail));
  return results;
}
it("opens with quarter-hour native time fields, an unchosen period and quiet Save", async () => {
  const el = await mount();
  for (const name of ["startsAt", "endsAt"]) {
    const control = field(el, name);
    await control.updateComplete;
    expect(control.required).toBe(true);
    expect(control.shadowRoot!.querySelector<HTMLInputElement>("input")!.step).toBe("900");
  }
  expect(field(el, "startsAt").value).toBe("09:00");
  expect(field(el, "endsAt").value).toBe("10:00");
  expect(field(el, "periodId").value).toBe("");
  expect(field(el, "periodId").options).toEqual([
    { value: "lunch", label: "Lunch" },
    { value: "dinner", label: "Dinner" },
    { value: "new", label: "New period…", action: true },
  ]);
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  const results = writes(el);
  save(el).dispatchEvent(new MouseEvent("click"));
  expect(results).toEqual([]);
});
it("stages the chosen period and edited times once through native Save", async () => {
  const el = await mount();
  const results = writes(el);
  await change(el, "periodId", "dinner");
  await change(el, "endsAt", "11:15");
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  await save(el).updateComplete;
  await userEvent.click(save(el).shadowRoot!.querySelector("button")!);
  expect(results).toEqual([{ input: { startsAt: "09:00", endsAt: "11:15", periodId: "dinner" } }]);
  expect(el.open).toBe(false);
});
it.each([
  ["", "10:00", "Enter a start time.", ""],
  ["09:00", "", "", "Enter an end time."],
  ["09:07", "10:01", "Choose a time in 15-minute steps.", "Choose a time in 15-minute steps."],
  ["25:00", "10:00", "Enter a valid time.", ""],
  ["10:00", "09:00", "", "Choose an end after the start within this business day."],
  ["09:00", "09:00", "", "Choose an end after the start within this business day."],
])(
  "rejects %s–%s beside each invalid field and keeps retry blocked until corrected",
  async (start, end, startError, endError) => {
    const el = await mount(true);
    const results = writes(el);
    await change(el, "startsAt", start);
    await change(el, "endsAt", end);
    save(el).click();
    await el.updateComplete;
    expect(results).toEqual([]);
    expect(el.open).toBe(true);
    expect(field(el, "startsAt").error).toBe(startError);
    expect(field(el, "endsAt").error).toBe(endError);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe("Correct the highlighted fields to continue.");
    expect(save(el).disabled).toBe(true);
    expect(results).toEqual([]);
    await change(el, "startsAt", "09:15");
    await change(el, "endsAt", "10:15");
    expect(save(el).disabled).toBe(false);
    expect(field(el, "endsAt").error).toBe("");
  },
);
it.each([
  ["21:00", "03:00"],
  ["06:00", "06:00"],
  ["03:00", "06:00"],
])(
  "accepts the business-day range %s–%s including its exclusive changeover end",
  async (start, end) => {
    const el = await mount();
    const results = writes(el);
    await change(el, "startsAt", start);
    await change(el, "endsAt", end);
    await change(el, "periodId", "lunch");
    save(el).click();
    expect(results).toEqual([{ input: { startsAt: start, endsAt: end, periodId: "lunch" } }]);
  },
);
it("requires a current department period and clears its error after a valid choice", async () => {
  const el = await mount();
  const results = writes(el);
  await change(el, "endsAt", "11:00");
  save(el).click();
  await el.updateComplete;
  expect(field(el, "periodId").error).toBe("Choose a period.");
  expect(save(el).disabled).toBe(true);
  await change(el, "periodId", "foreign");
  expect(save(el).disabled).toBe(true);
  await change(el, "periodId", "lunch");
  expect(field(el, "periodId").error).toBe("");
  save(el).click();
  expect(results).toHaveLength(1);
});
it("refuses manual overlap with neighbouring ranges but allows touching endpoints", async () => {
  const el = await mount(true);
  const results = writes(el);
  el.occupied = [{ startsAt: "10:00", endsAt: "11:00", periodId: "dinner" }];
  await change(el, "endsAt", "10:15");
  save(el).click();
  await el.updateComplete;
  expect(results).toEqual([]);
  expect(el.open).toBe(true);
  expect(field(el, "endsAt").error).toBe("This time overlaps another one on the same day.");
  expect(results).toEqual([]);
  await change(el, "startsAt", "08:45");
  await change(el, "endsAt", "10:00");
  save(el).click();
  expect(results).toEqual([{ input: { startsAt: "08:45", endsAt: "10:00", periodId: "lunch" } }]);
});
it("returns from New period with the same times and stages the newly selected period", async () => {
  const el = await mount();
  const events: unknown[] = [];
  const results = writes(el);
  el.addEventListener("range-new-period", (event) => events.push((event as CustomEvent).detail));
  await change(el, "startsAt", "08:45");
  field(el, "periodId").dispatchEvent(
    new CustomEvent("wt-combobox-action", {
      detail: { value: "new" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(events).toEqual([{ input: { startsAt: "08:45", endsAt: "10:00", periodId: "" } }]);
  expect(el.open).toBe(true);
  el.periods = [...periods, { id: "coffee", name: "Coffee" }];
  await el.updateComplete;
  el.choosePeriod("coffee");
  await el.updateComplete;
  expect(field(el, "startsAt").value).toBe("08:45");
  expect(field(el, "periodId").value).toBe("coffee");
  save(el).click();
  expect(results).toEqual([{ input: { startsAt: "08:45", endsAt: "10:00", periodId: "coffee" } }]);
});
it("offers Delete only for an existing block and stages that deletion without saving edits", async () => {
  const el = await mount(true);
  const deleted: unknown[] = [];
  const results = writes(el);
  el.addEventListener("range-delete", (event) => deleted.push((event as CustomEvent).detail));
  await change(el, "endsAt", "11:00");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-range]")!.click();
  expect(deleted).toEqual([{}]);
  expect(results).toEqual([]);
  expect(el.open).toBe(false);
  const newRange = await mount();
  expect(newRange.shadowRoot!.querySelector("[data-test=delete-range]")).toBeNull();
});
it("busy and departed controls cannot save, delete or start a new period", async () => {
  const el = await mount(true);
  const results = writes(el);
  const actions: string[] = [];
  el.addEventListener("range-delete", () => actions.push("delete"));
  el.addEventListener("range-new-period", () => actions.push("new"));
  await change(el, "endsAt", "11:00");
  const oldSave = save(el);
  const oldDelete = el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-range]")!;
  const oldChoice = field(el, "periodId");
  el.busy = true;
  await el.updateComplete;
  oldSave.click();
  oldDelete.click();
  oldChoice.dispatchEvent(new CustomEvent("wt-combobox-action", { detail: { value: "new" } }));
  expect(results).toEqual([]);
  expect(actions).toEqual([]);
  el.busy = false;
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  oldSave.click();
  oldDelete.click();
  oldChoice.dispatchEvent(new CustomEvent("wt-combobox-action", { detail: { value: "new" } }));
  expect(results).toEqual([]);
  expect(actions).toEqual([]);
  expect(field(el, "endsAt").value).toBe("10:00");
});

it("submits native Enter once and keeps an unchanged edit quiet", async () => {
  const el = await mount(true);
  const results = writes(el);
  await field(el, "endsAt").updateComplete;
  const input = field(el, "endsAt").shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  expect(results).toEqual([]);
  await change(el, "endsAt", "11:00");
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  expect(results).toEqual([{ input: { startsAt: "09:00", endsAt: "11:00", periodId: "lunch" } }]);
});
it("keeps an edited range when the parent refreshes its suggested range", async () => {
  const el = await mount(true);
  await change(el, "endsAt", "11:00");
  el.range = { startsAt: "12:00", endsAt: "13:00", periodId: "dinner" };
  await el.updateComplete;
  expect(field(el, "startsAt").value).toBe("09:00");
  expect(field(el, "endsAt").value).toBe("11:00");
});
it("uses an arbitrary changeover for ordering and still requires clock quarter-hours", async () => {
  const el = await mount();
  const results = writes(el);
  el.dayCutover = "06:07";
  await change(el, "startsAt", "06:15");
  await change(el, "endsAt", "06:00");
  await change(el, "periodId", "lunch");
  save(el).click();
  expect(results).toEqual([{ input: { startsAt: "06:15", endsAt: "06:00", periodId: "lunch" } }]);
  const invalid = await mount();
  invalid.dayCutover = "06:07";
  await change(invalid, "startsAt", "06:15");
  await change(invalid, "endsAt", "06:07");
  await change(invalid, "periodId", "lunch");
  save(invalid).click();
  await invalid.updateComplete;
  expect(field(invalid, "endsAt").error).toBe("Choose a time in 15-minute steps.");
});
it("shows Spanish field and bottom messages after an invalid submission", async () => {
  setLocale("es");
  const el = await mount();
  await change(el, "endsAt", "11:07");
  save(el).click();
  await el.updateComplete;
  expect(field(el, "endsAt").error).toBe("Elige una hora en intervalos de 15 minutos.");
  expect(field(el, "periodId").error).toBe("Elige un periodo.");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Corrige los campos marcados para continuar.");
});

it("refuses a valid unchanged edit even when its host receives a programmatic click", async () => {
  const el = await mount(true);
  const results = writes(el);
  save(el).dispatchEvent(new MouseEvent("click"));
  expect(results).toEqual([]);
  expect(el.open).toBe(true);
});

it("Cancel closes a standalone dialog without staging its edited range", async () => {
  const el = await mount(true);
  const results = writes(el);
  await change(el, "endsAt", "11:00");
  const cancel = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[slot=cancel]")!;
  await cancel.updateComplete;
  await userEvent.click(cancel.shadowRoot!.querySelector("button")!);
  await expect.poll(() => el.open).toBe(false);
  expect(results).toEqual([]);
});

it("ignores a new-period command it does not own and a period outside its department", async () => {
  const el = await mount(true);
  const commands: unknown[] = [];
  el.addEventListener("range-new-period", (event) => commands.push((event as CustomEvent).detail));
  field(el, "periodId").dispatchEvent(
    new CustomEvent("wt-combobox-action", { detail: { value: "unknown" } }),
  );
  el.choosePeriod("foreign");
  await el.updateComplete;
  expect(commands).toEqual([]);
  expect(field(el, "periodId").value).toBe("lunch");
  expect(save(el).disabled).toBe(true);
});

it("retained fields and Cancel cannot change or close the next opening", async () => {
  const el = await mount(true);
  const oldInput = field(el, "endsAt");
  const oldCancel = el.shadowRoot!.querySelector<HTMLElement>("[slot=cancel]")!;
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  oldInput.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "12:00" } }));
  oldCancel.dispatchEvent(new MouseEvent("click"));
  await el.updateComplete;
  expect(el.open).toBe(true);
  expect(field(el, "endsAt").value).toBe("10:00");
  expect(save(el).disabled).toBe(true);
});

it("closedTimes edits a range with no period choice or period id in its output", async () => {
  const el = await mount(true);
  Object.assign(el, { closedTimes: true, range: { startsAt: "09:00", endsAt: "10:00" } });
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[name=periodId]")).toBeNull();
  const results = writes(el);
  await change(el, "endsAt", "11:00");
  save(el).click();
  expect(results).toEqual([{ input: { startsAt: "09:00", endsAt: "11:00" } }]);
});
