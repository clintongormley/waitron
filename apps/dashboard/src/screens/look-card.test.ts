import { afterEach, describe, expect, it } from "vitest";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./look-card.js";

type Card = HTMLElementTagNameMap["dashboard-look-card"];

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const q = (el: Card, selector: string) => el.shadowRoot!.querySelector(selector);
const row = (el: Card, name: string) => text(q(el, `[data-test=saved-${name}]`));

function theme(id: string, name: string, choices: ThemeChoices | null): ThemeView {
  const derived = choices === null ? null : deriveTheme(choices);
  return {
    id,
    name,
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: derived?.light ?? null,
    dark: derived?.dark ?? null,
    warnings: derived?.warnings ?? [],
  };
}

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  handSet: { light: {}, dark: {} },
};
const lucia = theme("t-lucia", "Bar Lucía", LUCIA);
const inUse = (view: ThemeView): ThemeList => ({ themes: [view], inUse: view.id });

async function mount(list: ThemeList, canEdit = true): Promise<Card> {
  const { el } = await mountWidget<Card>("dashboard-look-card", {
    api: {} as DashboardApi,
    list,
    canEdit,
  });
  return el;
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("the read-only Look card", () => {
  it("shows Waitron's theme in use, with no Edit even to an editor", async () => {
    setLocale("en-GB");
    const el = await mount({ themes: [lucia], inUse: null }, true);
    const card = q(el, "section.settings-card")!;
    expect(text(card.querySelector("header > h2"))).toBe(t("appearance.look"));
    expect(card.querySelector("h2")!.id).toBe("look-card");
    expect(row(el, "theme")).toBe("Waitron");
    expect(row(el, "brand")).toBe("Waitron's");
    expect(row(el, "background")).toBe("Neutral");
    expect(row(el, "corners")).toBe("Standard");
    expect(row(el, "hand")).toBe("None");
    expect(text(q(el, "[data-test=look-note]"))).toBe(t("appearance.note"));
    expect(q(el, "[data-test=edit]")).toBeNull();
    expect(q(el, "[data-test=saved-warning]")).toBeNull();
  });

  it("labels the rows in order: theme, brand, background, corners, colours set by hand", async () => {
    setLocale("en-GB");
    const el = await mount(inUse(lucia));
    const labels = [...el.shadowRoot!.querySelectorAll("dt")].map((dt) => text(dt));
    expect(labels).toEqual([
      "Theme in use",
      "Brand colour",
      "Background",
      "Corners",
      "Colours set by hand",
    ]);
  });

  it("shows Bar Lucía in use, its brand row naming the dark screens' shade with two chips", async () => {
    setLocale("en-GB");
    const el = await mount(inUse(lucia), true);
    expect(row(el, "theme")).toBe("Bar Lucía");
    expect(row(el, "brand")).toBe("Custom · #1e5b3a · dark screens #437e5b");
    const chips = [...el.shadowRoot!.querySelectorAll("[data-test=saved-brand] .chip")];
    expect(chips.map((chip) => chip.getAttribute("style"))).toEqual([
      "background:#1e5b3a",
      "background:#437e5b",
    ]);
    expect(chips.every((chip) => chip.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(row(el, "background")).toBe("Tinted");
    expect(row(el, "corners")).toBe("Round");
    expect(text(q(el, "[data-test=edit]"))).toBe(t("action.edit"));
  });

  it("offers no Edit to a session that cannot change the look", async () => {
    const el = await mount(inUse(lucia), false);
    expect(row(el, "theme")).toBe("Bar Lucía");
    expect(q(el, "[data-test=edit]")).toBeNull();
  });

  it("names the light screens' shade when the light fix is taken", async () => {
    setLocale("en-GB");
    const lemon = theme("t-lemon", "Lemon Café", {
      ...WAITRON_CHOICES,
      brandColor: "#f2d300",
      brandFix: { light: true },
    });
    const shade = lemon.light!["--wt-color-primary"];
    const el = await mount(inUse(lemon));
    expect(row(el, "brand")).toBe(`Custom · #f2d300 · light screens ${shade}`);
  });

  it("shows a palette colour with no Custom", async () => {
    setLocale("en-GB");
    const el = await mount(
      inUse(theme("t-red", "Red", { ...WAITRON_CHOICES, brandColor: "#b12525" })),
    );
    expect(row(el, "brand")).toBe("#b12525");
  });

  it("shows a warning saved anyway as a line beside a warning icon", async () => {
    setLocale("en-GB");
    const lemon = theme("t-lemon", "Lemon Café", { ...WAITRON_CHOICES, brandColor: "#f2d300" });
    expect(lemon.warnings.length).toBeGreaterThan(0);
    const el = await mount(inUse(lemon));
    const lines = [...el.shadowRoot!.querySelectorAll("[data-test=saved-warning]")];
    expect(lines.map((line) => text(line))).toEqual([
      "Buttons in the brand colour are hard to see on light screens.",
    ]);
    expect(lines[0]!.querySelector("wt-icon")?.getAttribute("name")).toBe("warning");
  });

  it("words a saved warning in Spanish", async () => {
    setLocale("es-ES");
    const lemon = theme("t-lemon", "Lemon Café", { ...WAITRON_CHOICES, brandColor: "#f2d300" });
    const el = await mount(inUse(lemon));
    expect(text(q(el, "[data-test=saved-warning]"))).toBe(es["appearance.saved_brand_light"]);
  });

  it("shows no warning line for a theme saved with none", async () => {
    const lemon = theme("t-lemon", "Lemon Café", { ...WAITRON_CHOICES, brandColor: "#f2d300" });
    const el = await mount(inUse({ ...lemon, warnings: [] }));
    expect(q(el, "[data-test=saved-warning]")).toBeNull();
  });

  it("shows an unreadable theme's name and Waitron's values", async () => {
    setLocale("en-GB");
    const el = await mount(inUse(theme("t-broken", "Old", null)));
    expect(row(el, "theme")).toBe("Old");
    expect(row(el, "brand")).toBe("Waitron's");
    expect(row(el, "background")).toBe("Neutral");
    expect(row(el, "corners")).toBe("Standard");
    expect(row(el, "hand")).toBe("None");
  });

  it("names colours set by hand, light before dark, each in the theme colours' order", async () => {
    setLocale("en-GB");
    expect(row(await mount(inUse(lucia)), "hand")).toBe("None");
    cleanupWidgets();
    const hand = theme("t-hand", "By hand", {
      ...WAITRON_CHOICES,
      handSet: { dark: { bg: "#101010" }, light: { text: "#6a6a6a", bg: "#f8f1e1" } },
    });
    expect(row(await mount(inUse(hand)), "hand")).toBe("Page (light), Text (light), Page (dark)");
    cleanupWidgets();
    setLocale("es-ES");
    const item = (name: string, mode: string) =>
      es["appearance.hand_item"].replace("{name}", name).replace("{mode}", mode);
    const page = es["appearance.colour.bg"];
    const light = es["appearance.mode.light"];
    expect(row(await mount(inUse(hand)), "hand")).toBe(
      [
        item(page, light),
        item(es["appearance.colour.text"], light),
        item(page, es["appearance.mode.dark"]),
      ].join(", "),
    );
  });
});
