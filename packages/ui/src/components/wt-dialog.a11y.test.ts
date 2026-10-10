import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-dialog.js";
import "./wt-button.js";
import "./wt-form-actions.js";

afterEach(cleanup);

type Openable = HTMLElement & { open: boolean; updateComplete: Promise<unknown> };

describe.each(["light", "dark"] as const)("wt-dialog a11y (%s theme)", (theme) => {
  // Modal semantics (aria-modal, the focus trap, aria-labelledby pointing at a real heading) only
  // matter once the dialog is actually open — a closed <dialog> isn't exposed to the accessibility
  // tree at all, so this state is the one that counts.
  test("open, with a heading", async () => {
    const el = (await mountThemed(
      '<wt-dialog heading="Void sale">This will create a corrective record.</wt-dialog>',
      theme,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("open, with a footer", async () => {
    const el = (await mountThemed(
      '<wt-dialog heading="Void sale">Body<wt-button slot="footer" variant="danger">Void</wt-button></wt-dialog>',
      theme,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("open, with the footer actions' message at the end of the body", async () => {
    const el = (await mountThemed(
      `<wt-dialog heading="Add passkey">
        <label>Passkey name <input name="passkey-name" /></label>
        <wt-form-actions slot="footer" error="This device already holds a passkey for your account.">
          <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
          <wt-button>Save</wt-button>
        </wt-form-actions>
      </wt-dialog>`,
      theme,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    const actions = el.querySelector("wt-form-actions")!;
    await actions.updateComplete;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".body > [data-error]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test.each([
    ["focusable content", '<label>Note <input name="note" /></label>'],
    ["text only", ""],
  ])("open, with a body taller than the window, holding %s", async (_, field) => {
    // Text past the visible part of the body, which is what axe's scrollable-region rule looks for.
    const lines = Array.from({ length: 80 }, (_, index) => `<p>Order line ${index + 1}</p>`);
    const el = (await mountThemed(
      `<wt-dialog heading="Edit order">
        ${field}
        ${lines.join("")}
        <wt-form-actions slot="footer">
          <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
          <wt-button>Save</wt-button>
        </wt-form-actions>
      </wt-dialog>`,
      theme,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    await expectNoA11yViolations(host);
  });

  // No `heading`, so the accessible name must come from the forwarded aria-label.
  test("open, heading-less, named via aria-label", async () => {
    const el = (await mountThemed(
      '<wt-dialog aria-label="Log out">Are you sure you want to leave?</wt-dialog>',
      theme,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
