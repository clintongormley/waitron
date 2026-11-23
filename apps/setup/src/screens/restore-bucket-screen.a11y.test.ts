import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupApi } from "../api/client.js";
import {
  REVIEWED_PREVIEW,
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
} from "../widgets/test-helpers.js";
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

/** A Review that refuses any environment but a pre-production copy's own, as `restore-gate.ts` does. */
function preproductionCopy(environmentOf: (init: RequestInit) => string): SetupApi {
  return new SetupApi("", async (_input, init) => {
    const environment = environmentOf(init!);
    if (environment !== "preproduction")
      return Response.json(
        {
          error: {
            code: "restore.environment_mismatch",
            params: { backup: "preproduction", target: environment },
          },
        },
        { status: 409 },
      );
    return Response.json({ ...REVIEWED_PREVIEW, environment });
  });
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
          venue: { legalName: "Waitron SL", taxId: "89890001K", venueName: "Local" },
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
        { venue: { legalName: "Waitron SL", taxId: "89890001K", venueName: "Local" } },
        theme,
      );
      await expectNoA11yViolations(host);
    });

    it("has no violations with the server's refusal under a tick box", async () => {
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        {
          liveSince: "2026-09-23T11:58:00.000Z",
          errorMessage: "Check your answer about the old box.",
          invalidField: "oldBoxGone",
        },
        theme,
      );
      expect(el.shadowRoot!.querySelector("#old-box-gone-error")!.textContent).toBe(
        "Check your answer about the old box.",
      );
      await expectNoA11yViolations(host);
    });

    it("has no violations with the server's refusal under the venue tick box", async () => {
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        {
          venue: { legalName: "Waitron SL", taxId: "89890001K", venueName: "Local" },
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
            "The copy could not be downloaded from the bucket. Check this box's internet connection and that the bucket still exists, then try again.",
        },
        theme,
      );
      expect(await bottomOf(el)).toContain("could not be downloaded");
      await expectNoA11yViolations(host);
    });

    it("has no violations with the note that Review switched the environment", async () => {
      const api = preproductionCopy(
        (init) => (JSON.parse(String(init.body)) as { environment: string }).environment,
      );
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        { api },
        theme,
      );
      const area = el
        .shadowRoot!.querySelector("[data-test=kit]")!
        .shadowRoot!.querySelector("textarea")!;
      area.value = "selected-private-kit";
      area.dispatchEvent(new Event("input"));
      await el.updateComplete;
      const copy = el.shadowRoot!.querySelector("setup-recovery-copy")! as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      await copy.updateComplete;
      copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=environment-followed]")).not.toBeNull(),
      );
      await expectNoA11yViolations(host);
    });
  },
);
