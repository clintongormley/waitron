import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseFiles } from "@waitron/ui/src/test-helpers.js";
import { SetupApi } from "../api/client.js";
import {
  REVIEWED_PREVIEW,
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
} from "../widgets/test-helpers.js";
import "./restore-screen.js";
import type { SetupRestoreScreen } from "./restore-screen.js";

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

describe.each(["light", "dark"] as const)("setup-restore-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form", async () => {
    const { host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the fields marked and the message above Restore", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
    await expectNoA11yViolations(host);
  });

  it("has no violations while asking about a live old server", async () => {
    const { host } = await mountWidget<SetupRestoreScreen>(
      "setup-restore-screen",
      { liveSince: "2026-09-23T11:58:00.000Z" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the old-server question left unanswered", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>(
      "setup-restore-screen",
      { liveUnknown: true },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with a server error shown", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>(
      "setup-restore-screen",
      { errorMessage: "Couldn't stage the backup." },
      theme,
    );
    expect(await bottomOf(el)).toBe("Couldn't stage the backup.");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the note that Review switched the environment", async () => {
    const api = preproductionCopy((init) =>
      new Headers(init.headers).get("x-waitron-restore-environment")!,
    );
    const { el, host } = await mountWidget<SetupRestoreScreen>(
      "setup-restore-screen",
      { api },
      theme,
    );
    chooseFiles(
      el.shadowRoot!.querySelector("[data-test=artifact]")!,
      new File(["encrypted"], "waitron.backup"),
    );
    const key = el
      .shadowRoot!.querySelector("[data-test=recovery-key]")!
      .shadowRoot!.querySelector("input")!;
    key.value = "recovery-key";
    key.dispatchEvent(new Event("input"));
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
});
