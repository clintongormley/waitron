import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { enabledModules } from "@waitron/module";
import { drain } from "@waitron/fiscal-verifactu";
import { venueFiscalSelection, type VenueRequest } from "@waitron/provisioning";
import type { RegistroAlta, RegistroAnulacion, VerifactuClient } from "@waitron/verifactu";
import { createFakeAeat, keyOf } from "@waitron/verifactu/testing";
import { ALL_MODULES } from "./modules.js";
import { submitFiscalReadiness } from "./fiscal-readiness-runner.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
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

it("uses one supplied isolated issue reading for the sample invoice and actual generation, apart from tender time", async () => {
  const {
    submitFiscalReadiness: submit,
    fiscalReadinessInput,
    fiscalReadinessDatabaseKey,
  } = await import("@waitron/provisioning");
  const { DatabaseSync } = await import("node:sqlite");
  const stateDir = await mkdtemp(join(tmpdir(), "readiness-zone-generation-"));
  dirs.push(stateDir);
  const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
  const modules = enabledModules(ALL_MODULES, selected.config);
  const contribution = {
    ...selected.contribution!,
    drain: async () => ({
      ...(await import("@waitron/fiscal")).emptyDrainResult(),
      recordsAccepted: 1,
    }),
  };
  const input = fiscalReadinessInput({
    venue,
    contribution,
    secret: undefined,
    moduleVersions: { core: 1 },
    applicationVersion: "saved-zone-reading",
  });
  const clock = vi.fn(() => ({
    now: () => ({
      instant: new Date("2026-10-14T23:30:00Z"),
      offsetMinutes: 0,
      confident: true,
      confidence: "anchored" as const,
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("unused anchor");
    },
    currentAnchor: () => null,
  }));
  await expect(
    submit({
      stateDir,
      modules,
      venue,
      contribution,
      secret: undefined,
      ring: {} as never,
      readinessInput: input,
      clock,
      now: () => new Date("2026-10-20T12:00:00Z"),
    }),
  ).resolves.toEqual({ status: "accepted" });
  expect(clock).toHaveBeenCalledTimes(1);
  const db = new DatabaseSync(
    join(stateDir, `fiscal-readiness-db-${fiscalReadinessDatabaseKey(input)}`, "venue.db"),
  );
  try {
    expect(db.prepare("select issued_at, issued_offset_minutes from sales").all()).toEqual([
      { issued_at: "2026-10-14T23:30:00.000Z", issued_offset_minutes: 120 },
    ]);
    expect(
      db
        .prepare(
          "select fecha_expedicion_factura, fecha_hora_huso_gen_registro, offset_minutos from registros_facturacion",
        )
        .all(),
    ).toEqual([
      {
        fecha_expedicion_factura: "2026-10-15",
        fecha_hora_huso_gen_registro: "2026-10-14T23:30:00.000Z",
        offset_minutos: 120,
      },
    ]);
    expect(db.prepare("select settled_at from tenders").all()).toEqual([
      { settled_at: "2026-10-20T12:00:00.000Z" },
    ]);
  } finally {
    db.close();
  }
});
