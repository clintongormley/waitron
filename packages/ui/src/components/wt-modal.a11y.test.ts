import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { WtModal } from "./wt-modal.js";
import "./wt-form-actions.js";
import "./wt-button.js";
import "./wt-input.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-modal a11y (%s theme)", (theme) => {
  test("names the open form and its footer actions", async () => {
    const modal = (await mountThemed(
      `<wt-modal heading="Add printer">
        <wt-input name="printer-name" label="Printer name"></wt-input>
        <wt-form-actions slot="footer">
          <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
          <wt-button>Save</wt-button>
        </wt-form-actions>
      </wt-modal>`,
      theme,
    )) as WtModal;
    modal.open = true;
    await modal.updateComplete;
    await expectNoA11yViolations(host);
  });

  test.each(["compact", "standard"])("an open %s modal", async (size) => {
    const modal = (await mountThemed(
      `<wt-modal heading="Add printer" size="${size}">
        <wt-input name="printer-name" label="Printer name"></wt-input>
        <wt-form-actions slot="footer">
          <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
          <wt-button>Save</wt-button>
        </wt-form-actions>
      </wt-modal>`,
      theme,
    )) as WtModal;
    modal.open = true;
    await modal.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("with the form's message at the end of the body", async () => {
    const modal = (await mountThemed(
      `<wt-modal heading="Add passkey">
        <wt-input name="passkey-name" label="Passkey name"></wt-input>
        <wt-form-actions slot="footer">
          <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
          <wt-button>Save</wt-button>
        </wt-form-actions>
      </wt-modal>`,
      theme,
    )) as WtModal;
    modal.open = true;
    await modal.updateComplete;
    const actions = modal.querySelector("wt-form-actions")!;
    actions.error = "This device already holds a passkey for your account.";
    await actions.updateComplete;
    await modal.updateComplete;
    await expectNoA11yViolations(host);
  });
});
