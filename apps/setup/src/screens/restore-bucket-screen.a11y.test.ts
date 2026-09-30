import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./restore-bucket-screen.js";
import type { SetupRestoreBucketScreen } from "./restore-bucket-screen.js";

afterEach(cleanupWidgets);

/** The form's one message, which `wt-form-actions` draws in its own shadow root. */
async function bottomOf(el: HTMLElement): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

describe.each(["light", "dark"] as const)(
  "setup-restore-bucket-screen a11y (%s theme)",
  (theme) => {
    it("has no violations on the blank form", async () => {
      const { host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        {},
        theme,
      );
      await expectNoA11yViolations(host);
    });

    it("has no violations with the fields marked and the message above Restore", async () => {
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        {
          liveUnknown: true,
          venue: { legalName: "Waitron SL", taxId: "89890001K", locationName: "Local" },
        },
        theme,
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
      await el.updateComplete;
      expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
      await expectNoA11yViolations(host);
    });

    it("has no violations while asking about a live old server", async () => {
      const { host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        { liveSince: "2026-09-23T11:58:00.000Z" },
        theme,
      );
      await expectNoA11yViolations(host);
    });

    it("has no violations while asking the owner to confirm the venue", async () => {
      const { host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        { venue: { legalName: "Waitron SL", taxId: "89890001K", locationName: "Local" } },
        theme,
      );
      await expectNoA11yViolations(host);
    });

    it("has no violations with the server's refusal under a tick box", async () => {
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        {
          liveSince: "2026-09-23T11:58:00.000Z",
          errorMessage: "Check your answer about the old server.",
          invalidField: "oldBoxGone",
        },
        theme,
      );
      expect(el.shadowRoot!.querySelector("#old-box-gone-error")!.textContent).toBe(
        "Check your answer about the old server.",
      );
      await expectNoA11yViolations(host);
    });

    it("has no violations with the server's refusal under the venue tick box", async () => {
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        {
          venue: { legalName: "Waitron SL", taxId: "89890001K", locationName: "Local" },
          errorMessage: "Check the confirmation that this is your business.",
          invalidField: "venueConfirmed",
        },
        theme,
      );
      expect(el.shadowRoot!.querySelector("#venue-confirmed-error")!.textContent).toBe(
        "Check the confirmation that this is your business.",
      );
      await expectNoA11yViolations(host);
    });

    it("has no violations with a server error shown", async () => {
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        {
          errorMessage:
            "The copy could not be downloaded from the bucket. Check this server's internet connection and that the bucket still exists, then try again.",
        },
        theme,
      );
      expect(await bottomOf(el)).toContain("could not be downloaded");
      await expectNoA11yViolations(host);
    });
  },
);
