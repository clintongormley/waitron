import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui-core/tokens";
import { WAITRON_CHOICES, themeSheet } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import {
  VENUE_THEME_STORAGE_KEY,
  VENUE_THEME_TIME_LIMIT_MS,
  applyVenueTheme,
  startVenueTheme,
} from "./venue-theme.js";

const KEY = VENUE_THEME_STORAGE_KEY;
const WAITRON_LIGHT_BG = "#f7f7f8";

const greenTheme = deriveTheme({ ...WAITRON_CHOICES, brandColor: "#1e5b3a", background: "tinted" });
const lemonTheme = deriveTheme({ ...WAITRON_CHOICES, brandColor: "#f2d300", background: "tinted" });
const GREEN = { hash: "green-hash", css: themeSheet(greenTheme), logo: null };
const LEMON = {
  hash: "lemon-hash",
  css: themeSheet(lemonTheme),
  logo: { light: "lemon-light", dark: null },
};
const GREEN_LIGHT_BG = greenTheme.light["--wt-color-bg"]!;
const LEMON_LIGHT_BG = lemonTheme.light["--wt-color-bg"]!;

const bg = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue("--wt-color-bg").trim();

const never = vi.fn(() => new Promise<Response>(() => {}));

function answering(body: string, init?: ResponseInit) {
  return vi.fn(() => Promise.resolve(new Response(body, init)));
}

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function storeGreen(): string {
  const text = JSON.stringify(GREEN);
  localStorage.setItem(KEY, text);
  return text;
}

/** Waits until the answer's body has been read, then one macrotask for what follows it. */
async function settled(json: ReturnType<typeof vi.spyOn>): Promise<void> {
  await vi.waitFor(() => expect(json).toHaveBeenCalled());
  await macrotask();
}

beforeEach(() => {
  applyTokens(document.documentElement);
  localStorage.removeItem(KEY);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.removeItem(KEY);
  vi.restoreAllMocks();
  startVenueTheme(document.documentElement, { fetchImpl: never });
});

