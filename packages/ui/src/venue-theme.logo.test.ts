import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { applyTokens } from "@waitron/ui-core/tokens";
import {
  VENUE_THEME_STORAGE_KEY,
  VenueLogoController,
  applyVenueTheme,
  currentVenueLogo,
  followVenueTheme,
  readVenueTheme,
  reportVenueLogoFailure,
  reportVenueLogoLoaded,
  startVenueTheme,
  subscribeVenueLogo,
  type VenueLogoState,
} from "./venue-theme.js";
import { FIXTURE_ANSWER as GREEN } from "../test/venue-theme-fixture.js";

const KEY = VENUE_THEME_STORAGE_KEY;
const LOGO = { light: "/media/a.webp", dark: null };
const OTHER = { light: "/media/b.webp", dark: "/media/c.webp" };
const WAITING: VenueLogoState = { kind: "waiting" };
const NONE: VenueLogoState = { kind: "none" };
const shown = (logo: typeof LOGO | typeof OTHER, failed = false): VenueLogoState => ({
  kind: "logo",
  logo,
  failed,
});

const never = vi.fn(() => new Promise<Response>(() => {}));

function answering(body: string, init?: ResponseInit) {
  return vi.fn(() => Promise.resolve(new Response(body, init)));
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

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function storeWithLogo(): void {
  localStorage.setItem(KEY, JSON.stringify({ ...GREEN, logo: LOGO }));
}

function listen() {
  const listener = vi.fn();
  const unsubscribe = subscribeVenueLogo(listener);
  return { listener, unsubscribe };
}

const subscriptions: (() => void)[] = [];

beforeEach(() => {
  applyTokens(document.documentElement);
  localStorage.removeItem(KEY);
});

afterEach(() => {
  vi.useRealTimers();
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  localStorage.removeItem(KEY);
  vi.restoreAllMocks();
  startVenueTheme(document.documentElement, { fetchImpl: never });
});

function listened() {
  const subscription = listen();
  subscriptions.push(subscription.unsubscribe);
  return subscription.listener;
}

describe("the venue logo state", () => {
  it("a stored copy's logo shows at once", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    expect(currentVenueLogo()).toEqual(shown(LOGO));
  });

  it("a stored copy with no logo shows none at once", () => {
    localStorage.setItem(KEY, JSON.stringify(GREEN));
    startVenueTheme(document.documentElement, { fetchImpl: never });
    expect(currentVenueLogo()).toEqual(NONE);
  });

  it("a stored copy whose logo is malformed is ignored, so the start waits", () => {
    localStorage.setItem(KEY, JSON.stringify({ ...GREEN, logo: "/media/a.webp" }));
    startVenueTheme(document.documentElement, { fetchImpl: never });
    expect(currentVenueLogo()).toEqual(WAITING);
  });

  it("waits with no stored copy, then takes the answer", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    expect(currentVenueLogo()).toEqual(WAITING);
    const listener = listened();
    calls[0]!.answer({ ...GREEN, logo: LOGO });
    await vi.waitFor(() => expect(currentVenueLogo()).toEqual(shown(LOGO)));
    await macrotask();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("waits, then gives up at the time limit", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    startVenueTheme(document.documentElement, { fetchImpl: never, timeLimitMs: 50 });
    vi.advanceTimersByTime(49);
    expect(currentVenueLogo()).toEqual(WAITING);
    vi.advanceTimersByTime(1);
    expect(currentVenueLogo()).toEqual(NONE);
  });

  it("an earlier start's time limit does not end a later start's wait", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    startVenueTheme(document.documentElement, { fetchImpl: never, timeLimitMs: 50 });
    startVenueTheme(document.documentElement, { fetchImpl: never, timeLimitMs: 100 });
    vi.advanceTimersByTime(99);
    expect(currentVenueLogo()).toEqual(WAITING);
    vi.advanceTimersByTime(1);
    expect(currentVenueLogo()).toEqual(NONE);
  });

  it.each([
    ["refused", answering(JSON.stringify(GREEN), { status: 503 })],
    ["failed", vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))],
    ["not JSON", answering("not json")],
    ["not an answer", answering(JSON.stringify({ hash: "h" }))],
  ])("a %s start-up answer ends the wait as none", async (_name, fetchImpl) => {
    startVenueTheme(document.documentElement, { fetchImpl });
    const listener = listened();
    await vi.waitFor(() => expect(currentVenueLogo()).toEqual(NONE));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("a dropped request does not end a later start's wait", async () => {
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    startVenueTheme(document.documentElement, { fetchImpl });
    calls[0]!.refuse();
    await macrotask();
    await macrotask();
    expect(currentVenueLogo()).toEqual(WAITING);
    calls[1]!.answer({ ...GREEN, logo: LOGO });
    await vi.waitFor(() => expect(currentVenueLogo()).toEqual(shown(LOGO)));
  });

  it("an answer equal to the stored copy changes nothing", async () => {
    storeWithLogo();
    const fetchImpl = answering(JSON.stringify({ ...GREEN, logo: LOGO }));
    startVenueTheme(document.documentElement, { fetchImpl });
    const before = currentVenueLogo();
    const listener = listened();
    const json = vi.spyOn(Response.prototype, "json");
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    await macrotask();
    expect(currentVenueLogo()).toBe(before);
    expect(currentVenueLogo()).toEqual(shown(LOGO));
    expect(listener).not.toHaveBeenCalled();
  });

  it("the first answer replaces the stored copy's logo even when its hash is the same", async () => {
    storeWithLogo();
    const fetchImpl = answering(JSON.stringify({ ...GREEN, logo: null }));
    startVenueTheme(document.documentElement, { fetchImpl });
    await vi.waitFor(() => expect(currentVenueLogo()).toEqual(NONE));
  });

  it("a later answer changes the logo; a stale one does not", async () => {
    storeWithLogo();
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    calls[0]!.refuse();
    const stale = await readVenueTheme(() => Promise.resolve({ ...GREEN, logo: null }));
    applyVenueTheme({ ...GREEN, hash: "newer", logo: OTHER });
    expect(currentVenueLogo()).toEqual(shown(OTHER));
    applyVenueTheme(stale.answer, stale.sentAt);
    expect(currentVenueLogo()).toEqual(shown(OTHER));
  });

  it("followVenueTheme brings a new logo", async () => {
    storeWithLogo();
    const { fetchImpl, calls } = byHand();
    startVenueTheme(document.documentElement, { fetchImpl });
    calls[0]!.answer({ ...GREEN, logo: LOGO });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await macrotask();
    await macrotask();
    followVenueTheme("other");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1]!.answer({ ...GREEN, hash: "other", logo: OTHER });
    await vi.waitFor(() => expect(currentVenueLogo()).toEqual(shown(OTHER)));
  });

  it("is failed from a reported failure until the picture loads", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const listener = listened();
    reportVenueLogoFailure(LOGO);
    expect(currentVenueLogo()).toEqual(shown(LOGO, true));
    reportVenueLogoFailure(LOGO);
    expect(listener).toHaveBeenCalledOnce();
    reportVenueLogoLoaded(LOGO);
    expect(currentVenueLogo()).toEqual(shown(LOGO));
    expect(listener).toHaveBeenCalledTimes(2);
    reportVenueLogoLoaded(LOGO);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("a report for addresses not shown changes nothing", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const before = currentVenueLogo();
    const listener = listened();
    reportVenueLogoFailure(OTHER);
    reportVenueLogoFailure({ light: LOGO.light, dark: "/media/c.webp" });
    reportVenueLogoLoaded(OTHER);
    expect(currentVenueLogo()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("a report for the same main picture with another dark one changes nothing", () => {
    localStorage.setItem(KEY, JSON.stringify({ ...GREEN, logo: OTHER }));
    startVenueTheme(document.documentElement, { fetchImpl: never });
    reportVenueLogoFailure({ light: OTHER.light, dark: "/media/d.webp" });
    expect(currentVenueLogo()).toEqual(shown(OTHER));
  });

  it.each([
    ["waiting", null],
    ["none", JSON.stringify(GREEN)],
  ])("a report while %s changes nothing", (_name, stored) => {
    if (stored !== null) localStorage.setItem(KEY, stored);
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const before = currentVenueLogo();
    const listener = listened();
    reportVenueLogoFailure(LOGO);
    reportVenueLogoLoaded(LOGO);
    expect(currentVenueLogo()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("an answer naming other addresses is not failed", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    reportVenueLogoFailure(LOGO);
    applyVenueTheme({ ...GREEN, hash: "other", logo: OTHER });
    expect(currentVenueLogo()).toEqual(shown(OTHER));
  });

  it("an answer naming a failed logo again is still failed", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    reportVenueLogoFailure(LOGO);
    applyVenueTheme({ ...GREEN, hash: "other", logo: OTHER });
    applyVenueTheme({ ...GREEN, hash: "again", logo: { ...LOGO } });
    expect(currentVenueLogo()).toEqual(shown(LOGO, true));
  });

  it("a restart forgets failures", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    reportVenueLogoFailure(LOGO);
    const listener = listened();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    expect(currentVenueLogo()).toEqual(shown(LOGO));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("an unsubscribed listener hears nothing", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const { listener, unsubscribe } = listen();
    unsubscribe();
    reportVenueLogoFailure(LOGO);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("VenueLogoController", () => {
  function host() {
    const controllers: ReactiveController[] = [];
    const fake = {
      addController: vi.fn((controller: ReactiveController) => controllers.push(controller)),
      removeController: vi.fn(),
      requestUpdate: vi.fn(),
      updateComplete: Promise.resolve(true),
    } satisfies ReactiveControllerHost;
    return { fake, controllers };
  }

  it("registers with its host and reads the current state", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const { fake, controllers } = host();
    const controller = new VenueLogoController(fake);
    expect(controllers).toEqual([controller]);
    expect(controller.state).toEqual(shown(LOGO));
  });

  it("updates its host once per change and passes the new state, neither after disconnect", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const { fake } = host();
    const onChange = vi.fn();
    const controller = new VenueLogoController(fake, onChange);
    controller.hostConnected();
    fake.requestUpdate.mockClear();
    reportVenueLogoFailure(LOGO);
    reportVenueLogoFailure(LOGO);
    expect(fake.requestUpdate).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(shown(LOGO, true));
    controller.hostDisconnected();
    reportVenueLogoLoaded(LOGO);
    expect(fake.requestUpdate).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("can be disconnected before it was ever connected", () => {
    const { fake } = host();
    const controller = new VenueLogoController(fake);
    expect(() => controller.hostDisconnected()).not.toThrow();
  });

  it("works with no change callback", () => {
    storeWithLogo();
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const { fake } = host();
    const controller = new VenueLogoController(fake);
    controller.hostConnected();
    fake.requestUpdate.mockClear();
    reportVenueLogoFailure(LOGO);
    expect(fake.requestUpdate).toHaveBeenCalledOnce();
    controller.hostDisconnected();
  });

  it("listens once however often it connects, and redraws its host on each connect", () => {
    const { fake } = host();
    const controller = new VenueLogoController(fake);
    controller.hostConnected();
    controller.hostConnected();
    expect(fake.requestUpdate).toHaveBeenCalledTimes(2);
    fake.requestUpdate.mockClear();
    applyVenueTheme({ ...GREEN, hash: "other", logo: OTHER });
    expect(fake.requestUpdate).toHaveBeenCalledOnce();
    controller.hostDisconnected();
  });
});
