import { LiveData } from "@waitron/dashboard-kit";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtInput, WtRowActions } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { Course, DashboardApi } from "../api/client.js";
import { CourseList } from "./course-list.js";

afterEach(cleanupWidgets);

const COURSES: Course[] = [
  { id: "c1", name: "Starters", displayOrder: 0, active: true },
  { id: "c2", name: "Mains", displayOrder: 1, active: true },
  { id: "c3", name: "Desserts", displayOrder: 5, active: true },
];

const copy = (courses: Course[]): Course[] => courses.map((course) => ({ ...course }));

/** The list as the server would answer a move: `id` taken out and put back at `to`. */
function moved(courses: Course[], id: string, to: number): Course[] {
  const rest = courses.filter((course) => course.id !== id);
  rest.splice(
    to,
    0,
    courses.find((course) => course.id === id)!,
  );
  return rest.map((course, index) => ({ ...course, displayOrder: index }));
}

function stubApi(overrides: Partial<DashboardApi> = {}, courses: Course[] = COURSES): DashboardApi {
  return {
    listCourses: vi.fn().mockResolvedValue(copy(courses)),
    createCourse: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCourse: vi.fn().mockResolvedValue(undefined),
    deactivateCourse: vi.fn().mockResolvedValue(undefined),
    moveCourse: vi.fn((id: string, to: number) => Promise.resolve(moved(courses, id, to))),
    ...overrides,
  } as unknown as DashboardApi;
}

const q = <T extends Element = HTMLElement>(el: CourseList, selector: string): T | null =>
  el.shadowRoot!.querySelector<T>(selector);

const rowIds = (el: CourseList): (string | null)[] =>
  [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-course"));

const nameButton = (el: CourseList, id: string) => q(el, `[data-test="name-${id}"]`);
const field = (el: CourseList) => q<WtInput>(el, 'wt-input[name="course-name"]');
const alertLine = (el: CourseList) => q(el, "[role=alert]");

async function mount(
  api: DashboardApi,
  wait = true,
): Promise<{ el: CourseList; host: HTMLElement }> {
  const mounted = await mountWidget<CourseList>("dashboard-course-list", { api });
  if (wait) await vi.waitFor(() => expect(rowIds(mounted.el).length).toBeGreaterThan(0));
  return mounted;
}

async function settle(el: CourseList): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

async function typeName(el: CourseList, value: string): Promise<void> {
  const control = field(el)!;
  await control.updateComplete;
  const input = control.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function press(el: CourseList, key: string): Promise<void> {
  field(el)!.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard(`{${key}}`);
  await el.updateComplete;
}

function leaveField(el: CourseList): void {
  field(el)!.shadowRoot!.querySelector("input")!.blur();
}

async function openRename(el: CourseList, id: string): Promise<void> {
  nameButton(el, id)!.click();
  await el.updateComplete;
  await field(el)!.updateComplete;
}

async function openNew(el: CourseList): Promise<void> {
  q(el, '[data-test="add-course"]')!.click();
  await el.updateComplete;
  await field(el)!.updateComplete;
}

function capture<T>(target: EventTarget, type: string): T[] {
  const seen: T[] = [];
  target.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

describe("loading", () => {
  it("lists every course in the server's order, each name drawn as a button", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    expect(api.listCourses).toHaveBeenCalledTimes(1);
    expect(rowIds(el)).toEqual(["c1", "c2", "c3"]);
    expect(nameButton(el, "c2")!.tagName).toBe("BUTTON");
    expect(nameButton(el, "c2")!.textContent!.trim()).toBe("Mains");
    expect(nameButton(el, "c2")!.getAttribute("aria-label")).toBe(
      `${t("kitchen.rename_course")}: Mains`,
    );
  });

  it("shows the empty state when there are no courses", async () => {
    const api = stubApi({}, []);
    const { el } = await mount(api, false);
    await vi.waitFor(() => expect(q(el, '[data-test="empty"]')).not.toBeNull());
    expect(q(el, '[data-test="empty"]')!.textContent!.trim()).toBe(t("kitchen.no_courses"));
    expect(q(el, "table")).toBeNull();
  });

  it("clears a failed load's message once the server answers again", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        listCourses: vi
          .fn()
          .mockRejectedValueOnce({ code: "connection.failed" })
          .mockResolvedValue(copy(COURSES)),
      }),
      { liveData },
    );
    const { el } = await mount(api, false);
    await vi.waitFor(() =>
      expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("connection.failed")),
    );
    liveData.refresh();
    await vi.waitFor(() => expect(alertLine(el)).toBeNull());
    expect(rowIds(el)).toEqual(["c1", "c2", "c3"]);
  });

  it("keeps a later refusal when a failed load recovers", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({ deactivateCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }) }),
      { liveData },
    );
    const { el } = await mount(api);
    vi.mocked(api.listCourses).mockRejectedValueOnce({ code: "connection.failed" });
    liveData.refresh();
    await vi.waitFor(() =>
      expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("connection.failed")),
    );
    q(el, '[data-test="remove-c1"]')!.click();
    await vi.waitFor(() =>
      expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("course.not_found")),
    );
    liveData.refresh();
    await settle(el);
    expect(api.listCourses).toHaveBeenCalledTimes(3);
    expect(alertLine(el)!.textContent!.trim()).toBe(codeMessage("course.not_found"));
  });
});

