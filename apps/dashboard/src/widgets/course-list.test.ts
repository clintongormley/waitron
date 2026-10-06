import { LiveData } from "@waitron/dashboard-kit";
import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleWithin, textLines } from "@waitron/ui/src/test-helpers.js";
import type { WtInput, WtRowActions } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { Course, DashboardApi } from "../api/client.js";
import { CourseList } from "./course-list.js";

afterEach(cleanupWidgets);

const COURSES: Course[] = [
  { id: "c1", name: "Starters", displayOrder: 0, active: true, inUse: false },
  { id: "c2", name: "Mains", displayOrder: 1, active: true, inUse: true },
  { id: "c3", name: "Desserts", displayOrder: 5, active: true, inUse: false },
];

/** Disabled courses, which the server lists in firing order among the active ones. */
const DISABLED: Course[] = [
  { id: "d1", name: "Brunch", displayOrder: 1, active: false, inUse: true },
  { id: "d2", name: "Tapas", displayOrder: 3, active: false, inUse: false },
];

/** Every course in the server's order: by `displayOrder`, disabled ones mixed in. */
const ALL: Course[] = [COURSES[0]!, DISABLED[0]!, COURSES[1]!, DISABLED[1]!, COURSES[2]!];

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
    listCourses: vi.fn().mockResolvedValue(copy(courses.filter((course) => course.active))),
    listCoursesWithDisabled: vi.fn().mockResolvedValue(copy(courses)),
    createCourse: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCourse: vi.fn().mockResolvedValue(undefined),
    removeCourse: vi.fn().mockResolvedValue(undefined),
    enableCourse: vi.fn().mockResolvedValue(undefined),
    moveCourse: vi.fn((id: string, to: number) =>
      Promise.resolve(
        moved(
          courses.filter((course) => course.active),
          id,
          to,
        ),
      ),
    ),
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

const deleteDialog = (el: CourseList) => q(el, '[data-test="delete-course-modal"]');

