import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { authenticatePeer, enrolPeer } from "./peers.js";

const postgres = useTemplateDb({ template: "manifest" });

describe("enrolPeer + authenticatePeer", () => {
  it("mints a token that authenticates to its subscriberId", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const { peerId, token } = await enrolPeer(pruner, {
        subscriberId: "cloud",
        name: "DR mirror",
      });
      expect(token.startsWith(`${peerId}.`)).toBe(true);
      const { subscriberId } = await authenticatePeer(tailer, token);
      expect(subscriberId).toBe("cloud");
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });

  it("folds every bad token into one sync.node_unauthorized (no oracle)", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const { peerId, token } = await enrolPeer(pruner, { subscriberId: "cloud", name: "m" });
      const bad = [
        "",
        "no-dot",
        ".",
        `${peerId}.`,
        "not-a-uuid.secret",
        `${peerId}.wrongsecret`,
        "11111111-1111-4111-8111-111111111111.x", // unknown peer, valid uuid
        `${token.slice(0, token.indexOf("."))}.${"a".repeat(43)}`, // right selector, wrong secret
      ];
      for (const t of bad) {
        await expect(authenticatePeer(tailer, t)).rejects.toMatchObject({
          code: "sync.node_unauthorized",
        });
      }
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });

  it("refuses a revoked peer instantly", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const { peerId, token } = await enrolPeer(pruner, { subscriberId: "cloud", name: "m" });
      await pruner.execute(sql`update sync_peers set active = false where id = ${peerId}::uuid`);
      await expect(authenticatePeer(tailer, token)).rejects.toBeInstanceOf(AppError);
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });

  it("records last_seen_at on first auth", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const { peerId, token } = await enrolPeer(pruner, { subscriberId: "cloud", name: "m" });
      await authenticatePeer(tailer, token);
      const r = await pruner.execute<{ last_seen_at: string | null }>(
        sql`select last_seen_at from sync_peers where id = ${peerId}::uuid`,
      );
      expect(r.rows[0]!.last_seen_at).not.toBeNull();
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });
});
