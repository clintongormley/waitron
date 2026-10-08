import { afterEach, expect, it, vi, type Mock } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, OwnProfile } from "../api/client.js";
import type { ProfileScreen } from "./profile-screen.js";
import "./profile-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
  vi.restoreAllMocks();
});

// Every detail holds something, in the spelling the server returns it, so a field that rewrites
// its value on first draw shows as a change.
const PROFILE: OwnProfile = {
  displayName: "Alex R.",
  firstNames: "Alex",
  lastNames: "Rivera",
  telephone: "+34 600 000 000",
  email: "alex@example.com",
  pendingEmail: "next@example.com",
  locale: "es-ES",
  hasPassword: true,
  hasTotp: false,
  hasGoogle: false,
  passkeys: [
    {
      id: "credential",
      name: "Laptop",
      createdAt: "2026-09-09T12:00:00Z",
      lastUsedAt: null,
      provider: null,
    },
  ],
};
const SECURED: OwnProfile = { ...PROFILE, hasTotp: true, hasGoogle: true };

function stubApi(
  profile: OwnProfile,
  overrides: Partial<Record<keyof DashboardApi, unknown>> = {},
) {
  return {
    getProfile: vi.fn().mockResolvedValue(profile),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "en-GB", label: "English" },
        { code: "es-ES", label: "Español" },
      ],
      venueDefault: "en-GB",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: true }),
    saveProfile: vi.fn().mockResolvedValue({ emailVerificationSent: false }),
    confirmProfileEmail: vi.fn().mockResolvedValue({ email: "next@example.com" }),
    changePassword: vi.fn().mockResolvedValue(undefined),
    changePin: vi.fn().mockResolvedValue(undefined),
    removePasskey: vi.fn().mockResolvedValue(undefined),
    beginTotp: vi.fn().mockResolvedValue({
      enrollmentId: "11111111-1111-4111-8111-111111111111",
      secret: "SECRET",
      uri: "otpauth://totp/Waitron:test",
      expiresAt: "2026-09-09T12:10:00Z",
    }),
    finishTotp: vi.fn().mockResolvedValue({ codes: ["CODE-1"] }),
    regenerateRecoveryCodes: vi.fn().mockResolvedValue({ codes: ["CODE-1"] }),
    beginGoogleLink: vi
      .fn()
      .mockResolvedValue({ authorizationUrl: "https://accounts.google.test" }),
    disableTotp: vi.fn().mockResolvedValue(undefined),
    unlinkGoogle: vi.fn().mockResolvedValue(undefined),
    passkeyRegisterOptions: vi.fn().mockRejectedValue({ code: "server.internal" }),
    passkeyRegisterVerify: vi.fn(),
    passkeySignals: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}
type Api = ReturnType<typeof stubApi>;
/** Every request that saves something, so "nothing was sent" names them all. */
const SENDS = [
  "saveProfile",
  "confirmProfileEmail",
  "changePassword",
  "changePin",
  "removePasskey",
  "beginTotp",
  "finishTotp",
  "regenerateRecoveryCodes",
  "beginGoogleLink",
  "disableTotp",
  "unlinkGoogle",
  "passkeyRegisterOptions",
] as const;
const sent = (api: Api) => SENDS.filter((name) => (api[name] as Mock).mock.calls.length > 0);

const q = <T extends HTMLElement = HTMLElement>(el: ProfileScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
async function settle(el: ProfileScreen) {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}
async function mount(profile = PROFILE, overrides = {}) {
  setLocale("en-GB");
  const api = stubApi(profile, overrides);
  const navigate = vi.fn();
  const { el } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
    api: api as unknown as DashboardApi,
    navigate,
  });
  await settle(el);
  return { el, api, navigate };
}

/** The card action that opens each mode; details opens through the app's Edit button. */
const OPENERS = {
  details: null,
  password: "change-password",
  pin: "change-pin",
  remove: "remove-passkey",
  totp: "setup-authenticator",
  google: "setup-google",
  passkey: "add-passkey",
  email: "confirm-email",
  recovery: "recovery-codes",
  "disable-totp": "disable-authenticator",
  "unlink-google": "unlink-google",
} as const;
type Mode = keyof typeof OPENERS;
const SECURED_MODES: readonly Mode[] = ["recovery", "disable-totp", "unlink-google"];

