import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillApi } from "../api/client.js";
import "./till-enrol-screen.js";
class EnrolLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: TillApi;
  approved: unknown[] = [];
  leaves = 0;
  override render() {
    return html`<till-enrol-screen
        .api=${this.api}
        @enrolled=${(event: CustomEvent) => this.approved.push(event.detail)}
        ><wt-button
          slot="actions-before"
          data-back
          @click=${() =>
            void this.leave.coordinator.request({
              scopes: "all",
              reason: "navigation",
              proceed: () => {
                this.leaves++;
              },
            })}
          >Back</wt-button
        ></till-enrol-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("till-enrol-leave-test-app", EnrolLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
});
async function mount(overrides: Record<string, unknown> = {}, theme?: "light" | "dark") {
  const api = {
    join: vi.fn(async () => ({ joinId: "join-1", verificationNumber: "47" })),
    joinStatus: vi.fn(async () => ({ status: "pending" })),
    getLocales: async () => ({ locales: [] }),
    ...overrides,
  } as unknown as TillApi;
  const { el: app } = await mountWidget<EnrolLeaveApp>("till-enrol-leave-test-app", { api }, theme);
  const screen = app.shadowRoot!.querySelector("till-enrol-screen")!;
  await screen.updateComplete;
  return { app, screen, api };
}
type Screen = HTMLElementTagNameMap["till-enrol-screen"];
function nameField(screen: Screen) {
  return screen.shadowRoot!.querySelector("wt-input")!;
}
async function fill(screen: Screen, value: string) {
  const field = nameField(screen);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await screen.updateComplete;
}
function change(screen: Screen, value: string) {
  nameField(screen).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
function submit(screen: Screen) {
  screen.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question(app: EnrolLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
async function choice(app: EnrolLeaveApp, decision: "keep" | "discard") {
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function leave(app: EnrolLeaveApp, proceed: () => void = () => {}) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
}
it("typed device name asks before leaving; Keep retains focus and Discard never submits or removes a join", async () => {
  const { app, screen, api } = await mount();
  await fill(screen, "Front counter");
  const input = nameField(screen).shadowRoot!.querySelector("input")!;
  expect(unload()).toBe(true);
  let leaves = 0;
  const kept = leave(app, () => {
    leaves++;
  });
  await choice(app, "keep");
  expect(await kept).toBe("kept");
  expect(input.value).toBe("Front counter");
  expect(input.getRootNode()).toBe(nameField(screen).shadowRoot);
  expect(nameField(screen).shadowRoot!.activeElement).toBe(input);
  expect(leaves).toBe(0);
  const discarded = leave(app, () => {
    leaves++;
  });
  await choice(app, "discard");
  expect(await discarded).toBe("proceeded");
  await screen.updateComplete;
  expect(input.value).toBe("");
  expect(unload()).toBe(false);
  expect(leaves).toBe(1);
  expect(api.join).not.toHaveBeenCalled();
  expect(api.joinStatus).not.toHaveBeenCalled();
});
it("blank, reverted and successfully submitted names leave without a question", async () => {
  const { app, screen, api } = await mount();
  expect(await leave(app)).toBe("proceeded");
  expect(unload()).toBe(false);
  await fill(screen, "Front counter");
  await fill(screen, "");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
  await fill(screen, " Front counter ");
  submit(screen);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-number]")?.textContent?.trim())
    .toBe("47");
  expect(api.join).toHaveBeenCalledExactlyOnceWith(" Front counter ");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
  expect((await question(app)).open).toBe(false);
});
it("same-event edits and reverts update the native leave warning", async () => {
  const { screen } = await mount();
  change(screen, "Counter");
  expect(unload()).toBe(true);
  change(screen, "");
  expect(unload()).toBe(false);
});
it("a refused join keeps the typed name protected", async () => {
  const { app, screen, api } = await mount({
    join: vi.fn(async () => {
      throw { code: "device.pairing_closed" };
    }),
  });
  await fill(screen, "Front counter");
  submit(screen);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-form-actions")?.error).not.toBe("");
  expect(api.join).toHaveBeenCalledExactlyOnceWith("Front counter");
  expect(unload()).toBe(true);
  const kept = leave(app);
  await choice(app, "keep");
  expect(await kept).toBe("kept");
  expect(nameField(screen).value).toBe("Front counter");
});
it("join success commits the captured name while retaining later delivered input", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const { app, screen, api } = await mount({ join: vi.fn(() => pending) });
  await fill(screen, "Front counter");
  submit(screen);
  change(screen, "New counter");
  resolve({ joinId: "join-1", verificationNumber: "47" });
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-number]")).toBeTruthy();
  expect(unload()).toBe(true);
  const discarded = leave(app);
  await choice(app, "discard");
  expect(await discarded).toBe("proceeded");
  expect(unload()).toBe(false);
  expect(api.join).toHaveBeenCalledExactlyOnceWith("Front counter");
  expect(screen.shadowRoot!.querySelector("[data-number]")?.textContent?.trim()).toBe("47");
});
it("departure aborts an unanswered question and clears a reconnected name", async () => {
  const { app, screen } = await mount();
  await fill(screen, "Private name");
  const pending = leave(app);
  const q = await question(app);
  expect(q.open).toBe(true);
  const stale = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.remove();
  await expect.poll(() => q.open).toBe(false);
  stale.click();
  expect(await pending).toBe("stale");
  expect(unload()).toBe(false);
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  expect(nameField(screen).value).toBe("");
  expect(unload()).toBe(false);
});
it("a departed join reply cannot replace a new visit's name or start its poll", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const { app, screen, api } = await mount({ join: vi.fn(() => pending) });
  await fill(screen, "Old counter");
  submit(screen);
  screen.remove();
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  await fill(screen, "New counter");
  vi.useFakeTimers();
  resolve({ joinId: "old-join", verificationNumber: "99" });
  await vi.advanceTimersByTimeAsync(2001);
  await screen.updateComplete;
  expect(nameField(screen)?.value).toBe("New counter");
  expect(screen.shadowRoot!.querySelector("[data-number]")).toBeNull();
  expect(api.joinStatus).not.toHaveBeenCalled();
  expect(unload()).toBe(true);
});
it("a departed approval poll cannot emit enrollment for a new visit", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const { app, screen } = await mount({ joinStatus: () => pending });
  await fill(screen, "Old counter");
  vi.useFakeTimers();
  submit(screen);
  await vi.advanceTimersByTimeAsync(2001);
  await screen.updateComplete;
  screen.remove();
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  change(screen, "New counter");
  resolve({ status: "approved" });
  await vi.advanceTimersByTimeAsync(0);
  await screen.updateComplete;
  expect(app.approved).toEqual([]);
  expect(nameField(screen)?.value).toBe("New counter");
  expect(unload()).toBe(true);
});
it("retained departed name and submit controls cannot issue a join or replace a new visit", async () => {
  const { app, screen, api } = await mount();
  await fill(screen, "Private name");
  const input = nameField(screen);
  const button = screen.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!;
  screen.remove();
  input.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Detached value" },
      bubbles: true,
      composed: true,
    }),
  );
  button.click();
  await Promise.resolve();
  expect(api.join).not.toHaveBeenCalled();
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  expect(nameField(screen).value).toBe("");
  expect(unload()).toBe(false);
});

for (const locale of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`native enrolment Keep/Escape/Discard, ${locale}, ${theme}, ${width}`, async () => {
        setLocale(locale);
        await page.viewport(width, 900);
        const { app, screen, api } = await mount({}, theme);
        await fill(screen, "Front counter");
        const native = nameField(screen).shadowRoot!.querySelector("input")!;
        const back = app
          .shadowRoot!.querySelector("[data-back]")!
          .shadowRoot!.querySelector("button")!;
        await userEvent.click(back);
        const q = await question(app);
        expect(q.open).toBe(true);
        const keep = q
          .shadowRoot!.querySelector("[data-choice=keep]")!
          .shadowRoot!.querySelector("button")!;
        await expect.poll(() => keep.matches(":focus")).toBe(true);
        await expectNoA11yViolations(q);
        await page.screenshot({
          path: `__screenshots__/w69-till-pages-look/enrol-${locale}-${theme}-${width}-warning.png`,
        });
        await userEvent.keyboard("{Escape}");
        await expect.poll(() => q.open).toBe(false);
        expect(native.value).toBe("Front counter");
        expect(app.leaves).toBe(0);
        await expect.poll(() => back.matches(":focus")).toBe(true);
        await page.screenshot({
          path: `__screenshots__/w69-till-pages-look/enrol-${locale}-${theme}-${width}-kept.png`,
        });
        await userEvent.click(back);
        await choice(app, "keep");
        expect(native.value).toBe("Front counter");
        await userEvent.click(back);
        await choice(app, "discard");
        await expect.poll(() => app.leaves).toBe(1);
        expect(native.value).toBe("");
        expect(unload()).toBe(false);
        expect(api.join).not.toHaveBeenCalled();
        await page.viewport(1280, 900);
      });
