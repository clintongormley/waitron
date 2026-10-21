import { afterEach, describe, expect, it, vi } from "vitest";
import type { TillApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { TillExpoScreen } from "./till-expo-screen.js";
import { allergyBlock, allergyOrder } from "../../test/kitchen-allergy-fixtures.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

describe("A669 boards pass", () => {
  for (const kind of ["courses", "groups"] as const)
    for (const mode of ["all", "pass", "monitor"] as const)
      it(`marks only visible ${kind} on ${mode}`, async () => {
        const order = allergyOrder();
        const [ticked, unticked] = order.courses[0]!.items;
        if (kind === "courses") {
          order.courses = [
            { ...order.courses[0]!, ...{ away: true }, items: [ticked!] },
            { ...order.courses[0]!, courseId: "visible-course", away: false, items: [unticked!] },
          ];
        } else {
          order.party = { id: "party-1", revision: 1 };
          order.courses = [];
          order.groups = [true, false].map((away, n) => ({
            groupId: `group-${n}`,
            position: n + 1,
            displayNumber: n + 1,
            numberPartyId: "party-1",
            state: "fired",
            fired: true,
            ...{ away },
            items: [away ? ticked! : unticked!],
          }));
        }
        const board = {
          orders: [
            {
              ...order,
              courses: order.courses.map((part) => ({ ...part, allReady: false })),
              groups: (order.groups ?? []).map((part) => ({ ...part, allReady: false })),
            },
          ],
          stations: [],
          zones: null,
        };
        const api = {
          getExpoQueue: vi.fn(async () => [order]),
          getDeviceIdentity: vi.fn(async () => ({ kitchenScreens: [] })),
          getDevicePassScreen: vi.fn(async () => board),
          getDevicePassMonitor: vi.fn(async () => board),
        } as unknown as TillApi;
        const { el } = await mountWidget<TillExpoScreen>("till-expo-screen", {
          api,
          deviceName: "Kitchen pass",
          deviceMode: mode === "pass",
          monitor: mode === "monitor",
          ...(mode === "pass" ? { initialDevicePass: board } : {}),
          ...(mode === "monitor" ? { initialDevicePassMonitor: board } : {}),
        });
        await vi.waitFor(() =>
          expect(el.shadowRoot!.querySelector('[data-item="unticked"]')).not.toBeNull(),
        );
        expect(el.shadowRoot!.querySelectorAll("[data-allergy-marker]")).toHaveLength(1);
        expect(el.shadowRoot!.querySelector('[data-item="ticked"]')).not.toBeNull();
      });

  for (const mode of ["all", "pass", "monitor"] as const)
    for (const language of ["en", "es"] as const)
      it(`shows the frozen original in ${mode} in ${language}`, async () => {
        setLocale(language);
        const orders = [allergyOrder()];
        const board = () => ({
          orders: orders.map((order) => ({
            ...order,
            courses: order.courses.map((course) => ({ ...course, allReady: false })),
            groups: [],
          })),
          stations: [],
          zones: null,
        });
        const api = {
          getExpoQueue: vi.fn(async () => orders),
          getDeviceIdentity: vi.fn(async () => ({ kitchenScreens: [] })),
          getDevicePassScreen: vi.fn(async () => board()),
          getDevicePassMonitor: vi.fn(async () => board()),
        } as unknown as TillApi;
        const { el, host } = await mountWidget<TillExpoScreen>(
          "till-expo-screen",
          {
            api,
            deviceName: "Kitchen pass",
            deviceMode: mode === "pass",
            monitor: mode === "monitor",
            ...(mode === "pass" ? { initialDevicePass: board() } : {}),
            ...(mode === "monitor" ? { initialDevicePassMonitor: board() } : {}),
          },
          language === "en" ? "light" : "dark",
        );
        await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup cook"));
        const line = el.shadowRoot!.querySelector('[data-item="ticked"]')!;
        const instructions = line.querySelector("[data-kitchen-allergy]");
        expect(instructions).not.toBeNull();
        expect(instructions!.textContent).toContain(allergyBlock.who);
        expect(line.textContent).toContain(allergyBlock.labels[language].avoids[0]);
        expect(line.textContent).toContain(allergyBlock.labels[language].clashes[0]);
        expect(line.textContent).toContain(allergyBlock.note);
        expect(line.querySelector("script, guest")).toBeNull();
        expect(
          el.shadowRoot!.querySelector('[data-item="unticked"] [data-kitchen-allergy]'),
        ).toBeNull();
        expect(el.shadowRoot!.querySelectorAll("[data-allergy-marker]")).toHaveLength(1);
        expect(
          el.shadowRoot!.querySelector("[data-allergy-marker]")!.getAttribute("aria-label"),
        ).toBe(t("kitchen_allergy.marker"));
        await expectNoA11yViolations(host);
      });
});
