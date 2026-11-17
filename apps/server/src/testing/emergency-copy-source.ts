// A venue whose main box is the source of Cloud's emergency copy, and a binding naming it, for the
// emergency copy check and placement tests.
import {
  deployment,
  nodes,
  saveVenueFields,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { generateNodeKeyPair, signDocumentBody } from "@waitron/membership";
import { generationName } from "@waitron/stream";
import type { EmergencyCopyBinding } from "../emergency-copy-binding.js";

export const source = generateNodeKeyPair();
export const sourceId = "e7000000-0000-4000-8000-000000000001";
export const copyId = "e7000000-0000-4000-8000-000000000002";
export const venueId = "e7000000-0000-4000-8000-000000000003";
export const streamId = "e7000000-0000-4000-8000-000000000004";

export const chartBody = (primary: string) => ({
  term: 1,
  nodes: [{ nodeId: primary, standing: "serving-primary" as const, contactUrl: "" }],
});

export async function writeChart(db: Database, primary: string, privateKey = source.privateKey) {
  await writeNodeMembership(db, {
    body: chartBody(primary),
    signerNodeId: sourceId,
    signature: signDocumentBody(chartBody(primary), privateKey),
    endorsements: [],
  });
}

/** A preproduction venue naming Cloud's venue and stream ids, with the source as serving primary. */
export async function seedEmergencyCopySource(db: Database): Promise<void> {
  await seedVenue(db, { invoiceLocales: ["en"] });
  await db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await withTransaction(db, (tx) => saveVenueFields(tx, { cloudVenueId: venueId, streamId }, null));
  await db.insert(nodes).values({ id: sourceId, name: "Main", publicKey: source.publicKey });
  await writeChart(db, sourceId);
}

export function bindingFor(
  databaseSha256: string,
  overrides: Partial<EmergencyCopyBinding> = {},
  stream: Partial<EmergencyCopyBinding["selectedStream"]> = {},
): EmergencyCopyBinding {
  return {
    copyOperationId: "e7000000-0000-4000-8000-000000000009",
    venueId,
    environment: "preproduction",
    sourceNodeId: sourceId,
    sourceInstallationId: "source-installation",
    copyNodeId: copyId,
    installationId: "copy-installation",
    selectedStream: {
      streamId,
      generation: generationName(3, sourceId, new Date("2026-11-17T10:00:00Z")),
      databaseSha256,
      ...stream,
    },
    startedAt: "2026-11-17T10:00:00.000Z",
    expiresAt: "2026-11-17T10:30:00.000Z",
    ...overrides,
  };
}