/** Confirms the Delete dialog a course's Delete opened. */
async function confirmDelete(el: CourseList): Promise<void> {
  await vi.waitFor(() => expect(q(el, '[data-test="confirm-delete-course"]')).not.toBeNull());
  q(el, '[data-test="confirm-delete-course"]')!.click();
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
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(1);
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
        listCoursesWithDisabled: vi
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
      stubApi({ removeCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }) }),
      { liveData },
    );
    const { el } = await mount(api);
    vi.mocked(api.listCoursesWithDisabled).mockRejectedValueOnce({ code: "connection.failed" });
    liveData.refresh();
    await vi.waitFor(() =>
      expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("connection.failed")),
    );
    q(el, '[data-test="remove-c2"]')!.click();
    await vi.waitFor(() =>
      expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("course.not_found")),
    );
    liveData.refresh();
    await settle(el);
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(3);
    expect(alertLine(el)!.textContent!.trim()).toBe(codeMessage("course.not_found"));
  });

  it("keeps a removal's connection failure through a failed re-read and the reads' recovery", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({ removeCourse: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData },
    );
    const { el } = await mount(api);
    vi.mocked(api.listCoursesWithDisabled).mockRejectedValue({ code: "connection.failed" });
    liveData.refresh();
    await vi.waitFor(() =>
      expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("connection.failed")),
    );
    q(el, '[data-test="remove-c2"]')!.click();
    await vi.waitFor(() => expect(api.removeCourse).toHaveBeenCalledTimes(1));
    await settle(el);
    liveData.refresh();
    await vi.waitFor(() => expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(3));
    await settle(el);

    vi.mocked(api.listCoursesWithDisabled).mockResolvedValue(
      copy(COURSES.filter((course) => course.id !== "c2")),
    );
    liveData.refresh();
    await vi.waitFor(() => expect(rowIds(el)).toEqual(["c1", "c3"]));
    await settle(el);
    expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("connection.failed"));
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
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(2);
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

  it("takes no typing while a rename is being saved, and takes it again once the save is refused", async () => {
    let refuse!: (reason: unknown) => void;
    const updateCourse = vi.fn().mockReturnValueOnce(
      new Promise((_, fail) => {
        refuse = fail;
      }),
    );
    const { el } = await mount(stubApi({ updateCourse }));
    await openRename(el, "c1");
    await typeName(el, "Coffee");
    await press(el, "Enter");
    await userEvent.keyboard("Tea");
    await el.updateComplete;
    const input = () => field(el)!.shadowRoot!.querySelector("input")!;
    expect(input().value).toBe("Coffee");
    expect(field(el)!.shadowRoot!.activeElement).toBe(input());
    refuse({ code: "connection.failed" });
    await settle(el);
    await press(el, "End");
    await userEvent.keyboard("s");
    expect(input().value).toBe("Coffees");
    expect(updateCourse.mock.calls).toEqual([["c1", { name: "Coffee" }]]);
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
    vi.mocked(api.listCoursesWithDisabled).mockResolvedValue(
      copy(COURSES.filter((c) => c.id !== "c2")),
    );
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
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(2);
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
      listCoursesWithDisabled: vi
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

  it("settles only once a change made while it waited has been answered too", async () => {
    let answerCreate!: (value: { id: string }) => void;
    let answerRemoval!: () => void;
    const api = stubApi({
      createCourse: vi.fn(() => new Promise<{ id: string }>((resolve) => (answerCreate = resolve))),
      removeCourse: vi.fn(() => new Promise<void>((resolve) => (answerRemoval = resolve))),
    });
    const { el } = await mount(api);
    await openNew(el);
    await typeName(el, "Sharing plates");
    leaveField(el);
    let settled = false;
    void el.settled().then(() => (settled = true));
    q(el, '[data-test="remove-c2"]')!.click();
    await settle(el);
    answerCreate({ id: "c9" });
    await settle(el);
    expect([settled, vi.mocked(api.removeCourse).mock.calls]).toEqual([false, [["c2"]]]);
    answerRemoval();
    await settle(el);
    expect(settled).toBe(true);
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

  it("does not read the courses again for a save answered after the list left the page", async () => {
    let answer!: () => void;
    const updateCourse = vi.fn(() => new Promise<void>((resolve) => (answer = resolve)));
    const api = stubApi({ updateCourse });
    const { el } = await mount(api);
    await openRename(el, "c1");
    await typeName(el, "Entrées");
    await press(el, "Enter");
    await settle(el);
    el.remove();
    answer();
    await el.settled();
    await settle(el);
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(1);
  });
});

describe("removing", () => {
  it("offers Delete in an unreferenced course's menu, which asks first, then removes the course and refreshes", async () => {
    const before = currentLocale();
    setLocale("en-GB");
    try {
      const api = stubApi();
      const { el } = await mount(api);
      const menu = q<WtRowActions>(el, 'tr[data-course="c1"] td:last-child wt-row-actions')!;
      expect(menu.label).toBe(`${t("kitchen.course_actions")}: Starters`);
      const remove = q(el, '[data-test="remove-c1"]')!;
      expect(remove.textContent!.trim()).toBe(t("action.delete"));
      remove.click();
      await settle(el);
      expect(api.removeCourse).not.toHaveBeenCalled();
      const dialog = deleteDialog(el)! as HTMLElement & { heading: string };
      expect(dialog.getAttribute("size")).toBe("compact");
      expect(dialog.heading).toBe("Delete course");
      expect(dialog.querySelector("p")!.textContent!.trim()).toBe(
        "Delete Starters? This cannot be undone.",
      );
      const confirm = q(el, '[data-test="confirm-delete-course"]')!;
      expect(confirm.getAttribute("variant")).toBe("danger");
      expect(confirm.textContent!.trim()).toBe("Delete");
      confirm.click();
      await settle(el);
      expect(vi.mocked(api.removeCourse).mock.calls).toEqual([["c1"]]);
      expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(2);
      expect(deleteDialog(el)).toBeNull();
    } finally {
      setLocale(before);
    }
  });

  it("words the Delete dialog in Spanish", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mount(stubApi());
      q(el, '[data-test="remove-c1"]')!.click();
      await settle(el);
      const dialog = deleteDialog(el)! as HTMLElement & { heading: string };
      expect(dialog.heading).toBe("Eliminar curso");
      expect(dialog.querySelector("p")!.textContent!.trim()).toBe(
        "¿Eliminar Starters? Esta acción no se puede deshacer.",
      );
      expect(q(el, '[data-test="confirm-delete-course"]')!.textContent!.trim()).toBe("Eliminar");
    } finally {
      setLocale(before);
    }
  });

  it.each(["cancel", "dismiss"])("%s on the Delete dialog removes nothing", async (how) => {
    const api = stubApi();
    const { el } = await mount(api);
    q(el, '[data-test="remove-c1"]')!.click();
    await settle(el);
    const dialog = deleteDialog(el)!;
    if (how === "dismiss") dialog.dispatchEvent(new CustomEvent("wt-close"));
    else dialog.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
    await settle(el);
    expect(deleteDialog(el)).toBeNull();
    expect(api.removeCourse).not.toHaveBeenCalled();
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(1);
  });

  it("keeps a refused Delete in its dialog, localised, and sends it again on confirm", async () => {
    const api = stubApi({
      removeCourse: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(undefined),
    });
    const { el } = await mount(api);
    q(el, '[data-test="remove-c1"]')!.click();
    await confirmDelete(el);
    await settle(el);
    const actions = deleteDialog(el)!.querySelector<HTMLElement & { error: string }>(
      "wt-form-actions",
    )!;
    expect(actions.error).toBe(codeMessage("connection.failed"));
    expect(alertLine(el)).toBeNull();
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(1);
    expect(q(el, '[data-test="confirm-delete-course"]')!.hasAttribute("disabled")).toBe(false);
    await confirmDelete(el);
    await settle(el);
    expect(vi.mocked(api.removeCourse).mock.calls).toEqual([["c1"], ["c1"]]);
    expect(deleteDialog(el)).toBeNull();
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(2);
  });

  it("offers Disable in a referenced course's menu, which removes the course and refreshes", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const remove = q(el, '[data-test="remove-c2"]')!;
    expect(remove.textContent!.trim()).toBe(t("action.disable"));
    remove.click();
    await settle(el);
    expect(deleteDialog(el)).toBeNull();
    expect(vi.mocked(api.removeCourse).mock.calls).toEqual([["c2"]]);
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(2);
  });

  it("offers no Enable on an active course", async () => {
    const { el } = await mount(stubApi({}, ALL));
    for (const id of ["c1", "c2", "c3"]) expect(q(el, `[data-test="enable-${id}"]`)).toBeNull();
    expect(
      [...q(el, 'tr[data-course="c2"] wt-row-actions')!.querySelectorAll("wt-button")].map(
        (button) => button.textContent!.trim(),
      ),
    ).toEqual([t("action.disable")]);
  });

  it("moves focus after a removal to the next course's name, else the previous, else Add course", async () => {
    const left = (ids: string[]) => copy(COURSES.filter((course) => ids.includes(course.id)));
    const api = stubApi({
      listCoursesWithDisabled: vi
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
    await confirmDelete(el);
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(nameButton(el, "c1")));
    q(el, '[data-test="remove-c1"]')!.click();
    await confirmDelete(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.activeElement).toBe(q(el, '[data-test="add-course"]')),
    );
  });

  it("shows a refused Disable in the alert line, localised", async () => {
    const api = stubApi({
      removeCourse: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const { el } = await mount(api);
    q(el, '[data-test="remove-c2"]')!.click();
    await vi.waitFor(() =>
      expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("connection.failed")),
    );
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(1);
  });
});

