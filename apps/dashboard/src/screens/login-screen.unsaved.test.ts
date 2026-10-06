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
async function choose(app: LoginLeaveApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  await userEvent.click(
    warning
      .shadowRoot!.querySelector(`[data-choice=${decision}]`)!
      .shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => warning.open).toBe(false);
}
async function password(screen: Screen) {
  await change(screen, "email", "ada@example.test");
  await click(screen, "continue");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=password]")).not.toBeNull();
}

it("clean email and a reverted value leave without a warning", async () => {
  const { app, screen } = await mount();
  expect(unload()).toBe(false);
  await change(screen, "email", "draft@example.test");
  expect(unload()).toBe(true);
  await change(screen, "email", "");
  expect(unload()).toBe(false);
  expect(await guard!.write("/manage/other")).toBe("proceeded");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("email navigation keeps the submitted value until Discard and preserves history state", async () => {
  const { app, screen } = await mount();
  await change(screen, "email", "draft@example.test");
  const kept = guard!.write("/manage/other");
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(location.pathname).toBe("/manage/");
  expect(value(screen, "email")).toBe("draft@example.test");
  const discarded = guard!.write("/manage/other");
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  expect(value(screen, "email")).toBe("");
  expect(history.state).toMatchObject({ external: "retained", __wtNavigation: expect.any(Object) });
});
it("Continue accepts the email without prompting; Change account protects only the new password", async () => {
  const { app, screen } = await mount();
  await password(screen);
  expect(unload()).toBe(false);
  await change(screen, "password", "synthetic password");
  await click(screen, "change-account");
  await choose(app, "keep");
  expect(value(screen, "password")).toBe("synthetic password");
  expect(value(screen, "chosen-email")).toBe("ada@example.test");
  await click(screen, "change-account");
  await choose(app, "discard");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
  expect(value(screen, "email")).toBe("");
  expect(unload()).toBe(false);
});
it("switching to Google waits for Discard before redirecting", async () => {
  const { app, screen } = await mount();
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "google-login");
  await choose(app, "keep");
  expect(app.navigated).toEqual([]);
  expect(value(screen, "password")).toBe("synthetic password");
  await click(screen, "google-login");
  await choose(app, "discard");
  await expect.poll(() => app.navigated).toEqual(["https://accounts.example.test/login"]);
  expect(unload()).toBe(false);
});
it("a failed login stays dirty and keeps the unchanged request body", async () => {
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
  expect(unload()).toBe(true);
  await click(screen, "change-account");
  await choose(app, "keep");
  expect(value(screen, "password")).toBe("synthetic password");
});
it("successful login clears the warning before reporting the authenticated result", async () => {
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
  "%s credentials protect Cancel; Keep retains the URL and Discard removes only the action",
  async (purpose) => {
    const { app, screen } = await mount(`/manage/account?token=synthetic&purpose=${purpose}`);
    await change(screen, "new-password", "synthetic new password");
    if (purpose === "invitation") await change(screen, "new-pin", "4321");
    await click(screen, "cancel-account-action");
    await choose(app, "keep");
    expect(location.search).toContain("token=synthetic");
    expect(value(screen, "new-password")).toBe("synthetic new password");
    if (purpose === "invitation") expect(value(screen, "new-pin")).toBe("4321");
    await click(screen, "cancel-account-action");
    await choose(app, "discard");
    await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
    expect(location.pathname).toBe("/manage/");
    expect(location.search).toBe("");
    expect(unload()).toBe(false);
  },
);
it("accepted account credentials are clean before leaving the action URL", async () => {
  const { app, screen, completions } = await mount(
    "/manage/account?token=synthetic&purpose=invitation",
  );
  await change(screen, "new-password", "synthetic new password");
  await change(screen, "new-pin", "4321");
  await click(screen, "complete-account");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
  expect(completions).toEqual([["synthetic", "invitation", "synthetic new password", "4321"]]);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});
it("Back from an entered factor and changing its mode protect its code", async () => {
  const { app, screen } = await mount("/manage/", {
    login: async () => {
      throw { code: "totp.required" };
    },
  });
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "submit");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=one-time-code]")).not.toBeNull();
  expect(unload()).toBe(false);
  await change(screen, "one-time-code", "123456");
  await click(screen, "switch-factor");
  await choose(app, "keep");
  expect(value(screen, "one-time-code")).toBe("123456");
  await click(screen, "back-to-password");
  await choose(app, "discard");
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=password]")).not.toBeNull();
  expect(value(screen, "password")).toBe("synthetic password");
  expect(unload()).toBe(false);
});
it("disconnect invalidates an outstanding answer and clears typed secrets", async () => {
  const { app, screen } = await mount();
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "change-account");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  screen.remove();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  await screen.updateComplete;
  expect(value(screen, "password")).toBe("");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(unload()).toBe(false);
});

