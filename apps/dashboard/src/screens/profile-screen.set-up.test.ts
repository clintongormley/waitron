import type { WtButton } from "@waitron/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useLocale } from "../testing/locale-setup.js";
import type { DashboardApi } from "../api/client.js";
import type { OwnProfile } from "../api/account-api.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { ProfileScreen } from "./profile-screen.js";
import "./profile-screen.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const PROFILE: OwnProfile = {
  displayName: "Alex",
  firstNames: "Alex",
  lastNames: "Rivera",
  telephone: null,
  email: "alex@example.com",
  pendingEmail: null,
  locale: "en-GB",
  hasPassword: true,
  hasTotp: false,
  hasGoogle: false,
  passkeySignals: {
    rpId: "localhost",
    userId: "BAUG",
    credentialIds: [],
    name: "alex@example.com",
    displayName: "Alex",
  },
  passkeys: [],
};
const SETUP = {
  enrollmentId: "setup",
  secret: "SECRET",
  uri: "otpauth://totp/Waitron:test",
  expiresAt: "2026-10-07T00:00:00Z",
};
const LINK = { authorizationUrl: "https://accounts.google.test/link" };

const $ = <T extends HTMLElement = HTMLElement>(el: ProfileScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const button = (el: ProfileScreen, action: string) => $<WtButton>(el, `[data-test=${action}]`)!;
const modal = (el: ProfileScreen) => $<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!;
const STARTED = {
  "add-passkey": "passkey",
  "setup-authenticator": "totp",
  "setup-google": "google",
} as const;
type Start = keyof typeof STARTED;
const message = (el: ProfileScreen, action: Start) =>
  $(el, `[data-test=start-error-${STARTED[action]}]`);
const refusal = (el: ProfileScreen, action: Start) => message(el, action)?.textContent?.trim();
async function settle(el: ProfileScreen) {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}
async function mount(overrides: Record<string, unknown> = {}, profile = PROFILE) {
  const api = {
    getProfile: vi.fn().mockResolvedValue(profile),
    getLocales: vi.fn().mockResolvedValue({
      locales: [{ code: "en-GB", label: "English" }],
      venueDefault: "en-GB",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: true }),
    beginTotp: vi.fn().mockResolvedValue(SETUP),
    finishTotp: vi.fn().mockResolvedValue({ codes: ["RECOVERY"] }),
    beginGoogleLink: vi.fn().mockResolvedValue(LINK),
    passkeyRegisterOptions: vi.fn(),
    ...overrides,
  };
  const navigate = vi.fn();
  const { el, host } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
    api: api as unknown as DashboardApi,
    navigate,
  });
  await settle(el);
  $(el, "wt-tabs")!.shadowRoot!.querySelector<HTMLElement>("[data-key=security]")!.click();
  await settle(el);
  return { el, host, api, navigate };
}
async function press(el: ProfileScreen, action: string) {
  await userEvent.click(
    page.elementLocator(button(el, action).shadowRoot!.querySelector("button")!),
  );
  await settle(el);
}

it("opens straight on the authenticator's code to scan, and sends the code typed there", async () => {
  const { el, host, api } = await mount();
  await press(el, "setup-authenticator");
  await vi.waitFor(() => expect(modal(el).open).toBe(true));
  await settle(el);
  expect(api.beginTotp).toHaveBeenCalledExactlyOnceWith({});
  expect(modal(el).heading).toBe(t("profile.setup_authenticator"));
  expect($(el, "[data-test=authenticator-qr]")).not.toBeNull();
  expect($(el, "wt-input[name=setupCode]")).not.toBeNull();
  expect(button(el, "save").disabled).toBe(true);
  await expectNoA11yViolations(host);
  $(el, "wt-input[name=setupCode]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "123456" } }),
  );
  await settle(el);
  button(el, "save").click();
  await vi.waitFor(() => expect($(el, "[data-test=recovery-code-list]")).not.toBeNull());
  expect(api.finishTotp).toHaveBeenCalledExactlyOnceWith("setup", "123456");
});

it("starts a new authenticator each time, and hands the focus back when its window closes", async () => {
  const { el, api } = await mount();
  await press(el, "setup-authenticator");
  await vi.waitFor(() => expect(modal(el).open).toBe(true));
  await settle(el);
  button(el, "cancel").click();
  await vi.waitFor(() => expect(modal(el).open).toBe(false));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.activeElement).toBe(button(el, "setup-authenticator")),
  );
  await press(el, "setup-authenticator");
  await vi.waitFor(() => expect(modal(el).open).toBe(true));
  expect(api.beginTotp).toHaveBeenCalledTimes(2);
});

it("goes straight to Google, with no window first", async () => {
  const { el, api, navigate } = await mount();
  await press(el, "setup-google");
  expect(api.beginGoogleLink).toHaveBeenCalledExactlyOnceWith({});
  expect(navigate).toHaveBeenCalledExactlyOnceWith(LINK.authorizationUrl);
  expect(modal(el).open).toBe(false);
});