describe("renaming", () => {
  it("opens a named, labelled field holding the name, with focus in it", async () => {
    const { el } = await mount(stubApi());
    await openRename(el, "c1");
    const control = field(el)!;
    expect(control.value).toBe("Starters");
    expect(control.label).toBe(t("kitchen.course_name"));
    expect(control.hideLabel).toBe(true);
    expect(control.required).toBe(true);
    expect(control.closest("tr")!.getAttribute("data-course")).toBe("c1");
    expect(el.shadowRoot!.activeElement).toBe(control);
  });

  it("opens from the keyboard: Enter on the name", async () => {
    const { el } = await mount(stubApi());
    nameButton(el, "c2")!.focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(field(el)!.value).toBe("Mains");
  });

  it("saves a changed, trimmed name on Enter, refreshes, and puts focus back on the name", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openRename(el, "c1");
    await typeName(el, "  Entrées  ");
    await press(el, "Enter");
    await settle(el);
    expect(api.updateCourse).toHaveBeenCalledTimes(1);
    expect(api.updateCourse).toHaveBeenCalledWith("c1", { name: "Entrées" });
    expect(api.listCourses).toHaveBeenCalledTimes(2);
    expect(field(el)).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(nameButton(el, "c1"));
  });

  it("saves a changed name when focus leaves the field", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openRename(el, "c2");
    await typeName(el, "Principales");
    leaveField(el);
    await settle(el);
    expect(api.updateCourse).toHaveBeenCalledWith("c2", { name: "Principales" });
    expect(field(el)).toBeNull();
  });

  it("closes an unchanged name without saving", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openRename(el, "c1");
    await typeName(el, " Starters ");
    await press(el, "Enter");
    await settle(el);
    expect(api.updateCourse).not.toHaveBeenCalled();
    expect(field(el)).toBeNull();
    expect(nameButton(el, "c1")!.textContent!.trim()).toBe("Starters");
  });

  it("reverts on Escape without saving, keeps the Escape to itself, and puts focus back on the name", async () => {
    const api = stubApi();
    const { el, host } = await mount(api);
    const escapes = vi.fn();
    host.addEventListener("keydown", (event) => {
      if (event.key === "Escape") escapes();
    });
    await openRename(el, "c1");
    await typeName(el, "Something else");
    await press(el, "Escape");
    await settle(el);
    expect(api.updateCourse).not.toHaveBeenCalled();
    expect(escapes).not.toHaveBeenCalled();
    expect(field(el)).toBeNull();
    expect(nameButton(el, "c1")!.textContent!.trim()).toBe("Starters");
    expect(el.shadowRoot!.activeElement).toBe(nameButton(el, "c1"));
  });

  it("refuses a blank name before sending, marking it under the field until it is changed", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openRename(el, "c1");
    await typeName(el, "   ");
    await press(el, "Enter");
    await settle(el);
    expect(api.updateCourse).not.toHaveBeenCalled();
    expect(field(el)!.error).toBe(t("kitchen.course_name_required"));
    leaveField(el);
    await settle(el);
    expect(api.updateCourse).not.toHaveBeenCalled();
    expect(field(el)!.error).toBe(t("kitchen.course_name_required"));
    await typeName(el, "Tapas");
    expect(field(el)!.error).toBe("");
    expect(alertLine(el)).toBeNull();
  });

  it("shows a taken name under the field, localised and never the raw code, keeping what was typed", async () => {
    const api = stubApi({ updateCourse: vi.fn().mockRejectedValue({ code: "course.name_taken" }) });
    const { el } = await mount(api);
    await openRename(el, "c2");
    await typeName(el, "Desserts");
    await press(el, "Enter");
    await settle(el);
    expect(field(el)!.error).toBe(codeMessage("course.name_taken"));
    expect(field(el)!.error).not.toContain("course.name_taken");
    expect(field(el)!.value).toBe("Desserts");
    expect(alertLine(el)).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(field(el));
    await typeName(el, "Desserts 2");
    expect(field(el)!.error).toBe("");
  });

  it("puts a refusal naming the field `name` under the field", async () => {
    const api = stubApi({
      updateCourse: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", params: { field: "name" } }),
    });
    const { el } = await mount(api);
    await openRename(el, "c2");
    await typeName(el, "Odd");
    await press(el, "Enter");
    await settle(el);
    expect(field(el)!.error).toBe(codeMessage("management.request_invalid"));
    expect(alertLine(el)).toBeNull();
  });

  it("shows a refusal naming no field in the alert line, keeping the field open", async () => {
    const api = stubApi({ updateCourse: vi.fn().mockRejectedValue({ code: "connection.failed" }) });
    const { el } = await mount(api);
    await openRename(el, "c2");
    await typeName(el, "Principales");
    await press(el, "Enter");
    await settle(el);
    expect(alertLine(el)!.textContent!.trim()).toBe(codeMessage("connection.failed"));
    expect(field(el)!.value).toBe("Principales");
    expect(field(el)!.error).toBe("");
  });

  it("sends a pending rename once however often Enter is pressed, and again after a refusal", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    const updateCourse = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const api = stubApi({ updateCourse });
    const { el } = await mount(api);
    await openRename(el, "c1");
    await typeName(el, "Entrées");
    await press(el, "Enter");
    await press(el, "Enter");
    leaveField(el);
    expect(updateCourse).toHaveBeenCalledTimes(1);
    reject({ code: "connection.failed" });
    await settle(el);
    await press(el, "Enter");
    await settle(el);
    expect(updateCourse).toHaveBeenCalledTimes(2);
    expect(field(el)).toBeNull();
  });

  it("shows the refusal of a rename left for another name in the alert line, leaving the other open", async () => {
    let reject!: (reason: unknown) => void;
    const updateCourse = vi.fn().mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const { el } = await mount(stubApi({ updateCourse }));
    await openRename(el, "c1");
    await typeName(el, "Entrées");
    leaveField(el);
    await openRename(el, "c2");
    reject({ code: "course.name_taken" });
    await settle(el);
    expect(alertLine(el)!.textContent!.trim()).toBe(codeMessage("course.name_taken"));
    expect(field(el)!.closest("tr")!.getAttribute("data-course")).toBe("c2");
    expect(field(el)!.error).toBe("");
  });

  it("leaves another name open when a rename left for it is saved", async () => {
    let resolve!: () => void;
    const updateCourse = vi.fn().mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const { el } = await mount(stubApi({ updateCourse }));
    await openRename(el, "c1");
    await typeName(el, "Entrées");
    leaveField(el);
    await openRename(el, "c2");
    resolve();
    await settle(el);
    expect(updateCourse).toHaveBeenCalledWith("c1", { name: "Entrées" });
    expect(field(el)!.closest("tr")!.getAttribute("data-course")).toBe("c2");
    expect(el.shadowRoot!.activeElement).toBe(field(el));
  });

  it("leaves other keys to the field", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openRename(el, "c2");
    field(el)!.shadowRoot!.querySelector("input")!.select();
    await userEvent.keyboard("Principales");
    await el.updateComplete;
    expect(field(el)!.value).toBe("Principales");
    expect(api.updateCourse).not.toHaveBeenCalled();
  });

  it("closes a rename whose course a refresh removed, without saving", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mount(api);
    await openRename(el, "c2");
    await typeName(el, "Gone");
    vi.mocked(api.listCourses).mockResolvedValue(copy(COURSES.filter((c) => c.id !== "c2")));
    liveData.invalidate([{ type: "kitchen_courses", id: "c2" }]);
    await vi.waitFor(() => expect(rowIds(el)).toEqual(["c1", "c3"]));
    expect(field(el)).toBeNull();
    expect(api.updateCourse).not.toHaveBeenCalled();
    expect(alertLine(el)).toBeNull();
  });
});

