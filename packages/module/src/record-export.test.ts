import { expect, it } from "vitest";
import * as api from "./index.js";
import type { WaitronModule } from "./module.js";
import type { ModuleTimeRecordExport } from "./record-export.js";

const select = (
  api as typeof api & {
    selectTimeRecordExport: (
      modules: readonly WaitronModule[],
    ) => ModuleTimeRecordExport | undefined;
  }
).selectTimeRecordExport;
const provider: ModuleTimeRecordExport = {
  prepare: async () => async () => ({
    title: "Record",
    locale: "en",
    audience: "standard",
    period: { start: "2026-01-01", end: "2026-02-01" },
    notes: [],
    sections: [],
  }),
};
const moduleWith = (name: string, value?: ModuleTimeRecordExport): WaitronModule => ({
  name,
  version: "0.0.0",
  tier: "toggleable",
  migrations: { name, table: name, from: name },
  ...(value === undefined ? {} : { timeRecordExport: value }),
});
it("leaves exports unavailable when no enabled module supplies them", () => {
  expect(select([moduleWith("core")])).toBeUndefined();
});
it("selects the one contributing provider without replacing it", () => {
  expect(select([moduleWith("core"), moduleWith("record", provider)])).toBe(provider);
});
it("refuses ambiguous providers rather than choosing the first", () => {
  expect(() => select([moduleWith("one", provider), moduleWith("two", provider)])).toThrowError(
    expect.objectContaining({ code: "module.config_invalid" }),
  );
});
