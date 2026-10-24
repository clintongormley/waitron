import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TillApi } from "../api/client.js";
import type { MenuState } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { TillTableOrderScreen } from "./till-table-order-screen.js";

const subject = {
  periodId: "lunch",
  periodName: "Lunch",
  endsAt: "14:00",
  running: true,
};
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

for (const kind of ["counter", "table"] as const) {
  describe(`${kind} keep-open order screen`, () => {
    async function mount(service: MenuState["service"]) {
      const calls: string[] = [];
      const api = new TillApi(
        "",
        vi.fn(async (path: string | URL | Request) => {
          calls.push(String(path));
          return new Response(null, { status: 204 });
        }),
      );
      const shared = { api, service, departmentName: "Restaurant" };
      const { el } =
        kind === "counter"
          ? await mountWidget<TillCounterScreen>("till-counter-screen", {
              ...shared,
              selectedServiceZoneId: "counter /1",
              embedded: true,
              store: new WorkingOrderStore(),
            })
          : await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
              ...shared,
              zoneId: "dining /2",
              draftStore: new WorkingOrderStore(),
            });
      return { el, calls };
    }
    it.each([
      { language: "en-GB", want: "Open · until 14:00" },
      { language: "es-ES", want: "Abierto · hasta las 14:00" },
    ])("shows the period line as status text: $want", async ({ language, want }) => {
      setLocale(language);
      const { el } = await mount({
        open: true,
        zoneOpen: true,
        periodName: "Lunch",
        periodOccurrenceKey: '["department","2026-10-12","Lunch","08:00"]',
        zoneKeepOpen: null,
        keepOpen: subject,
      });
      const line = el.shadowRoot!.querySelector("[data-service-period]")!;
      expect(line.matches('p[role="status"]')).toBe(true);
      expect(line.textContent!.trim()).toBe(want);
      expect(line.querySelector("[data-action]")).toBeNull();
      expect(el.shadowRoot!.querySelector("till-keep-open")).toBeNull();
    });
    it("shows the closed-department notice with no keep-open control or read", async () => {
      const { el, calls } = await mount({
        open: false,
        zoneOpen: true,
        periodName: null,
        periodOccurrenceKey: null,
        zoneKeepOpen: null,
        keepOpen: { ...subject, running: false },
      });
      const notice = el.shadowRoot!.querySelector("[data-service-closed]")!;
      expect(notice.textContent!.trim()).toBe("Restaurant is closed: no period is running");
      expect(el.shadowRoot!.querySelector("till-keep-open")).toBeNull();
      expect(calls).toEqual([]);
    });
    it("omits both the period line and recovery control when no period ran today", async () => {
      const { el } = await mount({
        open: false,
        zoneOpen: true,
        periodName: null,
        periodOccurrenceKey: null,
        keepOpen: null,
        zoneKeepOpen: null,
      });
      expect(el.shadowRoot!.querySelector("[data-service-period]")).toBeNull();
      expect(el.shadowRoot!.querySelector("till-keep-open")).toBeNull();
    });
  });
}
