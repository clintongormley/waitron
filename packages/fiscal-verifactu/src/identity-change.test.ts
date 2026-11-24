import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { SistemaInformatico } from "@waitron/verifactu";
import { captureError, invoiceSeries, stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import type { SecondClock } from "@waitron/fiscal";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTaxpayers, TAXPAYER_A } from "../test/fixtures.js";
import { appendToChain } from "./chain.js";
import { encodeMinuteIdentity } from "./hour-identity.js";
import * as release from "./hour-release.js";
import { planIdentityChange } from "./identity-change.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";
import { softwareVersion } from "./software-identity.js";
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
