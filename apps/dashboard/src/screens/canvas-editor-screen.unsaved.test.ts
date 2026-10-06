import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, NavigationGuard } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { Canvas, DashboardApi } from "../api/client.js";
import "./canvas-editor-screen.js";

const originalUrl = location.href;
const canvas: Canvas = {
  id: "c1",
  name: "Counter",
  definition: {
    formFactor: "till",
    tabs: [
      {
        key: "counter",
        title: "Counter",
        columns: 12,
        cards: [
          { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
          { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
          { type: "total", colSpan: 4, rowSpan: 1, config: {} },
          { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
        ],
      },
    ],
  },
};
class CanvasLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api = {
    listCanvases: async () => [canvas],
    getCanvas: async () => canvas,
    updateCanvas: vi.fn(async () => undefined),
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
  history.replaceState(null, "", originalUrl);
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

async function editor(api?: DashboardApi) {
  const { app, screen } = await fixture("create", api);
  const dialog =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>("[data-dialog=create]")!;
  expect(await dialog.requestClose("cancel")).toBe(true);
  await closeReportsDelivered();
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=editor-name]")?.textContent)
    .toBe("Counter");
  return { app, screen };
}
async function canvasName(screen: Screen, value: string) {
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=canvas-settings]")!.click();
  await screen.updateComplete;
  const field =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=canvas-name]")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await screen.updateComplete;
  return input;
}
it("canvas page Cancel keeps edited name then Discard returns to list without writing", async () => {
  const { app, screen } = await editor();
  const input = await canvasName(screen, "Evening");
  expect(unload()).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
  expect((await question(app)).open).toBe(true);
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe("Evening");
  await choose(app, "keep");
  expect(input.value).toBe("Evening");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
  await choose(app, "discard");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=canvas-row-c1]"))
    .not.toBeNull();
  expect(unload()).toBe(false);
  expect(app.api.updateCanvas).not.toHaveBeenCalled();
});
it("canvas page reverted name closes cleanly", async () => {
  const { app, screen } = await editor();
  expect(unload()).toBe(false);
  await canvasName(screen, "Evening");
  expect(unload()).toBe(true);
  await canvasName(screen, " Counter ");
  expect(unload()).toBe(false);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=canvas-row-c1]"))
    .not.toBeNull();
  expect((await question(app)).open).toBe(false);
});
it("canvas page nested card changes are protected and reversing them clears the scope", async () => {
  const { app, screen } = await editor();
  const preview = screen.shadowRoot!.querySelector("canvas-grid-preview")!;
  preview.dispatchEvent(
    new CustomEvent("resize-card", { detail: { index: 0, colSpan: 7, rowSpan: 6 } }),
  );
  await screen.updateComplete;
  expect(unload()).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
  expect((await question(app)).open).toBe(true);
  await choose(app, "keep");
  preview.dispatchEvent(
    new CustomEvent("resize-card", { detail: { index: 0, colSpan: 8, rowSpan: 6 } }),
  );
  await screen.updateComplete;
  expect(unload()).toBe(false);
});
it("canvas page newly created local definition remains unsaved before its first write", async () => {
  const { app, screen } = await fixture("create");
  await name(screen, "create", "Evening");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-create]")!.click();
  await screen.updateComplete;
  expect(unload()).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
  expect((await question(app)).open).toBe(true);
  await choose(app, "keep");
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe("Evening");
  expect(app.api.createCanvas).not.toHaveBeenCalled();
});
it("canvas page detach aborts a question and reconnect retains its original baseline", async () => {
  const { app, screen } = await editor();
  await canvasName(screen, "Evening");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
  const old = await question(app);
  expect(old.open).toBe(true);
  screen.remove();
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  expect(unload()).toBe(true);
  old.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe("Evening");
});
for (const accepted of [false, true]) {
  it(`canvas page ${accepted ? "accepted write commits submitted definition before failed refresh" : "refused write retains protection"}`, async () => {
    let finish!: () => void;
    let written = false;
    const api = {
      listCanvases: async () => {
        if (written) throw { code: "connection.failed" };
        return [canvas];
      },
      getCanvas: async () => canvas,
      updateCanvas: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (!accepted) throw { code: "connection.failed" };
        written = true;
      }),
    } as unknown as DashboardApi;
    const { app, screen } = await editor(api);
    await canvasName(screen, "Evening");
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await screen.updateComplete;
    expect(api.updateCanvas).toHaveBeenCalledExactlyOnceWith("c1", "Evening", canvas.definition);
    if (accepted) await canvasName(screen, "Late edit");
    finish();
    await expect.poll(() => screen.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    expect(unload()).toBe(true);
    expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe(
      accepted ? "Late edit" : "Evening",
    );
    if (accepted) {
      await canvasName(screen, "Evening");
      expect(unload()).toBe(false);
    }
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
    expect((await question(app)).open).toBe(!accepted);
  });
}

