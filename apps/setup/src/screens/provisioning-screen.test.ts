import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./provisioning-screen.js";
import type { SetupProvisioningScreen } from "./provisioning-screen.js";

const q = (el: SetupProvisioningScreen, sel: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(sel);

afterEach(cleanupWidgets);

describe("setup-provisioning-screen", () => {
  it("shows a non-spinner in-flight state with a DISABLED provision control when no message is set", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {});
    expect(q(el, "[data-test=status]")).not.toBeNull();
    const provision = q(el, "[data-test=provision]")!;
    expect(provision.hasAttribute("disabled")).toBe(true);
    // In flight: no error banner, no retry.
    expect(q(el, "[data-test=error]")).toBeNull();
    expect(q(el, "[data-test=retry]")).toBeNull();
  });

  it("shows the mapped error and a retry control when canRetry is true", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "Provisioning failed. You can try again.",
      canRetry: true,
    });
    const error = q(el, "[data-test=error]")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("Provisioning failed");
    expect(q(el, "[data-test=retry]")).not.toBeNull();
    // The in-flight surface is gone once a message is shown.
    expect(q(el, "[data-test=status]")).toBeNull();
    expect(q(el, "[data-test=provision]")).toBeNull();
  });

  it("re-emits provision-requested (composed) when retry is clicked", async () => {
    const { el, host } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "The box isn't ready yet. Wait a moment, then try again.",
      canRetry: true,
    });
    const requested = new Promise<boolean>((resolve) =>
      host.addEventListener("provision-requested", () => resolve(true)),
    );
    q(el, "[data-test=retry]")!.click();
    expect(await requested).toBe(true);
  });

  // The two fiscal 409 refusals must NOT offer a re-POST.
  it("shows the message but NO retry control when canRetry is false", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "This box is already set up.",
      canRetry: false,
    });
    expect(q(el, "[data-test=error]")!.textContent).toContain("already set up");
    expect(q(el, "[data-test=retry]")).toBeNull();
  });
});
