import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import "./setup-app.js";
import type { SetupApp } from "./setup-app.js";
import type { SetupApi, SetupStatus } from "./api/client.js";

afterEach(cleanupWidgets);

/** The boot reads the shell makes on connect; a stray rejection would pollute the scan. */
function stubApi(): SetupApi {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
    } satisfies SetupStatus),
    getVenueDefaults: vi.fn().mockResolvedValue({ verifactu: { operationDescription: "Venta" } }),
  } as unknown as SetupApi;
}

// The shell's own contribution is the modal every screen renders inside. Its name comes from the
// `aria-label` forwarded to the inner <dialog>, which axe's aria-dialog-name rule checks; the screens'
// own suites mount them without the shell, so only this suite can see that wiring.
describe.each(["light", "dark"] as const)("setup-app a11y (%s theme)", (theme) => {
  it("has no violations on the wizard's first screen inside its modal", async () => {
    const { el, host } = await mountWidget<SetupApp>("setup-app", { api: stubApi() }, theme);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on the restore-from-bucket screen inside its modal", async () => {
    const { el, host } = await mountWidget<SetupApp>("setup-app", { api: stubApi() }, theme);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    // The shell listens for `setup-goto` on its <wt-modal> (setup-app.ts, the `@setup-goto` binding).
    el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(
      new CustomEvent("setup-goto", {
        detail: { screen: "restore-bucket" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-restore-bucket]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
