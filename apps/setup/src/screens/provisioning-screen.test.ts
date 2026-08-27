import { afterEach, describe, expect, it, vi } from "vitest";
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

  // Fix (k): a TERMINAL failure (canRetry false + a reloadLabel) renders its guidance message plus a
  // RELOAD action instead of a retry — the two double-provision 409s, each with the shell's label.
  it.each([
    ["This box is already set up.", "Reload to open the till", "already set up", "open the till"],
    ["Setup is already in progress on this box.", "Reload", "already in progress", "Reload"],
  ])(
    "renders the guidance message and its reload action for a terminal state (%s)",
    async (message, reloadLabel, msgFragment, labelFragment) => {
      const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
        message,
        canRetry: false,
        reloadLabel,
      });
      expect(q(el, "[data-test=error]")!.textContent).toContain(msgFragment);
      const reload = q(el, "[data-test=reload]")!;
      expect(reload).not.toBeNull();
      expect(reload.textContent).toContain(labelFragment);
      // A terminal state offers a reload, never a retry, and is no longer in flight.
      expect(q(el, "[data-test=retry]")).toBeNull();
      expect(q(el, "[data-test=status]")).toBeNull();
    },
  );

  it("calls the injected reload when the terminal reload control is clicked", async () => {
    const reload = vi.fn();
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "This box is already set up.",
      canRetry: false,
      reloadLabel: "Reload to open the till",
      reload,
    });
    q(el, "[data-test=reload]")!.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  // A retryable failure keeps its retry and offers NO reload, even if a reloadLabel were somehow set —
  // canRetry wins. Guards against a terminal reload leaking onto a retryable state.
  it("offers retry (not reload) for a retryable failure", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "Provisioning failed. You can try again.",
      canRetry: true,
    });
    expect(q(el, "[data-test=retry]")).not.toBeNull();
    expect(q(el, "[data-test=reload]")).toBeNull();
  });
});
