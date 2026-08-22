import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { Course, DashboardApi, FireControl, Station } from "../api/client.js";
import { KitchenScreen } from "./kitchen-screen.js";

/**
 * The Cocina (kitchen) config screen. Its `api` is a stub: `listStations` returns a known list the
 * screen loads on connect, and the CRUD + default + bump-mode verbs are spies the per-item mutation
 * paths call (each station mutation followed by a reload). Assertions cover each behaviour on its own:
 * the station panel LOADS from `listStations`; the new-station form calls `createStation({ name })`
 * and reloads; an empty name creates nothing; a station-row edit calls `updateStation` with the row's
 * CURRENT values and reloads; a deactivate soft-deletes; "make default" calls `setDefaultStation`; the
 * bump-mode toggle calls `setBumpMode`; and any rejected mutation/load surfaces a `role="alert"` whose
 * text is the LOCALISED copy for the code, never the raw wire code. Mirrors `floor-screen.test.ts`.
 */

afterEach(cleanupWidgets);

const STATIONS: Station[] = [
  { id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
];

/** Two stations — a default + a non-default — so a per-row edit exercises the "leave the other row
 * alone" branch, and "make default" targets the non-default one while the default shows its badge. */
const TWO_STATIONS: Station[] = [
  { id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
  { id: "s2", name: "Plancha", displayOrder: 1, isDefault: false, active: true },
];

const COURSES: Course[] = [{ id: "c1", name: "Entrantes", displayOrder: 0, active: true }];

/** Two courses so a per-row edit exercises the "leave the other row alone" map branch. */
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

/** Settles the in-flight listStations and the follow-up render. */
async function flush(el: KitchenScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: KitchenScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

/** Fire a wt-input's composed change, exactly as `wt-input` dispatches it. */
function type(el: KitchenScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

describe("kitchen-screen", () => {
  it("loads and lists the stations on connect (one h1)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(api.listStations).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=station-row-s1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });

  it("shows the empty state when there are no stations", async () => {
    const api = stubApi({}, []);
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("kitchen.no_stations", "es-ES"));
  });

  it("creates a station from the new-station form (createStation with the name), then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    type(el, "[data-new-station]", "Plancha");
    q(el, "[data-add-station]")!.click();
    await flush(el);
    expect(api.createStation).toHaveBeenCalledWith({ name: "Plancha" });
    expect(api.listStations).toHaveBeenCalledTimes(2); // initial + reload after create
  });

  it("does not create an empty-name station", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-add-station]")!.click();
    await flush(el);
    expect(api.createStation).not.toHaveBeenCalled();
  });

  it("saves an edited station row (updateStation with the row's current name + order), then reloads", async () => {
    // Two rows, so editing s2 also exercises the "leave the other row untouched" map branch.
    const api = stubApi({}, TWO_STATIONS);
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    type(el, "[data-test=station-name-s2]", "Pase");
    // A non-numeric order coerces to 0 (the falsy `|| 0` branch); then a real number.
    type(el, "[data-test=station-order-s2]", "x");
    type(el, "[data-test=station-order-s2]", "3");
    q(el, "[data-test=station-save-s2]")!.click();
    await flush(el);
    expect(api.updateStation).toHaveBeenCalledTimes(1);
    expect(api.updateStation).toHaveBeenCalledWith("s2", { name: "Pase", displayOrder: 3 });
    expect(api.listStations).toHaveBeenCalledTimes(2);
  });

  it("deactivates a station row", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-test=station-deactivate-s1]")!.click();
    await flush(el);
    expect(api.deactivateStation).toHaveBeenCalledWith("s1");
    expect(api.listStations).toHaveBeenCalledTimes(2);
  });

  it("makes a non-default station the default (setDefaultStation), then reloads", async () => {
    const api = stubApi({}, TWO_STATIONS);
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    // The already-default station shows its badge and offers no make-default button…
    expect(q(el, "[data-test=station-default-s1]")).toBeNull();
    expect(q(el, "[data-test=station-row-s1]")!.textContent).toContain(
      t("kitchen.default_badge", "es-ES"),
    );
    // …the non-default one offers the button.
    q(el, "[data-test=station-default-s2]")!.click();
    await flush(el);
    expect(api.setDefaultStation).toHaveBeenCalledWith("s2");
    expect(api.listStations).toHaveBeenCalledTimes(2);
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

  it("surfaces a rejected create as a localised role=alert banner, never the raw code", async () => {
    const api = stubApi({
      createStation: vi.fn().mockRejectedValue({ code: "station.name_taken" }),
    });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    type(el, "[data-new-station]", "Cocina");
    q(el, "[data-add-station]")!.click();
    await flush(el);
    const alert = q(el, "[role=alert]");
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(codeMessage("station.name_taken", "es-ES"));
    expect(alert!.textContent).not.toContain("station.name_taken");
  });

  it("surfaces a rejected load as a localised role=alert banner", async () => {
    const api = stubApi({
      listStations: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(q(el, "[role=alert]")).not.toBeNull();
  });

  it("surfaces a rejected make-default as the localised station.not_found alert", async () => {
    const api = stubApi(
      { setDefaultStation: vi.fn().mockRejectedValue({ code: "station.not_found" }) },
      TWO_STATIONS,
    );
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-test=station-default-s2]")!.click();
    await flush(el);
    const alert = q(el, "[role=alert]");
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(codeMessage("station.not_found", "es-ES"));
  });

  it("surfaces a rejected bump-mode write as a localised role=alert banner", async () => {
    const api = stubApi({ setBumpMode: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-test=bump-ticket]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")).not.toBeNull();
  });

  // ── KDS-2 (§5c): the Cursos panel + the fire-control toggle ────────────────────────────────────────

  it("loads and lists the courses on connect (beside the stations)", async () => {
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
    expect(api.listCourses).toHaveBeenCalledTimes(2); // initial + reload after create
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
    // Two rows, so editing c2 also exercises the "leave the other row untouched" map branch.
    const api = stubApi({}, STATIONS, TWO_COURSES);
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    type(el, "[data-test=course-name-c2]", "Café");
    type(el, "[data-test=course-order-c2]", "x"); // non-numeric coerces to 0 (the `|| 0` branch)
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
    // The persisted setting is `kitchen`, so on load the Kitchen option is primary (selected).
    const api = stubApi({}, STATIONS, COURSES, "kitchen");
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(api.getFireControl).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=fire-kitchen]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=fire-waiter]")!.getAttribute("variant")).toBe("secondary");
  });

  it("toggles the fire-control mode to kitchen and back to waiter", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    q(el, "[data-test=fire-kitchen]")!.click();
    await flush(el);
    expect(api.setFireControl).toHaveBeenNthCalledWith(1, "kitchen");
    q(el, "[data-test=fire-waiter]")!.click();
    await flush(el);
    expect(api.setFireControl).toHaveBeenNthCalledWith(2, "waiter");
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
