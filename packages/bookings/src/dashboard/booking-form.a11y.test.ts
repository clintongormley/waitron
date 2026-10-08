import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import { BookingForm } from "./booking-form.js";

let locale: string;
beforeEach(() => {
  locale = currentLocale();
});
afterEach(() => {
  cleanup();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("booking Save accessibility (%s)", (theme) => {
  it.each([false, true])(
    "keeps unchanged and changed actions accessible (edit=%s)",
    async (edit) => {
      setLocale("en");
      const el = (await mountThemed(
        "<dashboard-booking-form></dashboard-booking-form>",
        theme,
      )) as BookingForm;
      el.open = true;
      el.defaultDate = "2026-10-09";
      if (edit)
        el.booking = {
          id: "booking",
          bookingDate: "2026-10-09",
          bookingTime: "20:30:00",
          partySize: 4,
          contactName: "García",
          contactPhone: "600100200",
          notes: "Ventana",
          tableId: null,
          tabId: null,
          status: "booked",
          createdBy: "manager",
          createdAt: "2026-10-08T10:00:00Z",
        };
      await el.updateComplete;
      await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector("[data-test=contact-name]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "Edited name" } }),
      );
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );
});
