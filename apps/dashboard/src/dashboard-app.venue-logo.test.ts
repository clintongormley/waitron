import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  applyTokens,
  chooseTheme,
  currentVenueLogo,
  startThemeChoice,
  startVenueTheme,
  THEME_STORAGE_KEY,
  VENUE_THEME_STORAGE_KEY,
  reportVenueLogoFailure,
  type WtVenueLogo,
} from "@waitron/ui";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import type { DashboardApi } from "./api/client.js";
import { setLocale } from "./i18n/t.js";
import { nextLogoLoad, png, stubShellApi as stubApi } from "./testing/venue-logo-fixture.js";

const LIGHT = png(120, 40);
const DARK = png(90, 30);
const withLogo = (light: string, dark: string | null = null, hash = "logo-hash") => ({
  ...FIXTURE_ANSWER,
  hash,
  logo: { light, dark },
});

const rejecting = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch")));
const never = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));

/** A fetch whose every call waits until the test answers it by hand. */
function byHand() {
  const calls: ((body: unknown) => void)[] = [];
  const fetchImpl = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        calls.push((body) => resolve(new Response(JSON.stringify(body))));
      }),
  );
  return { fetchImpl, calls };
}

function answering(body: unknown) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body))));
}

function store(answer: unknown): void {
  localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
}

async function mount(api: DashboardApi): Promise<{ el: DashboardApp; host: HTMLElement }> {
  const mounted = await mountWidget<DashboardApp>("dashboard-app", { api });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await mounted.el.updateComplete;
  return mounted;
}

const banner = (el: DashboardApp) => el.shadowRoot!.querySelector("[data-test=brand-banner]")!;
const venueLogo = (el: DashboardApp) => banner(el).querySelector<WtVenueLogo>("wt-venue-logo");
const lockup = (el: DashboardApp) => banner(el).querySelector<HTMLImageElement>(".brand-logo");
const lockupShown = (el: DashboardApp) => lockup(el)?.checkVisibility() ?? false;

beforeEach(() => {
  applyTokens(document.documentElement);
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
});

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, { fetchImpl: rejecting });
  chooseTheme("device");
  localStorage.removeItem(THEME_STORAGE_KEY);
  startThemeChoice(document.documentElement);
  sessionStorage.clear();
  setLocale("es-ES");
});

it("with no venue logo, Waitron's lockup as today", async () => {
  store(FIXTURE_ANSWER);
  startVenueTheme(document.documentElement, { fetchImpl: never });
  const { el } = await mount(stubApi(true));
  expect(lockup(el)).not.toBeNull();
  expect(lockupShown(el)).toBe(true);
  expect(venueLogo(el)).toBeNull();
});

it.each([
  ["signed in", true],
  ["on the sign-in page", false],
] as const)(
  "the venue's logo takes the lockup's place, before the legal name, with empty alt (%s)",
  async (_where, signedIn) => {
    store(withLogo(LIGHT, DARK));
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const loads = nextLogoLoad();
    const { el } = await mount(stubApi(signedIn));
    if (!signedIn) {
      await expect
        .poll(() => el.shadowRoot!.querySelector("dashboard-login-screen"))
        .not.toBeNull();
    }
    const logo = venueLogo(el)!;
    expect(logo).not.toBeNull();
    expect(logo.getAttribute("size")).toBe("banner");
    expect(logo.getAttribute("light")).toBe(LIGHT);
    expect(logo.getAttribute("dark")).toBe(DARK);
    expect(logo.getAttribute("alt")).toBe("");
    expect((await loads).logo).toBe(logo);
    expect(lockupShown(el)).toBe(false);
    const name = banner(el).querySelector("[data-test=venue-name]")!;
    expect(logo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // At a narrow width the name takes the banner's second row.
    const box = logo.getBoundingClientRect();
    const at = name.getBoundingClientRect();
    expect(at.left >= box.right || at.top >= box.bottom).toBe(true);
  },
);

it("an empty place until the answer, never Waitron's first", async () => {
  const first = byHand();
  startVenueTheme(document.documentElement, { fetchImpl: first.fetchImpl });
  // Watched from before the first render, so every node the shell adds before the answer is seen.
  const { host } = await mountWidget<HTMLDivElement>("div", {});
  const el = document.createElement("dashboard-app");
  el.api = stubApi(false);
  const added: Node[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) added.push(...record.addedNodes);
  });
  host.append(el);
  observer.observe(el.shadowRoot!, { subtree: true, childList: true });
  const lockupAdded = () => {
    for (const record of observer.takeRecords()) added.push(...record.addedNodes);
    return added.some(
      (node) =>
        node instanceof Element &&
        (node.matches(".brand-logo") || node.querySelector(".brand-logo") !== null),
    );
  };
  await el.updateComplete;
  await expect.poll(() => el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  const logo = venueLogo(el)!;
  expect(logo).not.toBeNull();
  expect(logo.hasAttribute("light")).toBe(false);
  expect(logo.getBoundingClientRect().height).toBe(40);
  expect(lockup(el)).toBeNull();

  expect(added.length).toBeGreaterThan(0);
  expect(lockupAdded()).toBe(false);
  observer.disconnect();

  first.calls[0]!(withLogo(LIGHT));
  await vi.waitFor(() => expect(venueLogo(el)?.getAttribute("light")).toBe(LIGHT));

  cleanupWidgets();
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  const second = byHand();
  startVenueTheme(document.documentElement, { fetchImpl: second.fetchImpl });
  const again = await mount(stubApi(false));
  expect(venueLogo(again.el)).not.toBeNull();
  expect(lockup(again.el)).toBeNull();
  second.calls[0]!({ ...FIXTURE_ANSWER, logo: null });
  await vi.waitFor(() => expect(lockupShown(again.el)).toBe(true));
  expect(venueLogo(again.el)).toBeNull();
});

