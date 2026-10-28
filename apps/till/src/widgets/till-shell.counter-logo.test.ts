import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  applyTokens,
  applyVenueTheme,
  startVenueTheme,
  VENUE_THEME_STORAGE_KEY,
  type WtVenueLogo,
} from "@waitron/ui";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { nextLogoLoad, png } from "@waitron/ui/test/venue-logo-fixture.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";

const BUSY: Partial<TillShell> = {
  formFactor: "till",
  activeScreen: "counter",
  showCounter: true,
  showFloor: true,
  counterZones: [
    { id: "a", name: "Barra" },
    { id: "b", name: "Terraza" },
  ],
  selectedCounterZoneId: "a",
  parkedCount: 3,
  waitingCount: 2,
  operatorName: "Ana Fernández",
  affordances: ["expo"],
  transferAvailable: true,
  transferCount: 2,
  legalName: "Bar Lucía SL",
};
const QUIET: Partial<TillShell> = {
  formFactor: "till",
  activeScreen: "counter",
  operatorName: "Ana",
  legalName: "Bar Lucía SL",
};
const LOGO = png(120, 40);
const WIDE = png(160, 40);

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

const mount = (props: Partial<TillShell>) => mountWidget<TillShell>("till-shell", props);

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle(el: TillShell): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await frame();
    await el.updateComplete;
  }
}

async function atViewport(width: number, height: number, run: () => Promise<void>): Promise<void> {
  const before = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, height);
  await frame();
  try {
    await run();
  } finally {
    await page.viewport(before.width, before.height);
  }
}

const head = (el: TillShell) => el.shadowRoot!.querySelector<HTMLElement>(".head")!;
const strip = (el: TillShell) => head(el).querySelector<HTMLElement>(".till-strip")!;
const logoOf = (el: TillShell) => head(el).querySelector<WtVenueLogo>(":scope > wt-venue-logo");
const gapOf = (el: TillShell) => parseFloat(getComputedStyle(head(el)).columnGap);

function shown(el: TillShell): boolean {
  const box = logoOf(el);
  return (
    box !== null &&
    box.checkVisibility({ visibilityProperty: true }) &&
    box.parentElement === head(el) &&
    head(el).firstElementChild === box
  );
}

/** The span the strip's children take, which a sideways scroll does not change. */
function content(el: TillShell): number {
  const rects = [...strip(el).children].map((child) => child.getBoundingClientRect());
  return Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
}

const contentLeft = (el: TillShell) =>
  head(el).getBoundingClientRect().left + parseFloat(getComputedStyle(head(el)).paddingLeft);

const childWidths = (el: TillShell) =>
  [...strip(el).children].map((child) => child.getBoundingClientRect().width);

interface Baseline {
  hostWidth: number;
  stripWidth: number;
  stripLeft: number;
  scrollWidth: number;
  clientWidth: number;
  content: number;
  session: DOMRect;
  widths: number[];
}

/** The same bar with no venue logo, measured and then taken off the page. */
async function baseline(props: Partial<TillShell>, hostWidth?: number): Promise<Baseline> {
  startFrom(FIXTURE_ANSWER);
  const { el } = await mount(props);
  if (hostWidth !== undefined) el.style.width = `${hostWidth}px`;
  await settle(el);
  const s = strip(el);
  const box = s.getBoundingClientRect();
  const result = {
    hostWidth: el.getBoundingClientRect().width,
    stripWidth: box.width,
    stripLeft: box.left,
    scrollWidth: s.scrollWidth,
    clientWidth: s.clientWidth,
    content: content(el),
    session: head(el).querySelector(".session")!.getBoundingClientRect(),
    widths: childWidths(el),
  };
  cleanupWidgets();
  return result;
}

/** Mounts `props` with `logo` stored and waits for its image to load. */
async function mountWithLogo(props: Partial<TillShell>, logo = LOGO): Promise<TillShell> {
  const loaded = nextLogoLoad();
  startFrom(withLogo(logo));
  const { el } = await mount(props);
  await loaded;
  await settle(el);
  return el;
}

/** The host width at which `props`' strip has exactly room for the logo. */
async function edge(props: Partial<TillShell>): Promise<{ wStar: number; logoWidth: number }> {
  const base = await baseline(props);
  const probe = await mountWithLogo(props);
  const logoWidth = logoOf(probe)!.getBoundingClientRect().width;
  const need = logoWidth + gapOf(probe);
  cleanupWidgets();
  return { wStar: base.hostWidth + (base.content + need - base.stripWidth), logoWidth };
}

