import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi, SetMenuLine } from "../api/client.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./set-menu-lines-form.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const starters = { id: "starters", name: "Starters" };
const sharing = { id: "sharing", name: "Sharing plates" };

async function mount(lines: SetMenuLine[]) {
  const saveSetMenuLines = vi.fn();
  await mountWidget("dashboard-set-menu-lines-form", {
    api: { saveSetMenuLines } as unknown as DashboardApi,
    menuId: "daily",
    lines,
    courses: [starters, sharing],
  } as Partial<HTMLElement>);
  return { saveSetMenuLines };
}

it("refuses to save an added line until it has a course, then saves both lines", async () => {
  const { saveSetMenuLines } = await mount([{ id: "first", count: 1, courseIds: ["starters"] }]);
  saveSetMenuLines.mockImplementation((_menuId: string, lines: unknown[]) =>
    Promise.resolve({ lines: lines.map((line, i) => ({ id: `saved-${i}`, ...(line as object) })) }),
  );
  await page.getByRole("button", { name: "Add a line" }).click();
  await expect.element(page.getByRole("group", { name: "Line 2" })).toBeVisible();
  const course = page.getByRole("combobox", { name: /^Choose a course/ });
  await expect.element(course).toBeVisible();
  const save = page.getByRole("button", { name: "Save" });
  await save.click();
  await expect
    .element(
      page.getByText(
        "Choose at least one available course and select each course only once per line.",
      ),
    )
    .toBeVisible();
  await expect.element(course).toHaveAttribute("aria-invalid", "true");
  expect(saveSetMenuLines).not.toHaveBeenCalled();

  await course.click();
  await page.getByRole("option", { name: "Sharing plates", exact: true }).click();
  await save.click();
  await vi.waitFor(() =>
    expect(saveSetMenuLines).toHaveBeenCalledExactlyOnceWith("daily", [
      { count: 1, courseIds: ["starters"] },
      { count: 1, courseIds: ["sharing"] },
    ]),
  );
});

it("removes a course from a line and a whole line, and saves the rest on Enter", async () => {
  const { saveSetMenuLines } = await mount([
    { id: "first", count: 1, courseIds: ["starters", "sharing"] },
    { id: "second", count: 2, courseIds: ["sharing"] },
  ]);
  saveSetMenuLines.mockResolvedValue({
    lines: [{ id: "first", count: 1, courseIds: ["sharing"] }],
  });
  await page.getByRole("button", { name: "Remove Starters" }).click();
  await expect
    .element(page.getByRole("button", { name: "Remove Starters" }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Remove Line 2" }).click();
  await expect.element(page.getByRole("group", { name: "Line 2" })).not.toBeInTheDocument();

  const count = page.getByRole("spinbutton", { name: "Number of dishes" });
  (count.element() as HTMLInputElement).focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(saveSetMenuLines).toHaveBeenCalledExactlyOnceWith("daily", [
      { count: 1, courseIds: ["sharing"] },
    ]),
  );
});

it("saves once when Save is pressed twice before it redraws", async () => {
  const { saveSetMenuLines } = await mount([{ id: "first", count: 1, courseIds: ["starters"] }]);
  saveSetMenuLines.mockResolvedValue({
    lines: [{ id: "first", count: 2, courseIds: ["starters"] }],
  });
  await page.getByRole("spinbutton", { name: "Number of dishes" }).fill("2");
  const save = page.getByRole("button", { name: "Save" });
  await expect.element(save).toBeEnabled();
  const button = save.element() as HTMLElement;
  button.click();
  button.click();
  await expect.element(save).toBeDisabled();
  expect(saveSetMenuLines).toHaveBeenCalledExactlyOnceWith("daily", [
    { count: 2, courseIds: ["starters"] },
  ]);
});

it("shows the server's refusal and keeps the edited count", async () => {
  const { saveSetMenuLines } = await mount([{ id: "first", count: 1, courseIds: ["starters"] }]);
  saveSetMenuLines.mockRejectedValueOnce({ code: "set_menu.invalid", params: { field: "lines" } });
  const count = page.getByRole("spinbutton", { name: "Number of dishes" });
  await count.fill("3");
  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .element(
      page.getByText(
        "A set menu can have up to 20 inclusion lines. Combine courses in one line or remove a line.",
      ),
    )
    .toBeVisible();
  await expect.element(count).toHaveValue(3);
  await expect.element(page.getByRole("button", { name: "Save" })).toBeEnabled();
});
