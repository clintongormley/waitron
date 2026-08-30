import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillLockScreen } from "./till-lock-screen.js";
import type { StaffMember, TillApi } from "../api/client.js";

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

afterEach(cleanupWidgets);

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
    expect(el.shadowRoot!.textContent).toContain(t("login.enter_pin"));
    expect(query(el, ".operator")!.textContent).toContain("Ana");
    expect(query(el, "till-numeric-pad")).not.toBeNull();
  });

  it("returns to the staff list when the back control is used", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api });
    await flush(el);
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    click(el, ".back");
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

  it("hides the language chooser in PIN mode (roster-view only, like the device set-up affordance)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-language-chooser")).not.toBeNull();
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-language-chooser")).toBeNull();
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

  // Device mode (device-identity-1 §5a): the roster view carries a "set up as kitchen display"
  // affordance so a FRESH (unenrolled) display can reach the enrol view; it emits `setup-device`, which
  // the app turns into the device-mode station screen. The operator PIN login is untouched.
  it("emits setup-device from the kitchen-display set-up affordance (roster view)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    const spy = vi.fn();
    el.addEventListener("setup-device", spy);
    click(el, "[data-setup-device]");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("hides the set-up affordance in PIN mode (it belongs to the roster view, not operator login)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(query(el, "[data-setup-device]")).not.toBeNull();
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    // In PIN mode the operator is logging in — the display set-up affordance is gone.
    expect(query(el, "[data-setup-device]")).toBeNull();
  });

  // Handheld (handheld-tableside Task 8): the roster view carries a SECOND set-up affordance beside the
  // kitchen-display one, so a FRESH phone can reach the handheld enrol view; it emits `setup-handheld`,
  // which the app turns into the handheld enrol screen. Same roster-only placement as `setup-device`.
  it("emits setup-handheld from the waiter-handheld set-up affordance (roster view)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    const spy = vi.fn();
    el.addEventListener("setup-handheld", spy);
    click(el, "[data-setup-handheld]");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("hides the handheld set-up affordance in PIN mode (roster view only, like setup-device)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", { api: stubApi() });
    await flush(el);
    expect(query(el, "[data-setup-handheld]")).not.toBeNull();
    click(el, 'wt-button.operator-button[data-person="p1"]');
    await el.updateComplete;
    expect(query(el, "[data-setup-handheld]")).toBeNull();
  });

  // §C2 containment/identity: an ALREADY-ENROLLED device (a handheld, or a KDS) returns to the lock
  // screen on every logout and cold boot. It must NOT see the device-setup affordances — tapping "Set
  // up as kitchen display" would take the enrolled phone into the KDS enrol view, where any valid
  // pairing code would SILENTLY replace its device cookie with a `kds_station` identity, bricking the
  // phone as a handheld mid-shift (and escaping the face-set to `station`). `deviceEnrolled` (the app
  // passes `handheldMode || deviceMode`) hides both affordances; a fresh browser still shows them.
  it("hides BOTH device-setup affordances once the device is enrolled (deviceEnrolled)", async () => {
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      deviceEnrolled: true,
    });
    await flush(el);
    expect(query(el, "[data-setup-device]")).toBeNull();
    expect(query(el, "[data-setup-handheld]")).toBeNull();
    // The roster login is untouched — an enrolled handheld's waiter still picks their name and PINs in.
    expect(el.shadowRoot!.querySelectorAll("wt-button.operator-button")).toHaveLength(2);
  });

  it("keeps BOTH device-setup affordances on a FRESH (unenrolled) browser so first enrolment works", async () => {
    // Prove-by-deletion counterpart: with `deviceEnrolled` false (the default — a fresh browser has no
    // device cookie yet) both the kitchen-display and waiter-handheld set-up controls must remain, or a
    // first-time enrolment would be impossible.
    const { el } = await mountWidget<TillLockScreen>("till-lock-screen", {
      api: stubApi(),
      deviceEnrolled: false,
    });
    await flush(el);
    expect(query(el, "[data-setup-device]")).not.toBeNull();
    expect(query(el, "[data-setup-handheld]")).not.toBeNull();
  });
});
