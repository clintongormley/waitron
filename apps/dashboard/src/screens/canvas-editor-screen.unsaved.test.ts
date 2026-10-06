import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { Canvas, DashboardApi } from "../api/client.js";
import "./canvas-editor-screen.js";

const canvas: Canvas = {
  id: "c1",
  name: "Counter",
  definition: { formFactor: "till", tabs: [] },
};
class CanvasLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api = {
    listCanvases: async () => [canvas],
    createCanvas: vi.fn(async () => ({ id: "copy" })),
  } as unknown as DashboardApi;
  override render() {
    return html`<dashboard-canvas-editor-screen .api=${this.api}></dashboard-canvas-editor-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("canvas-leave-test-app", CanvasLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Screen = HTMLElementTagNameMap["dashboard-canvas-editor-screen"];
type Kind = "create" | "duplicate";
async function fixture(kind: Kind, api?: DashboardApi) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<CanvasLeaveApp>(
    "canvas-leave-test-app",
    api ? { api } : {},
  );
  const screen = app.shadowRoot!.querySelector("dashboard-canvas-editor-screen")!;
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=duplicate-c1]"))
    .not.toBeNull();
  screen
    .shadowRoot!.querySelector<HTMLElement>(
      `[data-test=${kind === "create" ? "create" : "duplicate-c1"}]`,
    )!
    .click();
  await screen.updateComplete;
  const dialog = screen.shadowRoot!.querySelectorAll("wt-dialog")[kind === "create" ? 0 : 1]!;
  await dialog.updateComplete;
  return { app, screen, dialog };
}
async function name(screen: Screen, kind: Kind, value: string) {
  const field = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[data-test=${kind}-name]`,
  )!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await screen.updateComplete;
  return input;
}
async function question(app: CanvasLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function choose(app: CanvasLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await q.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
for (const kind of ["create", "duplicate"] as const) {
  it(`canvas ${kind} Escape preserves edited name until Discard`, async () => {
    const { app, screen, dialog } = await fixture(kind);
    const input = await name(screen, kind, "Evening counter");
    expect(unload()).toBe(true);
    let closes = 0;
    dialog.addEventListener("wt-close", () => closes++);
    input.focus();
    await userEvent.keyboard("{Escape}");
    expect((await question(app)).open).toBe(true);
    expect(dialog.open).toBe(true);
    expect(closes).toBe(0);
    await choose(app, "keep");
    await expect
      .poll(
        () =>
          input.getRootNode() instanceof ShadowRoot &&
          (input.getRootNode() as ShadowRoot).activeElement,
      )
      .toBe(input);
    expect(input.value).toBe("Evening counter");
    await userEvent.keyboard("{Escape}");
    await choose(app, "discard");
    await expect.poll(() => dialog.open).toBe(false);
    await closeReportsDelivered();
    expect(closes).toBe(1);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(unload()).toBe(false);
    expect(app.api.createCanvas).not.toHaveBeenCalled();
  });
  it(`untouched and reverted canvas ${kind} Escape is clean`, async () => {
    const { app, screen, dialog } = await fixture(kind);
    const initial = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `[data-test=${kind}-name]`,
    )!.value;
    await name(screen, kind, "Changed");
    expect(unload()).toBe(true);
    await name(screen, kind, initial);
    expect(unload()).toBe(false);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => dialog.open).toBe(false);
    expect((await question(app)).open).toBe(false);
  });
  it(`canvas ${kind} close reports from a child leave its name dialog open`, async () => {
    const { screen, dialog } = await fixture(kind);
    screen
      .shadowRoot!.querySelector(`[data-test=${kind}-name]`)!
      .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await screen.updateComplete;
    expect(dialog.open).toBe(true);
  });
  it(`departed canvas ${kind} controls cannot change or submit retained entry`, async () => {
    const { app, screen } = await fixture(kind);
    await name(screen, kind, "Retained");
    screen.remove();
    expect(unload()).toBe(false);
    screen
      .shadowRoot!.querySelector(`[data-test=${kind}-name]`)!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Departed" } }));
    screen.shadowRoot!.querySelector<HTMLElement>(`[data-test=confirm-${kind}]`)!.click();
    expect(app.api.createCanvas).not.toHaveBeenCalled();
    app.shadowRoot!.appendChild(screen);
    await screen.updateComplete;
    expect(
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        `[data-test=${kind}-name]`,
      )!.value,
    ).toBe("Retained");
    expect(unload()).toBe(true);
  });
}
it("canvas Create protects form factor alone and a reverted choice is clean", async () => {
  const { app, screen, dialog } = await fixture("create");
  const field = screen.shadowRoot!.querySelector("[data-test=create-form-factor]")!;
  await chooseOption(field, "kds");
  expect(unload()).toBe(true);
  const pending = dialog.requestClose("cancel");
  expect((await question(app)).open).toBe(true);
  await choose(app, "keep");
  expect(await pending).toBe(false);
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[data-test=create-form-factor]",
    )!.value,
  ).toBe("kds");
  await chooseOption(field, "till");
  expect(unload()).toBe(false);
  expect(await dialog.requestClose("cancel")).toBe(true);
});
it("canvas Create advances directly to the local editor without a discard warning", async () => {
  const { app, screen, dialog } = await fixture("create");
  await name(screen, "create", "Evening counter");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-create]")!.click();
  await screen.updateComplete;
  await closeReportsDelivered();
  expect(dialog.open).toBe(false);
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe(
    "Evening counter",
  );
  expect((await question(app)).open).toBe(false);
  expect(app.api.createCanvas).not.toHaveBeenCalled();
});
for (const success of [false, true]) {
  it(`canvas Duplicate ${success ? "retires entry before failed refresh" : "refusal retains entry"}`, async () => {
    let finish!: () => void;
    let written = false;
    let dirtyDuringRefresh: boolean | undefined;
    const api = {
      listCanvases: async () => {
        if (written) {
          dirtyDuringRefresh = app.leave.coordinator.isDirty();
          throw { code: "connection.failed" };
        }
        return [canvas];
      },
      createCanvas: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (!success) throw { code: "connection.failed" };
        written = true;
        return { id: "copy" };
      }),
    } as unknown as DashboardApi;
    const { app, screen, dialog } = await fixture("duplicate", api);
    await name(screen, "duplicate", "Evening counter");
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-duplicate]")!.click();
    await screen.updateComplete;
    expect(dialog.open).toBe(true);
    expect(await dialog.requestClose("cancel")).toBe(false);
    expect((await question(app)).open).toBe(false);
    await userEvent.keyboard("{Escape}");
    expect(dialog.open).toBe(true);
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-duplicate]")!.click();
    expect(api.createCanvas).toHaveBeenCalledExactlyOnceWith("Evening counter", canvas.definition);
    finish();
    if (success) {
      await expect.poll(() => dirtyDuringRefresh).toBe(false);
      await expect.poll(() => dialog.open).toBe(false);
      expect(unload()).toBe(false);
    } else {
      await expect.poll(() => dialog.dismissible).toBe(true);
      expect(
        screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
          "[data-test=duplicate-name]",
        )!.value,
      ).toBe("Evening counter");
      const field = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        "[data-test=duplicate-name]",
      )!;
      await field.updateComplete;
      field.shadowRoot!.querySelector("input")!.focus();
      await userEvent.keyboard("{Escape}");
      expect((await question(app)).open).toBe(true);
    }
  });
}
for (const kind of ["create", "duplicate"] as const) {
  it(`untouched canvas ${kind} Escape closes without asking`, async () => {
    const { app, screen, dialog } = await fixture(kind);
    const field = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `[data-test=${kind}-name]`,
    )!;
    await field.updateComplete;
    field.shadowRoot!.querySelector("input")!.focus();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => dialog.open).toBe(false);
    expect((await question(app)).open).toBe(false);
    expect(unload()).toBe(false);
  });
  it(`canvas ${kind} ancestor leave covers its name and Keep retains it`, async () => {
    const { app, screen, dialog } = await fixture(kind);
    await name(screen, kind, "Evening counter");
    let proceeded = 0;
    const request = app.leave.coordinator.request({
      scopes: [screen],
      reason: "navigation",
      proceed: () => {
        proceeded++;
      },
    });
    expect((await question(app)).open).toBe(true);
    await choose(app, "keep");
    expect(await request).toBe("kept");
    expect(proceeded).toBe(0);
    expect(dialog.open).toBe(true);
    expect(
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        `[data-test=${kind}-name]`,
      )!.value,
    ).toBe("Evening counter");
  });
  it(`canvas ${kind} disconnect aborts the question and reattachment retains protection`, async () => {
    const { app, screen, dialog } = await fixture(kind);
    await name(screen, kind, "Evening counter");
    const pending = dialog.requestClose("cancel");
    const old = await question(app);
    expect(old.open).toBe(true);
    screen.remove();
    expect(await pending).toBe(false);
    expect((await question(app)).open).toBe(false);
    old.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: "discard" },
        bubbles: true,
        composed: true,
      }),
    );
    app.shadowRoot!.appendChild(screen);
    await screen.updateComplete;
    expect(
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        `[data-test=${kind}-name]`,
      )!.value,
    ).toBe("Evening counter");
    expect(unload()).toBe(true);
  });
}
it("canvas Create submitting while a question is open invalidates its old Discard", async () => {
  const { app, screen, dialog } = await fixture("create");
  await name(screen, "create", "Evening counter");
  const pending = dialog.requestClose("cancel");
  const old = await question(app);
  expect(old.open).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-create]")!.click();
  await screen.updateComplete;
  expect(await pending).toBe(false);
  expect((await question(app)).open).toBe(false);
  old.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe(
    "Evening counter",
  );
  expect(app.api.createCanvas).not.toHaveBeenCalled();
});
it("canvas Duplicate busy submission invalidates an old question and blocks name edits", async () => {
  let finish!: () => void;
  const api = {
    listCanvases: async () => [canvas],
    createCanvas: vi.fn(
      () =>
        new Promise<{ id: string }>((resolve) => {
          finish = () => resolve({ id: "copy" });
        }),
    ),
  } as unknown as DashboardApi;
  const { app, screen, dialog } = await fixture("duplicate", api);
  await name(screen, "duplicate", "Evening counter");
  const pending = dialog.requestClose("cancel");
  const old = await question(app);
  expect(old.open).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-duplicate]")!.click();
  await screen.updateComplete;
  expect(await pending).toBe(false);
  expect((await question(app)).open).toBe(false);
  const field = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[data-test=duplicate-name]",
  )!;
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Too late" } }));
  old.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  expect(dialog.open).toBe(true);
  expect(field.value).toBe("Evening counter");
  expect(unload()).toBe(true);
  finish();
  await expect.poll(() => dialog.open).toBe(false);
});
it("invalid raw Duplicate name remains protected while empty submission is refused", async () => {
  const { app, screen, dialog } = await fixture("duplicate");
  await name(screen, "duplicate", "   ");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-duplicate]")!.click();
  await screen.updateComplete;
  expect(app.api.createCanvas).not.toHaveBeenCalled();
  const pending = dialog.requestClose("cancel");
  expect((await question(app)).open).toBe(true);
  await choose(app, "keep");
  expect(await pending).toBe(false);
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "[data-test=duplicate-name]",
    )!.value,
  ).toBe("   ");
});
