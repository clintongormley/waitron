import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import { THEME_STORAGE_KEY, chooseTheme, startThemeChoice } from "../theme-choice.js";
import { VENUE_LOGO_RETRY_MS, type WtVenueLogo } from "./wt-venue-logo.js";
import "./wt-venue-logo.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

function png(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

const MISSING = "/no-such.png";
const FALLBACK = `<span slot="fallback">W</span>`;

const box = (el: WtVenueLogo) => el.shadowRoot!.querySelector<HTMLElement>(".box");
const images = (el: WtVenueLogo) => [...el.shadowRoot!.querySelectorAll<HTMLImageElement>("img")];
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function logo(attributes: string): Promise<WtVenueLogo> {
  const el = (await mount(
    `<wt-venue-logo ${attributes}>${FALLBACK}</wt-venue-logo>`,
  )) as WtVenueLogo;
  return el;
}

function next(el: WtVenueLogo, type: "wt-logo-error" | "wt-logo-load"): Promise<void> {
  return new Promise((resolve) => el.addEventListener(type, () => resolve(), { once: true }));
}

async function rendered(el: WtVenueLogo): Promise<void> {
  await el.updateComplete;
  await frame();
}

async function advance(el: WtVenueLogo, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await rendered(el);
}

async function failed(attributes: string): Promise<WtVenueLogo> {
  const el = await logo(attributes);
  await next(el, "wt-logo-error");
  await rendered(el);
  return el;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  vi.useRealTimers();
  localStorage.removeItem(THEME_STORAGE_KEY);
  chooseTheme("device");
  await commands.emulateColorScheme(null);
  startThemeChoice(document.documentElement);
  cleanup();
});