describe("startVenueTheme", () => {
  it("has two distinct test colours", () => {
    expect(LEMON_LIGHT_BG).not.toBe(GREEN_LIGHT_BG);
  });

  it("the stored copy paints before the fetch answers", () => {
    storeGreen();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    expect(bg()).toBe(GREEN_LIGHT_BG);
    expect(GREEN_LIGHT_BG).not.toBe(WAITRON_LIGHT_BG);
  });

  it("with no stored copy the page shows Waitron's colours", () => {
    startVenueTheme(document.documentElement, { fetchImpl: never });
    expect(bg()).toBe(WAITRON_LIGHT_BG);
  });

  it("it asks /api/theme once, uncached, and waits for nothing", () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const result = startVenueTheme(document.documentElement, { fetchImpl });
    expect(result).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/theme",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it("uses the global fetch when none is given", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(GREEN))));
    startVenueTheme(document.documentElement);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(bg()).toBe(GREEN_LIGHT_BG));
  });

  it("a newer answer replaces the sheet and the stored copy", async () => {
    storeGreen();
    startVenueTheme(document.documentElement, { fetchImpl: answering(JSON.stringify(LEMON)) });
    await vi.waitFor(() => expect(bg()).toBe(LEMON_LIGHT_BG));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(LEMON);
  });

  it("the same answer writes nothing", async () => {
    storeGreen();
    const json = vi.spyOn(Response.prototype, "json");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    startVenueTheme(document.documentElement, { fetchImpl: answering(JSON.stringify(GREEN)) });
    await settled(json);
    expect(setItem).not.toHaveBeenCalled();
    expect(bg()).toBe(GREEN_LIGHT_BG);
  });

  it("an empty answer empties the sheet and is stored", async () => {
    storeGreen();
    const empty = { hash: "waitron", css: "", logo: null };
    startVenueTheme(document.documentElement, { fetchImpl: answering(JSON.stringify(empty)) });
    await vi.waitFor(() => expect(bg()).toBe(WAITRON_LIGHT_BG));
    expect(JSON.parse(localStorage.getItem(KEY)!).css).toBe("");
  });

  it.each([
    "{broken",
    "null",
    "[]",
    "42",
    '{"hash":1,"css":"","logo":null}',
    '{"hash":"h","css":7,"logo":null}',
    '{"hash":"h","css":""}',
  ])("a malformed stored copy counts as none: %s", async (stored) => {
    localStorage.setItem(KEY, stored);
    const fetchImpl = answering(JSON.stringify(GREEN));
    startVenueTheme(document.documentElement, { fetchImpl });
    expect(bg()).toBe(WAITRON_LIGHT_BG);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(bg()).toBe(GREEN_LIGHT_BG));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(GREEN);
  });

  it.each([
    ["a refusal", () => answering('{"error":{"code":"server.internal"}}', { status: 500 })],
    ["a refusal shaped like an answer", () => answering(JSON.stringify(LEMON), { status: 500 })],
    ["a failed fetch", () => vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))],
    [
      "a body that is not JSON",
      () => answering("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    ],
    ["JSON of the wrong shape", () => answering('{"hash":"h"}')],
  ])("a refused, failed or unreadable answer keeps the stored copy: %s", async (_, make) => {
    const text = storeGreen();
    const fetchImpl = make();
    startVenueTheme(document.documentElement, { fetchImpl });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const result = fetchImpl.mock.results[0]!.value as Promise<Response>;
    await result.catch(() => undefined);
    await macrotask();
    await macrotask();
    expect(bg()).toBe(GREEN_LIGHT_BG);
    expect(localStorage.getItem(KEY)).toBe(text);
  });

  it("a fetch that outlasts the time limit is abandoned", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    storeGreen();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    startVenueTheme(document.documentElement, { fetchImpl });
    const signal = fetchImpl.mock.calls[0]![1]!.signal!;
    vi.advanceTimersByTime(VENUE_THEME_TIME_LIMIT_MS - 1);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect(bg()).toBe(GREEN_LIGHT_BG);
    expect(VENUE_THEME_TIME_LIMIT_MS).toBe(5_000);
  });

  it("an answer arriving after the time limit is dropped", async () => {
    storeGreen();
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response(JSON.stringify(LEMON))), 100);
        }),
    );
    startVenueTheme(document.documentElement, { fetchImpl, timeLimitMs: 50 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bg()).toBe(GREEN_LIGHT_BG);
  });

  it("a fetch dropped by a later start is not applied", async () => {
    let answer!: (response: Response) => void;
    const first = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    startVenueTheme(document.documentElement, { fetchImpl: first });
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const json = vi.spyOn(Response.prototype, "json");
    answer(new Response(JSON.stringify(LEMON)));
    await macrotask();
    await macrotask();
    expect(json).not.toHaveBeenCalled();
    expect(bg()).toBe(WAITRON_LIGHT_BG);
  });

  it("a body still being read when a later start drops the fetch is not applied", async () => {
    let finish!: (value: unknown) => void;
    const json = vi
      .spyOn(Response.prototype, "json")
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    startVenueTheme(document.documentElement, { fetchImpl: answering("{}") });
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    startVenueTheme(document.documentElement, { fetchImpl: never });
    finish(LEMON);
    await macrotask();
    expect(bg()).toBe(WAITRON_LIGHT_BG);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("a root outside any document adopts the sheet onto the page", () => {
    storeGreen();
    document.adoptedStyleSheets = [];
    applyTokens(document.documentElement);
    const afterTokens = document.adoptedStyleSheets.length;
    startVenueTheme(document.createElement("div"), { fetchImpl: never });
    expect(document.adoptedStyleSheets.length).toBe(afterTokens + 1);
    expect(bg()).toBe(GREEN_LIGHT_BG);
  });

  it("storage that throws still lets the answer paint", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() =>
      startVenueTheme(document.documentElement, { fetchImpl: answering(JSON.stringify(GREEN)) }),
    ).not.toThrow();
    await vi.waitFor(() => expect(bg()).toBe(GREEN_LIGHT_BG));
  });

  it("the sheet is adopted once, after the token sheet", () => {
    storeGreen();
    document.adoptedStyleSheets = [];
    applyTokens(document.documentElement);
    const afterTokens = document.adoptedStyleSheets.length;
    startVenueTheme(document.documentElement, { fetchImpl: never });
    startVenueTheme(document.documentElement, { fetchImpl: never });
    expect(document.adoptedStyleSheets.length).toBe(afterTokens + 1);
    const last = document.adoptedStyleSheets.at(-1)!;
    const text = [...last.cssRules].map((rule) => rule.cssText).join("\n");
    expect(text).toContain(GREEN_LIGHT_BG);
  });
});

describe("applyVenueTheme", () => {
  it("takes an answer only when its hash is new", () => {
    startVenueTheme(document.documentElement, { fetchImpl: never });
    applyVenueTheme(GREEN);
    expect(bg()).toBe(GREEN_LIGHT_BG);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(GREEN);
    applyVenueTheme({ hash: GREEN.hash, css: "", logo: null });
    expect(bg()).toBe(GREEN_LIGHT_BG);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(GREEN);
    applyVenueTheme("nonsense");
    expect(bg()).toBe(GREEN_LIGHT_BG);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(GREEN);
  });
});
