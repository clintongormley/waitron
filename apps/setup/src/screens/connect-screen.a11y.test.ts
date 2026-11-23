import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./connect-screen.js";
import type { SetupConnectScreen } from "./connect-screen.js";
import type { JoinState } from "../api/client.js";
import type { Theme } from "../widgets/test-helpers.js";

afterEach(cleanupWidgets);

async function mount(state: JoinState, theme: Theme) {
  const api = {
    startJoin: vi.fn(),
    joinState: vi.fn().mockResolvedValue(state),
    cancelJoin: vi.fn(),
    confirmJoin: vi.fn(),
  };
  const mounted = await mountWidget<SetupConnectScreen>(
    "setup-connect-screen",
    { api, handle: "h1" },
    theme,
  );
  await vi.waitFor(() =>
    expect(mounted.el.shadowRoot!.querySelector("[data-test=reading]")).toBeNull(),
  );
  return mounted;
}

const WAITING: JoinState = {
  state: "waiting",
  code: "482913",
  primaryUrl: "https://waitron.local",
  timeLeftMs: 600_000,
  confirmed: false,
};

const LAYOUTS: [string, JoinState, string][] = [
  ["the address", { state: "none" }, "primaryUrl"],
  ["waiting, asking whether the main box shows the code", WAITING, "yes"],
  ["waiting for Add as spare on the main box", { ...WAITING, confirmed: true }, "no"],
  ["added, finishing joining", { state: "approved" }, "start-again"],
  ["ended", { state: "ended", reason: "dismissed" }, "start-again"],
];

describe.each(["light", "dark"] as const)("setup-connect-screen a11y (%s theme)", (theme) => {
  it.each(LAYOUTS)("has no violations: %s", async (_name, state, shown) => {
    const { el, host } = await mount(state, theme);
    expect(el.shadowRoot!.querySelector(`[data-test=${shown}]`)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations with the address marked and the message above Join", async () => {
    const { el, host } = await mount({ state: "none" }, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=join]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(
      true,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with Start again beside Join after a refusal naming it", async () => {
    const { el, host } = await mount({ state: "none" }, theme);
    (el.api.startJoin as ReturnType<typeof vi.fn>).mockRejectedValue({
      code: "mirror.join_in_use",
    });
    el.shadowRoot!.querySelector("wt-input")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "https://waitron.local" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=join]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=start-again]")).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with Try again after a refused Finish joining", async () => {
    const { el, host } = await mount({ state: "approved" }, theme);
    el.refusal = { code: "mirror.bundle_fetch_failed" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=finish]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
