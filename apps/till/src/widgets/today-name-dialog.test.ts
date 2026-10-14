import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, drawn, measured, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./today-name-dialog.js";
import type { TodayNameDetail, TillTodayNameDialog } from "./today-name-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mountDialog(props: Partial<TillTodayNameDialog> = {}): Promise<TillTodayNameDialog> {
  const { el } = await mountWidget<TillTodayNameDialog>("till-today-name-dialog", {
    heading: "Rename Counter 4",
    normalName: "Counter 4",
    ...props,
  });
  return el;
}

const field = (el: TillTodayNameDialog) => el.shadowRoot!.querySelector("wt-input")!;
const nativeInput = (el: TillTodayNameDialog) =>
  field(el).shadowRoot!.querySelector<HTMLInputElement>("input")!;
const save = (el: TillTodayNameDialog) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-rename-save]")!;
const cancelButton = (el: TillTodayNameDialog) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-rename-cancel]")!;
const bottom = (el: TillTodayNameDialog) => el.shadowRoot!.querySelector("wt-form-actions")!;

async function type(el: TillTodayNameDialog, value: string): Promise<void> {
  const input = nativeInput(el);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

function captured(el: TillTodayNameDialog) {
  const seen: { named: TodayNameDetail[]; cancelled: number } = { named: [], cancelled: 0 };
  el.addEventListener("today-name-confirm", (event) =>
    seen.named.push((event as CustomEvent<TodayNameDetail>).detail),
  );
  el.addEventListener("today-name-cancel", () => (seen.cancelled += 1));
  return seen;
}

describe("till-today-name-dialog", () => {
  it("shows the heading it is given, and one optional field todayName, capped at 40, showing the normal name as its placeholder", async () => {
    const el = await mountDialog({ normalName: "Bar+Window" });

    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Rename Counter 4");
    expect(nativeInput(el).name).toBe("todayName");
    expect(nativeInput(el).maxLength).toBe(40);
    expect(field(el).required).toBe(false);
    expect(field(el).label).toBe("Name");
    expect(field(el).placeholder).toBe("Bar+Window");
    expect(field(el).hint).toBe("");
    expect(save(el).textContent!.trim()).toBe("Save");
    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it.each(["en", "es"])(
    "shows the name the table or group goes back to when left empty as the field's placeholder, in %s",
    async (locale) => {
      const previousLocale = currentLocale();
      try {
        setLocale(locale);
        const el = await mountDialog({ normalName: "Bar+Window", value: "" });

        expect(field(el).placeholder).toBe("Bar+Window");
        expect(field(el).hint).toBe("");
        expect(nativeInput(el).placeholder).toBe("Bar+Window");
      } finally {
        setLocale(previousLocale);
      }
    },
  );

  describe("a placeholder wider than the field", () => {
    const longGroup = [
      "Olive tree",
      "Fountain side",
      "Sun corner",
      "Pergola",
      "Garden gate",
      "Window seat",
      "Vine arbour",
      "Lemon grove",
    ].join("+");

    function expectOnScreen(el: TillTodayNameDialog, width: number): void {
      const dialog = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector("dialog")!;
      const body = dialog.querySelector<HTMLElement>(".body")!;
      expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
      expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    }

    it("shortens a long group name to whole table names and +… that fit at 390 px, with the cursor in the field", async () => {
      await page.viewport(390, 900);
      try {
        const el = await mountDialog({ normalName: longGroup, value: "" });

        await vi.waitFor(() => expect(nativeInput(el).placeholder).toMatch(/[^+]\+…$/));
        const { placeholder, width, textBox } = drawn(el);
        expect(width(longGroup)).toBeGreaterThan(textBox);
        expect(longGroup.startsWith(placeholder.slice(0, -"…".length))).toBe(true);
        expect(width(placeholder)).toBeLessThanOrEqual(textBox);
        expect(field(el).shadowRoot!.activeElement).toBe(nativeInput(el));
        expectOnScreen(el, 390);
      } finally {
        await page.viewport(1280, 900);
      }
    });

    it("shortens a new, longer normal name read while the window is open", async () => {
      await page.viewport(390, 900);
      try {
        const el = await mountDialog({ normalName: "Bar+Window", value: "" });
        await measured();
        expect(nativeInput(el).placeholder).toBe("Bar+Window");

        el.normalName = longGroup;
        await el.updateComplete;

        expect(nativeInput(el).placeholder).toMatch(/^Olive tree\+.*[^+]\+…$/);
        const { placeholder, width, textBox } = drawn(el);
        expect(width(placeholder)).toBeLessThanOrEqual(textBox);
      } finally {
        await page.viewport(1280, 900);
      }
    });
  });

  it("puts the cursor in the name field when it opens", async () => {
    const el = await mountDialog({ value: "García birthday" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(field(el).shadowRoot!.activeElement).toBe(nativeInput(el));
  });

  it("starts from today's name, and sends the trimmed name", async () => {
    const el = await mountDialog({ value: "García birthday" });
    const seen = captured(el);
    expect(nativeInput(el).value).toBe("García birthday");

    await type(el, "  Window ");
    save(el).click();

    expect(seen.named).toEqual([{ name: "Window" }]);
  });

  it("sends null for an emptied or blank field, which goes back to the normal name", async () => {
    const el = await mountDialog({ value: "García birthday" });
    const seen = captured(el);

    await type(el, "");
    save(el).click();
    await type(el, "Bo");
    save(el).click();
    await type(el, "   ");
    save(el).click();

    expect(seen.named).toEqual([{ name: null }, { name: "Bo" }, { name: null }]);
  });

  it("refuses a 41-character name beside the field and in the form's line without sending it, and works again once fixed", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    await type(el, "x".repeat(41));
    save(el).click();
    await el.updateComplete;

    expect(seen.named).toEqual([]);
    expect(field(el).error).toBe("Use at most 40 characters");
    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(save(el).disabled).toBe(true);

    await type(el, "x".repeat(40));

    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
    expect(save(el).disabled).toBe(false);
    save(el).click();
    expect(seen.named).toEqual([{ name: "x".repeat(40) }]);
  });

  it("shows a name-in-use refusal beside the field, keeping Save available, until the field changes", async () => {
    const el = await mountDialog({ value: "" });
    await type(el, "Bar");
    el.refusal = { code: "table.label_taken", field: "name" };
    await el.updateComplete;

    expect(field(el).error).toBe("Another table already has that name");
    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(save(el).disabled).toBe(false);

    await type(el, "Bar 2");

    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it("shows the server's too-long refusal for the name as the 40-character rule", async () => {
    const el = await mountDialog({
      value: "Ana",
      refusal: { code: "management.request_invalid", field: "name" },
    });

    expect(field(el).error).toBe("Use at most 40 characters");
    expect(bottom(el).error).toBe(t("form.fix_fields"));
  });

  it("shows a refusal that names no field in the form's line, not under the field", async () => {
    const el = await mountDialog({ value: "Ana", refusal: { code: "table.taken_off" } });

    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("That table is off today's plan. Put it back first");
  });

  it("saves with Enter from the field", async () => {
    const el = await mountDialog();
    const seen = captured(el);
    await type(el, "Ana");

    nativeInput(el).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );

    expect(seen.named).toEqual([{ name: "Ana" }]);
  });

  it("while busy, disables Save, Cancel and the field, and a press sends nothing", async () => {
    const el = await mountDialog();
    const seen = captured(el);
    await type(el, "Ana");
    el.busy = true;
    await el.updateComplete;

    expect(save(el).disabled).toBe(true);
    expect(cancelButton(el).disabled).toBe(true);
    expect(field(el).disabled).toBe(true);
    save(el).click();
    cancelButton(el).click();
    await el.updateComplete;
    expect(seen).toEqual({ named: [], cancelled: 0 });

    el.busy = false;
    await el.updateComplete;
    expect(save(el).disabled).toBe(false);
  });

  it("reports Cancel without a name", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    cancelButton(el).click();
    await expect.poll(() => seen.cancelled).toBe(1);
    expect(seen.named).toEqual([]);
  });

  it("speaks Spanish", async () => {
    setLocale("es-ES");
    const el = await mountDialog({ heading: "Cambiar el nombre de Mesa 4", normalName: "Mesa 4" });

    expect(field(el).label).toBe("Nombre");
    expect(field(el).placeholder).toBe("Mesa 4");
    expect(field(el).hint).toBe("");
    expect(save(el).textContent!.trim()).toBe("Guardar");
    expect(cancelButton(el).textContent!.trim()).toBe("Cancelar");
  });

  it.each([1280, 390])(
    "at %ipx gives its field the form width, or most of a narrower screen, and fits the screen",
    async (width) => {
      await page.viewport(width, 900);
      try {
        const el = await mountDialog({ normalName: "3+5+7" });
        const native = el
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector("dialog")!;
        const body = native.querySelector<HTMLElement>(".body")!;
        // A body wider than its box scrolls sideways and takes the dialog's first focus.
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
        expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        const fields = el.shadowRoot!.querySelector<HTMLElement>(".fields")!;
        const probe = document.createElement("div");
        probe.style.width = "var(--wt-form-max-width)";
        fields.append(probe);
        const formWidth = probe.getBoundingClientRect().width;
        probe.remove();
        const fieldsWidth = fields.getBoundingClientRect().width;
        if (width === 1280) expect(fieldsWidth).toBeCloseTo(formWidth, 0);
        else expect(fieldsWidth).toBeGreaterThanOrEqual(300);
      } finally {
        await page.viewport(1280, 900);
      }
    },
  );
});
