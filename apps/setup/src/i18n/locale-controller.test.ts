import { afterEach, describe, expect, it } from "vitest";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "./t.js";
import { LocaleChangeController } from "./locale-controller.js";

@customElement("setup-locale-probe")
class SetupLocaleProbe extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override render() {
    return html`<span>${t("shell.document_title")}</span>`;
  }
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("LocaleChangeController", () => {
  it("repaints the host when the locale changes", async () => {
    const { el } = await mountWidget<SetupLocaleProbe>("setup-locale-probe", {});
    expect(el.shadowRoot!.textContent).toContain(t("shell.document_title", "en-GB"));
    setLocale("es-ES");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("shell.document_title", "es-ES"));
  });

  it("unsubscribes on disconnect so a later switch does not repaint it", async () => {
    const { el, host } = await mountWidget<SetupLocaleProbe>("setup-locale-probe", {});
    expect(el.shadowRoot!.textContent).toContain(t("shell.document_title", "en-GB"));
    host.remove();
    setLocale("es-ES");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("shell.document_title", "en-GB"));
  });

  it("invokes a custom handler instead of the default requestUpdate", async () => {
    let calls = 0;
    // Lit's addController calls hostConnected at once on an already-connected host, so this
    // controller subscribes at construction time.
    const { el } = await mountWidget<SetupLocaleProbe>("setup-locale-probe", {});
    new LocaleChangeController(el, () => {
      calls += 1;
    });
    setLocale("es-ES");
    expect(calls).toBe(1);
  });
});
