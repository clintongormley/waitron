import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { invoiceSeries, openVenueDatabase, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { completeAccountAction, persons, queueAccountMail } from "@waitron/identity";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { formatEnvFile } from "./env-file.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { runOnce } from "./backup-sweep.js";
import { restoreFromArtifactFile } from "./restore.js";
import { accountActionMail } from "./account-mail.js";
import { runMailPass } from "./mail-sender.js";

describe("queued account mail after a real backup and restore", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  it("expires the old reset and sends the still-valid invitation with a working link", async () => {
    await seedVenue(suite.db);
    const nodeId = await seedNode(suite.db);
    await suite.db.insert(invoiceSeries).values([
      { nodeId, code: "FA" },
      { nodeId, code: "FF", purpose: "full" },
    ]);
    const [admin, invited] = await suite.db
      .insert(persons)
      .values([
        { displayName: "Inviter", email: "reset@example.test", role: "admin", status: "active" },
        { displayName: "Invited", email: "invite@example.test", status: "pending" },
      ])
      .returning({ id: persons.id });
    const time = new Date("2026-11-09T12:00:00Z");
    await withTransaction(suite.db, async (tx) => {
      await queueAccountMail(tx, {
        personId: admin!.id,
        purpose: "password_reset",
        origin: "https://entry.test",
        now: time,
      });
      await queueAccountMail(tx, {
        personId: invited!.id,
        purpose: "invitation",
        requestedBy: admin!.id,
        origin: "https://entry.test",
        now: time,
      });
    });
    const root = await mkdtemp(join(tmpdir(), "account-mail-restore-"));
    try {
      const stateDir = join(root, "source-state");
      for (const path of RECOVERY_FILES) {
        const value =
          path === "trading.env"
            ? formatEnvFile({ WAITRON_NODE_ID: nodeId, WAITRON_ENV: "preproduction" })
            : path === "secrets.env"
              ? formatEnvFile({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 17).toString("base64") })
              : `synthetic ${path}`;
        await mkdir(dirname(join(stateDir, path)), { recursive: true });
        await writeFile(join(stateDir, path), value);
      }
      const backend = new LocalFsBackend("mail", join(root, "archives"));
      const signal = new AbortController().signal;
      await runOnce({
        backends: [backend],
        db: suite.db,
        node: suite.node,
        modules: ALL_MODULES,
        environment: "preproduction",
        resolvers: {},
        stateDir,
        recoveryKey: "synthetic-mail-restore-key",
        stagingDir: join(root, "scratch/backup"),
        retain: 1,
        retainDays: 1,
        destinationTimeoutMs: 60000,
        signal,
        log: () => {},
        archive: (path) => suite.db.archiveTo(path),
        now: () => time,
      });
      const archives = await backend.list("waitron-", { signal });
      expect(archives).toHaveLength(1);
      const artifactPath = join(root, "mail.wtb");
      await backend.getFile(archives[0]!.key, artifactPath, { signal });
      const venueDir = join(root, "restored-venue");
      await restoreFromArtifactFile({
        artifactPath,
        recoveryKey: "synthetic-mail-restore-key",
        venueDir,
        stateDir: join(root, "restored-state"),
        stagingDir: join(root, "scratch/restore"),
        migrationsRoot: null,
        modules: ALL_MODULES,
        environment: "preproduction",
        log: () => {},
      });
      const restored = await openVenueDatabase(venueDir);
      try {
        const messages: Array<{ to: string; text: string }> = [];
        const now = new Date("2026-11-09T13:00:00Z");
        await runMailPass({
          db: restored.venue,
          owners: [
            accountActionMail({
              emailChangeUrl: "https://entry.test",
              venueLocale: "en-GB",
              readTimeZone: async () => "UTC",
              readPrivacyNoticeUrl: async () => null,
            }),
          ],
          now: () => now,
          isPrimary: () => true,
          signal,
          log: () => {},
          resolveDelivery: async () => ({
            mode: "smtp",
            smtp: { url: "smtp://test", from: "venue@example.test" },
          }),
          send: async (_, message) => {
            messages.push({ to: String(message.to), text: String(message.text) });
            return { status: "sent" };
          },
        });
        expect(messages.map(({ to }) => to)).toEqual(["invite@example.test"]);
        expect(
          restored.venue.all(
            sql`select person_id, requested_by, status from outgoing_mail order by seq`,
          ),
        ).toEqual([
          { person_id: admin!.id, requested_by: null, status: "expired" },
          { person_id: invited!.id, requested_by: admin!.id, status: "sent" },
        ]);
        const link = new URL(
          messages[0]!.text.split("\n").find((line) => line.startsWith("https://"))!,
        );
        expect(link.origin).toBe("https://entry.test");
        expect(
          await withTransaction(restored.venue, (tx) =>
            completeAccountAction(tx, {
              token: link.searchParams.get("token")!,
              purpose: "invitation",
              password: "a replacement password",
              pin: "1357",
              now,
            }),
          ),
        ).toMatchObject({ personId: invited!.id });
      } finally {
        await restored.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
