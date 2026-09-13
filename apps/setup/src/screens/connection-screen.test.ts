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
  //
  // Spec: "This is a communication check, never proof of installed trust." The disclaimer sentence
  // that used to carry that is gone (owner copy, 2026-09-13). Nothing guards its absence by
  // forbidden words — the owner's own copy says "whether this page is secure or not", so any such
  // list catches honest phrasing and misses the dishonest phrasing nobody thought of. What stands
  // in its place: the heading below must stay a QUESTION, and the two branch tests further down
  // pin that the screen offers a choice rather than announcing a result.
  it("asks whether the connection is secure and points at the address bar", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(text(q(el, "h1")!)).toBe("Is your connection to this page secure?");
    expect(text(q(el, "h1")!).endsWith("?")).toBe(true); // a question, never a verdict
    const body = text(el.shadowRoot!);
    expect(body).toContain("address bar");
    // The operator is told the exact words their browser shows, not a paraphrase to interpret.
    expect(body).toContain("not secure");
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
    expect(text(link)).toBe("install this server's certificate");
  });

  // The operator is matching words on their own screen, so the page shows the browser's warning the
  // way the browser shows it. Colour is emphasis only — the literal words "not secure" carry the
  // meaning, so this reads the same to anyone who cannot see the red.
  it("shows the browser's warning words in the browser's own red, and bold", async () => {
    const { el, host } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    const warning = el.shadowRoot!.querySelector<HTMLElement>("[data-test=warning-words]")!;
    expect(text(warning)).toContain("not secure");
    expect(Number(getComputedStyle(warning).fontWeight)).toBeGreaterThanOrEqual(600);
    host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
    expect(getComputedStyle(warning).color).toBe("rgb(4, 5, 6)");
  });

  // The link is the "not secure" branch of one sentence, so it has to sit INSIDE that sentence.
  // Lifted into a paragraph of its own it stops being the consequence of what the operator just read.
  it("puts the guide link inside the sentence that describes the warning", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    const link = el.shadowRoot!.querySelector("[data-test=trust-help]")!;
    expect(text(link.parentElement!)).toContain("not secure");
  });

  // The other branch: nothing wrong, so carry on. "Otherwise" is what makes Continue the
  // alternative to installing rather than an unrelated button sitting underneath.
  it("offers Continue as the other branch of the same choice", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {});
    expect(text(q(el, "[data-test=otherwise]")!)).toBe("Otherwise:");
  });

  /**
   * A server that is already set up cannot be set up again, so offering "Otherwise: Continue to
   * setup" offers a door that leads back to the same failure. The QUESTION above stays, and so does
   * the install link: the operator still needs this server's certificate trusted to use the till.
   */
  it("drops the Continue row when this server cannot be set up from here", async () => {
    const { el } = await mountWidget<SetupConnectionScreen>("setup-connection-screen", {
      setupUnavailable: true,
      errorMessage: "This server is already set up. Reload to open it.",
    });
    expect(q(el, "[data-test=continue]")).toBeNull();
    expect(q(el, "[data-test=otherwise]")).toBeNull();
    // What the operator still needs is all still there.
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
