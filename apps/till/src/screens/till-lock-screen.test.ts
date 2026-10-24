import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  chooseTheme,
  currentVenueLogo,
  startVenueTheme,
  THEME_STORAGE_KEY,
  VENUE_THEME_STORAGE_KEY,
  type WtPoweredBy,
  type WtThemeChooser,
  type WtVenueLogo,
} from "@waitron/ui";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { nextLogoLoad, png } from "@waitron/ui/test/venue-logo-fixture.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { expectChooserFaces, cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillLockScreen } from "./till-lock-screen.js";
import type { StaffMember, TillApi } from "../api/client.js";
import type { ServerStatus } from "../api/server-router.js";

const ana: StaffMember = { personId: "p1", displayName: "Ana" };
const ben: StaffMember = { personId: "p2", displayName: "Ben" };

function stubApi(
  overrides: Partial<Record<"listStaff" | "login" | "getLocales", unknown>> = {},
): TillApi {
  return {
    listStaff: vi.fn().mockResolvedValue([ana, ben]),
    login: vi.fn().mockResolvedValue({ personId: "p1", permissions: [], locale: null }),
    // The language chooser rendered in the roster view fetches this only when the operator opens it.
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
    }),
    ...overrides,
  } as unknown as TillApi;
}

/** A `setTimeout(0)` macrotask drains the microtask queue (promise resolution + Lit's batched update)
 * first. */
async function flush(el: TillLockScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function flushFake(el: TillLockScreen): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await el.updateComplete;
}

