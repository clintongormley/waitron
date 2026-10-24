import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  applyTokens,
  applyVenueTheme,
  currentVenueLogo,
  reportVenueLogoFailure,
  startVenueTheme,
  VENUE_THEME_STORAGE_KEY,
  type WtVenueLogo,
} from "@waitron/ui";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { nextLogoLoad, png } from "@waitron/ui/test/venue-logo-fixture.js";
import { cleanupWidgets, mountWidget as mountBaseWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";

const LEGAL_NAME = "Bar Pepe SL";
const WIDE = png(160, 40);
const NARROW = png(10, 40);
const LIGHT = png(120, 40);

const never = () => new Promise<Response>(() => {});
const rejecting = () => Promise.reject(new TypeError("Failed to fetch"));

const withLogo = (light: string, dark: string | null = null, hash = "logo-hash") => ({
  ...FIXTURE_ANSWER,
  hash,
  logo: { light, dark },
});

/** Starts the venue theme from a stored copy, or with none when `answer` is null (waiting). */
function startFrom(answer: unknown): void {
  if (answer === null) localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  else localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
  startVenueTheme(document.documentElement, { fetchImpl: never });
}

const bar: Partial<TillShell> = {
  formFactor: "tablet-landscape",
  activeScreen: "floor",
  operatorName: "Ana Fernández",
  affordances: ["station", "expo"],
  legalName: LEGAL_NAME,
};

const mount = (props: Partial<TillShell> = {}, theme?: "light" | "dark") =>
  mountBaseWidget<TillShell>("till-shell", { ...bar, ...props }, theme);

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle(el: TillShell): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await frame();
    await el.updateComplete;
  }
}

const head = (el: TillShell) => el.shadowRoot!.querySelector<HTMLElement>(".head")!;
const logoOf = (el: TillShell) => head(el).querySelector<WtVenueLogo>("wt-venue-logo");
const word = (el: TillShell) => el.shadowRoot!.querySelector<HTMLElement>(".brand");
const shown = (node: Element | null) => node?.checkVisibility() ?? false;
const steps = (el: TillShell) => (el as unknown as { steps: number }).steps;

function wraps(el: TillShell): boolean {
  const h = head(el);
  const tabs = h.querySelector<HTMLElement>(".tabs")!;
  return h.scrollWidth > h.clientWidth || tabs.scrollWidth > tabs.clientWidth;
}

/** The logo and every other item of the bar share one row, centred alike, inside the bar. */
function expectOneRow(el: TillShell): void {
  const h = head(el);
  const box = h.getBoundingClientRect();
  const parts = [
    ...h.querySelectorAll<HTMLElement>(
      ":scope > .brand, :scope > wt-venue-logo, :scope > .tabs, :scope > .session > *",
    ),
  ]
    .map((part) => ({ name: part.className || part.localName, r: part.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0);
  expect(parts.map(({ name }) => name)).toContain("wt-venue-logo");
  const centres = parts.map(({ r }) => r.top + r.height / 2);
  expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(2);
  for (const { name, r } of parts) {
    expect(r.top, name).toBeGreaterThanOrEqual(box.top);
    expect(r.bottom, name).toBeLessThanOrEqual(box.bottom);
    expect(r.left, name).toBeGreaterThanOrEqual(box.left);
    expect(r.right, name).toBeLessThanOrEqual(box.right);
  }
}

/** The width the bar's content takes when nothing is squeezed. */
function natural(el: TillShell): number {
  const h = head(el);
  h.style.width = "max-content";
  const width = h.getBoundingClientRect().width;
  h.style.width = "";
  return width;
}

function nextLogoError(el: TillShell): Promise<void> {
  return new Promise((resolve) => {
    el.addEventListener("wt-logo-error", () => resolve(), { once: true });
  });
}

async function atViewport(width: number, run: () => Promise<void>): Promise<void> {
  const before = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 844);
  await frame();
  try {
    await run();
  } finally {
    await page.viewport(before.width, before.height);
  }
}

beforeEach(() => {
  applyTokens(document.documentElement);
});

afterEach(() => {
  cleanupWidgets();
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, { fetchImpl: rejecting });
});

