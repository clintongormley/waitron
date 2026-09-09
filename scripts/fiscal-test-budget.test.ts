import { expect, it } from "vitest";
import config from "../packages/fiscal-verifactu/vitest.config.js";

it("caps the shared fiscal worker pool at the outer Vitest configuration", () => {
  // Vitest 3 creates its shared pool from this outer config; project maxForks is ignored.
  expect(config.test?.poolOptions?.forks?.maxForks).toBe(4);
});
