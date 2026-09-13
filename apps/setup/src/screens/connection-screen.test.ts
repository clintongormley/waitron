import { afterEach, expect, describe, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./connection-screen.js";
import type { SetupConnectionScreen } from "./connection-screen.js";

const q = (el: SetupConnectionScreen, sel: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(sel);

/** Rendered text with the template's own line wrapping collapsed, so a sentence can be matched. */
const text = (node: { textContent: string | null }): string =>
  node.textContent!.replace(/\s+/g, " ").trim();

const words = (el: SetupConnectionScreen): string[] =>
  text(el.shadowRoot!).split(" ").filter(Boolean);

afterEach(cleanupWidgets);

describe("setup-connection-screen", () => {
  // The screen asks the one question only the human can answer. The page CANNOT detect a
  // clicked-through certificate warning (spec 2026-09-12-box-trust-onboarding-design, Chrome 153
  // probe: after a bypass the page still reads `secureContext: true` and fetches 200), so the
  // heading has to point the operator at the address bar rather than announce a verdict.
  it("asks whether the connection is secure and points at the address bar", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(text(q(el, "h1")!)).toBe("Is your connection to this page secure?");
    const body = text(el.shadowRoot!);
    expect(body).toContain("address bar");
    expect(body).toContain("padlock");
  });

  // The whole point of the rewrite: a visitor should be able to read this screen at a glance.
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
    expect(text(link)).toContain("certificate");
  });

  // Spec: "This is a communication check, never proof of installed trust." The line must survive
  // any later trim of the copy, and it must read as a quiet aside, not as body text.
  it("keeps the caveat that Continue is not proof the certificate is installed", async () => {
    const { el, host } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    const caveat = q(el, "[data-test=continue-caveat]")!;
    expect(text(caveat)).toContain("cannot see your device's certificate settings");
    host.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    expect(getComputedStyle(caveat).color).toBe("rgb(1, 2, 3)");
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
