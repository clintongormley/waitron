import { expect, it } from "vitest";
import { START_CLOCK_WAITING_WORDS } from "./start-clock-waiting.js";

it("the restore clock page's field is Master key, and its explanation ends asking for it", () => {
  const en = START_CLOCK_WAITING_WORDS["en-GB"];
  const es = START_CLOCK_WAITING_WORDS["es-ES"];
  expect([en.keyLabel, es.keyLabel]).toEqual(["Master key", "Clave maestra"]);
  expect(en.why).toMatch(
    / If that page is closed, type the master key below to confirm the time from this device\.$/,
  );
  expect(es.why).toMatch(
    / Si esa página está cerrada, escribe abajo la clave maestra para confirmar la hora desde este dispositivo\.$/,
  );
});
