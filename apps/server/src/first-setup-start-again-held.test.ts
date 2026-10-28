import { heldSetup } from "../test/held-setup-database.js";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";

type WithRecovery = Awaited<ReturnType<typeof heldSetup>>;
type Held = Omit<WithRecovery, "service"> & { service: WithRecovery["service"] | undefined };

// The rows a real activation stopped at `committed` leaves with the helper's module set.
const ACTIVATION_ROWS = 105;

async function tree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(join(dir, prefix))).sort()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    // Every exclusive turn rewrites the anchor's own lock pair.
    if (prefix === "" && /^venue\.(lock|holder)/.test(name)) continue;
    if ((await lstat(join(dir, relative))).isDirectory()) {
      result[`${relative}/`] = "";
      Object.assign(result, await tree(dir, relative));
    } else
      result[relative] = createHash("sha256")
        .update(await readFile(join(dir, relative)))
        .digest("hex");
  }
  return result;
}
const snapshot = async (f: Pick<Held, "roots">) => ({
  venue: await tree(f.roots.venueDir),
  state: await tree(f.roots.stateDir),
});

/**
 * Signs the setup owner in, then answers a call that asks for the summary. A setup whose
 * publication completed cannot be signed into again, so with `signIn: false` it asks without an
 * owner.
 */
async function signedIn(f: Held, host: Held["host"] = f.host, signIn = true) {
  const request = signIn
    ? await f.signIn().then(({ owner, ids }) => ({ ...ids, owner }))
    : await host.resolution.inspectFirstSetupResolution().then((current) => ({
        inspectionId: current.inspectionId,
        revision: current.revision!,
        ownerGeneration: current.ownerGeneration!,
      }));
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host,
    ...(f.service === undefined ? {} : { backupRecovery: f.service }),
  });
  return () => actions.startAgainSummary(request);
}
const summary = async (f: Held) => (await signedIn(f))();

/** Asks for the summary, and checks the refusal changed nothing on disk. */
async function expectRefused(
  f: Held,
  refusal: object,
  { host, signIn = true }: { host?: Held["host"]; signIn?: boolean } = {},
) {
  const ask = await signedIn(f, host, signIn);
  const before = await snapshot(f);
  await expect(ask()).rejects.toMatchObject(refusal);
  expect(await snapshot(f)).toEqual(before);
}

it("a legitimate held setup database beside a stopped recovery answers the summary with what it holds", async () => {
  const f = await heldSetup();
  const shown = await summary(f);
  expect(shown).toEqual({
    reached: "fiscal-finished",
    lastName: f.installationName,
    recovery: {
      startedAt: expect.any(String),
      lastActiveAt: expect.any(String),
      lastActiveSource: expect.any(String),
      lastName: expect.toBeOneOf([null, expect.any(String)]),
      failed: false,
      cloud: false,
    },
    held: { rows: ACTIVATION_ROWS, kept: 0, records: 0, accepted: 0 },
  });
});

it("a held setup database with an invoice record still answers the summary, counting it", async () => {
  const f = await heldSetup({ invoices: 1 });
  const shown = await summary(f);
  expect(shown.held).toMatchObject({ records: 1, accepted: 0 });
  expect(shown.held!.kept).toBeGreaterThanOrEqual(1);
});

it.each([
  ["committed", { tradingSettings: true }, true],
  ["complete", { status: "complete", tradingSettings: true }, false],
] as const)(
  "saved trading settings beside a held database (attempt %s) refuse setup.start_again_refused trading-settings, and nothing changes",
  async (_label, options, signIn) => {
    await expectRefused(
      await heldSetup(options),
      { code: "setup.start_again_refused", params: { cause: "trading-settings" } },
      { signIn },
    );
  },
);

it("a complete attempt with no saved trading settings refuses setup.start_again_refused setup-finished, and nothing changes", async () => {
  await expectRefused(
    await heldSetup({ status: "complete" }),
    { code: "setup.start_again_refused", params: { cause: "setup-finished" } },
    { signIn: false },
  );
});

it("a held setup database with no recovery started is still refused setup.not_ready, and nothing changes", async () => {
  await expectRefused(await heldSetup({ recovery: false }), { code: "setup.not_ready" });
});

it.each([
  ["saved trading settings", { recovery: false, tradingSettings: true }, true],
  ["a complete attempt", { recovery: false, status: "complete" }, false],
] as const)(
  "%s with no recovery started is refused setup.not_ready, not start_again_refused, and nothing changes",
  async (_label, options, signIn) => {
    await expectRefused(await heldSetup(options), { code: "setup.not_ready" }, { signIn });
  },
);

it.each([
  ["unknown", {}],
  ["partial", {}],
  ["unknown", { tradingSettings: true }],
  ["partial", { tradingSettings: true }],
] as const)(
  "a database read as %s beside a stopped recovery (%o) is still refused setup.not_ready, and nothing changes",
  async (database, options) => {
    const f = await heldSetup(options);
    const inspect = f.host.resolution.inspectFirstSetupResolution;
    const host = {
      ...f.host,
      resolution: {
        ...f.host.resolution,
        inspectFirstSetupResolution: async () => ({ ...(await inspect()), database }),
      },
    } as Held["host"];
    await expectRefused(f, { code: "setup.not_ready" }, { host });
  },
);