it("asks for the authenticator code before Google on an account with an authenticator", async () => {
  const { el, api, navigate } = await mount({}, { ...PROFILE, hasTotp: true });
  await press(el, "setup-google");
  expect(modal(el).open).toBe(true);
  expect(api.beginGoogleLink).not.toHaveBeenCalled();
  $(el, "wt-input[name=totp]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "123456" } }),
  );
  await settle(el);
  button(el, "save").click();
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
  expect(api.beginGoogleLink).toHaveBeenCalledExactlyOnceWith({ totp: "123456" });
});

const STARTS = [
  ["setup-authenticator", "beginTotp"],
  ["setup-google", "beginGoogleLink"],
] as const;

it.each(STARTS)("%s shows its work on its own button and is sent once", async (action, request) => {
  let refuse!: (error: unknown) => void;
  const { el, host, api } = await mount({
    [request]: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
  });
  await press(el, action);
  for (const other of ["add-passkey", "setup-authenticator", "setup-google"])
    expect([button(el, other).loading, button(el, other).disabled], other).toEqual(
      other === action ? [true, false] : [false, true],
    );
  for (const other of ["change-password", "change-pin"])
    expect(button(el, other).disabled, other).toBe(true);
  expect(el.shadowRoot!.activeElement).toBe(button(el, action));
  expect(modal(el).open).toBe(false);
  expect(await el.requestLeave("navigation")).toBe(false);
  await expectNoA11yViolations(host);
  for (const other of ["setup-authenticator", "setup-google", "change-pin"])
    button(el, other).click();
  await settle(el);
  expect(api[request]).toHaveBeenCalledOnce();
  expect(modal(el).open).toBe(false);
  refuse({ code: "connection.failed" });
  await vi.waitFor(() => expect(button(el, action).loading).toBe(false));
  for (const other of ["add-passkey", "setup-authenticator", "setup-google", "change-pin"])
    expect(button(el, other).disabled, other).toBe(false);
  expect(await el.requestLeave("navigation")).toBe(true);
});

it.each(STARTS)(
  "%s says under its own heading that it was refused, until the next press",
  async (action, request) => {
    const { el, host, navigate } = await mount({
      [request]: vi.fn().mockRejectedValue({ code: "management_session.proof_required" }),
    });
    await press(el, action);
    await vi.waitFor(() =>
      expect(refusal(el, action)).toBe(codeMessage("management_session.proof_required")),
    );
    const shown = message(el, action)!;
    expect(shown.getAttribute("role")).toBe("alert");
    expect(shown.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      button(el, action).getBoundingClientRect().bottom,
    );
    for (const other of ["add-passkey", "setup-authenticator", "setup-google"] as const)
      if (other !== action) expect(refusal(el, other), other).toBeUndefined();
    expect(modal(el).open).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    await expectNoA11yViolations(host);
    const pending = vi.fn(() => new Promise(() => {}));
    (el.api as unknown as Record<string, unknown>)[request] = pending;
    await press(el, action);
    expect(pending).toHaveBeenCalledOnce();
    expect(refusal(el, action)).toBeUndefined();
  },
);

it.each(STARTS)("%s does nothing more once the profile has closed", async (action, request) => {
  let answer!: (value: unknown) => void;
  const { el, host, navigate } = await mount({
    [request]: vi.fn(() => new Promise((resolve) => (answer = resolve))),
  });
  await press(el, action);
  el.remove();
  host.append(el);
  await settle(el);
  answer(action === "setup-google" ? LINK : SETUP);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await settle(el);
  expect(navigate).not.toHaveBeenCalled();
  expect(modal(el).open).toBe(false);
  expect($(el, "[data-test=authenticator-qr]")).toBeNull();
});

it.each(STARTS)(
  "%s never reports an unexplained failure as a passkey's",
  async (action, request) => {
    const failure = new Error("no code");
    const { el } = await mount({ [request]: vi.fn().mockRejectedValue(failure) });
    await press(el, action);
    await vi.waitFor(() => expect(refusal(el, action)).toBe(codeMessage(codeOf(failure))));
    expect(refusal(el, action)).not.toBe(codeMessage("passkey.verification_failed"));
  },
);

it("holds back Google's and a passkey's Remove while a passkey is being added", async () => {
  const passkey = {
    id: "credential",
    name: null,
    createdAt: "2026-09-09T12:00:00Z",
    lastUsedAt: null,
    provider: null,
  };
  const { el } = await mount(
    { passkeyRegisterOptions: vi.fn(() => new Promise(() => {})) },
    { ...PROFILE, hasGoogle: true, passkeys: [passkey] },
  );
  const actions = ["unlink-google", "remove-passkey"];
  for (const action of actions) expect(button(el, action).disabled, action).toBe(false);
  await press(el, "add-passkey");
  for (const action of actions) expect(button(el, action).disabled, action).toBe(true);
});

