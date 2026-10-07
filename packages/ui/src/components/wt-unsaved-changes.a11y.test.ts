import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { WtUnsavedChanges } from "./wt-unsaved-changes.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("unsaved changes a11y (%s)", (theme) => {
  test.each(["en", "es"] as const)("open with %s copy", async (language) => {
    const el = (await mountThemed(
      "<wt-unsaved-changes></wt-unsaved-changes>",
      theme,
    )) as WtUnsavedChanges;
    const copy =
      language === "en"
        ? [
            "Discard unsaved changes?",
            "Your changes have not been saved.",
            "Keep editing",
            "Discard changes",
          ]
        : [
            "¿Descartar los cambios sin guardar?",
            "Tus cambios no se han guardado.",
            "Seguir editando",
            "Descartar cambios",
          ];
    [el.heading, el.message, el.keepLabel, el.discardLabel] = copy as [
      string,
      string,
      string,
      string,
    ];
    el.open = true;
    await el.updateComplete;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    for (const button of modal.querySelectorAll("wt-button")) await button.updateComplete;
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(
      modal.shadowRoot!.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent,
    ).toBe(copy[1]);
    await expectNoA11yViolations(host);
  });

  test("closed question is absent from the accessibility tree", async () => {
    const el = (await mountThemed(
      '<wt-unsaved-changes heading="Discard unsaved changes?" keepLabel="Keep editing" discardLabel="Discard changes"></wt-unsaved-changes>',
      theme,
    )) as WtUnsavedChanges;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(false);
    await expectNoA11yViolations(host);
  });
});
