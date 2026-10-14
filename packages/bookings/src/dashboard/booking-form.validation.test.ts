import { afterEach, describe, expect, it } from "vitest";
import { currentLocale, setLocale, codeMessage } from "@waitron/dashboard-kit";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { BookingForm } from "./booking-form.js";

const initialLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(initialLocale);
});

async function change(el: BookingForm, id: string, value: string) {
  el.shadowRoot!.querySelector(`[data-test=${id}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

const field = (el: BookingForm, id: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[data-test=${id}]`)!;
const bottom = (el: BookingForm) =>
  el.shadowRoot!.querySelector("[data-test=error]")?.textContent?.trim() ?? "";

async function save(el: BookingForm) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await el.updateComplete;
}

async function expectDisabled(el: BookingForm, disabled: boolean) {
  const button = el.shadowRoot!.querySelector("wt-button")!;
  await button.updateComplete;
  expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(disabled);
}

async function mount() {
  return (
    await mountWidget<BookingForm>("dashboard-booking-form", {
      open: true,
      defaultDate: "2026-10-14",
      tables: [
        { id: "table", label: "1", zoneId: "zone", planTableId: null, createdAt: "2026-10-14" },
      ],
    })
  ).el;
}

async function validExceptName(el: BookingForm) {
  await change(el, "booking-time", "20:00");
  await change(el, "party-size", "4");
}

describe.each([
  [
    "en",
    "Correct the highlighted fields to continue.",
    "Enter a date",
    "Enter a time",
    "Enter a name",
  ],
  [
    "es",
    "Corrige los campos marcados para continuar.",
    "Introduce una fecha",
    "Introduce una hora",
    "Introduce un nombre",
  ],
] as const)(
  "booking field validation (%s)",
  (locale, sentence, dateError, timeError, nameError) => {
    it("shows one bottom sentence when blank Name meets a Table refusal", async () => {
      setLocale(locale);
      const el = await mount();
      await validExceptName(el);
      el.tableRefusal = "table.in_joined_table";
      await el.updateComplete;
      const phone = field(el, "contact-phone");
      await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
      await phone.updateComplete;
      phone.focus();
      expect(el.shadowRoot!.activeElement).toBe(phone);
      await save(el);
      await expect.poll(() => el.shadowRoot!.activeElement).toBe(field(el, "contact-name"));
      expect(bottom(el)).toBe(sentence);
      expect(field(el, "contact-name").error).toBe(nameError);
      expect(el.shadowRoot!.querySelector("wt-combobox")!.error).toBe(
        codeMessage("table.in_joined_table"),
      );
      await expectDisabled(el, true);
      await change(el, "contact-name", "García");
      expect(field(el, "contact-name").error).toBe("");
      expect(bottom(el)).toBe(sentence);
      await expectDisabled(el, false);
      await chooseOption(el.shadowRoot!.querySelector("wt-combobox")!, "table");
      await el.updateComplete;
      expect(bottom(el)).toBe("");
    });

    it("marks every bad field after Save, focuses the first and keeps checking until corrected", async () => {
      setLocale(locale);
      const el = await mount();
      const ids = ["booking-date", "booking-time", "party-size", "contact-name"];
      for (const id of ids) {
        expect(field(el, id).required).toBe(true);
        expect(field(el, id).error).toBe("");
      }
      expect(bottom(el)).toBe("");
      await change(el, "booking-date", "");
      const phone = field(el, "contact-phone");
      await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
      await phone.updateComplete;
      phone.focus();
      expect(el.shadowRoot!.activeElement).toBe(phone);
      await save(el);
      expect(field(el, "booking-date").error).toBe(dateError);
      expect(field(el, "booking-time").error).toBe(timeError);
      expect(field(el, "party-size").error).toBe(codeMessage("booking.party_invalid"));
      expect(field(el, "contact-name").error).toBe(nameError);
      await expect.poll(() => el.shadowRoot!.activeElement).toBe(field(el, "booking-date"));
      expect(bottom(el)).toBe(sentence);
      await expectDisabled(el, true);
      await change(el, "contact-phone", "600100200");
      expect(field(el, "contact-name").error).toBe(nameError);
      await change(el, "booking-date", "2026-10-14");
      expect(field(el, "booking-date").error).toBe("");
      expect(field(el, "booking-time").error).toBe(timeError);
      await validExceptName(el);
      await expectDisabled(el, true);
      await change(el, "contact-name", "García");
      expect(bottom(el)).toBe("");
      await expectDisabled(el, false);
      await change(el, "party-size", "0");
      expect(field(el, "party-size").error).toBe(codeMessage("booking.party_invalid"));
      await expectDisabled(el, true);
      el.open = false;
      await el.updateComplete;
      el.open = true;
      await el.updateComplete;
      expect(bottom(el)).toBe("");
      for (const id of ids) expect(field(el, id).error).toBe("");
      await expectDisabled(el, true);
    });
  },
);
