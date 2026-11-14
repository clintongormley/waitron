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
import { hashPassword, hashPin } from "@waitron/identity";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { enabledModules } from "@waitron/module";
import { planVenue } from "@waitron/provisioning";
import { adoptFromPrimary, type AdoptCredential } from "../adopt.js";
import { replaceBackupSettings } from "../backup-env-writer.js";
import type { MirrorBundle } from "../mirror-bundle.js";
import { mountMirrorBundleApi } from "../mirror-bundle-api.js";
import { readModuleConfig, writeModuleConfig } from "../module-config.js";
import { ALL_MODULES } from "../modules.js";
import { establishNodeIdentity, readNodeIdentityKey } from "../node-identity.js";
import { mintSelfSignedServerCert } from "../self-signed-cert.js";
import { TOTP_KEY_RING } from "./authenticator.js";
import { setFreshManagementSignIn } from "./fresh-management-sign-in.js";
import { signedMembershipDoc } from "./membership-doc-fixture.js";
import { applyWithFirstSetup } from "./minute-first-setup.js";
import { holdRecoveryKey } from "./recovery-key.js";

export const MAIN_URL = "https://main.test";
export const SPARE_URL = "https://spare.test";
export const ADMIN_PASSWORD = "correct horse";

/** Two boxes on separate databases and state folders; the main box's folder chooses its modules. */
export interface TwoBoxes {
  mainBox: VenueDb;
  spareBox: VenueDb;
  mainState: string;
  spareState: string;
  ring: KeyRing;
}

/**
 * A main box set up in Spain with the modules its state folder enables, signed in as its
 * administrator, its chart listing only itself, and the real bundle route mounted on `bundleApp`.
 */
export async function veriFactuMainBox(boxes: TwoBoxes) {
  const { mainBox, mainState, ring } = boxes;
  const modules = enabledModules(ALL_MODULES, await readModuleConfig(mainState));
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
        operationDescription: "Sale",
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
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(ADMIN_PASSWORD),
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

/** The real bundle route of the main box `nodeId`, whose files are `box`'s. */
export function mirrorBundleApp(
  box: { db: Database; node: NodeDatabase; stateDir: string; ring: KeyRing },
  nodeId: string,
  advertisedOrigin: string,
): Hono {
  const bundleApp = new Hono();
  mountMirrorBundleApi(bundleApp, {
    appDb: box.db,
    node: box.node,
    ring: box.ring,
    stateDir: box.stateDir,
    boxHostname: "waitron.local",
    advertisedOrigin,
    designated: { nodeId },
    accountKey: Buffer.alloc(32, 9).toString("base64"),
    credentialKeyRing: TOTP_KEY_RING,
    wakeSpareJoin: () => {},
  });
  return bundleApp;
}

/** A box authority and the recovery key in `stateDir`, as a main box's state folder holds them. */
export async function holdBoxSecrets(stateDir: string): Promise<void> {
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

/** The spare joins `main` through the real `adoptFromPrimary`, the bundle route answering 200. */
export async function joinSpare(
  boxes: Pick<TwoBoxes, "spareBox" | "spareState" | "ring">,
  main: { bundleApp: Hono; email: string },
  { primaryUrl = MAIN_URL, spareUrl = SPARE_URL } = {},
) {
  const { spareBox, spareState, ring } = boxes;
  let bundle!: MirrorBundle;
  let standby!: { nodeId: string; publicKey: string };
  let spareId!: string;
  await adoptFromPrimary(
    {
      ownerDb: spareBox.db,
      ownerNode: spareBox.node,
      ring,
      persistCredentialsRing: async () => {},
      fetchBundle: async (_url, credential: AdoptCredential, sent) => {
        standby = { nodeId: sent.nodeId, publicKey: sent.publicKey };
        const response = await main.bundleApp.request("/management-api/mirror-bundle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: credential.email,
            password: credential.password,
            standbyNodeId: sent.nodeId,
            standbyPublicKey: sent.publicKey,
            standbyContactUrl: sent.contactUrl,
            standbyStoreUrl: sent.storeUrl,
            standbyAt: sent.at,
          }),
        });
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        bundle = body as MirrorBundle;
        return bundle;
      },
      advertisedOrigin: spareUrl,
      spareStorePort: 7443,
      environment: "preproduction",
      persistTrading: async (args) => {
        spareId = args.nodeId;
      },
      persistBackupSettings: (settings) => replaceBackupSettings(spareState, settings),
      persistModuleConfig: async (config) => {
        await writeModuleConfig(spareState, config);
      },
      stateDir: spareState,
      database: "spare",
      listIpv4: () => [],
      now: () => new Date(),
    },
    { primaryUrl, credential: { email: main.email, password: ADMIN_PASSWORD } },
    { beforeFirstWrite: async () => {} },
  );
  return { bundle, standby, spareId };
}
