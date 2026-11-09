import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi, OwnProfile } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { FreshSignIn } from "./fresh-sign-in.js";
import type { FreshSignInDialog } from "./fresh-sign-in-dialog.js";
import "./fresh-sign-in-dialog.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());
const profile: OwnProfile = {
  displayName: "Marta",
  firstNames: "Marta",
  lastNames: "",
  telephone: null,
  email: "marta@example.test",
  pendingEmail: null,
  locale: null,
  hasPassword: true,
  hasTotp: false,
  hasGoogle: false,
  passkeys: [],
};
async function open() {
  const api = {
    getProfile: vi.fn(async () => profile),
    recoveryPackPasskeyOptions: vi.fn(),
    confirmFreshSignIn: vi.fn(async () => {}),
  };
  const { el } = await mountWidget<FreshSignInDialog>("dashboard-fresh-sign-in-dialog", {
    api: api as unknown as DashboardApi,
  });
  const stop = new AbortController();
  const result = el.show(stop.signal);
  await el.updateComplete;
  const signIn = el.shadowRoot!.querySelector<FreshSignIn>("dashboard-fresh-sign-in")!;
  expect(signIn).not.toBeNull();
  await vi.waitFor(() => expect(signIn.ways).not.toBeNull());
  return { el, api, stop, result, signIn };
}
it("marks an empty password, then confirms and clears the typed password", async () => {
  const { el, api, result, signIn } = await open();
  const submit = () =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-proof]")!.click();
  submit();
  await vi.waitFor(() => expect(signIn.invalid).toBe(true));
  expect(api.confirmFreshSignIn).not.toHaveBeenCalled();
  const nativePassword = signIn
    .shadowRoot!.querySelector("wt-input")!
    .shadowRoot!.querySelector("input")!;
  await expect.poll(() => nativePassword.matches(":focus")).toBe(true);
  signIn
    .shadowRoot!.querySelector("wt-input")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "correct password" } }));
  await signIn.updateComplete;
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm-proof]")!
        .disabled,
    ).toBe(false),
  );
  submit();
  expect(await result).toBe(true);
  expect(api.confirmFreshSignIn).toHaveBeenCalledWith({
    method: "password",
    password: "correct password",
  });
  expect(signIn.typed).toBe(false);
});
it("abort closes a typed prompt and ignores a late success", async () => {
  const { el, api, result, stop, signIn } = await open();
  let finish!: () => void;
  api.confirmFreshSignIn.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  signIn
    .shadowRoot!.querySelector("wt-input")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "correct password" } }));
  await signIn.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-proof]")!.click();
  await vi.waitFor(() => expect(api.confirmFreshSignIn).toHaveBeenCalledTimes(1));
  stop.abort();
  expect(await result).toBe(false);
  finish();
  expect(signIn.typed).toBe(false);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-fresh-sign-in")).toBeNull();
});

it("keeps a wrong answer beside the password and Cancel clears it without retrying", async () => {
  const { el, api, result, signIn } = await open();
  api.confirmFreshSignIn.mockRejectedValue({ code: "password.invalid", status: 401 });
  const field = signIn.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=current-password]",
  )!;
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "wrong password" } }));
  await signIn.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-proof]")!.click();
  await expect.poll(() => field.error).not.toBe("");
  await expect
    .poll(
      () =>
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=confirm-proof]",
        )!.disabled,
    )
    .toBe(false);
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>("wt-dialog")!.requestClose(
    "cancel",
  );
  expect(await result).toBe(false);
  expect(api.confirmFreshSignIn).toHaveBeenCalledTimes(1);
  expect(signIn.typed).toBe(false);
});
it("the passkey button confirms through the shared endpoint using the real browser library", async () => {
  vi.spyOn(navigator.credentials, "get").mockResolvedValue({
    id: "cred-mine",
    rawId: new Uint8Array([1]).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: new Uint8Array([2]).buffer,
      authenticatorData: new Uint8Array([3]).buffer,
      signature: new Uint8Array([4]).buffer,
      userHandle: null,
    },
    getClientExtensionResults: () => ({}),
  } as unknown as PublicKeyCredential);
  const { api, result, signIn } = await open();
  api.recoveryPackPasskeyOptions.mockResolvedValue({
    challengeHandle: "h1",
    options: { challenge: "AQID" },
  });
  signIn.shadowRoot!.querySelector<HTMLElement>("[data-test=use-passkey]")!.click();
  expect(await result).toBe(true);
  expect(api.confirmFreshSignIn).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "passkey",
      challengeHandle: "h1",
      response: expect.objectContaining({ id: "cred-mine" }),
    }),
  );
});