it.each(["name", "code"])(
  "optional passkey setup protects its edited %s before Skip",
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
    expect(unload()).toBe(false);
    if (field === "code") {
      await click(screen, "setup-passkey");
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[name=one-time-code]"))
        .not.toBeNull();
      expect(unload()).toBe(false);
      await change(screen, "one-time-code", "123456");
    } else await change(screen, "passkey-name", "Synthetic laptop");
    expect(unload()).toBe(true);
    const results: boolean[] = [];
    screen.addEventListener("logged-in", () => results.push(unload()));
    await click(screen, "skip-passkey");
    await choose(app, "keep");
    expect(value(screen, field === "code" ? "one-time-code" : "passkey-name")).toBe(
      field === "code" ? "123456" : "Synthetic laptop",
    );
    expect(results).toEqual([]);
    await click(screen, "skip-passkey");
    await choose(app, "discard");
    await expect.poll(() => results).toEqual([false]);
  },
);
it("switching to a passkey does not open its native prompt until Discard", async () => {
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
  await choose(app, "keep");
  expect(prompts).toBe(0);
  expect(value(screen, "password")).toBe("synthetic password");
  await click(screen, "passkey-login");
  await choose(app, "discard");
  await expect.poll(() => prompts).toBe(1);
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=password]")).not.toBeNull();
  expect(value(screen, "password")).toBe("");
  expect(unload()).toBe(false);
});
it("an accepted account write commits its submitted snapshot, leaving later input dirty", async () => {
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
  await expect.poll(() => bodies.length).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(value(screen, "new-password")).toBe("newer synthetic password");
  expect(unload()).toBe(true);
  await click(screen, "cancel-account-action");
  await choose(app, "keep");
  expect(bodies).toEqual([["synthetic", "invitation", "submitted synthetic password", "4321"]]);
});
it.each(["resolve", "reject"])(
  "a departed login %s cannot authenticate or replace a reconnected draft",
  async (settle) => {
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
    if (settle === "resolve") pending.resolve({ personId: "p1", offerPasskey: false });
    else pending.reject({ code: "password.invalid" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(results).toEqual([]);
    expect(value(screen, "password")).toBe("reconnected synthetic password");
    expect(screen.shadowRoot!.textContent).not.toContain(t("login.failed"));
    expect(app.leave.coordinator.isDirty()).toBe(true);
    expect(unload()).toBe(true);
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(value(screen, "email")).toBe("later@example.test");
  expect(screen.shadowRoot!.querySelector("[name=new-password]")).toBeNull();
  expect(unload()).toBe(true);
});

it("requesting a reset protects a typed password before changing to the read-only notice", async () => {
  const resets: string[] = [];
  const { app, screen } = await mount("/manage/", {
    requestPasswordReset: async (email) => {
      resets.push(email);
    },
  });
  await password(screen);
  await change(screen, "password", "synthetic password");
  await click(screen, "reset-by-email");
  await choose(app, "keep");
  expect(resets).toEqual([]);
  expect(value(screen, "password")).toBe("synthetic password");
  await click(screen, "reset-by-email");
  await choose(app, "discard");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=reset-sent]"))
    .not.toBeNull();
  expect(resets).toEqual(["ada@example.test"]);
  expect(unload()).toBe(false);
});
it("Google's delayed reply protects input entered while the authorization request ran", async () => {
  const reply = deferred<{ authorizationUrl: string }>();
  const { app, screen } = await mount("/manage/", { beginGoogleLogin: async () => reply.promise });
  await password(screen);
  await click(screen, "google-login");
  await change(screen, "password", "newer synthetic password");
  reply.resolve({ authorizationUrl: "https://accounts.example.test/login" });
  await choose(app, "keep");
  expect(app.navigated).toEqual([]);
  expect(value(screen, "password")).toBe("newer synthetic password");
  expect(unload()).toBe(true);
});
it("recovery-mode Discard clears only the code and sends the new recovery request unchanged", async () => {
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
  await choose(app, "discard");
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
it("a clean saved email is the initial baseline and password reverts remove unload handling", async () => {
  localStorage.setItem(
    "waitron-login-preference",
    JSON.stringify({ email: "remembered@example.test", method: "password" }),
  );
  // mountWidget does not reset localStorage; only this file's beforeEach does.
  const { screen } = await mount();
  expect(value(screen, "chosen-email")).toBe("remembered@example.test");
  expect(unload()).toBe(false);
  await change(screen, "password", "synthetic password");
  expect(unload()).toBe(true);
  await change(screen, "password", "");
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
      it(`native login Keep/Escape/Discard, ${locale}, ${theme}, ${width}`, async () => {
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
        const cancel = control(screen, "change-account").shadowRoot!.querySelector("button")!;
        await userEvent.click(cancel);
        const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
        await expect.poll(() => warning.open).toBe(true);
        await warning.updateComplete;
        const keep = warning
          .shadowRoot!.querySelector("[data-choice=keep]")!
          .shadowRoot!.querySelector("button")!;
        await expect.poll(() => keep.matches(":focus")).toBe(true);
        await expectNoA11yViolations(warning);
        await page.screenshot({
          path: `__screenshots__/w69-login-look/${locale}-${theme}-${width}-warning.png`,
        });
        await userEvent.keyboard("{Escape}");
        await expect.poll(() => warning.open).toBe(false);
        expect(native.value).toBe("synthetic password");
        await expect.poll(() => cancel.matches(":focus")).toBe(true);
        await page.screenshot({
          path: `__screenshots__/w69-login-look/${locale}-${theme}-${width}-kept.png`,
        });
        await userEvent.click(cancel);
        await choose(app, "keep");
        expect(native.value).toBe("synthetic password");
        await userEvent.click(cancel);
        await choose(app, "discard");
        await expect.poll(() => screen.shadowRoot!.querySelector("[name=email]")).not.toBeNull();
        expect(value(screen, "email")).toBe("");
        expect(unload()).toBe(false);
      });

it("a later passkey name survives its earlier verification write", async () => {
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
  verify.resolve({ credentialId: "synthetic-key" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=passkey-name]")
      ?.value,
  ).toBe("Newer laptop");
  expect(unload()).toBe(true);
  await click(screen, "skip-passkey");
  await choose(app, "keep");
  expect(requests).toEqual([expect.objectContaining({ name: "Submitted laptop" })]);
  await change(screen, "passkey-name", "Submitted laptop");
  expect(unload()).toBe(false);
});
it("a successful autofill passkey clears the email draft before the authenticated event", async () => {
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
  "%s input installs the unload warning in the same event task",
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
    expect(unload()).toBe(true);
    const pending = guard!.write("/manage/other");
    await choose(app, "keep");
    expect(await pending).toBe("kept");
    expect(location.pathname).toBe(action ? "/manage/account" : "/manage/");
  },
);
