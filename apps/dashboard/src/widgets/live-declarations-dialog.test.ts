import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { type LiveDeclarationsDialog } from "./live-declarations-dialog.js";
import "./live-declarations-dialog.js";

const late = {
  versionId: "late",
  activatesAt: "2099-01-02T11:00:00.000Z",
  local: { date: "2099-01-02", time: "12:00", offset: "+01:00", repeated: false },
  stillOld: false,
};
const early = { ...late, versionId: "early", stillOld: true };
const locale = currentLocale();

afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

async function mount(live: boolean, queued = [early, late]) {
  setLocale("en-GB");
  const correct = vi.fn<(id: string, queued: string[]) => Promise<{ menus: [] }>>();
  const question = { id: "p-saved", menus: [{ menuId: "m1", name: "Lunch", live, queued }] };
  const { el } = await mountWidget<LiveDeclarationsDialog>("dashboard-live-declarations-dialog", {
    question,
    correct,
  });
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve, { once: true }));
  const choices = page.getByRole("checkbox");
  const update = page.getByRole("button", { name: "Update now" });
  return { correct, closed, choices, update };
}

it("uses the saved product and chosen versions, keeping them for a retry when the reply is lost", async () => {
  const { correct, closed, choices, update } = await mount(true);
  let refuse!: (error: unknown) => void;
  correct.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
  );
  correct.mockResolvedValueOnce({ menus: [] });

  await expect.element(choices.nth(0)).toHaveAccessibleName("Lunch, from 2 Jan 2099, 12:00");
  await expect.element(choices.nth(0)).toBeChecked();
  await expect.element(choices.nth(1)).not.toBeChecked();
  await choices.nth(1).click();
  await update.click();
  await expect.element(update).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).toBeVisible();
  expect(correct).toHaveBeenCalledExactlyOnceWith("p-saved", ["early", "late"]);

  refuse({ code: "connection.timed_out" });
  await expect
    .element(
      page.getByText("The product is saved, but Waitron could not confirm the update for: Lunch."),
    )
    .toBeVisible();
  await expect.element(choices.nth(1)).toBeChecked();
  await page.getByRole("button", { name: "Try again" }).click();
  await closed;
  expect(correct.mock.calls).toEqual([
    ["p-saved", ["early", "late"]],
    ["p-saved", ["early", "late"]],
  ]);
});

it("requires a selection for scheduled-only corrections and lets Escape dismiss", async () => {
  const { correct, closed, choices, update } = await mount(false, [late]);
  await expect
    .element(page.getByRole("dialog", { name: "Update the scheduled menus now?" }))
    .toBeVisible();
  await expect.element(update).toBeDisabled();
  await choices.click();
  await expect.element(update).toBeEnabled();
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(correct).not.toHaveBeenCalled();
});

it("lets the user close a confirmed refusal without losing the product save", async () => {
  const { correct, closed, update } = await mount(true, []);
  correct.mockRejectedValueOnce({ code: "menu.not_found", status: 404 });
  await update.click();
  await expect
    .element(
      page.getByText(
        "The product is saved, but these menus were not updated: Lunch. Try again, or publish them.",
      ),
    )
    .toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await closed;
  expect(correct).toHaveBeenCalledOnce();
});
