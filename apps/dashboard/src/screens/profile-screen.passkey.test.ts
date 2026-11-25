import { LiveData } from "@waitron/dashboard-kit";
import type { WtButton } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useLocale } from "../testing/locale-setup.js";
import { createFreshSignInGate } from "../api/fresh-sign-in.js";
import type { DashboardApi, OwnProfile } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { en, es } from "../i18n/strings.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { FreshSignInDialog } from "../widgets/fresh-sign-in-dialog.js";
import "../widgets/fresh-sign-in-dialog.js";
import type { ProfileScreen } from "./profile-screen.js";
import "./profile-screen.js";

useLocale("en-GB");
afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

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
const CHALLENGE = {
  challengeHandle: "handle",
  options: {
    challenge: "AQID",
    rp: { name: "Waitron", id: "localhost" },
    user: { id: "BAUG", name: "alex@example.com", displayName: "Alex" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  },
};
const CREDENTIAL = {
  id: "new-credential",
  rawId: new Uint8Array([1]).buffer,
  type: "public-key",
  authenticatorAttachment: "platform",
  response: {
    clientDataJSON: new Uint8Array([2]).buffer,
    attestationObject: new Uint8Array([3]).buffer,
    getTransports: () => ["internal"],
  },
  getClientExtensionResults: () => ({}),
  toJSON: vi.fn(),
} as unknown as PublicKeyCredential;

let activeAtPrompt: boolean[];
beforeEach(() => {
  activeAtPrompt = [];
  vi.spyOn(navigator.credentials, "create").mockImplementation(async () => {
    activeAtPrompt.push(navigator.userActivation.isActive);
    return CREDENTIAL;
  });
  vi.spyOn(PublicKeyCredential, "signalAllAcceptedCredentials").mockResolvedValue(undefined);
  vi.spyOn(PublicKeyCredential, "signalCurrentUserDetails").mockResolvedValue(undefined);
});

function stubApi(overrides: Record<string, unknown> = {}, profile = PROFILE) {
  return {
    getProfile: vi.fn().mockResolvedValue(profile),
    getLocales: vi.fn().mockResolvedValue({
      locales: [{ code: "en-GB", label: "English" }],
      venueDefault: "en-GB",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: true }),
    passkeyRegisterOptions: vi.fn().mockResolvedValue(CHALLENGE),
    passkeyRegisterVerify: vi.fn().mockResolvedValue({ credentialId: "new-credential" }),
    ...overrides,
  };
}
const $ = <T extends HTMLElement = HTMLElement>(el: ProfileScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const add = (el: ProfileScreen) => $<WtButton>(el, "[data-test=add-passkey]")!;
const modalOpen = (el: ProfileScreen) => $<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.open;
const refusal = (el: ProfileScreen) => $(el, "[data-test=start-error-passkey]");
async function settle(el: ProfileScreen) {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await add(el).updateComplete;
  }
}
async function mount(api: Record<string, unknown> = stubApi()) {
  const { el, host } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
    api: api as unknown as DashboardApi,
  });
  await settle(el);
  $(el, "wt-tabs")!.shadowRoot!.querySelector<HTMLElement>("[data-key=security]")!.click();
  await settle(el);
  return { el, host };
}
async function press(el: ProfileScreen) {
  await userEvent.click(page.elementLocator(add(el).shadowRoot!.querySelector("button")!));
  await settle(el);
}

it("starts adding a passkey as soon as Add passkey is pressed, with no window of its own", async () => {
  const api = stubApi();
  const { el } = await mount(api);
  const updated = vi.fn();
  el.addEventListener("profile-updated", updated);
  await press(el);
  await vi.waitFor(() => expect(updated).toHaveBeenCalledOnce());
  expect(api.passkeyRegisterOptions).toHaveBeenCalledExactlyOnceWith({});
  expect(api.passkeyRegisterVerify).toHaveBeenCalledOnce();
  expect(activeAtPrompt).toEqual([true]);
  expect(modalOpen(el)).toBe(false);
  expect($(el, "[role=status]")!.textContent).toBe(t("profile.saved"));
  expect(refusal(el)).toBeNull();
  expect(add(el).loading).toBe(false);
});

it("shows the press is being worked on, keeps the focus on Add passkey, and sends it once", async () => {
  let answer!: (value: typeof CHALLENGE) => void;
  const api = stubApi({
    passkeyRegisterOptions: vi.fn(() => new Promise((resolve) => (answer = resolve))),
  });
  const { el, host } = await mount(api);
  await press(el);
  expect(add(el).loading).toBe(true);
  expect(add(el).disabled).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(add(el));
  for (const other of ["change-password", "setup-authenticator", "setup-google"])
    expect($<WtButton>(el, `[data-test=${other}]`)!.disabled, other).toBe(true);
  expect(modalOpen(el)).toBe(false);
  await expectNoA11yViolations(host);
  expect(await el.requestLeave("navigation")).toBe(false);
  add(el).click();
  await settle(el);
  expect(api.passkeyRegisterOptions).toHaveBeenCalledOnce();
  answer(CHALLENGE);
  await vi.waitFor(() => expect(add(el).loading).toBe(false));
  expect(await el.requestLeave("navigation")).toBe(true);
  await settle(el);
  expect(el.shadowRoot!.activeElement).toBe(add(el));
  for (const other of ["change-password", "setup-authenticator", "setup-google"])
    expect($<WtButton>(el, `[data-test=${other}]`)!.disabled, other).toBe(false);
});

