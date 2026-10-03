import { afterEach, expect, describe, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./connection-screen.js";
import type { SetupConnectionScreen } from "./connection-screen.js";

const q = (el: SetupConnectionScreen, sel: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(sel);

const text = (node: { textContent: string | null }): string =>
  node.textContent!.replace(/\s+/g, " ").trim();

const words = (el: SetupConnectionScreen): string[] =>
  text(el.shadowRoot!).split(" ").filter(Boolean);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("setup-connection-screen", () => {
  it("asks whether the page is secure and points at the address bar", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(text(q(el, "h1")!)).toBe("Is this page secure?");
    expect(text(q(el, "h1")!).endsWith("?")).toBe(true); // a question, never a verdict
    expect(text(q(el, "[data-test=instructions]")!)).toBe(
      "Look at your browser's address bar. If it says Not secure, install this server's certificate before you continue.",
    );
  });

  it("shows the instructions in the muted text colour", async () => {
    const { el, host } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
    expect(getComputedStyle(q(el, "[data-test=instructions]")!).color).toBe("rgb(7, 8, 9)");
  });

  it("stays short enough to read at a glance", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(words(el).length).toBeLessThanOrEqual(40);
  });

  it("shows the browser's warning words in the browser's own red, and bold", async () => {
    const { el, host } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    const warning = el.shadowRoot!.querySelector<HTMLElement>("[data-test=warning-words]")!;
    expect(text(warning)).toBe("Not secure");
    expect(Number(getComputedStyle(warning).fontWeight)).toBeGreaterThanOrEqual(600);
    host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
    expect(getComputedStyle(warning).color).toBe("rgb(4, 5, 6)");
  });

  it("puts Install certificate and Continue side by side in one action row, Continue last", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    const actions = q(el, "wt-form-actions")!;
    const install = q(el, "[data-test=trust-help]")!;
    const next = q(el, "[data-test=continue]")!;
    expect(install.parentElement).toBe(actions);
    expect(install.getAttribute("slot")).toBe("secondary");
    expect(install.getAttribute("variant")).toBe("secondary");
    expect(next.parentElement).toBe(actions);
    expect(next.hasAttribute("slot")).toBe(false);
    expect(next.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=otherwise]")).toBeNull();
  });

  it("opens the certificate guide in a new tab from Install certificate", async () => {
    const opened: unknown[][] = [];
    const original = window.open;
    window.open = ((...args: unknown[]) => {
      opened.push(args);
      return null;
    }) as typeof window.open;
    try {
      const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
      const install = q(el, "[data-test=trust-help]")!;
      expect(text(install)).toBe("Install certificate");
      install.click();
      expect(opened).toEqual([["/setup/trust", "_blank", "noopener"]]);
    } finally {
      window.open = original;
    }
  });

  it("drops Continue but keeps Install certificate when this server cannot be set up from here", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {
      setupUnavailable: true,
      errorMessage: "This server is already set up. Reload to open it.",
    });
    expect(q(el, "[data-test=continue]")).toBeNull();
    expect(text(q(el, "h1")!)).toBe("Is this page secure?");
    expect(q(el, "[data-test=trust-help]")).not.toBeNull();
    expect(text(q(el, ".error")!)).toContain("already set up");
  });

  it("keeps Continue for a failure that is worth retrying", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {
      errorMessage: "We could not reach the server. Check its power and your network connection.",
    });
    expect(q(el, "[data-test=continue]")).not.toBeNull();
    expect(q(el, "[data-test=trust-help]")).not.toBeNull();
  });

  it("announces a connection error and hides the slot when there is none", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(el.shadowRoot!.querySelector(".error")).toBeNull();
    const { el: failed } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {
      errorMessage: "We could not read the server's setup information.",
    });
    const error = failed.shadowRoot!.querySelector<HTMLElement>(".error")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(text(error)).toContain("We could not read the server's setup information.");
  });

  it("asks the shell to re-check the connection when Continue is clicked", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    const button = q(el, "[data-test=continue]")!;
    expect(text(button)).toBe("Continue to setup");
    expect(button.hasAttribute("disabled")).toBe(false);
    // The shell listens on the element itself (`@connection-continue` in setup-app.ts), so this
    // event does not bubble and must not start doing so.
    const requested = new Promise<boolean>((resolve) =>
      el.addEventListener("connection-continue", () => resolve(true)),
    );
    button.click();
    expect(await requested).toBe(true);
  });

  it("disables Continue and says so while a check is in flight", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {
      checking: true,
    });
    const button = q(el, "[data-test=continue]")!;
    expect(text(button)).toBe("Checking connection…");
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});

describe("setup-connection-screen in Spanish", () => {
  it("asks the question, names the browser's Spanish warning and offers both actions in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(text(q(el, "h1")!)).toBe("¿Es segura esta página?");
    expect(text(q(el, "[data-test=instructions]")!)).toBe(
      "Mira la barra de direcciones de tu navegador. Si pone No es seguro, instala el certificado de este servidor antes de continuar.",
    );
    expect(text(q(el, "[data-test=warning-words]")!)).toBe("No es seguro");
    expect(text(q(el, "[data-test=trust-help]")!)).toBe("Instalar el certificado");
    expect(text(q(el, "[data-test=continue]")!)).toBe("Continuar con la configuración");
  });

  it("switches language while mounted", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {
      checking: true,
    });
    expect(text(q(el, "[data-test=continue]")!)).toBe("Checking connection…");
    setLocale("es-ES");
    await el.updateComplete;
    expect(text(q(el, "h1")!)).toBe("¿Es segura esta página?");
    expect(text(q(el, "[data-test=continue]")!)).toBe("Comprobando la conexión…");
  });
});
