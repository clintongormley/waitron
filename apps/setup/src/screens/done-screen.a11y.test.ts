import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./done-screen.js";
import type { SetupDoneScreen } from "./done-screen.js";
import type { SetupApi } from "../api/client.js";

function apiWith(getStatus: () => Promise<unknown>): SetupApi {
  return { getStatus } as unknown as SetupApi;
}

const q = (el: SetupDoneScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-done-screen a11y (%s theme)", (theme) => {
  it("has no violations while waiting for the restart", async () => {
    const { host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      { api: apiWith(() => new Promise(() => {})), startDelayMs: 100000, pollIntervalMs: 100000 },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations once the reload control is offered", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(vi.fn().mockRejectedValue({ code: "server.internal" })),
        startDelayMs: 0,
        pollIntervalMs: 3,
      },
      theme,
    );
    await vi.waitFor(() => expect(q(el, "[data-test=reload]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });
});