async function widthTo(el: TillShell, px: number): Promise<void> {
  el.style.width = `${px}px`;
  el.requestUpdate();
  await settle(el);
}

beforeEach(() => {
  applyTokens(document.documentElement);
});

afterEach(() => {
  cleanupWidgets();
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, { fetchImpl: rejecting });
});

describe("the venue logo in a cash register's bar", () => {
  it("with no venue logo, the counter bar draws no logo and no word", async () => {
    startFrom(FIXTURE_ANSWER);
    await atViewport(1280, 800, async () => {
      const { el } = await mount(QUIET);
      await settle(el);
      expect(logoOf(el)).toBeNull();
      expect(el.shadowRoot!.querySelector(".brand")).toBeNull();
    });
  });

  it("while the theme has not answered, the counter bar draws nothing in the logo's place", async () => {
    startFrom(null);
    await atViewport(1280, 800, async () => {
      const { el } = await mount(QUIET);
      await settle(el);
      expect(logoOf(el)).toBeNull();
      expect(strip(el).getBoundingClientRect().left).toBeCloseTo(contentLeft(el), 0);
    });
  });

  it("a venue logo comes first, before the strip, 32 tall, named by the legal name", async () => {
    await atViewport(1280, 800, async () => {
      const el = await mountWithLogo(QUIET);
      expect(shown(el)).toBe(true);
      const box = logoOf(el)!;
      expect(box.getAttribute("size")).toBe("bar");
      expect(box.getAttribute("alt")).toBe("Bar Lucía SL");
      const img = box.shadowRoot!.querySelector("img")!.getBoundingClientRect();
      expect(Math.abs(img.width - 96)).toBeLessThanOrEqual(1);
      expect(Math.abs(img.height - 32)).toBeLessThanOrEqual(1);
      expect(img.right).toBeLessThanOrEqual(strip(el).getBoundingClientRect().left);
      expect(el.shadowRoot!.querySelector(".brand")).toBeNull();
      expect(box.childElementCount).toBe(0);
    });
  });

  it("a wide logo is drawn at most 128 px wide", async () => {
    await atViewport(1280, 800, async () => {
      const el = await mountWithLogo(QUIET, WIDE);
      const img = logoOf(el)!.shadowRoot!.querySelector("img")!.getBoundingClientRect();
      expect(Math.abs(img.width - 128)).toBeLessThanOrEqual(1);
      expect(Math.abs(img.height - 32)).toBeLessThanOrEqual(1);
    });
  });

  for (const locale of ["en-GB", "es-ES"]) {
    for (const [name, props] of [
      ["busy", BUSY],
      ["quiet", QUIET],
    ] as const) {
      for (const [width, height] of [
        [1024, 768],
        [1280, 800],
      ] as const) {
        it(`${locale} ${name} bar at ${width}: the logo shows exactly while the strip has room`, async () => {
          const before = currentLocale();
          setLocale(locale);
          try {
            await atViewport(width, height, async () => {
              const base = await baseline(props);
              const el = await mountWithLogo(props);
              const logoWidth = logoOf(el)!.getBoundingClientRect().width;
              const room = base.content + logoWidth + gapOf(el) <= base.stripWidth;
              expect(shown(el)).toBe(room);
              const s = strip(el);
              if (shown(el)) {
                expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
                childWidths(el).forEach((w, i) => {
                  expect(Math.abs(w - base.widths[i]!)).toBeLessThanOrEqual(0.5);
                });
                const session = head(el).querySelector(".session")!.getBoundingClientRect();
                expect(Math.abs(session.left - base.session.left)).toBeLessThanOrEqual(0.5);
                expect(Math.abs(session.width - base.session.width)).toBeLessThanOrEqual(0.5);
              } else {
                expect(s.scrollWidth).toBe(base.scrollWidth);
                expect(s.clientWidth).toBe(base.clientWidth);
                expect(
                  Math.abs(s.getBoundingClientRect().left - base.stripLeft),
                ).toBeLessThanOrEqual(0.5);
              }
              if (name === "quiet") expect(shown(el)).toBe(true);
              else if (width === 1024) expect(shown(el)).toBe(false);
              else
                console.log(
                  `${locale} busy 1280: shown ${shown(el)}, strip free ${base.stripWidth - base.content}`,
                );
            });
          } finally {
            setLocale(before);
          }
        });
      }
    }
  }

  describe("at the edge of the room", () => {
    it("with 4 px more than the logo needs, it shows and the strip does not scroll", async () => {
      await atViewport(1280, 800, async () => {
        const { wStar } = await edge(QUIET);
        const el = await mountWithLogo(QUIET);
        await widthTo(el, wStar + 4);
        expect(shown(el)).toBe(true);
        expect(strip(el).scrollWidth).toBeLessThanOrEqual(strip(el).clientWidth);
      });
    });

    it("with 4 px less, it is left out and keeps its loaded image", async () => {
      await atViewport(1280, 800, async () => {
        const { wStar, logoWidth } = await edge(QUIET);
        const el = await mountWithLogo(QUIET);
        await widthTo(el, wStar - 4);
        expect(shown(el)).toBe(false);
        expect(Math.abs(logoOf(el)!.getBoundingClientRect().width - logoWidth)).toBeLessThanOrEqual(
          0.5,
        );
      });
    });
  });

  it("a logo that has not loaded takes no room and moves nothing", async () => {
    startFrom(null);
    await atViewport(1280, 800, async () => {
      const { el } = await mount(QUIET);
      await settle(el);
      const hold = (event: Event) => event.stopImmediatePropagation();
      applyVenueTheme(withLogo(LOGO));
      await el.updateComplete;
      const box = head(el).querySelector<WtVenueLogo>(":scope > .counter-logo")!;
      await box.updateComplete;
      const root = box.shadowRoot!;
      root.addEventListener("load", hold, { capture: true });
      try {
        await settle(el);
        expect(
          Math.abs(strip(el).getBoundingClientRect().left - contentLeft(el)),
        ).toBeLessThanOrEqual(0.5);
        expect(box.getBoundingClientRect().width).toBe(0);
      } finally {
        root.removeEventListener("load", hold, { capture: true });
      }
      const loaded = nextLogoLoad();
      applyVenueTheme(withLogo(png(121, 40), null, "logo-hash-2"));
      await loaded;
      await settle(el);
      expect(shown(el)).toBe(true);
    });
  });
});

