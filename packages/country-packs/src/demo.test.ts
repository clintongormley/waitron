import { expect, it } from "vitest";
import { COUNTRY_PACKS } from "./index.js";

it("resolves every installed pack's demo and the default through the secondary registry", async () => {
  const registry = await import("@waitron/country-packs/demo");
  const dataSets: Readonly<Record<string, { readonly id: string }>> = registry.DEMO_DATA_SETS;
  expect(registry.DEFAULT_DEMO_DATA_SET_ID).toBe("casa-delgado-es");
  expect(Object.keys(registry.DEMO_DATA_SETS)).toEqual([
    registry.DEFAULT_DEMO_DATA_SET_ID,
    "casa-delgado-ca",
    "casa-delgado-valencia",
  ]);
  for (const pack of COUNTRY_PACKS) {
    if (pack.demo?.dataSet !== undefined)
      expect(dataSets[pack.demo.dataSet]!.id).toBe(pack.demo.dataSet);
  }
  expect(registry.DEFAULT_DEMO_DEVELOPER_PRESET).toBe(registry.DEMO_DEVELOPER_PRESETS.madrid);
  expect(registry.DEMO_MEDIA_ROOTS[registry.DEFAULT_DEMO_DATA_SET_ID]).toBeInstanceOf(URL);
});
