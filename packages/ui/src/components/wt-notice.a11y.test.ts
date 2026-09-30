import axe from "axe-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtNotice } from "./wt-notice.js";
import "./wt-notice.js";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe.each(["light", "dark"] as const)("wt-notice a11y (%s theme)", (theme) => {
  test("a notice on screen", async () => {
    await mountThemed('<wt-notice duration="0">Unpaired</wt-notice>', theme);
    await expectNoA11yViolations(host);
  });

  test("a notice fading out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const el = (await mountThemed(
      '<wt-notice duration="1000">Unpaired</wt-notice>',
      theme,
    )) as WtNotice;
    el.reducedMotion = false;
    host.style.setProperty("--wt-duration-fade", "60s");
    vi.advanceTimersByTime(1_000);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".fading")).not.toBeNull();
    // axe schedules its own work with setTimeout.
    vi.useRealTimers();
    await expectNoA11yViolations(host);
  });

  test("a notice that has gone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const el = (await mountThemed(
      '<wt-notice duration="1000">Unpaired</wt-notice>',
      theme,
    )) as WtNotice;
    el.reducedMotion = true;
    vi.advanceTimersByTime(1_000);
    expect(el.hidden).toBe(true);
    vi.useRealTimers();
    await expectNoA11yViolations(host);
  });

  test("detects a notice given a role that does not exist", async () => {
    await mountThemed('<wt-notice role="statuss" duration="0">Unpaired</wt-notice>', theme);
    const result = await axe.run(host);
    expect(result.violations.map(({ id }) => id)).toContain("aria-roles");
  });
});
