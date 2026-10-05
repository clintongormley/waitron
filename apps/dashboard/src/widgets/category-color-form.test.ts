import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { CategoryColorForm } from "./category-color-form.js";
import "./category-color-form.js";

afterEach(cleanupWidgets);

async function colorForm(props: Partial<CategoryColorForm> = {}) {
  const { el } = await mountWidget<CategoryColorForm>("dashboard-category-color-form", {
    open: true,
    heading: "Colour of Drinks",
    color: "#b12525",
    ...props,
  });
  return el;
}
const modal = (el: CategoryColorForm) => el.shadowRoot!.querySelector("wt-modal")!;
const bottomOf = (el: CategoryColorForm) =>
  el.shadowRoot!.querySelector('[data-test="form-error"]')!.textContent!.trim();
const swatch = (el: CategoryColorForm, color: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-color="${color}"]`)!;
const colorError = (el: CategoryColorForm) =>
  el.shadowRoot!.querySelector("#category-color-error")!.textContent!.trim();
const customInput = (el: CategoryColorForm) =>
  el.shadowRoot!.querySelector<HTMLInputElement>('input[type="color"]')!;
function listen(el: CategoryColorForm) {
  const sent: unknown[] = [];
  el.addEventListener("wt-choose", (event) => sent.push((event as CustomEvent).detail));
  el.addEventListener("wt-cancel", () => sent.push("cancel"));
  return sent;
}

it("is a compact modal with the heading it is given, the colour chosen, and no Save", async () => {
  const el = await colorForm();
  expect(modal(el).getAttribute("size")).toBe("compact");
  expect(modal(el).heading).toBe("Colour of Drinks");
  expect(swatch(el, "#b12525").getAttribute("aria-checked")).toBe("true");
  expect(customInput(el).getAttribute("name")).toBe("category-color");
  expect(swatch(el, "").querySelector("#category-color-none-label")!.textContent!.trim()).toBe(
    t("editor.color_none"),
  );
  expect(el.shadowRoot!.querySelector('[data-test="save"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="cancel"]')!.textContent!.trim()).toBe(
    t("action.cancel"),
  );
});

it("sends a palette colour, or none, as soon as it is chosen", async () => {
  const el = await colorForm();
  const sent = listen(el);
  const outside = vi.fn();
  document.addEventListener("wt-choose", outside);
  try {
    swatch(el, "#256bb1").click();
    swatch(el, "").click();
  } finally {
    document.removeEventListener("wt-choose", outside);
  }
  expect(sent).toEqual([{ color: "#256bb1" }, { color: null }]);
  expect(outside).toHaveBeenCalledTimes(2);
});

it("sends a custom colour once the picker settles on it, not while it is picked", async () => {
  const el = await colorForm({ color: null });
  const sent = listen(el);
  const input = customInput(el);
  input.value = "#123456";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(sent).toEqual([]);
  input.value = "#654321";
  input.dispatchEvent(new Event("change", { bubbles: true }));
  expect(sent).toEqual([{ color: "#654321" }]);
});

it("sends a cancel, and no colour, on Cancel and on Esc", async () => {
  const el = await colorForm();
  const sent = listen(el);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  expect(sent).toEqual(["cancel"]);
  swatch(el, "#256bb1").focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(sent).toEqual(["cancel", "cancel"]));
});

it("sends nothing, and cannot be dismissed, while a colour is saving", async () => {
  const el = await colorForm({ busy: true });
  const sent = listen(el);
  expect(el.shadowRoot!.querySelector<HTMLElement>(".fields")!.inert).toBe(true);
  swatch(el, "#256bb1").click();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  modal(el).shadowRoot!.querySelector<HTMLElement>(".body")!.focus();
  await userEvent.keyboard("{Escape}");
  for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
  expect(sent).toEqual([]);
  expect(modal(el).shadowRoot!.querySelector("dialog")!.open).toBe(true);
});

it("shows a refused colour under the chooser, focused, and anything else at the end of the body", async () => {
  const el = await colorForm({ errors: { color: t("editor.field_rejected") } });
  expect(colorError(el)).toBe(t("editor.field_rejected"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.activeElement?.getAttribute("name")).toBe("category-color"),
  );
  expect(bottomOf(el)).toBe(t("form.fix_fields"));
  el.errors = { _form: codeMessage("server.internal") };
  await el.updateComplete;
  expect(colorError(el)).toBe("");
  const bottom = el.shadowRoot!.querySelector('[data-test="form-error"]')!;
  expect(bottom.textContent!.trim()).toBe(codeMessage("server.internal"));
  expect(bottom.closest('[slot="footer"]')).toBeNull();
  const fields = el.shadowRoot!.querySelector(".fields")!;
  expect(fields.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("keeps showing the colour that was chosen while it saves and once it is refused", async () => {
  const el = await colorForm();
  swatch(el, "#256bb1").click();
  el.busy = true;
  await el.updateComplete;
  expect(swatch(el, "#256bb1").getAttribute("aria-checked")).toBe("true");
  el.busy = false;
  el.errors = { color: t("editor.field_rejected") };
  await el.updateComplete;
  expect(swatch(el, "#256bb1").getAttribute("aria-checked")).toBe("true");
  expect(swatch(el, "#b12525").getAttribute("aria-checked")).toBe("false");
});

it("opens again holding the colour it is given", async () => {
  const el = await colorForm();
  el.open = false;
  await el.updateComplete;
  el.heading = "Colour of Food";
  el.color = null;
  el.open = true;
  await el.updateComplete;
  expect(modal(el).heading).toBe("Colour of Food");
  expect(swatch(el, "").getAttribute("aria-checked")).toBe("true");
});
