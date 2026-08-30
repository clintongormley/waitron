import { afterEach, describe, expect, it } from "vitest";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "./locale-controller.js";

@customElement("locale-probe")
class LocaleProbe extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override render() {
    return html`<span>${t("action.logout")}</span>`;
  }
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("LocaleChangeController", () => {
  it("repaints the host when the locale changes", async () => {
    // Start at the en-GB default, switch to es-ES; the probe must repaint from English to Spanish.
    const { el } = await mountWidget<LocaleProbe>("locale-probe", {});
    expect(el.shadowRoot!.textContent).toContain(t("action.logout", "en-GB"));
    setLocale("es-ES");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("action.logout", "es-ES"));
  });

  it("unsubscribes on disconnect so a later switch does not repaint it", async () => {
    const { el, host } = await mountWidget<LocaleProbe>("locale-probe", {});
    expect(el.shadowRoot!.textContent).toContain(t("action.logout", "en-GB"));
    host.remove(); // disconnectedCallback → hostDisconnected → dispose
    setLocale("es-ES");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("action.logout", "en-GB"));
  });

  it("invokes a custom handler instead of the default requestUpdate", async () => {
    let calls = 0;
    // A second controller on the same (already-connected) host with an explicit handler
    // exercises the `handler ?? default` branch; the probe above covers the default branch.
    // Lit's addController calls hostConnected immediately when the host is already
    // connected, so the custom controller subscribes at construction time here.
    const { el } = await mountWidget<LocaleProbe>("locale-probe", {});
    new LocaleChangeController(el, () => {
      calls += 1;
    });
    setLocale("es-ES");
    expect(calls).toBe(1);
  });
});
