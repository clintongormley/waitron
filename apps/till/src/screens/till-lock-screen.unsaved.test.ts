import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillApi } from "../api/client.js";
import "./till-lock-screen.js";

class LoginLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: TillApi;
  logins = 0;
  override render() {
    return html`<till-lock-screen
        .api=${this.api}
        @logged-in=${() => this.logins++}
      ></till-lock-screen>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("login-leave-test-app", LoginLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
});
async function mount(
  login = vi.fn(async () => ({ personId: "ana", permissions: [] as string[], locale: null })),
  theme?: "light" | "dark",
) {
  const api = {
    listStaff: async () => [{ personId: "ana", displayName: "Ana" }],
    getLocales: async () => ({ locales: [] }),
    login,
  } as unknown as TillApi;
  const { el: app } = await mountWidget<LoginLeaveApp>("login-leave-test-app", { api }, theme);
  const screen = app.shadowRoot!.querySelector("till-lock-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-person]")).not.toBeNull();
  screen.shadowRoot!.querySelector<HTMLElement>("[data-person]")!.click();
  await screen.updateComplete;
  return { app, screen, login };
}
type Screen = HTMLElementTagNameMap["till-lock-screen"];
async function digit(screen: Screen, key: string) {
  const pad = screen.shadowRoot!.querySelector("till-numeric-pad")!;
  await pad.updateComplete;
  pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!.click();
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
async function settle(app: LoginLeaveApp) {
  await new Promise((done) => setTimeout(done, 0));
  await app.updateComplete;
}
it("Cancel with typed PIN digits leaves PIN mode at once without asking and never signs in", async () => {
  const { app, screen, login } = await mount();
  await digit(screen, "0");
  await digit(screen, "1");
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  await settle(app);
  expect(asked(app)).toBe(false);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-person]")!.click();
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector(".pin-display")!.textContent).toBe("");
  expect(unload()).toBe(false);
  expect(login).not.toHaveBeenCalled();
});
it("typed PIN never protects page departure or unload", async () => {
  const { app, screen } = await mount();
  await digit(screen, "0");
  expect(unload()).toBe(false);
  let leaves = 0;
  expect(
    await app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {
        leaves++;
      },
    }),
  ).toBe("proceeded");
  expect(leaves).toBe(1);
  expect(asked(app)).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("successful PIN submission signs in once without asking", async () => {
  const { app, screen, login } = await mount();
  await digit(screen, "0");
  await digit(screen, "1");
  screen.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
  await expect.poll(() => app.logins).toBe(1);
  expect(login).toHaveBeenCalledExactlyOnceWith("ana", "01");
  expect(asked(app)).toBe(false);
  expect(unload()).toBe(false);
});
it("refused PIN is cleared and a throttled PIN leaves at once without changing the sign-in refusal", async () => {
  const login = vi
    .fn()
    .mockRejectedValueOnce({ code: "pin.invalid" })
    .mockRejectedValueOnce({ code: "pin.throttled", retryAfterSeconds: 30 });
  const { app, screen } = await mount(login);
  await digit(screen, "1");
  screen.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
  await expect
    .poll(() => screen.shadowRoot!.querySelector(".error")?.textContent)
    .toContain(t("pin.invalid"));
  expect(screen.shadowRoot!.querySelector(".pin-display")!.textContent).toBe("");
  expect(unload()).toBe(false);
  await digit(screen, "2");
  screen.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector(".throttle")).not.toBeNull();
  expect(screen.shadowRoot!.querySelector(".pin-display")!.textContent).toBe("●");
  expect(unload()).toBe(false);
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  await settle(app);
  expect(asked(app)).toBe(false);
});
it("disconnect clears typed proof before reconnect", async () => {
  const { app, screen, login } = await mount();
  await digit(screen, "1");
  screen.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  expect(asked(app)).toBe(false);
  expect(login).not.toHaveBeenCalled();
});
it("a departed login reply cannot sign in the reconnected screen", async () => {
  let resolve!: (value: { personId: string; permissions: string[]; locale: null }) => void;
  const login = vi.fn(
    () =>
      new Promise<{ personId: string; permissions: string[]; locale: null }>((done) => {
        resolve = done;
      }),
  );
  const { app, screen } = await mount(login);
  await digit(screen, "1");
  screen.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
  expect(login).toHaveBeenCalledExactlyOnceWith("ana", "1");
  expect(unload()).toBe(false);
  expect(
    await app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} }),
  ).toBe("proceeded");
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-person]")).not.toBeNull();
  screen.shadowRoot!.querySelector<HTMLElement>("[data-person]")!.click();
  await screen.updateComplete;
  await digit(screen, "2");
  resolve({ personId: "ana", permissions: [] as string[], locale: null });
  await new Promise((done) => setTimeout(done, 0));
  await screen.updateComplete;
  expect(app.logins).toBe(0);
  expect(screen.shadowRoot!.querySelector(".pin-display")!.textContent).toBe("●");
  expect(unload()).toBe(false);
});
it("digits entered while a login is pending are not protected and Cancel leaves at once", async () => {
  const login = vi.fn(
    () => new Promise<{ personId: string; permissions: string[]; locale: null }>(() => {}),
  );
  const { app, screen } = await mount(login);
  await digit(screen, "1");
  screen.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
  await digit(screen, "2");
  expect(screen.shadowRoot!.querySelector("till-numeric-pad")!.value).toBe("12");
  expect(unload()).toBe(false);
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  await settle(app);
  expect(asked(app)).toBe(false);
  expect(login).toHaveBeenCalledExactlyOnceWith("ana", "1");
});
for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      it(`native PIN Cancel leaves PIN mode without asking in ${locale}/${theme}/${width}`, async () => {
        setLocale(locale);
        await page.viewport(width, 900);
        expect(window.innerWidth).toBe(width);
        const { app, screen, login } = await mount(undefined, theme);
        await digit(screen, "0");
        const cancel = screen.shadowRoot!.querySelector(".cancel")!;
        await userEvent.click(page.elementLocator(cancel));
        await expect.poll(() => screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
        await settle(app);
        expect(asked(app)).toBe(false);
        await expectNoA11yViolations(screen);
        expect(unload()).toBe(false);
        expect(login).not.toHaveBeenCalled();
      });
    }