describe("disabled courses", () => {
  const menuLabels = (el: CourseList, id: string) =>
    [...q(el, `tr[data-course="${id}"] wt-row-actions`)!.querySelectorAll("wt-button")].map(
      (button) => button.textContent!.trim(),
    );
  const statusOf = (el: CourseList, id: string) => q(el, `[data-test="status-${id}"]`);

  it("lists disabled courses after the active ones, each named and marked Disabled", async () => {
    const api = stubApi({}, ALL);
    const { el } = await mount(api);
    expect(rowIds(el)).toEqual(["c1", "c2", "c3", "d1", "d2"]);
    const cell = q(el, 'tr[data-course="d1"] td:nth-child(2)')!;
    expect(cell.textContent!.replace(/\s+/g, " ").trim()).toBe(`Brunch ${t("status.disabled")}`);
    expect(statusOf(el, "d1")!.textContent!.trim()).toBe(t("status.disabled"));
    for (const id of ["c1", "c2", "c3"]) expect(statusOf(el, id)).toBeNull();
  });

  it("lists the disabled courses rather than the empty state when no course is active", async () => {
    const { el } = await mount(stubApi({}, DISABLED));
    expect(rowIds(el)).toEqual(["d1", "d2"]);
    expect(q(el, '[data-test="empty"]')).toBeNull();
  });

  it("draws a disabled course's name muted, with a gap before its status", async () => {
    const { el } = await mount(stubApi({}, ALL));
    const name = q(el, '[data-test="disabled-name-d1"]')!;
    const status = statusOf(el, "d1")!;
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-text-muted)";
    el.shadowRoot!.appendChild(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    expect(getComputedStyle(name).color).toBe(muted);
    expect(getComputedStyle(nameButton(el, "c1")!).color).not.toBe(muted);
    expect(
      status.getBoundingClientRect().left - name.getBoundingClientRect().right,
    ).toBeGreaterThan(2);
  });

  it("gives a disabled course no grip and no rename", async () => {
    const { el } = await mount(stubApi({}, ALL));
    for (const id of ["c1", "c2", "c3"]) expect(q(el, `[data-test="drag-${id}"]`)).not.toBeNull();
    for (const id of ["d1", "d2"]) {
      expect(q(el, `[data-test="drag-${id}"]`)).toBeNull();
      expect(nameButton(el, id)).toBeNull();
      expect(q(el, `tr[data-course="${id}"] button`)).toBeNull();
    }
  });

  it("offers Enable on a disabled course, and Delete as well only when nothing refers to it", async () => {
    const { el } = await mount(stubApi({}, ALL));
    expect(menuLabels(el, "d1")).toEqual([t("action.enable")]);
    expect(menuLabels(el, "d2")).toEqual([t("action.enable"), t("action.delete")]);
    expect(q<WtRowActions>(el, 'tr[data-course="d1"] wt-row-actions')!.label).toBe(
      `${t("kitchen.course_actions")}: Brunch`,
    );
  });

  it("enables a disabled course as itself, refreshes, and puts focus on its name", async () => {
    const enabled = ALL.map((course) =>
      course.id === "d1" ? { ...course, active: true } : course,
    );
    const api = stubApi({
      listCoursesWithDisabled: vi
        .fn()
        .mockResolvedValueOnce(copy(ALL))
        .mockResolvedValue(copy(enabled)),
    });
    const { el } = await mount(api);
    q(el, '[data-test="enable-d1"]')!.click();
    await vi.waitFor(() => expect(nameButton(el, "d1")).not.toBeNull());
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(nameButton(el, "d1")));
    expect(vi.mocked(api.enableCourse).mock.calls).toEqual([["d1"]]);
    expect(api.removeCourse).not.toHaveBeenCalled();
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(2);
    expect(rowIds(el)).toEqual(["c1", "d1", "c2", "c3", "d2"]);
    expect(statusOf(el, "d1")).toBeNull();
  });

  it("deletes a disabled course nothing refers to through the same removal", async () => {
    const api = stubApi({}, ALL);
    const { el } = await mount(api);
    q(el, '[data-test="remove-d2"]')!.click();
    await confirmDelete(el);
    await settle(el);
    expect(vi.mocked(api.removeCourse).mock.calls).toEqual([["d2"]]);
    expect(api.enableCourse).not.toHaveBeenCalled();
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(2);
  });

  it("moves focus after deleting a disabled course to the next disabled course's menu", async () => {
    const api = stubApi({
      listCoursesWithDisabled: vi
        .fn()
        .mockResolvedValueOnce(copy(ALL))
        .mockResolvedValue(copy(ALL.filter((course) => course.id !== "d2"))),
    });
    const { el } = await mount(api);
    q(el, '[data-test="remove-d2"]')!.click();
    await confirmDelete(el);
    const menu = () => q(el, 'tr[data-course="d1"] wt-row-actions');
    await vi.waitFor(() => expect(rowIds(el)).toEqual(["c1", "c2", "c3", "d1"]));
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(menu()));
  });

  it("shows a refused Enable in the alert line, localised", async () => {
    const api = stubApi(
      { enableCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }) },
      ALL,
    );
    const { el } = await mount(api);
    q(el, '[data-test="enable-d1"]')!.click();
    await vi.waitFor(() =>
      expect(alertLine(el)?.textContent?.trim()).toBe(codeMessage("course.not_found")),
    );
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(1);
  });

  it("moves only the active courses and keeps the disabled ones listed after them", async () => {
    const api = stubApi({}, ALL);
    const { el } = await mount(api);
    q(el, '[data-test="drag-c3"]')!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    await el.updateComplete;
    expect(rowIds(el)).toEqual(["c1", "c3", "c2", "d1", "d2"]);
    await settle(el);
    expect(vi.mocked(api.moveCourse).mock.calls).toEqual([["c3", 1]]);
    expect(rowIds(el)).toEqual(["c1", "c3", "c2", "d1", "d2"]);
  });

  it.each([
    ["en-GB", ["Delete", "Disable", "Enable", "Disabled"]],
    ["es-ES", ["Eliminar", "Deshabilitar", "Habilitar", "Deshabilitado"]],
  ] as const)("reads Delete, Disable, Enable and Disabled in %s", async (locale, words) => {
    const [remove, disable, enable, status] = words;
    const before = currentLocale();
    setLocale(locale);
    try {
      const { el } = await mount(stubApi({}, ALL));
      expect(menuLabels(el, "c1")).toEqual([remove]);
      expect(menuLabels(el, "c2")).toEqual([disable]);
      expect(menuLabels(el, "d1")).toEqual([enable]);
      expect(menuLabels(el, "d2")).toEqual([enable, remove]);
      expect(statusOf(el, "d1")!.textContent!.trim()).toBe(status);
    } finally {
      setLocale(before);
    }
  });

  const listed = (el: CourseList) =>
    [...el.shadowRoot!.querySelectorAll("li")].map((item) => item.getAttribute("data-course"));

  it("reads and shows only the active courses when read-only", async () => {
    const api = stubApi({}, ALL);
    const { el } = await mountWidget<CourseList>("dashboard-course-list", { api, readOnly: true });
    await vi.waitFor(() => expect(listed(el)).toEqual(["c1", "c2", "c3"]));
    expect(el.shadowRoot!.textContent).not.toContain("Brunch");
    expect(api.listCourses).toHaveBeenCalledTimes(1);
    expect(api.listCoursesWithDisabled).not.toHaveBeenCalled();
  });

  it("reads the list again when it turns read-only, or editable, once shown", async () => {
    const api = stubApi({}, ALL);
    const { el } = await mount(api);
    el.readOnly = true;
    await vi.waitFor(() => expect(listed(el)).toEqual(["c1", "c2", "c3"]));
    expect(api.listCourses).toHaveBeenCalledTimes(1);
    el.readOnly = false;
    await vi.waitFor(() => expect(rowIds(el)).toEqual(["c1", "c2", "c3", "d1", "d2"]));
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(2);
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

  it("puts quick key moves back in the server's order when the first is refused", async () => {
    let refuse!: (reason: unknown) => void;
    const moveCourse = vi.fn(
      () =>
        new Promise<Course[]>((_, fail) => {
          refuse = fail;
        }),
    );
    const api = stubApi({ moveCourse });
    const { el } = await mount(api);
    const grip = () => q(el, '[data-test="drag-c1"]')!;
    grip().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await el.updateComplete;
    grip().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await settle(el);
    expect(rowIds(el)).toEqual(["c2", "c3", "c1"]);
    refuse({ code: "course.not_found" });
    await settle(el);
    expect(moveCourse).toHaveBeenCalledTimes(1);
    expect(rowIds(el)).toEqual(["c1", "c2", "c3"]);
  });

  it("shows a rename saved while a move was out once the move is answered, when no later read comes", async () => {
    let server = copy(COURSES);
    let answerRename!: () => void;
    let answerMove!: () => void;
    const updateCourse = vi
      .fn()
      .mockImplementationOnce(
        (id: string, { name }: { name: string }) =>
          new Promise<void>((resolve) => {
            answerRename = () => {
              server = server.map((course) => (course.id === id ? { ...course, name } : course));
              resolve();
            };
          }),
      )
      .mockRejectedValueOnce({ code: "connection.failed" });
    const api = stubApi({
      listCoursesWithDisabled: vi.fn(() => Promise.resolve(copy(server))),
      updateCourse,
      moveCourse: vi.fn(
        (id: string, to: number) =>
          new Promise<Course[]>((resolve) => {
            answerMove = () => {
              server = moved(server, id, to);
              resolve(copy(server));
            };
          }),
      ),
    });
    const { el } = await mount(api);
    await openRename(el, "c1");
    await typeName(el, "Entrées");
    await press(el, "Enter");
    q(el, '[data-test="drag-c3"]')!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    await el.updateComplete;
    await openRename(el, "c2");
    await typeName(el, "Principales");
    await press(el, "Enter");
    answerRename();
    await settle(el);
    answerMove();
    await settle(el);
    expect(updateCourse).toHaveBeenCalledTimes(2);
    expect(rowIds(el)).toEqual(["c1", "c3", "c2"]);
    expect(nameButton(el, "c1")!.textContent!.trim()).toBe("Entrées");
  });

  it("keeps rows moved while a rename was saved where they were put when the rename's refresh lands", async () => {
    let server = copy(COURSES);
    let answerRename!: () => void;
    const answers: (() => void)[] = [];
    const api = stubApi({
      listCoursesWithDisabled: vi.fn(() => Promise.resolve(copy(server))),
      updateCourse: vi.fn(
        (id: string, { name }: { name: string }) =>
          new Promise<void>((resolve) => {
            answerRename = () => {
              server = server.map((course) => (course.id === id ? { ...course, name } : course));
              resolve();
            };
          }),
      ),
      moveCourse: vi.fn(
        (id: string, to: number) =>
          new Promise<Course[]>((resolve) =>
            answers.push(() => {
              server = moved(server, id, to);
              resolve(copy(server));
            }),
          ),
      ),
    });
    const { el } = await mount(api);
    await openRename(el, "c2");
    await typeName(el, "Principales");
    await press(el, "Enter");
    async function key(name: string): Promise<void> {
      q(el, '[data-test="drag-c1"]')!.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true }),
      );
      await el.updateComplete;
    }
    await key("ArrowDown");
    await key("ArrowDown");
    expect(rowIds(el)).toEqual(["c2", "c3", "c1"]);
    answerRename();
    await settle(el);
    expect(rowIds(el)).toEqual(["c2", "c3", "c1"]);
    await key("ArrowUp");
    while (answers.length > 0) {
      answers.shift()!();
      await settle(el);
    }
    expect(vi.mocked(api.moveCourse).mock.calls).toEqual([
      ["c1", 1],
      ["c1", 2],
      ["c1", 1],
    ]);
    expect(rowIds(el)).toEqual(["c2", "c1", "c3"]);
    expect(nameButton(el, "c2")!.textContent!.trim()).toBe("Principales");
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
    vi.mocked(api.listCoursesWithDisabled).mockResolvedValue(
      copy(COURSES.filter((c) => c.id !== "c1")),
    );
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
    expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(2);
    expect(rowIds(el)).toEqual(["c1", "c2", "c3"]);
    expect(alertLine(el)!.textContent!.trim()).toBe(codeMessage("course.not_found"));
  });
});

