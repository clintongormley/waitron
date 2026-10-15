import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./split-guests-dialog.js";
import type { SplitGuestsDetail, TillSplitGuestsDialog } from "./split-guests-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mountDialog(
  props: Partial<TillSplitGuestsDialog> = {},
): Promise<TillSplitGuestsDialog> {
  const { el } = await mountWidget<TillSplitGuestsDialog>("till-split-guests-dialog", {
    stayingLabel: "Mesa 5",
    leavingLabel: "Mesa 4",
    staying: "5",
    ...props,
  });
  return el;
}

type Side = "staying" | "leaving";
const fieldName = { staying: "stayingGuests", leaving: "leavingGuests" } as const;
const fields = (el: TillSplitGuestsDialog) => [...el.shadowRoot!.querySelectorAll("wt-input")];
const field = (el: TillSplitGuestsDialog, side: Side) =>
  fields(el).find((f) => f.name === fieldName[side])!;
const nativeInput = (el: TillSplitGuestsDialog, side: Side) =>
  field(el, side).shadowRoot!.querySelector<HTMLInputElement>("input")!;
const confirm = (el: TillSplitGuestsDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-split-guests-confirm]")!;
const bottom = (el: TillSplitGuestsDialog) => el.shadowRoot!.querySelector("wt-form-actions")!;