describe("the venue logo in a handheld's bar", () => {
  it("with no venue logo, the word as today", async () => {
    startFrom(FIXTURE_ANSWER);
    await atViewport(1280, async () => {
      const { el } = await mount();
      await settle(el);
      expect(logoOf(el)).toBeNull();
      expect(head(el).querySelector(":scope > .brand")!.textContent).toBe("Waitron");
    });
  });

  it("a venue logo takes the word's place, named by the legal name", async () => {
    startFrom(withLogo(LIGHT));
    await atViewport(1280, async () => {
      const loads = nextLogoLoad();
      const { el } = await mount();
      const logo = logoOf(el)!;
      expect(logo).not.toBeNull();
      expect(logo.parentElement).toBe(head(el));
      expect(logo.getAttribute("size")).toBe("bar");
      expect(logo.getAttribute("light")).toBe(LIGHT);
      expect(logo.hasAttribute("dark")).toBe(false);
      expect(logo.getAttribute("alt")).toBe(LEGAL_NAME);
      const { img } = await loads;
      expect(img.alt).toBe(LEGAL_NAME);
      expect(img.getBoundingClientRect().height).toBeCloseTo(32, 0);
      expect(shown(word(el))).toBe(false);
      expect(head(el).querySelector(":scope > .brand")).toBeNull();
      await settle(el);
      expectOneRow(el);
    });
  });

  it("with find-bill in More, the logo and More share one row", async () => {
    startFrom(withLogo(LIGHT));
    await atViewport(1280, async () => {
      const loads = nextLogoLoad();
      const { el } = await mount({ affordances: ["find-bill", "station", "expo"] });
      await loads;
      await settle(el);
      expect(steps(el)).toBe(0);
      expect(
        head(el).querySelector('wt-row-actions[data-test="more-menu"] .find-bill'),
      ).not.toBeNull();
      expect(logoOf(el)).not.toBeNull();
      expectOneRow(el);
    });
  });

  it("names the logo by a legal name that arrives later", async () => {
    startFrom(withLogo(LIGHT));
    await atViewport(1280, async () => {
      const { el } = await mount({ legalName: "" });
      expect(logoOf(el)!.getAttribute("alt")).toBe("");
      el.legalName = LEGAL_NAME;
      await el.updateComplete;
      expect(logoOf(el)!.getAttribute("alt")).toBe(LEGAL_NAME);
    });
  });

  it("a logo reported failed is cleared once the bar loads it", async () => {
    const answer = withLogo(LIGHT);
    startFrom(answer);
    reportVenueLogoFailure(answer.logo);
    expect(currentVenueLogo()).toEqual({ kind: "logo", logo: answer.logo, failed: true });
    await atViewport(1280, async () => {
      const loads = nextLogoLoad();
      const { el } = await mount();
      expect((await loads).logo).toBe(logoOf(el));
      await expect
        .poll(() => currentVenueLogo())
        .toEqual({ kind: "logo", logo: answer.logo, failed: false });
    });
  });

  it("waiting draws an empty bar-high box", async () => {
    startFrom(null);
    await atViewport(1280, async () => {
      const { el } = await mount();
      await settle(el);
      const logo = logoOf(el)!;
      expect(logo).not.toBeNull();
      expect(logo.getAttribute("size")).toBe("bar");
      expect(logo.hasAttribute("light")).toBe(false);
      expect(logo.children).toHaveLength(0);
      expect(word(el)).toBeNull();
      const box = logo.shadowRoot!.querySelector(".box")!.getBoundingClientRect();
      expect(box.height).toBeCloseTo(32, 0);
    });
  });

  it("a failed logo shows the word through the fallback slot", async () => {
    startFrom(withLogo("/no-such.png"));
    await atViewport(1280, async () => {
      const { el } = await mount();
      const logo = logoOf(el)!;
      await expect.poll(() => logo.hasAttribute("failed")).toBe(true);
      await settle(el);
      const fallback = logo.querySelector<HTMLElement>(':scope > .brand[slot="fallback"]')!;
      expect(fallback.textContent).toBe("Waitron");
      expect(shown(fallback)).toBe(true);
    });
  });

  it("under Dark with one image the logo sits on the plate", async () => {
    startFrom(withLogo(LIGHT));
    await atViewport(1280, async () => {
      const loads = nextLogoLoad();
      const { el } = await mount({}, "dark");
      const { logo } = await loads;
      expect(logo).toBe(logoOf(el));
      expect(logo.shadowRoot!.querySelector(".box")!.hasAttribute("data-plate")).toBe(true);
    });
  });

  it("with a dark image under Dark, the dark image and no plate", async () => {
    const dark = png(90, 30);
    startFrom(withLogo(LIGHT, dark));
    await atViewport(1280, async () => {
      const loads = nextLogoLoad();
      const { el } = await mount({}, "dark");
      expect(logoOf(el)!.getAttribute("dark")).toBe(dark);
      const { logo, img } = await loads;
      expect(img.getAttribute("src")).toBe(dark);
      expect(logo.shadowRoot!.querySelector(".box")!.hasAttribute("data-plate")).toBe(false);
    });
  });

  it("left out by the same rules as the word: an item moved into More", async () => {
    startFrom(withLogo(LIGHT));
    await atViewport(1280, async () => {
      const { el } = await mount();
      await settle(el);
      el.style.width = `${Math.round(natural(el) * 0.6)}px`;
      await expect
        .poll(() => head(el).querySelector('wt-row-actions[data-test="more-menu"] .station'))
        .not.toBeNull();
      await settle(el);
      expect(logoOf(el)).toBeNull();
      expect(word(el)).toBeNull();
    });
  });

  it("left out by the same rules as the word: at phone width", async () => {
    startFrom(withLogo(LIGHT));
    await atViewport(390, async () => {
      const { el } = await mount();
      await settle(el);
      expect(logoOf(el)).toBeNull();
      expect(word(el)).toBeNull();
    });
  });

  it("a counter till draws neither", async () => {
    startFrom(withLogo(LIGHT));
    await atViewport(1280, async () => {
      const { el } = await mount({ formFactor: "till" });
      await settle(el);
      expect(el.shadowRoot!.querySelector("wt-venue-logo")).toBeNull();
      expect(word(el)).toBeNull();
    });
  });
});

