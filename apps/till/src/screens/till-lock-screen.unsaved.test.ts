import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { commands, page, userEvent } from "vitest/browser";
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
async function question(app: LoginLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
async function choose(app: LoginLeaveApp, decision: "keep" | "discard") {
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
it("Cancel asks before clearing typed PIN digits; Keep retains them and Discard never signs in", async () => {
  const { app, screen, login } = await mount();
  await digit(screen, "0");
  await digit(screen, "1");
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  expect((await question(app)).open).toBe(true);
  expect(screen.shadowRoot!.querySelector(".pin-display")!.textContent).toBe("●●");
  await choose(app, "keep");
  expect(screen.shadowRoot!.querySelector(".pin-display")!.textContent).toBe("●●");
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  await choose(app, "discard");
  await expect.poll(() => screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  expect(unload()).toBe(false);
  expect(login).not.toHaveBeenCalled();
});
it("typed PIN protects page departure and unload, while clean and reverted input leave directly", async () => {
  const { app, screen } = await mount();
  expect(unload()).toBe(false);
  expect(
    await app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} }),
  ).toBe("proceeded");
  await digit(screen, "0");
  expect(unload()).toBe(true);
  let leaves = 0;
  const kept = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      leaves++;
    },
  });
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(leaves).toBe(0);
  await digit(screen, "backspace");
  expect(unload()).toBe(false);
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  expect((await question(app)).open).toBe(false);
});
it("successful PIN submission goes straight to login and clears a pending leave answer", async () => {
  const { app, screen, login } = await mount();
  await digit(screen, "0");
  await digit(screen, "1");
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  expect((await question(app)).open).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
  await expect.poll(() => app.logins).toBe(1);
  expect(login).toHaveBeenCalledExactlyOnceWith("ana", "01");
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(false);
});
it("refused PIN is cleared but throttled PIN stays protected without changing the sign-in refusal", async () => {
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
  expect(unload()).toBe(false);
  await digit(screen, "2");
  screen.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector(".throttle")).not.toBeNull();
  expect(unload()).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  await choose(app, "discard");
  await expect.poll(() => screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  expect(unload()).toBe(false);
});
it("disconnect clears typed proof and invalidates the old question before reconnect", async () => {
  const { app, screen, login } = await mount();
  await digit(screen, "1");
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  expect((await question(app)).open).toBe(true);
  screen.remove();
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  expect(login).not.toHaveBeenCalled();
});
it("an explicit login in flight leaves directly and a departed reply cannot sign in the reconnected screen", async () => {
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
  expect(unload()).toBe(true);
});
it("digits entered after submitting a PIN remain protected while that login is pending", async () => {
  const login = vi.fn(
    () => new Promise<{ personId: string; permissions: string[]; locale: null }>(() => {}),
  );
  const { app, screen } = await mount(login);
  await digit(screen, "1");
  screen.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
  expect(unload()).toBe(false);
  await digit(screen, "2");
  expect(unload()).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  await choose(app, "keep");
  expect(screen.shadowRoot!.querySelector("till-numeric-pad")!.value).toBe("12");
  expect(login).toHaveBeenCalledExactlyOnceWith("ana", "1");
});
for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      it(`native PIN Cancel retains focus and proof in ${locale}/${theme}/${width}`, async () => {
        setLocale(locale);
        await page.viewport(width, 900);
        expect(window.innerWidth).toBe(width);
        const { app, screen, login } = await mount(undefined, theme);
        await digit(screen, "0");
        const cancel = screen.shadowRoot!.querySelector(".cancel")!;
        await userEvent.click(page.elementLocator(cancel));
        const q = await question(app);
        expect(q.open).toBe(true);
        await commands.parkPointer();
        await expectNoA11yViolations(q);
        await page.screenshot({
          path: `../../node_modules/.cache/w69-lock/${locale}-${theme}-${width}-question.png`,
        });
        await userEvent.keyboard("{Escape}");
        await expect.poll(() => q.open).toBe(false);
        expect(screen.shadowRoot!.querySelector(".pin-display")!.textContent).toBe("●");
        expect(screen.shadowRoot!.activeElement).toBe(cancel);
        await page.screenshot({
          path: `../../node_modules/.cache/w69-lock/${locale}-${theme}-${width}-kept.png`,
        });
        await userEvent.click(page.elementLocator(cancel));
        await choose(app, "discard");
        await expect.poll(() => screen.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
        expect(login).not.toHaveBeenCalled();
      });
    }
