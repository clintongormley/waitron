import { afterEach, expect, it, vi } from "vitest";
import { SetupApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { SetupRecoveryCopy } from "./recovery-copy.js";
import { setLocale } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const copy = {
  sourceId: "selected-copy",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "preproduction",
  nodeId: "saved-node",
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
  locationName: "Saved location",
};
it.each(["light", "dark"] as const)(
  "the selected-copy preview is accessible in %s in blank, loading, selected and refused states",
  async (theme) => {
    let complete!: (response: Response) => void;
    const api = new SetupApi(
      "",
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const { el, host } = await mountWidget<SetupRecoveryCopy>(
      "setup-recovery-copy",
      { api },
      theme,
    );
    await expectNoA11yViolations(host);
    el.artifact = new File(["encrypted-copy"], "copy.backup");
    el.recoveryKey = "archive-key";
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
    complete(new Response(JSON.stringify(copy)));
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Amber Hill"));
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await el.updateComplete;
    complete(
      new Response(JSON.stringify({ error: { code: "recovery.passphrase_invalid" } }), {
        status: 422,
      }),
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
        "Check the backup file's encryption key.",
      ),
    );
    await expectNoA11yViolations(host);
  },
);
