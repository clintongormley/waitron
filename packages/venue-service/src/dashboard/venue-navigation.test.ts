import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { WtTabs } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

const initialUrl = location.href;
const hosts: HTMLElement[] = [];
const model: VenueServiceView = {
  readiness: [],
  departments: [],
  zones: [],
  routes: [],
  hours: [],
  zoneMenus: [],
  menus: [],
  categories: [],
  stations: [],
  floorZones: [],
  products: [],
  offers: [],
};

beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  vi.restoreAllMocks();
  history.replaceState(null, "", initialUrl);
  setLocale("en");
});

function navigate(path: string): void {
  const url = new URL(location.href);
  url.pathname = path;
  url.searchParams.set("dev", "1");
  url.searchParams.set("source", "saved link");
  history.replaceState(null, "", url);
}

async function mount(): Promise<VenueOperationsScreen> {
  const host = document.createElement("div");
  applyTokens(host);
  hosts.push(host);
  document.body.append(host);
  const screen = document.createElement("dashboard-venue-operations-screen");
  screen.api = { load: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi;
  host.append(screen);
  await screen.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  await tabs(screen).updateComplete;
  return screen;
}

function tabs(screen: VenueOperationsScreen): WtTabs {
  return screen.shadowRoot!.querySelector("wt-tabs")!;
}

function expectSelected(screen: VenueOperationsScreen, key: string): void {
  const strip = tabs(screen);
  expect(strip.value).toBe(key);
  expect(
    strip.shadowRoot!.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-key"),
  ).toBe(key);
  const panels = strip.shadowRoot!.querySelectorAll('[role="tabpanel"]:not([hidden])');
  expect(panels).toHaveLength(1);
  expect(panels[0]!.querySelector("slot")?.name).toBe(key);
}

async function select(screen: VenueOperationsScreen, key: string): Promise<void> {
  tabs(screen)
    .shadowRoot!.querySelector<HTMLButtonElement>(`[role="tab"][data-key="${key}"]`)!
    .click();
  await screen.updateComplete;
  await tabs(screen).updateComplete;
}

async function traverse(
  direction: "back" | "forward",
  screen: VenueOperationsScreen,
): Promise<void> {
  const completed = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  history[direction]();
  await completed;
  await screen.updateComplete;
  await tabs(screen).updateComplete;
}

describe("venue operations URL navigation", () => {
  it("restores the requested tab when mounted and remounted without adding history", async () => {
    navigate("/manage/venue-operations/view/menus");
    const before = location.href;
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const screen = await mount();
    expectSelected(screen, "menus");
    screen.remove();
    expectSelected(await mount(), "menus");
    expect(location.href).toBe(before);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(["/manage/venue-operations", "/manage/venue-operations/view/missing"])(
    "replaces %s with the Status tab and preserves query parameters",
    async (path) => {
      navigate(path);
      const query = location.search;
      const push = vi.spyOn(history, "pushState");
      const replace = vi.spyOn(history, "replaceState");
      const screen = await mount();
      expectSelected(screen, "status");
      expect(location.pathname).toBe("/manage/venue-operations/view/status");
      expect(location.search).toBe(query);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
    },
  );

  it("pushes each selected tab once and restores real Back and Forward navigation", async () => {
    navigate("/manage/venue-operations/view/status");
    const query = location.search;
    const screen = await mount();
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    await select(screen, "menus");
    expectSelected(screen, "menus");
    expect(location.pathname).toBe("/manage/venue-operations/view/menus");
    expect(push).toHaveBeenCalledTimes(1);
    await select(screen, "menus");
    expect(push).toHaveBeenCalledTimes(1);
    await select(screen, "departments");
    expectSelected(screen, "departments");
    expect(location.pathname).toBe("/manage/venue-operations/view/departments");
    expect(push).toHaveBeenCalledTimes(2);
    await traverse("back", screen);
    expectSelected(screen, "menus");
    expect(location.pathname).toBe("/manage/venue-operations/view/menus");
    await traverse("forward", screen);
    expectSelected(screen, "departments");
    expect(location.pathname).toBe("/manage/venue-operations/view/departments");
    expect(location.search).toBe(query);
    expect(push).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
  });
});
