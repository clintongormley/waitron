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

const LAYOUTS: [string, JoinState, string][] = [
  ["the address", { state: "none" }, "primaryUrl"],
  [
    "waiting, with the code",
    {
      state: "waiting",
      code: "482913",
      addresses: ["192.168.1.23"],
      primaryUrl: "https://waitron.local",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    },
    "code",
  ],
  ["approved, with Finish joining", { state: "approved", code: "482913" }, "finish"],
  ["ended", { state: "ended", reason: "wrong_code" }, "start-again"],
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
});
