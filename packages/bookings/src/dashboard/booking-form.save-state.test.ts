import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { BookingForm } from "./booking-form.js";
import type { Booking } from "./client.js";

afterEach(cleanupWidgets);

const booking: Booking = {
  id: "booking",
  bookingDate: "2026-10-09",
  bookingTime: "20:30:00",
  partySize: 4,
  contactName: "García",
  contactPhone: "600100200",
  notes: "Ventana",
  tableId: null,
  tableLabel: null,
  tabId: null,
  status: "booked",
  createdBy: "manager",
  createdAt: "2026-10-08T10:00:00Z",
};

async function change(el: BookingForm, value: string) {
  el.shadowRoot!.querySelector('[data-test="contact-name"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

async function buttonState(el: BookingForm, disabled: boolean, variant: string) {
  const button = el.shadowRoot!.querySelector("wt-button")!;
  await button.updateComplete;
  expect(button.disabled).toBe(disabled);
  expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(disabled);
  expect(button.variant).toBe(variant);
}

describe("booking Save follows its draft", () => {
  it.each([booking, null])(
    "opens quiet, enables on edit and quiets on undo (%s)",
    async (value) => {
      const { el } = await mountWidget<BookingForm>("dashboard-booking-form", {
        open: true,
        booking: value,
        defaultDate: "2026-10-09",
      });
      await buttonState(el, true, "secondary");
      await change(el, "García editada");
      await buttonState(el, false, "primary");
      await change(el, value?.contactName ?? "");
      await buttonState(el, true, "secondary");
    },
  );

  it("sends no update or validation message on an untouched host press", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", {
      open: true,
      booking,
    });
    const updates = vi.fn();
    el.addEventListener("update-booking", updates);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(updates).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("keeps a changed busy form primary and disables it, then allows retry", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", {
      open: true,
      booking,
    });
    await change(el, "García editada");
    el.busy = true;
    await el.updateComplete;
    await buttonState(el, true, "primary");
    el.busy = false;
    await el.updateComplete;
    await buttonState(el, false, "primary");
  });

  it("retains an edit made after submission and starts quiet when reopened", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", {
      open: true,
      booking,
    });
    await change(el, "Submitted");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    const completion = el.writeCompletion();
    await change(el, "Newer edit");
    expect(completion.succeeded()).toBe(false);
    await el.updateComplete;
    await buttonState(el, false, "primary");
    await change(el, "Submitted");
    await buttonState(el, true, "secondary");
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    await buttonState(el, true, "secondary");
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    const closed = new Promise((resolve) =>
      dialog.addEventListener("wt-close", resolve, { once: true }),
    );
    dialog.requestClose("cancel");
    await closed;
    await expect.poll(() => el.open).toBe(false);
  });
});
