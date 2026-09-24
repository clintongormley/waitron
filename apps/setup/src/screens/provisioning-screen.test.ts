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
    expect(q(el, "[data-test=status]")).toBeNull();
    expect(q(el, "[data-test=provision]")).toBeNull();
  });

  it("re-emits provision-requested (composed) when retry is clicked", async () => {
    const { el, host } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "The server isn't ready yet. Wait a moment, then try again.",
      canRetry: true,
    });
    const requested = new Promise<boolean>((resolve) =>
      host.addEventListener("provision-requested", () => resolve(true)),
    );
    q(el, "[data-test=retry]")!.click();
    expect(await requested).toBe(true);
  });

  it("shows the message but NO retry control when canRetry is false", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "This server is already set up.",
      canRetry: false,
    });
    expect(q(el, "[data-test=error]")!.textContent).toContain("already set up");
    expect(q(el, "[data-test=retry]")).toBeNull();
  });

  it.each([
    [
      "This server is already set up.",
      "Reload to open the till",
      "already set up",
      "open the till",
    ],
    ["Setup is already in progress on this server.", "Reload", "already in progress", "Reload"],
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
      expect(q(el, "[data-test=retry]")).toBeNull();
      expect(q(el, "[data-test=status]")).toBeNull();
    },
  );

  it("calls the injected reload when the terminal reload control is clicked", async () => {
    const reload = vi.fn();
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "This server is already set up.",
      canRetry: false,
      reloadLabel: "Reload to open the till",
      reload,
    });
    q(el, "[data-test=reload]")!.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("offers retry (not reload) for a retryable failure", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "Provisioning failed. You can try again.",
      canRetry: true,
    });
    expect(q(el, "[data-test=retry]")).not.toBeNull();
    expect(q(el, "[data-test=reload]")).toBeNull();
  });
});
