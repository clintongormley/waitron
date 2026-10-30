import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./bill-name-dialog.js";
import type { BillNameDetail, TillBillNameDialog } from "./bill-name-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mountDialog(props: Partial<TillBillNameDialog> = {}): Promise<TillBillNameDialog> {
  const { el } = await mountWidget<TillBillNameDialog>("till-bill-name-dialog", {
    bill: "Ana · Bill 2",
    ...props,
  });
  return el;
}

const field = (el: TillBillNameDialog) => el.shadowRoot!.querySelector("wt-input")!;
const nativeInput = (el: TillBillNameDialog) =>
  field(el).shadowRoot!.querySelector<HTMLInputElement>("input")!;
const save = (el: TillBillNameDialog) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-name-save]")!;
const bottom = (el: TillBillNameDialog) => el.shadowRoot!.querySelector("wt-form-actions")!;
const heading = (el: TillBillNameDialog) => el.shadowRoot!.querySelector("wt-dialog")!.heading;

async function type(el: TillBillNameDialog, value: string): Promise<void> {
  const input = nativeInput(el);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

function captured(el: TillBillNameDialog) {
  const seen: { named: BillNameDetail[]; cancelled: number } = { named: [], cancelled: 0 };
  el.addEventListener("bill-name-confirm", (event) =>
    seen.named.push((event as CustomEvent<BillNameDetail>).detail),
  );
  el.addEventListener("bill-name-cancel", () => (seen.cancelled += 1));
  return seen;
}

describe("A803 bill name draft", () => {
  it.each([
    { width: 390, locale: "en", theme: "light" as const },
    { width: 1280, locale: "es", theme: "light" as const },
    { width: 390, locale: "es", theme: "dark" as const },
    { width: 1280, locale: "en", theme: "dark" as const },
  ])(
    "gives the name field room at $width px in $locale, $theme, without scrolling sideways",
    async ({ width, locale, theme }) => {
      const previousLocale = currentLocale();
      await page.viewport(width, 900);
      try {
        setLocale(locale);
        const { el } = await mountWidget<TillBillNameDialog>(
          "till-bill-name-dialog",
          { bill: "Ana · Bill 2 · Desserts" },
          theme,
        );
        const dialog = el
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector("dialog")!;
        const body = dialog.querySelector<HTMLElement>(".body")!;
        expect(window.innerWidth).toBe(width);
        expect(nativeInput(el).getBoundingClientRect().width).toBeGreaterThanOrEqual(
          width === 390 ? 300 : 560,
        );
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
        expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      } finally {
        setLocale(previousLocale);
        await page.viewport(1280, 900);
      }
    },
  );

  it("names the bill in its heading, and its one optional field billName, capped at 40, with no placeholder", async () => {
    const el = await mountDialog();

    expect(heading(el)).toBe("Name this bill: Ana · Bill 2");
    expect(nativeInput(el).name).toBe("billName");
    expect(nativeInput(el).maxLength).toBe(40);
    expect(nativeInput(el).placeholder).toBe("");
    expect(field(el).label).toBe(t("table.name_label"));
    expect(field(el).required).toBe(false);
    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it("names the bill in Spanish too", async () => {
    const previousLocale = currentLocale();
    try {
      setLocale("es");
      const el = await mountDialog({ bill: "Ana · Cuenta 2" });

      expect(heading(el)).toBe(t("table.bill_name_title").replace("{bill}", "Ana · Cuenta 2"));
      expect(heading(el)).not.toBe(`Name this bill: Ana · Cuenta 2`);
      expect(save(el).textContent!.trim()).toBe(t("table.name_save"));
    } finally {
      setLocale(previousLocale);
    }
  });

  it("follows a new bill heading", async () => {
    const el = await mountDialog();

    el.bill = "Ana · Bill 3";
    await el.updateComplete;

    expect(heading(el)).toBe("Name this bill: Ana · Bill 3");
  });

  it("puts the cursor in the name field when it opens", async () => {
    const el = await mountDialog({ value: "Desserts" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(field(el).shadowRoot!.activeElement).toBe(nativeInput(el));
  });

  it("starts from the bill's name, and sends the trimmed name", async () => {
    const el = await mountDialog({ value: "Desserts" });
    const seen = captured(el);
    expect(nativeInput(el).value).toBe("Desserts");

    await type(el, "  Clint ");
    save(el).click();

    expect(seen.named).toEqual([{ name: "Clint" }]);
  });

  it("sends null for an empty or blank name, which clears it", async () => {
    const el = await mountDialog({ value: "Desserts" });
    const seen = captured(el);

    await type(el, "");
    save(el).click();
    await type(el, "Bo");
    save(el).click();
    await type(el, "   ");
    save(el).click();

    expect(seen.named).toEqual([{ name: null }, { name: "Bo" }, { name: null }]);
  });

  it("sends markup typed into the field as the text it is", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    await type(el, "<b>Ana</b>");
    save(el).click();

    expect(seen.named).toEqual([{ name: "<b>Ana</b>" }]);
    expect(nativeInput(el).value).toBe("<b>Ana</b>");
  });

  it("shows a bill name holding markup in the heading as text", async () => {
    const el = await mountDialog({ bill: "Ana · Bill 2 · <b>x</b>" });

    expect(heading(el)).toBe("Name this bill: Ana · Bill 2 · <b>x</b>");
    const shown = el.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!;
    expect(shown.querySelector("b")).toBeNull();
  });

  it("refuses a 41-character name beside the field without sending it, and works again once fixed", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    await type(el, "x".repeat(41));
    save(el).click();
    await el.updateComplete;

    expect(seen.named).toEqual([]);
    expect(field(el).error).toBe(t("table.name_too_long"));
    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(save(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();

    await type(el, "x".repeat(40));

    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
    expect(save(el).disabled).toBe(false);
    save(el).click();
    expect(seen.named).toEqual([{ name: "x".repeat(40) }]);
  });

  it("shows the server's refusal beside the field, keeping what was typed and Save available, until the field changes", async () => {
    const el = await mountDialog({
      value: "Desserts",
      savedValue: "Mains",
      refusal: t("table.name_too_long"),
    });

    expect(nativeInput(el).value).toBe("Desserts");
    expect(field(el).error).toBe(t("table.name_too_long"));
    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(save(el).disabled).toBe(false);

    await type(el, "Desserts 2");

    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it("clears a server refusal when Save is pressed again", async () => {
    const el = await mountDialog({
      value: "Desserts",
      savedValue: "Mains",
      refusal: t("table.name_too_long"),
    });
    const seen = captured(el);

    save(el).click();
    await el.updateComplete;

    expect(seen.named).toEqual([{ name: "Desserts" }]);
    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it("saves with Enter from the field", async () => {
    const el = await mountDialog();
    const seen = captured(el);
    await type(el, "Desserts");

    nativeInput(el).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );

    expect(seen.named).toEqual([{ name: "Desserts" }]);
  });

  it("reports Cancel without a name", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!.click();

    expect(seen).toEqual({ named: [], cancelled: 1 });
  });

  it("dispatches its events past the shadow boundary", async () => {
    const el = await mountDialog({ value: "Desserts" });
    const outer: string[] = [];
    const record = (event: Event) => {
      if (event.bubbles && event.composed) outer.push(event.type);
    };
    document.addEventListener("bill-name-confirm", record);
    document.addEventListener("bill-name-cancel", record);
    try {
      await type(el, "Mains");
      save(el).click();
      el.shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!.click();
    } finally {
      document.removeEventListener("bill-name-confirm", record);
      document.removeEventListener("bill-name-cancel", record);
    }

    expect(outer).toEqual(["bill-name-confirm", "bill-name-cancel"]);
  });
});
