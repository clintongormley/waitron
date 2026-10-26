import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  applyTokens,
  currentVenueLogo,
  reportVenueLogoFailure,
  startVenueTheme,
  VENUE_THEME_STORAGE_KEY,
  type WtPoweredBy,
  type WtVenueLogo,
} from "@waitron/ui";
import { WAITRON_LOCKUP_DARK_URL, WAITRON_LOCKUP_URL } from "@waitron/ui/src/waitron-lockup.js";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { nextLogoLoad, png } from "@waitron/ui/test/venue-logo-fixture.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";

const LIGHT = png(120, 40);

const never = () => new Promise<Response>(() => {});
const rejecting = () => Promise.reject(new TypeError("Failed to fetch"));

const withLogo = (light: string) => ({
  ...FIXTURE_ANSWER,
  hash: "logo-hash",
  logo: { light, dark: null },
});

/** Starts the venue theme from a stored copy, or with none when `answer` is null (waiting). */
function startFrom(answer: unknown): void {
  if (answer === null) localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  else localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
  startVenueTheme(document.documentElement, { fetchImpl: never });
}

const handheld: Partial<TillShell> = {
  formFactor: "tablet-landscape",
  activeScreen: "floor",
  operatorName: "Ana",
  affordances: ["station", "expo"],
  legalName: "Bar Pepe SL",
};

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle(el: TillShell): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await frame();
    await el.updateComplete;
  }
}

const moreMenu = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    'wt-row-actions[data-test="more-menu"]',
  )!;
const popup = (el: TillShell) => moreMenu(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const lines = (el: TillShell) => [...moreMenu(el).querySelectorAll<WtPoweredBy>("wt-powered-by")];
const lineOf = (el: TillShell) => moreMenu(el).querySelector<WtPoweredBy>("wt-powered-by");

async function openMenu(el: TillShell): Promise<void> {
  const menu = moreMenu(el);
  await menu.updateComplete;
  menu.shadowRoot!.querySelector<HTMLElement>("button")!.click();
  await vi.waitFor(() => expect(popup(el).matches(":popover-open")).toBe(true));
  await settle(el);
}

async function atViewport(width: number, height: number, run: () => Promise<void>) {
  const before = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, height);
  await frame();
  try {
    await run();
  } finally {
    await page.viewport(before.width, before.height);
  }
}

async function lockupLoaded(line: WtPoweredBy): Promise<HTMLImageElement> {
  await line.updateComplete;
  const lockup = line.shadowRoot!.querySelector<HTMLImageElement>('[part="lockup"]')!;
  await expect.poll(() => lockup.complete && lockup.naturalWidth > 0).toBe(true);
  return lockup;
}

/** Mounts a handheld with the stored logo and waits for the logo the bar or nothing draws. */
async function mountWithLogo(theme?: "light" | "dark", props: Partial<TillShell> = {}) {
  startFrom(withLogo(LIGHT));
  const { el } = await mountWidget<TillShell>("till-shell", { ...handheld, ...props }, theme);
  await settle(el);
  return el;
}

beforeEach(() => {
  applyTokens(document.documentElement);
});

afterEach(() => {
  cleanupWidgets();
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, { fetchImpl: rejecting });
});