it.each([
  ["change-pin", "changePin", { pin: "123456", confirmPin: "123456" }],
  [
    "change-password",
    "changePassword",
    { password: "correct-horse", confirmPassword: "correct-horse" },
  ],
] as const)(
  "%s has the focus again once its window has saved and closed",
  async (action, request, fields) => {
    const { el } = await mount({ [request]: vi.fn().mockResolvedValue({}) });
    await press(el, action);
    for (const [name, value] of Object.entries(fields))
      $(el, `wt-input[name=${name}]`)!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value } }),
      );
    await settle(el);
    button(el, "save").click();
    await vi.waitFor(() => expect(modal(el).open).toBe(false));
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(button(el, action)));
  },
);

describe("an authenticator app added elsewhere since this screen loaded", () => {
  const ENROLLED = { ...PROFILE, hasTotp: true };
  const REFUSED = { code: "totp.invalid" };
  const REQUESTS = [
    ["add-passkey", "passkeyRegisterOptions"],
    ["setup-google", "beginGoogleLink"],
  ] as const;

  it.each(REQUESTS)("%s reloads the profile and asks for the code", async (action, request) => {
    const getProfile = vi.fn().mockResolvedValueOnce(PROFILE).mockResolvedValue(ENROLLED);
    const { el, api } = await mount({
      getProfile,
      [request]: vi.fn().mockRejectedValue(REFUSED),
    });
    await press(el, action);
    await vi.waitFor(() => expect(modal(el).open).toBe(true));
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect($(el, "wt-input[name=totp]")).not.toBeNull();
    expect(refusal(el, action)).toBeUndefined();
    expect(button(el, action).loading).toBe(false);
    $(el, "wt-input[name=totp]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "123456" } }),
    );
    await settle(el);
    button(el, "save").click();
    await settle(el);
    expect(api[request]).toHaveBeenLastCalledWith({
      totp: "123456",
    });
  });

  it("setup-authenticator leaves the refreshed row, its actions held back until the reload ends, with nothing refused", async () => {
    const getProfile = vi.fn().mockResolvedValueOnce(PROFILE).mockResolvedValue(ENROLLED);
    const locales = { locales: [], venueDefault: "en-GB" };
    let endReload!: (value: typeof locales) => void;
    const { el } = await mount({
      getProfile,
      getLocales: vi
        .fn()
        .mockResolvedValueOnce(locales)
        .mockImplementation(() => new Promise((resolve) => (endReload = resolve))),
      beginTotp: vi.fn().mockRejectedValue(REFUSED),
    });
    await press(el, "setup-authenticator");
    await vi.waitFor(() => expect(button(el, "recovery-codes")).not.toBeNull());
    const actions = ["recovery-codes", "disable-authenticator", "add-passkey", "setup-google"];
    for (const action of actions) expect(button(el, action).disabled, action).toBe(true);
    endReload(locales);
    await settle(el);
    expect(button(el, "setup-authenticator")).toBeNull();
    for (const action of actions) expect(button(el, action).disabled, action).toBe(false);
    expect(refusal(el, "setup-authenticator")).toBeUndefined();
    expect(modal(el).open).toBe(false);
    expect(await el.requestLeave("navigation")).toBe(true);
  });

  it.each([
    ["add-passkey", "passkeyRegisterOptions"],
    ["setup-authenticator", "beginTotp"],
    ["setup-google", "beginGoogleLink"],
  ] as const)(
    "%s shows the refusal when the reload fails, or still shows no authenticator",
    async (action, request) => {
      const getProfile = vi
        .fn()
        .mockResolvedValueOnce(PROFILE)
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(PROFILE);
      const { el } = await mount({ getProfile, [request]: vi.fn().mockRejectedValue(REFUSED) });
      for (const reads of [2, 3]) {
        await press(el, action);
        await vi.waitFor(() => expect(getProfile).toHaveBeenCalledTimes(reads));
        await vi.waitFor(() => expect(refusal(el, action)).toBe(codeMessage("totp.invalid")));
        expect(modal(el).open).toBe(false);
        expect(button(el, action).loading).toBe(false);
      }
    },
  );

  it.each(REQUESTS)("%s opens nothing once the profile has closed", async (action, request) => {
    let answer!: (profile: OwnProfile) => void;
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(PROFILE)
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
      .mockResolvedValue(ENROLLED);
    const { el, host } = await mount({ getProfile, [request]: vi.fn().mockRejectedValue(REFUSED) });
    await press(el, action);
    await vi.waitFor(() => expect(getProfile).toHaveBeenCalledTimes(2));
    expect(button(el, action).loading).toBe(true);
    el.remove();
    host.append(el);
    answer(ENROLLED);
    await settle(el);
    expect(modal(el).open).toBe(false);
    expect(refusal(el, action)).toBeUndefined();
    expect(button(el, action).loading).toBe(false);
  });
});
