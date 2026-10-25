import { afterEach, expect, it, vi } from "vitest";
import type { WtButton, WtDialog, WtFormActions, WtTextarea } from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi } from "../api/client.js";
import type { MisdatedNoteDialog } from "./misdated-note-dialog.js";

const modules = import.meta.glob<typeof import("./misdated-note-dialog.js")>(
  "./misdated-note-dialog.ts",
);

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

function stubApi() {
  return {
    markIncidentHandled: vi.fn(async (_id: string, _note?: string) => {}),
    addIncidentNote: vi.fn(async (_id: string, _note: string) => {}),
  };
}

async function mount(mode: "handle" | "note", api = stubApi()) {
  setLocale("en-GB");
  const load = modules["./misdated-note-dialog.ts"];
  expect(load).toBeTypeOf("function");
  await load!();
  const { el } = await mountWidget<MisdatedNoteDialog>("dashboard-misdated-note-dialog", {
    api: api as unknown as DashboardApi,
    mode,
    incidentId: "incident 7",
    summary: "3 sales from 2026-10-24 22:30 to 2026-10-24 23:10",
    open: true,
  });
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  return { el, api, dialog };
}

const field = (el: MisdatedNoteDialog) =>
  el.shadowRoot!.querySelector<WtTextarea>("wt-textarea[name=note]")!;
const action = (el: MisdatedNoteDialog) =>
  el.shadowRoot!.querySelector<WtButton>("wt-button[data-test=note-submit]")!;
const actions = (el: MisdatedNoteDialog) =>
  el.shadowRoot!.querySelector<WtFormActions>("wt-form-actions")!;

async function type(el: MisdatedNoteDialog, value: string) {
  field(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function press(el: MisdatedNoteDialog) {
  action(el).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

it("handle mode shows the episode, an optional note field and Mark handled enabled on open", async () => {
  const { el, dialog } = await mount("handle");
  expect(dialog.heading).toBe(t("alerts.mark_handled"));
  expect(el.shadowRoot!.textContent).toContain("3 sales from 2026-10-24 22:30 to 2026-10-24 23:10");
  expect(field(el).label).toBe("Note");
  expect(field(el).placeholder).toBe("What your tax adviser said, or what was done (optional)");
  expect(field(el).maxlength).toBe(500);
  expect(field(el).required).toBe(false);
  expect(action(el).textContent!.trim()).toBe("Mark handled");
  expect(action(el).variant).toBe("primary");
  expect(action(el).disabled).toBe(false);
});

it("handle mode sends no note when the field is empty", async () => {
  const { el, api } = await mount("handle");
  await type(el, "   ");
  await press(el);
  expect(api.markIncidentHandled).toHaveBeenCalledTimes(1);
  expect(api.markIncidentHandled.mock.calls[0]).toEqual(["incident 7", undefined]);
});

it("handle mode sends the trimmed note", async () => {
  const { el, api } = await mount("handle");
  await type(el, "  Adviser filed the correction  ");
  await press(el);
  expect(api.markIncidentHandled.mock.calls).toEqual([
    ["incident 7", "Adviser filed the correction"],
  ]);
  expect(api.addIncidentNote).not.toHaveBeenCalled();
});

it("note mode's Save is quiet and disabled until a note is typed, then sends it", async () => {
  const { el, api, dialog } = await mount("note");
  expect(dialog.heading).toBe("Add a note");
  expect(field(el).required).toBe(true);
  expect(field(el).placeholder).toBe("What your tax adviser said, or what was done");
  expect(action(el).textContent!.trim()).toBe(t("action.save"));
  expect(action(el).variant).toBe("secondary");
  expect(action(el).disabled).toBe(true);
  await type(el, "   ");
  expect(action(el).disabled).toBe(true);
  await type(el, " Paid the difference ");
  expect(action(el).variant).toBe("primary");
  expect(action(el).disabled).toBe(false);
  await press(el);
  expect(api.addIncidentNote.mock.calls).toEqual([["incident 7", "Paid the difference"]]);
  expect(api.markIncidentHandled).not.toHaveBeenCalled();
});

it("success emits saved and closes", async () => {
  const { el, dialog } = await mount("note");
  const saved = vi.fn();
  el.addEventListener("saved", saved);
  await type(el, "Done");
  const closed = dialogClosed(dialog);
  await press(el);
  await closed;
  expect(saved).toHaveBeenCalledTimes(1);
  expect(el.open).toBe(false);
});

it("keeps both buttons disabled and the dialog undismissable while the request is sent", async () => {
  const api = stubApi();
  let finish!: () => void;
  api.markIncidentHandled.mockImplementation(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  const { el, dialog } = await mount("handle", api);
  await press(el);
  expect(action(el).loading).toBe(true);
  expect(action(el).disabled).toBe(true);
  expect(el.shadowRoot!.querySelector<WtButton>("wt-button[data-test=note-cancel]")!.disabled).toBe(
    true,
  );
  expect(dialog.dismissible).toBe(false);
  finish();
  await expect.poll(() => el.open).toBe(false);
});

it.each([
  ["a long note", "x".repeat(20), "Write a note of 500 characters or fewer."],
  ["an empty note", "", "Write a note."],
])(
  "a field refusal for %s sits under the field with the generic bottom message and focus on the field, until the note changes",
  async (_label, typed, sentence) => {
    const api = stubApi();
    const refusal = { code: "management.request_invalid", params: { field: "note" } };
    api.markIncidentHandled.mockRejectedValue(refusal);
    const { el } = await mount("handle", api);
    await type(el, typed);
    await press(el);
    await expect.poll(() => field(el).error).toBe(sentence);
    expect(actions(el).error).toBe(t("form.fix_fields"));
    await expect
      .poll(() => field(el).shadowRoot!.activeElement?.matches("textarea") ?? false)
      .toBe(true);
    expect(action(el).disabled).toBe(false);
    await type(el, `${typed}y`);
    expect(field(el).error).toBe("");
    expect(actions(el).error).toBe("");
  },
);

it("alert.already_handled shows its sentence at the bottom and leaves the action enabled", async () => {
  const api = stubApi();
  api.markIncidentHandled.mockRejectedValue({ code: "alert.already_handled" });
  const { el } = await mount("handle", api);
  await type(el, "Done");
  await press(el);
  await expect.poll(() => actions(el).error).toBe(codeMessage("alert.already_handled"));
  expect(field(el).error).toBe("");
  expect(action(el).disabled).toBe(false);
  expect(el.open).toBe(true);
});

it("alert.note_exists shows its sentence at the bottom in note mode", async () => {
  const api = stubApi();
  api.addIncidentNote.mockRejectedValue({ code: "alert.note_exists" });
  const { el } = await mount("note", api);
  await type(el, "Done");
  await press(el);
  await expect.poll(() => actions(el).error).toBe(codeMessage("alert.note_exists"));
  expect(action(el).disabled).toBe(false);
});
