import { expect, it } from "vitest";
import { personalDataReadme } from "../personal-data-readme.js";

it("describes signed drawer amounts and the recorded payment outcome time in Spanish", () => {
  const readme = personalDataReadme({
    language: "es",
    venue: "Example Bar",
    person: "Martha",
    date: "2026-11-22",
    files: ["actions.json"],
  });
  expect(readme).toContain("Las salidas de efectivo llevan un signo menos.");
  expect(readme).toContain("lo que se retiró para el banco como un importe positivo o cero.");
  expect(readme).toContain("cuándo consta que se recibió o falló el pago.");
});

it.each([
  ["en", "today’s menu name", "the original author and time", "when you created it"],
  ["es", "el nombre actual de la carta", "la persona y la hora originales", "cuándo la creaste"],
] as const)("explains menu and booking entries in %s", (language, menuName, original, created) => {
  const readme = personalDataReadme({
    language,
    venue: "Example Bar",
    person: "Martha",
    date: "2026-11-22",
    files: ["menu-publications.json", "bookings-created.json"],
  });
  expect(readme).toContain("- menu-publications.json: ");
  expect(readme).toContain(menuName);
  expect(readme).toContain(original);
  expect(readme).toContain("- bookings-created.json: ");
  expect(readme).toContain(created);
});
