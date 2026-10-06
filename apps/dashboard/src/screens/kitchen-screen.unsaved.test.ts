import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, type WtInput } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, KitchenTimingDefaults } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./kitchen-screen.js";

class KitchenLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-kitchen-screen .api=${this.api}></dashboard-kitchen-screen>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("kitchen-leave-test-app", KitchenLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Screen = HTMLElementTagNameMap["dashboard-kitchen-screen"];
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(overrides: Partial<DashboardApi> = {}) {
  let stored = { warmAfterMinutes: 3, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 };
  const writes: KitchenTimingDefaults[] = [];
  const liveData = new LiveData();
  const api = {
    liveData,
    listCoursesWithDisabled: async () => [],
    getBumpMode: async () => ({ mode: "line" }),
    getFireControl: async () => ({ mode: "waiter" }),
    setBumpMode: async () => {},
    setFireControl: async () => {},
    getKitchenTimingDefaults: async () => ({ ...stored }),
    setKitchenTimingDefaults: async (body: KitchenTimingDefaults) => {
      writes.push({ ...body });
      await overrides.setKitchenTimingDefaults?.(body);
      stored = { ...body };
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "setKitchenTimingDefaults"),
    ),
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<KitchenLeaveApp>("kitchen-leave-test-app", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-kitchen-screen")!;
  await expect.poll(() => screen.shadowRoot?.querySelector("[data-test=edit-timing]")).toBeTruthy();
  click(screen, "edit-timing");
  await screen.updateComplete;
  return { app, screen, writes, liveData };
}
function click(screen: Screen, test: string) {
  screen.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!.click();
}
function input(screen: Screen, name = "warmAfterMinutes") {
  return screen.shadowRoot!.querySelector<WtInput>(`[name=${name}]`)!;
}
async function change(screen: Screen, value: string, name = "warmAfterMinutes") {
  await input(screen, name).updateComplete;
  await userEvent.fill(
    page.elementLocator(input(screen, name).shadowRoot!.querySelector("input")!),
    value,
  );
  await screen.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: KitchenLeaveApp) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
}
async function choose(app: KitchenLeaveApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => warning.open).toBe(false);
}

for (const how of ["cancel", "escape"] as const) {
  it(`protects late flags from native ${how}, keeps their values, and discards without writing`, async () => {
    const { app, screen, writes } = await mount();
    await change(screen, "4");
    expect(unload()).toBe(true);
    async function close() {
      if (how === "cancel") click(screen, "cancel-timing");
      else {
        const native = input(screen).shadowRoot!.querySelector<HTMLInputElement>("input")!;
        let escape: KeyboardEvent | undefined;
        native.addEventListener(
          "keydown",
          (event) => {
            escape = event;
          },
          { once: true },
        );
        native.focus();
        await userEvent.keyboard("{Escape}");
        expect(escape?.defaultPrevented).toBe(true);
      }
    }
    await close();
    await choose(app, "keep");
    expect(input(screen).value).toBe("4");
    expect(writes).toEqual([]);
    await close();
    await choose(app, "discard");
    await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=timing-form]")).toBeNull();
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
}
for (const [name, changed, original] of [
  ["warmAfterMinutes", "4", "3"],
  ["overdueAfterMinutes", "8", "7"],
  ["forgottenAfterMinutes", "13", "12"],
]) {
  it(`compares ${name} by its submitted number and exempts a normalized revert`, async () => {
    const { app, screen } = await mount();
    expect(await leave(app)).toBe("proceeded");
    await change(screen, changed!, name);
    expect(unload()).toBe(true);
    const request = leave(app);
    await choose(app, "keep");
    expect(await request).toBe("kept");
    await change(screen, original! + ".0", name);
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
  });
}
it("keeps an invalid empty field dirty without submitting it", async () => {
  const { app, screen, writes } = await mount();
  await change(screen, "");
  click(screen, "save-timing");
  await screen.updateComplete;
  expect(writes).toEqual([]);
  expect(unload()).toBe(true);
  const request = leave(app);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(input(screen).value).toBe("");
});

it("starting a timing write invalidates an unanswered discard without letting Cancel interrupt it", async () => {
  const pending = deferred();
  const { app, screen, writes } = await mount({ setKitchenTimingDefaults: () => pending.promise });
  await change(screen, "4");
  const request = leave(app);
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  const oldDiscard = warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  click(screen, "save-timing");
  await expect.poll(() => warning.open).toBe(false);
  expect(await request).toBe("stale");
  oldDiscard.click();
  click(screen, "cancel-timing");
  expect(input(screen).value).toBe("4");
  expect(writes).toEqual([
    { warmAfterMinutes: 4, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 },
  ]);
  pending.resolve();
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=timing-form]")).toBeNull();
  expect(unload()).toBe(false);
});