describe("layout", () => {
  it.each([
    [1280, "light"],
    [1280, "dark"],
    [390, "light"],
    [390, "dark"],
  ] as const)(
    "puts a course's grip and row menu on the first line of a wrapping name at %ipx (%s)",
    async (frame, theme) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      await page.viewport(frame, 844);
      try {
        // Long enough to wrap even across a desktop-wide table.
        const long = "Small plates to share while the table decides, ".repeat(12).trim();
        const api = stubApi({}, [{ ...COURSES[0]!, name: long }, ...COURSES.slice(1)]);
        const { el } = await mountWidget<CourseList>("dashboard-course-list", { api }, theme);
        await vi.waitFor(() => expect(rowIds(el).length).toBeGreaterThan(0));
        expect(el.parentElement!.getAttribute("data-theme")).toBe(theme);
        const row = q(el, 'tr[data-course="c1"]')!;
        const name = nameButton(el, "c1")!;
        const handle = q(el, '[data-test="drag-c1"]')!;

        expect(window.innerWidth).toBe(frame);
        expect(row.getBoundingClientRect().height).toBeGreaterThan(
          handle.getBoundingClientRect().height * 1.5,
        );
        expect(textLines(name).length, "the name wraps").toBeGreaterThan(1);
        const line = textLines(name)[0]!;
        const within = middleWithin(line);
        const icon = (handle.querySelector("wt-icon") ?? handle).getBoundingClientRect();
        const menu = row.querySelector("wt-row-actions")!.getBoundingClientRect();
        expect(
          { icon: within(icon), menu: within(menu) },
          JSON.stringify({ line, icon, menu }),
        ).toEqual({ icon: true, menu: true });
      } finally {
        await page.viewport(width, height);
      }
    },
  );

  it.each([
    [1280, "light"],
    [1280, "dark"],
    [390, "light"],
    [390, "dark"],
  ] as const)(
    "lines a renamed course's grip and row menu up with its field, a refusal under it, at %ipx (%s)",
    async (frame, theme) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      await page.viewport(frame, 844);
      try {
        const { el } = await mountWidget<CourseList>(
          "dashboard-course-list",
          { api: stubApi() },
          theme,
        );
        await vi.waitFor(() => expect(rowIds(el).length).toBeGreaterThan(0));
        expect(el.parentElement!.getAttribute("data-theme")).toBe(theme);
        await openRename(el, "c1");
        await typeName(el, "   ");
        await press(el, "Enter");
        await settle(el);
        expect(field(el)!.error).toBe(t("kitchen.course_name_required"));
        const row = q(el, 'tr[data-course="c1"]')!;
        const handle = q(el, '[data-test="drag-c1"]')!;
        const middle = (box: DOMRect) => (box.top + box.bottom) / 2;
        const fieldBox = field(el)!.shadowRoot!.querySelector(".field")!.getBoundingClientRect();
        const refusal = field(el)!.shadowRoot!.querySelector("[data-error]")!;
        const box = middle(fieldBox);
        const icon = middle((handle.querySelector("wt-icon") ?? handle).getBoundingClientRect());
        const menu = middle(row.querySelector("wt-row-actions")!.getBoundingClientRect());

        expect(window.innerWidth).toBe(frame);
        expect(refusal.textContent).toBe(t("kitchen.course_name_required"));
        expect(refusal.getBoundingClientRect().top).toBeGreaterThanOrEqual(fieldBox.bottom);
        expect(row.getBoundingClientRect().height).toBeGreaterThan(
          handle.getBoundingClientRect().height * 1.5,
        );
        const report = JSON.stringify({ box, icon, menu });
        expect(Math.abs(icon - box), report).toBeLessThanOrEqual(1.5);
        expect(Math.abs(menu - box), report).toBeLessThanOrEqual(1.5);
      } finally {
        await page.viewport(width, height);
      }
    },
  );
});
