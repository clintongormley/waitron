// The real preparation and activation routes and the real promotion in their own process, killed
// with SIGKILL at one point, so no `finally` runs: what is on the disk afterwards is what a power
// cut leaves. Date and elapsed time are frozen together, or the hour clock refuses a slow run.
import { registerHooks } from "node:module";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";

export type ActivationKillPoint = "trading-env" | "venue-commit" | "role";

export interface ActivationKillArgs {
  venueDir: string;
  stateDir: string;
  nodeId: string;
  locationId: string;
  operationId: string;
  at: ActivationKillPoint;
  instant: string;
  binding: unknown;
  signIn: { email: string; password: string };
}

const args = JSON.parse(process.argv[2]!) as ActivationKillArgs;
const instantMs = Date.parse(args.instant);

globalThis.Date = class extends Date {
  constructor(...values: unknown[]) {
    super(...((values.length === 0 ? [instantMs] : values) as [number]));
  }
  static override now(): number {
    return instantMs;
  }
} as DateConstructor;
Object.defineProperty(performance, "now", { value: () => 0 });

const internet = `export async function authenticatedHourHead() { throw new Error("this child makes no network request"); } export async function observeInternetHourClock() { return { source: "internet", result: "usable", instantMs: Date.now(), uncertaintyMs: 0, wallStartedMs: Date.now(), wallFinishedMs: Date.now(), monotonicStartedMs: performance.now(), monotonicFinishedMs: performance.now() }; }`;
// Holds the child for over a second of real time, once, between its clock reading and the re-check,
// so a child whose wall and elapsed-time clocks disagree is refused on every run.
const release = `let held = false; export function readHourRelease() { if (!held) { held = true; const end = process.hrtime.bigint() + 1_100_000_000n; while (process.hrtime.bigint() < end); } return { instantMs: Date.parse("2026-10-15T00:00:00Z") }; }`;
registerHooks({
  resolve(specifier, context, next) {
    const replacement = specifier.endsWith("/hour-clock-internet.js")
      ? internet
      : specifier.endsWith("/hour-release.js")
        ? release
        : undefined;
    return replacement === undefined
      ? next(specifier, context)
      : { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(replacement)}` };
  },
});

const [
  { Hono },
  { ALL_MODULES },
  { loadKeyRing },
  { openVenueDatabase },
  { createFirstSetupCoordinator },
  { resolveAccountKey },
  { createDeploymentHolders },
  { mountHandoverActivationApi },
  { mountHandoverPreparationApi },
  { createNodeOperationPreparation },
  { promoteMirrorToPrimary },
  { writeTradingEnv },
  { TOTP_KEY_RING },
] = await Promise.all([
  import("hono"),
  import("@waitron/composition"),
  import("@waitron/credentials"),
  import("@waitron/db"),
  import("@waitron/provisioning"),
  import("../account-key.js"),
  import("../deployment-holders.js"),
  import("../handover-activation.js"),
  import("../handover-preparation.js"),
  import("../node-operation-preparation.js"),
  import("../promote.js"),
  import("../trading-config.js"),
  import("./authenticator.js"),
]);

function killedAt(point: ActivationKillPoint): void {
  if (point !== args.at) return;
  process.stdout.write(`killed at ${point}\n`);
  process.kill(process.pid, "SIGKILL");
}

const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const modules = ALL_MODULES.filter((module) => module.name === "fiscal-verifactu");
const store = await openVenueDatabase(args.venueDir);
const nodePreparation = createNodeOperationPreparation({
  stateDir: args.stateDir,
  venueDir: args.venueDir,
  db: store.venue,
  nodeDb: store.node,
  node: { nodeId: args.nodeId, locationId: args.locationId } as never,
  modules,
  credentialKeyRing: TOTP_KEY_RING,
  coordinator: createFirstSetupCoordinator(),
  environment: {},
});
const common = {
  node: store.node,
  nodeId: args.nodeId,
  appDb: store.venue,
  nodePreparation,
};
const app = new Hono();
mountHandoverPreparationApi(app, { ...common, requestFromBox: () => false });
mountHandoverActivationApi(app, {
  ...common,
  run: async (attestation, runner, beforeRestart) => {
    const result = await promoteMirrorToPrimary(
      {
        db: store.venue,
        node: store.node,
        nodeId: args.nodeId,
        ring,
        modules,
        holders: createDeploymentHolders("mirror", "secondary"),
        log: () => {},
        persistTradingEnv: async () => {
          await writeTradingEnv(args.stateDir, {
            nodeId: args.nodeId,
            locationId: args.locationId,
            environment: "preproduction",
            accountKey: resolveAccountKey({}, ring).toString("base64"),
          });
          killedAt("trading-env");
        },
        withModuleOperations: async (context, consume) => {
          const series = await runner(context, consume);
          killedAt("venue-commit");
          return series;
        },
      },
      attestation,
    );
    killedAt("role");
    await beforeRestart();
    return { alreadyPrimary: result.alreadyPrimary, restarting: !result.alreadyPrimary };
  },
});

async function post(step: string, body: unknown): Promise<{ status: number; body: never }> {
  const response = await app.request(
    `https://box.test/api/node/handover/${args.operationId}/${step}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { incoming: { socket: new TLSSocket(new Socket()) } },
  );
  return { status: response.status, body: (await response.json()) as never };
}

const prepare = async (proposal: unknown): Promise<Record<string, string>> => {
  const answer = await post("preparation", {
    moduleOperation: { binding: args.binding, input: null },
    signIn: args.signIn,
    proposal,
  });
  if (answer.status !== 200) throw new Error(JSON.stringify(answer));
  return answer.body;
};
const challenge = await prepare({ action: "clock-challenge" });
const compared = await prepare({
  action: "compare-clocks",
  browser: { challengeId: challenge.id, instantMs: Date.now() },
});
const selected = await prepare({ action: "select", comparisonId: compared.id });
const activation = await post("activate", {
  moduleOperation: { binding: args.binding, input: selected.input },
  signIn: args.signIn,
});
throw new Error(`the child was not killed: ${JSON.stringify(activation)}`);
