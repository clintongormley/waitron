import { mediaTestReference, mediaTestRendition } from "@waitron/ui/src/test-helpers.js";
import type { ThemeLogo } from "@waitron/ui-core/theme";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi, ThemeLogoPrint } from "../api/client.js";
import { en, es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { ImageUpload } from "./image-upload.js";
import type { ThemeLogoField } from "./theme-logo-field.js";
import "./theme-logo-field.js";

const LIGHT = mediaTestReference("lucia.png");
const DARK = mediaTestReference("lucia-dark.png");
const NEW = mediaTestReference("new.png");

const BLACK: ThemeLogoPrint = {
  paperDots: 504,
  address: mediaTestRendition(LIGHT, "display"),
  picture: { widthDots: 16, heightDots: 1, data: "8A8=" },
  blackDots: 8,
};

const api = () =>
  ({
    imageLibraryRequest: vi.fn(),
    getThemeLogoPrint: vi.fn(async () => BLACK),
  }) as unknown as DashboardApi;

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

async function field(props: Partial<ThemeLogoField> = {}) {
  const { el } = await mountWidget<ThemeLogoField>("dashboard-theme-logo-field", {
    api: api(),
    logo: null,
    ...props,
  });
  return el;
}

const q = <T extends Element = HTMLElement>(el: ThemeLogoField, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const main = (el: ThemeLogoField) =>
  q<ImageUpload>(el, 'dashboard-image-upload[name="logo.light"]');
const dark = (el: ThemeLogoField) => q<ImageUpload>(el, 'dashboard-image-upload[name="logo.dark"]');
const printed = (el: ThemeLogoField) =>
  q<HTMLElementTagNameMap["dashboard-theme-logo-print"]>(el, "dashboard-theme-logo-print");
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim();

function changes(el: ThemeLogoField) {
  const sent: CustomEvent<{ logo: ThemeLogo | null }>[] = [];
  el.addEventListener("logo-change", (event) => sent.push(event as CustomEvent));
  return sent;
}

function pick(upload: ImageUpload, image: string | null): CustomEvent {
  const event = new CustomEvent("image-changed", {
    detail: { image },
    bubbles: true,
    composed: true,
  });
  upload.dispatchEvent(event);
  return event;
}

describe("dashboard-theme-logo-field", () => {
  it.each(["en-GB", "es-ES"] as const)(
    "with no logo, in %s, offers only + Add a logo and the hint, and no dark-screens group",
    async (locale) => {
      setLocale(locale);
      const strings = locale === "es-ES" ? es : en;
      const el = await field();
      expect(text(q(el, "fieldset > legend"))).toBe(strings["appearance.logo"]);
      expect(main(el)!.venueLogo).toBe(true);
      expect(main(el)!.image).toBeNull();
      expect(main(el)!.addLabel).toBe("");
      expect(text(main(el)!.shadowRoot!.querySelector("[data-test=choose-image]"))).toBe(
        `+ ${strings["image.add_logo"]}`,
      );
      expect(main(el)!.replaceName).toBe(strings["appearance.logo_replace_name"]);
      expect(main(el)!.removeName).toBe(strings["appearance.logo_remove_name"]);
      expect(text(q(el, "[data-test=logo-hint]"))).toBe(strings["appearance.logo_hint"]);
      expect(dark(el)).toBeNull();
      expect(q(el, "[data-test=logo-dark]")).toBeNull();
      expect(q(el, "[data-test=logo-dark-hint]")).toBeNull();
      expect(el.shadowRoot!.querySelectorAll("dashboard-image-upload")).toHaveLength(1);
    },
  );

  it("a pick sends logo-change with { light }, and the upload's own event goes no further", async () => {
    const el = await field();
    const sent = changes(el);
    const outer = vi.fn();
    el.addEventListener("image-changed", outer);
    pick(main(el)!, NEW);
    expect(sent.map((event) => event.detail)).toEqual([{ logo: { light: NEW } }]);
    expect(Object.keys(sent[0]!.detail.logo!)).toEqual(["light"]);
    expect(sent[0]!.bubbles).toBe(true);
    expect(sent[0]!.composed).toBe(true);
    expect(outer).not.toHaveBeenCalled();
  });

  it("replacing the main image keeps the dark one", async () => {
    const el = await field({ logo: { light: LIGHT, dark: DARK } });
    const sent = changes(el);
    pick(main(el)!, NEW);
    expect(sent.map((event) => event.detail)).toEqual([{ logo: { light: NEW, dark: DARK } }]);
  });

  it.each(["en-GB", "es-ES"] as const)(
    "with a main image, in %s, offers the dark-screens group and its hint",
    async (locale) => {
      setLocale(locale);
      const strings = locale === "es-ES" ? es : en;
      const el = await field({ logo: { light: LIGHT } });
      expect(main(el)!.image).toBe(LIGHT);
      const group = q(el, "[data-test=logo-dark]")!;
      expect(text(group.querySelector(":scope > legend"))).toBe(strings["appearance.logo_dark"]);
      expect(group.contains(dark(el))).toBe(true);
      expect(dark(el)!.venueLogo).toBe(true);
      expect(dark(el)!.image).toBeNull();
      expect(dark(el)!.addLabel).toBe(strings["appearance.logo_dark_add"]);
      expect(text(dark(el)!.shadowRoot!.querySelector("[data-test=choose-image]"))).toBe(
        `+ ${strings["appearance.logo_dark_add"]}`,
      );
      expect(dark(el)!.replaceName).toBe(strings["appearance.logo_dark_replace_name"]);
      expect(dark(el)!.removeName).toBe(strings["appearance.logo_dark_remove_name"]);
      expect(text(group.querySelector("[data-test=logo-dark-hint]"))).toBe(
        strings["appearance.logo_dark_hint"],
      );
      expect(text(q(el, "[data-test=logo-hint]"))).toBe(strings["appearance.logo_hint"]);
    },
  );

  it("a dark pick sends { light, dark }, and with a dark image the hint is gone", async () => {
    const el = await field({ logo: { light: LIGHT } });
    const sent = changes(el);
    const outer = vi.fn();
    el.addEventListener("image-changed", outer);
    pick(dark(el)!, DARK);
    expect(sent.map((event) => event.detail)).toEqual([{ logo: { light: LIGHT, dark: DARK } }]);
    expect(outer).not.toHaveBeenCalled();
    el.logo = { light: LIGHT, dark: DARK };
    await el.updateComplete;
    expect(dark(el)!.image).toBe(DARK);
    expect(q(el, "[data-test=logo-dark-hint]")).toBeNull();
  });

  it("Remove on the main image sends null, taking the dark one with it", async () => {
    setLocale("en-GB");
    const el = await field({ logo: { light: LIGHT, dark: DARK } });
    const sent = changes(el);
    const remove = main(el)!.shadowRoot!.querySelector<HTMLElement>(
      "wt-button[data-test=remove-image]",
    )!;
    await userEvent.click(page.elementLocator(remove.shadowRoot!.querySelector("button")!));
    expect(sent.map((event) => event.detail)).toEqual([{ logo: null }]);
  });

  it("Remove on the dark image sends { light } with no dark key", async () => {
    setLocale("en-GB");
    const el = await field({ logo: { light: LIGHT, dark: DARK } });
    const sent = changes(el);
    const remove = dark(el)!.shadowRoot!.querySelector<HTMLElement>(
      "wt-button[data-test=remove-image]",
    )!;
    await userEvent.click(page.elementLocator(remove.shadowRoot!.querySelector("button")!));
    expect(sent.map((event) => event.detail)).toEqual([{ logo: { light: LIGHT } }]);
    expect(Object.keys(sent[0]!.detail.logo!)).toEqual(["light"]);
  });

  it("errors show under their picker and mark it invalid", async () => {
    const el = await field({ logo: { light: LIGHT } });
    expect(el.shadowRoot!.querySelectorAll("p.error")).toHaveLength(0);
    expect(main(el)!.invalid).toBe(false);
    expect(dark(el)!.invalid).toBe(false);
    el.errors = {
      light: t("appearance.logo_not_found"),
      dark: t("appearance.logo_dark_without_light"),
    };
    await el.updateComplete;
    const lightError = main(el)!.nextElementSibling!;
    expect(lightError.matches("p.error")).toBe(true);
    expect(text(lightError)).toBe(t("appearance.logo_not_found"));
    const darkError = dark(el)!.nextElementSibling!;
    expect(darkError.matches("p.error")).toBe(true);
    expect(text(darkError)).toBe(t("appearance.logo_dark_without_light"));
    expect(main(el)!.invalid).toBe(true);
    expect(dark(el)!.invalid).toBe(true);
    el.errors = { dark: t("appearance.logo_dark_without_light") };
    await el.updateComplete;
    expect(main(el)!.invalid).toBe(false);
    expect(dark(el)!.invalid).toBe(true);
    expect(el.shadowRoot!.querySelectorAll("p.error")).toHaveLength(1);
  });

  it("busy disables both", async () => {
    const el = await field({ logo: { light: LIGHT } });
    expect(main(el)!.disabled).toBe(false);
    expect(dark(el)!.disabled).toBe(false);
    el.busy = true;
    await el.updateComplete;
    expect(main(el)!.disabled).toBe(true);
    expect(dark(el)!.disabled).toBe(true);
  });

  it("hands the api and draft parent to both pickers", async () => {
    const parent = {};
    const given = api();
    const el = await field({ logo: { light: LIGHT }, api: given, draftParent: parent });
    for (const upload of [main(el)!, dark(el)!]) {
      expect(upload.api).toBe(given);
      expect(upload.draftParent).toBe(parent);
    }
  });

  it("shows how the main logo prints after the dark-screens field", async () => {
    const given = api();
    const el = await field({ logo: { light: LIGHT }, api: given });
    const print = printed(el)!;
    expect(print.previousElementSibling).toBe(q(el, '[data-test="logo-dark"]'));
    expect(print.image).toBe(LIGHT);
    expect(print.api).toBe(given);
  });

  it("shows none without a logo", async () => {
    const el = await field();
    expect(printed(el)).toBeNull();
  });

  it("follows the main image, not the dark one", async () => {
    const el = await field({ logo: { light: LIGHT } });
    el.logo = { light: NEW };
    await el.updateComplete;
    expect(printed(el)!.image).toBe(NEW);
    el.logo = { light: LIGHT };
    await el.updateComplete;
    el.logo = { light: LIGHT, dark: DARK };
    await el.updateComplete;
    expect(printed(el)!.image).toBe(LIGHT);
  });
});