describe("adding", () => {
  it("Add course opens a new last row whose named field has focus", async () => {
    const { el } = await mount(stubApi());
    await openNew(el);
    const control = field(el)!;
    expect(control.value).toBe("");
    expect(control.label).toBe(t("kitchen.new_course"));
    expect(control.hideLabel).toBe(true);
    expect(control.closest("tr")!.getAttribute("data-course")).toBe("new");
    expect(rowIds(el)).toEqual(["c1", "c2", "c3"]);
    expect([...el.shadowRoot!.querySelectorAll("tr")].at(-1)).toBe(control.closest("tr"));
    expect(el.shadowRoot!.activeElement).toBe(control);
  });

  it("opens the new row from an open rename even when focus has not left the rename first", async () => {
    const { el } = await mount(stubApi());
    await openRename(el, "c2");
    expect(el.shadowRoot!.activeElement).toBe(field(el));
    q(el, '[data-test="add-course"]')!.click();
    await settle(el);
    expect(field(el)?.closest("tr")!.getAttribute("data-course")).toBe("new");
    expect(el.shadowRoot!.activeElement).toBe(field(el));
  });

  it("saves a typed rename that the new row replaced while its field still had focus", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openRename(el, "c1");
    await typeName(el, "Entrées");
    q(el, '[data-test="add-course"]')!.click();
    await settle(el);
    expect(api.updateCourse).toHaveBeenCalledWith("c1", { name: "Entrées" });
    expect(field(el)?.closest("tr")!.getAttribute("data-course")).toBe("new");
  });

  it("pressing Add course again keeps the one new row and what was typed in it", async () => {
    const { el } = await mount(stubApi());
    await openNew(el);
    await typeName(el, "Cof");
    q(el, '[data-test="add-course"]')!.click();
    await settle(el);
    expect(el.shadowRoot!.querySelectorAll('wt-input[name="course-name"]')).toHaveLength(1);
    expect(field(el)!.value).toBe("Cof");
    expect(el.shadowRoot!.activeElement).toBe(field(el));
  });

  it("creates on Enter after the last course shown, announces it, refreshes and returns focus to Add course", async () => {
    const api = stubApi();
    const { el, host } = await mount(api);
    const added = capture<{ id: string }>(host, "course-added");
    let composed = false;
    host.addEventListener("course-added", (event) => (composed = event.composed));
    await openNew(el);
    await typeName(el, "  Sharing plates ");
    await press(el, "Enter");
    await settle(el);
    expect(api.createCourse).toHaveBeenCalledWith({ name: "Sharing plates", displayOrder: 6 });
    expect(added).toEqual([{ id: "c9" }]);
    expect(composed).toBe(true);
    expect(api.listCourses).toHaveBeenCalledTimes(2);
    expect(field(el)).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(q(el, '[data-test="add-course"]'));
  });

  it("creates the first course at position 0", async () => {
    const api = stubApi({}, []);
    const { el } = await mount(api, false);
    await vi.waitFor(() => expect(q(el, '[data-test="empty"]')).not.toBeNull());
    await openNew(el);
    expect(q(el, "table")).not.toBeNull();
    await typeName(el, "Starters");
    await press(el, "Enter");
    await settle(el);
    expect(api.createCourse).toHaveBeenCalledWith({ name: "Starters", displayOrder: 0 });
  });

  it("creates when focus leaves a named new row", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openNew(el);
    await typeName(el, "Coffee");
    leaveField(el);
    await settle(el);
    expect(api.createCourse).toHaveBeenCalledWith({ name: "Coffee", displayOrder: 6 });
  });

  it("drops a blank new row when focus leaves it, and on Escape", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openNew(el);
    await typeName(el, "  ");
    leaveField(el);
    await settle(el);
    expect(field(el)).toBeNull();
    await openNew(el);
    await typeName(el, "Half typed");
    await press(el, "Escape");
    await settle(el);
    expect(field(el)).toBeNull();
    expect(api.createCourse).not.toHaveBeenCalled();
    expect(el.shadowRoot!.activeElement).toBe(q(el, '[data-test="add-course"]'));
  });

  it("refuses Enter on a blank new row before sending, marking it under the field", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openNew(el);
    await press(el, "Enter");
    await settle(el);
    expect(api.createCourse).not.toHaveBeenCalled();
    expect(field(el)!.error).toBe(t("kitchen.course_name_required"));
  });

  it("shows a taken name under the new field, localised and never the raw code", async () => {
    const api = stubApi({ createCourse: vi.fn().mockRejectedValue({ code: "course.name_taken" }) });
    const { el } = await mount(api);
    await openNew(el);
    await typeName(el, "Starters");
    await press(el, "Enter");
    await settle(el);
    expect(field(el)!.error).toBe(codeMessage("course.name_taken"));
    expect(field(el)!.error).not.toContain("course.name_taken");
    expect(alertLine(el)).toBeNull();
  });

  it("sends a pending create once however often Enter is pressed, and again after a refusal", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    const createCourse = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ id: "c9" });
    const api = stubApi({ createCourse });
    const { el } = await mount(api);
    await openNew(el);
    await typeName(el, "Coffee");
    await press(el, "Enter");
    await press(el, "Enter");
    expect(createCourse).toHaveBeenCalledTimes(1);
    reject({ code: "connection.failed" });
    await settle(el);
    expect(alertLine(el)!.textContent!.trim()).toBe(codeMessage("connection.failed"));
    await press(el, "Enter");
    await settle(el);
    expect(createCourse).toHaveBeenCalledTimes(2);
    expect(field(el)).toBeNull();
    expect(alertLine(el)).toBeNull();
  });

  it("closes the new row when the create succeeds, showing a failed refresh as a load failure", async () => {
    const api = stubApi({
      listCourses: vi
        .fn()
        .mockResolvedValueOnce(copy(COURSES))
        .mockRejectedValue({ code: "connection.failed" }),
    });
    const { el } = await mount(api);
    await openNew(el);
    await typeName(el, "Coffee");
    await press(el, "Enter");
    await settle(el);
    expect(api.createCourse).toHaveBeenCalledTimes(1);
    expect(field(el)).toBeNull();
    expect(alertLine(el)!.textContent!.trim()).toBe(codeMessage("connection.failed"));
  });
});

