import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./provisioning-screen.js";
import type { SetupProvisioningScreen } from "./provisioning-screen.js";

const q = (el: SetupProvisioningScreen, sel: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(sel);

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

describe("setup-provisioning-screen", () => {
  it.each([
    ["demo", "Demo"],
    ["prepare", "Preparation"],
    ["live", "Live"],
  ] as const)("shows the restaurant and %s mode while setup is running", async (mode, label) => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      legalName: "The Olive Table SL",
      onboardingIntent: mode,
    });
    expect(q(el, "h1")?.textContent?.trim()).toBe("Setting up The Olive Table SL");
    expect(q(el, "[data-test=mode-indicator]")?.textContent?.trim()).toBe(label);
    expect(getComputedStyle(q(el, ".in-flight")!).paddingTop).toBe("32px");
    expect(q(el, "wt-spinner")?.getBoundingClientRect().width).toBe(32);
    expect(q(el, "wt-spinner")?.getBoundingClientRect().height).toBe(32);
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe("Keep this page open.");
    expect(q(el, "wt-button")).toBeNull();
  });

  it("shows a spinner without a provision control while the request is pending", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {});
    expect(q(el, "[data-test=status]")).not.toBeNull();
    expect(q(el, "wt-spinner")).not.toBeNull();
    expect(q(el, "[data-test=provision]")).toBeNull();
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

  it("offers Reset this server, which moves the wizard to the reset screen, when canReset is set", async () => {
    const { el, host } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "A previous attempt to join this server stopped partway.",
      canReset: true,
    });
    const gotos: unknown[] = [];
    host.addEventListener("setup-goto", (e) => gotos.push((e as CustomEvent).detail));
    const reset = q(el, "[data-test=reset]")!;
    expect(reset.textContent?.trim()).toBe("Reset this server");
    expect(q(el, "[data-test=retry]")).toBeNull();
    expect(q(el, "[data-test=reload]")).toBeNull();
    reset.click();
    expect(gotos).toEqual([{ screen: "reset" }]);
  });

  it("offers no reset action when canReset is not set", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "This server has saved setup work for a different request.",
      reloadLabel: "Reload",
    });
    expect(q(el, "[data-test=reset]")).toBeNull();
    expect(q(el, "[data-test=reload]")).not.toBeNull();
  });

  it("offers retry (not reload) for a retryable failure", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "Provisioning failed. You can try again.",
      canRetry: true,
    });
    expect(q(el, "[data-test=retry]")).not.toBeNull();
    expect(q(el, "[data-test=reload]")).toBeNull();
  });

  it("shows the in-flight state in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {});
    expect(q(el, "h1")!.textContent!.trim()).toBe("Configurando este servidor");
    expect(q(el, "[data-test=status]")!.textContent!.trim()).toBe(
      "Mantén esta página abierta.",
    );
    expect(q(el, "wt-spinner")).not.toBeNull();
    expect(q(el, "[data-test=provision]")).toBeNull();
  });

  it("shows the failure state's help and actions in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "La configuración ha fallado.",
      canRetry: true,
    });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Configuración");
    expect(q(el, "[data-test=trust-help]")!.textContent!.trim()).toBe(
      "abre la ayuda sobre el certificado y la conexión",
    );
    expect(q(el, "[data-test=retry]")!.textContent!.trim()).toBe("Volver a intentar");
  });

  it("names the reset action in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "Un intento anterior se detuvo a medias.",
      canReset: true,
    });
    expect(q(el, "[data-test=reset]")!.textContent!.trim()).toBe("Restablecer este servidor");
  });

  it("redraws in Spanish on a live language switch", async () => {
    const { el } = await mountWidget<SetupProvisioningScreen>("setup-provisioning-screen", {
      message: "Provisioning failed. You can try again.",
      canRetry: true,
    });
    expect(q(el, "[data-test=retry]")!.textContent!.trim()).toBe("Try again");
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "[data-test=retry]")!.textContent!.trim()).toBe("Volver a intentar");
    expect(q(el, "h1")!.textContent!.trim()).toBe("Configuración");
  });
});
