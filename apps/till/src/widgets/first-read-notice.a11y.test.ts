import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillFloorScreen } from "../screens/till-floor-screen.js";
import "../screens/till-floor-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

it.each(["light", "dark"] as const)(
  "announces the Floor wait and the refusal without speaking Try again in %s",
  async (theme) => {
    setLocale("en-GB");
    const { el, host } = await mountWidget<TillFloorScreen & { firstRead: string }>(
      "till-floor-screen",
      { firstRead: "waiting", handheld: true },
      theme,
    );
    const root = el.shadowRoot!;
    const message = root.querySelector("[data-first-read-status]");
    expect(message?.textContent).toContain("Still waiting for the box");
    expect(root.querySelector("[data-floor-retry]")).toBeNull();
    await expectNoA11yViolations(host);

    el.firstRead = "unreachable";
    await el.updateComplete;
    const retry = root.querySelector("[data-floor-retry]");
    expect(message?.textContent).toContain("Can't reach the box");
    expect(message?.textContent).toContain("WiFi");
    expect(message?.textContent).not.toContain("Try again");
    expect(retry?.textContent).toContain("Try again");
    expect(message?.contains(retry)).toBe(false);
    await expectNoA11yViolations(host);
  },
);

it("offers network help for a fixed till", async () => {
  setLocale("en-GB");
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    firstRead: "unreachable",
    handheld: false,
  });

  expect(el.shadowRoot!.querySelector("[data-first-read-status]")?.textContent).toContain(
    "Check this till is connected to the venue's network.",
  );
});
