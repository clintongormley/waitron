import { LeaveController } from "@waitron/ui";
import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./course-names-dialog.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const course = { id: "starters", name: "Starters", displayOrder: 0, active: true };
const languages = { defaultLanguage: "en", languages: ["en"] };

class CourseNamesLeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;

  override render() {
    return html`<dashboard-course-names-dialog
        .api=${this.api}
        .course=${course}
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
