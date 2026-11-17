import { afterEach, expect, it, onTestFinished } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "./i18n/t.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { departmentForm, mountReceiptTab } from "./testing/department-receipt-app-fixture.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  history.replaceState(null, "", "/");
});

it.each([
  ["details", 390, "en-GB"],
  ["service", 390, "en-GB"],
  ["receipt", 390, "en-GB"],
  ["transfers", 390, "en-GB"],
  ["receipt", 1280, "en-GB"],
  ["service", 390, "es-ES"],
] as const)("keeps %s controls fixed at %ipx (%s)", async (tab, width, locale) => {
  const viewport = { width: innerWidth, height: innerHeight };
  onTestFinished(() => page.viewport(viewport.width, viewport.height));
  await page.viewport(width, 844);
  const { app, modal, editor } = await mountReceiptTab({
    locale,
    departments: [
      { id: "bar", name: "Bar" },
      { id: "dining", name: "Dining room" },
    ],
  });
  const form = departmentForm(app)!;
  const tabs = form.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  await userEvent.click(page.elementLocator(tabs.shadowRoot!.querySelector(`[data-key=${tab}]`)!));
  await expect.poll(() => form.tab).toBe(tab);
  await modal.updateComplete;
  const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
  const panel = form.shadowRoot!.querySelector<HTMLElement>(`[slot=${tab}]`)!;
  const filler = document.createElement("div");
  filler.style.height = "1800px";
  panel.append(filler);
  const heading = modal.shadowRoot!.querySelector("h2")!;
  const strip = tabs.shadowRoot!.querySelector(".tab-row")!;
  const actions = modal.querySelector("wt-form-actions[slot=footer]")!;
  expect(
    modal.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="footer"]')!.assignedElements(),
  ).toEqual([actions]);
  const controls = [...actions.querySelectorAll("wt-button")];
  expect(controls).toHaveLength(2);
  expect(editor.shadowRoot!.querySelectorAll("wt-form-actions")).toHaveLength(0);
  for (const control of controls) {
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector("button")!.getBoundingClientRect();
    expect(native.width).toBeGreaterThan(0);
    expect(native.height).toBeGreaterThan(0);
    expect(native.left).toBeGreaterThanOrEqual(0);
    expect(native.right).toBeLessThanOrEqual(width);
  }
  const before = [heading, strip, actions].map((el) => el.getBoundingClientRect().top);
  const contentBefore = filler.getBoundingClientRect().top;
  body.scrollTop = 400;
  expect(body.scrollTop).toBe(400);
  expect(filler.getBoundingClientRect().top).toBe(contentBefore - 400);
  expect([heading, strip, actions].map((el) => el.getBoundingClientRect().top)).toEqual(before);
  expect(heading.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    strip.getBoundingClientRect().top,
  );
  expect(actions.getBoundingClientRect().bottom).toBeLessThanOrEqual(844);
});
