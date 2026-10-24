import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { mountThemed } from "./a11y-helpers.js";
import { ColorSchemeController } from "./color-scheme.js";
import { cleanup, host, mount } from "./test-helpers.js";
import { THEME_STORAGE_KEY, chooseTheme, startThemeChoice } from "./theme-choice.js";
import { applyTokens } from "./tokens/index.js";
import { WAITRON_LOCKUP_DARK_URL, WAITRON_LOCKUP_URL } from "./waitron-lockup.js";
import darkLockup from "../brand/waitron-lockup-dark.svg?raw";
import lightLockup from "../brand/waitron-lockup.svg?raw";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

const onChange = vi.fn();

class SchemeProbe extends LitElement {
  readonly scheme = new ColorSchemeController(this, onChange);
  updates = 0;
  override render() {
    return html`${String(this.scheme.dark)}`;
  }
  override updated(): void {
    this.updates += 1;
  }
}
customElements.define("scheme-probe", SchemeProbe);

class SilentSchemeProbe extends LitElement {
  readonly scheme = new ColorSchemeController(this);
  override render() {
    return html`${String(this.scheme.dark)}`;
  }
}
customElements.define("silent-scheme-probe", SilentSchemeProbe);

class PreviewShapedProbe extends LitElement {
  override render() {
    return html`<div class="panel" data-theme="dark"><scheme-probe></scheme-probe></div>`;
  }
  override firstUpdated(): void {
    applyTokens(this.renderRoot.querySelector<HTMLElement>(".panel")!);
  }
}
customElements.define("preview-shaped-probe", PreviewShapedProbe);

const text = (probe: LitElement): string => probe.shadowRoot!.textContent!.trim();

beforeEach(() => {
  onChange.mockClear();
  localStorage.removeItem(THEME_STORAGE_KEY);
});

afterEach(async () => {
  chooseTheme("device");
  await commands.emulateColorScheme(null);
  startThemeChoice(document.documentElement);
  cleanup();
});

describe("ColorSchemeController", () => {
  it("answers false under a light root and true under a dark one", async () => {
    const light = (await mountThemed("<scheme-probe></scheme-probe>", "light")) as SchemeProbe;
    light.requestUpdate();
    await light.updateComplete;
    expect(light.scheme.dark).toBe(false);
    expect(text(light)).toBe("false");

    const dark = (await mountThemed("<scheme-probe></scheme-probe>", "dark")) as SchemeProbe;
    dark.requestUpdate();
    await dark.updateComplete;
    expect(dark.scheme.dark).toBe(true);
    expect(text(dark)).toBe("true");
  });

  it("answers false before its host first connects", () => {
    const probe = document.createElement("scheme-probe") as SchemeProbe;
    expect(probe.scheme.dark).toBe(false);
  });

  it("follows the Theme setting without a change callback", async () => {
    const probe = (await mount("<silent-scheme-probe></silent-scheme-probe>")) as SilentSchemeProbe;
    startThemeChoice(host);
    await probe.updateComplete;

    chooseTheme("dark");
    await probe.updateComplete;
    expect(text(probe)).toBe("true");
  });

  it("follows the Theme setting, one host update per flip", async () => {
    const probe = (await mount("<scheme-probe></scheme-probe>")) as SchemeProbe;
    startThemeChoice(host);
    await probe.updateComplete;
    expect(text(probe)).toBe("false");
    const before = probe.updates;

    chooseTheme("dark");
    await probe.updateComplete;
    expect(text(probe)).toBe("true");
    expect(probe.updates).toBe(before + 1);
    expect(onChange).toHaveBeenCalledTimes(1);

    chooseTheme("light");
    await probe.updateComplete;
    expect(text(probe)).toBe("false");
    expect(probe.updates).toBe(before + 2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("asks for no update when the Theme setting changes but the answer does not", async () => {
    const probe = (await mount("<scheme-probe></scheme-probe>")) as SchemeProbe;
    startThemeChoice(host);
    await probe.updateComplete;
    const before = probe.updates;

    chooseTheme("light");
    await probe.updateComplete;
    expect(text(probe)).toBe("false");
    expect(probe.updates).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("follows the device under Follow device", async () => {
    await commands.emulateColorScheme("light");
    const probe = (await mount("<scheme-probe></scheme-probe>")) as SchemeProbe;
    expect(text(probe)).toBe("false");
    const before = probe.updates;

    await commands.emulateColorScheme("dark");
    await vi.waitFor(() => expect(text(probe)).toBe("true"));
    expect(probe.updates).toBe(before + 1);
    expect(onChange).toHaveBeenCalledTimes(1);

    await commands.emulateColorScheme("light");
    await vi.waitFor(() => expect(text(probe)).toBe("false"));
    expect(probe.updates).toBe(before + 2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("reads its panel's scheme on its first render", async () => {
    const preview = (await mount("<preview-shaped-probe></preview-shaped-probe>")) as LitElement;
    const probe = preview.shadowRoot!.querySelector<SchemeProbe>("scheme-probe")!;
    await preview.updateComplete;
    await probe.updateComplete;
    expect(text(probe)).toBe("true");
  });

  it("stops listening when disconnected", async () => {
    await commands.emulateColorScheme("light");
    const probe = (await mount("<scheme-probe></scheme-probe>")) as SchemeProbe;
    startThemeChoice(host);
    await probe.updateComplete;
    const control = document.createElement("silent-scheme-probe") as SilentSchemeProbe;
    host.append(control);
    await control.updateComplete;
    const before = probe.updates;
    probe.remove();

    await commands.emulateColorScheme("dark");
    await vi.waitFor(() => expect(text(control)).toBe("true"));
    expect(probe.updates).toBe(before);

    chooseTheme("light");
    await control.updateComplete;
    expect(text(control)).toBe("false");
    expect(probe.updates).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("starts listening again when reconnected", async () => {
    const probe = (await mount("<scheme-probe></scheme-probe>")) as SchemeProbe;
    startThemeChoice(host);
    probe.remove();
    host.append(probe);
    await probe.updateComplete;
    const before = probe.updates;

    chooseTheme("dark");
    await probe.updateComplete;
    expect(text(probe)).toBe("true");
    expect(probe.updates).toBe(before + 1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// Vite inlines the files as data addresses in one run and serves them by path in another, so the
// served drawing is compared with the file's once both are parsed.
const drawing = (svg: string) =>
  new XMLSerializer()
    .serializeToString(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement)
    .replace(/\s+/g, " ");
const served = async (url: string) => drawing(await (await fetch(url)).text());

describe("the Waitron lockup addresses", () => {
  it("load as images and differ", async () => {
    expect(WAITRON_LOCKUP_URL).not.toBe(WAITRON_LOCKUP_DARK_URL);
    for (const src of [WAITRON_LOCKUP_URL, WAITRON_LOCKUP_DARK_URL]) {
      const img = new Image();
      img.src = src;
      await expect(img.decode()).resolves.toBeUndefined();
    }
  });

  it("each names its own drawing", async () => {
    expect(drawing(lightLockup)).not.toBe(drawing(darkLockup));
    expect(await served(WAITRON_LOCKUP_URL)).toBe(drawing(lightLockup));
    expect(await served(WAITRON_LOCKUP_DARK_URL)).toBe(drawing(darkLockup));
  });
});
