import { expect, it } from "vitest";
import { VENUE_SERVICE_STRINGS } from "./strings.js";

// Weaker than its name: reads venue-service's dashboard catalogue only, not its starter content
// (starter-content.ts) or any other module's Spanish strings.
it("calls a restaurant menu a carta in Spanish, never a menú", () => {
  const menu = /(?<!\p{L})men[úu]s?(?!\p{L})/iu;
  const saysMenu = Object.entries(VENUE_SERVICE_STRINGS.es)
    .filter(([, text]) => menu.test(text.replace(/\{[^}]*\}/g, "")))
    .map(([key]) => key);
  expect(saysMenu).toEqual([]);
});
