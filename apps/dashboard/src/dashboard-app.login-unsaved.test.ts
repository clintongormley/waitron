import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { navigationGuardFor } from "@waitron/ui";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en-GB");
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = async () => false;
    },
  );
});
afterEach(() => {
  cleanupWidgets();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en-GB");
});
async function mount(path = "/manage/", overrides: Partial<DashboardApi> = {}) {
  history.replaceState({ external: "preserved" }, "", path);
  const { el: app } = await mountWidget<DashboardApp>("dashboard-app", {
    api: {
      getMe: async () => {
        throw { code: "management_session.required" };
      },
      getGoogleConfig: async () => ({ configured: false }),
      getLocales: async () => ({
        locales: [
          { code: "en-GB", label: "English" },
          { code: "es-ES", label: "Español" },
        ],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
        venueName: "Venue",
        onboardingIntent: "prepare",
      }),
      inspectAccountAction: async (_token: string, purpose: string) => ({
        email: "new@example.test",
        purpose,
      }),
      ...overrides,
    } as unknown as DashboardApi,
  });
  await expect
    .poll(() =>
      login(app)?.shadowRoot?.querySelector(
        path.includes("token=") ? "[name=new-password]" : "[name=email]",
      ),
    )
    .not.toBeNull();
  return app;
}
function login(app: DashboardApp) {
  return app.shadowRoot!.querySelector("dashboard-login-screen")!;
}
function field(app: DashboardApp, name: string) {
  return login(app).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`)!;
}
async function enter(app: DashboardApp, name: string, value: string) {
  const input = field(app, name);
  await input.updateComplete;
  await userEvent.fill(input.shadowRoot!.querySelector("input")!, value);
  await login(app).updateComplete;
  return input;
}
async function choose(app: DashboardApp, decision: "keep" | "discard") {
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
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it("the real login reset link protects a password and runs its local action after Discard", async () => {
  const requestPasswordReset = vi.fn().mockResolvedValue(undefined);
  const app = await mount("/manage/", { requestPasswordReset });
  await enter(app, "email", "ada@example.test");
  login(app).shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
  await expect.poll(() => field(app, "password")).not.toBeNull();
  const password = await enter(app, "password", "synthetic password");
  const link = login(app).shadowRoot!.querySelector<HTMLAnchorElement>(
    "[data-test=reset-by-email]",
  )!;
  await userEvent.click(link);
  await choose(app, "keep");
  expect(password.value).toBe("synthetic password");
  expect(requestPasswordReset).not.toHaveBeenCalled();
  expect(location.hash).toBe("");
  await userEvent.click(link);
  await choose(app, "discard");
  await expect
    .poll(() => login(app).shadowRoot!.querySelector("[data-test=reset-sent]"))
    .not.toBeNull();
  expect(requestPasswordReset).toHaveBeenCalledExactlyOnceWith("ada@example.test");
  expect(location.hash).toBe("");
  expect(unload()).toBe(false);
});

it.each(["clean", "reverted"])(
  "the real %s login reset link acts without a warning",
  async (state) => {
    const requestPasswordReset = vi.fn().mockResolvedValue(undefined);
    const app = await mount("/manage/", { requestPasswordReset });
    await enter(app, "email", "ada@example.test");
    login(app).shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await expect.poll(() => field(app, "password")).not.toBeNull();
    if (state === "reverted") {
      await enter(app, "password", "synthetic password");
      await enter(app, "password", "");
    }
    await userEvent.click(
      login(app).shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=reset-by-email]")!,
    );
    await expect
      .poll(() => login(app).shadowRoot!.querySelector("[data-test=reset-sent]"))
      .not.toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(requestPasswordReset).toHaveBeenCalledExactlyOnceWith("ada@example.test");
    expect(location.hash).toBe("");
    expect(unload()).toBe(false);
  },
);

it("the dashboard's login action URL remains until Cancel is accepted", async () => {
  const app = await mount("/manage/account?token=synthetic&purpose=invitation");
  const password = await enter(app, "new-password", "synthetic password");
  const pin = await enter(app, "new-pin", "4321");
  const cancel = login(app).shadowRoot!.querySelector<HTMLElement>(
    "[data-test=cancel-account-action]",
  )!;
  cancel.click();
  await choose(app, "keep");
  expect(location.search).toContain("token=synthetic");
  expect(password.value).toBe("synthetic password");
  expect(pin.value).toBe("4321");
  cancel.click();
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/");
  await expect.poll(() => field(app, "email")).not.toBeNull();
  expect(location.search).toBe("");
  expect(history.state).toMatchObject({
    external: "preserved",
    __wtNavigation: expect.any(Object),
  });
  expect(unload()).toBe(false);
});
it("the actual dashboard history adapter keeps login email on Back and accepts Back/Forward once", async () => {
  const app = await mount();
  await navigationGuardFor(window)!.write("/manage/?view=login-next");
  const input = await enter(app, "email", "draft@example.test");
  history.back();
  await choose(app, "keep");
  expect(location.search).toBe("?view=login-next");
  expect(input.value).toBe("draft@example.test");
  history.back();
  await choose(app, "discard");
  await expect.poll(() => location.search).toBe("");
  await expect.poll(() => input.value).toBe("");
  history.forward();
  await expect.poll(() => location.search).toBe("?view=login-next");
  expect(unload()).toBe(false);
});
it("changing the login language retains the same native draft", async () => {
  const app = await mount();
  const input = await enter(app, "email", "draft@example.test");
  app.shadowRoot!.querySelector("wt-language-chooser")!.dispatchEvent(
    new CustomEvent("wt-locale-selected", {
      detail: { code: "es-ES" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => currentLocale()).toBe("es-ES");
  expect(field(app, "email")).toBe(input);
  expect(input.value).toBe("draft@example.test");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(true);
});
it.each(["management_session.expired", "management_session.required", "person.suspended"])(
  "%s clears the retained login credentials and cancels a pending answer immediately",
  async (code) => {
    const app = await mount("/manage/account?token=synthetic&purpose=invitation");
    const screen = login(app);
    const password = await enter(app, "new-password", "synthetic password");
    const pin = await enter(app, "new-pin", "4321");
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-account-action]")!.click();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    window.dispatchEvent(new CustomEvent("waitron-session-invalid", { detail: { code } }));
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    await screen.updateComplete;
    expect(password.value).toBe("");
    expect(pin.value).toBe("");
    expect(unload()).toBe(false);
    await expect.poll(() => field(app, "email")).not.toBeNull();
    await enter(app, "email", "fresh@example.test");
    expect(unload()).toBe(true);
  },
);
