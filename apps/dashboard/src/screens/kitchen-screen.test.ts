import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { Course, DashboardApi, Station } from "../api/client.js";
import { KitchenScreen } from "./kitchen-screen.js";

afterEach(cleanupWidgets);

const STATIONS: Station[] = [
  {
    id: "s1",
    name: "Cocina",
    isDefault: true,
    active: true,
    showsRestOfOrder: false,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
];

const COURSES: Course[] = [
  {
    id: "c1",
    name: "Entrantes",
    displayOrder: 0,
    active: true,
    inUse: false,
    heldUntilFired: true,
  },
];

const TWO_COURSES: Course[] = [
  {
    id: "c1",
    name: "Entrantes",
    displayOrder: 0,
    active: true,
    inUse: false,
    heldUntilFired: true,
  },
  { id: "c2", name: "Postres", displayOrder: 1, active: true, inUse: false, heldUntilFired: true },
];

function stubApi(
  overrides: Partial<DashboardApi> = {},
  stations: Station[] = STATIONS,
  courses: Course[] = COURSES,
): DashboardApi {
  return {
    listStations: vi.fn().mockResolvedValue(stations.map((s) => ({ ...s }))),
    createStation: vi.fn().mockResolvedValue({ id: "s9" }),
    updateStation: vi.fn().mockResolvedValue(undefined),
    setDefaultStation: vi.fn().mockResolvedValue(undefined),
    setBumpMode: vi.fn().mockResolvedValue(undefined),
    getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
    listCourses: vi.fn().mockResolvedValue(courses.map((c) => ({ ...c }))),
    createCourse: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCourse: vi.fn().mockResolvedValue(undefined),
    getCourseDeleteImpact: vi.fn((id: string) =>
      Promise.resolve({
        target: { id, name: courses.find((c) => c.id === id)?.name ?? id },
        refusals: [],
        ends: [],
        removes: [],
      }),
    ),
    deleteCourse: vi.fn((id: string) =>
      Promise.resolve({
        target: { id, name: courses.find((c) => c.id === id)?.name ?? id },
        refusals: [],
        ends: [],
        removes: [],
      }),
    ),
    getKitchenTimingDefaults: vi.fn().mockResolvedValue({
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    }),
    setKitchenTimingDefaults: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: KitchenScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: KitchenScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

describe("kitchen-screen", () => {
  it("seeds the bump-mode toggle from the stored setting", async () => {
    const api = stubApi({ getBumpMode: vi.fn().mockResolvedValue({ mode: "ticket" }) });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=bump-ticket]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=bump-line]")!.getAttribute("variant")).toBe("secondary");
  });

  it("still reads timing when the bump mode cannot be read, and says the read failed", async () => {
    const api = stubApi({ getBumpMode: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(
      [...q(el, "[data-test=timing-values]")!.children].map((value) => value.textContent),
    ).toEqual([
      `${t("kitchen.station_warm")}: 5`,
      `${t("kitchen.station_overdue")}: 10`,
      `${t("kitchen.station_forgotten")}: 15`,
    ]);
    expect(q(el, "[role=alert]")!.textContent).toContain(codeMessage("server.internal"));
  });

  it("draws no h1, no stations panel and no link to Prep stations", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("h1")).toHaveLength(0);
    expect(q(el, "[data-test=stations-panel]")).toBeNull();
    expect(q(el, 'a[href="/manage/prep-stations"]')).toBeNull();
    expect(api.listStations).not.toHaveBeenCalled();
  });

  it("toggles the whole-ticket bump mode to ticket and back to line", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-test=bump-ticket]")!.click();
    await flush(el);
    expect(api.setBumpMode).toHaveBeenNthCalledWith(1, "ticket");
    q(el, "[data-test=bump-line]")!.click();
    await flush(el);
    expect(api.setBumpMode).toHaveBeenNthCalledWith(2, "line");
  });

  it("surfaces a rejected bump-mode write as a localised role=alert banner", async () => {
    const api = stubApi({ setBumpMode: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-test=bump-ticket]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")).not.toBeNull();
  });

  it("the Kitchen tab lists no courses", async () => {
    const api = stubApi({}, STATIONS, TWO_COURSES);
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=bump-line]")).not.toBeNull();
    expect(q(el, "[data-test=courses-panel]")).toBeNull();
    expect(q(el, "dashboard-course-list")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(t("kitchen.courses_title"));
    expect(api.listCourses).not.toHaveBeenCalled();
  });

  it("starts its first section at its own top inside a grid, as Venue settings lays out a tab", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    host.style.display = "grid";
    await flush(el);
    const first = el.shadowRoot!.querySelector("section")!;
    expect(first.getBoundingClientRect().top).toBe(el.getBoundingClientRect().top);
    const second = first.nextElementSibling!;
    expect(second.getBoundingClientRect().top).toBeGreaterThan(
      first.getBoundingClientRect().bottom,
    );
  });
});

it("clears a failed bump-mode load's message once the server answers again", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({
      getBumpMode: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue({ mode: "ticket" }),
    }),
    { liveData },
  );
  const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeNull());
  expect(q(el, "[data-test=bump-ticket]")!.getAttribute("variant")).toBe("primary");
});

it("keeps a later refusal when a failed bump-mode load recovers", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({
      getBumpMode: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue({ mode: "line" }),
      setBumpMode: vi.fn().mockRejectedValue({ code: "server.internal" }),
    }),
    { liveData },
  );
  const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
  );
  q(el, "[data-test=bump-ticket]")!.click();
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("server.internal")),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(api.getBumpMode).toHaveBeenCalledTimes(2));
  await flush(el);
  expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("server.internal"));
});

it("keeps a save's connection failure when the reads that failed beside it recover", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({
      getBumpMode: vi
        .fn()
        .mockResolvedValueOnce({ mode: "line" })
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue({ mode: "ticket" }),
      setBumpMode: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    }),
    { liveData },
  );
  const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
  await vi.waitFor(() => expect(api.getBumpMode).toHaveBeenCalledTimes(1));
  liveData.refresh();
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
  );
  q(el, "[data-test=bump-ticket]")!.click();
  await vi.waitFor(() => expect(api.setBumpMode).toHaveBeenCalledTimes(1));
  await flush(el);
  liveData.refresh();
  await vi.waitFor(() => expect(api.getBumpMode).toHaveBeenCalledTimes(3));
  await flush(el);
  liveData.refresh();
  await vi.waitFor(() =>
    expect(q(el, "[data-test=bump-ticket]")!.getAttribute("variant")).toBe("primary"),
  );
  await flush(el);
  expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));
});