it("after the time limit with no answer, Waitron's lockup", async () => {
  startVenueTheme(document.documentElement, { fetchImpl: never, timeLimitMs: 50 });
  const { el } = await mount(stubApi(false));
  expect(venueLogo(el)).not.toBeNull();
  await vi.waitFor(() => expect(lockupShown(el)).toBe(true));
  expect(venueLogo(el)).toBeNull();
});

it("a logo that fails to load shows the lockup through the fallback slot, and marks it failed", async () => {
  store(withLogo("/no-such.png"));
  startVenueTheme(document.documentElement, { fetchImpl: never });
  const { el } = await mount(stubApi(false));
  await vi.waitFor(() => expect(venueLogo(el)?.hasAttribute("failed")).toBe(true));
  const picture = venueLogo(el)!.querySelector(":scope > picture")!;
  expect(picture.getAttribute("slot")).toBe("fallback");
  await vi.waitFor(() => expect(lockupShown(el)).toBe(true));
  const state = currentVenueLogo();
  expect(state.kind === "logo" && state.failed).toBe(true);
});

it("follows a live answer without a reload", async () => {
  startVenueTheme(document.documentElement, { fetchImpl: rejecting });
  const api = stubApi(true);
  const { el } = await mount(api);
  await vi.waitFor(() => expect(lockupShown(el)).toBe(true));
  api.getVenueTheme.mockResolvedValue(withLogo(LIGHT, null, "live-logo-hash"));
  const loads = nextLogoLoad();
  api.liveData.invalidate([{ type: "custom_themes" }]);
  await vi.waitFor(() => expect(venueLogo(el)?.getAttribute("light")).toBe(LIGHT));
  await loads;
  expect(lockupShown(el)).toBe(false);
});

it("switches with the Theme setting, asking nothing", async () => {
  store(withLogo(LIGHT));
  const fetchImpl = answering(withLogo(LIGHT));
  startVenueTheme(document.documentElement, { fetchImpl });
  const loads = nextLogoLoad();
  const { host } = await mount(stubApi(false));
  startThemeChoice(host);
  const { logo } = await loads;
  const plate = () => logo.shadowRoot!.querySelector(".box")!.hasAttribute("data-plate");
  chooseTheme("dark");
  await vi.waitFor(() => expect(plate()).toBe(true));
  chooseTheme("light");
  await vi.waitFor(() => expect(plate()).toBe(false));
  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(fetchImpl.mock.calls[0]![0]).toBe("/api/theme");
});

it("a logo reported failed is cleared once the banner loads it", async () => {
  const logo = { light: LIGHT, dark: null };
  store(withLogo(LIGHT));
  startVenueTheme(document.documentElement, { fetchImpl: never });
  reportVenueLogoFailure(logo);
  expect(currentVenueLogo()).toEqual({ kind: "logo", logo, failed: true });
  const loads = nextLogoLoad();
  await mount(stubApi(false));
  await loads;
  await vi.waitFor(() => expect(currentVenueLogo()).toEqual({ kind: "logo", logo, failed: false }));
});
