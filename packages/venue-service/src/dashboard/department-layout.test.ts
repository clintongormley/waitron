import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import "./department-page.js";
import "./department-zones.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

function inside(element: Element, bounds: DOMRect) {
  const rect = element.getBoundingClientRect();
  expect(rect.width, "the control is visible").toBeGreaterThan(0);
  expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
  expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
}

describe.each(["light", "dark"] as const)("department phone bounds (%s)", (theme) => {
  it.each(["en", "es"] as const)(
    "the trail, long heading and both tabs fit (%s)",
    async (locale) => {
      const old = [window.innerWidth, window.innerHeight];
      try {
        await page.viewport(390, 1100);
        setLocale(locale);
        const el = (await mountThemed(
          "<department-page></department-page>",
          theme,
        )) as HTMLElementTagNameMap["department-page"];
        host.style.width = "100%";
        host.style.boxSizing = "border-box";
        host.style.padding = "var(--wt-space-4)";
        el.model = structuredClone(zonesModel);
        el.model.departments[0]!.name = "Restaurante".repeat(20);
        el.departmentId = "d1";
        await el.updateComplete;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        expect(window.innerWidth).toBe(390);
        const bounds = el.getBoundingClientRect();
        const trail = el.shadowRoot!.querySelector("nav")!;
        const heading = el.shadowRoot!.querySelector("h1")!;
        inside(trail, bounds);
        inside(heading, bounds);
        expect(trail.getBoundingClientRect().bottom).toBeLessThan(
          heading.getBoundingClientRect().top,
        );
        expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
        const text = document.createRange();
        text.selectNodeContents(heading);
        expect(text.getClientRects().length).toBeGreaterThan(1);
        const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
        await tabs.updateComplete;
        const buttons = [...tabs.shadowRoot!.querySelectorAll<HTMLButtonElement>("[role=tab]")];
        expect(buttons).toHaveLength(2);
        for (const tab of buttons) {
          inside(tab, bounds);
          expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth);
        }
        expect(buttons[0]!.getBoundingClientRect().top).toBe(
          buttons[1]!.getBoundingClientRect().top,
        );
        const settings = el.shadowRoot!.querySelector("department-settings")!;
        await settings.updateComplete;
        const fields = settings.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
        await fields.updateComplete;
        for (const field of settings.shadowRoot!.querySelectorAll("wt-input"))
          inside(field, bounds);
        for (const field of fields.shadowRoot!.querySelectorAll("wt-combobox, wt-switch"))
          inside(field, bounds);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
      } finally {
        await page.viewport(old[0]!, old[1]!);
      }
    },
  );

  it.each(["en", "es"] as const)(
    "long zone names wrap without hiding controls (%s)",
    async (locale) => {
      const old = [window.innerWidth, window.innerHeight];
      try {
        await page.viewport(390, 1100);
        setLocale(locale);
        const el = (await mountThemed(
          "<department-zones></department-zones>",
          theme,
        )) as HTMLElementTagNameMap["department-zones"];
        host.style.width = "100%";
        host.style.boxSizing = "border-box";
        host.style.padding = "var(--wt-space-4)";
        el.model = structuredClone(zonesModel);
        el.model.zones[0]!.name = "Terraza".repeat(20);
        el.model.zones[1]!.name = "Comedor con vistas al jardín y a la plaza";
        el.model.zones[2]!.active = false;
        el.departmentId = "d1";
        el.zone = "z1";
        await el.updateComplete;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        expect(window.innerWidth).toBe(390);
        const bounds = el.getBoundingClientRect();
        const choices = [
          ...el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-button"]>(
            ".zones wt-button",
          ),
        ];
        expect(choices).toHaveLength(4);
        for (const choice of choices) {
          await choice.updateComplete;
          inside(choice, bounds);
          const native = choice.shadowRoot!.querySelector("button")!;
          inside(native, bounds);
          expect(native.scrollWidth).toBeLessThanOrEqual(native.clientWidth);
          const text = document.createRange();
          text.selectNodeContents(choice);
          for (const rect of text.getClientRects()) {
            expect(rect.left).toBeGreaterThanOrEqual(native.getBoundingClientRect().left);
            expect(rect.right).toBeLessThanOrEqual(native.getBoundingClientRect().right);
          }
        }
        expect(choices[1]!.getBoundingClientRect().top).toBeGreaterThan(
          choices[0]!.getBoundingClientRect().top,
        );
        inside(el.shadowRoot!.querySelector("h2")!, bounds);
        const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
        await fields.updateComplete;
        for (const field of fields.shadowRoot!.querySelectorAll("wt-combobox"))
          inside(field, bounds);
        const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
        for (const action of actions.children) inside(action, bounds);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
      } finally {
        await page.viewport(old[0]!, old[1]!);
      }
    },
  );
});
