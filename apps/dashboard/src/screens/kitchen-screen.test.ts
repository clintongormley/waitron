import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { Course, DashboardApi, FireControl, Station } from "../api/client.js";
import { KitchenScreen } from "./kitchen-screen.js";

afterEach(cleanupWidgets);

const STATIONS: Station[] = [
  {
    id: "s1",
    name: "Cocina",
    displayOrder: 0,
    isDefault: true,
    active: true,
    showsRestOfOrder: false,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
];

const COURSES: Course[] = [{ id: "c1", name: "Entrantes", displayOrder: 0, active: true }];

const TWO_COURSES: Course[] = [
  { id: "c1", name: "Entrantes", displayOrder: 0, active: true },
  { id: "c2", name: "Postres", displayOrder: 1, active: true },
];

function stubApi(
  overrides: Partial<DashboardApi> = {},
  stations: Station[] = STATIONS,
  courses: Course[] = COURSES,
  fireControl: FireControl = "waiter",
): DashboardApi {
  return {
    listStations: vi.fn().mockResolvedValue(stations.map((s) => ({ ...s }))),
    createStation: vi.fn().mockResolvedValue({ id: "s9" }),
    updateStation: vi.fn().mockResolvedValue(undefined),
    deactivateStation: vi.fn().mockResolvedValue(undefined),
    setDefaultStation: vi.fn().mockResolvedValue(undefined),
    setBumpMode: vi.fn().mockResolvedValue(undefined),
    listCourses: vi.fn().mockResolvedValue(courses.map((c) => ({ ...c }))),
    createCourse: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCourse: vi.fn().mockResolvedValue(undefined),
    deactivateCourse: vi.fn().mockResolvedValue(undefined),
    getFireControl: vi.fn().mockResolvedValue({ mode: fireControl }),
    setFireControl: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: KitchenScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: KitchenScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

describe("kitchen-screen", () => {
  it("links to Prep stations without the former stations panel", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=stations-panel]")).toBeNull();
    expect(q(el, 'a[href="/manage/prep-stations"]')?.textContent).toContain(
      t("kitchen.prep_stations_link"),
    );
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

  it("shows the courses heading over the shared course list, which loads the courses itself", async () => {
    const api = stubApi({}, STATIONS, TWO_COURSES);
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    const panel = q(el, "[data-test=courses-panel]")!;
    expect(panel.querySelector("h2")!.textContent!.trim()).toBe(t("kitchen.courses_title"));
    const list = panel.querySelector("dashboard-course-list")!;
    expect(list.api).toBe(api);
    await vi.waitFor(() =>
      expect(list.shadowRoot!.querySelectorAll("tbody tr[data-course]")).toHaveLength(2),
    );
    expect(api.listCourses).toHaveBeenCalledTimes(1);
  });

  it("seeds the fire-control toggle from the PERSISTED setting (getFireControl) and reflects it", async () => {
    const api = stubApi({}, STATIONS, COURSES, "kitchen");
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(api.getFireControl).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=fire-kitchen]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=fire-waiter]")!.getAttribute("variant")).toBe("secondary");
  });

  it("toggles the fire-control mode across kitchen, expo, and back to waiter", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-test=fire-kitchen]")!.click();
    await flush(el);
    expect(api.setFireControl).toHaveBeenNthCalledWith(1, "kitchen");
    q(el, "[data-test=fire-expo]")!.click();
    await flush(el);
    expect(api.setFireControl).toHaveBeenNthCalledWith(2, "expo");
    q(el, "[data-test=fire-waiter]")!.click();
    await flush(el);
    expect(api.setFireControl).toHaveBeenNthCalledWith(3, "waiter");
  });

  it("surfaces a rejected fire-control write as a localised role=alert banner", async () => {
    const api = stubApi({ setFireControl: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-test=fire-kitchen]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")).not.toBeNull();
  });
});

it("clears a failed fire-control load's message once the server answers again", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({
      getFireControl: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue({ mode: "kitchen" }),
    }),
    { liveData },
  );
  const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeNull());
  expect(q(el, "[data-test=fire-kitchen]")!.getAttribute("variant")).toBe("primary");
});

it("keeps a later refusal when a failed fire-control load recovers", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({
      getFireControl: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue({ mode: "waiter" }),
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
  await vi.waitFor(() => expect(api.getFireControl).toHaveBeenCalledTimes(2));
  await flush(el);
  expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("server.internal"));
});

it("keeps a save's connection failure when the reads that failed beside it recover", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({
      getFireControl: vi
        .fn()
        .mockResolvedValueOnce({ mode: "waiter" })
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue({ mode: "kitchen" }),
      setBumpMode: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    }),
    { liveData },
  );
  const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
  await vi.waitFor(() => expect(api.getFireControl).toHaveBeenCalledTimes(1));
  liveData.refresh();
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
  );
  q(el, "[data-test=bump-ticket]")!.click();
  await vi.waitFor(() => expect(api.setBumpMode).toHaveBeenCalledTimes(1));
  await flush(el);
  liveData.refresh();
  await vi.waitFor(() => expect(api.getFireControl).toHaveBeenCalledTimes(3));
  await flush(el);
  liveData.refresh();
  await vi.waitFor(() =>
    expect(q(el, "[data-test=fire-kitchen]")!.getAttribute("variant")).toBe("primary"),
  );
  await flush(el);
  expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));
});