async function openMode(mode: Mode, overrides = {}) {
  const mounted = await mount(SECURED_MODES.includes(mode) ? SECURED : PROFILE, overrides);
  const opener = OPENERS[mode];
  if (opener === null) mounted.el.editDetails();
  else q(mounted.el, `[data-test=${opener}]`)!.click();
  await settle(mounted.el);
  expect(q<HTMLElementTagNameMap["wt-modal"]>(mounted.el, "wt-modal")!.open).toBe(true);
  return mounted;
}

function save(el: ProfileScreen) {
  return q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: ProfileScreen) {
  await settle(el);
  const action = save(el);
  await action.updateComplete;
  return {
    variant: action.variant,
    disabled: action.disabled,
    innerDisabled: action.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

/** A real pointer press on Save's inner button; `force` presses a disabled one too. */
async function press(el: ProfileScreen) {
  await userEvent.click(page.elementLocator(save(el).shadowRoot!.querySelector("button")!), {
    force: true,
  });
  await settle(el);
}
function inner(el: ProfileScreen, name: string) {
  return q<HTMLElementTagNameMap["wt-input"]>(
    el,
    `wt-input[name="${name}"]`,
  )!.shadowRoot!.querySelector("input")!;
}
async function type(el: ProfileScreen, name: string, value: string) {
  await q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`)!.updateComplete;
  await userEvent.fill(page.elementLocator(inner(el, name)), value);
  await settle(el);
}
function errors(el: ProfileScreen): string[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input")]
    .map((input) => input.error)
    .filter((error) => error !== "");
}

it.each(Object.keys(OPENERS) as Mode[])(
  "%s opens with Save quiet, and neither a press, a host click nor Enter marks or sends anything",
  async (mode) => {
    const { el, api } = await openMode(mode);
    expect(await state(el)).toEqual(quiet);
    await press(el);
    save(el).click();
    await settle(el);
    inner(el, el.shadowRoot!.querySelector("wt-input")!.getAttribute("name")!).focus();
    await userEvent.keyboard("{Enter}");
    await settle(el);
    expect(sent(api)).toEqual([]);
    expect(errors(el)).toEqual([]);
    expect(q<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.open).toBe(true);
  },
);

it.each([
  ["firstNames", "Alex", "Alexa"],
  ["lastNames", "Rivera", "Rivas"],
  ["displayName", "Alex R.", "Al"],
  ["email", "alex@example.com", "other@example.com"],
  ["telephone", "+34 600 000 000", "+34 600 000 001"],
])(
  "an edit of %s wakes Save, and typing the stored value back quiets it",
  async (name, stored, edit) => {
    const { el } = await openMode("details");
    await type(el, name, edit);
    expect((await state(el)).variant).toBe("primary");
    await type(el, name, stored);
    expect(await state(el)).toEqual(quiet);
  },
);

it("choosing another language wakes Save, and choosing the stored one again quiets it", async () => {
  const { el } = await openMode("details");
  const locale = q(el, "wt-combobox[name=locale]")!;
  await chooseOption(locale, "en-GB");
  expect(await state(el)).toEqual(ready);
  await chooseOption(locale, "es-ES");
  expect(await state(el)).toEqual(quiet);
});

it("an edited detail is ready and sends the stored fields beside it", async () => {
  const { el, api } = await openMode("details");
  await type(el, "telephone", "+34 600 000 001");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(sent(api)).toEqual(["saveProfile"]);
  expect(api.saveProfile).toHaveBeenCalledExactlyOnceWith({
    displayName: "Alex R.",
    firstNames: "Alex",
    lastNames: "Rivera",
    telephone: "+34 600 000 001",
    email: "alex@example.com",
    locale: "es-ES",
  });
});

it.each([
  ["remove", "removePasskey"],
  ["totp", "beginTotp"],
  ["google", "beginGoogleLink"],
  ["passkey", "passkeyRegisterOptions"],
] as const)(
  "%s: typing the current password makes Save ready, and sends %s",
  async (mode, request) => {
    const { el, api } = await openMode(mode);
    await type(el, "currentPassword", "secret-password");
    expect(await state(el)).toEqual(ready);
    await press(el);
    expect(sent(api)).toEqual([request]);
  },
);

it.each([
  ["recovery", "regenerateRecoveryCodes"],
  ["disable-totp", "disableTotp"],
  ["unlink-google", "unlinkGoogle"],
] as const)(
  "%s: typing the current password and code makes Save ready, and sends %s",
  async (mode, request) => {
    const { el, api } = await openMode(mode);
    await type(el, "currentPassword", "secret-password");
    await type(el, "totp", "123456");
    expect(await state(el)).toEqual(ready);
    await press(el);
    expect(sent(api)).toEqual([request]);
  },
);

it("a changed new-password form its own checks refuse stays primary and disabled", async () => {
  const { el, api } = await openMode("password");
  await type(el, "currentPassword", "secret-password");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(sent(api)).toEqual([]);
  expect(errors(el).length).toBeGreaterThan(0);
  expect(await state(el)).toEqual(blocked);
});

it("a changed PIN form its own checks refuse stays primary and disabled", async () => {
  const { el, api } = await openMode("pin");
  await type(el, "pin", "12");
  await press(el);
  expect(sent(api)).toEqual([]);
  expect(await state(el)).toEqual(blocked);
});

it("typing the emailed code makes Save ready and sends only that code", async () => {
  const { el, api } = await openMode("email");
  await type(el, "setupCode", "123456");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(sent(api)).toEqual(["confirmProfileEmail"]);
  expect(api.confirmProfileEmail).toHaveBeenCalledExactlyOnceWith("123456");
});

it("the authenticator's code step, which the first step leaves open, starts quiet", async () => {
  const { el, api } = await openMode("totp");
  await type(el, "currentPassword", "secret-password");
  await press(el);
  expect(q(el, "[data-test=authenticator-qr]")).not.toBeNull();
  expect(await state(el)).toEqual(quiet);
  await press(el);
  expect(api.finishTotp).not.toHaveBeenCalled();
  await type(el, "setupCode", "123456");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(api.finishTotp).toHaveBeenCalledOnce();
});

it("after a save the person kept editing through, Save is quiet once the sent value is typed back", async () => {
  let finish!: () => void;
  const { el, api } = await openMode("details", {
    saveProfile: vi.fn(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ emailVerificationSent: false });
        }),
    ),
  });
  await type(el, "telephone", "+34 600 000 001");
  await press(el);
  expect(api.saveProfile).toHaveBeenCalledOnce();
  // Typing is refused while the request is out, so the edit goes in through the field's own event.
  q(el, "wt-input[name=lastNames]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Rivas" } }),
  );
  finish();
  await settle(el);
  expect(q<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.open).toBe(true);
  expect(await state(el)).toEqual(ready);
  await type(el, "lastNames", "Rivera");
  expect(await state(el)).toEqual(quiet);
  await press(el);
  expect(api.saveProfile).toHaveBeenCalledOnce();
});

it("each mode opened after another starts quiet and wakes on its own edit", async () => {
  const { el } = await openMode("details");
  await type(el, "telephone", "+34 600 000 001");
  q(el, "[data-test=cancel]")!.click();
  await settle(el);
  expect(q<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.open).toBe(false);
  q(el, "[data-test=change-pin]")!.click();
  await settle(el);
  expect(await state(el)).toEqual(quiet);
  await type(el, "currentPassword", "secret-password");
  expect(await state(el)).toEqual(ready);
});

it("Enter in a changed field presses Save, so the unchanged cases' Enter reaches it too", async () => {
  const { el, api } = await openMode("pin");
  await type(el, "currentPassword", "secret-password");
  await type(el, "pin", "4321");
  await type(el, "confirmPin", "4321");
  inner(el, "currentPassword").focus();
  await userEvent.keyboard("{Enter}");
  await settle(el);
  expect(sent(api)).toEqual(["changePin"]);
});