describe("the bar refits when the logo changes", () => {
  /** The word's width and the bar's natural width with the word, measured once. */
  async function measureWord(): Promise<{ wordWidth: number; withWord: number }> {
    startFrom(FIXTURE_ANSWER);
    const { el } = await mount();
    await settle(el);
    const wordWidth = word(el)!.getBoundingClientRect().width;
    const withWord = natural(el);
    cleanupWidgets();
    return { wordWidth, withWord };
  }

  /** At a width where the word fits and a 4:1 logo (128 px at 32 tall) does not, a wide logo
   * arrives late: the bar starts waiting, with no step, and takes one once the image loads. */
  async function wideLogoBar(): Promise<TillShell> {
    const { wordWidth, withWord } = await measureWord();
    const width = Math.round(withWord + (128 - wordWidth) / 2);
    startFrom(null);
    const { el } = await mount();
    el.style.width = `${width}px`;
    await settle(el);
    expect(steps(el)).toBe(0);
    const loads = nextLogoLoad();
    applyVenueTheme(withLogo(WIDE));
    await el.updateComplete;
    expect(steps(el)).toBe(0);
    await loads;
    await settle(el);
    return el;
  }

  it("a wide logo that arrives late refits the bar", async () => {
    await atViewport(1280, async () => {
      const el = await wideLogoBar();
      expect(steps(el)).toBeGreaterThan(0);
      expect(wraps(el)).toBe(false);
    });
  });

  /** Mounts at a width where a 1:4 logo fits with no step and the word does not. */
  async function narrowLogoBar(): Promise<TillShell> {
    const { wordWidth } = await measureWord();
    startFrom(withLogo(NARROW));
    const loads = nextLogoLoad();
    const { el } = await mount();
    await loads;
    await settle(el);
    const logoWidth = logoOf(el)!.getBoundingClientRect().width;
    const width = Math.round(natural(el) + (wordWidth - logoWidth) / 2);
    el.style.width = `${width}px`;
    await settle(el);
    expect(steps(el)).toBe(0);
    expect(logoOf(el)).not.toBeNull();
    expect(wraps(el)).toBe(false);
    return el;
  }

  it("removing the logo refits the bar", async () => {
    await atViewport(1280, async () => {
      const el = await narrowLogoBar();
      applyVenueTheme({ ...FIXTURE_ANSWER, hash: "no-logo" });
      await settle(el);
      expect(logoOf(el)).toBeNull();
      expect(steps(el)).toBeGreaterThan(0);
      expect(wraps(el)).toBe(false);
    });
  });

  it("a logo that fails while it fits beside the word is tried again inside its box", async () => {
    await atViewport(1280, async () => {
      const el = await narrowLogoBar();
      el.style.width = "1280px";
      await settle(el);
      const image = logoOf(el)!.shadowRoot!.querySelector("img")!;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        image.dispatchEvent(new Event("error"));
        await settle(el);
        expect(steps(el)).toBe(0);
        expect(logoOf(el)).not.toBeNull();
        await vi.advanceTimersByTimeAsync(60_001);
      } finally {
        vi.useRealTimers();
      }
      await expect.poll(() => currentVenueLogo()).toMatchObject({ failed: false });
      expect(logoOf(el)!.shadowRoot!.querySelector("img")!.naturalWidth).toBeGreaterThan(0);
    });
  });

  it("a logo that fails where only the logo fits is tried again after 60 s and drawn once it loads", async () => {
    await atViewport(1280, async () => {
      const el = await narrowLogoBar();
      const image = logoOf(el)!.shadowRoot!.querySelector("img")!;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        image.dispatchEvent(new Event("error"));
        await settle(el);
        expect(steps(el)).toBeGreaterThan(0);
        expect(logoOf(el)).toBeNull();
        await vi.advanceTimersByTimeAsync(60_001);
        await settle(el);
        expect(logoOf(el), "the narrow image should be retried and fit again").not.toBeNull();
        expect(currentVenueLogo()).toMatchObject({ failed: false });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("while a logo only it fits keeps failing, the bar asks for it once every 60 s", async () => {
    await atViewport(1280, async () => {
      const el = await narrowLogoBar();
      const address = "/no-such-narrow-logo.png";
      const requests = () =>
        performance.getEntriesByName(new URL(address, location.href).href).length;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        let failed = nextLogoError(el);
        applyVenueTheme(withLogo(address, null, "broken"));
        await failed;
        await settle(el);
        expect(requests()).toBe(1);
        for (const attempt of [2, 3]) {
          expect(steps(el)).toBeGreaterThan(0);
          expect(logoOf(el)).toBeNull();
          await vi.advanceTimersByTimeAsync(59_000);
          await settle(el);
          expect(requests()).toBe(attempt - 1);
          expect(logoOf(el)).toBeNull();
          failed = nextLogoError(el);
          await vi.advanceTimersByTimeAsync(1_001);
          await failed;
          await settle(el);
          expect(requests()).toBe(attempt);
        }
        expect(steps(el)).toBeGreaterThan(0);
        expect(logoOf(el)).toBeNull();
        expect(wraps(el)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("a bar off the page keeps no timer for a failed logo it hides, and starts one on its return", async () => {
    await atViewport(1280, async () => {
      const el = await narrowLogoBar();
      const image = logoOf(el)!.shadowRoot!.querySelector("img")!;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        image.dispatchEvent(new Event("error"));
        await settle(el);
        expect(logoOf(el)).toBeNull();
        expect(vi.getTimerCount()).toBe(1);
        const parent = el.parentElement!;
        el.remove();
        expect(vi.getTimerCount()).toBe(0);
        parent.append(el);
        expect(vi.getTimerCount()).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("a counter till and a handheld at phone width keep no timer for a failed logo", async () => {
    const answer = withLogo(LIGHT);
    startFrom(answer);
    reportVenueLogoFailure(answer.logo);
    for (const [width, props] of [
      [1280, { formFactor: "till" }],
      [390, {}],
    ] as const) {
      await atViewport(width, async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
          const { el } = await mount(props);
          await settle(el);
          expect(el.shadowRoot!.querySelector("wt-venue-logo")).toBeNull();
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          vi.useRealTimers();
          cleanupWidgets();
        }
      });
    }
  });

  it("a failing logo refits the bar", async () => {
    await atViewport(1280, async () => {
      const el = await narrowLogoBar();
      applyVenueTheme(withLogo("/no-such.png", null, "broken"));
      await expect.poll(() => steps(el)).toBeGreaterThan(0);
      await settle(el);
      expect(wraps(el)).toBe(false);
    });
  });

  it("a logo removed while the bar is off the page refits it when it comes back", async () => {
    await atViewport(1280, async () => {
      const el = await wideLogoBar();
      expect(steps(el)).toBe(1);
      const parent = el.parentElement!;
      el.remove();
      applyVenueTheme({ ...FIXTURE_ANSWER, hash: "no-logo" });
      parent.append(el);
      await settle(el);
      expect(steps(el)).toBe(0);
      expect(shown(head(el).querySelector(":scope > .brand"))).toBe(true);
      expect(wraps(el)).toBe(false);
    });
  });
});
