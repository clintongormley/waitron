import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./seat-dialog.js";
import type { SeatConfirmDetail, TillSeatDialog } from "./seat-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mountDialog(): Promise<TillSeatDialog> {
  const { el } = await mountWidget<TillSeatDialog>("till-seat-dialog", { tableLabel: "4" });
  return el;
}

const field = (el: TillSeatDialog) => el.shadowRoot!.querySelector("wt-input")!;
const nativeInput = (el: TillSeatDialog) =>
  field(el).shadowRoot!.querySelector<HTMLInputElement>("input")!;
const seatButton = (el: TillSeatDialog) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]")!;

async function type(el: TillSeatDialog, value: string): Promise<void> {
  const input = nativeInput(el);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

function captureConfirm(el: TillSeatDialog): SeatConfirmDetail[] {
  const seen: SeatConfirmDetail[] = [];
  el.addEventListener("seat-confirm", (event) =>
    seen.push((event as CustomEvent<SeatConfirmDetail>).detail),
  );
  return seen;
}

describe("till-seat-dialog", () => {
  it("names the table in its heading and gives the guest count a semantic name", async () => {
    const el = await mountDialog();

    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.heading).toBe(t("seat.title").replace("{table}", "4"));
    expect(nativeInput(el).name).toBe("guestCount");
    expect(field(el).required).toBe(false);
  });

  it("seats with the whole number typed", async () => {
    const el = await mountDialog();
    const seen = captureConfirm(el);

    await type(el, "3");
    seatButton(el).click();

    expect(seen).toEqual([{ guestCount: 3 }]);
  });

  it("seats with no guest count when the field is left empty or blank", async () => {
    const el = await mountDialog();
    const seen = captureConfirm(el);

    seatButton(el).click();
    await type(el, "  ");
    seatButton(el).click();

    expect(seen).toEqual([{ guestCount: null }, { guestCount: null }]);
  });

  it.each(["0", "2.5", "-1", "tres", "1000", "3e1"])(
    "refuses %s beside the field and in a summary, keeping what was typed",
    async (value) => {
      const el = await mountDialog();
      const seen = captureConfirm(el);

      await type(el, value);
      seatButton(el).click();
      await el.updateComplete;

      expect(seen).toEqual([]);
      expect(field(el).error).toBe(t("seat.guest_count_invalid"));
      const summary = el.shadowRoot!.querySelector("wt-form-error-summary")!;
      expect(summary.errors).toEqual([t("seat.guest_count_invalid")]);
      expect(nativeInput(el).value).toBe(value);
    },
  );

  it("drops the refusal once a valid count is sent", async () => {
    const el = await mountDialog();
    const seen = captureConfirm(el);
    await type(el, "0");
    seatButton(el).click();
    await el.updateComplete;

    await type(el, "2");
    seatButton(el).click();
    await el.updateComplete;

    expect(seen).toEqual([{ guestCount: 2 }]);
    expect(field(el).error).toBe("");
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
  });

  it("seats on Enter in the field, through the same check", async () => {
    const el = await mountDialog();
    const seen = captureConfirm(el);
    await type(el, "5");

    nativeInput(el).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );

    expect(seen).toEqual([{ guestCount: 5 }]);
  });

  it("asks to cancel from its Cancel button and from the dialog closing", async () => {
    const el = await mountDialog();
    let cancels = 0;
    el.addEventListener("seat-cancel", () => cancels++);

    el.shadowRoot!.querySelector<HTMLElement>("[data-seat-cancel]")!.click();
    el.shadowRoot!.querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));

    expect(cancels).toBe(2);
  });

  it("emits composed, bubbling events so they reach the floor", async () => {
    const el = await mountDialog();
    let confirm: Event | undefined;
    el.addEventListener("seat-confirm", (event) => (confirm = event));

    seatButton(el).click();

    expect(confirm!.bubbles).toBe(true);
    expect(confirm!.composed).toBe(true);
  });
});
