import { expect, it } from "vitest";
import { ALL_MODULES } from "./modules.js";
import { recoveryFiscalSelection } from "./recovery-fiscal-selection.js";

const venue = { country: "ES", fiscalTerritory: "ES-common", timeZone: "Europe/Madrid" };
const manifest = {
  manifestVersion: 1 as const,
  environment: "preproduction" as const,
  createdAt: "2026-10-16T11:40:00.000Z",
  modules: { "fiscal-verifactu": 1 },
};
const configured = { modules: { "fiscal-verifactu": true, "fiscal-none": false } };
function read(
  options: {
    config?: unknown;
    text?: string;
    versions?: Record<string, number>;
    recorded?: Record<string, number>;
    modules?: typeof ALL_MODULES;
    location?: typeof venue;
  } = {},
) {
  return recoveryFiscalSelection(
    options.location ?? venue,
    { ...manifest, modules: options.versions ?? manifest.modules },
    [
      {
        name: "secrets/modules.json",
        bytes: Buffer.from(options.text ?? JSON.stringify(options.config ?? configured)),
      },
    ],
    options.modules ?? ALL_MODULES,
    null,
    options.recorded ?? options.versions ?? manifest.modules,
  );
}

it.each([undefined, -1, 0, 0.5, NaN, Infinity])(
  "does not select a filing module whose recorded migration count is %s",
  (version) => {
    expect(
      read({ versions: version === undefined ? {} : { "fiscal-verifactu": version } }),
    ).toBeUndefined();
  },
);
it.each(["{", "null", "[]", "false"])(
  "keeps damaged saved module configuration out of filing selection: %s",
  (text) => {
    expect(read({ text })).toBeUndefined();
  },
);
it("does not substitute a different installed module for the recorded one", () => {
  expect(
    read({ modules: ALL_MODULES.filter((module) => module.name !== "fiscal-verifactu") }),
  ).toBeUndefined();
});
it("does not choose between two installed providers of the recorded filing slot", () => {
  const owner = ALL_MODULES.find((module) => module.name === "fiscal-verifactu")!;
  expect(
    read({ modules: [...ALL_MODULES, { ...owner, name: "another-provider" }] }),
  ).toBeUndefined();
});
it("retains a valid recorded zone instead of replacing it with the country default", () => {
  expect(read({ location: { ...venue, timeZone: "UTC" } })).toEqual({
    ...venue,
    timeZone: "UTC",
    module: "fiscal-verifactu",
  });
});
it("does not normalise a noncanonical stored country into a different selection", () => {
  expect(read({ location: { ...venue, country: " es " } })).toBeUndefined();
});

const recordedVersionCases: Record<string, number>[] = [
  {},
  { "fiscal-verifactu": 0 },
  { "fiscal-verifactu": 2 },
];
it.each(recordedVersionCases)(
  "requires the manifest's filing migration count to match the original private copy: %j",
  (recorded) => {
    expect(read({ recorded })).toBeUndefined();
  },
);
