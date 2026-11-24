import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { SistemaInformatico } from "@waitron/verifactu";
import { recordSale } from "@waitron/core";
import {
  captureError,
  invoiceSeries,
  stampDeployment,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import type { SecondClock } from "@waitron/fiscal";
import type { SeriesId } from "@waitron/shared";
import { openBackupQuery } from "@waitron/store";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTaxpayers, TAXPAYER_A } from "../test/fixtures.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { verifyBackupFiscalHistory } from "./backup-verification-history.js";
import { appendToChain } from "./chain.js";
import { encodeMinuteIdentity } from "./hour-identity.js";
import * as release from "./hour-release.js";
import { openIdentityChange, planIdentityChange } from "./identity-change.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { runningIdentity, softwareVersion } from "./software-identity.js";
import { altaFor, seedSale } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const NOW = Date.parse("2026-11-24T10:30:20.000Z");
const NOW_MINUTE = Date.parse("2026-11-24T10:30:00.000Z");
const INSTALLATION = "0CNN8";
const PRODUCER_A = "00000000T";
const PRODUCER_B = "11111111H";
const PRODUCER_C = "22222222J";

const note = (overrides: Record<string, string> = {}) => ({
  release: softwareVersion(),
  producerTaxId: PRODUCER_B,
  fromProducerTaxId: PRODUCER_A,
  ...overrides,
});
const timeService = (synchronised: boolean) => {
  const read = vi.fn(async () => synchronised);
  return { read, clock: { kind: "time-service", read } satisfies SecondClock };
};
const confirmedStart = (standing: boolean): SecondClock => ({
  kind: "confirmed-start",
  standing: () => standing,
});
const waiting = (reason: string) => ({
  code: "sif.identity_change_waiting",
  params: { reason },
});