it.each([
  ["already registered", "InvalidStateError", "passkey.already_registered"],
  ["authenticator failed", "UnknownError", "passkey.verification_failed"],
])(
  "says under Passkeys that the prompt was refused (%s), until the next press",
  async (message, name, code) => {
    const { el, host } = await mount();
    vi.mocked(navigator.credentials.create).mockRejectedValueOnce(new DOMException(message, name));
    await press(el);
    await vi.waitFor(() => expect(refusal(el)?.textContent?.trim()).toBe(codeMessage(code)));
    expect(refusal(el)!.getAttribute("role")).toBe("alert");
    expect(add(el).closest(".passkeys-row")!.contains(refusal(el))).toBe(true);
    expect(refusal(el)!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      add(el).getBoundingClientRect().bottom,
    );
    expect(modalOpen(el)).toBe(false);
    expect(add(el).loading).toBe(false);
    await expectNoA11yViolations(host);
    await press(el);
    expect(refusal(el)).toBeNull();
  },
);

it("says under Passkeys that the server refused, and drops the sentence once another change opens", async () => {
  const { el } = await mount(
    stubApi({
      passkeyRegisterVerify: vi.fn().mockRejectedValue({ code: "passkey.challenge_expired" }),
    }),
  );
  await press(el);
  await vi.waitFor(() =>
    expect(refusal(el)?.textContent?.trim()).toBe(codeMessage("passkey.challenge_expired")),
  );
  expect($(el, "[role=status]")).toBeNull();
  $(el, "[data-test=change-pin]")!.click();
  await settle(el);
  expect(modalOpen(el)).toBe(true);
  expect(refusal(el)).toBeNull();
});

it("stays quiet when the browser's prompt is cancelled", async () => {
  const { el } = await mount();
  vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
    new DOMException("cancelled", "NotAllowedError"),
  );
  await press(el);
  await vi.waitFor(() => expect(add(el).loading).toBe(false));
  expect(refusal(el)).toBeNull();
  expect($(el, "[role=status]")).toBeNull();
  expect(modalOpen(el)).toBe(false);
});

it("does not open an earlier success message beside a later refusal", async () => {
  const { el } = await mount();
  await press(el);
  await vi.waitFor(() => expect($(el, "[role=status]")).not.toBeNull());
  vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
    new DOMException("already registered", "InvalidStateError"),
  );
  await press(el);
  await vi.waitFor(() => expect(refusal(el)).not.toBeNull());
  expect($(el, "[role=status]")).toBeNull();
});

it("asks for the authenticator code first on an account with an authenticator, which the server requires", async () => {
  const api = stubApi({}, { ...PROFILE, hasTotp: true });
  const { el } = await mount(api);
  await press(el);
  expect(modalOpen(el)).toBe(true);
  expect(api.passkeyRegisterOptions).not.toHaveBeenCalled();
  $(el, "wt-input[name=totp]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "123456" } }),
  );
  await settle(el);
  $(el, "[data-test=save]")!.click();
  await vi.waitFor(() => expect(modalOpen(el)).toBe(false));
  expect(api.passkeyRegisterOptions).toHaveBeenCalledExactlyOnceWith({ totp: "123456" });
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(add(el)));
});

it("leaves the code window open and quiet when the browser's prompt is cancelled", async () => {
  const { el } = await mount(stubApi({}, { ...PROFILE, hasTotp: true }));
  vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
    new DOMException("cancelled", "NotAllowedError"),
  );
  await press(el);
  $(el, "wt-input[name=totp]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "123456" } }),
  );
  await settle(el);
  $(el, "[data-test=save]")!.click();
  await vi.waitFor(() => expect(navigator.credentials.create).toHaveBeenCalledOnce());
  await settle(el);
  expect(modalOpen(el)).toBe(true);
  expect((await formMessageOf($(el, "wt-form-actions")!))?.textContent?.trim() ?? "").toBe("");
});

async function withFreshSignIn() {
  let fresh = false;
  const api = stubApi();
  const { el: dialog } = await mountWidget<FreshSignInDialog>("dashboard-fresh-sign-in-dialog", {
    api: {
      getProfile: async () => PROFILE,
      freshSignInPasskeyOptions: vi.fn(),
      confirmFreshSignIn: vi.fn(async () => {
        fresh = true;
      }),
      liveData: new LiveData(),
    } as unknown as DashboardApi,
  });
  const gate = createFreshSignInGate({
    sessionGeneration: () => 1,
    prompt: (signal, context) => dialog.show(signal, context),
  });
  const request = vi.fn(async () => {
    if (!fresh) throw { code: "management_session.proof_required" };
    return CHALLENGE;
  });
  const wrapped = gate.wrap(request as never);
  api.passkeyRegisterOptions.mockImplementation(((body: unknown) =>
    wrapped("/management-api/passkey/register/options", "POST", body)) as never);
  const { el } = await mount(api);
  const signIn = () => dialog.shadowRoot!.querySelector("dashboard-fresh-sign-in");
  return { el, api, dialog, request, signIn };
}

