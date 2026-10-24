import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationHost } from "@waitron/module";
import { createHostedHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { MODULE, PASSWORD, request } from "../test/first-fiscal.js";
import {
  createFakeTimersHourClock,
  selectPastWaits,
  type HourTestClock,
} from "./testing/hour-test-clock.js";

const NOW = Date.parse("2026-10-16T11:40:00Z");
const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
const roots: string[] = [];
let clock: HourTestClock;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
  clock = createFakeTimersHourClock();
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: clock.wall(),
    uncertaintyMs: 500,
    wallStartedMs: clock.wall(),
    wallFinishedMs: clock.wall(),
    monotonicStartedMs: clock.monotonic(),
    monotonicFinishedMs: clock.monotonic(),
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(environment: "production" | "preproduction" = "preproduction") {
  const root = await mkdtemp(join(tmpdir(), "first-hour-clock-"));
  roots.push(root);
  let bound!: ModuleOperationHost;
  const modules = ALL_MODULES.map((module) =>
    module.name !== MODULE
      ? module
      : {
          ...module,
          provisioning: {
            ...module.provisioning!,
            initialSetup: {
              ...module.provisioning!.initialSetup!,
              configure(host: ModuleOperationHost) {
                bound = host;
                return module.provisioning!.initialSetup!.configure!(host);
              },
            },
          },
        },
  );
  const stateDir = join(root, "state");
  const host = createFirstSetupModuleHost({
    stateDir,
    venueDir: join(root, "venue"),
    environment: {},
    modules,
    database: () => venue.db,
  });
  const claim = await host.owner.claimFirstSetup(
    { environment, request },
    randomBytes(32).toString("base64url"),
  );
  const state = (await host.store.read())!;
  const context = firstSetupModuleContext(state, MODULE);
  const prepared = createHostedHourPreparation(bound);
  const owner = { ...claim.state, capability: claim.capability };
  const select = async (comparisonId: string) => {
    const reconfirmation = await host.owner.reconfirm(owner, PASSWORD, "block-use");
    return host.coordinator.run((hold) =>
      host.withPreparationAuthorization(
        {
          intent: () => host.owner.consumeReconfirmation(owner, reconfirmation, "block-use", hold),
          wait: () => host.owner.checkReconfirmation(owner, reconfirmation, "block-use", hold),
        },
        () =>
          withOperationAuthority(context.binding, context.administratorId, (authority) =>
            prepared.select({ binding: context.binding, authority, comparisonId }),
          ),
      ),
    );
  };
  return { host, context, prepared, select, stateDir };
}
it.each(["production", "preproduction"] as const)(
  "real %s host selects using the timed browser, actual box and internet observer",
  async (environment) => {
    const f = await fixture(environment);
    const selected = await selectPastWaits(clock, async () => {
      const challenge = await f.prepared.clockChallenge(f.context.binding);
      const comparison = await f.prepared.compareClocks(
        f.context.binding,
        { challengeId: challenge.id, instantMs: clock.wall() },
        { onBox: false },
      );
      expect(comparison.clock.usable.map((value) => value.source)).toEqual([
        "browser",
        "internet",
        "box",
      ]);
      return f.select(comparison.id);
    });
    expect(selected).toMatchObject({
      status: "selected",
      identity: "0CNNY",
      input: {
        allocation: {
          environment,
          source: "hour",
          reservationEvidence: null,
          series: [
            { code: "A-0CNNY", purpose: "standard" },
            { code: "FF-0CNNY", purpose: "full" },
            { code: "R-0CNNY", purpose: "rectificative" },
          ],
        },
      },
    });
    const journal = JSON.parse(
      await readFile(join(f.stateDir, "module-preparation-state.json"), "utf8"),
    );
    expect(journal.revisions[0].value.entries[0].kind).toBe("wait");
    expect(journal.revisions.at(-1).value.entries.at(-1).identity).toBe("0CNNY");
    expect(external.internet).toHaveBeenCalledWith(environment);
  },
);
it("an unavailable browser and TLS comparison refuse the name for want of a second clock", async () => {
  const f = await fixture();
  external.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const compared = await f.prepared.compareClocks(f.context.binding, null, { onBox: true });
  await expect(f.select(compared.id)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "second_clock_missing" },
  });
  await expect(readFile(join(f.stateDir, "module-preparation-state.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