for (const accepted of [false, true]) {
  it(`canvas page departed ${accepted ? "accepted" : "refused"} write cannot replace a reconnected draft or message`, async () => {
    let finish!: () => void;
    const api = {
      listCanvases: vi.fn(async () => [canvas]),
      getCanvas: async () => canvas,
      updateCanvas: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (!accepted) throw { code: "canvas.name_taken" };
      }),
    } as unknown as DashboardApi;
    const { app, screen } = await editor(api);
    await canvasName(screen, "Evening");
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await screen.updateComplete;
    screen.remove();
    expect(unload()).toBe(false);
    app.shadowRoot!.appendChild(screen);
    await screen.updateComplete;
    const reads = (api.listCanvases as ReturnType<typeof vi.fn>).mock.calls.length;
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")?.textContent).toBe(
      "Evening",
    );
    expect(screen.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(unload()).toBe(true);
    expect(api.listCanvases).toHaveBeenCalledTimes(reads);
    expect(
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
        .disabled,
    ).toBe(false);
  });
}
it("canvas page unchanged successful save retires its scope before list refresh", async () => {
  let dirtyDuringRead: boolean | undefined;
  let written = false;
  const api = {
    listCanvases: async () => {
      if (written) {
        dirtyDuringRead = app.leave.coordinator.isDirty();
        throw { code: "connection.failed" };
      }
      return [canvas];
    },
    getCanvas: async () => canvas,
    updateCanvas: vi.fn(async () => {
      written = true;
    }),
  } as unknown as DashboardApi;
  const { app, screen } = await editor(api);
  await canvasName(screen, "Evening");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect.poll(() => dirtyDuringRead).toBe(false);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=canvas-row-c1]"))
    .not.toBeNull();
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(false);
});
it("canvas page accepted write invalidates an outstanding discard of a newer draft", async () => {
  let finish!: () => void;
  const api = {
    listCanvases: async () => [canvas],
    getCanvas: async () => canvas,
    updateCanvas: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  } as unknown as DashboardApi;
  const { app, screen } = await editor(api);
  await canvasName(screen, "Evening");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await screen.updateComplete;
  await canvasName(screen, "Newer");
  const pending = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed: () => screen.remove(),
  });
  const old = await question(app);
  expect(old.open).toBe(true);
  finish();
  expect(await pending).toBe("stale");
  old.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  expect(screen.isConnected).toBe(true);
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe("Newer");
  expect(unload()).toBe(true);
});
it("canvas page changing a draft aborts an outstanding Cancel question", async () => {
  const { app, screen } = await editor();
  await canvasName(screen, "Evening");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
  const old = await question(app);
  expect(old.open).toBe(true);
  screen
    .shadowRoot!.querySelector("[data-test=canvas-name]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Newer" } }));
  await screen.updateComplete;
  expect((await question(app)).open).toBe(false);
  old.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe("Newer");
});

it("canvas page old write cannot release a new save's busy gate after reconnect", async () => {
  const finishes: Array<() => void> = [];
  const api = {
    listCanvases: async () => [canvas],
    getCanvas: async () => canvas,
    updateCanvas: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishes.push(resolve);
        }),
    ),
  } as unknown as DashboardApi;
  const { app, screen } = await editor(api);
  await canvasName(screen, "Evening");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await screen.updateComplete;
  screen.remove();
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await screen.updateComplete;
  expect(finishes).toHaveLength(2);
  finishes[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
      .disabled,
  ).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
  expect((await question(app)).open).toBe(false);
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe("Evening");
  finishes[1]!();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=canvas-row-c1]"))
    .not.toBeNull();
  expect(unload()).toBe(false);
});

it("canvas page unsaved new definition survives disconnect without a persisted canvas URL", async () => {
  const { app, screen } = await fixture("create");
  await name(screen, "create", "Evening");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-create]")!.click();
  await screen.updateComplete;
  expect(unload()).toBe(true);
  screen.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")?.textContent).toBe("Evening");
  expect(unload()).toBe(true);
});

it("canvas page first accepted save commits before its canvas URL changes", async () => {
  const { app, screen } = await fixture("create");
  await name(screen, "create", "Evening");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-create]")!.click();
  await screen.updateComplete;
  expect(unload()).toBe(true);
  const guard = new NavigationGuard(window, {
    isDirty: () => app.leave.coordinator.isDirty(),
    request: (proceed) =>
      app.leave.coordinator.request({ scopes: [screen], reason: "navigation", proceed }),
  });
  try {
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await expect.poll(() => app.api.createCanvas).toHaveBeenCalledOnce();
    await screen.updateComplete;
    expect((await question(app)).open).toBe(false);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=canvas-row-c1]"))
      .not.toBeNull();
    expect(unload()).toBe(false);
    await expect.poll(() => location.pathname).toBe("/manage/canvas-editor");
  } finally {
    guard.dispose();
  }
});

it("canvas page departed Save and name controls cannot submit or alter its retained draft", async () => {
  const { app, screen } = await editor();
  await canvasName(screen, "Evening");
  screen.remove();
  screen
    .shadowRoot!.querySelector("[data-test=canvas-name]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Departed" } }));
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect(app.api.updateCanvas).not.toHaveBeenCalled();
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=editor-name]")!.textContent).toBe("Evening");
  expect(unload()).toBe(true);
});
