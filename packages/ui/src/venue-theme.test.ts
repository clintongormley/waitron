import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui-core/tokens";
import { WAITRON_CHOICES, themeSheet } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import {
  VENUE_THEME_STORAGE_KEY,
  VENUE_THEME_TIME_LIMIT_MS,
  applyVenueTheme,
  followVenueTheme,
  readVenueTheme,
  startVenueTheme,
} from "./venue-theme.js";
import {
  FIXTURE_ANSWER as GREEN,
  FIXTURE_DARK_BG as GREEN_DARK_BG,
  FIXTURE_LIGHT_BG as GREEN_LIGHT_BG,
  WAITRON_DARK_BG,
  WAITRON_LIGHT_BG,
  bg,
} from "../test/venue-theme-fixture.js";

const KEY = VENUE_THEME_STORAGE_KEY;

const lemonTheme = deriveTheme({ ...WAITRON_CHOICES, brandColor: "#f2d300", background: "tinted" });
const LEMON = {
  hash: "lemon-hash",
  css: themeSheet(lemonTheme),
  logo: { light: "lemon-light", dark: null },
};
const LEMON_LIGHT_BG = lemonTheme.light["--wt-color-bg"]!;

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

/** A fetch whose every call waits until the test answers or refuses it by hand. */
function byHand() {
  const calls: { answer: (body: unknown) => void; refuse: () => void }[] = [];
  const fetchImpl = vi.fn(
    () =>
      new Promise<Response>((resolve, reject) => {
        calls.push({
          answer: (body) => resolve(new Response(JSON.stringify(body))),
          refuse: () => reject(new TypeError("Failed to fetch")),
        });
      }),
  );
  return { fetchImpl, calls };
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

  it("the shared fixture differs from Waitron's own colours in light and dark", () => {
    expect(GREEN_LIGHT_BG).not.toBe(WAITRON_LIGHT_BG);
    expect(GREEN_DARK_BG).not.toBe(WAITRON_DARK_BG);
    expect([GREEN_LIGHT_BG, GREEN_DARK_BG, WAITRON_LIGHT_BG, WAITRON_DARK_BG]).toEqual(
      Array(4).fill(expect.stringMatching(/^#[0-9a-f]{6}$/)),
    );
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
    expect(() => applyVenueTheme({ ...LEMON, hash: "other" })).not.toThrow();
    expect(bg()).toBe(LEMON_LIGHT_BG);
  });

  it("keeps its copy under the key waitron-venue-theme", () => {
    expect(VENUE_THEME_STORAGE_KEY).toBe("waitron-venue-theme");
  });

  it("a root inside a shadow root adopts the sheet onto that shadow root", () => {
    storeGreen();
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("div");
    shadow.append(inner);
    const onPage = document.adoptedStyleSheets.length;
    startVenueTheme(inner, { fetchImpl: never });
    expect(shadow.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets.length).toBe(onPage);
    host.remove();
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

describe("readVenueTheme", () => {
  const refusing = () => vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));

  async function startupSettled(fetchImpl: ReturnType<typeof vi.fn>): Promise<void> {
    await fetchImpl.mock.results[0]!.value.catch(() => undefined);
    await macrotask();
  }

  it("an answer a read hands in is refused once something was applied after the read was sent", async () => {
    const startup = refusing();
    startVenueTheme(document.documentElement, { fetchImpl: startup });
    await startupSettled(startup);
    let reply!: (answer: unknown) => void;
    const pending = readVenueTheme(() => new Promise((resolve) => (reply = resolve)));
    await vi.waitFor(() => expect(reply).toBeDefined());
    applyVenueTheme(LEMON);
    reply(GREEN);
    const reading = await pending;
    applyVenueTheme(reading.answer, reading.sentAt);
    expect(bg()).toBe(LEMON_LIGHT_BG);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(LEMON);
  });

  it("an answer a read hands in applies when nothing was applied after the read was sent", async () => {
    const startup = refusing();
    startVenueTheme(document.documentElement, { fetchImpl: startup });
    await startupSettled(startup);
    applyVenueTheme(LEMON);
    const reading = await readVenueTheme(() => Promise.resolve(GREEN));
    applyVenueTheme(reading.answer, reading.sentAt);
    expect(bg()).toBe(GREEN_LIGHT_BG);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(GREEN);
  });

  it("the first read after a start takes the start-up fetch's answer instead of asking again", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    const read = vi.fn(() => Promise.resolve(LEMON));
    const pending = readVenueTheme(read);
    calls[0]!.answer(GREEN);
    expect((await pending).answer).toEqual(GREEN);
    expect(read).not.toHaveBeenCalled();
    expect(bg()).toBe(GREEN_LIGHT_BG);
    expect((await readVenueTheme(read)).answer).toEqual(LEMON);
    expect(read).toHaveBeenCalledOnce();
  });

  it.each([
    ["failed", (call: { refuse: () => void }) => call.refuse()],
    [
      "answered with the wrong shape",
      (call: { answer: (body: unknown) => void }) => call.answer({ hash: "h" }),
    ],
  ])("a read asks itself when the start-up fetch %s", async (_, end) => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    const read = vi.fn(() => Promise.resolve(LEMON));
    const pending = readVenueTheme(read);
    end(calls[0]!);
    const reading = await pending;
    expect(read).toHaveBeenCalledOnce();
    applyVenueTheme(reading.answer, reading.sentAt);
    expect(bg()).toBe(LEMON_LIGHT_BG);
  });

  it("a read asks itself when the start-up fetch was dropped by a restart", async () => {
    const first = byHand();
    startVenueTheme(document.documentElement, { fetchImpl: first.fetchImpl });
    const read = vi.fn(() => Promise.resolve(LEMON));
    const pending = readVenueTheme(read);
    startVenueTheme(document.documentElement, { fetchImpl: never });
    first.calls[0]!.answer(GREEN);
    expect((await pending).answer).toEqual(LEMON);
    expect(read).toHaveBeenCalledOnce();
  });
});

describe("followVenueTheme", () => {
  it("following the applied hash sends nothing", async () => {
    storeGreen();
    const json = vi.spyOn(Response.prototype, "json");
    const fetchImpl = answering(JSON.stringify(GREEN));
    startVenueTheme(document.documentElement, { fetchImpl });
    await settled(json);
    followVenueTheme(GREEN.hash);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("following a new hash fetches and paints", async () => {
    storeGreen();
    const json = vi.spyOn(Response.prototype, "json");
    const fetchImpl = answering(JSON.stringify(GREEN));
    startVenueTheme(document.documentElement, { fetchImpl });
    await settled(json);
    fetchImpl.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(LEMON))));
    followVenueTheme("other");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "/api/theme",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    await vi.waitFor(() => expect(bg()).toBe(LEMON_LIGHT_BG));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(LEMON);
  });

  it("following while a fetch is out waits for it, then asks once more if still behind", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    followVenueTheme("x");
    followVenueTheme("x");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    calls[0]!.answer(GREEN);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(bg()).toBe(GREEN_LIGHT_BG);
    const json = vi.spyOn(Response.prototype, "json");
    calls[1]!.answer(LEMON);
    await vi.waitFor(() => expect(bg()).toBe(LEMON_LIGHT_BG));
    await settled(json);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a fetch that brings the hash asked for while it was out asks no more", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    followVenueTheme("x");
    followVenueTheme("x");
    const json = vi.spyOn(Response.prototype, "json");
    calls[0]!.answer({ ...GREEN, hash: "x" });
    await settled(json);
    expect(bg()).toBe(GREEN_LIGHT_BG);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("the latest hash asked for while a fetch is out is the one checked", async () => {
    storeGreen();
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    followVenueTheme("x");
    followVenueTheme(GREEN.hash);
    calls[0]!.refuse();
    await fetchImpl.mock.results[0]!.value.catch(() => undefined);
    await macrotask();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a follow-up that fails asks no more until the next call", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    followVenueTheme("x");
    followVenueTheme("x");
    calls[0]!.refuse();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    calls[1]!.refuse();
    await macrotask();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    followVenueTheme("x");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("an older fetch never undoes a newer answer", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    applyVenueTheme(LEMON);
    const json = vi.spyOn(Response.prototype, "json");
    calls[0]!.answer(GREEN);
    await settled(json);
    expect(bg()).toBe(LEMON_LIGHT_BG);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(LEMON);
  });

  it("an older fetch's answer paints when nothing was applied after it was sent", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    calls[0]!.answer(GREEN);
    await vi.waitFor(() => expect(bg()).toBe(GREEN_LIGHT_BG));
  });

  it("a live update while the start-up fetch is out keeps the newer theme", async () => {
    storeGreen();
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    followVenueTheme(LEMON.hash);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    applyVenueTheme(LEMON);
    const json = vi.spyOn(Response.prototype, "json");
    calls[0]!.answer(GREEN);
    await settled(json);
    expect(bg()).toBe(LEMON_LIGHT_BG);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(LEMON);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("an answer that repeats the applied hash still counts as applied", async () => {
    storeGreen();
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    applyVenueTheme(GREEN);
    const json = vi.spyOn(Response.prototype, "json");
    calls[0]!.answer(LEMON);
    await settled(json);
    expect(bg()).toBe(GREEN_LIGHT_BG);
  });

  it("a fetch dropped by a restart does not end the restart's own fetch", async () => {
    const first = byHand();
    startVenueTheme(document.documentElement, { fetchImpl: first.fetchImpl });
    const second = byHand();
    startVenueTheme(document.documentElement, { fetchImpl: second.fetchImpl });
    first.calls[0]!.refuse();
    await first.fetchImpl.mock.results[0]!.value.catch(() => undefined);
    await macrotask();
    followVenueTheme("x");
    expect(second.fetchImpl).toHaveBeenCalledTimes(1);
    second.calls[0]!.answer(GREEN);
    await vi.waitFor(() => expect(second.fetchImpl).toHaveBeenCalledTimes(2));
  });

  it("an answer from before a restart applies nothing", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    startVenueTheme(document.documentElement, { fetchImpl: never });
    calls[0]!.answer(GREEN);
    await macrotask();
    await macrotask();
    expect(bg()).toBe(WAITRON_LIGHT_BG);
  });

  it("a restart forgets a hash asked for before it", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    followVenueTheme("x");
    const second = byHand();
    startVenueTheme(document.documentElement, { fetchImpl: second.fetchImpl });
    const json = vi.spyOn(Response.prototype, "json");
    second.calls[0]!.answer(GREEN);
    await settled(json);
    calls[0]!.answer(LEMON);
    await macrotask();
    await macrotask();
    expect(second.fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bg()).toBe(GREEN_LIGHT_BG);
  });
});
