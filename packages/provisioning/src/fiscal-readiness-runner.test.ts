import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDrainResult } from "@waitron/fiscal";
import { enabledModules } from "@waitron/module";
import { venueFiscalSelection, type VenueRequest } from "@waitron/provisioning";
import { ALL_MODULES } from "@waitron/composition";
import {
  fiscalReadinessDatabaseKey,
  fiscalReadinessInput,
  submitFiscalReadiness as submit,
} from "./fiscal-readiness-runner.js";
import type { FiscalReadinessInput } from "./fiscal-readiness.js";

function submitFiscalReadiness(args: Omit<Parameters<typeof submit>[0], "clock">) {
  return submit({
    ...args,
    clock: () => ({
      now: () => {
        const instant = new Date();
        return {
          instant,
          offsetMinutes: -instant.getTimezoneOffset(),
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        };
      },
      anchor: () => {
        throw new Error("unused in sample test");
      },
      currentAnchor: () => null,
    }),
  });
}

const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const venue: VenueRequest = {
  country: "GB",
  taxId: "123456789",
  legalName: "Readiness Ltd",
  location: {
    name: "Prepared",
    fiscalTerritory: "GB-vat",
    invoiceLocales: ["en-GB"],
    operationDescription: "Restaurant",
    addressLine1: "1 High Street",
    addressLine2: null,
    postalCode: "SW1A 1AA",
    city: "London",
    province: "London",
    timeZone: "Europe/London",
    dayCutover: "06:00",
  },
  seriesCode: "F",
  rectificativeSeriesCode: "R",
  admin: { displayName: "Admin", email: "admin@example.test", pinHash: "pin", passwordHash: "pw" },
};

