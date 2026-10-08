import { LitElement, html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { Canvas, DashboardApi } from "../api/client.js";
import "./canvas-editor-screen.js";
import type { CanvasEditorScreen } from "./canvas-editor-screen.js";

const originalUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
});
afterEach(() => vi.restoreAllMocks());

// Every part of a definition the editor shows holds something: two tabs, spans, a config value and a
// visibility rule, in the shape the server stores them.
const definition = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
        { type: "total", colSpan: 4, rowSpan: 1, config: {} },
        { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
        { type: "held-orders", colSpan: 8, rowSpan: 2, config: {}, visibleWhen: ["has-parked"] },
      ],
    },
    { key: "drinks", title: "Drinks", columns: 6, cards: [] },
  ],
};
const stored: Canvas = { id: "c1", name: "Counter till", definition };

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listCanvases: vi.fn().mockResolvedValue([stored]),
    getCanvas: vi.fn().mockResolvedValue(structuredClone(stored)),
    createCanvas: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCanvas: vi.fn().mockResolvedValue(undefined),
    deleteCanvas: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

const $ = <T extends HTMLElement = HTMLElement>(el: CanvasEditorScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const action = (el: CanvasEditorScreen, test: string) =>
  $<HTMLElementTagNameMap["wt-button"]>(el, `[data-test=${test}]`)!;

async function state(el: CanvasEditorScreen, test = "save") {
  await el.updateComplete;
  const button = action(el, test);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (el: CanvasEditorScreen) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};

/** A real pointer press on the inner button, once nothing is moving it; `force` presses a disabled
 * one too. */
async function press(el: CanvasEditorScreen, test = "save") {
  const button = action(el, test).shadowRoot!.querySelector("button")!;
  let before = "";
  for (;;) {
    await frame();
    const now = JSON.stringify(button.getBoundingClientRect());
    if (now === before) break;
    before = now;
  }
  await userEvent.click(page.elementLocator(button), { force: true });
  await el.updateComplete;
}

async function type(el: CanvasEditorScreen, test: string, value: string) {
  const field = $<HTMLElementTagNameMap["wt-input"]>(el, `[data-test=${test}]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

async function click(el: CanvasEditorScreen, test: string) {
  action(el, test).click();
  await el.updateComplete;
}

function selectCard(el: CanvasEditorScreen, index: number) {
  $(el, "canvas-grid-preview")!.dispatchEvent(
    new CustomEvent("select-card", { detail: { index }, bubbles: true, composed: true }),
  );
  return el.updateComplete;
}

function toggle(el: CanvasEditorScreen, test: string, checked: boolean) {
  $(el, `[data-test=${test}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  return el.updateComplete;
}

async function mount(api: DashboardApi) {
  const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
  await vi.waitFor(() => expect($(el, "[data-test=edit-c1]")).not.toBeNull());
  return el;
}

async function openExisting(api: DashboardApi = stubApi()) {
  const el = await mount(api);
  $(el, "[data-test=edit-c1]")!.click();
  await vi.waitFor(() => expect($(el, "[data-test=save]")).not.toBeNull());
  await settle(el);
  return { el, api };
}

async function openNew(name: string, api: DashboardApi = stubApi()) {
  const el = await mount(api);
  $(el, "[data-test=create]")!.click();
  await el.updateComplete;
  await type(el, "create-name", name);
  await chooseOption($(el, "[data-test=create-form-factor]")!, "till");
  await el.updateComplete;
  $(el, "[data-test=confirm-create]")!.click();
  await vi.waitFor(() => expect($(el, "[data-test=save]")).not.toBeNull());
  await settle(el);
  return { el, api };
}

const alertText = (el: CanvasEditorScreen) => $(el, "[role=alert]")?.textContent?.trim() ?? "";

describe("the canvas editor's Save", () => {
  it("opens an existing canvas with everything it shows filled and Save quiet, and a press sends nothing", async () => {
    const { el, api } = await openExisting();
    expect($(el, "[data-test=editor-name]")!.textContent).toBe("Counter till");
    expect($(el, "[data-test=tab-btn-counter]")).not.toBeNull();
    expect($(el, "[data-test=tab-btn-drinks]")).not.toBeNull();
    await click(el, "canvas-settings");
    expect($<HTMLElement & { value: string }>(el, "[data-test=canvas-name]")!.value).toBe(
      "Counter till",
    );
    expect($<HTMLElement & { value: string }>(el, "[data-test=canvas-form-factor]")!.value).toBe(
      "till",
    );
    await selectCard(el, 0);
    expect($<HTMLElement & { value: string }>(el, "[data-test=config-columns]")!.value).toBe("4");
    expect(await state(el)).toEqual(quiet);
    await press(el);
    await settle(el);
    expect(api.updateCanvas).not.toHaveBeenCalled();
    expect(api.createCanvas).not.toHaveBeenCalled();
    expect($(el, "[data-test=editor-placeholder]")).not.toBeNull();
    expect(alertText(el)).toBe("");
  });

  it("a press that reaches an untouched Save's handler sends nothing and shows nothing", async () => {
    const { el, api } = await openExisting();
    // A host `.click()` reaches the listener even while the inner button is disabled.
    action(el, "save").click();
    await settle(el);
    expect(api.updateCanvas).not.toHaveBeenCalled();
    expect($(el, "[data-test=editor-placeholder]")).not.toBeNull();
    expect(alertText(el)).toBe("");
  });

  it("selecting a card, a tab, or a settings panel is not a change", async () => {
    const { el } = await openExisting();
    await selectCard(el, 1);
    await click(el, "tab-btn-drinks");
    await click(el, "tab-settings");
    await click(el, "canvas-settings");
    await click(el, "tab-btn-counter");
    expect(await state(el)).toEqual(quiet);
  });

  it("a name edit wakes Save, and typing it back quiets it, spaces and all", async () => {
    const { el } = await openExisting();
    await click(el, "canvas-settings");
    await type(el, "canvas-name", "Evening till");
    expect(await state(el)).toEqual(ready);
    await type(el, "canvas-name", "Counter till");
    expect(await state(el)).toEqual(quiet);
    await type(el, "canvas-name", " Counter till ");
    expect(await state(el)).toEqual(quiet);
  });

  it("the form factor wakes Save, and choosing it back quiets it", async () => {
    const { el } = await openExisting();
    await click(el, "canvas-settings");
    await chooseOption($(el, "[data-test=canvas-form-factor]")!, "phone-portrait");
    expect(await state(el)).toEqual(ready);
    await chooseOption($(el, "[data-test=canvas-form-factor]")!, "till");
    expect(await state(el)).toEqual(quiet);
  });

  it.each([
    ["a card's width", "card-colspan", "6", "8"],
    ["a card's height", "card-rowspan", "3", "6"],
    ["a card's grid columns", "config-columns", "5", "4"],
  ])("%s wakes Save, and typing it back quiets it", async (_, test, other, original) => {
    const { el } = await openExisting();
    await selectCard(el, 0);
    await type(el, test, other);
    expect(await state(el)).toEqual(ready);
    await type(el, test, original);
    expect(await state(el)).toEqual(quiet);
  });

  it("a card's visibility rule wakes Save, and turning it back quiets it", async () => {
    const { el } = await openExisting();
    await selectCard(el, 4);
    await toggle(el, "visible-has-parked", false);
    expect(await state(el)).toEqual(ready);
    await toggle(el, "visible-has-parked", true);
    expect(await state(el)).toEqual(quiet);
  });

  it("a card from the palette wakes Save, and removing it quiets it", async () => {
    const { el } = await openExisting();
    await click(el, "palette-notifications");
    expect(await state(el)).toEqual(ready);
    await selectCard(el, 5);
    await click(el, "card-remove");
    expect(await state(el)).toEqual(quiet);
  });

  it("moving a card wakes Save, and moving it back quiets it", async () => {
    const { el } = await openExisting();
    await selectCard(el, 0);
    await click(el, "card-down");
    expect(await state(el)).toEqual(ready);
    await click(el, "card-up");
    expect(await state(el)).toEqual(quiet);
  });

  it("a tab's title and columns wake Save, and typing them back quiets it", async () => {
    const { el } = await openExisting();
    await click(el, "tab-settings");
    await type(el, "tab-title", "Front");
    expect(await state(el)).toEqual(ready);
    await type(el, "tab-title", "Counter");
    expect(await state(el)).toEqual(quiet);
    await type(el, "tab-columns", "10");
    expect(await state(el)).toEqual(ready);
    await type(el, "tab-columns", "12");
    expect(await state(el)).toEqual(quiet);
  });

  it("an added tab wakes Save, and deleting it quiets it", async () => {
    const { el } = await openExisting();
    await click(el, "add-tab");
    expect(await state(el)).toEqual(ready);
    await click(el, "tab-settings");
    await click(el, "tab-delete");
    expect(el.shadowRoot!.querySelectorAll("[data-test^=tab-btn-]")).toHaveLength(2);
    expect(await state(el)).toEqual(quiet);
  });

  it("deleting a stored tab wakes Save", async () => {
    const { el } = await openExisting();
    await click(el, "tab-btn-drinks");
    await click(el, "tab-settings");
    await click(el, "tab-delete");
    expect(await state(el)).toEqual(ready);
  });

  it("a press after one edit sends that edit and the rest as it was read, and returns to the list", async () => {
    const { el, api } = await openExisting();
    await click(el, "canvas-settings");
    await type(el, "canvas-name", "Evening till");
    await press(el);
    await vi.waitFor(() => expect($(el, "[data-test=editor-placeholder]")).toBeNull());
    expect(api.updateCanvas).toHaveBeenCalledExactlyOnceWith("c1", "Evening till", definition);
  });

  it("an edit made while the save is in flight keeps the editor open, measured from what was sent", async () => {
    let finish!: () => void;
    const api = stubApi({
      updateCanvas: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await openExisting(api);
    await click(el, "canvas-settings");
    await type(el, "canvas-name", "Evening till");
    await press(el);
    await vi.waitFor(() => expect(typeof finish).toBe("function"));
    expect(await state(el)).toEqual(blocked);
    await type(el, "canvas-name", "Late till");
    finish();
    await vi.waitFor(async () => expect(await state(el)).toEqual(ready));
    expect($(el, "[data-test=editor-placeholder]")).not.toBeNull();
    await type(el, "canvas-name", "Evening till");
    expect(await state(el)).toEqual(quiet);
  });

  it("a refused save keeps Save ready, and typing the stored name back quiets it", async () => {
    const api = stubApi({
      updateCanvas: vi.fn().mockRejectedValue({ code: "canvas.name_taken" }),
    });
    const { el } = await openExisting(api);
    await click(el, "canvas-settings");
    await type(el, "canvas-name", "Bar till");
    await press(el);
    await vi.waitFor(() => expect(alertText(el)).toContain(codeMessage("canvas.name_taken")));
    expect(await state(el)).toEqual(ready);
    await type(el, "canvas-name", "Counter till");
    expect(await state(el)).toEqual(quiet);
  });

  it("an emptied name keeps Save drawn as a change, and a press says why it cannot save", async () => {
    const { el, api } = await openExisting();
    await click(el, "canvas-settings");
    await type(el, "canvas-name", "");
    expect(await state(el)).toEqual(ready);
    await press(el);
    await settle(el);
    expect(api.updateCanvas).not.toHaveBeenCalled();
    expect(alertText(el)).toContain(codeMessage("canvas_editor.err_no_name"));
  });

  it("reopening the canvas after Cancel opens quiet again", async () => {
    const { el } = await openExisting();
    await click(el, "canvas-settings");
    await type(el, "canvas-name", "Evening till");
    await click(el, "editor-cancel");
    await vi.waitFor(() => expect($(el, "[data-test=edit-c1]")).not.toBeNull());
    $(el, "[data-test=edit-c1]")!.click();
    await vi.waitFor(() => expect($(el, "[data-test=save]")).not.toBeNull());
    await settle(el);
    expect(await state(el)).toEqual(quiet);
  });

  it("a new canvas's editor opens with Save ready, and a press creates it", async () => {
    const { el, api } = await openNew("Fresh till");
    expect($(el, "[data-test=editor-name]")!.textContent).toBe("Fresh till");
    expect(await state(el)).toEqual(ready);
    await press(el);
    await vi.waitFor(() => expect($(el, "[data-test=editor-placeholder]")).toBeNull());
    expect(api.createCanvas).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.createCanvas).mock.calls[0]![0]).toBe("Fresh till");
  });
});

describe("the duplicate dialog's Duplicate", () => {
  it("opens ready with the copy's name, and a press creates the copy", async () => {
    const api = stubApi();
    const el = await mount(api);
    $(el, "[data-test=duplicate-c1]")!.click();
    await el.updateComplete;
    const name = `Counter till${t("canvas_editor.copy_suffix")}`;
    expect($<HTMLElement & { value: string }>(el, "[data-test=duplicate-name]")!.value).toBe(name);
    expect(await state(el, "confirm-duplicate")).toEqual(ready);
    await press(el, "confirm-duplicate");
    await vi.waitFor(() => expect(api.createCanvas).toHaveBeenCalledTimes(1));
    expect(api.createCanvas).toHaveBeenCalledWith(name, definition);
  });

  it("an emptied name keeps Duplicate drawn primary but unpressable", async () => {
    const api = stubApi();
    const el = await mount(api);
    $(el, "[data-test=duplicate-c1]")!.click();
    await el.updateComplete;
    await type(el, "duplicate-name", "");
    expect(await state(el, "confirm-duplicate")).toEqual(blocked);
  });
});

class SharedLeaveFixture extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot>${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("canvas-save-state-leave-fixture", SharedLeaveFixture);

describe("under the dashboard's leave coordinator", () => {
  async function inApp() {
    const { el: app } = await mountWidget<SharedLeaveFixture>(
      "canvas-save-state-leave-fixture",
      {},
    );
    const el = document.createElement("dashboard-canvas-editor-screen");
    el.api = stubApi();
    app.append(el);
    await vi.waitFor(() => expect($(el, "[data-test=edit-c1]")).not.toBeNull());
    return el;
  }

  it("an existing canvas opens quiet, wakes on an edit and quiets when it is typed back", async () => {
    const el = await inApp();
    $(el, "[data-test=edit-c1]")!.click();
    await vi.waitFor(() => expect($(el, "[data-test=save]")).not.toBeNull());
    await settle(el);
    expect(await state(el)).toEqual(quiet);
    await click(el, "canvas-settings");
    await type(el, "canvas-name", "Evening till");
    expect(await state(el)).toEqual(ready);
    await type(el, "canvas-name", "Counter till");
    expect(await state(el)).toEqual(quiet);
  });

  it("a new canvas opens with Save ready", async () => {
    const el = await inApp();
    $(el, "[data-test=create]")!.click();
    await el.updateComplete;
    await type(el, "create-name", "Fresh till");
    $(el, "[data-test=confirm-create]")!.click();
    await vi.waitFor(() => expect($(el, "[data-test=save]")).not.toBeNull());
    await settle(el);
    expect(await state(el)).toEqual(ready);
  });
});
