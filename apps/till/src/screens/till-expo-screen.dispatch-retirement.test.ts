import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExpoItem, ExpoOrder, TillApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillExpoScreen } from "./till-expo-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

const queuedAt = "2026-10-21T10:00:00Z";
const now = Date.parse("2026-10-21T10:20:00Z");
function item(id: string, state: ExpoItem["state"]): ExpoItem {
  return {
    id,
    name: state === "ready" ? "Soup" : "Bread",
    qty: "1.000",
    stationName: "Kitchen",
    state,
    firedAt: queuedAt,
    awayAt: queuedAt,
    queuedAt,
    thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
    band: "fresh",
    allergy: null,
  };
}

function order(kind: "course" | "group", allReady = true, away = true) {
  const items = [item("ready-item", "ready")];
  const section = { fired: true, away, allReady, items };
  return {
    kitchenNote: null,
    orderId: "bill-1",
    orderNumber: 12,
    tableLabel: "Table 4",
    openedMinutes: 20,
    worstBand: "fresh" as const,
    courses:
      kind === "course"
        ? [{ ...section, courseId: "course-1", courseName: "Starter", displayOrder: 1 }]
        : [],
    ...(kind === "group"
      ? {
          party: { id: "party-1", revision: 7 },
          groups: [
            {
              ...section,
              groupId: "group-1",
              position: 1,
              displayNumber: 1,
              numberPartyId: "party-1",
              state: "fired" as const,
            },
          ],
        }
      : {}),
  } satisfies ExpoOrder;
}

async function mount(
  kind: "course" | "group",
  mode: "all" | "pass" | "device" | "monitor",
  allReady = true,
  away = true,
) {
  const orders = [order(kind, allReady, away)];
  const board = {
    orders: orders.map((value) => ({ ...value, groups: value.groups ?? [] })),
    stations: [],
    zones: null,
  };
  const api = {
    getExpoQueue: vi.fn(async () => orders),
    getDeviceIdentity: vi.fn(async () => ({
      kitchenScreens: mode === "pass" ? [{ kind: "pass", available: true }] : [],
    })),
    getDevicePassScreen: vi.fn(async () => board),
    getDevicePassMonitor: vi.fn(async () => board),
    bumpCourseReady: vi.fn(async () => undefined),
    bumpGroupReady: vi.fn(async () => ({ revision: 8 })),
    bumpDeviceCourseReady: vi.fn(async () => undefined),
    bumpDeviceGroupReady: vi.fn(async () => ({ revision: 8 })),
    markCourseAway: vi.fn(),
    markGroupAway: vi.fn(),
    markDeviceCourseAway: vi.fn(),
    markDeviceGroupAway: vi.fn(),
    reprintOrder: vi.fn(),
  };
  const { el } = await mountWidget<TillExpoScreen>("till-expo-screen", {
    api: api as unknown as TillApi,
    runsPass: true,
    now,
    deviceMode: mode === "device" || mode === "monitor",
    monitor: mode === "monitor",
    ...(mode === "device" ? { initialDevicePass: board } : {}),
    ...(mode === "monitor" ? { initialDevicePassMonitor: board } : {}),
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-order]")).not.toBeNull());
  return { el, api };
}

describe("A773 no dispatch presentation", () => {
  for (const kind of ["course", "group"] as const)
    for (const mode of ["all", "pass", "device", "monitor"] as const)
      it(`${kind} on ${mode} keeps ready food and its late flags with no Away action`, async () => {
        setLocale("en");
        const { el, api } = await mount(kind, mode);
        const root = el.shadowRoot!;
        const dish = root.querySelector('[data-item="ready-item"]');
        expect(dish).not.toBeNull();
        expect(dish!.textContent).toContain(t("station.state.ready"));
        expect(dish!.textContent).not.toContain(t("expo.sent_out"));
        expect(dish!.querySelector("[data-forgotten]")).not.toBeNull();
        expect(root.querySelector("[data-order]")!.classList.contains("age-forgotten")).toBe(true);
        expect(root.querySelector(".overdue-count")!.textContent).toContain("1");
        expect(
          root.querySelector("[data-away], [data-group-away], [data-ready], [data-group-ready]"),
        ).toBeNull();
        for (const call of [
          api.markCourseAway,
          api.markGroupAway,
          api.markDeviceCourseAway,
          api.markDeviceGroupAway,
        ])
          expect(call).not.toHaveBeenCalled();
      });

  for (const kind of ["course", "group"] as const)
    for (const mode of ["all", "pass", "device"] as const)
      it(`${kind} on ${mode} offers no dispatch action for a newly ready dish`, async () => {
        const { el, api } = await mount(kind, mode, true, false);
        expect(el.shadowRoot!.querySelector('[data-item="ready-item"]')).not.toBeNull();
        expect(el.shadowRoot!.querySelector("[data-away], [data-group-away]")).toBeNull();
        for (const call of [
          api.markCourseAway,
          api.markGroupAway,
          api.markDeviceCourseAway,
          api.markDeviceGroupAway,
        ])
          expect(call).not.toHaveBeenCalled();
      });

  for (const kind of ["course", "group"] as const)
    it(`${kind} keeps authorised Ready when the server says another station is not ready`, async () => {
      const { el, api } = await mount(kind, "device", false);
      const ready = el.shadowRoot!.querySelector<HTMLButtonElement>(
        kind === "course" ? '[data-ready="course-1"]' : '[data-group-ready="group-1"]',
      );
      expect(ready).not.toBeNull();
      expect(ready!.disabled).toBe(false);
      ready!.click();
      const call = kind === "course" ? api.bumpDeviceCourseReady : api.bumpDeviceGroupReady;
      await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
      if (kind === "course") expect(call).toHaveBeenCalledWith("bill-1", "course-1");
      else
        expect(call).toHaveBeenCalledWith("party-1", "group-1", {
          submissionId: expect.any(String),
          expectedPartyRevision: 7,
        });
      expect(el.shadowRoot!.querySelector("[data-away], [data-group-away]")).toBeNull();
    });
});
