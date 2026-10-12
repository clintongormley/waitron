import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./today-seats-dialog.js";
import type { TillTodaySeatsDialog, TodaySeatsDetail } from "./today-seats-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(props: Partial<TillTodaySeatsDialog>): Promise<TillTodaySeatsDialog> {
  const { el } = await mountWidget<TillTodaySeatsDialog>("till-today-seats-dialog", {
    heading: "Seats for 4+5",
    ...props,
  });
  return el;
}
const field = (el: TillTodaySeatsDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!;
const nativeInput = (el: TillTodaySeatsDialog) =>
  field(el).shadowRoot!.querySelector<HTMLInputElement>("input")!;
const action = (el: TillTodaySeatsDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-seats-action]")!;
const bottom = (el: TillTodaySeatsDialog) => el.shadowRoot!.querySelector("wt-form-actions")!;
async function type(el: TillTodaySeatsDialog, value: string): Promise<void> {
  const input = nativeInput(el);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}
function captured(el: TillTodaySeatsDialog) {
  const seen: { confirmed: TodaySeatsDetail[]; cancelled: number } = {
    confirmed: [],
    cancelled: 0,
  };
  el.addEventListener("today-seats-confirm", (event) =>
    seen.confirmed.push((event as CustomEvent<TodaySeatsDetail>).detail),
  );
  el.addEventListener("today-seats-cancel", () => (seen.cancelled += 1));
  return seen;
}

it("opens empty for a merge and sends the number typed", async () => {
  const el = await mount({ seats: null, action: "join" });
  const seen = captured(el);
  expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Seats for 4+5");
  expect(nativeInput(el).value).toBe("");
  expect(nativeInput(el).name).toBe("seats");
  expect(field(el).required).toBe(true);
  expect(field(el).label).toBe("Seats");
  expect(action(el).textContent!.trim()).toBe("Join");

  await type(el, "8");
  action(el).click();

  expect(seen.confirmed).toEqual([{ seats: 8 }]);
});

it("puts the cursor in the seats field when it opens", async () => {
  const el = await mount({ seats: null, action: "join" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(field(el).shadowRoot!.activeElement).toBe(nativeInput(el));
});

it("refuses a number outside 1 to 999 beside the field and below the form", async () => {
  const el = await mount({ seats: 6 });
  const seen = captured(el);
  expect(action(el).textContent!.trim()).toBe("Save");

  for (const refused of ["0", "1000"]) {
    await type(el, refused);
    action(el).click();
    await el.updateComplete;

    expect(seen.confirmed).toEqual([]);
    expect(field(el).error).toBe("Enter 1 to 999");
    expect(bottom(el).error).toBe("Correct the highlighted fields to continue.");
    expect(action(el).disabled).toBe(true);
  }

  await type(el, "999");
  expect(field(el).error).toBe("");
  expect(bottom(el).error).toBe("");
  expect(action(el).disabled).toBe(false);
  action(el).click();
  expect(seen.confirmed).toEqual([{ seats: 999 }]);
});

for (const typed of ["2.5", "1e2"]) {
  it(`refuses ${typed} typed key by key`, async () => {
    const el = await mount({ seats: 6 });
    const seen = captured(el);
    await type(el, "");
    nativeInput(el).focus();
    await userEvent.keyboard(typed);
    await el.updateComplete;
    expect(nativeInput(el).value).toBe(typed);

    action(el).click();
    await el.updateComplete;

    expect(seen.confirmed).toEqual([]);
    expect(field(el).error).toBe("Enter 1 to 999");
    expect(bottom(el).error).toBe("Correct the highlighted fields to continue.");
  });
}

it("a leading zero typed in front of the opened number is not a change", async () => {
  const el = await mount({ seats: 6 });
  await type(el, "06");
  expect(action(el).disabled).toBe(true);
});

it("explains nothing before the first press", async () => {
  const el = await mount({ seats: 6 });
  await type(el, "0");
  expect(field(el).error).toBe("");
  expect(bottom(el).error).toBe("");
});

it("confirms with Enter from the field", async () => {
  const el = await mount({ seats: 6 });
  const seen = captured(el);
  await type(el, "7");
  nativeInput(el).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  expect(seen.confirmed).toEqual([{ seats: 7 }]);
});

it("Cancel asks to close", async () => {
  const el = await mount({ seats: null, action: "join" });
  const seen = captured(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-seats-cancel]")!.click();
  await expect.poll(() => seen.cancelled).toBe(1);
  expect(seen.confirmed).toEqual([]);
});

it("speaks Spanish", async () => {
  setLocale("es-ES");
  const el = await mount({ seats: null, action: "join" });
  expect(field(el).label).toBe("Plazas");
  expect(field(el).decreaseLabel("Plazas")).toBe("Reducir Plazas");
  expect(field(el).increaseLabel("Plazas")).toBe("Aumentar Plazas");
  expect(action(el).textContent!.trim()).toBe("Unir");
  expect(el.shadowRoot!.querySelector("[data-seats-cancel]")!.textContent!.trim()).toBe("Cancelar");
  await type(el, "0");
  action(el).click();
  await el.updateComplete;
  expect(field(el).error).toBe("Escribe de 1 a 999");
});

it("names Save in Spanish", async () => {
  setLocale("es-ES");
  const el = await mount({ seats: 8 });
  expect(action(el).textContent!.trim()).toBe("Guardar");
});