describe("settling", () => {
  it("settles once a name left in its field has been saved, with no name still open", async () => {
    let answer!: (value: { id: string }) => void;
    const createCourse = vi.fn(() => new Promise<{ id: string }>((resolve) => (answer = resolve)));
    const api = stubApi({ createCourse });
    const { el } = await mount(api);
    expect(el.unsaved).toBe(false);
    await openNew(el);
    expect(el.unsaved).toBe(true);
    await typeName(el, "Sharing plates");
    leaveField(el);
    let settled = false;
    void el.settled().then(() => (settled = true));
    await settle(el);
    expect([settled, createCourse.mock.calls.length]).toEqual([false, 1]);
    answer({ id: "c9" });
    await settle(el);
    expect([settled, el.unsaved]).toEqual([true, false]);
  });

  it("settles with the name still open when its save is refused", async () => {
    const api = stubApi({ createCourse: vi.fn().mockRejectedValue({ code: "course.name_taken" }) });
    const { el } = await mount(api);
    await openNew(el);
    await typeName(el, "Starters");
    leaveField(el);
    await el.settled();
    expect(el.unsaved).toBe(true);
  });
});

describe("removing", () => {
  it("offers Remove in each course's menu, which deactivates the course and refreshes", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const menu = q<WtRowActions>(el, 'tr[data-course="c2"] td:last-child wt-row-actions')!;
    expect(menu.label).toBe(`${t("kitchen.course_actions")}: Mains`);
    const remove = q(el, '[data-test="remove-c2"]')!;
    expect(remove.textContent!.trim()).toBe(t("action.remove"));
    remove.click();
    await settle(el);
    expect(api.deactivateCourse).toHaveBeenCalledWith("c2");
    expect(api.listCourses).toHaveBeenCalledTimes(2);
  });

  it("moves focus after a removal to the next course's name, else the previous, else Add course", async () => {
    const left = (ids: string[]) => copy(COURSES.filter((course) => ids.includes(course.id)));
    const api = stubApi({
      listCourses: vi
        .fn()
        .mockResolvedValueOnce(copy(COURSES))
        .mockResolvedValueOnce(left(["c1", "c3"]))
        .mockResolvedValueOnce(left(["c1"]))
        .mockResolvedValueOnce([]),
    });
    const { el } = await mount(api);
    q(el, '[data-test="remove-c2"]')!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(nameButton(el, "c3")));
    q(el, '[data-test="remove-c3"]')!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(nameButton(el, "c1")));
    q(el, '[data-test="remove-c1"]')!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.activeElement).toBe(q(el, '[data-test="add-course"]')),
    );
  });

  it("shows a refused removal in the alert line, localised", async () => {
    const api = stubApi({
      deactivateCourse: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const { el } = await mount(api);
    q(el, '[data-test="remove-c1"]')!.click();
    await vi.waitFor(() =>
      expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("connection.failed")),
    );
    expect(api.listCourses).toHaveBeenCalledTimes(1);
  });
});

