import { expect, it } from "vitest";
import { compareStationNames } from "./station-names.js";

it("orders station names with Spanish accents and letter order", () => {
  expect(
    ["Ñandú", "barra", "Cocina", "Ásador", "Níspero", "Naranja"].sort(compareStationNames),
  ).toEqual(["Ásador", "barra", "Cocina", "Naranja", "Níspero", "Ñandú"]);
});
