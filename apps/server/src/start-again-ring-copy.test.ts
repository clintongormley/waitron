import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import {
  getCredential,
  loadKeyRing,
  putCredential,
  readNodeSigningKey,
  sealNodeSigningKeyTx,
  type KeyRing,
} from "@waitron/credentials";
import { openVenueDatabase, withNodeTransaction, withTransaction } from "@waitron/db";
import { endorseKey, generateNodeKeyPair } from "@waitron/membership";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  chooseStartAgainLeftovers,
  START_AGAIN_SET_ASIDE_DIR,
  surveyStartAgainLeftovers,
} from "@waitron/provisioning";
import {
  START_AGAIN_ADMIN_PASSWORD,
  startAgainAttempt,
} from "@waitron/provisioning/testing/start-again-attempt";
import { isAppError } from "@waitron/shared";
import { adoptFromPrimary, type AdoptHooks, type AdoptRequest } from "./adopt.js";
import { ensureBoxSecrets, writeCredentialsRing } from "./box-secrets.js";
import { parseEnvFile } from "./env-file.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { writeModuleConfig } from "./module-config.js";
import { mountSetup } from "./setup-api.js";
import { createSetupOperationStore } from "./setup-operation.js";
import { writeTradingEnv } from "./trading-config.js";

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: undefined } : module,
    ),
  };
});

const MOVED_NODE_ID = "44444444-4444-4444-8444-444444444444";
const PRIMARY_NODE_ID = "22222222-2222-4222-8222-222222222222";
const PRIMARY_KEYS = generateNodeKeyPair();
const SUMUP = {
  apiKey: "sup_sk_moved",
  merchantCode: "MABC123",
  affiliateAppId: "-",
  affiliateKey: "-",
};
const BUNDLE: Omit<MirrorBundle, "reservedIdentity"> = {
  designated: { locationId: "33333333-3333-4333-8333-333333333333", nodeId: PRIMARY_NODE_ID },
  tenant: { country: "ES", taxId: "80000001K" },
  primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
  environment: "preproduction",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
  relayUrl: "https://relay.example/",
  accountKey: Buffer.alloc(32, 9).toString("base64"),
  moduleOverrides: {},
  primaryPublicKey: PRIMARY_KEYS.publicKey,
  credentialsRing: { key: Buffer.alloc(32, 6).toString("base64"), version: 1 },
  boxCaKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
};

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "start-again-ring-copy-"));
  dirs.push(dir);
  return dir;
}

const migrate = (venueDir: string) =>
  applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));
const ringIn = async (path: string): Promise<KeyRing> =>
  loadKeyRing(parseEnvFile(await readFile(path, "utf8")));

type Adopt = (req: AdoptRequest, hooks: AdoptHooks) => Promise<{ breakGlassSecret: string }>;

/** The real `POST /setup-api/adopt` over the real `adoptFromPrimary`; only the main box is a stub. */
async function joinAsSpare(stateDir: string, venueDir: string): Promise<void> {
  await migrate(venueDir);
  const store = await openVenueDatabase(venueDir);
  try {
    const adopt: Adopt = async (req, hooks) =>
      adoptFromPrimary(
        {
          ownerDb: store.venue,
          ownerNode: store.node,
          ring: await ringIn(join(stateDir, "secrets.env")),
          fetchBundle: async (_url, _credential, standby) => ({
            ...BUNDLE,
            reservedIdentity: {
              modules: {
                "fiscal-verifactu": {
                  nif: "90000001K",
                  idSistemaInformatico: "WS",
                  numeroInstalacion: 7,
                },
              },
              series: [{ code: "SA-7", purpose: "standard" }],
              endorsement: endorseKey(
                standby.nodeId,
                standby.publicKey,
                PRIMARY_NODE_ID,
                PRIMARY_KEYS.privateKey,
              ),
            },
          }),
          advertisedOrigin: "https://standby.example",
          environment: "preproduction",
          persistTrading: async (cfg) => {
            await writeTradingEnv(stateDir, cfg);
          },
          persistModuleConfig: async (config) => {
            await writeModuleConfig(stateDir, config);
          },
          persistCredentialsRing: (ring) => writeCredentialsRing(stateDir, ring),
          stateDir,
          database: venueDir,
        },
        req,
        hooks,
      );
    const app = new Hono();
    mountSetup(
      app,
      {
        environment: "preproduction",
        operations: createSetupOperationStore(stateDir),
        adopt,
        requestRestart: vi.fn(),
      },
      () => {},
    );
    const response = await app.request("/setup-api/adopt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primaryUrl: "https://primary.example",
        credential: { personId: "88888888-8888-8888-8888-888888888888", password: "a-password" },
      }),
    });
    expect(response.status).toBe(200);
    expect((await createSetupOperationStore(stateDir).read())?.phase).toBe("complete");
  } finally {
    await store.close();
  }
}

