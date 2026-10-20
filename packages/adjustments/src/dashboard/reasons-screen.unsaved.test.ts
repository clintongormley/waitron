import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens, setContentLanguages } from "@waitron/ui";
import { LiveData, setLocale, type QueryController } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import type { AdjustmentReason, AdjustmentSettings, AdjustmentsApi } from "./client.js";
import { AdjustmentReasonsScreen } from "./reasons-screen.js";

const reason: AdjustmentReason = {
  id: "reason-one",
  name: "Complaint",
  names: { en: "Guest complaint", es: "Guest complaint (es)" },
  kind: "comp",
  actions: ["comp", "discount_percent"],
  maxPercentBp: null,
  maxAmount: "30.00",
  applyRoles: ["supervisor", "manager", "admin"],
  approverRoles: ["manager", "admin"],
  noteRequired: true,
  position: 0,
};
const voidReason: AdjustmentReason = {
  id: "reason-void",
  name: "Entry error",
  names: {},
  kind: "void",
  actions: ["cancel"],
  maxPercentBp: null,
  maxAmount: null,
  applyRoles: [],
  approverRoles: [],
  noteRequired: false,
  position: 1,
};
class ReasonLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: AdjustmentsApi;
  override render() {
    return html`<dashboard-adjustment-reasons-screen
        .api=${this.api}
      ></dashboard-adjustment-reasons-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("reason-leave-test-app", ReasonLeaveApp);
let app: ReasonLeaveApp;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
});
afterEach(() => {
  app?.remove();
  sessionStorage.clear();
  localStorage.clear();
});
function settings(
  maxBillComp: string | null,
  billApproverRoles: AdjustmentSettings["billApproverRoles"] = ["manager", "admin"],
): AdjustmentSettings {
  return { maxBillComp, billApproverRoles };
}
function fakeApi() {
  const api = {
    listReasons: vi.fn(async () => [reason]),
    getSettings: vi.fn(async (): Promise<AdjustmentSettings> => settings(null)),
    saveSettings: vi.fn(async (value: unknown) => value),
    createReason: vi.fn(async () => reason),
    updateReason: vi.fn(async () => reason),
    deleteReason: vi.fn(async () => {}),
    watchReasonDeleteImpact: vi.fn(
      (queries: QueryController, reasonId: string, apply: (impact: DeleteImpact) => void) =>
        queries.watch(
          "delete-impact",
          {
            key: `impact:${reasonId}`,
            dependencies: [],
            read: async (): Promise<DeleteImpact> => ({
              target: { id: reason.id, name: reason.name },
              refusals: [],
              ends: [],
              removes: [],
            }),
          },
          apply,
        ),
    ),
    reorderReasons: vi.fn(async () => {}),
  };
  return Object.assign(api, { background: api });
}
async function mount(api = fakeApi()) {
  app = document.createElement("reason-leave-test-app") as ReasonLeaveApp;
  app.api = api as unknown as AdjustmentsApi;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector("dashboard-adjustment-reasons-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector('[data-test="reasons"]')).not.toBeNull();
  await settle(screen);
  return { screen, api };
}
async function settle(screen: AdjustmentReasonsScreen) {
  for (let i = 0; i < 3; i++) {
    await screen.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
function deep(root: ParentNode, selector: string): HTMLElement | null {
  const found = root.querySelector<HTMLElement>(selector);
  if (found) return found;
  for (const child of root.querySelectorAll("*")) {
    if (child.shadowRoot) {
      const match = deep(child.shadowRoot, selector);
      if (match) return match;
    }
  }
  return null;
}
async function press(screen: AdjustmentReasonsScreen, test: string) {
  const button = deep(screen.shadowRoot!, `[data-test="${test}"]`)!;
  expect(button).not.toBeNull();
  const menu = button.closest("wt-row-actions");
  if (menu) menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  button.click();
  await settle(screen);
}
async function open(screen: AdjustmentReasonsScreen, add = false) {
  await press(screen, add ? "add-reason" : "edit-reason-one");
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  return modal;
}
async function field(screen: AdjustmentReasonsScreen, name: string, value: string) {
  const control = screen.shadowRoot!.querySelector(`[name="${name}"]`)!;
  control.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await settle(screen);
}
function value(screen: AdjustmentReasonsScreen, name: string) {
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!
    .value;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
async function choose(which: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice="${which}"]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function editorClosed(screen: AdjustmentReasonsScreen): Promise<unknown> {
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  return new Promise((resolve) => modal.addEventListener("wt-close", resolve, { once: true }));
}
function native(modal: HTMLElementTagNameMap["wt-modal"]) {
  return modal.shadowRoot!.querySelector("dialog")!;
}

for (const add of [false, true])
  for (const route of ["cancel", "escape"]) {
    it(`protects ${add ? "Add" : "Edit"} reason through ${route}, Keep and Discard`, async () => {
      const { screen, api } = await mount();
      const modal = await open(screen, add);
      await field(screen, "name", "Changed reason");
      expect(unload()).toBe(true);
      if (route === "escape") await userEvent.keyboard("{Escape}");
      else await press(screen, "cancel-editor");
      expect((await question()).open).toBe(true);
      expect(native(modal).open).toBe(true);
      await choose("keep");
      expect(value(screen, "name")).toBe("Changed reason");
      const closed = editorClosed(screen);
      await press(screen, "cancel-editor");
      await choose("discard");
      await closed;
      await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
      expect(api.updateReason).not.toHaveBeenCalled();
      expect(api.createReason).not.toHaveBeenCalled();
      expect(unload()).toBe(false);
    });
  }
it("clean and normalized reverted reason values close directly", async () => {
  const { screen } = await mount();
  await open(screen);
  await field(screen, "name", "Changed");
  await field(screen, "name", "  Complaint  ");
  await field(screen, "names-es", "Different");
  await field(screen, "names-es", " Guest complaint (es) ");
  await field(screen, "maxPercent", "20");
  await field(screen, "maxPercent", " ");
  await field(screen, "maxAmount", "030,0");
  expect(unload()).toBe(false);
  const closed = editorClosed(screen);
  await press(screen, "cancel-editor");
  await closed;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect((await question()).open).toBe(false);
});
it("a comma-mark reverted item limit is clean", async () => {
  const employee: AdjustmentReason = {
    ...reason,
    id: "reason-employee",
    name: "Employee discount",
    names: {},
    actions: ["discount_percent"],
    maxPercentBp: 1250,
    maxAmount: null,
    noteRequired: false,
    position: 2,
  };
  const api = fakeApi();
  api.listReasons.mockResolvedValue([reason, employee]);
  const { screen } = await mount(api);
  await press(screen, "edit-reason-employee");
  expect(value(screen, "maxPercent")).toBe("12.5");
  await field(screen, "maxPercent", "20");
  expect(unload()).toBe(true);
  await field(screen, "maxPercent", "12,50");
  expect(unload()).toBe(false);
});
for (const name of ["names-es", "maxPercent", "maxAmount"]) {
  it(`protects the distinct ${name} payload`, async () => {
    const { screen } = await mount();
    const modal = await open(screen);
    await field(screen, name, "invalid edited input");
    expect(unload()).toBe(true);
    await press(screen, "cancel-editor");
    expect((await question()).open).toBe(true);
    await choose("keep");
    expect(native(modal).open).toBe(true);
    expect(value(screen, name)).toBe("invalid edited input");
  });
}
async function roles(screen: AdjustmentReasonsScreen, name: string, values: string[]) {
  screen
    .shadowRoot!.querySelector(`[name="${name}"]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { values } }));
  await settle(screen);
}
for (const name of ["applyRoles", "approverRoles"]) {
  it(`a change of ${name} dirties the draft, and restoring it in another order cleans it`, async () => {
    const { screen } = await mount();
    const modal = await open(screen);
    const before = reason[name as "applyRoles" | "approverRoles"];
    await roles(screen, name, ["admin"]);
    expect(unload()).toBe(true);
    await press(screen, "cancel-editor");
    expect((await question()).open).toBe(true);
    await choose("keep");
    expect(native(modal).open).toBe(true);
    expect(
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(`[name="${name}"]`)!
        .values,
    ).toEqual(["admin"]);
    await roles(screen, name, [...before].reverse());
    expect(unload()).toBe(false);
  });
}
it("a change of the kind dirties the draft, and restoring it cleans it", async () => {
  const api = fakeApi();
  api.listReasons.mockImplementation(async () => [reason, voidReason]);
  const { screen } = await mount(api);
  await press(screen, "edit-reason-void");
  await field(screen, "kind", "comp");
  expect(unload()).toBe(true);
  await field(screen, "kind", "void");
  expect(unload()).toBe(false);
  const closed = editorClosed(screen);
  await press(screen, "cancel-editor");
  await closed;
  expect((await question()).open).toBe(false);
});
it("actions compare membership and note-required compares its boolean", async () => {
  const { screen } = await mount();
  await open(screen);
  const box = screen.shadowRoot!.querySelector<HTMLInputElement>('input[value="comp"]')!;
  box.checked = false;
  box.dispatchEvent(new Event("change"));
  await settle(screen);
  expect(unload()).toBe(true);
  box.checked = true;
  box.dispatchEvent(new Event("change"));
  await settle(screen);
  expect(unload()).toBe(false);
  const toggle = screen.shadowRoot!.querySelector('[name="noteRequired"]')!;
  toggle.dispatchEvent(new CustomEvent("wt-change", { detail: { checked: false } }));
  await settle(screen);
  expect(unload()).toBe(true);
  await press(screen, "cancel-editor");
  expect((await question()).open).toBe(true);
});
for (const add of [false, true]) {
  it(`commits the exact ${add ? "create" : "update"} payload before a failed refresh`, async () => {
    const api = fakeApi();
    const observed: boolean[] = [];
    api.listReasons
      .mockImplementationOnce(async () => [reason])
      .mockImplementation(async () => {
        observed.push(unload());
        throw { code: "connection.failed" };
      });
    const { screen } = await mount(api);
    await open(screen, add);
    await field(screen, "name", "  Discount  ");
    await field(screen, "names-es", "  Discount (es)  ");
    if (add) {
      const box = screen.shadowRoot!.querySelector<HTMLInputElement>('input[value="comp"]')!;
      box.checked = true;
      box.dispatchEvent(new Event("change"));
      await settle(screen);
    }
    expect(unload()).toBe(true);
    await press(screen, "save-editor");
    await expect.poll(() => observed.length).toBe(1);
    expect(observed).toEqual([false]);
    const input = {
      name: "Discount",
      names: add ? { es: "Discount (es)" } : { en: "Guest complaint", es: "Discount (es)" },
      kind: "comp",
      actions: add ? ["comp"] : ["comp", "discount_percent"],
      maxPercentBp: null,
      maxAmount: add ? null : "30.00",
      applyRoles: add ? ["manager", "admin"] : ["supervisor", "manager", "admin"],
      approverRoles: ["manager", "admin"],
      noteRequired: !add,
    };
    if (add) expect(api.createReason).toHaveBeenCalledWith(input);
    else expect(api.updateReason).toHaveBeenCalledWith("reason-one", input);
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(unload()).toBe(false);
  });
}
it("a refused write retains the edited draft and Escape asks", async () => {
  const api = fakeApi();
  api.updateReason.mockRejectedValue({ code: "adjustment_reason.name_taken" });
  const { screen } = await mount(api);
  const modal = await open(screen);
  await field(screen, "name", "Changed");
  await press(screen, "save-editor");
  expect(value(screen, "name")).toBe("Changed");
  await userEvent.keyboard("{Escape}");
  expect((await question()).open).toBe(true);
  expect(native(modal).open).toBe(true);
});
it("an open Delete question closes without the unsaved-changes question", async () => {
  const { screen, api } = await mount();
  await press(screen, "delete-reason-one");
  const dialog = screen.shadowRoot!.querySelector("wt-delete-dialog")!;
  expect(unload()).toBe(false);
  const closed = new Promise((resolve) => dialog.addEventListener("wt-close", resolve));
  deep(dialog.shadowRoot!, '[data-test="delete-cancel"]')!.click();
  await closed;
  expect((await question()).open).toBe(false);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
  expect(api.deleteReason).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
it("acceptance commits only submitted values and retains a newer draft", async () => {
  const api = fakeApi();
  const result = deferred<AdjustmentReason>();
  api.updateReason.mockImplementation(() => result.promise);
  const { screen } = await mount(api);
  const modal = await open(screen);
  await field(screen, "name", "First edit");
  await press(screen, "save-editor");
  const save = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="save-editor"]',
  )!;
  expect(save.variant).toBe("primary");
  expect(save.disabled).toBe(true);
  await field(screen, "name", "Later edit");
  result.resolve(reason);
  await expect.poll(() => api.listReasons.mock.calls.length).toBe(2);
  await settle(screen);
  expect(native(modal).open).toBe(true);
  expect(value(screen, "name")).toBe("Later edit");
  expect(unload()).toBe(true);
  expect(save.variant).toBe("primary");
  expect(save.disabled).toBe(false);
  await field(screen, "name", " First edit ");
  expect(unload()).toBe(false);
  expect(save.variant).toBe("secondary");
  expect(save.disabled).toBe(true);
  const closed = editorClosed(screen);
  await press(screen, "cancel-editor");
  await closed;
  expect((await question()).open).toBe(false);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
});
it("pending writes retain nondismissible Escape and Cancel", async () => {
  const api = fakeApi();
  const result = deferred<AdjustmentReason>();
  api.updateReason.mockImplementation(() => result.promise);
  const { screen } = await mount(api);
  const modal = await open(screen);
  await field(screen, "name", "Changed");
  await press(screen, "save-editor");
  await userEvent.keyboard("{Escape}");
  await press(screen, "cancel-editor");
  expect(native(modal).open).toBe(true);
  expect((await question()).open).toBe(false);
  expect(api.updateReason).toHaveBeenCalledTimes(1);
  result.resolve(reason);
  await settle(screen);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(unload()).toBe(false);
});
for (const refusal of [false, true]) {
  it(`a departed ${refusal ? "refused" : "accepted"} write cannot affect a reconnected editor`, async () => {
    const api = fakeApi();
    const result = deferred<AdjustmentReason>();
    api.updateReason.mockImplementation(() => result.promise);
    const { screen } = await mount(api);
    await open(screen);
    await field(screen, "name", "Old edit");
    await press(screen, "save-editor");
    const parent = screen.parentNode!;
    screen.remove();
    expect(unload()).toBe(false);
    parent.appendChild(screen);
    await settle(screen);
    const modal = await open(screen);
    await field(screen, "name", "Replacement edit");
    if (refusal) result.reject({ code: "adjustment_reason.name_taken" });
    else result.resolve(reason);
    await settle(screen);
    expect(native(modal).open).toBe(true);
    expect(value(screen, "name")).toBe("Replacement edit");
    expect(
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!.error,
    ).toBe("");
    expect(unload()).toBe(true);
    await press(screen, "cancel-editor");
    expect((await question()).open).toBe(true);
  });
}
it("disconnect aborts a question and old controls cannot change or save a replacement", async () => {
  const { screen, api } = await mount();
  const old = await open(screen);
  await field(screen, "name", "Old edit");
  await press(screen, "cancel-editor");
  const q = await question();
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!;
  const parent = screen.parentNode!;
  screen.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  parent.appendChild(screen);
  await settle(screen);
  const current = await open(screen);
  await field(screen, "name", "Replacement edit");
  old
    .querySelector('[name="name"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Late edit" } }));
  old.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
  old.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
  old.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  discard.click();
  await settle(screen);
  expect(native(current).open).toBe(true);
  expect(value(screen, "name")).toBe("Replacement edit");
  expect(api.updateReason).not.toHaveBeenCalled();
  expect(unload()).toBe(true);
});
it("a departed editor Enter cannot submit the current reason", async () => {
  const { screen, api } = await mount();
  const old = await open(screen);
  const input = old.querySelector('[name="name"]')!.shadowRoot!.querySelector("input")!;
  await press(screen, "cancel-editor");
  await open(screen);
  await field(screen, "name", "Current edit");
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await settle(screen);
  expect(api.updateReason).not.toHaveBeenCalled();
  expect(value(screen, "name")).toBe("Current edit");
});
it("a departed Delete control cannot delete the current reason", async () => {
  const { screen, api } = await mount();
  await press(screen, "delete-reason-one");
  const old = screen.shadowRoot!.querySelector("wt-delete-dialog")!;
  const closed = new Promise((resolve) => old.addEventListener("wt-close", resolve));
  deep(old.shadowRoot!, '[data-test="delete-cancel"]')!.click();
  await closed;
  await settle(screen);
  await press(screen, "delete-reason-one");
  const current = screen.shadowRoot!.querySelector("wt-delete-dialog")!;
  expect(current).not.toBe(old);
  old.dispatchEvent(
    new CustomEvent("wt-delete-confirm", {
      detail: { id: "reason-one" },
      bubbles: true,
      composed: true,
    }),
  );
  old.dispatchEvent(new CustomEvent("wt-delete-retry", { bubbles: true, composed: true }));
  old.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await settle(screen);
  expect(api.deleteReason).not.toHaveBeenCalled();
  expect(api.watchReasonDeleteImpact).toHaveBeenCalledTimes(2);
  expect(screen.shadowRoot!.querySelector("wt-delete-dialog")).toBe(current);
  expect(current.open).toBe(true);
});
it("Keep returns focus to the edited reason control", async () => {
  const { screen } = await mount();
  const modal = await open(screen);
  const control =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!;
  await control.updateComplete;
  const input = control.shadowRoot!.querySelector("input")!;
  input.focus();
  await field(screen, "name", "Edited");
  await userEvent.keyboard("{Escape}");
  expect((await question()).open).toBe(true);
  await choose("keep");
  expect(native(modal).open).toBe(true);
  expect(control.shadowRoot!.activeElement).toBe(input);
  expect(input.value).toBe("Edited");
});
it("acceptance invalidates a pending discard without undoing the saved reason", async () => {
  const { screen, api } = await mount();
  await open(screen);
  await field(screen, "name", "Saved edit");
  await press(screen, "cancel-editor");
  const q = await question();
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!;
  await press(screen, "save-editor");
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  await settle(screen);
  expect(api.updateReason).toHaveBeenCalledTimes(1);
  expect(api.updateReason).toHaveBeenCalledWith("reason-one", {
    name: "Saved edit",
    names: { en: "Guest complaint", es: "Guest complaint (es)" },
    kind: "comp",
    actions: ["comp", "discount_percent"],
    maxPercentBp: null,
    maxAmount: "30.00",
    applyRoles: ["supervisor", "manager", "admin"],
    approverRoles: ["manager", "admin"],
    noteRequired: true,
  });
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(unload()).toBe(false);
});
it("late native close reports leave a reopened editor intact", async () => {
  const { screen } = await mount();
  const old = await open(screen);
  const closed = editorClosed(screen);
  await press(screen, "cancel-editor");
  await closed;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  const current = await open(screen);
  await field(screen, "name", "Current edit");
  native(old).dispatchEvent(new Event("close"));
  native(old).dispatchEvent(new Event("close"));
  await settle(screen);
  expect(native(current).open).toBe(true);
  expect(value(screen, "name")).toBe("Current edit");
  expect(unload()).toBe(true);
});

it("protects an edited bill limit through page leave, Keep and Discard without a settings write", async () => {
  const { screen, api } = await mount();
  await field(screen, "maxBillComp", "12,50");
  expect(unload()).toBe(true);
  let departed = 0;
  const leave = () =>
    app.leave.coordinator.request({
      scopes: [screen],
      reason: "navigation",
      proceed() {
        departed++;
      },
    });
  const first = leave();
  await choose("keep");
  await first;
  expect(departed).toBe(0);
  expect(value(screen, "maxBillComp")).toBe("12,50");
  const second = leave();
  await choose("discard");
  await second;
  expect(departed).toBe(1);
  expect(value(screen, "maxBillComp")).toBe("");
  expect(api.saveSettings).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
});
it("a normalized reverted limit is clean but invalid text stays dirty", async () => {
  const api = fakeApi();
  api.getSettings.mockResolvedValue(settings("12.50"));
  const { screen } = await mount(api);
  expect(unload()).toBe(false);
  await field(screen, "maxBillComp", "20");
  expect(unload()).toBe(true);
  await field(screen, "maxBillComp", " 012,50 ");
  expect(unload()).toBe(false);
  await field(screen, "maxBillComp", "bad");
  expect(unload()).toBe(true);
});
it("an empty reverted uncapped limit is clean", async () => {
  const { screen } = await mount();
  await field(screen, "maxBillComp", "10");
  expect(unload()).toBe(true);
  await field(screen, "maxBillComp", "  ");
  expect(unload()).toBe(false);
});
async function approvers(screen: AdjustmentReasonsScreen, values: string[]) {
  screen
    .shadowRoot!.querySelector('[name="billApproverRoles"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { values } }));
  await settle(screen);
}
function approverValues(screen: AdjustmentReasonsScreen) {
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    '[name="billApproverRoles"]',
  )!.values;
}
it("protects edited approvers through Keep and Discard without a settings write", async () => {
  const { screen, api } = await mount();
  await approvers(screen, ["admin"]);
  expect(unload()).toBe(true);
  let departed = 0;
  const leave = () =>
    app.leave.coordinator.request({
      scopes: [screen],
      reason: "navigation",
      proceed() {
        departed++;
      },
    });
  const first = leave();
  await choose("keep");
  await first;
  expect(departed).toBe(0);
  expect(approverValues(screen)).toEqual(["admin"]);
  const second = leave();
  await choose("discard");
  await second;
  expect(departed).toBe(1);
  expect(approverValues(screen)).toEqual(["manager", "admin"]);
  expect(api.saveSettings).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
});
it("approvers chosen back in another order are clean", async () => {
  const { screen } = await mount();
  await approvers(screen, ["supervisor", "manager", "admin"]);
  expect(unload()).toBe(true);
  await approvers(screen, ["admin", "manager"]);
  expect(unload()).toBe(false);
});
it("an accepted limit commits before a failed settings refresh", async () => {
  const api = fakeApi();
  const observed: boolean[] = [];
  api.getSettings
    .mockImplementationOnce(async () => settings(null))
    .mockImplementation(async () => {
      observed.push(unload());
      throw { code: "connection.failed" };
    });
  const { screen } = await mount(api);
  await field(screen, "maxBillComp", "12,50");
  expect(unload()).toBe(true);
  await press(screen, "save-limit");
  await expect.poll(() => observed.length).toBe(1);
  expect(observed).toEqual([false]);
  expect(api.saveSettings).toHaveBeenCalledWith(settings("12.50"));
  expect(value(screen, "maxBillComp")).toBe("12.50");
  expect(screen.shadowRoot!.querySelector('[data-test="limit-alert"]')!.textContent).toContain(
    "could not be loaded",
  );
  expect(unload()).toBe(false);
});
it("a refused settings write keeps the limit dirty", async () => {
  const api = fakeApi();
  api.saveSettings.mockRejectedValue({ code: "connection.failed" });
  const { screen } = await mount(api);
  await field(screen, "maxBillComp", "25");
  await press(screen, "save-limit");
  expect(value(screen, "maxBillComp")).toBe("25");
  expect(unload()).toBe(true);
});
it("an accepted settings write retains newer input against its submitted limit", async () => {
  const api = fakeApi();
  const result = deferred<AdjustmentSettings>();
  api.saveSettings.mockImplementation(() => result.promise);
  const { screen } = await mount(api);
  await field(screen, "maxBillComp", "10");
  await press(screen, "save-limit");
  const save = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="save-limit"]',
  )!;
  expect(save.variant).toBe("primary");
  expect(save.disabled).toBe(true);
  await field(screen, "maxBillComp", "20");
  result.resolve(settings("10.00"));
  await expect.poll(() => api.getSettings.mock.calls.length).toBe(2);
  await settle(screen);
  expect(value(screen, "maxBillComp")).toBe("20");
  expect(unload()).toBe(true);
  expect(save.variant).toBe("primary");
  expect(save.disabled).toBe(false);
  await field(screen, "maxBillComp", "010,00");
  expect(unload()).toBe(false);
  expect(save.variant).toBe("secondary");
  expect(save.disabled).toBe(true);
});
it("saving a reason leaves the independent limit dirty", async () => {
  const { screen } = await mount();
  await field(screen, "maxBillComp", "10");
  await open(screen);
  await field(screen, "name", "Changed");
  await press(screen, "save-editor");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(value(screen, "maxBillComp")).toBe("10");
  expect(unload()).toBe(true);
});
it("saving a limit leaves the independent reason dirty", async () => {
  const { screen } = await mount();
  await open(screen);
  await field(screen, "name", "Changed");
  await field(screen, "maxBillComp", "10");
  await press(screen, "save-limit");
  expect(value(screen, "name")).toBe("Changed");
  expect(unload()).toBe(true);
  const closed = editorClosed(screen);
  await press(screen, "cancel-editor");
  await choose("discard");
  await closed;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(unload()).toBe(false);
});
for (const refusal of [false, true]) {
  it(`a departed ${refusal ? "refused" : "accepted"} limit write cannot alter a reconnected page`, async () => {
    const api = fakeApi();
    const result = deferred<AdjustmentSettings>();
    api.saveSettings.mockImplementation(() => result.promise);
    const { screen } = await mount(api);
    await field(screen, "maxBillComp", "10");
    await press(screen, "save-limit");
    const parent = screen.parentNode!;
    screen.remove();
    expect(unload()).toBe(false);
    parent.appendChild(screen);
    await settle(screen);
    expect(value(screen, "maxBillComp")).toBe("");
    await field(screen, "maxBillComp", "30");
    const reads = api.getSettings.mock.calls.length;
    if (refusal) result.reject({ code: "connection.failed" });
    else result.resolve(settings("10.00"));
    await settle(screen);
    expect(value(screen, "maxBillComp")).toBe("30");
    expect(api.getSettings.mock.calls.length).toBe(reads);
    expect(screen.shadowRoot!.querySelector('[data-test="limit-saved"]')).toBeNull();
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    expect(unload()).toBe(true);
  });
}

