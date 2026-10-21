import { afterEach, expect, it, vi } from "vitest";
import type { WtDialog, WtFormActions, WtInput } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { ThemeNameDialog, ThemeNameRequest } from "./theme-name-dialog.js";
import "./theme-name-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

type State = "copy" | "rename" | "first-save-empty" | "taken" | "warning";

const requests: Record<State, Omit<ThemeNameRequest, "submit">> = {
  copy: { kind: "copy", name: "Christmas", inUse: false, warningLines: [] },
  rename: { kind: "rename", name: "Christmas", inUse: false, warningLines: [] },
  "first-save-empty": { kind: "first-save", name: "", inUse: false, warningLines: [] },
  taken: { kind: "copy", name: "Christmas", inUse: false, warningLines: [] },
  warning: {
    kind: "save-as-new",
    name: "Christmas",
    inUse: true,
    warningLines: ["Brand colour: buttons are hard to see on dark screens."],
  },
};

const cases = (["light", "dark"] as const).flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    (Object.keys(requests) as State[]).map((state) => ({ theme, locale, state })),
  ),
);

it.each(cases)(
  "the theme name dialog has no accessibility violations: $state, $locale, $theme",
  async ({ theme, locale, state }) => {
    setLocale(locale);
    const { el, host } = await mountWidget<ThemeNameDialog>(
      "dashboard-theme-name-dialog",
      {},
      theme,
    );
    const submit = vi
      .fn<ThemeNameRequest["submit"]>()
      .mockRejectedValue({ code: "theme.name_taken", params: { field: "name" } });
    el.show({ ...requests[state], submit });
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    const input = dialog.querySelector<WtInput>("wt-input[name=name]")!;
    const actions = dialog.querySelector<WtFormActions>("wt-form-actions")!;
    if (state === "first-save-empty" || state === "taken") {
      if (state === "first-save-empty") {
        // An empty first save is savable only once the switch has changed.
        dialog.querySelector("wt-switch[name=inUse]")!.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { checked: true },
            bubbles: true,
            composed: true,
          }),
        );
        await el.updateComplete;
      }
      dialog.querySelector<HTMLElement>("wt-button[data-test=name-save]")!.click();
      await expect.poll(() => actions.error).not.toBe("");
      await expect.poll(() => input.error).not.toBe("");
      await input.updateComplete;
      await actions.updateComplete;
    }
    if (state === "warning") {
      await expect.poll(() => dialog.querySelector("[data-test=name-warnings] li")).toBeTruthy();
    }
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    await expectNoA11yViolations(host);
  },
);