async function press(el: TillLockScreen, key: string): Promise<void> {
  const pad = el.shadowRoot!.querySelector("till-numeric-pad")!;
  await (pad as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!.click();
  await el.updateComplete;
}

async function type(el: TillLockScreen, keys: string): Promise<void> {
  for (const key of keys) await press(el, key);
}

const query = (el: TillLockScreen, selector: string) => el.shadowRoot!.querySelector(selector);
const click = (el: TillLockScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();

afterEach(() => {
  cleanupWidgets();
  // The remembered-operator key is real localStorage; wipe it so one test's write never preselects in
  // the next.
  try {
    localStorage.clear();
  } catch {
    // A storage-less environment (private window) — nothing to clear.
  }
});

describe("till-lock-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-lock-screen")).toBe(TillLockScreen);
  });

  it("shows a loading state while the roster is in flight", async () => {
    // A listStaff that never resolves keeps the screen in its initial loading render.
    const api = stubApi({ listStaff: vi.fn(() => new Promise<StaffMember[]>(() => {})) });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    expect(el.shadowRoot!.textContent).toContain(t("login.loading"));
  });

  it("marks the loading line as a status while the roster is in flight", async () => {
    const api = stubApi({ listStaff: vi.fn(() => new Promise<StaffMember[]>(() => {})) });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    const status = el.shadowRoot!.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe(t("login.loading"));
  });

  it("renders each staff member from listStaff() as a wt-button under the pick heading", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("login.pick_operator"));
    const buttons = el.shadowRoot!.querySelectorAll("wt-button.operator-button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.textContent).toContain("Ana");
    expect(buttons[1]!.textContent).toContain("Ben");
  });

  it("shows the device name as the heading when one is supplied", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      deviceName: "Counter 1",
      deviceId: "dev1",
    });
    await flush(el);
    expect(query(el, ".heading")!.textContent).toContain("Counter 1");
  });

  it("shows an empty-roster message when listStaff() returns no one", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("login.no_staff"));
    expect(el.shadowRoot!.querySelectorAll("wt-button.operator-button")).toHaveLength(0);
  });

  it("shows a load-failed message when listStaff() rejects", async () => {
    const api = stubApi({ listStaff: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("login.load_failed"));
    expect(el.shadowRoot!.textContent).not.toContain("server.internal");
  });

  it("reveals the PIN pad for the tapped person, showing their name", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    expect(query(el, ".operator")!.textContent).toContain("Ana");
    expect(query(el, "till-numeric-pad")).not.toBeNull();
  });

  it("preselects the remembered operator and shows the pad immediately on connect", async () => {
    localStorage.setItem("waitron.lastOperator.dev1", "p2");
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      deviceId: "dev1",
    });
    await flush(el);
    expect(query(el, "till-numeric-pad")).not.toBeNull();
    expect(query(el, ".operator")!.textContent).toContain("Ben");
  });

  it("ignores a remembered operator no longer on the roster", async () => {
    // A person since removed from the roster must NOT preselect.
    localStorage.setItem("waitron.lastOperator.dev1", "gone");
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      deviceId: "dev1",
    });
    await flush(el);
    expect(query(el, "till-numeric-pad")).toBeNull();
    expect(el.shadowRoot!.querySelectorAll("wt-button.operator-button")).toHaveLength(2);
  });

  it("ignores the remembered operator when the localStorage read throws (private window)", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    try {
      const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
        api: stubApi(),
        deviceId: "dev1",
      });
      await flush(el);
      expect(query(el, "till-numeric-pad")).toBeNull();
      expect(el.shadowRoot!.querySelectorAll("wt-button.operator-button")).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("still logs in when remembering the operator throws (private window)", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    try {
      const login = vi.fn().mockResolvedValue({ personId: "p1", permissions: [], locale: null });
      const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
        api: stubApi({ login }),
        deviceId: "dev1",
      });
      await flush(el);
      const loggedIn = vi.fn();
      el.addEventListener("logged-in", () => loggedIn());
      click(el, 'wt-button.operator-button[data-person="p1"]');
      await el.updateComplete;
      await type(el, "1234");
      click(el, ".submit");
      await flush(el);
      expect(loggedIn).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it("defaults the throttle back-off to 1s when the error carries no retryAfterSeconds", async () => {
    // A malformed/absent `retryAfterSeconds` still greys the pad — a 1s floor rather than an instant or
    // NaN countdown. (Real timers: the initial render is asserted before any tick; cleanup clears it.)
    const login = vi.fn().mockRejectedValue({ code: "pin.throttled" });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi({ login }),
    });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "1234");
    click(el, ".submit");
    await flush(el);
    expect(query(el, ".pad-wrap[inert]")).not.toBeNull();
    expect(query(el, ".throttle")!.textContent).toContain(t("login.throttled").replace("{n}", "1"));
  });

  it("clears selection and PIN when the Cancel control is used", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "12");
    expect(query(el, ".cancel")!.textContent).toContain(t("action.cancel"));
    click(el, ".cancel");
    await el.updateComplete;
    expect(query(el, "till-numeric-pad")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("login.pick_operator"));
    expect(el.shadowRoot!.querySelectorAll("wt-button.operator-button")).toHaveLength(2);
  });

  it("keeps Log in disabled until a digit is entered", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    expect(query(el, ".submit")!.hasAttribute("disabled")).toBe(true);
    await type(el, "1");
    expect(query(el, ".submit")!.hasAttribute("disabled")).toBe(false);
  });

  it("logs in with (personId, pin) and emits logged-in with the confirmed personId, name + permissions", async () => {
    const login = vi.fn().mockResolvedValue({ personId: "p1", permissions: ["venue.configure"] });
    const api = stubApi({ login });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    const spy = vi.fn();
    el.addEventListener("logged-in", (e) => spy((e as CustomEvent).detail));
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "1234");
    click(el, ".submit");
    await flush(el);
    expect(login).toHaveBeenCalledWith("p1", "1234");
    expect(spy).toHaveBeenCalledWith({
      personId: "p1",
      displayName: "Ana",
      permissions: ["venue.configure"],
    });
  });

  it("remembers the operator on this device after a successful login", async () => {
    const login = vi.fn().mockResolvedValue({ personId: "p1", permissions: [], locale: null });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi({ login }),
      deviceId: "dev1",
    });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "1234");
    click(el, ".submit");
    await flush(el);
    expect(localStorage.getItem("waitron.lastOperator.dev1")).toBe("p1");
  });

  it("threads the login response's per-user locale into the logged-in detail", async () => {
    const login = vi.fn().mockResolvedValue({ personId: "p1", permissions: [], locale: "en-GB" });
    const api = stubApi({ login });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    const spy = vi.fn();
    el.addEventListener("logged-in", (e) => spy((e as CustomEvent).detail));
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "1234");
    click(el, ".submit");
    await flush(el);
    expect(spy).toHaveBeenCalledWith({
      personId: "p1",
      displayName: "Ana",
      permissions: [],
      locale: "en-GB",
    });
  });

  it("renders the language chooser in the roster view", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-language-chooser")).not.toBeNull();
  });

  it("puts the language chooser at the top right, after the theme chooser, above the sign-in content", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    const own = chooser.getBoundingClientRect();
    const screen = el.getBoundingClientRect();
    const content = el.shadowRoot!.querySelector(".screen")!.getBoundingClientRect();
    expect(own.bottom).toBeLessThanOrEqual(content.top);
    expect(own.top - screen.top).toBeLessThanOrEqual(32);
    expect(screen.right - own.right).toBeLessThanOrEqual(32);
    expect(own.left).toBeGreaterThan(screen.left + screen.width / 2);
  });

  it("shows the theme chooser just before the language chooser, at the top right", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    const theme = el.shadowRoot!.querySelector<HTMLElement>("[data-test=theme-chooser]")!;
    const language = el.shadowRoot!.querySelector("wt-language-chooser")!;
    const corner = el.shadowRoot!.querySelector(".language-corner")!;
    expect(theme.parentElement).toBe(corner);
    expect(theme.nextElementSibling).toBe(language);
    expect(
      Math.abs(corner.getBoundingClientRect().right - language.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(1);
    expect(theme.getBoundingClientRect().right).toBeLessThanOrEqual(
      language.getBoundingClientRect().left,
    );
    const space1 = parseFloat(getComputedStyle(corner).getPropertyValue("--wt-space-1"));
    expect(space1).toBe(4);
    const own = theme.getBoundingClientRect();
    const next = language.getBoundingClientRect();
    expect(Math.abs(next.left - own.right - space1)).toBeLessThanOrEqual(1);
    expect(Math.abs(own.top + own.height / 2 - (next.top + next.height / 2))).toBeLessThanOrEqual(
      1,
    );
  });

  it("labels the theme chooser in Spanish", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
      await flush(el);
      const chooser = el.shadowRoot!.querySelector<
        HTMLElement & { updateComplete: Promise<unknown> }
      >("[data-test=theme-chooser]")!;
      await chooser.updateComplete;
      const trigger = chooser.shadowRoot!.querySelector<HTMLElement>("[data-test=theme-trigger]")!;
      await expect
        .element(page.elementLocator(trigger.shadowRoot!.querySelector("button")!))
        .toHaveAccessibleName("Tema: Según el dispositivo");
    } finally {
      setLocale(before);
    }
  });

  it("redraws its theme chooser when the theme choice changes", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    try {
      chooseTheme("dark");
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<WtThemeChooser>("[data-test=theme-chooser]")!.active,
      ).toBe("dark");
    } finally {
      chooseTheme("device");
      localStorage.removeItem(THEME_STORAGE_KEY);
    }
  });

  it("shows the language's full name at 1280 wide and its short code at 390, always named in full", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    await expectChooserFaces(el.shadowRoot!.querySelector("wt-language-chooser")!, {
      wide: { shown: ["Español"], name: "Español" },
      phone: { shown: ["ES"], name: "ES Español" },
    });
  });

  it("keeps server status below the sign-in content, with the language chooser above both", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      serverStatuses: [
        { url: "https://box.deli.test", label: "box.deli.test", state: "unreachable", term: null },
      ],
    });
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    const status = el.shadowRoot!.querySelector("[data-server-status]")!;
    const content = el.shadowRoot!.querySelector(".screen")!;
    expect(chooser.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      content.getBoundingClientRect().top,
    );
    expect(status.previousElementSibling).toBe(content);
  });

  it("updates its chooser when the till locale changes while sign-in stays open", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
      setLocale("en-GB");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("wt-language-chooser")!.getAttribute("active")).toBe(
        "en-GB",
      );
    } finally {
      setLocale("es-ES");
    }
  });

  it("lets the chooser's wt-locale-selected bubble out composed (it does NOT handle it itself)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    const spy = vi.fn();
    el.addEventListener("wt-locale-selected", (e) => spy((e as CustomEvent).detail));
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    chooser.dispatchEvent(
      new CustomEvent("wt-locale-selected", {
        detail: { code: "en-GB" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(spy).toHaveBeenCalledWith({ code: "en-GB" });
  });

  it("feeds its language chooser from the venue's locale list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
    await vi.waitFor(() => {
      const menu = chooser.shadowRoot!.querySelector('[role="menu"]');
      expect(menu?.textContent).toContain("English");
    });
    expect(api.getLocales).toHaveBeenCalledTimes(1);
  });

  it("offers no Switch device control outside dev mode", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-switch-device]")).toBeNull();
  });

  it("in dev mode, Switch device emits a composed, bubbling switch-device event", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      devMode: true,
    });
    await flush(el);
    const button = el.shadowRoot!.querySelector<HTMLElement>("[data-switch-device]")!;
    expect(button.textContent).toContain(t("device.switch"));
    let captured: CustomEvent | undefined;
    el.addEventListener("switch-device", (event) => (captured = event as CustomEvent));
    button.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.detail).toBeNull();
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("keeps the language chooser available in PIN mode", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-language-chooser")).not.toBeNull();
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-language-chooser")).not.toBeNull();
  });

  it("round-trips a leading-zero PIN (e.g. the default 0000) to login unmangled", async () => {
    // The pad's decimal mode would collapse 0,0,0,0 to "0" and lock those staff out.
    const login = vi.fn().mockResolvedValue({ personId: "p1" });
    const api = stubApi({ login });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "0000");
    click(el, ".submit");
    await flush(el);
    expect(login).toHaveBeenCalledWith("p1", "0000");
  });

  it("shows the localised pin.invalid error and clears the PIN, without logging in", async () => {
    const login = vi.fn().mockRejectedValue({ code: "pin.invalid" });
    const api = stubApi({ login });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    const spy = vi.fn();
    el.addEventListener("logged-in", () => spy());
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "9999");
    click(el, ".submit");
    await flush(el);
    expect(query(el, ".error")!.textContent).toContain(t("pin.invalid"));
    expect(query(el, ".submit")!.hasAttribute("disabled")).toBe(true); // PIN cleared → empty again
    expect(spy).not.toHaveBeenCalled();
    expect(query(el, "till-numeric-pad")).not.toBeNull(); // still on the PIN screen to retry
  });

  it("greys the pad and counts a pin.throttled back-off down, re-enabling entry at zero", async () => {
    vi.useFakeTimers();
    try {
      const login = vi.fn().mockRejectedValue({ code: "pin.throttled", retryAfterSeconds: 3 });
      const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
        api: stubApi({ login }),
      });
      await flushFake(el);
      click(el, 'wt-button.operator-button[data-person="p1"]');
      await el.updateComplete;
      await type(el, "1234");
      click(el, ".submit");
      await flushFake(el);
      // Throttled: pad greyed (inert), submit disabled, countdown at the full window.
      expect(query(el, ".pad-wrap[inert]")).not.toBeNull();
      expect(query(el, ".submit")!.hasAttribute("disabled")).toBe(true);
      expect(query(el, ".throttle")!.textContent).toContain(
        t("login.throttled").replace("{n}", "3"),
      );
      // One second on: the countdown ticks.
      await vi.advanceTimersByTimeAsync(1000);
      await el.updateComplete;
      expect(query(el, ".throttle")!.textContent).toContain(
        t("login.throttled").replace("{n}", "2"),
      );
      // The remaining two seconds elapse → entry is live again (pad no longer inert, PIN still typed so
      // submit re-enables) and the notice is gone.
      await vi.advanceTimersByTimeAsync(2000);
      await el.updateComplete;
      expect(query(el, ".pad-wrap[inert]")).toBeNull();
      expect(query(el, ".throttle")).toBeNull();
      expect(query(el, ".submit")!.hasAttribute("disabled")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing about a suspended account, only the generic message", async () => {
    const login = vi.fn().mockRejectedValue({ code: "person.suspended" });
    const api = stubApi({ login });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "1234");
    click(el, ".submit");
    await flush(el);
    expect(query(el, ".error")!.textContent!.trim()).toBe(t("login.error"));
  });

  it("never leaks the raw code for an unrecognised login error", async () => {
    const login = vi.fn().mockRejectedValue({ code: "person.not_found" });
    const api = stubApi({ login });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "1234");
    click(el, ".submit");
    await flush(el);
    expect(query(el, ".error")!.textContent).toContain(t("login.error"));
    expect(el.shadowRoot!.textContent).not.toContain("person.not_found");
  });

  it("falls back to the generic message when the rejection carries no code", async () => {
    const login = vi.fn().mockRejectedValue({}); // a rejection with no `code` field at all
    const api = stubApi({ login });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "1234");
    click(el, ".submit");
    await flush(el);
    expect(query(el, ".error")!.textContent).toContain(t("login.error"));
  });

  it("does not call login when Log in is force-clicked with an empty PIN", async () => {
    const login = vi.fn().mockResolvedValue({ personId: "p1" });
    const api = stubApi({ login });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    click(el, ".submit"); // disabled visually; host.click() bypasses that, the guard must not call
    await flush(el);
    expect(login).not.toHaveBeenCalled();
  });

  it("does not emit logged-in if the screen disconnects mid-login", async () => {
    let resolveLogin!: (value: { personId: string }) => void;
    const login = vi.fn(() => new Promise<{ personId: string }>((r) => (resolveLogin = r)));
    const api = stubApi({ login });
    const { el, host } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    const spy = vi.fn();
    el.addEventListener("logged-in", () => spy());
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "1234");
    click(el, ".submit"); // login now pending
    host.remove(); // torn down before it resolves
    resolveLogin({ personId: "p1" });
    await flush(el);
    expect(spy).not.toHaveBeenCalled();
  });

  it("no longer renders the device set-up affordances (the front door moved to boot)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(query(el, "[data-setup-device]")).toBeNull();
    expect(query(el, "[data-setup-handheld]")).toBeNull();
    expect(query(el, "[data-setup-till]")).toBeNull();
    expect(query(el, ".device-setup")).toBeNull();
  });

  it("renders one row per server with its state, and a check-again button", async () => {
    const statuses: ServerStatus[] = [
      { url: "https://box.deli.test", label: "box.deli.test", state: "unreachable", term: null },
      { url: "https://cloud.deli.test", label: "cloud.deli.test", state: "standby", term: 2 },
    ];
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      serverStatuses: statuses,
      serverWaiting: true,
    });
    await flush(el);
    const line = el.shadowRoot!.querySelector("[data-server-status]")!.textContent!;
    expect(line).toContain("box.deli.test");
    expect(line).toContain(t("server.unreachable"));
    expect(line).toContain("cloud.deli.test");
    expect(line).toContain(t("server.standby"));
    expect(line).toContain(t("server.waiting_promotion"));
    const again = vi.fn();
    el.addEventListener("check-again", again);
    (el.shadowRoot!.querySelector("[data-check-again]") as HTMLElement).click();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("marks the CURRENT server with On: <label> when it is primary; others stay label: state", async () => {
    const statuses: ServerStatus[] = [
      { url: "https://box.deli.test", label: "box.deli.test", state: "primary", term: 2 },
      { url: "https://cloud.deli.test", label: "cloud.deli.test", state: "standby", term: 1 },
    ];
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      serverStatuses: statuses,
      serverCurrent: "https://box.deli.test",
      serverWaiting: false,
    });
    await flush(el);
    const line = el.shadowRoot!.querySelector("[data-server-status]")!.textContent!;
    expect(line).toContain(`${t("server.on")} box.deli.test`); // "On: box.deli.test"
    expect(line).not.toContain(`box.deli.test: ${t("server.primary")}`); // NOT the plain state row
    expect(line).toContain(`cloud.deli.test: ${t("server.standby")}`); // the other server unmarked
  });

  it("renders nothing when no servers are known (the default — a till with no router)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      serverStatuses: [],
      serverWaiting: false,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-server-status]")).toBeNull();
  });

  it("renders nothing when only the page's own server is known and it is primary", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      serverStatuses: [
        { url: "https://box.deli.test", label: "box.deli.test", state: "primary", term: 1 },
      ],
      serverWaiting: false,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-server-status]")).toBeNull();
  });
});

