import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-dialog.js";
import "./wt-button.js";
import "./wt-form-actions.js";
import "./wt-help-tooltip.js";
import { setHelpMode } from "../help-mode.js";

afterEach(cleanup);
afterEach(() => setHelpMode(false));

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

  test("keeps footer contrast separate from clipped body text", async () => {
    // #2910: separate clipped grid text from the footer in a stacked shadow-dialog scan.
    const wrapper = await mountThemed("<div></div>", theme);
    const root = wrapper.attachShadow({ mode: "open" });
    root.innerHTML = `<wt-dialog heading="Edit printer">
      <div style="display: grid">
        <div data-filler style="height: 1000px"></div>
        <section><h3>Used by</h3><p>Kitchen</p></section>
        <div style="height: 1000px"></div>
      </div>
      <div slot="footer" style="width: 100%"><wt-button variant="danger">Delete printer</wt-button></div>
    </wt-dialog><wt-dialog id="above" heading="Calibration">Print a test page</wt-dialog>`;
    const el = root.querySelector("wt-dialog")! as Openable;
    el.open = true;
    await el.updateComplete;
    const footerButton = el.querySelector("wt-button")!;
    await footerButton.updateComplete;
    const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const heading = el.querySelector("h3")!;
    const button = footerButton.shadowRoot!.querySelector("button")!;
    const filler = el.querySelector<HTMLElement>("[data-filler]")!;
    filler.style.height = `${filler.getBoundingClientRect().height + button.getBoundingClientRect().top - heading.getBoundingClientRect().top + 2}px`;
    const h = heading.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    expect(h.top).toBeGreaterThan(body.getBoundingClientRect().bottom);
    expect(h.left < b.right && h.right > b.left && h.top < b.bottom && h.bottom > b.top).toBe(true);
    const above = root.querySelector("#above")! as Openable;
    above.open = true;
    await above.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("open, with the footer actions' message in the footer, above the buttons", async () => {
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
    expect(el.shadowRoot!.querySelector(".footer > [data-error]")).not.toBeNull();
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

  test("with a help-mode badge, help off", async () => {
    const el = (await mountThemed(
      '<wt-dialog heading="Void sale"><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Void sale">What voiding does.</wt-help-tooltip>This will create a corrective record.</wt-dialog>',
      theme,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("with a help-mode badge, help on", async () => {
    const el = (await mountThemed(
      '<wt-dialog heading="Void sale"><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Void sale">What voiding does.</wt-help-tooltip>This will create a corrective record.</wt-dialog>',
      theme,
    )) as Openable;
    setHelpMode(true);
    el.open = true;
    await el.updateComplete;
    const badge = el.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-help-tooltip",
    )!;
    await badge.updateComplete;
    expect(badge.checkVisibility()).toBe(true);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