function setRelease(instantMs: number) {
  vi.spyOn(release, "readHourRelease").mockReturnValue({
    sourceCommit: "a".repeat(40),
    instantMs,
    committedAt: new Date(instantMs).toISOString(),
    generator: "scripts/generate-hour-release.mjs:v1",
    generatorSha256: "b".repeat(64),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setRelease(Date.parse("2026-10-15T00:00:00.000Z"));
  vi.stubEnv("WAITRON_PRODUCER_NAME", "PRODUCER PERSON");
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", PRODUCER_B);
  vi.stubEnv("WAITRON_PRODUCER_ADDRESS", "Calle Mayor 1, Madrid");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A production box whose open chain's one record was filed under `producer`. */
async function seedChain(options: { producer?: string | null; environment?: string } = {}) {
  await seedTaxpayers(suite.db);
  await stampDeployment(
    suite.db,
    (options.environment ?? "production") as "production" | "preproduction",
  );
  const [sif] = await suite.db
    .insert(verifactuIdentities)
    .values({
      nodeId: TAXPAYER_A.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "W1",
      numeroInstalacion: INSTALLATION,
      registradoEn: new Date("2026-10-16T11:20:00Z"),
    })
    .returning({ id: verifactuIdentities.id });
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: TAXPAYER_A.nodeId, code: `F-${INSTALLATION}`, purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  const producer = options.producer === undefined ? PRODUCER_A : options.producer;
  if (producer !== null) {
    const { deviceId } = await seedDevice(suite.db, {});
    const node = { nodeId: TAXPAYER_A.nodeId, seriesId: series!.id, sifId: sif!.id, deviceId };
    const sale = await seedSale(suite.db, node as Parameters<typeof seedSale>[1], 1);
    const pending = altaFor(node, sale, 1, 1);
    pending.input.SistemaInformatico = {
      ...pending.input.SistemaInformatico,
      IDOtro: undefined,
      NombreRazon: "PRODUCER PERSON",
      NIF: producer,
      NumeroInstalacion: INSTALLATION,
    } as SistemaInformatico;
    pending.input.IDEmisorFactura = "89890001K";
    pending.input.NumSerieFactura = `F-${INSTALLATION}/1`;
    await suite.db.transaction((tx) => appendToChain(tx, TAXPAYER_A.nodeId, pending));
  }
  return { sifId: sif!.id };
}

/** Another node's retired installation, named for the minute at `instantMs`. */
async function useMinute(instantMs: number) {
  await suite.db.insert(verifactuIdentities).values({
    nodeId: TAXPAYER_A.nodeId2,
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: encodeMinuteIdentity(instantMs),
    registradoEn: new Date("2026-10-16T11:20:00Z"),
    revocadoEn: new Date("2026-10-16T11:30:00Z"),
  });
}

const plan = (clock: SecondClock, named = note()) =>
  planIdentityChange(suite.db, TAXPAYER_A.nodeId, named, clock);

describe("planIdentityChange", () => {
  it("opens on the box's current minute when the time service is synchronised", async () => {
    const { sifId } = await seedChain();

    await expect(plan(timeService(true).clock)).resolves.toEqual({
      kind: "open",
      minuteMs: NOW_MINUTE,
      sourceSifId: sifId,
    });
  });

  it.each([
    ["another release", { release: "9.9.9" }],
    ["another producer", { producerTaxId: PRODUCER_C }],
    ["another producer the head moves from", { fromProducerTaxId: PRODUCER_C }],
  ])("is not named by a note naming %s", async (_label, overrides) => {
    await seedChain();

    await expect(plan(timeService(true).clock, note(overrides))).resolves.toEqual({
      kind: "not-named",
    });
  });

  it("is not named while no producer is set", async () => {
    await seedChain();
    vi.stubEnv("WAITRON_PRODUCER_NAME", "");
    vi.stubEnv("WAITRON_PRODUCER_TAX_ID", "");
    vi.stubEnv("WAITRON_PRODUCER_ADDRESS", "");

    await expect(plan(timeService(true).clock)).resolves.toEqual({ kind: "not-named" });
  });

  it("has nothing to open when the head already names the running producer, reading no clock", async () => {
    await seedChain({ producer: PRODUCER_B });
    const { read, clock } = timeService(false);

    await expect(plan(clock)).resolves.toEqual({ kind: "nothing-to-open" });
    expect(read).toHaveBeenCalledTimes(0);
  });

  it("has nothing to open on a chain with no records", async () => {
    await seedChain({ producer: null });
    const { read, clock } = timeService(false);

    await expect(plan(clock)).resolves.toEqual({ kind: "nothing-to-open" });
    expect(read).toHaveBeenCalledTimes(0);
  });

  it("waits for a second clock while the time service is not synchronised", async () => {
    await seedChain();

    expect(await captureError(() => plan(timeService(false).clock))).toMatchObject(
      waiting("second_clock_missing"),
    );
  });

  it("opens on a confirmed start's standing time", async () => {
    const { sifId } = await seedChain();

    await expect(plan(confirmedStart(true))).resolves.toEqual({
      kind: "open",
      minuteMs: NOW_MINUTE,
      sourceSifId: sifId,
    });
  });

  it("waits when a confirmed start's time no longer stands", async () => {
    await seedChain();

    expect(await captureError(() => plan(confirmedStart(false)))).toMatchObject(
      waiting("confirmation_stale"),
    );
  });

  it("refuses a box clock earlier than the release", async () => {
    await seedChain();
    setRelease(NOW + 3_600_000);

    expect(await captureError(() => plan(confirmedStart(true)))).toMatchObject(
      waiting("clock_unconfirmed"),
    );
  });

  it("refuses a build with no release stamp", async () => {
    await seedChain();
    vi.spyOn(release, "readHourRelease").mockReturnValue(null);

    expect(await captureError(() => plan(timeService(true).clock))).toMatchObject(
      waiting("clock_unconfirmed"),
    );
  });

  it("has nothing to open outside production", async () => {
    await seedChain({ environment: "preproduction" });

    await expect(plan(timeService(true).clock)).resolves.toEqual({ kind: "nothing-to-open" });
  });

  it("waits while the box's current minute is already in the history", async () => {
    await seedChain();
    await useMinute(NOW);

    expect(await captureError(() => plan(timeService(true).clock))).toMatchObject(
      waiting("minute_in_use"),
    );
  });

  it("opens on the current minute when only a later minute is used", async () => {
    const { sifId } = await seedChain();
    await useMinute(NOW + 86_400_000);

    await expect(plan(timeService(true).clock)).resolves.toEqual({
      kind: "open",
      minuteMs: NOW_MINUTE,
      sourceSifId: sifId,
    });
  });

  it("refuses the history when the taxpayer row is missing", async () => {
    await seedChain();
    await suite.db.execute(sql`delete from taxpayer`);

    expect(await captureError(() => plan(timeService(true).clock))).toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "history_invalid" },
    });
  });

  it("waits while the history contradicts itself", async () => {
    await seedChain();
    await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: TAXPAYER_A.nodeId2, code: "R-0CNPG", purpose: "corrective" });

    expect(await captureError(() => plan(timeService(true).clock))).toMatchObject(
      waiting("history_invalid"),
    );
  });
});

