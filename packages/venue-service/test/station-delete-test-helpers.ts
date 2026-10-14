import { afterEach, expect, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import type { PrepStationsView, PrepStationsApi } from "../src/dashboard/routing-client.js";
import { PrepStationsScreen } from "../src/dashboard/prep-stations-screen.js";
export const stationView: PrepStationsView = {
  routing: {
    zones: [],
    categories: [
      { id: "drinks", name: "Drinks", parentId: null },
      { id: "cocktails", name: "Cocktails", parentId: "drinks" },
      { id: "food", name: "Food", parentId: null },
    ],
    products: [{ id: "bread", name: "Bread", categoryId: null }],
    periods: [],
    cells: [
      {
        row: { kind: "category", categoryId: "cocktails" },
        zoneId: null,
        target: { kind: "station", stationId: "bar" },
      },
    ],
    canMakeDefault: true,
    printMovedSlips: true,
    defaultStationId: "bar",
    stations: [{ id: "bar", name: "Bar", active: true, colour: "blue" }],
    stationTimes: [
      {
        stationId: "bar",

        status: { open: true, why: "default" },

        today: null,
        closedSendsTo: "bar",
      },
    ],
    todayEnds: { timeOfDay: "06:00", tomorrow: true },
    clockReadable: true,
  },
  stations: [
    {
      id: "bar",
      name: "Bar",
      active: true,
      colour: "blue",
      isDefault: true,
      displayOrder: 1,
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
      timingDefaults: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
      timingOverrides: {
        warmAfterMinutes: null,
        overdueAfterMinutes: null,
        forgottenAfterMinutes: null,
      },
      showsRestOfOrder: false,
      printMovedSlips: null,
    },
  ],
  categories: [
    { id: "drinks", name: "Drinks", parentId: null },
    { id: "cocktails", name: "Cocktails", parentId: "drinks" },
    { id: "food", name: "Food", parentId: null },
  ],
  zones: [],
  products: [{ id: "bread", name: "Bread" }],
  printers: [],
  stationPrinters: [],
  devices: [],
};

const hosts: HTMLElement[] = [];
const url = location.href;
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
  history.replaceState(null, "", url);
});
export const allowedImpact: DeleteImpact = {
  target: { id: "bar", name: "Bar" },
  refusals: [],
  ends: [],
  removes: [],
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function mountDelete(overrides: Partial<PrepStationsApi> = {}, theme = "light") {
  setLocale("en");
  const host = document.createElement("div");
  applyTokens(host);
  host.dataset.theme = theme;
  host.style.background = "var(--wt-color-bg)";
  host.style.color = "var(--wt-color-text)";
  document.body.append(host);
  hosts.push(host);
  const screen = new PrepStationsScreen();
  const api = {
    load: vi.fn().mockResolvedValue(stationView),
    getStationDeleteImpact: vi.fn().mockResolvedValue(allowedImpact),
    deleteStation: vi.fn().mockResolvedValue(allowedImpact),
    ...overrides,
  } as unknown as PrepStationsApi;
  screen.api = api;
  host.append(screen);
  await expect
    .poll(() =>
      screen
        .shadowRoot!.querySelector("prep-station-table")
        ?.shadowRoot?.querySelector("wt-data-table")
        ?.shadowRoot?.querySelector('[data-test="delete-bar"]'),
    )
    .toBeTruthy();
  return { screen, api, host };
}
export async function openDelete(screen: PrepStationsScreen, id = "bar") {
  screen
    .shadowRoot!.querySelector("prep-station-table")!
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>(`[data-test="delete-${id}"]`)!
    .click();
  await screen.updateComplete;
  const dialog = screen.shadowRoot!.querySelector("wt-delete-dialog")!;
  await dialog.updateComplete;
  return dialog;
}
