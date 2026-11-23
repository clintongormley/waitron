import { fixturePasswordHash, fixturePinHash } from "./known-secret-hashes.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { expect } from "vitest";
import { nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import {
  stampDeployment,
  withTransaction,
  type DeploymentEnvironment,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import type { VenueDb } from "@waitron/db/testing/venue-db.js";

import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { enabledModules } from "@waitron/module";
import { planVenue } from "@waitron/provisioning";
import { personIdForLoginEmail } from "@waitron/identity";
import { adoptFromPrimary } from "../adopt.js";
import { replaceBackupSettings } from "../backup-env-writer.js";
import { createBoxJoinAttempt, type JoinedBox } from "../box-join-attempt.js";
import { readModuleConfig, writeModuleConfig } from "../module-config.js";
import { ALL_MODULES } from "../modules.js";
import { establishNodeIdentity, readNodeIdentityKey } from "../node-identity.js";
import { mintSelfSignedServerCert } from "../self-signed-cert.js";
import { appExchange, approveJoin, mountBoxJoin, signedInCookie } from "./box-join.js";
import { setFreshManagementSignIn } from "./fresh-management-sign-in.js";
import { signedMembershipDoc } from "./membership-doc-fixture.js";
import { applyWithFirstSetup } from "./minute-first-setup.js";
import { holdRecoveryKey } from "./recovery-key.js";

export const MAIN_URL = "https://main.test";
export const SPARE_URL = "https://spare.test";
export const ADMIN_PASSWORD = "correct horse";

/** Two boxes on separate databases and state folders; the main box's database chooses its modules. */
interface TwoBoxes {
  mainBox: VenueDb;
  spareBox: VenueDb;
  mainState: string;
  spareState: string;
  ring: KeyRing;
}

/**
 * A main box set up in Spain with the modules its venue database enables, signed in as its
 * administrator, its chart listing only itself, and its real box-join routes mounted on `bundleApp`.
 */
export async function veriFactuMainBox(
  boxes: TwoBoxes,
  environment: DeploymentEnvironment = "preproduction",
) {
  const { mainBox, mainState, ring } = boxes;
  const modules = enabledModules(ALL_MODULES, await readModuleConfig(mainBox.db));
  await stampDeployment(mainBox.db, environment);
  const venue = await applyWithFirstSetup(mainState, environment)(
    planVenue(
      {
        country: "ES",
        taxId: "89890001K",
        legalName: "Two Boxes SL",
        name: "Main box",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "FA",
        correctiveSeriesCode: "RF",
        admin: {
          displayName: "Owner",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash(ADMIN_PASSWORD),
          email: "owner@example.test",
        },
      },
      modules,
    ),
    { db: mainBox.db, modules },
  );
  await holdBoxSecrets(mainState);
  const mainId: string = venue.nodeId;
  await establishNodeIdentity({ ownerDb: mainBox.db, node: mainBox.node, ring }, mainId);
  const mainKey = await readNodeIdentityKey(mainBox.node, ring, mainId);
  await writeNodeMembership(
    mainBox.db,
    signedMembershipDoc(1, {
      signerNodeId: mainId,
      keyPair: { publicKey: nodeSigningPublicKey(mainKey), privateKey: mainKey },
      nodes: [{ nodeId: mainId, contactUrl: MAIN_URL, standing: "serving-primary" }],
    }),
  );
  const session = await openManagementSession(mainBox.db, "admin");
  const [{ email }] = (
    await mainBox.db.execute<{ email: string }>(
      sql`select email from persons where id = ${session.personId}`,
    )
  ).rows as [{ email: string }];
  await withTransaction(mainBox.db, (tx) => setFreshManagementSignIn(tx, session.token));

  const bundleApp = mirrorBundleApp(
    { db: mainBox.db, node: mainBox.node, stateDir: mainState, ring },
    mainId,
    MAIN_URL,
  );
  return { modules, mainId, mainKey, session, email, bundleApp };
}

/**
 * The main box behind each app {@link mirrorBundleApp} made: its database, for the approver's
 * sign-in, the state folder holding the certificate it serves, and its address.
 */
const MAIN_BOXES = new WeakMap<
  Hono,
  { db: Database; stateDir: string; advertisedOrigin: string }
>();

/** The real box-join routes of the main box `nodeId`, whose files are `box`'s. */
export function mirrorBundleApp(
  box: { db: Database; node: NodeDatabase; stateDir: string; ring: KeyRing },
  nodeId: string,
  advertisedOrigin: string,
): Hono {
  const bundleApp = new Hono();
  mountBoxJoin(bundleApp, {
    appDb: box.db,
    node: box.node,
    ring: box.ring,
    stateDir: box.stateDir,
    boxHostname: "waitron.local",
    advertisedOrigin,
    designated: { nodeId },
    wakeSpareJoin: () => {},
  });
  MAIN_BOXES.set(bundleApp, { db: box.db, stateDir: box.stateDir, advertisedOrigin });
  return bundleApp;
}

/** A box authority and the recovery key in `stateDir`, as a main box's state folder holds them. */
async function holdBoxSecrets(stateDir: string): Promise<void> {
  await mkdir(join(stateDir, "tls"), { recursive: true });
  const authority = mintSelfSignedServerCert({
    hostnames: ["waitron.local"],
    ipAddresses: [],
    now: new Date(),
  });
  await writeFile(join(stateDir, "tls", "ca.crt"), authority.caCertPem);
  await writeFile(join(stateDir, "tls", "ca.key"), authority.caKeyPem);
  await holdRecoveryKey(stateDir);
}

let joinAddresses = 0;

/**
 * A new box at `spareUrl` asks `main` to join by code, through the real `createBoxJoinAttempt`
 * answered by `main`'s app; the new box says Yes and the administrator `email` approves on the main
 * box; answers what the new box then holds, as finishing the join hands it to `adoptFromPrimary`. It throws where
 * the attempt refuses the main box's answers.
 */
export async function collectJoin(
  main: { bundleApp: Hono; email: string },
  { spareUrl = SPARE_URL, storePort = 7443 }: { spareUrl?: string; storePort?: number } = {},
): Promise<JoinedBox> {
  const mainBox = MAIN_BOXES.get(main.bundleApp);
  if (mainBox === undefined) throw new Error("collectJoin needs an app from mirrorBundleApp");
  joinAddresses += 1;
  const address = `10.40.0.${joinAddresses}`;
  const cookie = await signedInCookie(
    mainBox.db,
    await personIdForLoginEmail(mainBox.db, main.email),
  );
  const answers = appExchange({
    app: () => main.bundleApp,
    from: address,
    certificate: await readFile(join(mainBox.stateDir, "tls", "ca.crt"), "utf8"),
  });
  let requestId: string | undefined;
  const attempt = createBoxJoinAttempt({
    advertisedOrigin: spareUrl,
    spareStorePort: storePort,
    now: () => new Date(),
    addresses: () => [address],
    pollEveryMs: 50,
    exchange: async (url, request, maxBytes) => {
      const answer = await answers(url, request, maxBytes);
      if (url.pathname.endsWith("/hello") && answer.status === 200)
        requestId = (JSON.parse(answer.text) as { requestId: string }).requestId;
      return answer;
    },
  });
  await attempt.start(mainBox.advertisedOrigin);
  try {
    await attempt.confirm();
    const approved = await approveJoin(main.bundleApp, requestId!, {}, { cookie });
    expect(approved.status, JSON.stringify(approved.body)).toBe(202);
    for (let waited = 0; attempt.current()?.state === "waiting" && waited < 10_000; waited += 50)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const joined = attempt.joined();
    if (joined === null)
      throw new Error(`approved join not collected: ${JSON.stringify(attempt.current())}`);
    return joined;
  } catch (error) {
    // So a failed join leaves nothing polling the main box for the rest of the file.
    await attempt.cancel().catch(() => {});
    throw error;
  }
}

/**
 * The spare joins `main` by code ({@link collectJoin}), and what it collects goes to the real
 * `adoptFromPrimary`, as `adoptJoined` hands it in `boot.ts`.
 */
export async function joinSpare(
  boxes: Pick<TwoBoxes, "spareBox" | "spareState" | "ring">,
  main: { bundleApp: Hono; email: string },
  options: {
    spareUrl?: string;
    /** What the new box's `WAITRON_ENV` names; null when it is unset, as on a fresh box. */
    environment?: DeploymentEnvironment | null;
  } = {},
) {
  const { spareBox, spareState, ring } = boxes;
  const { environment = "preproduction", ...joinOptions } = options;
  const { identity, bundle, storeUrl } = await collectJoin(main, joinOptions);
  const standby = { nodeId: identity.nodeId, publicKey: identity.publicKey };
  let spareId!: string;
  await adoptFromPrimary(
    {
      ownerDb: spareBox.db,
      ownerNode: spareBox.node,
      environmentKeys: {},
      ring,
      persistCredentialsRing: async () => {},
      assertStartsWith: () => {},
      environment,
      persistTrading: async (args) => {
        spareId = args.nodeId;
      },
      persistBackupSettings: (settings) => replaceBackupSettings(spareState, settings),
      persistModuleConfig: async (config) => {
        await writeModuleConfig(spareBox.db, config, null);
      },
      stateDir: spareState,
      database: "spare",
      listIpv4: () => [],
      now: () => new Date(),
    },
    { identity, bundle, storeUrl },
    { beforeFirstWrite: async () => {} },
  );
  return { bundle, standby, spareId };
}
