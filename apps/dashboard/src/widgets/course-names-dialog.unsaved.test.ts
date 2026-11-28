import { LeaveController } from "@waitron/ui";
import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import type { Course } from "../api/kitchen-api.js";
import { codeMessage } from "../i18n/codes.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, expectMessageAboveButtons, mountWidget } from "./test-helpers.js";
import "./course-names-dialog.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const course: Course = { id: "starters", name: "Starters", displayOrder: 0, active: true };
const languages = { defaultLanguage: "en", languages: ["en"] };

class CourseNamesLeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  course: Course = course;

  override render() {
    return html`<dashboard-course-names-dialog
        .api=${this.api}
        .course=${this.course}
        .languages=${languages}
      ></dashboard-course-names-dialog>
      ${this.leave.render({
        heading: "Unsaved changes",
        message: "Leave without saving?",
        keepLabel: "Keep editing",
        discardLabel: "Discard",
      })}`;
  }
}
customElements.define("course-names-leave-test-host", CourseNamesLeaveHost);

it("keeps a changed course name when Escape is followed by Keep editing", async () => {
  const updateCourse = vi.fn();
  await mountWidget<CourseNamesLeaveHost>("course-names-leave-test-host", {
    api: { updateCourse } as unknown as DashboardApi,
  });
  const name = page.getByRole("textbox", { name: /Customer-facing name/ });
  await name.fill("First course");
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect.element(name).toHaveValue("First course");
  expect(updateCourse).not.toHaveBeenCalled();
});

const nameField = () => page.getByRole("textbox", { name: /Customer-facing name/ });
const editor = (host: CourseNamesLeaveHost) =>
  host.shadowRoot!.querySelector("dashboard-course-names-dialog")!;

it("puts back the saved name when Escape is followed by Discard", async () => {
  const updateCourse = vi.fn();
  const { el: host } = await mountWidget<CourseNamesLeaveHost>("course-names-leave-test-host", {
    api: { updateCourse } as unknown as DashboardApi,
    course: { ...course, customerNames: { en: "Starters course" } },
  });
  const closed = vi.fn();
  host.addEventListener("course-names-closed", (event) => closed((event as CustomEvent).detail));
  await expect.element(nameField()).toHaveValue("Starters course");
  await nameField().fill("First course");
  await userEvent.keyboard("{Escape}");
  await page.getByRole("button", { name: "Discard" }).click();
  await vi.waitFor(() => expect(closed).toHaveBeenCalledWith({ saved: false }));
  const input = editor(host).shadowRoot!.querySelector<HTMLElement & { value: string }>(
    "wt-input",
  )!;
  await vi.waitFor(() => expect(input.value).toBe("Starters course"));
  expect(updateCourse).not.toHaveBeenCalled();
});

it("shows a refused save at the bottom and keeps the typed name", async () => {
  const updateCourse = vi.fn(async () => {
    throw { code: "connection.failed" };
  });
  const { el: host } = await mountWidget<CourseNamesLeaveHost>("course-names-leave-test-host", {
    api: { updateCourse } as unknown as DashboardApi,
  });
  await nameField().fill("First course");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const modal = editor(host).shadowRoot!.querySelector("wt-modal")!;
  const save = editor(host).shadowRoot!.querySelector('[data-test="save"]')!;
  await vi.waitFor(() => expectMessageAboveButtons(modal, save, codeMessage("connection.failed")));
  await expect.element(nameField()).not.toHaveAttribute("aria-invalid", "true");
  expect(updateCourse).toHaveBeenCalledExactlyOnceWith("starters", {
    customerNames: { en: "First course" },
  });
  await expect.element(nameField()).toHaveValue("First course");
  await expect.element(page.getByRole("dialog", { name: "Starters" })).toBeVisible();
});

it("closes on Cancel when nothing was changed, reporting nothing saved", async () => {
  const { el: host } = await mountWidget<CourseNamesLeaveHost>("course-names-leave-test-host", {
    api: { updateCourse: vi.fn() } as unknown as DashboardApi,
  });
  const closed = vi.fn();
  host.addEventListener("course-names-closed", (event) => closed((event as CustomEvent).detail));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await vi.waitFor(() => expect(closed).toHaveBeenCalledWith({ saved: false }));
  await expect.element(page.getByRole("dialog", { name: "Starters" })).not.toBeInTheDocument();
});
