import { fixturePasswordHash, fixturePinHash } from "./known-secret-hashes.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { expect } from "vitest";
import { nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import {
  stampDeployment,
  withTransaction,
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
import { ownContactUrl } from "../box-name.js";
import {
  JOIN_REVEAL_LABEL,
  commitmentMatches,
  joinCode,
  revealAnswerFields,
  verifyJoinMessage,
} from "../box-join-code.js";
import type { JoinedBox } from "../box-join-attempt.js";
import type { LockedJoinBundle } from "../box-join-seal.js";
import { isMirrorBundle } from "../mirror-bundle-fetch.js";
import { readModuleConfig, writeModuleConfig } from "../module-config.js";
import { ALL_MODULES } from "../modules.js";
import { establishNodeIdentity, readNodeIdentityKey } from "../node-identity.js";
import { generateStandbyIdentity } from "../reserved-identity.js";
import { mintSelfSignedServerCert } from "../self-signed-cert.js";
import {
  approveJoin,
  boxPost,
  helloBody,
  joiningBox,
  mountBoxJoin,
  pollJoin,
  revealBody,
  signedInCookie,
  unlockJoin,
  type HelloAnswer,
} from "./box-join.js";
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
export async function veriFactuMainBox(boxes: TwoBoxes) {
  const { mainBox, mainState, ring } = boxes;
  const modules = enabledModules(ALL_MODULES, await readModuleConfig(mainBox.db));
  await stampDeployment(mainBox.db, "preproduction");
  const venue = await applyWithFirstSetup(mainState)(
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
        rectificativeSeriesCode: "RF",
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

/** The main box's database behind each app {@link mirrorBundleApp} made, for the approver's sign-in. */
const MAIN_DATABASES = new WeakMap<Hono, Database>();

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
  MAIN_DATABASES.set(bundleApp, box.db);
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
 * A new box at `spareUrl` asks `main` to join by code and the administrator `email` taps its code
 * on the main box; answers what the new box then holds, as Finish joining hands it to
 * `adoptFromPrimary`. It throws where `createBoxJoinAttempt` refuses the main box's answers.
 */
export async function collectJoin(
  main: { bundleApp: Hono; email: string },
  { spareUrl = SPARE_URL, storePort = 7443 }: { spareUrl?: string; storePort?: number } = {},
): Promise<JoinedBox> {
  const mainDb = MAIN_DATABASES.get(main.bundleApp);
  if (mainDb === undefined) throw new Error("collectJoin needs an app from mirrorBundleApp");
  const identity = generateStandbyIdentity();
  const contactUrl = ownContactUrl(spareUrl, identity.nodeId);
  const store = new URL(contactUrl);
  store.protocol = "https:";
  store.port = String(storePort);
  const storeUrl = store.origin;
  joinAddresses += 1;
  const box = joiningBox(`10.40.0.${joinAddresses}`, { identity, contactUrl, storeUrl });
  const cookie = await signedInCookie(mainDb, await personIdForLoginEmail(mainDb, main.email));
  const app = main.bundleApp;
  const helloResponse = await boxPost(app, "hello", helloBody(box), box.address);
  const answer = (await helloResponse.json()) as HelloAnswer;
  expect(helloResponse.status, JSON.stringify(answer)).toBe(200);
  const reveal = revealBody(box, answer.requestId);
  const revealResponse = await boxPost(app, "reveal", reveal, box.address);
  const revealed = (await revealResponse.json()) as { mainNonce: string; signature: string };
  expect(revealResponse.status, JSON.stringify(revealed)).toBe(200);
  box.seq = 1;
  const mainNonce = Buffer.from(revealed.mainNonce, "base64");
  if (!commitmentMatches(Buffer.from(answer.commitment, "base64"), answer.requestId, mainNonce))
    throw new Error("the main box's nonce does not match its commitment");
  if (
    !verifyJoinMessage(
      JOIN_REVEAL_LABEL,
      answer.requestId,
      reveal.seq as number,
      revealAnswerFields(box.hello, box.newNonce, mainNonce),
      revealed.signature,
      answer.mainPublicKey,
    )
  )
    throw new Error("the main box's reveal answer is not signed by its hello key");
  const code = joinCode({
    ...box.hello,
    mainNodeId: answer.mainNodeId,
    mainPublicKey: answer.mainPublicKey,
    newNonce: box.newNonce,
    mainNonce,
    requestId: answer.requestId,
  });
  const listed = { requestId: answer.requestId, code, box, mainPublicKey: answer.mainPublicKey };
  const approved = await approveJoin(app, answer.requestId, { code }, { cookie });
  expect(approved.status, JSON.stringify(approved.body)).toBe(202);
  const polled = (await pollJoin(app, listed)) as { state: string; locked?: LockedJoinBundle };
  if (polled.state !== "approved" || polled.locked === undefined)
    throw new Error(`approved join not handed over: ${JSON.stringify(polled)}`);
  const bundle = unlockJoin(listed, polled.locked);
  if (
    !isMirrorBundle(bundle) ||
    bundle.primaryPublicKey !== answer.mainPublicKey ||
    bundle.designated.nodeId !== answer.mainNodeId
  )
    throw new Error("the collected bundle does not name the main box that answered the hello");
  return { identity, bundle, storeUrl };
}

/**
 * The spare joins `main` by code ({@link collectJoin}), and what it collects goes to the real
 * `adoptFromPrimary`, as `adoptJoined` hands it in `boot.ts`.
 */
export async function joinSpare(
  boxes: Pick<TwoBoxes, "spareBox" | "spareState" | "ring">,
  main: { bundleApp: Hono; email: string },
  options: { spareUrl?: string } = {},
) {
  const { spareBox, spareState, ring } = boxes;
  const { identity, bundle, storeUrl } = await collectJoin(main, options);
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
      environment: "preproduction",
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
