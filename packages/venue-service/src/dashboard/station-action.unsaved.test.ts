import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import {
  allowedImpact,
  mountDelete,
  openDelete,
  stationView,
} from "../../test/station-delete-test-helpers.js";
class DeleteLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("station-delete-leave-app", DeleteLeaveApp);
const apps: DeleteLeaveApp[] = [];
afterEach(() => apps.splice(0).forEach((app) => app.remove()));
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function table(screen: PrepStationsScreen) {
  return screen
    .shadowRoot!.querySelector("prep-station-table")!
    .shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
}
async function mount(overrides: Parameters<typeof mountDelete>[0] = {}) {
  const result = await mountDelete(overrides);
  const app = new DeleteLeaveApp();
  apps.push(app);
  result.host.append(app);
  app.append(result.screen);
  await app.updateComplete;
  await result.screen.updateComplete;
  return { ...result, app };
}
async function edit(screen: PrepStationsScreen) {
  table(screen).querySelector<HTMLElement>('[data-test="edit-bar"]')!.click();
  await screen.updateComplete;
  const editor = screen.shadowRoot!.querySelector("prep-station-editor")!;
  await editor.updateComplete;
  editor
    .shadowRoot!.querySelector("wt-input")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Changed bar" } }));
  await editor.updateComplete;
  return editor;
}
it.each(["cancel", "escape"])(
  "Delete's clean confirmation closes on %s without creating a disposition draft",
  async (route) => {
    const { screen, app, api } = await mount();
    const dialog = await openDelete(screen);
    await expect.poll(() => dialog.loading).toBe(false);
    expect(unload()).toBe(false);
    expect(dialog.shadowRoot!.querySelector("wt-combobox")).toBeNull();
    if (route === "cancel")
      dialog.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-cancel"]')!.click();
    else await dialog.shadowRoot!.querySelector("wt-modal")!.requestClose("escape");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open ?? false).toBe(false);
    expect(api.deleteStation).not.toHaveBeenCalled();
    expect(unload()).toBe(false);
  },
);
it("own Delete waits for the target editor's Keep or Discard answer", async () => {
  const { screen, app, api } = await mount();
  const editor = await edit(screen);
  expect(unload()).toBe(true);
  table(screen).querySelector<HTMLElement>('[data-test="delete-bar"]')!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  expect(screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!
    .click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(false);
  expect(screen.shadowRoot!.querySelector("prep-station-editor")).toBe(editor);
  expect(unload()).toBe(true);
  table(screen).querySelector<HTMLElement>('[data-test="delete-bar"]')!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!
    .click();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-delete-dialog")).not.toBeNull();
  expect(screen.shadowRoot!.querySelector("prep-station-editor")).toBeNull();
  expect(unload()).toBe(false);
  expect(api.deleteStation).not.toHaveBeenCalled();
});
it("a remote deletion closes its dirty editor, releases its scope and ignores its old Save", async () => {
  const liveData = new LiveData();
  const load = vi.fn().mockResolvedValue(stationView);
  const { screen, api } = await mount({ liveData, load, updateStation: vi.fn() });
  const editor = await edit(screen);
  const oldSave = editor.shadowRoot!.querySelector<HTMLElement>('[data-test="save-station-edit"]')!;
  load.mockResolvedValue({ ...stationView, stations: [] });
  liveData.invalidate([{ type: "kitchen_stations", id: "bar" }]);
  await expect.poll(() => screen.shadowRoot!.querySelector("prep-station-editor")).toBeNull();
  expect(unload()).toBe(false);
  oldSave.click();
  expect(api.updateStation).not.toHaveBeenCalled();
});
it("a remote deletion releases its timing draft and ignores the departed Save", async () => {
  const liveData = new LiveData();
  const load = vi.fn().mockResolvedValue(stationView);
  const { screen, api } = await mount({ liveData, load, updateStation: vi.fn() });
  screen
    .shadowRoot!.querySelector("wt-tabs")!
    .dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "settings" } }));
  await screen.updateComplete;
  const settings = screen.shadowRoot!.querySelector('[data-test="settings-table"]')!.shadowRoot!;
  settings.querySelector<HTMLElement>('[data-test="edit-settings-warmAfterMinutes-bar"]')!.click();
  await screen.updateComplete;
  const field = screen
    .shadowRoot!.querySelector('[data-test="settings-table"]')!
    .shadowRoot!.querySelector("wt-input")!;
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "7" } }));
  await screen.updateComplete;
  const oldSave = screen
    .shadowRoot!.querySelector('[data-test="settings-table"]')!
    .shadowRoot!.querySelector<HTMLElement>('[data-test="save-settings-cell"]')!;
  expect(unload()).toBe(true);
  load.mockResolvedValue({ ...stationView, stations: [] });
  liveData.invalidate([{ type: "kitchen_stations", id: "bar" }]);
  await expect
    .poll(() =>
      screen
        .shadowRoot!.querySelector('[data-test="settings-table"]')!
        .shadowRoot!.querySelector("wt-input"),
    )
    .toBeNull();
  expect(unload()).toBe(false);
  oldSave.click();
  expect(api.updateStation).not.toHaveBeenCalled();
});
it("a deletion of another station leaves this editor and its draft intact", async () => {
  const other = { ...stationView.stations[0]!, id: "other", name: "Other", isDefault: false };
  const liveData = new LiveData();
  const load = vi
    .fn()
    .mockResolvedValue({ ...stationView, stations: [...stationView.stations, other] });
  const { screen } = await mount({ liveData, load });
  const editor = await edit(screen);
  load.mockResolvedValue(stationView);
  liveData.invalidate([{ type: "kitchen_stations", id: "other" }]);
  await expect.poll(() => load.mock.calls.length).toBeGreaterThan(2);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("prep-station-editor")).toBe(editor);
  expect(editor.shadowRoot!.querySelector("wt-input")!.value).toBe("Changed bar");
  expect(unload()).toBe(true);
});
it("reviewing Delete leaves an unrelated Add station draft protected", async () => {
  const { screen, api } = await mount({ createStation: vi.fn() });
  screen.shadowRoot!.querySelector<HTMLElement>('[data-test="new-station"]')!.click();
  await screen.updateComplete;
  screen
    .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('wt-input[name="name"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "New grill" } }));
  await screen.updateComplete;
  expect(unload()).toBe(true);
  const dialog = await openDelete(screen);
  await expect.poll(() => dialog.loading).toBe(false);
  dialog.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-cancel"]')!.click();
  await screen.updateComplete;
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('wt-input[name="name"]')!
      .value,
  ).toBe("New grill");
  expect(unload()).toBe(true);
  expect(api.createStation).not.toHaveBeenCalled();
});
it("a failed Delete keeps its action retryable without making an unsaved disposition", async () => {
  const { screen } = await mount({
    deleteStation: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  const dialog = await openDelete(screen);
  await expect.poll(() => dialog.loading).toBe(false);
  dialog.dispatchEvent(
    new CustomEvent("wt-delete-confirm", { detail: { id: allowedImpact.target.id } }),
  );
  await expect.poll(() => dialog.actionError).not.toBe("");
  expect(unload()).toBe(false);
  expect(
    dialog.shadowRoot!.querySelector('[data-test="delete-confirm"]')!.hasAttribute("disabled"),
  ).toBe(false);
});
it("station.not_found from an editor write closes that target and releases its draft", async () => {
  const { screen, api } = await mount({
    updateStation: vi.fn().mockRejectedValue({ code: "station.not_found" }),
  });
  const editor = await edit(screen);
  editor.shadowRoot!.querySelector<HTMLElement>('[data-test="save-station-edit"]')!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("prep-station-editor")).toBeNull();
  expect(unload()).toBe(false);
  expect(api.updateStation).toHaveBeenCalledExactlyOnceWith("bar", { name: "Changed bar" });
});
it("station.not_found from a timing write closes only that cell and releases its draft", async () => {
  const { screen, api } = await mount({
    updateStation: vi.fn().mockRejectedValue({ code: "station.not_found" }),
  });
  screen
    .shadowRoot!.querySelector("wt-tabs")!
    .dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "settings" } }));
  await screen.updateComplete;
  const settings = screen.shadowRoot!.querySelector('[data-test="settings-table"]')!.shadowRoot!;
  settings.querySelector<HTMLElement>('[data-test="edit-settings-warmAfterMinutes-bar"]')!.click();
  await screen.updateComplete;
  const current = screen.shadowRoot!.querySelector('[data-test="settings-table"]')!.shadowRoot!;
  current
    .querySelector("wt-input")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "7" } }));
  await screen.updateComplete;
  current.querySelector<HTMLElement>('[data-test="save-settings-cell"]')!.click();
  await expect
    .poll(() =>
      screen
        .shadowRoot!.querySelector('[data-test="settings-table"]')!
        .shadowRoot!.querySelector("wt-input"),
    )
    .toBeNull();
  expect(unload()).toBe(false);
  expect(api.updateStation).toHaveBeenCalledExactlyOnceWith("bar", { warmAfterMinutes: 7 });
});
