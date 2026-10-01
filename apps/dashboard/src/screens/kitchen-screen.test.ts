import { LiveData } from "@waitron/dashboard-kit";
import { userEvent } from "vitest/browser";
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

function type(el: KitchenScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

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

  it("loads and lists the courses on connect", async () => {
    const api = stubApi({}, STATIONS, TWO_COURSES);
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(api.listCourses).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=course-row-c1]")).not.toBeNull();
    expect(q(el, "[data-test=course-row-c2]")).not.toBeNull();
  });

  it("shows the empty state when there are no courses", async () => {
    const api = stubApi({}, STATIONS, []);
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("kitchen.no_courses", "es-ES"));
  });

  it("creates a course from the new-course form (createCourse with the name), then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    type(el, "[data-new-course]", "Postres");
    q(el, "[data-add-course]")!.click();
    await flush(el);
    expect(api.createCourse).toHaveBeenCalledWith({ name: "Postres" });
    expect(api.listCourses).toHaveBeenCalledTimes(2);
  });

  it("does not create an empty-name course", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-add-course]")!.click();
    await flush(el);
    expect(api.createCourse).not.toHaveBeenCalled();
  });

  it("saves an edited course row (updateCourse with the row's current name + order), then reloads", async () => {
    const api = stubApi({}, STATIONS, TWO_COURSES);
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    type(el, "[data-test=course-name-c2]", "Café");
    type(el, "[data-test=course-order-c2]", "x");
    type(el, "[data-test=course-order-c2]", "3");
    q(el, "[data-test=course-save-c2]")!.click();
    await flush(el);
    expect(api.updateCourse).toHaveBeenCalledTimes(1);
    expect(api.updateCourse).toHaveBeenCalledWith("c2", { name: "Café", displayOrder: 3 });
    expect(api.listCourses).toHaveBeenCalledTimes(2);
  });

  it("deactivates a course row", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-test=course-deactivate-c1]")!.click();
    await flush(el);
    expect(api.deactivateCourse).toHaveBeenCalledWith("c1");
    expect(api.listCourses).toHaveBeenCalledTimes(2);
  });

  it("surfaces a rejected course create as the localised course.name_taken alert, never the raw code", async () => {
    const api = stubApi({
      createCourse: vi.fn().mockRejectedValue({ code: "course.name_taken" }),
    });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    type(el, "[data-new-course]", "Entrantes");
    q(el, "[data-add-course]")!.click();
    await flush(el);
    const alert = q(el, "[role=alert]");
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(codeMessage("course.name_taken", "es-ES"));
    expect(alert!.textContent).not.toContain("course.name_taken");
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

it.each([
  {
    method: "createCourse",
    field: "[data-new-course]",
    button: "[data-add-course]",
    result: { id: "c9" },
  },
  {
    method: "updateCourse",
    field: "[data-test=course-name-c1]",
    button: "[data-test=course-save-c1]",
    result: null,
  },
])(
  "Enter guards pending $method and allows retry after rejection",
  async ({ method, field, button, result }) => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    const request = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(result);
    const api = stubApi({ [method]: request });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);

    const control = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(field)!;
    await control.updateComplete;
    const input = control.shadowRoot!.querySelector("input")!;
    input.value = "Updated";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    el.shadowRoot!.querySelector<HTMLElement>(button)!.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect((el.shadowRoot!.querySelector(button) as import("@waitron/ui").WtButton).disabled).toBe(
      true,
    );
    reject({ code: "management.request_invalid" });
    await flush(el);
    input.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect((el.shadowRoot!.querySelector(button) as import("@waitron/ui").WtButton).disabled).toBe(
      false,
    );
  },
);

describe("kitchen-screen remaining edges", () => {
  function pressEnter(el: KitchenScreen, sel: string): void {
    q(el, sel)!
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
  }

  async function mountLoaded(api: DashboardApi): Promise<KitchenScreen> {
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await vi.waitFor(() => expect(q(el, "[data-test=course-row-c1]")).not.toBeNull());
    return el;
  }

  it("saves the course when Enter is pressed in its order field", async () => {
    const api = stubApi();
    const el = await mountLoaded(api);
    type(el, "[data-test=course-order-c1]", "3");
    await el.updateComplete;

    pressEnter(el, "[data-test=course-order-c1]");

    expect(api.updateCourse).toHaveBeenCalledWith("c1", { name: "Entrantes", displayOrder: 3 });
  });

  it("shows a localized alert when deactivating a course is rejected", async () => {
    const api = stubApi({
      deactivateCourse: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await mountLoaded(api);

    q(el, "[data-test=course-deactivate-c1]")!.click();

    await vi.waitFor(() =>
      expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
    );
    expect(api.listCourses).toHaveBeenCalledTimes(1);
  });

  it("does nothing when Save is pressed on a course that has since disappeared", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi({}, STATIONS, TWO_COURSES), { liveData });
    const el = await mountLoaded(api);
    const staleSave = q(el, "[data-test=course-save-c2]")!;
    vi.mocked(api.listCourses).mockResolvedValue(COURSES.map((c) => ({ ...c })));
    liveData.invalidate([{ type: "kitchen_courses", id: "c2" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=course-row-c2]")).toBeNull());

    staleSave.click();
    await el.updateComplete;

    expect(api.updateCourse).not.toHaveBeenCalled();
    expect(q(el, "[role=alert]")).toBeNull();
  });
});
