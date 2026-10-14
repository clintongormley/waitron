import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";
import {
  clockApp,
  clockPage,
  pageButton,
  shellAction,
  signIn,
  working,
} from "../test/clock-app.js";
const originalLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
  setLocale(originalLocale);
});
describe.each(["light", "dark"] as const)("till clocking app accessibility in %s", (theme) => {
  it.each([
    ["en-GB", 390],
    ["en-GB", 1280],
    ["es-ES", 390],
    ["es-ES", 1280],
  ] as const)(
    "first page, working menu and recorded-out lock in %s at %s",
    async (locale, width) => {
      const previous = { width: innerWidth, height: innerHeight };
      await page.viewport(width, 844);
      try {
        const f = await clockApp({ theme });
        await signIn(f.el);
        await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
        setLocale(locale);
        await f.el.updateComplete;
        await expectNoA11yViolations(f.host);
        await pageButton(f.el, "[data-clock-in]");
        await working(f.el);
        const shell = f.el.shadowRoot!.querySelector("till-tab-shell")!;
        const menu = shell.shadowRoot!.querySelector(
          width === 390 ? 'wt-row-actions[data-test="more-menu"]' : "wt-row-actions.operator-menu",
        )!;
        await (menu as unknown as { updateComplete: Promise<unknown> }).updateComplete;
        await userEvent.click(menu.shadowRoot!.querySelector("button")!);
        await expectNoA11yViolations(f.host);
        await userEvent.keyboard("{Escape}");
        f.api.logout.mockRejectedValueOnce(new TypeError("offline"));
        await shellAction(f.el, '[data-clock-action="out"]');
        await vi.waitFor(() =>
          expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
        );
        expect(f.el.shadowRoot!.querySelector("[data-clocked-out]")).not.toBeNull();
        await expectNoA11yViolations(f.host);
      } finally {
        await page.viewport(previous.width, previous.height);
      }
    },
  );
});
