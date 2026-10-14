import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Station, TillApi, TillProduct } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillStationScreen } from "../screens/till-station-screen.js";
import type { TillTenderPay } from "./tender-pay.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "../screens/till-station-screen.js";
import "./tender-pay.js";

const originalLocale = currentLocale();
const stations: Station[] = ["Cocina", "Barra"].map((name, index) => ({
  id: `st-${index + 1}`,
  name,
  displayOrder: index,
  isDefault: index === 0,
  active: true,
  open: true,
  byHand: null,
  sendsTo: null,
  why: index === 0 ? "default" : "open",
}));
const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

function interactiveButton(control: HTMLElement): HTMLButtonElement {
  const button =
    control instanceof HTMLButtonElement
      ? control
      : control.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
  expect(button).not.toBeNull();
  return button;
}

afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(1280, 768);
});

for (const locale of ["en", "es"]) {
  for (const theme of ["light", "dark"] as const) {
    describe(`${locale} ${theme}`, () => {
      for (const width of [390, 1280]) {
        it(`station picker exposes pressed state on the interactive button at ${width}`, async () => {
          setLocale(locale);
          await page.viewport(width, 900);
          expect(window.innerWidth).toBe(width);
          const api = {
            listStations: vi.fn().mockResolvedValue(stations),
            getDeviceIdentity: vi.fn().mockResolvedValue({
              deviceId: "dev-1",
              formFactor: "till",
              name: "Till",
              kitchenScreens: [],
            }),
            getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
          } as unknown as TillApi;
          const { el, host } = await mountWidget<TillStationScreen>(
            "till-station-screen",
            { api },
            theme,
          );
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelectorAll("[data-station]")).toHaveLength(2),
          );
          const first = interactiveButton(
            el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-1"]')!,
          );
          const second = interactiveButton(
            el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!,
          );
          expect(first.getAttribute("aria-pressed")).toBe("true");
          expect(second.getAttribute("aria-pressed")).toBe("false");
          await expectNoA11yViolations(host);
          await userEvent.click(second);
          await vi.waitFor(() => expect(second.getAttribute("aria-pressed")).toBe("true"));
          expect(first.getAttribute("aria-pressed")).toBe("false");
          first.focus();
          await userEvent.keyboard("{Enter}");
          await vi.waitFor(() => expect(first.getAttribute("aria-pressed")).toBe("true"));
          expect(second.getAttribute("aria-pressed")).toBe("false");
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/a608/${locale}-${theme}-${width}-station.png`,
          });
        });

        it(`simulation picker exposes pressed state on the interactive button at ${width}`, async () => {
          setLocale(locale);
          await page.viewport(width, 900);
          expect(window.innerWidth).toBe(width);
          const store = new WorkingOrderStore();
          store.addProduct(cafe, "2");
          const { el, host } = await mountWidget<TillTenderPay>(
            "till-tender-pay",
            { store, cardProvider: "simulator" },
            theme,
          );
          const captured = interactiveButton(
            el.shadowRoot!.querySelector<HTMLElement>('[data-test="simulation-captured"]')!,
          );
          const declined = interactiveButton(
            el.shadowRoot!.querySelector<HTMLElement>('[data-test="simulation-declined"]')!,
          );
          expect(captured.getAttribute("aria-pressed")).toBe("true");
          expect(declined.getAttribute("aria-pressed")).toBe("false");
          await expectNoA11yViolations(host);
          await userEvent.click(declined);
          await el.updateComplete;
          expect(declined.getAttribute("aria-pressed")).toBe("true");
          expect(captured.getAttribute("aria-pressed")).toBe("false");
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/a608/${locale}-${theme}-${width}-simulation.png`,
          });
          captured.focus();
          await userEvent.keyboard(" ");
          await el.updateComplete;
          expect(captured.getAttribute("aria-pressed")).toBe("true");
          expect(declined.getAttribute("aria-pressed")).toBe("false");
        });
      }
    });
  }
}
