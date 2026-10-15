import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillOrderKitchenNote } from "./order-kitchen-note.js";
import "./order-kitchen-note.js";

const previous = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(previous);
});
const button = (el: TillOrderKitchenNote, name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-${name}]`)!;
async function mount(props: Partial<TillOrderKitchenNote> = {}) {
  return (
    await mountWidget<TillOrderKitchenNote>("till-order-kitchen-note", {
      scopeKey: "order:a",
      note: null,
      revision: 7,
      ...props,
    })
  ).el;
}
async function open(el: TillOrderKitchenNote) {
  await userEvent.click(page.elementLocator(button(el, "edit")));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
}
async function fill(el: TillOrderKitchenNote, text: string) {
  const field = el.shadowRoot!.querySelector("wt-textarea")!;
  await field.updateComplete;
  const native = field.shadowRoot!.querySelector("textarea")!;
  await userEvent.fill(page.elementLocator(native), text);
  await el.updateComplete;
}

it.each([
  ["en", "+ Note for the kitchen"],
  ["es", "+ Nota para cocina"],
])("offers an optional whole-order note in %s", async (locale, prompt) => {
  setLocale(locale);
  const el = await mount();
  expect(button(el, "edit").textContent).toContain(prompt);
  await open(el);
  expect(el.shadowRoot!.querySelector("wt-textarea")!.name).toBe("kitchenNote");
  expect(button(el, "save").disabled).toBe(true);
  expect(button(el, "save").variant).toBe("secondary");
});

it("sends a trimmed note with the opening scope/revision, keeps the editor until success and restores focus", async () => {
  const el = await mount();
  const sent: unknown[] = [];
  el.addEventListener("save-kitchen-note", (event) => sent.push((event as CustomEvent).detail));
  await open(el);
  await fill(el, "  All together, train at 14:30  ");
  expect(button(el, "save").disabled).toBe(false);
  expect(button(el, "save").variant).toBe("primary");
  await userEvent.click(page.elementLocator(button(el, "save")));
  expect(sent).toEqual([
    { scopeKey: "order:a", revision: 7, visit: 0, note: "All together, train at 14:30" },
  ]);
  expect(el.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
  el.note = "All together, train at 14:30";
  el.revision = 8;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  expect(button(el, "edit").textContent).toContain("For the kitchen: All together, train at 14:30");
  expect(el.shadowRoot!.activeElement).toBe(button(el, "edit"));
});

it("stages Clear in the editor and sends null only when saved", async () => {
  const el = await mount({ note: "All together" });
  const sent: unknown[] = [];
  el.addEventListener("save-kitchen-note", (event) => sent.push((event as CustomEvent).detail));
  await open(el);
  await userEvent.click(page.elementLocator(button(el, "clear")));
  expect(el.note).toBe("All together");
  expect(sent).toEqual([]);
  expect(button(el, "save").disabled).toBe(false);
  await userEvent.click(page.elementLocator(button(el, "save")));
  expect(sent).toEqual([{ scopeKey: "order:a", revision: 7, visit: 0, note: null }]);
});

it("shows an overlong value beside the field and above the buttons, then recovers on edit", async () => {
  const el = await mount();
  await open(el);
  // A programmatic value exercises validation even when native maxlength prevents ordinary typing.
  const field = el.shadowRoot!.querySelector("wt-textarea")!;
  field.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "n".repeat(2001) },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  await userEvent.click(page.elementLocator(button(el, "save")));
  await el.updateComplete;
  expect(field.error).toContain("2,000");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    "Correct the highlighted fields to continue.",
  );
  expect(button(el, "save").disabled).toBe(true);
  await fill(el, "Short note");
  expect(field.error).toBe("");
  expect(button(el, "save").disabled).toBe(false);
});

it("retains a refused draft and allows the same value to be retried", async () => {
  const el = await mount();
  const sent: unknown[] = [];
  el.addEventListener("save-kitchen-note", (event) => sent.push((event as CustomEvent).detail));
  await open(el);
  await fill(el, "Serve together");
  await userEvent.click(page.elementLocator(button(el, "save")));
  el.busy = true;
  await el.updateComplete;
  el.busy = false;
  el.refusal = "Could not save. Try again.";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toContain("Try again");
  expect(button(el, "save").disabled).toBe(false);
  await userEvent.click(page.elementLocator(button(el, "save")));
  expect(sent).toHaveLength(2);
});

it.each(["scope", "visit"])("closes an old editor when its %s changes", async (what) => {
  const el = await mount();
  await open(el);
  await fill(el, "Do not send to another order");
  if (what === "scope") el.scopeKey = "party:b";
  else el.visit = 1;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  await open(el);
  expect(el.shadowRoot!.querySelector("wt-textarea")!.value).toBe("");
});

it("uses a newer stored value as baseline without replacing the draft being typed", async () => {
  const el = await mount({ note: "Original" });
  await open(el);
  await fill(el, "My draft");
  el.note = "Other till";
  el.revision = 8;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-textarea")!.value).toBe("My draft");
  expect(button(el, "save").disabled).toBe(false);
  const sent: unknown[] = [];
  el.addEventListener("save-kitchen-note", (event) => sent.push((event as CustomEvent).detail));
  await userEvent.click(page.elementLocator(button(el, "save")));
  expect(sent).toEqual([{ scopeKey: "order:a", revision: 8, visit: 0, note: "My draft" }]);
});
