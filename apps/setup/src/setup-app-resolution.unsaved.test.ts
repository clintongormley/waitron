import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, wizardApi } from "../test/first-setup-browser.js";
import { oldRecoveryRequests } from "../test/wipe-browser.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

beforeEach(() => sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY));
afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});
it("Recover from backup opens its confirmation in place", async () => {
  const { api, requests } = wizardApi({
    claimed: true,
    intercept(path) {
      if (path.endsWith("/start-again/summary")) return Response.json({ reached: "claimed" });
    },
  });
  const { el } = await mountWidget<SetupApp>("setup-app", { api });
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=recover-backup]"))
    .not.toBeNull();
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-test=recover-backup]")!;
  await userEvent.click(button.shadowRoot!.querySelector("button")!);
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=recover-deletes]"))
    .not.toBeNull();
  expect(oldRecoveryRequests(requests)).toEqual([]);
});
