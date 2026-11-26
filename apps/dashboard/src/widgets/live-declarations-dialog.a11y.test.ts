import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { type LiveDeclarationsDialog } from "./live-declarations-dialog.js";
import "./live-declarations-dialog.js";

const locale = currentLocale();
afterEach(() => {
  setLocale(locale);
  cleanupWidgets();
});

it.each(["light", "dark"] as const)(
  "keeps the choices, busy state and refusal accessible in %s",
  async (theme) => {
    setLocale("en-GB");
    let rejectRequest!: (error: unknown) => void;
    const request = new Promise<{ menus: [] }>((_resolve, reject) => (rejectRequest = reject));
    const { host, el } = await mountWidget<LiveDeclarationsDialog>(
      "dashboard-live-declarations-dialog",
      {
        correct: () => request,
        question: {
          id: "product",
          menus: [
            {
              menuId: "menu",
              name: "Supper",
              live: false,
              queued: [
                {
                  versionId: "next",
                  activatesAt: "2099-02-03T14:45:00.000Z",
                  stillOld: false,
                  local: {
                    date: "2099-02-03",
                    time: "14:45",
                    offset: "+00:00",
                    repeated: false,
                    utcFallback: true,
                  },
                },
              ],
            },
          ],
        },
      },
      theme,
    );
    const version = page.getByRole("checkbox", { name: "Supper, from 3 Feb 2099, 14:45 UTC" });
    const update = page.getByRole("button", { name: "Update now" });
    await expect.element(update).toBeDisabled();
    await expectNoA11yViolations(host);
    await version.click();
    await update.click();
    await expect.element(version).toBeDisabled();
    await expectNoA11yViolations(host);
    rejectRequest({ code: "connection.timed_out" });
    await expect.element(page.getByRole("button", { name: "Try again" })).toBeEnabled();
    await expectNoA11yViolations(host);

    el.question = {
      id: "other",
      menus: [{ menuId: "lunch", name: "Lunch", live: true, queued: [] }],
    };
    await expect
      .element(page.getByRole("dialog", { name: "Update the live menus now?" }))
      .toBeVisible();
    await expectNoA11yViolations(host);
  },
);
