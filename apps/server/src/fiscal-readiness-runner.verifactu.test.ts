import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { enabledModules } from "@waitron/module";
import { drain } from "@waitron/fiscal-verifactu";
import { venueFiscalSelection, type VenueRequest } from "@waitron/provisioning";
import type { RegistroAlta, RegistroAnulacion, VerifactuClient } from "@waitron/verifactu";
import { createFakeAeat, keyOf } from "@waitron/verifactu/testing";
import { ALL_MODULES } from "./modules.js";
import { submitFiscalReadiness } from "./fiscal-readiness-runner.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const venue: VenueRequest = {
  country: "ES",
  taxId: "B12345674",
  legalName: "Ready SL",
  taxpayerDomicile: "Calle Fiscal 8, 28001 Madrid",
  location: {
    name: "Prepared",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant",
    addressLine1: "Calle 1",
    addressLine2: null,
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
  },
  seriesCode: "F",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "R",
  admin: { displayName: "Admin", email: "admin@example.test", pinHash: "pin", passwordHash: "pw" },
};

it("reports a sample the real Veri*Factu drain files as rejected as rejected, with AEAT's refusal", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-verifactu-"));
  dirs.push(stateDir);
  const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
  const modules = enabledModules(ALL_MODULES, selected.config);
  // The sale and its envío take the wall clock; a minute later the envío is due.
  const now = new Date(Date.now() + 60_000);
  const aeat = createFakeAeat({ serverNow: now });
  const real = aeat.client();
  // Every record this envío carries is refused, whatever its invoice number turns out to be.
  let sent = 0;
  const refusesEverything: VerifactuClient = {
    submit: (cabecera, registros) => {
      sent += registros.length;
      for (const registro of registros) {
        const record: RegistroAlta | RegistroAnulacion =
          "RegistroAlta" in registro ? registro.RegistroAlta : registro.RegistroAnulacion;
        aeat.reject(keyOf(record), 1161, "Valor incorrecto");
      }
      return real.submit(cabecera, registros);
    },
    consultar: (...args) => real.consultar(...args),
  };

  const result = await submitFiscalReadiness({
    stateDir,
    modules,
    venue,
    contribution: {
      ...selected.contribution!,
      activationReadiness: "accepted-test-submission" as const,
      provisioningSecret: { required: () => false, validate: () => {}, seal: async () => {} },
      drain: ({ db, environment, skipRetryMs }, at) =>
        drain({ db, resolveClient: async () => refusesEverything, environment, skipRetryMs }, at),
    },
    secret: undefined,
    ring: {} as never,
    readinessInput: {
      requirement: "accepted-test-submission",
      fiscalModule: selected.contribution!.id,
      country: venue.country,
      taxId: venue.taxId,
      legalName: venue.legalName,
      fiscalTerritory: venue.location.fiscalTerritory,
      submissionTarget: null,
      certificateFingerprint: null,
      certificateKind: null,
      moduleVersions: { core: 1 },
      applicationVersion: "0.0.0",
    },
    now: () => now,
  });

  expect(sent).toBe(1);
  expect(result).toEqual({
    status: "rejected",
    rejections: [{ code: "1161", message: "Valor incorrecto" }],
  });
});
