import { afterEach, expect, it } from "vitest";
import { render } from "lit";
import { applyTokens } from "@waitron/ui";
import { currentLocale } from "../i18n/t.js";
import { allergenLabel, allergenName } from "../i18n/allergen-names.js";
import { dietLabel, nutritionIcons } from "./nutrition-icons.js";
import { namedIcons } from "./test-helpers.js";

const hosts: HTMLElement[] = [];
afterEach(() => hosts.splice(0).forEach((host) => host.remove()));

function draw(template: ReturnType<typeof nutritionIcons>): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  hosts.push(host);
  render(template, host);
  return host;
}

it("names each icon for a screen reader, cereal and nut kinds included", async () => {
  const host = draw(
    nutritionIcons({ gluten: { kinds: ["rye"] }, milk: {}, nuts: { kinds: ["almonds"] } }, [
      "vegan",
    ]),
  );
  expect(await namedIcons(host)).toEqual([
    ["allergen-gluten", "img", allergenLabel("gluten", { kinds: ["rye"] }, currentLocale())],
    ["allergen-milk", "img", allergenName("milk", currentLocale())],
    ["allergen-nuts", "img", allergenLabel("nuts", { kinds: ["almonds"] }, currentLocale())],
    ["diet-vegan", "img", dietLabel("vegan")],
  ]);
  expect(host.querySelector("wt-icon[label]")).toBeNull();
});

it("draws icons at the size a caller asks for, larger than the default", async () => {
  const plain = draw(nutritionIcons({ milk: {} }, ["vegan"]));
  const large = draw(nutritionIcons({ milk: {} }, ["vegan"], { size: "lg" }));
  await namedIcons(plain);
  await namedIcons(large);
  const widths = (host: HTMLElement) =>
    [...host.querySelectorAll("wt-icon")].map((icon) => icon.getBoundingClientRect().width);
  const [plainWidth] = widths(plain);
  expect(plainWidth).toBeGreaterThan(0);
  for (const width of widths(large)) expect(width).toBeGreaterThan(plainWidth!);
});
