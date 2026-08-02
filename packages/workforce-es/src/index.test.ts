import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      ["ANOS_CONSERVACION", "TITULARES_ACCESO", "exportTimeRecord"].sort(),
    );
  });
});