describe("the venue logo and Powered by on the sign-in", () => {
  const LEGAL_NAME = "Bar Pepe SL";
  const LIGHT = png(120, 40);
  const WIDE = png(800, 100);
  const never = () => new Promise<Response>(() => {});
  const rejecting = () => Promise.reject(new TypeError("Failed to fetch"));
  const withLogo = (light: string, dark: string | null = null) => ({
    ...FIXTURE_ANSWER,
    hash: "logo-hash",
    logo: { light, dark },
  });

  /** Starts the venue theme from a stored copy, or with none when `answer` is null (waiting). */
  function startFrom(answer: unknown): void {
    if (answer === null) localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
    else localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
    startVenueTheme(document.documentElement, { fetchImpl: never });
  }

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const screen = (el: TillLockScreen) => query(el, ".screen")!;
  const logoOf = (el: TillLockScreen) => query(el, "wt-venue-logo") as WtVenueLogo | null;
  const poweredBy = (el: TillLockScreen) => query(el, "wt-powered-by") as WtPoweredBy | null;
  const centre = (r: DOMRect) => (r.left + r.right) / 2;

  /** The box around what the line draws: its words and Waitron's lockup, not its full-width host. */
  async function lineBox(line: WtPoweredBy): Promise<DOMRect> {
    await line.updateComplete;
    const lockup = line.shadowRoot!.querySelector<HTMLImageElement>('[part="lockup"]')!;
    await expect.poll(() => lockup.complete && lockup.naturalWidth > 0).toBe(true);
    await frame();
    const a = line.shadowRoot!.querySelector('[part="label"]')!.getBoundingClientRect();
    const b = lockup.getBoundingClientRect();
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    return new DOMRect(
      left,
      top,
      Math.max(a.right, b.right) - left,
      Math.max(a.bottom, b.bottom) - top,
    );
  }

  async function mountWithLogo(props: Partial<TillLockScreen> = {}, theme?: "light" | "dark") {
    const loads = nextLogoLoad();
    const mounted = await mountWidget<TillLockScreen>(
      "till-lock-screen",
      { api: stubApi(), legalName: LEGAL_NAME, ...props },
      theme,
    );
    await flush(mounted.el);
    const loaded = await loads;
    await frame();
    return { ...mounted, ...loaded };
  }

  let width = 0;
  let height = 0;
  beforeEach(() => {
    width = window.innerWidth;
    height = window.innerHeight;
  });
  afterEach(async () => {
    await page.viewport(width, height);
    localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
    startVenueTheme(document.documentElement, { fetchImpl: rejecting });
  });

  it("with a venue logo, the logo sits above the heading, centred, named by the legal name", async () => {
    startFrom(withLogo(LIGHT));
    const { el, logo, img } = await mountWithLogo();
    expect(logo).toBe(logoOf(el));
    expect(logo.getAttribute("size")).toBe("sign-in");
    expect(logo.getAttribute("light")).toBe(LIGHT);
    expect(logo.getAttribute("alt")).toBe(LEGAL_NAME);
    expect(img.alt).toBe(LEGAL_NAME);
    expect(logo.children).toHaveLength(0);
    const place = logo.parentElement!;
    expect(place.classList.contains("logo-place")).toBe(true);
    expect(screen(el).firstElementChild).toBe(place);
    const heading = query(el, ".heading")!.getBoundingClientRect();
    const drawn = img.getBoundingClientRect();
    expect(img.naturalWidth).toBeGreaterThan(0);
    expect(drawn.height).toBeCloseTo(96, 0);
    expect(heading.top - place.getBoundingClientRect().bottom).toBeCloseTo(16, 0);
    expect(drawn.bottom).toBeLessThanOrEqual(heading.top);
    expect(
      Math.abs(centre(drawn) - centre(screen(el).getBoundingClientRect())),
    ).toBeLessThanOrEqual(1);
  });

  it("names the logo by a legal name that arrives later", async () => {
    startFrom(withLogo(LIGHT));
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    expect(logoOf(el)!.getAttribute("alt")).toBe("");
    el.legalName = LEGAL_NAME;
    await el.updateComplete;
    expect(logoOf(el)!.getAttribute("alt")).toBe(LEGAL_NAME);
  });

  it("with none, no logo and no Powered by, as today", async () => {
    startFrom(FIXTURE_ANSWER);
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      legalName: LEGAL_NAME,
      devMode: true,
    });
    await flush(el);
    expect(currentVenueLogo().kind).toBe("none");
    expect(logoOf(el)).toBeNull();
    expect(query(el, ".logo-place")).toBeNull();
    expect(poweredBy(el)).toBeNull();
    expect(screen(el).firstElementChild!.classList.contains("heading")).toBe(true);
  });

  it("waiting draws an empty 96 px box and no Powered by", async () => {
    startFrom(null);
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      legalName: LEGAL_NAME,
    });
    await flush(el);
    expect(currentVenueLogo().kind).toBe("waiting");
    const logo = logoOf(el)!;
    expect(logo.getAttribute("size")).toBe("sign-in");
    expect(logo.hasAttribute("light")).toBe(false);
    expect(logo.children).toHaveLength(0);
    await logo.updateComplete;
    const box = logo.shadowRoot!.querySelector(".box")!.getBoundingClientRect();
    expect(box.height).toBeCloseTo(96, 0);
    expect(box.width).toBe(0);
    expect(poweredBy(el)).toBeNull();
  });

  it("a failed logo leaves no logo and no Powered by", async () => {
    startFrom(withLogo("/no-such.png"));
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      legalName: LEGAL_NAME,
    });
    const logo = logoOf(el)!;
    await expect.poll(() => logo.hasAttribute("failed")).toBe(true);
    await expect.poll(() => poweredBy(el)).toBeNull();
    expect(logo.children).toHaveLength(0);
    expect(logo.shadowRoot!.querySelector("img")).toBeNull();
    expect(logo.getBoundingClientRect().width).toBe(0);
  });

  it("under Dark with one image the logo sits on the plate", async () => {
    startFrom(withLogo(LIGHT));
    const { el, logo } = await mountWithLogo({}, "dark");
    expect(logo).toBe(logoOf(el));
    expect(logo.shadowRoot!.querySelector(".box")!.hasAttribute("data-plate")).toBe(true);
  });

  async function expectPoweredByLast(el: TillLockScreen, after: Element): Promise<void> {
    const line = poweredBy(el)!;
    expect(line).not.toBeNull();
    expect(screen(el).lastElementChild).toBe(line);
    expect(line.previousElementSibling).toBe(after);
    expect(line.getAttribute("label")).toBe(t("login.powered_by"));
    expect(line.shadowRoot!.querySelector('[part="label"]')!.textContent).toBe(
      t("login.powered_by"),
    );
    const box = await lineBox(line);
    const above = after.getBoundingClientRect();
    expect(line.getBoundingClientRect().top - above.bottom).toBeCloseTo(16, 0);
    expect(Math.abs(centre(box) - centre(screen(el).getBoundingClientRect()))).toBeLessThanOrEqual(
      1,
    );
    const status = query(el, "[data-server-status]")!;
    expect(status.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom);
  }

  const statuses: ServerStatus[] = [
    { url: "https://box.deli.test", label: "box.deli.test", state: "unreachable", term: null },
  ];

  it("Powered by comes last in .screen, after the names and Switch device, 16 px below it, before the server status", async () => {
    startFrom(withLogo(LIGHT));
    const { el } = await mountWithLogo({ devMode: true, serverStatuses: statuses });
    expect(query(el, ".roster")).not.toBeNull();
    const switchDevice = query(el, "[data-switch-device]")!;
    expect(
      query(el, ".roster")!.compareDocumentPosition(switchDevice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expectPoweredByLast(el, switchDevice);
  });

  it("Powered by comes last after the PIN pad and Switch device", async () => {
    startFrom(withLogo(LIGHT));
    const { el } = await mountWithLogo({ devMode: true, serverStatuses: statuses });
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    const pad = query(el, "till-numeric-pad")!;
    const switchDevice = query(el, "[data-switch-device]")!;
    expect(pad.compareDocumentPosition(switchDevice) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await expectPoweredByLast(el, switchDevice);
  });

  it("without dev mode, Powered by sits 16 px under the names", async () => {
    startFrom(withLogo(LIGHT));
    const { el } = await mountWithLogo({ serverStatuses: statuses });
    await expectPoweredByLast(el, query(el, ".roster")!);
  });

  it("says Powered by in Spanish from the strings", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      startFrom(withLogo(LIGHT));
      const { el } = await mountWithLogo();
      const line = poweredBy(el)!;
      expect(line.getAttribute("label")).toBe(t("login.powered_by"));
      expect(line.getAttribute("label")).not.toBe("Powered by");
    } finally {
      setLocale(before);
    }
  });

  it("at phone width the logo is at most 320 wide and the line stays in the window", async () => {
    await page.viewport(390, 844);
    await frame();
    startFrom(withLogo(WIDE));
    const { el, img } = await mountWithLogo({ devMode: true });
    expect(img.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    expect(img.getBoundingClientRect().width).toBeGreaterThan(200);
    const box = await lineBox(poweredBy(el)!);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(document.documentElement.scrollHeight);
  });
});
