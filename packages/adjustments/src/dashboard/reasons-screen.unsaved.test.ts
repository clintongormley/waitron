import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens, setContentLanguages } from "@waitron/ui";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import type { AdjustmentReason, AdjustmentSettings, AdjustmentsApi } from "./client.js";
import { AdjustmentReasonsScreen } from "./reasons-screen.js";

const reason: AdjustmentReason = {
  id: "reason-one",
  name: "Complaint",
  names: { en: "Guest complaint", es: "Queja" },
  actions: ["comp", "discount_percent"],
  maxPercentBp: 1250,
  maxAmount: "30.00",
  applyRole: "supervisor",
  approverRole: "manager",
  noteRequired: true,
  active: true,
  position: 0,
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
function fakeApi() {
  const api = {
    listReasons: vi.fn(async () => [reason]),
    getSettings: vi.fn(async (): Promise<AdjustmentSettings> => ({ maxBillDiscountBp: null })),
    saveSettings: vi.fn(async (value: unknown) => value),
    createReason: vi.fn(async () => reason),
    updateReason: vi.fn(async () => reason),
    deactivateReason: vi.fn(async () => {}),
    reactivateReason: vi.fn(async () => reason),
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
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
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
      await press(screen, "cancel-editor");
      await choose("discard");
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
  await field(screen, "names-es", " Queja ");
  await field(screen, "maxPercent", "12,50");
  await field(screen, "maxAmount", "030,0");
  expect(unload()).toBe(false);
  await press(screen, "cancel-editor");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect((await question()).open).toBe(false);
});
for (const name of ["names-es", "maxPercent", "maxAmount", "applyRole", "approverRole"]) {
  it(`protects the distinct ${name} payload`, async () => {
    const { screen } = await mount();
    const modal = await open(screen);
    await field(screen, name, name.endsWith("Role") ? "admin" : "invalid edited input");
    expect(unload()).toBe(true);
    await press(screen, "cancel-editor");
    expect((await question()).open).toBe(true);
    await choose("keep");
    expect(native(modal).open).toBe(true);
    expect(value(screen, name)).toBe(name.endsWith("Role") ? "admin" : "invalid edited input");
  });
}
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
    await field(screen, "names-es", "  Descuento  ");
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
      names: add ? { es: "Descuento" } : { en: "Guest complaint", es: "Descuento" },
      actions: add ? ["comp"] : ["comp", "discount_percent"],
      maxPercentBp: add ? null : 1250,
      maxAmount: add ? null : "30.00",
      applyRole: add ? "manager" : "supervisor",
      approverRole: "manager",
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
it("a readonly deactivation confirmation closes without another question", async () => {
  const { screen, api } = await mount();
  await press(screen, "deactivate-reason-one");
  expect(unload()).toBe(false);
  await press(screen, "cancel-editor");
  expect((await question()).open).toBe(false);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(api.deactivateReason).not.toHaveBeenCalled();
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
  await press(screen, "cancel-editor");
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
it("a departed deactivation control cannot deactivate the current reason", async () => {
  const { screen, api } = await mount();
  await press(screen, "deactivate-reason-one");
  const old = screen.shadowRoot!.querySelector("wt-modal")!;
  await press(screen, "cancel-editor");
  await open(screen);
  old.querySelector<HTMLElement>('[data-test="confirm-deactivate"]')!.click();
  await settle(screen);
  expect(api.deactivateReason).not.toHaveBeenCalled();
  expect(value(screen, "name")).toBe("Complaint");
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
    names: { en: "Guest complaint", es: "Queja" },
    actions: ["comp", "discount_percent"],
    maxPercentBp: 1250,
    maxAmount: "30.00",
    applyRole: "supervisor",
    approverRole: "manager",
    noteRequired: true,
  });
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(unload()).toBe(false);
});
it("late native close reports leave a reopened editor intact", async () => {
  const { screen } = await mount();
  const old = await open(screen);
  await press(screen, "cancel-editor");
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
  await field(screen, "maxBillDiscount", "12,50");
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
  expect(value(screen, "maxBillDiscount")).toBe("12,50");
  const second = leave();
  await choose("discard");
  await second;
  expect(departed).toBe(1);
  expect(value(screen, "maxBillDiscount")).toBe("");
  expect(api.saveSettings).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
});
it("a normalized reverted limit is clean but invalid text stays dirty", async () => {
  const api = fakeApi();
  api.getSettings.mockResolvedValue({ maxBillDiscountBp: 1250 });
  const { screen } = await mount(api);
  expect(unload()).toBe(false);
  await field(screen, "maxBillDiscount", "20");
  expect(unload()).toBe(true);
  await field(screen, "maxBillDiscount", " 012,50 ");
  expect(unload()).toBe(false);
  await field(screen, "maxBillDiscount", "bad");
  expect(unload()).toBe(true);
});
it("an empty reverted uncapped limit is clean", async () => {
  const { screen } = await mount();
  await field(screen, "maxBillDiscount", "10");
  expect(unload()).toBe(true);
  await field(screen, "maxBillDiscount", "  ");
  expect(unload()).toBe(false);
});
it("an accepted limit commits before a failed settings refresh", async () => {
  const api = fakeApi();
  const observed: boolean[] = [];
  api.getSettings
    .mockImplementationOnce(async () => ({ maxBillDiscountBp: null }))
    .mockImplementation(async () => {
      observed.push(unload());
      throw { code: "connection.failed" };
    });
  const { screen } = await mount(api);
  await field(screen, "maxBillDiscount", "12,50");
  expect(unload()).toBe(true);
  await press(screen, "save-limit");
  await expect.poll(() => observed.length).toBe(1);
  expect(observed).toEqual([false]);
  expect(api.saveSettings).toHaveBeenCalledWith({ maxBillDiscountBp: 1250 });
  expect(value(screen, "maxBillDiscount")).toBe("12.5");
  expect(screen.shadowRoot!.querySelector('[data-test="limit-alert"]')!.textContent).toContain(
    "could not be loaded",
  );
  expect(unload()).toBe(false);
});
it("a refused settings write keeps the limit dirty", async () => {
  const api = fakeApi();
  api.saveSettings.mockRejectedValue({ code: "connection.failed" });
  const { screen } = await mount(api);
  await field(screen, "maxBillDiscount", "25");
  await press(screen, "save-limit");
  expect(value(screen, "maxBillDiscount")).toBe("25");
  expect(unload()).toBe(true);
});
it("an accepted settings write retains newer input against its submitted limit", async () => {
  const api = fakeApi();
  const result = deferred<{ maxBillDiscountBp: number }>();
  api.saveSettings.mockImplementation(() => result.promise);
  const { screen } = await mount(api);
  await field(screen, "maxBillDiscount", "10");
  await press(screen, "save-limit");
  const save = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="save-limit"]',
  )!;
  expect(save.variant).toBe("primary");
  expect(save.disabled).toBe(true);
  await field(screen, "maxBillDiscount", "20");
  result.resolve({ maxBillDiscountBp: 1000 });
  await expect.poll(() => api.getSettings.mock.calls.length).toBe(2);
  await settle(screen);
  expect(value(screen, "maxBillDiscount")).toBe("20");
  expect(unload()).toBe(true);
  expect(save.variant).toBe("primary");
  expect(save.disabled).toBe(false);
  await field(screen, "maxBillDiscount", "010,00");
  expect(unload()).toBe(false);
  expect(save.variant).toBe("secondary");
  expect(save.disabled).toBe(true);
});
it("saving a reason leaves the independent limit dirty", async () => {
  const { screen } = await mount();
  await field(screen, "maxBillDiscount", "10");
  await open(screen);
  await field(screen, "name", "Changed");
  await press(screen, "save-editor");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(value(screen, "maxBillDiscount")).toBe("10");
  expect(unload()).toBe(true);
});
it("saving a limit leaves the independent reason dirty", async () => {
  const { screen } = await mount();
  await open(screen);
  await field(screen, "name", "Changed");
  await field(screen, "maxBillDiscount", "10");
  await press(screen, "save-limit");
  expect(value(screen, "name")).toBe("Changed");
  expect(unload()).toBe(true);
  await press(screen, "cancel-editor");
  await choose("discard");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(unload()).toBe(false);
});
for (const refusal of [false, true]) {
  it(`a departed ${refusal ? "refused" : "accepted"} limit write cannot alter a reconnected page`, async () => {
    const api = fakeApi();
    const result = deferred<{ maxBillDiscountBp: number }>();
    api.saveSettings.mockImplementation(() => result.promise);
    const { screen } = await mount(api);
    await field(screen, "maxBillDiscount", "10");
    await press(screen, "save-limit");
    const parent = screen.parentNode!;
    screen.remove();
    expect(unload()).toBe(false);
    parent.appendChild(screen);
    await settle(screen);
    expect(value(screen, "maxBillDiscount")).toBe("");
    await field(screen, "maxBillDiscount", "30");
    const reads = api.getSettings.mock.calls.length;
    if (refusal) result.reject({ code: "connection.failed" });
    else result.resolve({ maxBillDiscountBp: 1000 });
    await settle(screen);
    expect(value(screen, "maxBillDiscount")).toBe("30");
    expect(api.getSettings.mock.calls.length).toBe(reads);
    expect(screen.shadowRoot!.querySelector('[data-test="limit-saved"]')).toBeNull();
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    expect(unload()).toBe(true);
  });
}

