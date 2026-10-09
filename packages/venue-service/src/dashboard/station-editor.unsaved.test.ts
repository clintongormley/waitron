import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { StationEditor } from "./station-editor.js";
import "./station-editor.js";

class StationEditorLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<prep-station-editor
        .open=${true}
        .station=${{
          id: "grill",
          name: "Grill",
          active: true,
          showsRestOfOrder: false,
          printerIds: ["epson"],
        }}
        .printers=${[
          { id: "epson", name: "Epson" },
          { id: "star", name: "Star" },
        ]}
        .canManagePrinters=${true}
      ></prep-station-editor
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("station-editor-leave-test-app", StationEditorLeaveApp);
let app: StationEditorLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  app = document.createElement("station-editor-leave-test-app") as StationEditorLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<StationEditor>("prep-station-editor")!;
  await el.updateComplete;
  return el;
}
const nameField = (el: StationEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=stationName]")!;
async function rename(el: StationEditor, value: string) {
  nameField(el).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}
async function pickPrinters(el: StationEditor, values: string[]) {
  el.shadowRoot!.querySelector("wt-combobox[name=printerIds]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values } }),
  );
  await el.updateComplete;
}
function modal(el: StationEditor) {
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal");
  expect(modal).not.toBeNull();
  return modal!;
}
const save = (el: StationEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-station-edit]",
  )!;
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await q.updateComplete;
  return q;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
async function reconnect(el: StationEditor) {
  const parent = el.parentNode!;
  el.remove();
  await el.updateComplete;
  expect(unload()).toBe(false);
  parent.appendChild(el);
  await el.updateComplete;
}

it("asks before closing a changed station; Keep keeps the edit and Discard closes", async () => {
  const el = await mount();
  expect(unload()).toBe(false);
  await rename(el, "Hot grill");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(el.open).toBe(true);
  expect(nameField(el).value).toBe("Hot grill");
  const closed = new Promise((resolve) =>
    modal(el).addEventListener("wt-close", resolve, { once: true }),
  );
  const discard = modal(el).requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await closed;
  await expect.poll(() => el.open).toBe(false);
  expect(unload()).toBe(false);
});

it("asks when only the printers changed", async () => {
  const el = await mount();
  await pickPrinters(el, ["epson", "star"]);
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("restoring the opened values makes Save quiet and closes without asking", async () => {
  const el = await mount();
  await rename(el, "Hot grill");
  await rename(el, "Grill");
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});

it("asks for an edit made after removal and reconnect", async () => {
  const el = await mount();
  await reconnect(el);
  await rename(el, "Hot grill");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("retains an edit made before removal and still asks before discarding it", async () => {
  const el = await mount();
  await rename(el, "Hot grill");
  await reconnect(el);
  expect(nameField(el).value).toBe("Hot grill");
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("busy and disconnected editors refuse a retained close guard", async () => {
  const el = await mount();
  await rename(el, "Hot grill");
  const guard = modal(el).beforeClose!;
  el.busy = true;
  await el.updateComplete;
  expect(await guard("cancel")).toBe(false);
  expect((await question()).open).toBe(false);
  el.busy = false;
  el.remove();
  await el.updateComplete;
  expect(await guard("cancel")).toBe(false);
});