describe("reordering", () => {
  it("labels each grip with the course's name", async () => {
    const { el } = await mount(stubApi());
    expect(q(el, '[data-test="drag-c3"]')!.getAttribute("aria-label")).toBe(
      `${t("kitchen.reorder_course")}: Desserts`,
    );
  });

  it("saves a key move at once and shows the server's answer, keeping focus on the grip", async () => {
    const answer = [COURSES[1]!, COURSES[0]!, { ...COURSES[2]!, name: "Puddings" }];
    const api = stubApi({ moveCourse: vi.fn().mockResolvedValue(copy(answer)) });
    const { el } = await mount(api);
    const grip = q(el, '[data-test="drag-c1"]')!;
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await el.updateComplete;
    expect(rowIds(el)).toEqual(["c2", "c1", "c3"]);
    expect(api.moveCourse).toHaveBeenCalledWith("c1", 1);
    await settle(el);
    expect(nameButton(el, "c3")!.textContent!.trim()).toBe("Puddings");
    expect(el.shadowRoot!.activeElement).toBe(q(el, '[data-test="drag-c1"]'));
  });

  it("sends quick key moves one after another and shows the last answer", async () => {
    const answers: ((courses: Course[]) => void)[] = [];
    const moveCourse = vi.fn(() => new Promise<Course[]>((resolve) => answers.push(resolve)));
    const api = stubApi({ moveCourse });
    const { el } = await mount(api);
    const grip = () => q(el, '[data-test="drag-c1"]')!;
    grip().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await el.updateComplete;
    grip().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await settle(el);
    expect(rowIds(el)).toEqual(["c2", "c3", "c1"]);
    expect(moveCourse).toHaveBeenCalledTimes(1);
    answers[0]!(moved(COURSES, "c1", 1));
    await settle(el);
    // An answer with another move still to come would pull the row back under the keyboard.
    expect(rowIds(el)).toEqual(["c2", "c3", "c1"]);
    expect(moveCourse).toHaveBeenCalledTimes(2);
    expect(moveCourse).toHaveBeenLastCalledWith("c1", 2);
    answers[1]!(moved(moved(COURSES, "c1", 1), "c1", 2));
    await settle(el);
    expect(rowIds(el)).toEqual(["c2", "c3", "c1"]);
  });

  /** Presses on a course's grip, crosses the rows named in `over` one by one, then lets go. */
  async function drag(el: CourseList, id: string, over: string[]): Promise<void> {
    q(el, `[data-test="drag-${id}"]`)!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 9 }),
    );
    for (const target of over) {
      const box = q(el, `tr[data-course="${target}"]`)!.getBoundingClientRect();
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 9,
          clientY: box.top + box.height / 2,
        }),
      );
      await el.updateComplete;
    }
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9 }));
    await el.updateComplete;
  }

  it("saves a pointer drag once, when it ends, with the row's final place", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await drag(el, "c1", ["c2", "c3"]);
    await settle(el);
    expect(api.moveCourse).toHaveBeenCalledTimes(1);
    expect(api.moveCourse).toHaveBeenCalledWith("c1", 2);
    expect(rowIds(el)).toEqual(["c2", "c3", "c1"]);
  });

  it("saves nothing for a drag that ends where it started", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await drag(el, "c1", ["c2", "c2"]);
    await drag(el, "c2", []);
    await settle(el);
    expect(api.moveCourse).not.toHaveBeenCalled();
  });

  it("saves nothing for a drag whose course a refresh removed mid-gesture", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mount(api);
    q(el, '[data-test="drag-c1"]')!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 7 }),
    );
    vi.mocked(api.listCourses).mockResolvedValue(copy(COURSES.filter((c) => c.id !== "c1")));
    liveData.invalidate([{ type: "kitchen_courses", id: "c1" }]);
    await vi.waitFor(() => expect(rowIds(el)).toEqual(["c2", "c3"]));
    const box = q(el, 'tr[data-course="c3"]')!.getBoundingClientRect();
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 7,
        clientY: box.top + box.height / 2,
      }),
    );
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7 }));
    await settle(el);
    expect(rowIds(el)).toEqual(["c2", "c3"]);
    expect(api.moveCourse).not.toHaveBeenCalled();
  });

  it("puts a refused move back in the server's order and shows the refusal", async () => {
    const api = stubApi({ moveCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }) });
    const { el } = await mount(api);
    q(el, '[data-test="drag-c1"]')!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await el.updateComplete;
    expect(rowIds(el)).toEqual(["c2", "c1", "c3"]);
    await settle(el);
    expect(api.listCourses).toHaveBeenCalledTimes(2);
    expect(rowIds(el)).toEqual(["c1", "c2", "c3"]);
    expect(alertLine(el)!.textContent!.trim()).toBe(codeMessage("course.not_found"));
  });
});
