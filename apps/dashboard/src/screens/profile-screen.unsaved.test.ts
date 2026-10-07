import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi, OwnProfile } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./profile-screen.js";

const profile: OwnProfile = {
  displayName: "Ada",
  firstNames: "Ada",
  lastNames: "Lovelace",
  telephone: null,
  email: "ada@example.com",
  pendingEmail: "new@example.com",
  locale: "en-GB",
  hasPassword: true,
  hasTotp: true,
  hasGoogle: true,
  passkeys: [
    {
      id: "key1",
      name: "Desk",
      createdAt: "2026-09-09T12:00:00Z",
      lastUsedAt: null,
      provider: null,
    },
  ],
};
class ProfileLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-profile-screen .api=${this.api}></dashboard-profile-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("profile-leave-test-app", ProfileLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});
async function mount(overrides: Partial<DashboardApi> = {}) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<ProfileLeaveApp>("profile-leave-test-app", {
    api: {
      getProfile: async () => profile,
      getLocales: async () => ({
        locales: [{ code: "en-GB", label: "English" }],
        venueDefault: "en-GB",
      }),
      getGoogleConfig: async () => ({ configured: true }),
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-profile-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-tabs")).not.toBeNull();
  return { app, screen };
}
type Screen = HTMLElementTagNameMap["dashboard-profile-screen"];
function change(screen: Screen, name: string, value: string) {
  screen
    .shadowRoot!.querySelector(`wt-input[name=${name}]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function value(screen: Screen, name: string) {
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name=${name}]`,
  )!.value;
}
async function click(screen: Screen, action: string) {
  screen.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
  await screen.updateComplete;
  await screen.shadowRoot!.querySelector("wt-modal")!.updateComplete;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
for (const [action, field] of [
  ["change-password", "password"],
  ["change-pin", "pin"],
  ["remove-passkey", "currentPassword"],
  ["recovery-codes", "totp"],
  ["disable-authenticator", "currentPassword"],
  ["unlink-google", "currentPassword"],
  ["add-passkey", "passkeyName"],
  ["confirm-email", "setupCode"],
  ["setup-google", "currentPassword"],
  ["setup-authenticator", "currentPassword"],
] as const) {
  it(`${action} keeps unsubmitted values on Cancel and Escape, then discards only after approval`, async () => {
    const { app, screen } = await mount({
      getProfile: async () => ({
        ...profile,
        hasGoogle: action !== "setup-google",
        hasTotp: action !== "setup-authenticator",
      }),
    });
    await click(screen, action);
    const modal = screen.shadowRoot!.querySelector("wt-modal")!;
    change(screen, field, "typed value");
    await screen.updateComplete;
    expect(unload()).toBe(true);
    await click(screen, "cancel");
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    expect(modal.open).toBe(true);
    const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await q.updateComplete;
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(value(screen, field)).toBe("typed value");
    modal
      .shadowRoot!.querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true }));
    await expect.poll(() => q.open).toBe(true);
    await q.updateComplete;
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => modal.open).toBe(false);
    expect(unload()).toBe(false);
    await click(screen, action);
    expect(value(screen, field)).toBe("");
    await click(screen, "cancel");
    await expect.poll(() => modal.open).toBe(false);
    expect(q.open).toBe(false);
    await click(screen, action);
    change(screen, field, "edited");
    expect(unload()).toBe(true);
    change(screen, field, "");
    expect(unload()).toBe(false);
    await click(screen, "cancel");
    await expect.poll(() => modal.open).toBe(false);
    expect(q.open).toBe(false);
  });
}
it("details compare normalized names and telephone, with clean and reverted dismissals", async () => {
  const { app, screen } = await mount();
  screen.editDetails();
  await screen.updateComplete;
  change(screen, "firstNames", "  Ada  ");
  change(screen, "telephone", "  ");
  expect(unload()).toBe(false);
  change(screen, "telephone", "+34 600 000 000");
  expect(unload()).toBe(true);
  change(screen, "telephone", "");
  expect(unload()).toBe(false);
  await click(screen, "cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("a refused credential write retains its values and blocks dismissal during the write", async () => {
  let reject!: (e: unknown) => void;
  const { app, screen } = await mount({
    changePin: () =>
      new Promise((_, no) => {
        reject = no;
      }),
  });
  await click(screen, "change-pin");
  change(screen, "currentPassword", "proof");
  change(screen, "totp", "123456");
  change(screen, "pin", "1234");
  change(screen, "confirmPin", "1234");
  await click(screen, "save");
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=pin]")!
      .disabled,
  ).toBe(true);
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  modal
    .shadowRoot!.querySelector("dialog")!
    .dispatchEvent(new Event("cancel", { cancelable: true }));
  await app.updateComplete;
  expect(modal.open).toBe(true);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  reject({ code: "password.invalid" });
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
          .disabled,
    )
    .toBe(false);
  expect(value(screen, "pin")).toBe("1234");
  await click(screen, "cancel");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
});
it("commits a submitted profile before refresh refuses, without losing newer delivered input", async () => {
  let resolve!: () => void;
  let reads = 0;
  let received: unknown;
  let dirtyAtRefresh: boolean | undefined;
  const mounted = await mount({
    getProfile: async () => {
      if (++reads === 1) return profile;
      dirtyAtRefresh = mounted.app.leave.coordinator.isDirty();
      throw { code: "connection.failed" };
    },
    saveProfile: (body) => {
      received = body;
      return new Promise((yes) => {
        resolve = () => yes({ emailVerificationSent: false });
      });
    },
  });
  mounted.screen.editDetails();
  await mounted.screen.updateComplete;
  change(mounted.screen, "displayName", "  Ada B  ");
  await click(mounted.screen, "save");
  change(mounted.screen, "displayName", "Ada C");
  resolve();
  await expect.poll(() => dirtyAtRefresh).toBe(true);
  expect(received).toEqual({
    displayName: "Ada B",
    firstNames: "Ada",
    lastNames: "Lovelace",
    telephone: null,
    email: "ada@example.com",
    locale: "en-GB",
  });
  expect(value(mounted.screen, "displayName")).toBe("Ada C");
  change(mounted.screen, "displayName", "Ada B");
  expect(mounted.app.leave.coordinator.isDirty()).toBe(false);
  await click(mounted.screen, "cancel");
  await expect.poll(() => mounted.screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
});
it("authenticator enrollment consumes proof before starting a clean code-entry stage", async () => {
  const { app, screen } = await mount({
    getProfile: async () => ({ ...profile, hasTotp: false }),
    beginTotp: async () => ({
      enrollmentId: "setup",
      secret: "SECRET",
      uri: "otpauth://totp/Waitron:test",
      expiresAt: "2026-10-07T00:00:00Z",
    }),
    finishTotp: async () => ({ codes: ["RECOVERY"] }),
  });
  await click(screen, "setup-authenticator");
  change(screen, "currentPassword", "proof");
  expect(unload()).toBe(true);
  await click(screen, "save");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("wt-input[name=setupCode]"))
    .not.toBeNull();
  expect(unload()).toBe(false);
  change(screen, "setupCode", "123456");
  expect(unload()).toBe(true);
  await click(screen, "save");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=recovery-code-list]")?.textContent)
    .toContain("RECOVERY");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel]")!
          .disabled,
    )
    .toBe(false);
  await click(screen, "cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
});
it("disconnect clears credential values and unload protection", async () => {
  const { app, screen } = await mount();
  await click(screen, "change-password");
  change(screen, "password", "sensitive");
  expect(unload()).toBe(true);
  screen.remove();
  await screen.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
  await click(screen, "change-password");
  expect(value(screen, "password")).toBe("");
});
it("successful Google proof clears its scope before the external redirect", async () => {
  let received: unknown;
  let dirtyAtNavigate: boolean | undefined;
  const { app, screen } = await mount({
    getProfile: async () => ({ ...profile, hasGoogle: false }),
    beginGoogleLink: async (proof) => {
      received = proof;
      return { authorizationUrl: "https://accounts.google.test/link" };
    },
  });
  screen.navigate = () => {
    dirtyAtNavigate = app.leave.coordinator.isDirty();
  };
  await click(screen, "setup-google");
  change(screen, "currentPassword", "proof");
  change(screen, "totp", "123456");
  await click(screen, "save");
  await expect.poll(() => dirtyAtNavigate).toBe(false);
  expect(received).toEqual({ currentPassword: "proof", totp: "123456" });
  expect(unload()).toBe(false);
});
it("a saved PIN commits before refresh refuses and closes without a discard question", async () => {
  let reads = 0;
  let received: unknown;
  let dirtyAtRefresh: boolean | undefined;
  const mounted = await mount({
    getProfile: async () => {
      if (++reads === 1) return profile;
      dirtyAtRefresh = mounted.app.leave.coordinator.isDirty();
      throw { code: "connection.failed" };
    },
    changePin: async (body) => {
      received = body;
    },
  });
  await click(mounted.screen, "change-pin");
  change(mounted.screen, "currentPassword", "proof");
  change(mounted.screen, "totp", "123456");
  change(mounted.screen, "pin", "1234");
  change(mounted.screen, "confirmPin", "1234");
  await click(mounted.screen, "save");
  await expect.poll(() => dirtyAtRefresh).toBe(false);
  expect(received).toEqual({ pin: "1234", currentPassword: "proof", totp: "123456" });
  expect(mounted.screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
  expect(unload()).toBe(false);
});
it("a disconnected authenticator enrollment result cannot repopulate secret fields", async () => {
  let resolve!: (value: {
    enrollmentId: string;
    secret: string;
    uri: string;
    expiresAt: string;
  }) => void;
  const { app, screen } = await mount({
    getProfile: async () => ({ ...profile, hasTotp: false }),
    beginTotp: () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  });
  await click(screen, "setup-authenticator");
  change(screen, "currentPassword", "proof");
  await click(screen, "save");
  screen.remove();
  resolve({
    enrollmentId: "setup",
    secret: "SECRET",
    uri: "otpauth://totp/Waitron:test",
    expiresAt: "2026-10-07T00:00:00Z",
  });
  await new Promise((r) => setTimeout(r, 30));
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
  expect(screen.shadowRoot!.querySelector("[data-test=authenticator-qr]")).toBeNull();
  expect(unload()).toBe(false);
});
for (const action of ["recovery-codes", "setup-google", "confirm-email"] as const) {
  for (const refuses of [false, true]) {
    it(`departed ${action} ${refuses ? "refusal" : "success"} cannot affect a reconnected profile`, async () => {
      let finish!: () => void;
      let reads = 0;
      let redirects = 0;
      const wait = async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (refuses) throw { code: "connection.failed" };
      };
      const { app, screen } = await mount({
        getProfile: async () => {
          reads++;
          return { ...profile, hasGoogle: false };
        },
        regenerateRecoveryCodes: async () => {
          await wait();
          return { codes: ["OLD-SECRET"] };
        },
        beginGoogleLink: async () => {
          await wait();
          return { authorizationUrl: "https://example.com/old" };
        },
        confirmProfileEmail: async () => {
          await wait();
          return { email: "new@example.com" };
        },
      });
      screen.navigate = () => {
        redirects++;
      };
      await click(screen, action);
      if (action === "confirm-email") change(screen, "setupCode", "123456");
      else {
        change(screen, "currentPassword", "proof");
        change(screen, "totp", "123456");
      }
      await click(screen, "save");
      await expect.poll(() => typeof finish).toBe("function");
      screen.remove();
      app.shadowRoot!.prepend(screen);
      await screen.updateComplete;
      await click(screen, "change-password");
      change(screen, "password", "Replacement");
      const beforeReply = reads;
      finish();
      await new Promise((resolve) => setTimeout(resolve, 30));
      await screen.updateComplete;
      expect(value(screen, "password")).toBe("Replacement");
      expect(screen.shadowRoot!.querySelector("[data-test=recovery-code-list]")).toBeNull();
      expect(screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
      expect(screen.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
      expect(reads).toBe(beforeReply);
      expect(redirects).toBe(0);
      expect(unload()).toBe(true);
      change(screen, "password", "");
      expect(unload()).toBe(false);
    });
  }
}

it("passkey enrollment submits the captured name and preserves a newer unsubmitted name", async () => {
  let resolve!: () => void;
  let received: unknown;
  vi.spyOn(navigator.credentials, "create").mockResolvedValue({
    id: "new-key",
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
  } as PublicKeyCredential);
  const { app, screen } = await mount({
    passkeyRegisterOptions: () =>
      new Promise((yes) => {
        resolve = () =>
          yes({
            challengeHandle: "handle",
            options: {
              challenge: "AQID",
              rp: { name: "Waitron", id: "localhost" },
              user: { id: "BAUG", name: "ada@example.com", displayName: "Ada" },
              pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            },
          });
      }),
    passkeyRegisterVerify: async (body) => {
      received = body;
      return { credentialId: "new-key" };
    },
  });
  await click(screen, "add-passkey");
  change(screen, "currentPassword", "proof");
  change(screen, "totp", "123456");
  change(screen, "passkeyName", "  Desk  ");
  await click(screen, "save");
  change(screen, "passkeyName", "Phone");
  resolve();
  await expect.poll(() => (received as { name?: string } | undefined)?.name).toBe("Desk");
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
          .disabled,
    )
    .toBe(false);
  expect(value(screen, "passkeyName")).toBe("Phone");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  change(screen, "passkeyName", "Desk");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a disconnected passkey editor never opens a browser ceremony from a late options reply", async () => {
  let resolve!: (result: Awaited<ReturnType<DashboardApi["passkeyRegisterOptions"]>>) => void;
  const create = vi
    .spyOn(navigator.credentials, "create")
    .mockRejectedValue(new DOMException("Cancelled", "NotAllowedError"));
  let verified = false;
  const { app, screen } = await mount({
    passkeyRegisterOptions: () =>
      new Promise((yes) => {
        resolve = yes;
      }),
    passkeyRegisterVerify: async () => {
      verified = true;
      return { credentialId: "key" };
    },
  });
  await click(screen, "add-passkey");
  change(screen, "currentPassword", "proof");
  change(screen, "totp", "123456");
  await click(screen, "save");
  screen.remove();
  resolve({
    challengeHandle: "handle",
    options: {
      challenge: "AQID",
      rp: { name: "Waitron", id: "localhost" },
      user: { id: "BAUG", name: "ada@example.com", displayName: "Ada" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  expect(create).not.toHaveBeenCalled();
  expect(verified).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a departed PIN reply cannot release or close a replacement password write", async () => {
  let oldResolve!: () => void;
  let newResolve!: () => void;
  const { app, screen } = await mount({
    changePin: () =>
      new Promise((yes) => {
        oldResolve = yes;
      }),
    changePassword: () =>
      new Promise((yes) => {
        newResolve = yes;
      }),
  });
  await click(screen, "change-pin");
  change(screen, "currentPassword", "proof");
  change(screen, "totp", "123456");
  change(screen, "pin", "1234");
  change(screen, "confirmPin", "1234");
  await click(screen, "save");
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  await click(screen, "change-password");
  expect(screen.shadowRoot!.querySelector("wt-input[name=password]")).not.toBeNull();
  change(screen, "currentPassword", "proof2");
  change(screen, "totp", "234567");
  change(screen, "password", "new-password");
  change(screen, "confirmPassword", "new-password");
  await click(screen, "save");
  oldResolve();
  await new Promise((r) => setTimeout(r, 30));
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
      .disabled,
  ).toBe(true);
  expect(value(screen, "password")).toBe("new-password");
  newResolve();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
});
it("reverting a detail email excludes the now-hidden proof from its submitted draft", async () => {
  const { app, screen } = await mount();
  screen.editDetails();
  await screen.updateComplete;
  change(screen, "email", "different@example.com");
  await screen.updateComplete;
  change(screen, "currentPassword", "proof");
  change(screen, "totp", "123456");
  change(screen, "email", "ada@example.com");
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("wt-input[name=currentPassword]")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(unload()).toBe(false);
  await click(screen, "cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});

it("a Google-link reply retains newer proof input instead of redirecting away from it", async () => {
  let finish!: () => void;
  const destinations: string[] = [];
  const { screen } = await mount({
    getProfile: async () => ({ ...profile, hasGoogle: false }),
    beginGoogleLink: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { authorizationUrl: "https://example.com/link" };
    },
  });
  screen.navigate = (url) => {
    destinations.push(url);
  };
  await click(screen, "setup-google");
  change(screen, "currentPassword", "submitted");
  change(screen, "totp", "123456");
  await click(screen, "save");
  await expect.poll(() => typeof finish).toBe("function");
  change(screen, "currentPassword", "newer");
  finish();
  await expect
    .poll(() => screen.shadowRoot!.querySelector<HTMLButtonElement>("[data-test=save]")!.disabled)
    .toBe(false);
  expect(destinations).toEqual([]);
  expect(value(screen, "currentPassword")).toBe("newer");
  expect(screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(unload()).toBe(true);
  change(screen, "currentPassword", "submitted");
  expect(unload()).toBe(false);
});

it("a pending PIN write ignores a delivered Cancel and a details-editor request", async () => {
  let reject!: (reason: unknown) => void;
  const { app, screen } = await mount({
    changePin: () =>
      new Promise((_, no) => {
        reject = no;
      }),
  });
  await click(screen, "change-pin");
  change(screen, "currentPassword", "proof");
  change(screen, "totp", "123456");
  change(screen, "pin", "1234");
  change(screen, "confirmPin", "1234");
  await click(screen, "save");
  screen.shadowRoot!.querySelector("[data-test=cancel]")!.dispatchEvent(new MouseEvent("click"));
  screen.editDetails();
  await screen.updateComplete;
  expect(value(screen, "pin")).toBe("1234");
  expect(screen.shadowRoot!.querySelector("wt-input[name=displayName]")).toBeNull();
  expect(screen.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  reject({ code: "password.invalid" });
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
          .disabled,
    )
    .toBe(false);
  expect(value(screen, "pin")).toBe("1234");
  expect(unload()).toBe(true);
});
