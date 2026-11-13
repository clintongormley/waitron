// A box provisioned the way a setup boot leaves one, for the in-process scenarios that start a real
// server on it: the stream loop (`stream-loop-scenario.ts`) and the spare join
// (`spare-join-scenario.ts`).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  nodes,
  openVenueDatabase,
  stampDeployment,
  venueLocationId,
  withTransaction,
} from "@waitron/db";
import { applyMigrations, type migrationOptionsFor } from "@waitron/migrations";
import { applyAllocatedTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import {
  planVenue,
  type applyVenue as applyMinuteVenue,
  type VenueRequest,
} from "@waitron/provisioning";
import type { WaitronModule } from "@waitron/module";
import type { BucketConfig } from "@waitron/stream";
import { mintBreakGlassSecret } from "../break-glass.js";
import { ensureBoxSecrets } from "../box-secrets.js";
import { formatEnvFile, parseEnvFile } from "../env-file.js";
import { seedTermZeroMembership } from "../membership-seed.js";
import { ALL_MODULES } from "../modules.js";
import { establishNodeIdentity } from "../node-identity.js";
import { streamSettingsPayload } from "../stream-host.js";
import { fixturePasswordHash, fixturePinHash } from "./known-secret-hashes.js";

export const STREAM_BOX_LOCALE = "es-ES";

export interface BoxDirs {
  root: string;
  state: string;
  venue: string;
}

export async function boxDirs(parent: string, name: string): Promise<BoxDirs> {
  const root = join(parent, name);
  const dirs = { root, state: join(root, "state"), venue: join(root, "state", "venue") };
  await mkdir(dirs.venue, { recursive: true });
  return dirs;
}

export interface StreamBox {
  nodeId: string;
  seriesId: string;
  locationId: string;
  publicKey: string;
  /** The node's break-glass secret. */
  nodeSecret: string;
}

/**
 * Secrets and TLS in the state folder, a migrated and provisioned venue, a node key and a term-0
 * membership document naming `advertisedOrigin`, and streaming to `bucket` switched on with
 * `recoveryKey`; `modulesJson` is written as `modules.json`. The venue is planned for a Spanish
 * taxpayer with every module unless `venue` says otherwise, and must agree with `modulesJson`.
 */
export async function provisionStreamBox(options: {
  dirs: BoxDirs;
  migrations: ReturnType<typeof migrationOptionsFor>;
  advertisedOrigin: string;
  bucket: BucketConfig;
  recoveryKey: string;
  modulesJson: unknown;
  venue?: { request: Partial<VenueRequest>; modules: readonly WaitronModule[] };
  apply?: typeof applyMinuteVenue;
}): Promise<StreamBox> {
  const { dirs, bucket } = options;
  const modules = options.venue?.modules ?? ALL_MODULES;
  await ensureBoxSecrets({
    stateDir: dirs.state,
    hostnames: ["waitron.local", "localhost"],
    now: () => new Date(),
    listIpv4: () => [],
  });
  const ring = loadKeyRing(parseEnvFile(await readFile(join(dirs.state, "secrets.env"), "utf8")));
  await applyMigrations(dirs.venue, options.migrations);
  const seeding = await openVenueDatabase(dirs.venue);
  let box: StreamBox;
  try {
    await stampDeployment(seeding.venue, "preproduction");
    const venue = await (options.apply ?? applyAllocatedTestVenue)(
      planVenue(
        {
          country: "ES",
          taxId: "74000001P",
          legalName: "Stream Loop SL",
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [STREAM_BOX_LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
          seriesCode: "A",
          rectificativeSeriesCode: "R",
          admin: {
            displayName: "Administradora",
            firstNames: "Test",
            lastNames: "Operator",
            pinHash: fixturePinHash("1234"),
            passwordHash: fixturePasswordHash("dashPass123"),
            email: "owner@example.test",
          },
          ...options.venue?.request,
        },
        modules,
      ),
      { db: seeding.venue, modules },
    );
    const venueId = await venueLocationId(seeding.venue);
    const nodeSecret = await mintBreakGlassSecret(
      { venue: seeding.venue, node: seeding.node },
      venue.nodeId,
    );
    await establishNodeIdentity({ ownerDb: seeding.venue, node: seeding.node, ring }, venue.nodeId);
    await seedTermZeroMembership(
      { db: seeding.venue, node: seeding.node, ring },
      venue.nodeId,
      options.advertisedOrigin,
    );
    await withTransaction(seeding.venue, (tx) =>
      putCredential(tx, ring, {
        purpose: "backup.stream",
        value: streamSettingsPayload({ venueId, bucket }),
      }),
    );
    const [row] = await seeding.venue
      .select({ publicKey: nodes.publicKey })
      .from(nodes)
      .where(eq(nodes.id, venue.nodeId));
    box = {
      nodeId: venue.nodeId,
      seriesId: venue.seriesIds[0]!,
      locationId: venueId,
      publicKey: row!.publicKey!,
      nodeSecret,
    };
  } finally {
    await seeding.close();
  }
  await writeFile(
    join(dirs.state, "trading.env"),
    formatEnvFile({
      WAITRON_NODE_ID: box.nodeId,
      WAITRON_ENV: "preproduction",
    }),
  );
  await writeFile(
    join(dirs.state, "backup.env"),
    formatEnvFile({ WAITRON_BACKUP_RECOVERY_KEY: options.recoveryKey }),
  );
  await writeFile(join(dirs.state, "modules.json"), JSON.stringify(options.modulesJson));
  return box;
}
