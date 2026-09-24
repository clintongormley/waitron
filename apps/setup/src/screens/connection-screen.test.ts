import { afterEach, expect, describe, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./connection-screen.js";
import type { SetupConnectionScreen } from "./connection-screen.js";

const q = (el: SetupConnectionScreen, sel: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(sel);

const text = (node: { textContent: string | null }): string =>
  node.textContent!.replace(/\s+/g, " ").trim();

const words = (el: SetupConnectionScreen): string[] =>
  text(el.shadowRoot!).split(" ").filter(Boolean);

afterEach(cleanupWidgets);

describe("setup-connection-screen", () => {
  it("asks whether the connection is secure and points at the address bar", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(text(q(el, "h1")!)).toBe("Is your connection to this page secure?");
    expect(text(q(el, "h1")!).endsWith("?")).toBe(true); // a question, never a verdict
    const body = text(el.shadowRoot!);
    expect(body).toContain("address bar");
    expect(body).toContain("not secure");
  });

  it("stays short enough to read at a glance", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(words(el).length).toBeLessThanOrEqual(70);
  });

  it("offers the certificate guide in a new tab", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=trust-help]")!;
    expect(link.getAttribute("href")).toBe("/setup/trust");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(text(link)).toBe("install this server's certificate");
  });

  it("shows the browser's warning words in the browser's own red, and bold", async () => {
    const { el, host } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    const warning = el.shadowRoot!.querySelector<HTMLElement>("[data-test=warning-words]")!;
    expect(text(warning)).toContain("not secure");
    expect(Number(getComputedStyle(warning).fontWeight)).toBeGreaterThanOrEqual(600);
    host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
    expect(getComputedStyle(warning).color).toBe("rgb(4, 5, 6)");
  });

  it("puts the guide link inside the sentence that describes the warning", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    const link = el.shadowRoot!.querySelector("[data-test=trust-help]")!;
    expect(text(link.parentElement!)).toContain("not secure");
  });

  it("offers Continue as the other branch of the same choice", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(text(q(el, "[data-test=otherwise]")!)).toBe("Otherwise:");
  });

  it("drops the Continue row when this server cannot be set up from here", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {
      setupUnavailable: true,
      errorMessage: "This server is already set up. Reload to open it.",
    });
    expect(q(el, "[data-test=continue]")).toBeNull();
    expect(q(el, "[data-test=otherwise]")).toBeNull();
    expect(text(q(el, "h1")!)).toBe("Is your connection to this page secure?");
    expect(q(el, "[data-test=trust-help]")).not.toBeNull();
    expect(text(q(el, ".error")!)).toContain("already set up");
  });

  it("keeps the Continue row for a failure that is worth retrying", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {
      errorMessage: "We could not reach the server. Check its power and your network connection.",
    });
    expect(q(el, "[data-test=continue]")).not.toBeNull();
    expect(q(el, "[data-test=otherwise]")).not.toBeNull();
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
