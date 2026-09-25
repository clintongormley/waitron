import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { SetupCloudRestoreScreen } from "./cloud-restore-screen.js";
import "./cloud-restore-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("Cloud restore screen at phone width (%s)", (theme) => {
  it("renders an approved snapshot without horizontal overflow or axe violations", async () => {
    await page.viewport(375, 812);
    const { host } = await mountWidget<SetupCloudRestoreScreen>(
      "setup-cloud-restore-screen",
      {
        view: {
          requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
          code: "12345678",
          openCloudUrl:
            "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
          expiresAt: "2026-09-24T12:00:00.000Z",
          state: "approved",
          point: {
            id: "e8722eb0-3f02-4f35-920b-9b5f6bfb05e8",
            venueId: "fe78bc70-b66f-4b2f-970d-7acbd3739977",
            capturedAt: "2026-09-24T10:00:00.000Z",
            modules: { core: 1 },
          },
        },
      },
      theme,
    );
    expect(window.innerWidth).toBe(375);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
    await expectNoA11yViolations(host);
  });

  it("has no axe violations with pending, expired, busy, or error states", async () => {
    await page.viewport(375, 812);
    const { el, host } = await mountWidget<SetupCloudRestoreScreen>(
      "setup-cloud-restore-screen",
      { busy: true },
      theme,
    );
    await expectNoA11yViolations(host);
    el.busy = false;
    el.view = {
      requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      code: "12345678",
      openCloudUrl:
        "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      expiresAt: "2026-09-24T12:00:00.000Z",
      state: "awaiting_owner",
    };
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.view = { ...el.view, state: "expired" };
    el.errorMessage = "Cloud recovery is unavailable. Try again.";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no axe violations while asking about the old server, before and after an unanswered restore", async () => {
    await page.viewport(375, 812);
    for (const live of [{ liveSince: "2026-09-23T11:58:00.000Z" }, { liveUnknown: true }]) {
      const { el, host } = await mountWidget<SetupCloudRestoreScreen>(
        "setup-cloud-restore-screen",
        {
          view: {
            requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
            code: "12345678",
            openCloudUrl:
              "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
            expiresAt: "2026-09-24T12:00:00.000Z",
            state: "approved",
            point: {
              id: "e8722eb0-3f02-4f35-920b-9b5f6bfb05e8",
              venueId: "fe78bc70-b66f-4b2f-970d-7acbd3739977",
              capturedAt: "2026-09-24T10:00:00.000Z",
              modules: { core: 1 },
            },
          },
          ...live,
        },
        theme,
      );
      expect(el.shadowRoot!.querySelector("[data-test=live-warning]")).not.toBeNull();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("#old-box-gone-error")).not.toBeNull();
      await expectNoA11yViolations(host);
      cleanupWidgets();
    }
  });
});