/** Opens a copy of the moved venue folder and reads its two sealed rows with `ring`. */
async function readMoved(movedVenue: string, ring: KeyRing) {
  const copy = join(await scratch(), "venue");
  await cp(movedVenue, copy, { recursive: true });
  const store = await openVenueDatabase(copy);
  try {
    const attempt = async <T>(read: () => Promise<T>) =>
      read().then(
        (value) => ({ value }),
        (error: unknown) => ({ code: isAppError(error) ? error.code : String(error) }),
      );
    return {
      signingKey: await attempt(() => readNodeSigningKey(store.node, ring, MOVED_NODE_ID)),
      sumup: await attempt(() =>
        withTransaction(store.venue, (tx) =>
          getCredential(tx, ring, { purpose: "payments.sumup" }),
        ),
      ),
    };
  } finally {
    await store.close();
  }
}

it("after a Move and a completed join as a spare, the moved rows open with the ring copied beside them, and not with the box's live ring", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { stateDir, venueDir } = attempt.roots;
  await ensureBoxSecrets({ stateDir, hostnames: ["localhost"], now: () => new Date() });
  const ownRingFile = await readFile(join(stateDir, "secrets.env"));
  const ownRing = await ringIn(join(stateDir, "secrets.env"));
  const signing = generateNodeKeyPair();
  await migrate(venueDir);
  const found = await openVenueDatabase(venueDir);
  try {
    await withNodeTransaction(found.node, (tx) =>
      sealNodeSigningKeyTx(tx, ownRing, MOVED_NODE_ID, signing.privateKey),
    );
    await withTransaction(found.venue, (tx) =>
      putCredential(tx, ownRing, { purpose: "payments.sumup", value: SUMUP }),
    );
  } finally {
    await found.close();
  }
  const survey = await surveyStartAgainLeftovers(attempt.roots);
  if (survey?.kind !== "choice") throw new Error(`expected choice, got ${JSON.stringify(survey)}`);
  const chosen = await chooseStartAgainLeftovers({
    roots: attempt.roots,
    password: START_AGAIN_ADMIN_PASSWORD,
    choice: "move",
    listed: survey.digest,
    now: () => new Date(),
  });
  if (chosen.choice !== "move") throw new Error("expected a Move");
  const stemFolder = join(stateDir, chosen.setAside.state, "..");
  const movedVenue = join(stateDir, chosen.setAside.venue);
  expect(chosen.setAside.venue.startsWith(`${START_AGAIN_SET_ASIDE_DIR}/`)).toBe(true);

  await joinAsSpare(stateDir, venueDir);

  const liveRingFile = await readFile(join(stateDir, "secrets.env"));
  expect(liveRingFile.equals(ownRingFile)).toBe(false);
  const copied = join(stemFolder, "secrets.env");
  expect((await readFile(copied)).equals(ownRingFile)).toBe(true);
  expect(await readMoved(movedVenue, await ringIn(copied))).toEqual({
    signingKey: { value: signing.privateKey },
    sumup: { value: SUMUP },
  });
  // Control: the ring the box now runs on is the main box's, and opens neither row.
  expect(await readMoved(movedVenue, await ringIn(join(stateDir, "secrets.env")))).toEqual({
    signingKey: { code: "credentials.decrypt_failed" },
    sumup: { code: "credentials.decrypt_failed" },
  });
});