describe("Powered by Waitron at the foot of a handheld's More", () => {
  it("with a venue logo, one line comes last, after Log out and a rule, in the strings' words", async () => {
    await atViewport(390, 844, async () => {
      const el = await mountWithLogo();
      await openMenu(el);
      expect(lines(el)).toHaveLength(1);
      const line = lineOf(el)!;
      expect(moreMenu(el).lastElementChild).toBe(line);
      const rule = line.previousElementSibling!;
      expect(rule.matches("hr.menu-rule")).toBe(true);
      expect(rule.previousElementSibling!.matches("wt-button.logout")).toBe(true);
      expect(line.getAttribute("label")).toBe(t("login.powered_by"));
      expect(line.shadowRoot!.querySelector('[part="label"]')!.textContent).toBe("Powered by");
      const lockup = await lockupLoaded(line);
      expect(lockup.getAttribute("src")).toBe(WAITRON_LOCKUP_URL);
      const logout = moreMenu(el).querySelector(".logout")!.getBoundingClientRect();
      expect(line.getBoundingClientRect().top).toBeGreaterThanOrEqual(logout.bottom);
    });
  });

  it("with no venue logo, no line", async () => {
    startFrom(FIXTURE_ANSWER);
    await atViewport(390, 844, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", handheld);
      await openMenu(el);
      expect(lineOf(el)).toBeNull();
      expect(moreMenu(el).lastElementChild!.matches("wt-button.logout")).toBe(true);
    });
  });

  it("while waiting for the theme's answer, no line", async () => {
    startFrom(null);
    await atViewport(390, 844, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", handheld);
      await openMenu(el);
      expect(currentVenueLogo().kind).toBe("waiting");
      expect(lineOf(el)).toBeNull();
    });
  });

  it("with a logo reported failed, no line", async () => {
    const answer = withLogo(LIGHT);
    startFrom(answer);
    reportVenueLogoFailure(answer.logo);
    await atViewport(390, 844, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", handheld);
      await openMenu(el);
      expect(currentVenueLogo()).toMatchObject({ failed: true });
      expect(lineOf(el)).toBeNull();
    });
  });

  it("goes when the logo fails and comes back once its retry loads", async () => {
    await atViewport(1280, 844, async () => {
      const loads = nextLogoLoad();
      const el = await mountWithLogo();
      await loads;
      expect(lineOf(el)).not.toBeNull();
      const bar = el.shadowRoot!.querySelector<WtVenueLogo>(".head > wt-venue-logo")!;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        bar.shadowRoot!.querySelector("img")!.dispatchEvent(new Event("error"));
        await settle(el);
        expect(currentVenueLogo()).toMatchObject({ failed: true });
        expect(lineOf(el)).toBeNull();
        const back = nextLogoLoad();
        await vi.advanceTimersByTimeAsync(60_001);
        await back;
        await settle(el);
      } finally {
        vi.useRealTimers();
      }
      expect(currentVenueLogo()).toMatchObject({ failed: false });
      expect(lines(el)).toHaveLength(1);
    });
  });

  it("says Powered by in Spanish from the strings", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      await atViewport(390, 844, async () => {
        const el = await mountWithLogo();
        await openMenu(el);
        const line = lineOf(el)!;
        await line.updateComplete;
        const words = line.shadowRoot!.querySelector('[part="label"]')!.textContent;
        expect(words).toBe(t("login.powered_by"));
        expect(words).not.toBe("Powered by");
      });
    } finally {
      setLocale(before);
    }
  });

  it.each([
    [390, 844],
    [1024, 768],
  ] as const)(
    "at %ix%i the line sits inside the open menu and the window",
    async (width, height) => {
      await atViewport(width, height, async () => {
        const el = await mountWithLogo();
        await openMenu(el);
        const line = lineOf(el)!;
        const lockup = await lockupLoaded(line);
        await frame();
        const pop = popup(el);
        // The popup scrolls what does not fit; bring its foot into view.
        pop.scrollTop = pop.scrollHeight;
        await frame();
        const box = pop.getBoundingClientRect();
        for (const part of [line.shadowRoot!.querySelector('[part="label"]')!, lockup]) {
          const r = part.getBoundingClientRect();
          expect(r.width).toBeGreaterThan(0);
          expect(r.left).toBeGreaterThanOrEqual(box.left);
          expect(r.right).toBeLessThanOrEqual(box.right);
          expect(r.top).toBeGreaterThanOrEqual(box.top);
          expect(r.bottom).toBeLessThanOrEqual(box.bottom);
          expect(r.left).toBeGreaterThanOrEqual(0);
          expect(r.right).toBeLessThanOrEqual(window.innerWidth);
          expect(r.bottom).toBeLessThanOrEqual(window.innerHeight);
        }
      });
    },
  );

  it("under Dark the lockup is the dark drawing", async () => {
    await atViewport(390, 844, async () => {
      const el = await mountWithLogo("dark");
      await openMenu(el);
      const lockup = await lockupLoaded(lineOf(el)!);
      expect(lockup.getAttribute("src")).toBe(WAITRON_LOCKUP_DARK_URL);
    });
  });
});
