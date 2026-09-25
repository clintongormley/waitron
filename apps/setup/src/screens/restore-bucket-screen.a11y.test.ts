import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./restore-bucket-screen.js";
import type { SetupRestoreBucketScreen } from "./restore-bucket-screen.js";

afterEach(cleanupWidgets);

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

    it("has no violations with the validation banner shown", async () => {
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

    it("has no violations with a server error shown", async () => {
      const { host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        {
          errorMessage:
            "The copy could not be downloaded from the bucket. Check this server's internet connection and that the bucket still exists, then try again.",
        },
        theme,
      );
      await expectNoA11yViolations(host);
    });
  },
);