it("live settings refresh retains an edited limit and its original baseline", async () => {
  const liveData = new LiveData();
  const api = Object.assign(fakeApi(), { liveData });
  api.getSettings.mockResolvedValue(settings("10.00"));
  const { screen } = await mount(api);
  await field(screen, "maxBillComp", "20");
  api.getSettings.mockResolvedValue(settings("30.00"));
  liveData.invalidate([{ type: "adjustment_settings" }]);
  await expect.poll(() => api.getSettings.mock.calls.length).toBe(2);
  await settle(screen);
  expect(value(screen, "maxBillComp")).toBe("20");
  await field(screen, "maxBillComp", "10");
  expect(unload()).toBe(false);
  liveData.clear();
});
it("live settings refresh updates a clean limit and its accepted baseline", async () => {
  const liveData = new LiveData();
  const api = Object.assign(fakeApi(), { liveData });
  api.getSettings.mockResolvedValue(settings("10.00"));
  const { screen } = await mount(api);
  api.getSettings.mockResolvedValue(settings("30.00"));
  liveData.invalidate([{ type: "adjustment_settings" }]);
  await expect.poll(() => value(screen, "maxBillComp")).toBe("30.00");
  expect(unload()).toBe(false);
  await field(screen, "maxBillComp", "20");
  expect(unload()).toBe(true);
  await field(screen, "maxBillComp", "030,00");
  expect(unload()).toBe(false);
  liveData.clear();
});

it("reconnect waits for fresh settings before exposing a limit draft", async () => {
  const api = fakeApi();
  const read = deferred<AdjustmentSettings>();
  const { screen } = await mount(api);
  api.getSettings.mockImplementation(() => read.promise);
  const parent = screen.parentNode!;
  screen.remove();
  parent.appendChild(screen);
  await settle(screen);
  expect(screen.shadowRoot!.querySelector('[name="maxBillComp"]')).toBeNull();
  expect(unload()).toBe(false);
  read.resolve(settings("25.00"));
  await expect.poll(() => value(screen, "maxBillComp")).toBe("25.00");
  expect(unload()).toBe(false);
  await field(screen, "maxBillComp", "30");
  expect(unload()).toBe(true);
});