describe("fiscal readiness submission runner", () => {
  it("uses every activation-bound input when selecting the retained test database", () => {
    const input: FiscalReadinessInput = {
      requirement: "accepted-test-submission",
      fiscalModule: "verifactu",
      country: "ES",
      taxId: "B12345678",
      legalName: "Ready SL",
      fiscalTerritory: "ES-common",
      submissionTarget: "https://preproduction.example.test/soap",
      certificateFingerprint: "cert-one",
      certificateKind: "sello",
      moduleVersions: { core: 1 },
      applicationVersion: "1.0.0",
    };
    const original = fiscalReadinessDatabaseKey(input);
    expect(fiscalReadinessDatabaseKey({ ...input, legalName: "Changed SL" })).not.toBe(original);
    expect(fiscalReadinessDatabaseKey({ ...input, moduleVersions: { core: 2 } })).not.toBe(
      original,
    );
    expect(fiscalReadinessDatabaseKey({ ...input, applicationVersion: "1.0.1" })).not.toBe(
      original,
    );
    expect(
      fiscalReadinessDatabaseKey({
        ...input,
        submissionTarget: "https://other-preproduction.example.test/soap",
      }),
    ).not.toBe(original);
  });

  it("records the sample in an isolated retained database before asking the fiscal slot to drain", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const drain = vi.fn().mockResolvedValue({ ...emptyDrainResult(), recordsAccepted: 1 });
    const contribution = {
      ...selected.contribution!,
      activationReadiness: "accepted-test-submission" as const,
      drain,
    };
    await expect(
      submitFiscalReadiness({
        stateDir,
        modules,
        venue,
        contribution,
        secret: undefined,
        ring: {} as never,
        readinessInput: {
          requirement: "accepted-test-submission",
          fiscalModule: contribution.id,
          country: venue.country,
          taxId: venue.taxId,
          legalName: venue.legalName,
          fiscalTerritory: venue.location.fiscalTerritory,
          submissionTarget: contribution.activationReadinessTarget?.(undefined) ?? null,
          certificateFingerprint: null,
          certificateKind: null,
          moduleVersions: { core: 1 },
          applicationVersion: "0.0.0",
        },
        now: () => new Date("2026-09-09T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(drain).toHaveBeenCalledOnce();
    expect(drain.mock.calls[0]![0]).toMatchObject({
      environment: "preproduction",
      skipRetryMs: 0,
    });
  });

  it("surfaces a local setup failure instead of reporting an uncertain authority response", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-local-error-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const contribution = {
      ...selected.contribution!,
      activationReadiness: "accepted-test-submission" as const,
      makeBackend: () => {
        throw new Error("local backend misconfigured");
      },
    };

    await expect(
      submitFiscalReadiness({
        stateDir,
        modules,
        venue,
        contribution,
        secret: undefined,
        ring: {} as never,
        readinessInput: {
          requirement: "accepted-test-submission",
          fiscalModule: contribution.id,
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
      }),
    ).rejects.toThrow("local backend misconfigured");
  });
  /**
   * The retained sample database holds a REAL preproduction sale on a REAL chain, so the tables the
   * modules declare append-only have to refuse a rewrite here exactly as they do on the box.
   *
   * Read through a raw `node:sqlite` connection rather than the runner's own handle, which it
   * closes: reopening the FILE shows the triggers were persisted, not merely installed on a session.
   */
  it("records the sample sale as the readiness test's, with no device", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-origin-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const contribution = {
      ...selected.contribution!,
      activationReadiness: "accepted-test-submission" as const,
      drain: vi.fn().mockResolvedValue({ ...emptyDrainResult(), recordsAccepted: 1 }),
    };
    const readinessInput: FiscalReadinessInput = {
      requirement: "accepted-test-submission",
      fiscalModule: contribution.id,
      country: venue.country,
      taxId: venue.taxId,
      legalName: venue.legalName,
      fiscalTerritory: venue.location.fiscalTerritory,
      submissionTarget: null,
      certificateFingerprint: null,
      certificateKind: null,
      moduleVersions: { core: 1 },
      applicationVersion: "0.0.0",
    };

    await submitFiscalReadiness({
      stateDir,
      modules,
      venue,
      contribution,
      secret: undefined,
      ring: {} as never,
      readinessInput,
      now: () => new Date("2026-09-09T12:00:00.000Z"),
    });

    const connection = new DatabaseSync(
      join(
        stateDir,
        `fiscal-readiness-db-${fiscalReadinessDatabaseKey(readinessInput)}`,
        "venue.db",
      ),
    );
    try {
      expect(connection.prepare("select source, device_id from sales").all()).toEqual([
        { source: "readiness_test", device_id: null },
      ]);
    } finally {
      connection.close();
    }
  });

  it("leaves the retained sample database refusing to rewrite the sale it recorded", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-append-only-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const contribution = {
      ...selected.contribution!,
      activationReadiness: "accepted-test-submission" as const,
      drain: vi.fn().mockResolvedValue({ ...emptyDrainResult(), recordsAccepted: 1 }),
    };
    const readinessInput: FiscalReadinessInput = {
      requirement: "accepted-test-submission",
      fiscalModule: contribution.id,
      country: venue.country,
      taxId: venue.taxId,
      legalName: venue.legalName,
      fiscalTerritory: venue.location.fiscalTerritory,
      submissionTarget: null,
      certificateFingerprint: null,
      certificateKind: null,
      moduleVersions: { core: 1 },
      applicationVersion: "0.0.0",
    };

    await submitFiscalReadiness({
      stateDir,
      modules,
      venue,
      contribution,
      secret: undefined,
      ring: {} as never,
      readinessInput,
      now: () => new Date("2026-09-09T12:00:00.000Z"),
    });

    const connection = new DatabaseSync(
      join(
        stateDir,
        `fiscal-readiness-db-${fiscalReadinessDatabaseKey(readinessInput)}`,
        "venue.db",
      ),
    );
    try {
      // The row first: a `FOR EACH ROW` trigger on an EMPTY table refuses nothing, so without this
      // the case would pass with no trigger installed at all.
      expect(connection.prepare("select count(*) as n from sales").get()?.n).toBe(1);
      expect(() => connection.exec("update sales set locale = 'en-GB'")).toThrow(
        /sales is append-only/,
      );
    } finally {
      connection.close();
    }
  });

  describe("with a stubbed drain", () => {
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const readinessInput: FiscalReadinessInput = {
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
    };
    async function submitWith(
      drain: () => Promise<unknown>,
      stateDir?: string,
      readinessRejections?: () => Promise<{ code: string | null; message: string | null }[]>,
    ) {
      const dir = stateDir ?? (await mkdtemp(join(tmpdir(), "waitron-readiness-runner-drain-")));
      if (stateDir === undefined) dirs.push(dir);
      return submitFiscalReadiness({
        stateDir: dir,
        modules,
        venue,
        contribution: {
          ...selected.contribution!,
          activationReadiness: "accepted-test-submission" as const,
          drain: drain as never,
          readinessRejections,
        },
        secret: undefined,
        ring: {} as never,
        readinessInput,
        now: () => new Date("2026-09-09T12:00:00.000Z"),
      });
    }

    it("includes the saved authority refusal when the sample is rejected", async () => {
      await expect(
        submitWith(
          () => Promise.resolve({ ...emptyDrainResult(), recordsHalted: 1 }),
          undefined,
          async () => [{ code: "1161", message: "Importe total incorrecto" }],
        ),
      ).resolves.toEqual({
        status: "rejected",
        rejections: [{ code: "1161", message: "Importe total incorrecto" }],
      });
    });

    it("keeps a saved refusal visible when a retry finds no due submission", async () => {
      await expect(
        submitWith(
          () => Promise.resolve(emptyDrainResult()),
          undefined,
          async () => [{ code: "1161", message: "Importe total incorrecto" }],
        ),
      ).resolves.toEqual({
        status: "rejected",
        rejections: [{ code: "1161", message: "Importe total incorrecto" }],
      });
    });

    it("reports a halted sample as rejected", async () => {
      await expect(
        submitWith(() => Promise.resolve({ ...emptyDrainResult(), recordsHalted: 1 })),
      ).resolves.toEqual({ status: "rejected" });
    });

    it("reports a drain that neither accepted nor halted anything as uncertain", async () => {
      await expect(submitWith(() => Promise.resolve(emptyDrainResult()))).resolves.toEqual({
        status: "uncertain",
      });
    });

    it("reports a drain that throws as uncertain", async () => {
      await expect(
        submitWith(() => Promise.reject(new Error("authority unreachable"))),
      ).resolves.toEqual({ status: "uncertain" });
    });

    it("reuses the retained venue and its one sample when the same inputs run again", async () => {
      const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-rerun-"));
      dirs.push(stateDir);
      await expect(
        submitWith(() => Promise.resolve(emptyDrainResult()), stateDir),
      ).resolves.toEqual({ status: "uncertain" });
      await expect(
        submitWith(() => Promise.resolve({ ...emptyDrainResult(), recordsAccepted: 1 }), stateDir),
      ).resolves.toEqual({ status: "accepted" });

      const connection = new DatabaseSync(
        join(
          stateDir,
          `fiscal-readiness-db-${fiscalReadinessDatabaseKey(readinessInput)}`,
          "venue.db",
        ),
      );
      try {
        expect(connection.prepare("select count(*) as n from sales").get()?.n).toBe(1);
        expect(connection.prepare("select count(*) as n from tenants").get()?.n).toBe(1);
      } finally {
        connection.close();
      }
    });
  });

  it("seals the regime's secret into the sample database and drains at the current time by default", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-secret-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const seal = vi.fn().mockResolvedValue(undefined);
    const drain = vi.fn().mockResolvedValue({ ...emptyDrainResult(), recordsAccepted: 1 });
    const ring = { current: { version: 1, key: Buffer.alloc(32) } };
    const secret = { pfxBase64: "c2VjcmV0" };
    const before = Date.now();
    await expect(
      submitFiscalReadiness({
        stateDir,
        modules,
        venue,
        contribution: {
          ...selected.contribution!,
          activationReadiness: "accepted-test-submission" as const,
          provisioningSecret: { required: () => false, validate: () => {}, seal },
          drain,
        },
        secret,
        ring,
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
      }),
    ).resolves.toEqual({ status: "accepted" });
    const after = Date.now();
    expect(seal).toHaveBeenCalledOnce();
    expect(seal.mock.calls[0]![0]).toMatchObject({ ring });
    expect(seal.mock.calls[0]![1]).toBe(secret);
    const drainedAt = (drain.mock.calls[0]![1] as Date).getTime();
    expect(drainedAt).toBeGreaterThanOrEqual(before);
    expect(drainedAt).toBeLessThanOrEqual(after);
  });

  it("accepts a regime that files nothing without creating a sample database", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-none-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const drain = vi.fn();
    await expect(
      submitFiscalReadiness({
        stateDir,
        modules: ALL_MODULES,
        venue,
        contribution: {
          ...selected.contribution!,
          activationReadiness: "not-applicable" as const,
          drain,
        },
        secret: undefined,
        ring: {} as never,
        readinessInput: {} as never,
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(drain).not.toHaveBeenCalled();
    await expect(readdir(stateDir)).resolves.toEqual([]);
  });

  describe("fiscalReadinessInput", () => {
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const base = {
      venue,
      moduleVersions: { core: 1 },
      applicationVersion: "1.2.3",
    };

    it("binds no certificate and no submission target when the regime supplies neither", () => {
      const contribution = { ...selected.contribution!, activationReadinessTarget: undefined };
      expect(fiscalReadinessInput({ ...base, contribution, secret: undefined })).toEqual({
        requirement: contribution.activationReadiness,
        fiscalModule: contribution.id,
        country: "GB",
        taxId: "123456789",
        legalName: "Readiness Ltd",
        fiscalTerritory: "GB-vat",
        submissionTarget: null,
        certificateFingerprint: null,
        certificateKind: null,
        moduleVersions: { core: 1 },
        applicationVersion: "1.2.3",
      });
    });

    it("fingerprints the certificate bytes and records its kind and the regime's target", () => {
      const pfx = Buffer.from("certificate bytes");
      const input = fiscalReadinessInput({
        ...base,
        contribution: {
          ...selected.contribution!,
          activationReadinessTarget: () => "https://target.example.test",
        },
        secret: { pfxBase64: pfx.toString("base64"), certKind: "sello" },
      });
      expect(input).toMatchObject({
        submissionTarget: "https://target.example.test",
        certificateFingerprint: createHash("sha256").update(pfx).digest("hex"),
        certificateKind: "sello",
      });
    });

    it("ignores certificate fields that are not strings", () => {
      const input = fiscalReadinessInput({
        ...base,
        contribution: { ...selected.contribution!, activationReadinessTarget: () => null },
        secret: { pfxBase64: 42, certKind: { kind: "sello" } },
      });
      expect(input).toMatchObject({
        submissionTarget: null,
        certificateFingerprint: null,
        certificateKind: null,
      });
    });
  });
});

it.each(["malformed", "unknown-module", "no-operations", "no-seed"] as const)(
  "refuses %s sample inputs before creating a readiness database",
  async (kind) => {
    const stateDir = await mkdtemp(join(tmpdir(), "readiness-input-refusal-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, "ES-common");
    const modules = enabledModules(ALL_MODULES, selected.config).map((module) =>
      module.name !== "fiscal-verifactu"
        ? module
        : {
            ...module,
            ...(kind === "no-operations" ? { operations: undefined } : {}),
            ...(kind === "no-seed" ? { provisioning: undefined } : {}),
          },
    );
    const initialOperations =
      kind === "malformed"
        ? null
        : {
            nodeId: "c0000000-0000-4000-8000-000000000001",
            administratorId: "c0000000-0000-4000-8000-000000000002",
            inputs: [
              {
                module: kind === "unknown-module" ? "missing-module" : "fiscal-verifactu",
                eventId: "sample-event",
                sourceId: "sample-source",
                input: {},
              },
            ],
          };
    await expect(
      submitFiscalReadiness({
        stateDir,
        modules,
        venue,
        contribution: selected.contribution!,
        secret: undefined,
        ring: {} as never,
        readinessInput: {} as never,
        initialOperations: initialOperations as never,
      }),
    ).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "initialOperations" },
    });
    expect(await readdir(stateDir)).toEqual([]);
  },
);

it.each([false, true])(
  "the shared runner's disposable hour sample reaches the real fiscal drain (rejected=%s)",
  async (rejected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const sampleAt = new Date("2026-10-31T12:00:00Z");
    vi.setSystemTime(sampleAt);
    vi.stubEnv("TZ", "Europe/Madrid");
    const stateDir = await mkdtemp(join(tmpdir(), "readiness-real-drain-"));
    dirs.push(stateDir);
    const { request } = await import("../test/first-setup-request.js");
    const requestVenue = {
      ...request,
      admin: {
        displayName: "Elena",
        email: "elena@example.test",
        pinHash: "synthetic",
        passwordHash: "synthetic",
      },
    };
    const selected = venueFiscalSelection(ALL_MODULES, "ES-common");
    const modules = enabledModules(ALL_MODULES, selected.config);
    const { createFakeAeat, keyOf } = await import("@waitron/verifactu/testing");
    const { drain } = await import("@waitron/fiscal-verifactu");
    const now = new Date(sampleAt.getTime() + 60_000);
    const aeat = createFakeAeat({ serverNow: now });
    const client = aeat.client();
    let sent = 0;
    const submissions: unknown[] = [];
    const result = await submit({
      stateDir,
      modules,
      venue: requestVenue,
      contribution: {
        ...selected.contribution!,
        drain: ({ db, environment, skipRetryMs }, at) =>
          drain(
            {
              db,
              environment,
              skipRetryMs,
              resolveClient: async () => ({
                submit: (header, records) => {
                  sent += records.length;
                  submissions.push(...records);
                  if (rejected)
                    for (const record of records)
                      aeat.reject(
                        keyOf(
                          "RegistroAlta" in record ? record.RegistroAlta : record.RegistroAnulacion,
                        ),
                        1161,
                        "Valor incorrecto",
                      );
                  return client.submit(header, records);
                },
                consultar: (...args) => client.consultar(...args),
              }),
            },
            at,
          ),
      },
      secret: undefined,
      ring: {} as never,
      readinessInput: fiscalReadinessInput({
        venue: requestVenue,
        contribution: selected.contribution!,
        secret: undefined,
        moduleVersions: { core: 1 },
        applicationVersion: "sample-test",
      }),
      now: () => now,
      clock: () => ({
        now: () => ({
          instant: sampleAt,
          offsetMinutes: 0,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
        anchor: () => {
          throw new Error("unused in sample test");
        },
        currentAnchor: () => null,
      }),
    });
    expect(sent).toBe(1);
    expect(submissions).toMatchObject([
      {
        RegistroAlta: {
          IDFactura: { FechaExpedicionFactura: "31-10-2026" },
          FechaHoraHusoGenRegistro: "2026-10-31T12:00:00+00:00",
        },
      },
    ]);
    expect(result).toEqual(
      rejected
        ? { status: "rejected", rejections: [{ code: "1161", message: "Valor incorrecto" }] }
        : { status: "accepted" },
    );
  },
);

it("a supplied disposable hour keeps its node and one sample across a readiness retry", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "readiness-supplied-hour-"));
  dirs.push(stateDir);
  const { request } = await import("../test/first-setup-request.js");
  const requestVenue = {
    ...request,
    admin: {
      displayName: "Elena",
      email: "elena@example.test",
      pinHash: "synthetic",
      passwordHash: "synthetic",
    },
  };
  const selected = venueFiscalSelection(ALL_MODULES, "ES-common");
  const modules = enabledModules(ALL_MODULES, selected.config);
  const { throwawayApplyInput } = await import("./throwaway-allocation.js");
  const { planVenue } = await import("./venue-plan.js");
  const prepared = throwawayApplyInput(planVenue(requestVenue, modules), modules, [
    "preproduction",
  ])!;
  const input = fiscalReadinessInput({
    venue: requestVenue,
    contribution: selected.contribution!,
    secret: undefined,
    moduleVersions: { core: 1 },
    applicationVersion: "supplied-hour-test",
  });
  const args = {
    stateDir,
    modules: prepared.modules,
    venue: requestVenue,
    contribution: {
      ...selected.contribution!,
      drain: async () => ({ ...emptyDrainResult(), recordsAccepted: 1 }),
    },
    secret: undefined,
    ring: {} as never,
    readinessInput: input,
    initialOperations: {
      nodeId: prepared.initialNodeId,
      administratorId: prepared.initialAdministratorId,
      inputs: [...prepared.moduleInputs].map(([module, entry]) => ({ module, ...entry })),
    },
  };
  await expect(submitFiscalReadiness(args)).resolves.toEqual({ status: "accepted" });
  await expect(submitFiscalReadiness(args)).resolves.toEqual({ status: "accepted" });
  const sample = new DatabaseSync(
    join(stateDir, `fiscal-readiness-db-${fiscalReadinessDatabaseKey(input)}`, "venue.db"),
    { readOnly: true },
  );
  try {
    expect(sample.prepare("select id from nodes").all()).toEqual([{ id: prepared.initialNodeId }]);
    expect(sample.prepare("select count(*) as n from sales").get()).toEqual({ n: 1 });
    expect(
      sample.prepare("select purpose, next_number from invoice_series order by purpose").all(),
    ).toEqual([
      { purpose: "full", next_number: 1 },
      { purpose: "rectificative", next_number: 1 },
      { purpose: "standard", next_number: 2 },
    ]);
  } finally {
    sample.close();
  }
});

