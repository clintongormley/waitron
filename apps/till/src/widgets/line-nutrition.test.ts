import { afterAll, afterEach, expect, it } from "vitest";
import { render } from "lit";
import { setLocale, t } from "../i18n/t.js";
import { lineNutrition } from "./line-nutrition.js";

const host = document.createElement("div");
document.body.append(host);
afterAll(() => host.remove());
afterEach(() => {
  render(null, host);
  setLocale("en");
});

it.each(["en", "es"] as const)(
  "distinguishes recorded declarations from missing capture (%s)",
  (locale) => {
    setLocale(locale);
    const recorded = t("allergens.recorded_when_sent");
    const missing = t("allergens.sent_not_recorded");
    render(lineNutrition({ allergens: { milk: {} }, dietaryDeclarations: [] }, true), host);
    expect(host.textContent).toContain(recorded);
    expect(host.textContent).not.toContain(missing);
    render(lineNutrition(undefined, true), host);
    expect(host.textContent).toContain(missing);
    expect(host.textContent).not.toContain(recorded);
    render(lineNutrition({ allergens: null, dietaryDeclarations: [] }, true), host);
    expect(host.textContent).toContain(recorded);
    expect(host.textContent).not.toContain(missing);
  },
);

it("keeps held and editable declarations free of a first-send label", () => {
  render(lineNutrition({ allergens: { milk: {} }, dietaryDeclarations: [] }), host);
  expect(host.textContent).toContain("Milk");
  expect(host.textContent).not.toContain("Recorded when sent");
  render(lineNutrition(undefined), host);
  expect(host.textContent).toBe("");
});