async function type(el: TillSplitGuestsDialog, side: Side, value: string): Promise<void> {
  const input = nativeInput(el, side);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

function captured(el: TillSplitGuestsDialog) {
  const seen: { split: SplitGuestsDetail[]; cancelled: number } = { split: [], cancelled: 0 };
  el.addEventListener("split-guests-confirm", (event) =>
    seen.split.push((event as CustomEvent<SplitGuestsDetail>).detail),
  );
  el.addEventListener("split-guests-cancel", () => (seen.cancelled += 1));
  return seen;
}

describe("till-split-guests-dialog", () => {
  it.each([
    ["en", "Guests after the split", "Split"],
    ["es", "Comensales tras separar", "Separar"],
  ])("names its heading and its action in %s", async (locale, heading, action) => {
    const previousLocale = currentLocale();
    try {
      setLocale(locale);
      const el = await mountDialog();

      expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(heading);
      expect(confirm(el).textContent!.trim()).toBe(action);
    } finally {
      setLocale(previousLocale);
    }
  });

  it("labels each optional field with its tables, staying first, prefilled as given", async () => {
    const el = await mountDialog();

    expect(fields(el).map((f) => f.name)).toEqual(["stayingGuests", "leavingGuests"]);
    expect(nativeInput(el, "staying").name).toBe("stayingGuests");
    expect(nativeInput(el, "leaving").name).toBe("leavingGuests");
    expect(field(el, "staying").label).toBe("Mesa 5");
    expect(field(el, "leaving").label).toBe("Mesa 4");
    expect(field(el, "staying").required).toBe(false);
    expect(field(el, "leaving").required).toBe(false);
    expect(nativeInput(el, "staying").value).toBe("5");
    expect(nativeInput(el, "leaving").value).toBe("");
    expect(field(el, "staying").error).toBe("");
    expect(field(el, "leaving").error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it("puts the cursor in the staying field when it opens", async () => {
    const el = await mountDialog();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(field(el, "staying").shadowRoot!.activeElement).toBe(nativeInput(el, "staying"));
  });

  it("offers Split at once in its own colour, and splits with the prefilled values", async () => {
    const el = await mountDialog();
    const seen = captured(el);
    await confirm(el).updateComplete;

    expect(confirm(el).variant).toBe("primary");
    expect(confirm(el).disabled).toBe(false);
    confirm(el).click();

    expect(seen.split).toEqual([{ staying: 5, leaving: null }]);
  });

  it("sends both counts as numbers, and blanks as null", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    await type(el, "staying", " 3 ");
    await type(el, "leaving", "2");
    confirm(el).click();
    await type(el, "staying", "  ");
    confirm(el).click();

    expect(seen.split).toEqual([
      { staying: 3, leaving: 2 },
      { staying: null, leaving: 2 },
    ]);
  });

  for (const side of ["staying", "leaving"] as const) {
    const other: Side = side === "staying" ? "leaving" : "staying";
    it.each(["0", "1000", "2.5", "abc"])(
      `refuses %s in the ${side} field beside that field and at the bottom, disables Split, and works again once fixed`,
      async (bad) => {
        const el = await mountDialog();
        const seen = captured(el);

        await type(el, side, bad);
        confirm(el).click();
        await el.updateComplete;

        expect(seen.split).toEqual([]);
        expect(field(el, side).error).toBe(t("seat.guest_count_invalid"));
        expect(field(el, other).error).toBe("");
        expect(bottom(el).error).toBe(t("form.fix_fields"));
        expect(confirm(el).disabled).toBe(true);

        await type(el, side, "2");

        expect(field(el, side).error).toBe("");
        expect(bottom(el).error).toBe("");
        expect(confirm(el).disabled).toBe(false);
        confirm(el).click();
        expect(seen.split).toEqual([
          side === "staying" ? { staying: 2, leaving: null } : { staying: 5, leaving: 2 },
        ]);
      },
    );
  }

  it("marks both fields when both are bad", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    await type(el, "staying", "0");
    await type(el, "leaving", "x");
    confirm(el).click();
    await el.updateComplete;

    expect(seen.split).toEqual([]);
    expect(field(el, "staying").error).toBe(t("seat.guest_count_invalid"));
    expect(field(el, "leaving").error).toBe(t("seat.guest_count_invalid"));
  });

  it("refuses a bad count sent with Enter and dispatches nothing", async () => {
    const el = await mountDialog();
    const seen = captured(el);
    await type(el, "leaving", "0");

    nativeInput(el, "leaving").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(seen.split).toEqual([]);
    expect(field(el, "leaving").error).toBe(t("seat.guest_count_invalid"));
  });

  it("splits with Enter from either field", async () => {
    const el = await mountDialog();
    const seen = captured(el);
    await type(el, "leaving", "2");

    for (const side of ["staying", "leaving"] as const)
      nativeInput(el, side).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
      );

    expect(seen.split).toEqual([
      { staying: 5, leaving: 2 },
      { staying: 5, leaving: 2 },
    ]);
  });

  it("sends its events across the shadow boundary", async () => {
    const el = await mountDialog();
    const seen: string[] = [];
    const listen = (event: Event) => {
      if (event.bubbles && event.composed) seen.push(event.type);
    };
    document.addEventListener("split-guests-confirm", listen);
    document.addEventListener("split-guests-cancel", listen);
    try {
      confirm(el).click();
      el.shadowRoot!.querySelector<HTMLElement>("[data-split-guests-cancel]")!.click();
      await expect.poll(() => seen).toEqual(["split-guests-confirm", "split-guests-cancel"]);
    } finally {
      document.removeEventListener("split-guests-confirm", listen);
      document.removeEventListener("split-guests-cancel", listen);
    }
  });

  for (const side of ["staying", "leaving"] as const) {
    const other: Side = side === "staying" ? "leaving" : "staying";
    it(`shows a refusal of the ${side} count under that field, keeps Split enabled, and clears it once that field changes`, async () => {
      const el = await mountDialog({
        staying: "3",
        leaving: "1000",
        [`${side}Refusal`]: "Count refused",
      });
      const seen = captured(el);
      await confirm(el).updateComplete;

      expect(field(el, side).error).toBe("Count refused");
      expect(field(el, other).error).toBe("");
      expect(bottom(el).error).toBe(t("form.fix_fields"));
      expect(confirm(el).disabled).toBe(false);

      await type(el, other, other === "staying" ? "4" : "2");
      expect(field(el, side).error).toBe("Count refused");

      await type(el, side, "2");
      expect(field(el, side).error).toBe("");
      expect(bottom(el).error).toBe("");
      confirm(el).click();
      expect(seen.split).toHaveLength(1);
    });
  }

  it("clears a refusal when Split is pressed again", async () => {
    const el = await mountDialog({ staying: "3", leaving: "2", leavingRefusal: "Count refused" });
    const seen = captured(el);

    confirm(el).click();
    await el.updateComplete;

    expect(seen.split).toEqual([{ staying: 3, leaving: 2 }]);
    expect(field(el, "leaving").error).toBe("");
  });

  it("reports Cancel without counts", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-split-guests-cancel]")!.click();

    expect(seen).toEqual({ split: [], cancelled: 1 });
  });
});
