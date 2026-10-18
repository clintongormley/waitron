import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import {
  cleanupDepartmentEditors,
  mountDepartmentEditor,
  selectDepartmentTab,
} from "../testing/department-edit-fixture.js";
import { cleanupZoneEditors, mountZoneEditor } from "../testing/zone-edit-fixture.js";

afterEach(() => {
  cleanupDepartmentEditors();
  cleanupZoneEditors();
  setLocale("en");
});
function inside(element: Element, bounds: DOMRect) {
  const rect = element.getBoundingClientRect();
  expect(rect.width, "the control is visible").toBeGreaterThan(0);
  expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
  expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
}
describe.each(["light", "dark"] as const)("department phone bounds (%s)", (theme) => {
  it.each(["en", "es"] as const)("the department heading and fields fit (%s)", async (locale) => {
    const old = [window.innerWidth, window.innerHeight];
    try {
      await page.viewport(390, 1100);
      setLocale(locale);
      const { el, form, modal } = await mountDepartmentEditor(undefined, theme);
      el.model = structuredClone(el.model);
      el.model.departments[0]!.name = "Restaurante".repeat(20);
      el.requestUpdate();
      await el.updateComplete;
      await modal.updateComplete;
      await form.updateComplete;
      expect(window.innerWidth).toBe(390);
      const native = modal.shadowRoot!.querySelector("dialog")!;
      const bounds = native.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(390);
      const heading = modal.shadowRoot!.querySelector("h2")!;
      inside(heading, bounds);
      expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
      const text = document.createRange();
      text.selectNodeContents(heading);
      expect(text.getClientRects().length).toBeGreaterThan(1);
      const fields = form.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
      await fields.updateComplete;
      for (const field of form.shadowRoot!.querySelectorAll("wt-input")) inside(field, bounds);
      await selectDepartmentTab(form, "service");
      for (const field of fields.shadowRoot!.querySelectorAll("wt-combobox, wt-switch"))
        inside(field, bounds);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      await page.viewport(old[0]!, old[1]!);
    }
  });
  it.each(["en", "es"] as const)("the Transfers tab's fields fit (%s)", async (locale) => {
    const old = [window.innerWidth, window.innerHeight];
    try {
      await page.viewport(390, 1100);
      setLocale(locale);
      const { el, form, modal } = await mountDepartmentEditor(undefined, theme);
      el.model = structuredClone(el.model);
      el.model.departments[1]!.name = "Delicatessen".repeat(20);
      el.requestUpdate();
      await el.updateComplete;
      await form.updateComplete;
      await selectDepartmentTab(form, "transfers");
      expect(window.innerWidth).toBe(390);
      const bounds = modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(390);
      inside(form.shadowRoot!.querySelector("wt-tabs")!, bounds);
      const section = form.shadowRoot!.querySelector("[data-test=transfers-section]")!;
      inside(section.querySelector("h2")!, bounds);
      const destinations = [...section.querySelectorAll(".destination")];
      expect(destinations).toHaveLength(1);
      for (const field of [
        ...destinations,
        section.querySelector("fieldset")!,
        section.querySelector("wt-combobox")!,
        ...form.shadowRoot!.querySelector("wt-form-actions")!.children,
      ])
        inside(field, bounds);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      await page.viewport(old[0]!, old[1]!);
    }
  });
  it.each(["en", "es"] as const)(
    "long zone names wrap without hiding controls (%s)",
    async (locale) => {
      const old = [window.innerWidth, window.innerHeight];
      try {
        await page.viewport(390, 1100);
        setLocale(locale);
        const { el, modal } = await mountZoneEditor(undefined, theme);
        const model = structuredClone(el.model);
        model.zones[0]!.name = "Terraza".repeat(20);
        el.model = model;
        await el.updateComplete;
        await modal.updateComplete;
        expect(window.innerWidth).toBe(390);
        const native = modal.shadowRoot!.querySelector("dialog")!;
        const bounds = native.getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(390);
        const heading = modal.shadowRoot!.querySelector("h2")!;
        inside(heading, bounds);
        expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
        const text = document.createRange();
        text.selectNodeContents(heading);
        expect(text.getClientRects().length).toBeGreaterThan(1);
        inside(el.shadowRoot!.querySelector("wt-input")!, bounds);
        const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
        await fields.updateComplete;
        const controls = [...fields.shadowRoot!.querySelectorAll("wt-combobox")];
        expect(controls.map((control) => control.name)).toEqual([
          "orderStart",
          "paidWhen",
          "collectionNumber",
          "receiptPrintMode",
        ]);
        for (const field of controls) inside(field, bounds);
        for (const action of el.shadowRoot!.querySelector("wt-form-actions")!.children)
          inside(action, bounds);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
      } finally {
        await page.viewport(old[0]!, old[1]!);
      }
    },
  );
});