describe("saved-zone readiness clocks", () => {
  function argsFor(stateDir: string) {
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const contribution = {
      ...selected.contribution!,
      activationReadiness: "accepted-test-submission" as const,
      drain: vi.fn(async () => ({ ...emptyDrainResult(), recordsAccepted: 1 })),
    };
    const clock = vi.fn(() => ({
      now: () => ({
        instant: new Date("2026-07-14T23:30:00Z"),
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
    return {
      stateDir,
      venue,
      modules,
      contribution,
      clock,
      secret: undefined,
      ring: {} as never,
      readinessInput: fiscalReadinessInput({
        venue,
        contribution,
        secret: undefined,
        moduleVersions: { core: 1 },
        applicationVersion: "zone-clock-test",
      }),
      now: () => new Date("2026-08-20T12:00:00Z"),
    };
  }
  function samplePath(args: ReturnType<typeof argsFor>) {
    return join(
      args.stateDir,
      `fiscal-readiness-db-${fiscalReadinessDatabaseKey(args.readinessInput)}`,
      "venue.db",
    );
  }
  it("acquires one issue clock and dates the sample from its own London zone, independent of tender time", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "readiness-saved-clock-"));
    dirs.push(stateDir);
    const args = argsFor(stateDir);
    await expect(submit(args)).resolves.toEqual({ status: "accepted" });
    expect(args.clock).toHaveBeenCalledTimes(1);
    const db = new DatabaseSync(samplePath(args));
    try {
      expect(db.prepare("select issued_at, issued_offset_minutes from sales").all()).toEqual([
        { issued_at: "2026-07-14T23:30:00.000Z", issued_offset_minutes: 60 },
      ]);
    } finally {
      db.close();
    }
    args.clock.mockClear();
    await expect(submit(args)).resolves.toEqual({ status: "accepted" });
    expect(args.clock).not.toHaveBeenCalled();
  });
  it.each(["Invalid/Zone", ""])(
    "refuses a reused sample's saved %j zone before drain",
    async (zone) => {
      const stateDir = await mkdtemp(join(tmpdir(), "readiness-reused-zone-"));
      dirs.push(stateDir);
      const args = argsFor(stateDir);
      await submit(args);
      const db = new DatabaseSync(samplePath(args));
      let before: unknown[];
      try {
        before = db.prepare("select * from sales").all();
        db.prepare("update locations set time_zone = ?").run(zone);
      } finally {
        db.close();
      }
      args.contribution.drain.mockClear();
      args.clock.mockClear();
      await expect(submit(args)).rejects.toMatchObject({
        code: "venue.time_zone_invalid",
        params: { reason: zone === "" ? "missing" : "invalid" },
      });
      expect(args.contribution.drain).not.toHaveBeenCalled();
      expect(args.clock).not.toHaveBeenCalled();
      const after = new DatabaseSync(samplePath(args));
      try {
        expect(after.prepare("select * from sales").all()).toEqual(before!);
      } finally {
        after.close();
      }
    },
  );
  it("refuses a fresh bad zone without issuing a sample", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "readiness-fresh-zone-"));
    dirs.push(stateDir);
    const args = argsFor(stateDir);
    await expect(
      submit({
        ...args,
        venue: { ...venue, location: { ...venue.location, timeZone: "Invalid/Zone" } },
      }),
    ).rejects.toMatchObject({ code: "venue.time_zone_invalid" });
    expect(args.clock).not.toHaveBeenCalled();
    expect(args.contribution.drain).not.toHaveBeenCalled();
  });
});

