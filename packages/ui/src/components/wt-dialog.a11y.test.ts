import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-dialog.js";
import "./wt-button.js";

afterEach(cleanup);

type Openable = HTMLElement & { open: boolean; updateComplete: Promise<unknown> };

describe.each(["light", "dark"] as const)("wt-dialog a11y (%s theme)", (theme) => {
  // Modal semantics (aria-modal, the focus trap, aria-labelledby pointing at a real heading) only
  // matter once the dialog is actually open — a closed <dialog> isn't exposed to the accessibility
  // tree at all, so this state is the one that counts.
  test("open, with a heading", async () => {
    const el = (await mountThemed(
      '<wt-dialog heading="Anular venta">Esto generará un registro rectificativo.</wt-dialog>',
      theme,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("open, with a footer", async () => {
    const el = (await mountThemed(
      '<wt-dialog heading="Anular venta">Cuerpo<wt-button slot="footer" variant="danger">Anular</wt-button></wt-dialog>',
      theme,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  // No `heading` — the accessible name has to come from the forwarded aria-label fallback
  // instead. This was one of the real ARIA defects: without it, an open heading-less dialog has
  // no accessible name at all.
  test("open, heading-less, named via aria-label", async () => {
    const el = (await mountThemed(
      '<wt-dialog aria-label="Cerrar sesión">¿Seguro que quieres salir?</wt-dialog>',
      theme,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
