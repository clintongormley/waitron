import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { StaffNotice } from "../api/client.js";
import "./notice-strip.js";
import type { TillNoticeStrip } from "./notice-strip.js";

afterEach(cleanupWidgets);

const DISK: StaffNotice = {
  owner: "core",
  key: "disk",
  code: "storage.disk_full",
  severity: "error",
  params: {},
};
const SPACE: StaffNotice = {
  ...DISK,
  key: "space",
  code: "storage.space_low",
  severity: "warning",
};
const UNSENT: StaffNotice = {
  ...DISK,
  key: "unsent",
  code: "fiscal.records_unsent",
  severity: "notice",
  params: { count: 3, held: 0 },
};

const BEHIND: StaffNotice = { ...DISK, key: "behind", code: "clock.behind_chain" };
const EXPIRED: StaffNotice = { ...SPACE, key: "drawer", code: "print_job.drawer_expired" };

describe.each(["light", "dark"] as const)("till-notice-strip a11y (%s theme)", (theme) => {
  it("has no violations while the drawer opening is in flight", async () => {
    const { host } = await mountWidget<TillNoticeStrip>(
      "till-notice-strip",
      {
        notices: [EXPIRED],
        canOpenDrawer: true,
        drawerBusy: true,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it.each([
    ["drawer without permission", [EXPIRED], false],
    ["drawer alone", [EXPIRED], true],
    ["drawer first, open", [EXPIRED, DISK], true],
    ["drawer second, open", [DISK, EXPIRED], true],
  ])("has no violations with %s", async (_state, notices, canOpenDrawer) => {
    const { el, host } = await mountWidget<TillNoticeStrip>(
      "till-notice-strip",
      { notices, canOpenDrawer },
      theme,
    );
    const toggle = el.shadowRoot!.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (toggle !== null) await userEvent.click(toggle);
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it.each([
    ["one error", [DISK]],
    ["one warning", [SPACE]],
    ["one notice", [UNSENT]],
    ["three closed", [DISK, SPACE, UNSENT]],
  ])("has no violations with %s", async (_state, notices) => {
    const { host } = await mountWidget<TillNoticeStrip>("till-notice-strip", { notices }, theme);
    await expectNoA11yViolations(host);
  });

  it.each([
    ["Check the time alone", [BEHIND]],
    ["Check the time first, open", [BEHIND, DISK]],
    ["Check the time second, open", [DISK, BEHIND]],
  ])("has no violations with %s", async (_state, notices) => {
    const { el, host } = await mountWidget<TillNoticeStrip>(
      "till-notice-strip",
      { notices, checkTimeOffered: true },
      theme,
    );
    const toggle = el.shadowRoot!.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (toggle !== null) await userEvent.click(toggle);
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with three open", async () => {
    const { el, host } = await mountWidget<TillNoticeStrip>(
      "till-notice-strip",
      { notices: [DISK, SPACE, UNSENT] },
      theme,
    );
    await userEvent.click(el.shadowRoot!.querySelector("button")!);
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with sixteen open, scrolling inside itself", async () => {
    const { el, host } = await mountWidget<TillNoticeStrip>(
      "till-notice-strip",
      { notices: Array.from({ length: 16 }, (_, i) => ({ ...SPACE, key: `space-${i}` })) },
      theme,
    );
    await userEvent.click(el.shadowRoot!.querySelector("button")!);
    await el.updateComplete;
    const list = el.shadowRoot!.querySelector("ul")!;
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    await expectNoA11yViolations(host);
  });
});