const sole = async () => true;
const open = (mayOpen: (tx: Transaction) => Promise<boolean> = sole, named = note()) =>
  openIdentityChange(suite.db, TAXPAYER_A.nodeId, named, timeService(true).clock, mayOpen);
const NEW_NAME = encodeMinuteIdentity(NOW_MINUTE);

async function fiscalRows() {
  return {
    sifs: await suite.db.select().from(verifactuIdentities).orderBy(verifactuIdentities.id),
    series: await suite.db.select().from(invoiceSeries).orderBy(invoiceSeries.code),
  };
}

describe("openIdentityChange", () => {
  it("opens a new installation, with new series, on the planned minute", async () => {
    const { sifId } = await seedChain();
    const [old] = await suite.db.select().from(verifactuRecords);

    await expect(open()).resolves.toBe("opened");

    const { sifs, series } = await fiscalRows();
    expect(sifs.find((row) => row.id === sifId)!.revocadoEn).not.toBeNull();
    const live = sifs.filter((row) => row.revocadoEn === null);
    expect(live.map((row) => [row.nodeId, row.numeroInstalacion])).toEqual([
      [TAXPAYER_A.nodeId, NEW_NAME],
    ]);
    expect(
      series.map((row) => [row.code, row.purpose, row.retiredAt === null ? "live" : "retired"]),
    ).toEqual([
      [`F-${INSTALLATION}`, "standard", "retired"],
      [`F-${NEW_NAME}`, "standard", "live"],
    ]);

    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.db,
      identity: runningIdentity("production"),
    });
    const seriesId = series.find((row) => row.retiredAt === null)!.id as SeriesId;
    const { saleId } = await withTransaction(suite.db, (tx) =>
      recordSale(tx, backend, saleInput({ nodeId: TAXPAYER_A.nodeId, seriesId })),
    );
    const [sold] = await suite.db
      .select()
      .from(verifactuRecords)
      .where(eq(verifactuRecords.saleId, saleId));
    expect(sold!.sifId).toBe(live[0]!.id);
    expect(sold!.primerRegistro).toBe(true);
    expect(sold!.sistemaInformatico).toMatchObject({
      NIF: PRODUCER_B,
      NumeroInstalacion: NEW_NAME,
    });
    const [kept] = await suite.db
      .select()
      .from(verifactuRecords)
      .where(eq(verifactuRecords.id, old!.id));
    expect(kept!.sistemaInformatico).toEqual(old!.sistemaInformatico);
  });

  it("has nothing to open the second time, through the backend's seat", async () => {
    await seedChain();
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.db,
    });
    const seat = () =>
      backend.openIdentityChange(TAXPAYER_A.nodeId, note(), timeService(true).clock, sole);

    await expect(seat()).resolves.toBe("opened");
    await expect(seat()).resolves.toBe("nothing-to-open");
  });

  it.each([
    ["not named", PRODUCER_A, { release: "9.9.9" }, "not-named"],
    ["nothing to open", PRODUCER_B, {}, "nothing-to-open"],
  ] as const)(
    "opens nothing when the plan finds it %s",
    async (_label, producer, overrides, answer) => {
      await seedChain({ producer });
      const before = await fiscalRows();
      const mayOpen = vi.fn(sole);

      await expect(open(mayOpen, note(overrides))).resolves.toBe(answer);
      expect(mayOpen).toHaveBeenCalledTimes(0);
      expect(await fiscalRows()).toEqual(before);
    },
  );

  it("refuses a name another installation took after the plan", async () => {
    await seedChain();
    const takeTheMinute = async (tx: Transaction) => {
      await tx.insert(verifactuIdentities).values({
        nodeId: TAXPAYER_A.nodeId2,
        nif: "89890001K",
        idSistemaInformatico: "W1",
        numeroInstalacion: NEW_NAME,
        registradoEn: new Date("2026-10-16T11:20:00Z"),
        revocadoEn: new Date("2026-10-16T11:30:00Z"),
      });
      return true;
    };

    expect(await captureError(() => open(takeTheMinute))).toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "installation_used" },
    });
  });

  it("refuses when the chain's head moved after the plan", async () => {
    const { sifId } = await seedChain();
    const replaceTheInstallation = async (tx: Transaction) => {
      await tx
        .update(verifactuIdentities)
        .set({ revocadoEn: new Date(NOW) })
        .where(eq(verifactuIdentities.id, sifId));
      await tx.insert(verifactuIdentities).values({
        nodeId: TAXPAYER_A.nodeId,
        nif: "89890001K",
        idSistemaInformatico: "W1",
        numeroInstalacion: "0CNN9",
      });
      return true;
    };

    expect(await captureError(() => open(replaceTheInstallation))).toMatchObject(
      waiting("head_moved"),
    );
  });

  it("leaves a history the backup check passes", async () => {
    await seedChain();
    await open();
    const directory = await mkdtemp(join(tmpdir(), "waitron-identity-change-"));
    try {
      const [file] = suite.db.all<{ file: string }>(sql`pragma database_list`);
      const live = new DatabaseSync(file!.file, { readOnly: true });
      try {
        await backup(live, join(directory, "copy.db"));
      } finally {
        live.close();
      }
      const copy = await openBackupQuery(join(directory, "copy.db"));
      try {
        await expect(
          verifyBackupFiscalHistory({
            before: copy.query,
            after: copy.query,
            entries: {
              read: async () => {
                throw new Error("unexpected archive read");
              },
            },
            source: {
              nodeId: TAXPAYER_A.nodeId,
              environment: "production",
              createdAt: new Date(NOW).toISOString(),
            },
            sourceSchema: 1,
            targetSchema: 1,
            signal: new AbortController().signal,
          }),
        ).resolves.toEqual({ status: "passed", checks: [{ code: "history", status: "passed" }] });
      } finally {
        await copy.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes nothing unless the box may open, asked inside the opening's transaction", async () => {
    await seedChain();
    const before = await fiscalRows();
    const mayOpen = vi.fn(async (tx: Transaction) => {
      const [live] = await tx
        .select({ id: verifactuIdentities.id })
        .from(verifactuIdentities)
        .where(
          and(
            eq(verifactuIdentities.nodeId, TAXPAYER_A.nodeId),
            isNull(verifactuIdentities.revocadoEn),
          ),
        );
      return live === undefined;
    });

    expect(await captureError(() => open(mayOpen))).toMatchObject(waiting("not_sole_primary"));
    expect(mayOpen).toHaveBeenCalledTimes(1);
    expect(await fiscalRows()).toEqual(before);
  });
});
