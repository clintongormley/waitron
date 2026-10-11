import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LeaveController, NavigationGuard } from "@waitron/ui";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./login-screen.js";

class LoginLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  navigated: string[] = [];
  override render() {
    return html`<dashboard-login-screen
        .api=${this.api}
        .navigate=${(url: string) => this.navigated.push(url)}
      ></dashboard-login-screen>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("login-leave-test-app", LoginLeaveApp);
let guard: NavigationGuard | undefined;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = async () => false;
    },
  );
});
afterEach(() => {
  guard?.dispose();
  guard = undefined;
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en-GB");
});
type Screen = HTMLElementTagNameMap["dashboard-login-screen"];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(
  path = "/manage/",
  overrides: Partial<DashboardApi> = {},
  theme: "light" | "dark" = "light",
) {
  history.replaceState({ external: "retained" }, "", path);
  const logins: unknown[] = [];
  const completions: unknown[][] = [];
  const api = {
    getGoogleConfig: async () => ({ configured: true }),
    inspectAccountAction: async (_token: string, purpose: string) => ({
      email: "new@example.test",
      purpose,
    }),
    login: async (body: unknown) => {
      logins.push(body);
      return { personId: "p1", offerPasskey: false };
    },
    completeAccountAction: async (...args: unknown[]) => {
      completions.push(args);
      return { personId: "p1", authenticated: false };
    },
    requestPasswordReset: async () => undefined,
    passkeyOfferSeen: async () => undefined,
    beginGoogleLogin: async () => ({ authorizationUrl: "https://accounts.example.test/login" }),
    ...overrides,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<LoginLeaveApp>("login-leave-test-app", { api }, theme);
  const screen = app.shadowRoot!.querySelector("dashboard-login-screen")!;
  guard = new NavigationGuard(window, {
    isDirty: () => app.leave.coordinator.isDirty(),
    request: (proceed, signal) =>
      app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
  });
  await expect
    .poll(() =>
      screen.shadowRoot!.querySelector(
        path.includes("token=") ? "[name=new-password]" : "[name=email], [name=password]",
      ),
    )
    .not.toBeNull();
  await screen.updateComplete;
  return { app, screen, logins, completions };
}
function control(screen: Screen, name: string) {
  return screen.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`)!;
}
function value(screen: Screen, name: string) {
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name=${name}]`,
  )!.value;
}
async function change(screen: Screen, name: string, value: string) {
  screen
    .shadowRoot!.querySelector(`wt-input[name=${name}]`)!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await screen.updateComplete;
}
async function click(screen: Screen, name: string) {
  control(screen, name).click();
  await screen.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function asked(app: LoginLeaveApp) {
  return app.shadowRoot!.querySelector("wt-unsaved-changes")!.open;
}
async function settle(screen: Screen) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
}
async function password(screen: Screen) {
  await change(screen, "email", "ada@example.test");
  await click(screen, "continue");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=password]")).not.toBeNull();
}

it("typed email never installs the unload warning nor holds navigation", async () => {
  const { app, screen } = await mount();
  expect(unload()).toBe(false);
  await change(screen, "email", "draft@example.test");
  expect(unload()).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(await guard!.write("/manage/other")).toBe("proceeded");
  expect(asked(app)).toBe(false);
});
it("email navigation proceeds at once without touching the typed email and preserves history state", async () => {
  const { app, screen } = await mount();
  await change(screen, "email", "draft@example.test");
  expect(await guard!.write("/manage/other")).toBe("proceeded");
  expect(asked(app)).toBe(false);
  expect(location.pathname).toBe("/manage/other");
  expect(value(screen, "email")).toBe("draft@example.test");
  expect(history.state).toMatchObject({ external: "retained", __wtNavigation: expect.any(Object) });
});
it("Change account with a typed password returns to an empty email step without asking", async () => {
  const { app, screen } = await mount();
  await password(screen);
  await change(screen, "password", "synthetic password");
  expect(unload()).toBe(false);
  await click(screen, "change-account");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
  expect(asked(app)).toBe(false);
  expect(value(screen, "email")).toBe("");
  expect(unload()).toBe(false);
});
it("switching to Google with a typed password redirects without asking", async () => {
  const { app, screen } = await mount();
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "google-login");
  await expect.poll(() => app.navigated).toEqual(["https://accounts.example.test/login"]);
  expect(asked(app)).toBe(false);
  expect(value(screen, "password")).toBe("");
  expect(unload()).toBe(false);
});
it("a failed login keeps the unchanged request body and Change account still leaves without asking", async () => {
  const bodies: unknown[] = [];
  const { app, screen } = await mount("/manage/", {
    login: async (body) => {
      bodies.push(body);
      throw { code: "password.invalid" };
    },
  });
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "submit");
  await expect.poll(() => screen.shadowRoot!.textContent).toContain(t("login.failed"));
  expect(bodies).toEqual([{ email: "ada@example.test", password: "synthetic password" }]);
  expect(unload()).toBe(false);
  await click(screen, "change-account");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
  expect(asked(app)).toBe(false);
});
it("successful login reports the authenticated result with no unload warning", async () => {
  const { screen, logins } = await mount();
  await password(screen);
  await change(screen, "password", "synthetic password");
  const dirtiness: boolean[] = [];
  screen.addEventListener("logged-in", () => dirtiness.push(unload()));
  await click(screen, "submit");
  await expect.poll(() => dirtiness).toEqual([false]);
  expect(logins).toEqual([{ email: "ada@example.test", password: "synthetic password" }]);
});
it.each(["invitation", "password_reset"])(
  "%s Cancel with typed credentials removes only the action without asking",
  async (purpose) => {
    const { app, screen } = await mount(`/manage/account?token=synthetic&purpose=${purpose}`);
    await change(screen, "new-password", "synthetic new password");
    if (purpose === "invitation") await change(screen, "new-pin", "4321");
    expect(unload()).toBe(false);
    await click(screen, "cancel-account-action");
    await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
    expect(asked(app)).toBe(false);
    expect(location.pathname).toBe("/manage/");
    expect(location.search).toBe("");
    expect(history.state).toMatchObject({ external: "retained" });
    expect(unload()).toBe(false);
  },
);
it("accepted account credentials leave the action URL with no question or warning", async () => {
  const { app, screen, completions } = await mount(
    "/manage/account?token=synthetic&purpose=invitation",
  );
  await change(screen, "new-password", "synthetic new password");
  await change(screen, "new-pin", "4321");
  await click(screen, "complete-account");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
  expect(completions).toEqual([["synthetic", "invitation", "synthetic new password", "4321"]]);
  expect(asked(app)).toBe(false);
  expect(unload()).toBe(false);
});
it("Back from an entered factor and changing its mode act at once and clear its code", async () => {
  const { app, screen } = await mount("/manage/", {
    login: async () => {
      throw { code: "totp.required" };
    },
  });
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "submit");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=one-time-code]")).not.toBeNull();
  await change(screen, "one-time-code", "123456");
  expect(unload()).toBe(false);
  await click(screen, "switch-factor");
  await settle(screen);
  expect(asked(app)).toBe(false);
  expect(value(screen, "one-time-code")).toBe("");
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "wt-input[name=one-time-code]",
    )!.label,
  ).toBe(t("login.recovery_code"));
  await change(screen, "one-time-code", "recovery-synthetic");
  await click(screen, "back-to-password");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=password]")).not.toBeNull();
  expect(asked(app)).toBe(false);
  expect(value(screen, "password")).toBe("synthetic password");
  expect(unload()).toBe(false);
});
it("disconnect clears typed secrets", async () => {
  const { app, screen } = await mount();
  await password(screen);
  await change(screen, "password", "synthetic password");
  screen.remove();
  await screen.updateComplete;
  expect(value(screen, "password")).toBe("");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(asked(app)).toBe(false);
  expect(unload()).toBe(false);
});

it.each(["name", "code"])(
  "optional passkey setup with an edited %s signs in on Skip without asking",
  async (field) => {
    const { app, screen } = await mount("/manage/", {
      login: async () => ({ personId: "p1", offerPasskey: true }),
      passkeyRegisterOptions: async () => {
        throw { code: "totp.invalid" };
      },
    });
    await password(screen);
    await change(screen, "password", "synthetic password");
    await click(screen, "submit");
    await expect.poll(() => screen.shadowRoot!.querySelector("[name=passkey-name]")).not.toBeNull();
    if (field === "code") {
      await click(screen, "setup-passkey");
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[name=one-time-code]"))
        .not.toBeNull();
      await change(screen, "one-time-code", "123456");
    } else await change(screen, "passkey-name", "Synthetic laptop");
    expect(unload()).toBe(false);
    const results: boolean[] = [];
    screen.addEventListener("logged-in", () => results.push(unload()));
    await click(screen, "skip-passkey");
    await expect.poll(() => results).toEqual([false]);
    expect(asked(app)).toBe(false);
  },
);
it("switching to a passkey opens its native prompt at once without asking", async () => {
  let prompts = 0;
  vi.spyOn(navigator.credentials, "get").mockImplementation(async () => {
    prompts++;
    throw new DOMException("Synthetic cancellation", "NotAllowedError");
  });
  const { app, screen } = await mount("/manage/", {
    passkeyAuthOptions: async () => ({
      challengeHandle: "synthetic",
      options: { challenge: "AQID" },
    }),
  });
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "passkey-login");
  await expect.poll(() => prompts).toBe(1);
  expect(asked(app)).toBe(false);
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=password]")).not.toBeNull();
  expect(value(screen, "password")).toBe("");
  expect(unload()).toBe(false);
});
it("an accepted account write moves on with the submitted values even after later input", async () => {
  const pending = deferred<{ personId: string; authenticated: boolean }>();
  const bodies: unknown[][] = [];
  const { app, screen } = await mount("/manage/account?token=synthetic&purpose=invitation", {
    completeAccountAction: async (...args) => {
      bodies.push(args);
      return pending.promise;
    },
  });
  await change(screen, "new-password", "submitted synthetic password");
  await change(screen, "new-pin", "4321");
  await click(screen, "complete-account");
  await change(screen, "new-password", "newer synthetic password");
  pending.resolve({ personId: "p1", authenticated: false });
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
  expect(bodies).toEqual([["synthetic", "invitation", "submitted synthetic password", "4321"]]);
  expect(location.search).toBe("");
  expect(asked(app)).toBe(false);
  expect(unload()).toBe(false);
});
it.each(["resolve", "reject"])(
  "a departed login %s cannot authenticate or replace a reconnected draft",
  async (settlement) => {
    const pending = deferred<{ personId: string; offerPasskey: boolean }>();
    const { app, screen } = await mount("/manage/", { login: async () => pending.promise });
    await password(screen);
    await change(screen, "password", "departed synthetic password");
    const results: unknown[] = [];
    screen.addEventListener("logged-in", (event) => results.push((event as CustomEvent).detail));
    await click(screen, "submit");
    const parent = screen.parentNode!;
    screen.remove();
    parent.appendChild(screen);
    await screen.updateComplete;
    await change(screen, "password", "reconnected synthetic password");
    if (settlement === "resolve") pending.resolve({ personId: "p1", offerPasskey: false });
    else pending.reject({ code: "password.invalid" });
    await settle(screen);
    expect(results).toEqual([]);
    expect(value(screen, "password")).toBe("reconnected synthetic password");
    expect(screen.shadowRoot!.textContent).not.toContain(t("login.failed"));
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(unload()).toBe(false);
  },
);
it("a cancelled account inspection never reopens or changes the later login form", async () => {
  const inspection = deferred<{ email: string; purpose: "invitation" }>();
  history.replaceState(null, "", "/manage/account?token=synthetic&purpose=invitation");
  const { el: app } = await mountWidget<LoginLeaveApp>("login-leave-test-app", {
    api: {
      getGoogleConfig: async () => ({ configured: false }),
      inspectAccountAction: async () => inspection.promise,
    } as unknown as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-login-screen")!;
  await screen.updateComplete;
  await click(screen, "cancel-account-action");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
  await change(screen, "email", "later@example.test");
  inspection.resolve({ email: "departed@example.test", purpose: "invitation" });
  await settle(screen);
  expect(value(screen, "email")).toBe("later@example.test");
  expect(screen.shadowRoot!.querySelector("[name=new-password]")).toBeNull();
  expect(unload()).toBe(false);
});

it("requesting a reset with a typed password changes to the read-only notice without asking", async () => {
  const resets: string[] = [];
  const { app, screen } = await mount("/manage/", {
    requestPasswordReset: async (email) => {
      resets.push(email);
    },
  });
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "reset-by-email");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=reset-sent]"))
    .not.toBeNull();
  expect(asked(app)).toBe(false);
  expect(resets).toEqual(["ada@example.test"]);
  expect(unload()).toBe(false);
});
it("Google's delayed reply redirects without asking about input entered while it ran", async () => {
  const reply = deferred<{ authorizationUrl: string }>();
  const { app, screen } = await mount("/manage/", { beginGoogleLogin: async () => reply.promise });
  await password(screen);
  await click(screen, "google-login");
  await change(screen, "password", "newer synthetic password");
  reply.resolve({ authorizationUrl: "https://accounts.example.test/login" });
  await expect.poll(() => app.navigated).toEqual(["https://accounts.example.test/login"]);
  expect(asked(app)).toBe(false);
  expect(value(screen, "password")).toBe("");
  expect(unload()).toBe(false);
});
it("switching to recovery mode clears only the code and sends the new recovery request unchanged", async () => {
  const bodies: unknown[] = [];
  const { app, screen } = await mount("/manage/", {
    login: async (body) => {
      bodies.push(body);
      if (bodies.length === 1) throw { code: "totp.required" };
      return { personId: "p1", offerPasskey: false };
    },
  });
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "submit");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=one-time-code]")).not.toBeNull();
  await change(screen, "one-time-code", "123456");
  await click(screen, "switch-factor");
  await settle(screen);
  expect(asked(app)).toBe(false);
  expect(value(screen, "one-time-code")).toBe("");
  expect(unload()).toBe(false);
  await change(screen, "one-time-code", "recovery-synthetic");
  await click(screen, "submit-factor");
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies).toEqual([
    { email: "ada@example.test", password: "synthetic password" },
    {
      email: "ada@example.test",
      password: "synthetic password",
      recoveryCode: "recovery-synthetic",
    },
  ]);
  expect(unload()).toBe(false);
});
it("a saved email shows and a typed password never installs unload handling", async () => {
  localStorage.setItem(
    "waitron-login-preference",
    JSON.stringify({ email: "remembered@example.test", method: "password" }),
  );
  // mountWidget does not reset localStorage; only this file's beforeEach does.
  const { screen } = await mount();
  expect(value(screen, "chosen-email")).toBe("remembered@example.test");
  expect(unload()).toBe(false);
  await change(screen, "password", "synthetic password");
  expect(unload()).toBe(false);
});

function registrationApi(seen: Promise<void>, verifies: unknown[]): Partial<DashboardApi> {
  vi.spyOn(navigator.credentials, "create").mockResolvedValue({
    id: "synthetic-key",
    rawId: new Uint8Array([1]).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: new Uint8Array([2]).buffer,
      attestationObject: new Uint8Array([3]).buffer,
      getTransports: () => ["internal"],
    },
    getClientExtensionResults: () => ({}),
  } as unknown as PublicKeyCredential);
  return {
    login: async () => ({ personId: "p1", offerPasskey: true }),
    passkeyRegisterOptions: async () => ({
      challengeHandle: "synthetic",
      options: {
        challenge: "AQID",
        rp: { name: "Waitron", id: "localhost" },
        user: { id: "BAUG", name: "ada@example.test", displayName: "Ada" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      },
    }),
    passkeyRegisterVerify: async (body) => {
      verifies.push(body);
      return { credentialId: "synthetic-key" };
    },
    passkeyOfferSeen: async () => seen,
  } as Partial<DashboardApi>;
}
it("a saved passkey name is clean before the offer bookkeeping answers", async () => {
  const seen = deferred<void>();
  const verifies: unknown[] = [];
  const { screen } = await mount("/manage/", registrationApi(seen.promise, verifies));
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "submit");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=passkey-name]")).not.toBeNull();
  await change(screen, "passkey-name", "Synthetic laptop");
  await click(screen, "setup-passkey");
  await expect.poll(() => verifies.length).toBe(1);
  expect(verifies).toEqual([
    expect.objectContaining({ name: "Synthetic laptop", challengeHandle: "synthetic" }),
  ]);
  expect(unload()).toBe(false);
  seen.resolve();
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=password]")).not.toBeNull();
});

for (const locale of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`native Change account leaves a typed password without asking, ${locale}, ${theme}, ${width}`, async () => {
        setLocale(locale);
        await page.viewport(width, 900);
        const { app, screen } = await mount("/manage/", {}, theme);
        await password(screen);
        const input =
          screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
            "wt-input[name=password]",
          )!;
        await input.updateComplete;
        const native = input.shadowRoot!.querySelector("input")!;
        await userEvent.fill(native, "synthetic password");
        expect(unload()).toBe(false);
        const cancel = control(screen, "change-account").shadowRoot!.querySelector("button")!;
        await userEvent.click(cancel);
        await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
        expect(asked(app)).toBe(false);
        expect(value(screen, "email")).toBe("");
        await expectNoA11yViolations(screen);
        expect(unload()).toBe(false);
      });

it("a passkey verified with its submitted name signs in even after the name was changed", async () => {
  const verify = deferred<{ credentialId: string }>();
  const requests: unknown[] = [];
  const { app, screen } = await mount("/manage/", {
    ...registrationApi(Promise.resolve(), []),
    passkeyRegisterVerify: async (body) => {
      requests.push(body);
      return verify.promise;
    },
  });
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "submit");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=passkey-name]")).not.toBeNull();
  await change(screen, "passkey-name", "Submitted laptop");
  await click(screen, "setup-passkey");
  await expect.poll(() => requests.length).toBe(1);
  await change(screen, "passkey-name", "Newer laptop");
  const results: boolean[] = [];
  screen.addEventListener("logged-in", () => results.push(unload()));
  verify.resolve({ credentialId: "synthetic-key" });
  await expect.poll(() => results).toEqual([false]);
  expect(requests).toEqual([expect.objectContaining({ name: "Submitted laptop" })]);
  expect(asked(app)).toBe(false);
});
it("a successful autofill passkey sends the authenticated event with no unload warning", async () => {
  const credential = deferred<Credential | null>();
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = async () => true;
    },
  );
  vi.spyOn(navigator.credentials, "get").mockImplementation(async () => credential.promise);
  const { screen } = await mount("/manage/", {
    passkeyAuthOptions: async () => ({
      challengeHandle: "synthetic",
      options: { challenge: "AQID" },
    }),
    passkeyAuthVerify: async () => ({ personId: "p1" }),
  });
  await change(screen, "email", "draft@example.test");
  const dirtiness: boolean[] = [];
  screen.addEventListener("logged-in", () => dirtiness.push(unload()));
  credential.resolve({
    id: "synthetic-key",
    rawId: new Uint8Array([1]).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: new Uint8Array([2]).buffer,
      authenticatorData: new Uint8Array([3]).buffer,
      signature: new Uint8Array([4]).buffer,
      userHandle: new Uint8Array([5]).buffer,
    },
    getClientExtensionResults: () => ({}),
  } as unknown as Credential);
  await expect.poll(() => dirtiness).toEqual([false]);
});

it.each(["email", "password", "new-password", "new-pin", "one-time-code", "passkey-name"])(
  "%s input never installs the unload warning nor holds navigation",
  async (name) => {
    const action = name.startsWith("new-");
    const { app, screen } = await mount(
      action ? "/manage/account?token=synthetic&purpose=invitation" : "/manage/",
      {
        login: async () => {
          if (name === "one-time-code") throw { code: "totp.required" };
          return { personId: "p1", offerPasskey: true };
        },
      },
    );
    if (!action && name !== "email") {
      await password(screen);
      if (name === "one-time-code" || name === "passkey-name") {
        await change(screen, "password", "synthetic password");
        await click(screen, "submit");
        await expect.poll(() => screen.shadowRoot!.querySelector(`[name=${name}]`)).not.toBeNull();
        await screen.updateComplete;
      }
    }
    expect(unload()).toBe(false);
    const input = screen.shadowRoot!.querySelector(`[name=${name}]`)!;
    input.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: name === "email" ? "draft@example.test" : "synthetic draft" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(unload()).toBe(false);
    expect(await guard!.write("/manage/other")).toBe("proceeded");
    expect(asked(app)).toBe(false);
    expect(location.pathname).toBe("/manage/other");
  },
);
