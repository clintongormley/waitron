import { afterEach, expect, it, vi } from "vitest";
import type { WtButton, WtDialog, WtFormActions, WtTextarea } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
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

const cases = (["light", "dark"] as const).flatMap((theme) =>
  (["handle", "note"] as const).flatMap((mode) =>
    (["open", "refused", "sending"] as const).map((state) => ({ theme, mode, state })),
  ),
);

it.each(cases)(
  "the note dialog has no accessibility violations: $mode, $state, $theme",
  async ({ theme, mode, state }) => {
    setLocale("en-GB");
    const load = modules["./misdated-note-dialog.ts"];
    expect(load).toBeTypeOf("function");
    await load!();
    const answer = () =>
      state === "refused"
        ? Promise.reject({ code: "management.request_invalid", params: { field: "note" } })
        : new Promise<void>(() => {});
    const api = {
      markIncidentHandled: vi.fn(answer),
      addIncidentNote: vi.fn(answer),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<MisdatedNoteDialog>(
      "dashboard-misdated-note-dialog",
      {
        api,
        mode,
        incidentId: "7",
        summary: "3 sales from 2026-10-24 22:30 to 2026-10-24 23:10",
        open: true,
      },
      theme,
    );
    const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    const field = el.shadowRoot!.querySelector<WtTextarea>("wt-textarea[name=note]")!;
    const actions = el.shadowRoot!.querySelector<WtFormActions>("wt-form-actions")!;
    const submit = el.shadowRoot!.querySelector<WtButton>("wt-button[data-test=note-submit]")!;
    if (state !== "open") {
      field.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Adviser filed the correction" },
          bubbles: true,
          composed: true,
        }),
      );
      await el.updateComplete;
      submit.click();
      if (state === "refused") {
        await expect.poll(() => field.error).not.toBe("");
        await expect.poll(() => actions.error).not.toBe("");
      } else await expect.poll(() => submit.loading).toBe(true);
      await field.updateComplete;
      await actions.updateComplete;
    }
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    await expectNoA11yViolations(host);
  },
);