describe("wt-venue-logo when its image fails", () => {
  it("waits a minute between tries", () => {
    expect(VENUE_LOGO_RETRY_MS).toBe(60_000);
  });

  it("starts out not failed", () => {
    expect(document.createElement("wt-venue-logo").failed).toBe(false);
  });

  it("a failed image shows the fallback", async () => {
    const el = await logo(`light="${MISSING}"`);
    expect(el.failed).toBe(false);
    expect(el.hasAttribute("failed")).toBe(false);
    expect(el.shadowRoot!.querySelector("slot")).toBeNull();
    const fallback = el.querySelector("span")!;
    expect(fallback.getBoundingClientRect().width).toBe(0);

    await next(el, "wt-logo-error");
    await rendered(el);
    expect(el.failed).toBe(true);
    expect(el.hasAttribute("failed")).toBe(true);
    expect(box(el)).toBeNull();
    expect(images(el)).toEqual([]);
    expect(el.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="fallback"]')).not.toBeNull();
    expect(fallback.assignedSlot?.name).toBe("fallback");
    expect(fallback.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("tries the same address again after 60 seconds", async () => {
    const el = await logo(`light="${MISSING}"`);
    const first = images(el)[0]!;
    await next(el, "wt-logo-error");
    await rendered(el);
    expect(images(el)).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);

    await advance(el, VENUE_LOGO_RETRY_MS - 1);
    expect(images(el)).toEqual([]);

    let errors = 0;
    el.addEventListener("wt-logo-error", () => errors++);
    await advance(el, 1);
    const retries = images(el);
    expect(retries).toHaveLength(1);
    const retry = retries[0]!;
    expect(retry).not.toBe(first);
    expect(retry.getAttribute("src")).toBe(MISSING);
    expect(retry.hidden).toBe(true);
    expect(getComputedStyle(retry).display).toBe("none");
    expect(retry.alt).toBe("");

    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await rendered(el);
    expect(el.failed).toBe(true);
    expect(box(el)).toBeNull();
    expect(vi.getTimerCount()).toBe(1);

    await advance(el, VENUE_LOGO_RETRY_MS);
    const again = images(el);
    expect(again).toHaveLength(1);
    expect(again[0]).not.toBe(retry);
    expect(again[0]!.getAttribute("src")).toBe(MISSING);
    expect(errors).toBe(0);
  });

  it("a retry that loads shows the logo and says so", async () => {
    const address = png(400, 100);
    const el = await logo(`light="${address}"`);
    const first = images(el)[0]!;
    // The ratio is set by the image's own load, so its real load cannot arrive after the failure.
    await vi.waitFor(() =>
      expect(box(el)!.style.getPropertyValue("--wt-venue-logo-ratio")).toBe("4"),
    );
    const loads: CustomEvent<{ src: string }>[] = [];
    const sentBy: boolean[] = [];
    el.addEventListener("wt-logo-load", (e) => {
      loads.push(e as CustomEvent<{ src: string }>);
      sentBy.push(images(el)[0]!.hasAttribute("hidden"));
    });
    first.dispatchEvent(new Event("error"));
    await rendered(el);
    expect(el.failed).toBe(true);
    expect(box(el)).toBeNull();

    await advance(el, VENUE_LOGO_RETRY_MS);
    await vi.waitFor(() => expect(el.failed).toBe(false));
    await rendered(el);
    expect(el.hasAttribute("failed")).toBe(false);
    expect(box(el)).not.toBeNull();
    const drawn = images(el);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.getAttribute("src")).toBe(address);
    expect(drawn[0]!.hidden).toBe(false);
    expect(box(el)!.style.getPropertyValue("--wt-venue-logo-ratio")).toBe("4");
    await vi.waitFor(() => expect(drawn[0]!.complete).toBe(true));
    await rendered(el);
    expect(loads).toHaveLength(1);
    expect(loads[0]!.detail).toEqual({ src: address });
    expect(sentBy).toEqual([true]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one timer and stops the hidden image's own error at the box", async () => {
    const el = await failed(`light="${MISSING}"`);
    await advance(el, VENUE_LOGO_RETRY_MS);
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    const native: string[] = [];
    el.shadowRoot!.addEventListener("error", (e) => native.push(e.type));
    const retry = images(el)[0]!;
    retry.dispatchEvent(new Event("error", { bubbles: true }));
    retry.dispatchEvent(new Event("error", { bubbles: true }));
    expect(vi.getTimerCount()).toBe(1);
    expect(native).toEqual([]);
  });

  it("ignores a hidden image that an address change removed", async () => {
    const el = await failed(`light="${MISSING}"`);
    await advance(el, VENUE_LOGO_RETRY_MS);
    const retry = images(el)[0]!;
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    el.light = png(400, 100);
    await rendered(el);
    expect(retry.isConnected).toBe(false);
    const loads: Event[] = [];
    el.addEventListener("wt-logo-load", (e) => loads.push(e));
    retry.dispatchEvent(new Event("error"));
    expect(vi.getTimerCount()).toBe(0);
    await vi.waitFor(() =>
      expect(box(el)!.style.getPropertyValue("--wt-venue-logo-ratio")).toBe("4"),
    );
    retry.dispatchEvent(new Event("load"));
    await rendered(el);
    expect(loads).toEqual([]);
    expect(box(el)!.style.getPropertyValue("--wt-venue-logo-ratio")).toBe("4");
  });

  it("an address change clears the failure and the timer", async () => {
    const el = await failed(`light="${MISSING}"`);
    expect(vi.getTimerCount()).toBe(1);
    const address = png(400, 100);
    el.light = address;
    await rendered(el);
    expect(el.failed).toBe(false);
    expect(el.hasAttribute("failed")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(images(el).map((image) => image.getAttribute("src"))).toEqual([address]);

    await advance(el, VENUE_LOGO_RETRY_MS);
    expect(images(el)).toHaveLength(1);
    expect(images(el)[0]!.hidden).toBe(false);
  });

  it("switching between the light and the dark image clears the failure", async () => {
    const light = png(400, 100);
    await commands.emulateColorScheme("light");
    const el = await logo(`light="${light}" dark="${MISSING}"`);
    startThemeChoice(host);
    const errored = next(el, "wt-logo-error");
    chooseTheme("dark");
    await errored;
    await rendered(el);
    expect(el.failed).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    chooseTheme("light");
    await rendered(el);
    expect(el.failed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(images(el).map((image) => image.getAttribute("src"))).toEqual([light]);
  });

  it("disconnecting clears the timer; reconnecting while failed starts one", async () => {
    const el = await failed(`light="${MISSING}"`);
    expect(vi.getTimerCount()).toBe(1);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
    host.append(el);
    expect(vi.getTimerCount()).toBe(1);
    await advance(el, VENUE_LOGO_RETRY_MS);
    expect(images(el)).toHaveLength(1);
  });

  it("lets go of the light-or-dark watch when disconnected", async () => {
    const el = await logo(`light="${MISSING}"`);
    const removed = vi.spyOn(MediaQueryList.prototype, "removeEventListener");
    el.remove();
    expect(removed).toHaveBeenCalledWith("change", expect.any(Function));
    removed.mockRestore();
  });

  it("connecting without a failure starts no timer", async () => {
    const el = await logo(`light="${png(400, 100)}"`);
    el.remove();
    host.append(el);
    expect(vi.getTimerCount()).toBe(0);
  });
});