describe("the cash register's bar measures its room again", () => {
  /** Mounts `props` with the logo at `px` wide, set without asking the shell to render. */
  async function mountAt(props: Partial<TillShell>, px: number): Promise<TillShell> {
    const el = await mountWithLogo(props);
    el.style.width = `${px}px`;
    await settle(el);
    return el;
  }

  async function quietEdge(): Promise<TillShell> {
    const { wStar } = await edge(QUIET);
    return mountAt(QUIET, wStar + 4);
  }

  it("narrowing the bar takes the logo out; widening brings it back", async () => {
    await atViewport(1280, 800, async () => {
      const { wStar } = await edge(QUIET);
      const el = await mountAt(QUIET, wStar + 4);
      expect(shown(el)).toBe(true);
      el.style.width = `${wStar - 4}px`;
      await expect.poll(() => shown(el)).toBe(false);
      el.style.width = `${wStar + 4}px`;
      await expect.poll(() => shown(el)).toBe(true);
    });
  });

  it("a control appearing takes the logo out; its going brings it back", async () => {
    await atViewport(1280, 800, async () => {
      const { wStar } = await edge(QUIET);
      const base = await baseline({ ...QUIET, transferAvailable: true }, wStar + 4);
      const el = await mountAt(QUIET, wStar + 4);
      expect(shown(el)).toBe(true);
      el.transferAvailable = true;
      await expect.poll(() => shown(el)).toBe(false);
      await settle(el);
      expect(strip(el).scrollWidth).toBe(base.scrollWidth);
      expect(strip(el).clientWidth).toBe(base.clientWidth);
      el.transferAvailable = false;
      await expect.poll(() => shown(el)).toBe(true);
    });
  });

  it("a count growing past the room takes the logo out", async () => {
    await atViewport(1280, 800, async () => {
      const { wStar } = await edge(BUSY);
      const el = await mountAt(BUSY, wStar + 4);
      expect(shown(el)).toBe(true);
      el.parkedCount = 1000;
      await expect.poll(() => shown(el)).toBe(false);
      el.parkedCount = 3;
      await expect.poll(() => shown(el)).toBe(true);
    });
  });

  it("changing the language measures again", async () => {
    const before = currentLocale();
    try {
      await atViewport(1280, 800, async () => {
        setLocale("en-GB");
        const en = (await edge(QUIET)).wStar;
        setLocale("es-ES");
        const es = (await edge(QUIET)).wStar;
        setLocale("en-GB");
        expect(Math.abs(es - en)).toBeGreaterThan(8);
        const el = await mountAt(QUIET, (en + es) / 2);
        expect(shown(el)).toBe(en < es);
        setLocale("es-ES");
        await expect.poll(() => shown(el)).toBe(es < en);
        setLocale("en-GB");
        await expect.poll(() => shown(el)).toBe(en < es);
      });
    } finally {
      setLocale(before);
    }
  });

  it("larger text in the strip measures again", async () => {
    await atViewport(1280, 800, async () => {
      const el = await quietEdge();
      expect(shown(el)).toBe(true);
      const s = strip(el);
      for (const token of ["--wt-font-size-sm", "--wt-font-size-md", "--wt-font-size-lg"]) {
        const px = parseFloat(getComputedStyle(s).getPropertyValue(token));
        s.style.setProperty(token, `${px * 1.3}px`);
      }
      s.style.fontSize = "calc(var(--wt-font-size-md) * 1.3)";
      await expect.poll(() => shown(el)).toBe(false);
    });
  });

  it("no ResizeObserver loop while the bar narrows and widens across the room", async () => {
    const messages: string[] = [];
    const onError = (event: ErrorEvent) => messages.push(event.message);
    window.addEventListener("error", onError);
    try {
      await atViewport(1280, 800, async () => {
        const { wStar } = await edge(QUIET);
        const el = await mountAt(QUIET, wStar + 4);
        for (let i = 0; i < 6; i++) {
          el.style.width = `${wStar + (i % 2 === 0 ? -4 : 4)}px`;
          await expect.poll(() => shown(el)).toBe(i % 2 !== 0);
          await settle(el);
        }
      });
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(messages.filter((m) => m.includes("ResizeObserver loop"))).toEqual([]);
  });

  it("a counter that stops being a counter drops its observer", async () => {
    await atViewport(1280, 800, async () => {
      const el = await quietEdge();
      expect(shown(el)).toBe(true);
      el.style.width = "";
      el.formFactor = "tablet-landscape";
      await settle(el);
      expect(head(el).querySelector(".counter-logo")).toBeNull();
      expect(head(el).querySelector(":scope > wt-venue-logo:not(.counter-logo)")).not.toBeNull();
      const h = head(el);
      h.style.width = "max-content";
      const natural = h.getBoundingClientRect().width;
      h.style.width = "";
      el.style.width = `${Math.round(natural * 0.6)}px`;
      await expect.poll(() => (el as unknown as { steps: number }).steps).toBeGreaterThan(0);
      el.style.width = "";
      await settle(el);
      expect(head(el).querySelector(".counter-logo")).toBeNull();
    });
  });

  it("the box is measured again when the shell comes back to the page", async () => {
    await atViewport(1280, 800, async () => {
      const { wStar } = await edge(QUIET);
      const el = await mountAt(QUIET, wStar + 4);
      expect(shown(el)).toBe(true);
      const parent = el.parentElement!;
      el.remove();
      el.style.width = `${wStar - 4}px`;
      parent.appendChild(el);
      await expect.poll(() => shown(el)).toBe(false);
      await settle(el);
      el.style.width = `${wStar + 4}px`;
      await expect.poll(() => shown(el)).toBe(true);
    });
  });

  it("a counter that leaves the page stops observing its bar", async () => {
    await atViewport(1280, 800, async () => {
      const observe = vi.spyOn(ResizeObserver.prototype, "observe");
      const disconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
      try {
        const el = await quietEdge();
        const hostObservers = observe.mock.contexts.filter(
          (_, i) => observe.mock.calls[i]![0] === el,
        );
        expect(hostObservers).toHaveLength(1);
        disconnect.mockClear();
        el.remove();
        expect(disconnect.mock.contexts).toContain(hostObservers[0]);
      } finally {
        observe.mockRestore();
        disconnect.mockRestore();
      }
    });
  });
});