it("refuses the saved bad zone of a reused readiness venue that has no sample yet", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "readiness-empty-reused-zone-"));
  dirs.push(stateDir);
  const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
  const modules = enabledModules(ALL_MODULES, selected.config);
  const contribution = {
    ...selected.contribution!,
    activationReadiness: "accepted-test-submission" as const,
    drain: vi.fn(async () => emptyDrainResult()),
  };
  const input = fiscalReadinessInput({
    venue,
    contribution,
    secret: undefined,
    moduleVersions: { core: 1 },
    applicationVersion: "empty-reuse",
  });
  const directory = join(stateDir, `fiscal-readiness-db-${fiscalReadinessDatabaseKey(input)}`);
  const { applyMigrations, manifestSets, migrationOptionsFor } =
    await import("@waitron/migrations");
  const { openVenueDatabase } = await import("@waitron/db");
  const { applyVenue, planVenue } = await import("@waitron/provisioning");
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  try {
    await applyVenue(planVenue(venue, modules), { db: store.venue, modules });
    const { sql } = await import("drizzle-orm");
    await store.venue.execute(sql`update locations set time_zone = 'Invalid/Zone'`);
  } finally {
    await store.close();
  }
  const clock = vi.fn(() => {
    throw new Error("must not acquire issue clock");
  });
  await expect(
    submit({
      stateDir,
      venue,
      modules,
      contribution,
      readinessInput: input,
      secret: undefined,
      ring: {} as never,
      clock,
    }),
  ).rejects.toMatchObject({ code: "venue.time_zone_invalid" });
  expect(clock).not.toHaveBeenCalled();
  expect(contribution.drain).not.toHaveBeenCalled();
  const rows = new DatabaseSync(join(directory, "venue.db"));
  try {
    expect(rows.prepare("select * from sales").all()).toEqual([]);
  } finally {
    rows.close();
  }
});
