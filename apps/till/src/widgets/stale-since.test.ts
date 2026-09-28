import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillStaleSince } from "./stale-since.js";

// Captured before any test fakes timers, so `flush` still yields a real macrotask under fake ones.
const realSetTimeout = globalThis.setTimeout;

async function flush(el: TillStaleSince): Promise<void> {
  await new Promise((resolve) => realSetTimeout(resolve, 0));
  await el.updateComplete;
}

async function pass(el: TillStaleSince, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await flush(el);
}

const text = (el: TillStaleSince) => el.textContent!.trim();

describe("till-stale-since", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 7, 17, 10, 19, 50));
    setLocale("en-GB");
  });
  afterEach(() => {
    cleanupWidgets();
    vi.useRealTimers();
    setLocale("en-GB");
  });

  it("registers as a custom element", () => {
    expect(customElements.get("till-stale-since")).toBe(TillStaleSince);
  });

  it("changes the count exactly at each minute after `since`", async () => {
    const { el } = await mountWidget<TillStaleSince>("till-stale-since", { since: new Date() });
    expect(text(el)).toBe("No updates since 10:19, less than a minute ago");
    await pass(el, 59_999);
    expect(text(el)).toBe("No updates since 10:19, less than a minute ago");
    await pass(el, 1);
    expect(text(el)).toBe("No updates since 10:19, 1 minute ago");
    await pass(el, 59_999);
    expect(text(el)).toBe("No updates since 10:19, 1 minute ago");
    await pass(el, 1);
    expect(text(el)).toBe("No updates since 10:19, 2 minutes ago");
  });

  it("reads a long outage in minutes", async () => {
    const since = new Date(2026, 7, 17, 7, 4, 0);
    const { el } = await mountWidget<TillStaleSince>("till-stale-since", { since });
    expect(text(el)).toBe("No updates since 07:04, 195 minutes ago");
  });

  it("a `since` ahead of the clock reads less than a minute, until a minute after it", async () => {
    const { el } = await mountWidget<TillStaleSince>("till-stale-since", {
      since: new Date(2026, 7, 17, 10, 20, 0),
    });
    expect(text(el)).toBe("No updates since 10:20, less than a minute ago");
    await pass(el, 69_999);
    expect(text(el)).toBe("No updates since 10:20, less than a minute ago");
    await pass(el, 1);
    expect(text(el)).toBe("No updates since 10:20, 1 minute ago");
  });

  it("a new `since` restarts the count and leaves one timer", async () => {
    const { el } = await mountWidget<TillStaleSince>("till-stale-since", { since: new Date() });
    await pass(el, 90_000);
    expect(text(el)).toBe("No updates since 10:19, 1 minute ago");
    el.since = new Date();
    await flush(el);
    expect(text(el)).toBe("No updates since 10:21, less than a minute ago");
    expect(vi.getTimerCount()).toBe(1);
    await pass(el, 60_000);
    expect(text(el)).toBe("No updates since 10:21, 1 minute ago");
  });

  it("stops its timer when removed, and brings the count up to date when put back", async () => {
    const { el, host } = await mountWidget<TillStaleSince>("till-stale-since", {
      since: new Date(),
    });
    expect(vi.getTimerCount()).toBe(1);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(180_000);
    host.appendChild(el);
    await flush(el);
    expect(text(el)).toBe("No updates since 10:19, 3 minutes ago");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a minute redraw still pending when it is removed starts no timer", async () => {
    const { el } = await mountWidget<TillStaleSince>("till-stale-since", { since: new Date() });
    vi.advanceTimersByTime(60_000);
    el.remove();
    await flush(el);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a new `since` while removed starts no timer", async () => {
    const { el } = await mountWidget<TillStaleSince>("till-stale-since", { since: new Date() });
    el.remove();
    el.since = new Date();
    await flush(el);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("speaks Spanish under the Spanish locale", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<TillStaleSince>("till-stale-since", { since: new Date() });
    expect(text(el)).toBe("Sin actualizaciones desde las 10:19, hace menos de un minuto");
    await pass(el, 60_000);
    expect(text(el)).toBe("Sin actualizaciones desde las 10:19, hace 1 minuto");
    await pass(el, 60_000);
    expect(text(el)).toBe("Sin actualizaciones desde las 10:19, hace 2 minutos");
  });
});