it("asks for the fresh sign-in when the server wants one, then opens the passkey prompt on the same press", async () => {
  const { el, api, dialog, request, signIn } = await withFreshSignIn();
  await press(el);
  await vi.waitFor(() => expect(signIn()?.shadowRoot?.querySelector("wt-input")).toBeTruthy());
  expect(modalOpen(el)).toBe(false);
  expect(add(el).loading).toBe(true);
  expect(activeAtPrompt).toEqual([]);
  await userEvent.fill(
    page.elementLocator(
      signIn()!.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!,
    ),
    "correct password",
  );
  const confirm = dialog.shadowRoot!.querySelector<WtButton>("[data-test=confirm-proof]")!;
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  await userEvent.click(page.elementLocator(confirm.shadowRoot!.querySelector("button")!));
  await vi.waitFor(() => expect(api.passkeyRegisterVerify).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledTimes(2);
  expect(activeAtPrompt).toEqual([true]);
  await vi.waitFor(() => expect(add(el).loading).toBe(false));
  expect(refusal(el)).toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(add(el));
});

it("says why nothing was added when the fresh sign-in is cancelled", async () => {
  const { el, dialog, signIn } = await withFreshSignIn();
  await press(el);
  await vi.waitFor(() => expect(signIn()?.shadowRoot?.querySelector("wt-input")).toBeTruthy());
  dialog.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await vi.waitFor(() =>
    expect(refusal(el)?.textContent?.trim()).toBe(codeMessage("management_session.proof_required")),
  );
  expect(navigator.credentials.create).not.toHaveBeenCalled();
  expect(add(el).loading).toBe(false);
});

it("never warns that a sign-in check may come", async () => {
  expect("profile.confirm_identity" in en).toBe(false);
  expect("profile.confirm_identity" in es).toBe(false);
  const { el } = await mount();
  $(el, "[data-test=change-password]")!.click();
  await settle(el);
  expect(modalOpen(el)).toBe(true);
  expect($(el, "wt-modal .hint")).toBeNull();
});

it("never opens the prompt for a profile closed before the options arrived", async () => {
  let answer!: (value: typeof CHALLENGE) => void;
  const api = stubApi({
    passkeyRegisterOptions: vi.fn(() => new Promise((resolve) => (answer = resolve))),
  });
  const { el } = await mount(api);
  await press(el);
  el.remove();
  answer(CHALLENGE);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(navigator.credentials.create).not.toHaveBeenCalled();
  expect(api.passkeyRegisterVerify).not.toHaveBeenCalled();
});

it("sends no answer to the prompt for a profile closed while it was open", async () => {
  let answer!: (value: PublicKeyCredential) => void;
  vi.mocked(navigator.credentials.create).mockImplementationOnce(
    () => new Promise((resolve) => (answer = resolve)),
  );
  const api = stubApi();
  const { el } = await mount(api);
  await press(el);
  await vi.waitFor(() => expect(navigator.credentials.create).toHaveBeenCalledOnce());
  el.remove();
  answer(CREDENTIAL);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(api.passkeyRegisterVerify).not.toHaveBeenCalled();
});

it("keeps a second press working when the first one, from before the profile closed, finishes", async () => {
  const answers: ((value: { credentialId: string }) => void)[] = [];
  const api = stubApi({
    passkeyRegisterVerify: vi.fn(() => new Promise((resolve) => answers.push(resolve))),
  });
  const { el, host } = await mount(api);
  await press(el);
  await vi.waitFor(() => expect(answers).toHaveLength(1));
  el.remove();
  host.append(el);
  await settle(el);
  await press(el);
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  answers[0]!({ credentialId: "first" });
  await settle(el);
  expect(add(el).loading).toBe(true);
  expect($(el, "[role=status]")).toBeNull();
  answers[1]!({ credentialId: "second" });
  await vi.waitFor(() => expect($(el, "[role=status]")).not.toBeNull());
  expect(add(el).loading).toBe(false);
});

it("drops a refusal when the profile closes", async () => {
  const { el, host } = await mount(
    stubApi({ passkeyRegisterOptions: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
  );
  await press(el);
  await vi.waitFor(() => expect(refusal(el)).not.toBeNull());
  el.remove();
  host.append(el);
  await settle(el);
  expect(refusal(el)).toBeNull();
});

it("shows nothing of a refusal that arrives after the profile closed and reopened", async () => {
  let refuse!: (error: unknown) => void;
  const { el, host } = await mount(
    stubApi({
      passkeyRegisterOptions: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    }),
  );
  await press(el);
  el.remove();
  host.append(el);
  await settle(el);
  expect(add(el).loading).toBe(false);
  refuse({ code: "connection.failed" });
  await settle(el);
  expect(refusal(el)).toBeNull();
});
