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
