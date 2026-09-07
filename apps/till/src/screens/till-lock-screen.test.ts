import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillLockScreen } from "./till-lock-screen.js";
import type { StaffMember, TillApi } from "../api/client.js";
import type { ServerStatus } from "../api/server-router.js";

const ana: StaffMember = { personId: "p1", displayName: "Ana" };
const ben: StaffMember = { personId: "p2", displayName: "Ben" };

/**
 * A fake `TillApi` exposing only the two methods the lock screen calls. `listStaff` defaults to the
 * two-person roster and `login` to a success; a test overrides either with its own `vi.fn()`. Cast
 * through `unknown` because the screen touches only this pair, never the rest of the class surface.
 */
function stubApi(
  overrides: Partial<Record<"listStaff" | "login" | "getLocales", unknown>> = {},
): TillApi {
  return {
    listStaff: vi.fn().mockResolvedValue([ana, ben]),
    login: vi.fn().mockResolvedValue({ personId: "p1", canConfigureTill: false, locale: null }),
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

/** Lets the pending `listStaff`/`login` promise settle and the element re-render. A `setTimeout(0)`
 * macrotask drains the microtask queue (promise resolution + Lit's batched update) first. */
async function flush(el: TillLockScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** The fake-timer twin of {@link flush}: drains pending timers (the `setTimeout(0)` above included) and
 * microtasks under `vi.useFakeTimers()`, so the roster fetch and a login rejection settle without the
 * real clock — the throttle test needs the countdown's `setInterval` on the fake clock. */
async function flushFake(el: TillLockScreen): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await el.updateComplete;
}

/** Taps one keypad key inside the screen and lets the parent re-render with the new value. */
async function press(el: TillLockScreen, key: string): Promise<void> {
  const pad = el.shadowRoot!.querySelector("till-numeric-pad")!;
  await (pad as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!.click();
  await el.updateComplete;
}

/** Taps a string of digit keys in order — each character is a `data-key` on the pad. */
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
    // The heading is the device's own name (device-enrolment §3.4) — its identity, not a mode label.
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
    // device-enrolment §3.4: "Login as" defaults to the last operator on THIS device. The roster loads,
    // the remembered personId is still present, so the screen lands straight in PIN mode for them.
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
    // Prove-by-deletion counterpart: a stale id (a person since removed) must NOT preselect — the guard
    // is the `staff.find`. With it gone the screen would try to enter PIN mode for a person not shown.
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
    // Private windows throw on localStorage access; the read is wrapped, so a throw means simply no
    // default — the screen stays on the roster rather than erroring.
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
    // The write is a convenience wrapped in try/catch — a storage throw must never break the login.
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    try {
      const login = vi
        .fn()
        .mockResolvedValue({ personId: "p1", canConfigureTill: false, locale: null });
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

  it("logs in with (personId, pin) and emits logged-in with the confirmed personId, name + capability", async () => {
    const login = vi.fn().mockResolvedValue({ personId: "p1", canConfigureTill: true });
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
    // detail carries the server-confirmed personId, the roster display name the parent labels with, AND
    // the server-computed till.configure capability threaded straight from the login response.
    expect(spy).toHaveBeenCalledWith({
      personId: "p1",
      displayName: "Ana",
      canConfigureTill: true,
    });
  });

  it("remembers the operator on this device after a successful login", async () => {
    // device-enrolment §3.4: a confirmed login writes `waitron.lastOperator.<deviceId>` so the next
    // unlock defaults to them. Keyed by deviceId, so two devices remember independently.
    const login = vi
      .fn()
      .mockResolvedValue({ personId: "p1", canConfigureTill: false, locale: null });
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
    // Per-user-language-preference: the operator's stored UI locale rides the `POST /api/session`
    // response, and the lock screen forwards it verbatim so `till-app` can `resolveActiveLocale` it.
    // Dropping `locale: result.locale` from the detail makes this fail (the app would never learn it).
    const login = vi
      .fn()
      .mockResolvedValue({ personId: "p1", canConfigureTill: false, locale: "en-GB" });
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
      canConfigureTill: false,
      locale: "en-GB",
    });
  });

  // Per-user-language-preference: the roster view carries the language chooser so an operator can pick
  // their UI language BEFORE logging in (a transient, unpersisted switch the app owns). The lock screen
  // only RENDERS it — the chooser's `locale-selected` bubbles composed to `till-app`, which decides.
  it("renders the language chooser in the roster view", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-language-chooser")).not.toBeNull();
  });

  it("lets the chooser's locale-selected bubble out composed (it does NOT handle it itself)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    const spy = vi.fn();
    el.addEventListener("locale-selected", (e) => spy((e as CustomEvent).detail));
    const chooser = el.shadowRoot!.querySelector("till-language-chooser")!;
    chooser.dispatchEvent(
      new CustomEvent("locale-selected", {
        detail: { code: "en-GB" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(spy).toHaveBeenCalledWith({ code: "en-GB" });
  });

  it("keeps the language chooser available in PIN mode", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-language-chooser")).not.toBeNull();
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-language-chooser")).not.toBeNull();
  });

  it("round-trips a leading-zero PIN (e.g. the default 0000) to login unmangled", async () => {
    // Regression: the pad's decimal mode would collapse 0,0,0,0 to "0" and lock those staff out.
    // In pin mode every keystroke appends, so the full "0000" reaches login.
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
    // Task 10 throttle: a wrong-PIN flood answers `pin.throttled` with `retryAfterSeconds`. The screen
    // greys the pad, disables submit, and shows "Try again in {n}s" ticking down each second; at 0 entry
    // is live again. Fake timers drive both the settle and the countdown's setInterval.
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

  it("shows a sensible localised message for a suspended account", async () => {
    const login = vi.fn().mockRejectedValue({ code: "person.suspended" });
    const api = stubApi({ login });
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    await type(el, "1234");
    click(el, ".submit");
    await flush(el);
    expect(query(el, ".error")!.textContent).toContain(t("person.suspended"));
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
    // device-enrolment Task 12: the three "Set up as …" controls left the lock screen; the device front
    // door is chosen at boot (Task 13). None of them may render here any more.
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(query(el, "[data-setup-device]")).toBeNull();
    expect(query(el, "[data-setup-handheld]")).toBeNull();
    expect(query(el, "[data-setup-till]")).toBeNull();
    expect(query(el, ".device-setup")).toBeNull();
  });

  // Server status line (till-reroute §4.4): the roster view carries one row per known server with its
  // localised state, a waiting-promotion suffix, and a "check again" control that dispatches
  // `check-again` (till-app turns it into `router.probeNow()`).
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
    // F7 (spec §4.4 — "On: Box · Cloud: standby"): the server the till is ON reads `On: <label>` when it
    // is primary; every other server keeps `<label>: <state>`. BEFORE the fix every row is `label: state`
    // and the current one is never marked, so this fails on the missing `On: box.deli.test`.
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
