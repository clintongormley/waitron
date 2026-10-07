import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

const initialUrl = location.href;
const hosts: HTMLElement[] = [];
const model: VenueServiceView = {
  readiness: [],
  departments: [],
  zones: [],
  salePolicies: { departments: [], zones: [] },
  menus: [],
  floorZones: [],
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: 10,
  clearingWorkflow: false,
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
  return screen;
}

describe("venue operations URL navigation", () => {
  it.each([
    "/manage/venue-operations/view/departments",
    "/manage/venue-operations/view/zones",
    "/manage/venue-operations/view/status",
    "/manage/venue-operations/view/missing",
    "/manage/venue-operations/view/menus",
    "/manage/venue-operations/view/kitchen",
  ])("opens the old %s bookmark at the unified page without a new history entry", async (path) => {
    navigate(path);
    const query = location.search;
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const screen = await mount();
    expect(screen.shadowRoot!.querySelector('[data-test="policy-tree"]')).not.toBeNull();
    expect(location.pathname).toBe("/manage/venue-operations");
    expect(location.search).toBe(query);
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    screen.remove();
    await mount();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("keeps the unified page URL when opened directly", async () => {
    navigate("/manage/venue-operations");
    const before = location.href;
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const screen = await mount();
    expect(screen.shadowRoot!.querySelector('[data-test="policy-tree"]')).not.toBeNull();
    expect(location.href).toBe(before);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