it("a live timing read cannot change an edited baseline or dismiss an unchanged question", async () => {
  let reads = 0;
  let latest = { warmAfterMinutes: 3, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 };
  const { app, screen, liveData } = await mount({
    getKitchenTimingDefaults: async () => {
      reads++;
      return { ...latest };
    },
  });
  await change(screen, "4");
  const request = leave(app);
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  latest = { warmAfterMinutes: 4, overdueAfterMinutes: 8, forgottenAfterMinutes: 13 };
  liveData.invalidate([{ type: "kitchen_timing_defaults" }]);
  await expect.poll(() => reads).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(warning.open).toBe(true);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  await change(screen, "3");
  expect(unload()).toBe(false);
});
it("a refused timing save retains the edited values and leave protection", async () => {
  const { app, screen, writes } = await mount({
    setKitchenTimingDefaults: async () => {
      throw { code: "connection.failed" };
    },
  });
  await change(screen, "4");
  click(screen, "save-timing");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  expect(writes).toEqual([
    { warmAfterMinutes: 4, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 },
  ]);
  expect(unload()).toBe(true);
  const request = leave(app);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(input(screen).value).toBe("4");
});
it("an accepted timing save stays clean when its separate refresh fails", async () => {
  let reads = 0;
  const { app, screen, writes } = await mount({
    getKitchenTimingDefaults: async () => {
      if (++reads > 1) throw { code: "connection.failed" };
      return { warmAfterMinutes: 3, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 };
    },
  });
  await change(screen, "4");
  click(screen, "save-timing");
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=timing-form]")).toBeNull();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=kitchen-error]"))
    .toBeTruthy();
  expect(writes).toEqual([
    { warmAfterMinutes: 4, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 },
  ]);
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});
it("commits only the submitted timing snapshot while newer input remains protected", async () => {
  const pending = deferred();
  const { app, screen, writes } = await mount({ setKitchenTimingDefaults: () => pending.promise });
  await change(screen, "4");
  click(screen, "save-timing");
  await screen.updateComplete;
  input(screen).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "5" }, bubbles: true, composed: true }),
  );
  pending.resolve();
  await expect.poll(() => input(screen)?.disabled).toBe(false);
  expect(input(screen).value).toBe("5");
  expect(unload()).toBe(true);
  expect(writes).toEqual([
    { warmAfterMinutes: 4, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 },
  ]);
  const request = leave(app);
  await choose(app, "discard");
  expect(await request).toBe("proceeded");
  expect(input(screen).value).toBe("4");
  expect(unload()).toBe(false);
});
it("disconnect releases the timing draft and rejects a departed write's result", async () => {
  const pending = deferred();
  const { app, screen } = await mount({ setKitchenTimingDefaults: () => pending.promise });
  await change(screen, "4");
  click(screen, "save-timing");
  await screen.updateComplete;
  screen.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(screen);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=edit-timing]")).toBeTruthy();
  click(screen, "edit-timing");
  await screen.updateComplete;
  await change(screen, "5");
  pending.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(input(screen).value).toBe("5");
  expect(unload()).toBe(true);
});

it("departed timing controls cannot edit, save or cancel a reconnected opening", async () => {
  const { app, screen, writes } = await mount();
  await change(screen, "4");
  const oldInput = input(screen);
  const oldSave = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save-timing]")!;
  const oldCancel = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-timing]")!;
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=edit-timing]")).toBeTruthy();
  click(screen, "edit-timing");
  await screen.updateComplete;
  await change(screen, "5");
  oldInput.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "6" }, bubbles: true, composed: true }),
  );
  oldSave.click();
  oldCancel.click();
  await screen.updateComplete;
  expect(input(screen).value).toBe("5");
  expect(writes).toEqual([]);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});

it("a departed timing refusal cannot replace a new opening's error or release its write gate", async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const { app, screen } = await mount({
    setKitchenTimingDefaults: () => (++calls === 1 ? first.promise : second.promise),
  });
  await change(screen, "4");
  click(screen, "save-timing");
  await screen.updateComplete;
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=edit-timing]")).toBeTruthy();
  click(screen, "edit-timing");
  await screen.updateComplete;
  await change(screen, "5");
  click(screen, "save-timing");
  await screen.updateComplete;
  first.reject({ code: "connection.failed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(input(screen).value).toBe("5");
  expect(input(screen).disabled).toBe(true);
  expect(screen.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  second.resolve();
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=timing-form]")).toBeNull();
  expect(unload()).toBe(false);
});

for (const kind of ["bump", "fire"] as const) {
  for (const result of ["stored", "refused"] as const) {
    it(`the immediate ${kind} choice stays exempt while writing and after ${result}`, async () => {
      const pending = deferred();
      const values: string[] = [];
      const write = async (value: string) => {
        values.push(value);
        await pending.promise;
      };
      const { app, screen } = await mount(
        kind === "bump" ? { setBumpMode: write } : { setFireControl: write },
      );
      const value = kind === "bump" ? "ticket" : "kitchen";
      click(screen, `${kind}-${value}`);
      await screen.updateComplete;
      expect(values).toEqual([value]);
      expect(unload()).toBe(false);
      expect(await leave(app)).toBe("proceeded");
      if (result === "stored") pending.resolve();
      else pending.reject({ code: "connection.failed" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await screen.updateComplete;
      if (result === "refused")
        expect(
          screen.shadowRoot!.querySelector("[data-test=kitchen-error]")!.textContent!.trim(),
        ).not.toBe("");
      expect(unload()).toBe(false);
      expect(await leave(app)).toBe("proceeded");
      expect(values).toEqual([value]);
    });
  }
}

it("an immediate kitchen choice leaves a separate late-flags question and its edited values intact", async () => {
  const { app, screen } = await mount({ setFireControl: async () => {} });
  await change(screen, "4");
  const request = leave(app);
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  click(screen, "fire-kitchen");
  await screen.updateComplete;
  expect(warning.open).toBe(true);
  expect(input(screen).value).toBe("4");
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(unload()).toBe(true);
});