it("live settings refresh retains an edited limit and its original baseline", async () => {
  const liveData = new LiveData();
  const api = Object.assign(fakeApi(), { liveData });
  api.getSettings.mockResolvedValue({ maxBillDiscountBp: 1000 });
  const { screen } = await mount(api);
  await field(screen, "maxBillDiscount", "20");
  api.getSettings.mockResolvedValue({ maxBillDiscountBp: 3000 });
  liveData.invalidate([{ type: "adjustment_settings" }]);
  await expect.poll(() => api.getSettings.mock.calls.length).toBe(2);
  await settle(screen);
  expect(value(screen, "maxBillDiscount")).toBe("20");
  await field(screen, "maxBillDiscount", "10");
  expect(unload()).toBe(false);
  liveData.clear();
});
it("live settings refresh updates a clean limit and its accepted baseline", async () => {
  const liveData = new LiveData();
  const api = Object.assign(fakeApi(), { liveData });
  api.getSettings.mockResolvedValue({ maxBillDiscountBp: 1000 });
  const { screen } = await mount(api);
  api.getSettings.mockResolvedValue({ maxBillDiscountBp: 3000 });
  liveData.invalidate([{ type: "adjustment_settings" }]);
  await expect.poll(() => value(screen, "maxBillDiscount")).toBe("30");
  expect(unload()).toBe(false);
  await field(screen, "maxBillDiscount", "20");
  expect(unload()).toBe(true);
  await field(screen, "maxBillDiscount", "030,00");
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
  expect(screen.shadowRoot!.querySelector('[name="maxBillDiscount"]')).toBeNull();
  expect(unload()).toBe(false);
  read.resolve({ maxBillDiscountBp: 2500 });
  await expect.poll(() => value(screen, "maxBillDiscount")).toBe("25");
  expect(unload()).toBe(false);
  await field(screen, "maxBillDiscount", "30");
  expect(unload()).toBe(true);
});
