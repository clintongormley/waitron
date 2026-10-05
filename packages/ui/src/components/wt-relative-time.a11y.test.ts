import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtRelativeTime } from "./wt-relative-time.js";
import "./wt-relative-time.js";

afterEach(cleanup);

const AT = "2026-10-05T11:49:00.000Z";

/** The phrase takes the colour of the text around it, so the sentence carries the page's. */
async function mountAt(theme: "light" | "dark", attributes = ""): Promise<WtRelativeTime> {
  const el = (await mountThemed(
    `<p style="color: var(--wt-color-text)">Updated <wt-relative-time datetime="${AT}" locale="en-GB" ${attributes}></wt-relative-time></p>`,
    theme,
  )) as HTMLElement;
  const time = el.querySelector("wt-relative-time")!;
  time.now = () => new Date(Date.parse(AT) + 12 * 60_000);
  await time.updateComplete;
  return time;
}

describe.each(["light", "dark"] as const)("wt-relative-time a11y (%s theme)", (theme) => {
  test("the phrase at rest", async () => {
    await mountAt(theme);
    await expectNoA11yViolations(host);
  });

  test("the phrase focused", async () => {
    const el = await mountAt(theme);
    el.shadowRoot!.querySelector("button")!.focus();
    expect(el.shadowRoot!.activeElement).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the exact time shown", async () => {
    const el = await mountAt(theme);
    const button = el.shadowRoot!.querySelector("button")!;
    button.click();
    expect(el.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await el.updateComplete;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await expectNoA11yViolations(host);
  });

  test("a deadline already gone, reading now", async () => {
    const el = await mountAt(theme, "future");
    expect(el.shadowRoot!.querySelector("time")!.textContent!.trim()).toBe("now");
    await expectNoA11yViolations(host);
  });
});
