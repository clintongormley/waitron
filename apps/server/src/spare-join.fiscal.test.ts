import { seriesWithNextNumber } from "@waitron/db/testing/seed.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import { invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALLOCATED_FISCAL_STANDBY } from "@waitron/fiscal-verifactu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withPreparedModuleOperations } from "@waitron/module";
import { readNodeMode } from "@waitron/node-db";
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
import { createDeploymentHolders } from "./deployment-holders.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { promoteMirrorToPrimary, type PromotionOperationRunner } from "./promote.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { fiscalRows, preparationIn } from "./testing/fiscal-rows.js";
import {
  ADMIN,
  MODULE,
  PASSWORD as SPARE_PASSWORD,
  bases,
  binding,
  fiscalModules,
  placedSpareFixture,
  primary,
  ring as SPARE_RING,
  standby,
  type PlacedSpare,
} from "./testing/handover-placed-copy.js";
import { joinSpare, veriFactuMainBox } from "./testing/veri-factu-join.js";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-time-service.js", () => ({
  observeTimeServiceHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations, timeoutMs: 60_000 });
const spareBox = useVenueDb({ migrations, timeoutMs: 60_000 });

describe("a Veri*Factu venue's spare joins", () => {
  let mainState: string;
  let spareState: string;
  beforeEach(async () => {
    mainState = await mkdtemp(join(tmpdir(), "spare-join-fiscal-main-"));
    spareState = await mkdtemp(join(tmpdir(), "spare-join-fiscal-spare-"));
  });
  afterEach(async () => {
    await rm(mainState, { recursive: true, force: true });
    await rm(spareState, { recursive: true, force: true });
  });

  it("a Veri*Factu venue's join writes no fiscal row and no dormant setup", async () => {
    const boxes = { mainBox, spareBox, mainState, spareState, ring: RING };
    const main = await veriFactuMainBox(boxes);
    expect(main.modules.map((module) => module.name)).toContain("fiscal-verifactu");
    const before = {
      main: await fiscalRows(mainBox.db),
      spare: await fiscalRows(spareBox.db),
      mainFile: await preparationIn(mainState),
      spareFile: await preparationIn(spareState),
    };
    expect(before.main.invoice_series).not.toEqual([]);

    const { bundle, spareId } = await joinSpare(boxes, main);

    expect((await readNodeMode(spareBox.node, spareId)).mode).toBe("mirror");
    expect(bundle.reservedIdentity.series).toEqual([]);
    expect(await fiscalRows(mainBox.db)).toEqual(before.main);
    expect(await fiscalRows(spareBox.db)).toEqual(before.spare);
    expect(await preparationIn(mainState)).toBe(before.mainFile);
    expect(await preparationIn(spareState)).toBe(before.spareFile);
  }, 60_000);
});

describe("a spare holding a copy of a Veri*Factu venue", () => {
  let root: string;
  let placed: PlacedSpare | undefined;
  const dirs = () => ({
    mainState: join(root, "main-state"),
    spareState: join(root, "spare-state"),
    spareVenue: join(root, "spare-venue"),
  });
  const fixture = placedSpareFixture({ mainBox, spareBefore: spareBox, dirs });
  const credentials = { personId: ADMIN, password: SPARE_PASSWORD };
  const context = { oldNodeNeutralised: true, noParallelRecovery: true };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "spare-join-fiscal-copy-"));
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }));
  });
  afterEach(async () => {
    vi.useRealTimers();
    external.internet.mockReset();
    await placed?.close();
    placed = undefined;
    await rm(root, { recursive: true, force: true });
  });

  /** The spare's own preparation service on the copy it holds. */
  function spareSide(store: PlacedSpare) {
    const service = createNodeOperationPreparation({
      stateDir: dirs().spareState,
      venueDir: dirs().spareVenue,
      db: store.venue,
      nodeDb: store.node,
      node: standby,
      modules: fiscalModules,
      credentialKeyRing: TOTP_KEY_RING,
      coordinator: createFirstSetupCoordinator(),
      environment: {},
    });
    const promote = (runner: PromotionOperationRunner) =>
      promoteMirrorToPrimary(
        {
          db: store.venue,
          node: store.node,
          nodeId: standby.nodeId,
          ring: SPARE_RING,
          modules: fiscalModules,
          holders: createDeploymentHolders("mirror", "secondary"),
          log: () => {},
          withModuleOperations: runner,
        },
        { oldNodeNeutralised: true },
      );
    return { service, promote };
  }

  const preparationHistory = () =>
    readModulePreparationHistory({ stateDir: dirs().spareState, venueDir: "" }, MODULE);

  /** Reserve then establish, on the spare, under the administrator's sign-in. */
  async function admit(store: PlacedSpare, service: ReturnType<typeof spareSide>["service"]) {
    const admission = { ...binding, action: "reserve", eventId: "admission" };
    let state: unknown;
    await service.withOperation(
      { binding: admission, input: { kind: "hour-dormant", version: 1 } },
      credentials,
      {},
      (modules, operations) =>
        withPreparedModuleOperations(modules, operations, standby.nodeId, "reserve", (ready) =>
          withTransaction(store.venue, async (tx) => {
            state = (
              await ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, standby, ready.get(MODULE))
            ).state;
          }),
        ),
    );
    await service.withOperation(
      { binding: { ...admission, action: "establish" }, input: state },
      credentials,
      {},
      (modules, operations) =>
        withPreparedModuleOperations(modules, operations, standby.nodeId, "establish", (ready) =>
          withTransaction(store.venue, (tx) =>
            ALLOCATED_FISCAL_STANDBY.establish(tx, standby, state, ready.get(MODULE)),
          ),
        ),
    );
    return admission;
  }

  it("on the spare, under a person's sign-in, reserve then establish writes a dormant setup that a promotion then reads", async () => {
    const store = (placed = await fixture.placeSpareEmergencyCopy());
    vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
    const spare = spareSide(store);
    const admission = await admit(store, spare.service);
    expect(await preparationHistory()).toEqual([
      expect.objectContaining({
        dormant: [
          expect.objectContaining({
            kind: "hour-dormant",
            binding: admission,
            scope: { taxpayerNif: "89890001K", environment: "preproduction" },
            bases,
          }),
        ],
      }),
    ]);

    const prepare = (proposal: unknown) =>
      spare.service.prepareWithDormantSetup(binding, credentials, context, proposal, {
        onBox: true,
      });
    const challenge = (await prepare({ action: "clock-challenge" })) as { id: string };
    const compared = (await prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    })) as { id: string };
    expect((await preparationHistory())[0]).toMatchObject({ dormant: [{ binding: admission }] });
    const selected = (await prepare({ action: "select", comparisonId: compared.id })) as {
      identity: string;
      input: unknown;
    };
    expect(selected).toMatchObject({ status: "selected", bases });
    expect(
      await spare.service.withPromotion(
        { binding, input: selected.input },
        credentials,
        context,
        (_modules, runner) => spare.promote(runner),
      ),
    ).toMatchObject({ alreadyPrimary: false });
    const opened = await store.venue
      .select(seriesWithNextNumber)
      .from(invoiceSeries)
      .where(eq(invoiceSeries.nodeId, standby.nodeId));
    expect(opened.map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber }))).toEqual(
      bases.map((base) => ({
        ...base,
        code: `${base.code}-${selected.identity}`,
        nextNumber: 1,
      })),
    );
  }, 60_000);
});
