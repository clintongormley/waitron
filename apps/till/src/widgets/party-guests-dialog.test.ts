import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./party-guests-dialog.js";
import type { PartyGuestsDetail, TillPartyGuestsDialog } from "./party-guests-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mountDialog(
  props: Partial<TillPartyGuestsDialog> = {},
): Promise<TillPartyGuestsDialog> {
  const { el } = await mountWidget<TillPartyGuestsDialog>("till-party-guests-dialog", {
    tables: "Mesa 4, 5",
    ...props,
  });
  return el;
}

const field = (el: TillPartyGuestsDialog) => el.shadowRoot!.querySelector("wt-input")!;
const nativeInput = (el: TillPartyGuestsDialog) =>
  field(el).shadowRoot!.querySelector<HTMLInputElement>("input")!;
const save = (el: TillPartyGuestsDialog) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-guests-save]")!;
const bottom = (el: TillPartyGuestsDialog) => el.shadowRoot!.querySelector("wt-form-actions")!;

async function type(el: TillPartyGuestsDialog, value: string): Promise<void> {
  const input = nativeInput(el);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

function captured(el: TillPartyGuestsDialog) {
  const seen: { counted: PartyGuestsDetail[]; cancelled: number } = { counted: [], cancelled: 0 };
  el.addEventListener("party-guests-confirm", (event) =>
    seen.counted.push((event as CustomEvent<PartyGuestsDetail>).detail),
  );
  el.addEventListener("party-guests-cancel", () => (seen.cancelled += 1));
  return seen;
}

describe("till-party-guests-dialog", () => {
  it.each([
    ["en", "Guests at Mesa 4, 5", "Guests", "Save"],
    ["es", "Comensales en Mesa 4, 5", "Comensales", "Guardar"],
  ])(
    "names the tables in its heading, and its one optional field guestCount, in %s",
    async (locale, heading, label, saveLabel) => {
      const previousLocale = currentLocale();
      try {
        setLocale(locale);
        const el = await mountDialog();

        expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(heading);
        expect(nativeInput(el).name).toBe("guestCount");
        expect(field(el).label).toBe(label);
        expect(field(el).required).toBe(false);
        expect(field(el).error).toBe("");
        expect(bottom(el).error).toBe("");
        expect(save(el).textContent!.trim()).toBe(saveLabel);
      } finally {
        setLocale(previousLocale);
      }
    },
  );

  it("names its Guests action in the order screen's menu", () => {
    setLocale("en");
    expect(t("table.action_guests")).toBe("Guests");
    setLocale("es");
    expect(t("table.action_guests")).toBe("Comensales");
  });

  it("puts the cursor in the guests field when it opens", async () => {
    const el = await mountDialog({ value: "2" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(field(el).shadowRoot!.activeElement).toBe(nativeInput(el));
  });

  it("starts from the party's count, and sends the new count as a number", async () => {
    const el = await mountDialog({ value: "2", savedValue: "2" });
    const seen = captured(el);
    expect(nativeInput(el).value).toBe("2");

    await type(el, " 4 ");
    save(el).click();

    expect(seen.counted).toEqual([{ guestCount: 4 }]);
  });

  it("sends null for a blank field, which clears the count", async () => {
    const el = await mountDialog({ value: "2", savedValue: "2" });
    const seen = captured(el);

    await type(el, "  ");
    save(el).click();

    expect(seen.counted).toEqual([{ guestCount: null }]);
  });

  it("opens empty on a party with no count", async () => {
    const el = await mountDialog();
    expect(nativeInput(el).value).toBe("");
  });

  it.each(["0", "1000", "2.5", "abc"])(
    "refuses %s beside the field and at the bottom without sending it, and works again once fixed",
    async (bad) => {
      const el = await mountDialog({ value: "2", savedValue: "2" });
      const seen = captured(el);

      await type(el, bad);
      save(el).click();
      await el.updateComplete;

      expect(seen.counted).toEqual([]);
      expect(field(el).error).toBe(t("seat.guest_count_invalid"));
      expect(bottom(el).error).toBe(t("form.fix_fields"));
      expect(save(el).disabled).toBe(true);

      await type(el, "999");

      expect(field(el).error).toBe("");
      expect(bottom(el).error).toBe("");
      expect(save(el).disabled).toBe(false);
      save(el).click();
      expect(seen.counted).toEqual([{ guestCount: 999 }]);
    },
  );

  it("refuses a bad count sent with Enter and dispatches nothing", async () => {
    const el = await mountDialog({ value: "2", savedValue: "2" });
    const seen = captured(el);
    await type(el, "0");

    nativeInput(el).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(seen.counted).toEqual([]);
    expect(field(el).error).toBe(t("seat.guest_count_invalid"));
  });

  it("shows the server's refusal beside the field, keeping Save available, until the field changes", async () => {
    const el = await mountDialog({
      value: "4",
      savedValue: "2",
      refusal: t("seat.guest_count_invalid"),
    });

    expect(field(el).error).toBe(t("seat.guest_count_invalid"));
    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(save(el).disabled).toBe(false);

    await type(el, "5");

    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it("saves with Enter from the field", async () => {
    const el = await mountDialog();
    const seen = captured(el);
    await type(el, "3");

    nativeInput(el).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );

    expect(seen.counted).toEqual([{ guestCount: 3 }]);
  });

  it("sends its events across the shadow boundary", async () => {
    const el = await mountDialog();
    const seen: string[] = [];
    const listen = (event: Event) => {
      if (event.bubbles && event.composed) seen.push(event.type);
    };
    document.addEventListener("party-guests-confirm", listen);
    document.addEventListener("party-guests-cancel", listen);
    try {
      await type(el, "3");
      save(el).click();
      el.shadowRoot!.querySelector<HTMLElement>("[data-guests-cancel]")!.click();
      await expect.poll(() => seen).toEqual(["party-guests-confirm", "party-guests-cancel"]);
    } finally {
      document.removeEventListener("party-guests-confirm", listen);
      document.removeEventListener("party-guests-cancel", listen);
    }
  });

  it("reports Cancel without a count", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-guests-cancel]")!.click();

    expect(seen).toEqual({ counted: [], cancelled: 1 });
  });
});
