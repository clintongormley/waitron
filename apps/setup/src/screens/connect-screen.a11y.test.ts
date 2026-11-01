import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./connect-screen.js";
import type { SetupConnectScreen } from "./connect-screen.js";
import type { Theme } from "../widgets/test-helpers.js";

afterEach(cleanupWidgets);

async function bottomOf(el: SetupConnectScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

const CERTIFICATE = {
  pem: "-----BEGIN CERTIFICATE-----\nAUTHORITY-X\n-----END CERTIFICATE-----\n",
  fingerprint256:
    "3F:A1:9C:0B:7E:22:D4:51:88:6A:E0:13:BC:47:F9:2D:65:0E:A8:31:DC:74:5B:96:C2:0F:E7:38:41:AD:9B:16",
};

function mount(props: Partial<SetupConnectScreen>, theme: Theme) {
  return mountWidget<SetupConnectScreen>(
    "setup-connect-screen",
    { api: { primaryCertificate: vi.fn().mockResolvedValue(CERTIFICATE) }, ...props },
    theme,
  );
}

/** Opens the login fields on a clean form, as a confirmed comparison would. */
async function atLogin(el: SetupConnectScreen): Promise<void> {
  Object.assign(el, { step: "login" });
  await el.updateComplete;
}

async function toCompare(el: SetupConnectScreen): Promise<void> {
  el.shadowRoot!.querySelector("[data-test=primaryUrl]")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "https://waitron.local" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=fingerprint]")).not.toBeNull(),
  );
}

describe.each(["light", "dark"] as const)("setup-connect-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form", async () => {
    const { host } = await mount({}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the message above Connect and invalid fields shown", async () => {
    const { el, host } = await mount({}, theme);
    await atLogin(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a routed-back server error shown above Connect", async () => {
    const { el, host } = await mount({ errorMessage: "Couldn't reach the primary server." }, theme);
    expect(await bottomOf(el)).toBe("Couldn't reach the primary server.");
    await expectNoA11yViolations(host);
  });

  it("has no violations when a server error and a client error coincide (one alert)", async () => {
    const { el, host } = await mount({ errorMessage: "Couldn't reach the primary server." }, theme);
    await atLogin(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations on the compare step showing the fingerprint", async () => {
    const { el, host } = await mount({}, theme);
    await toCompare(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations once the person says the fingerprint doesn't match", async () => {
    const { el, host } = await mount({}, theme);
    await toCompare(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=mismatch]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=stopped]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on the login step with the address read-only", async () => {
    const { el, host } = await mount({}, theme);
    await toCompare(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=matches]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=primaryUrl]")!.hasAttribute("readonly")).toBe(
      true,
    );
    await expectNoA11yViolations(host);
  });
});
