import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { authenticatePeer, enrolPeer, listPeers, revokePeer } from "./peers.js";

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
      // Assert the CODE, not just that it is an AppError: the oracle-free contract requires a revoked
      // peer to fold into the SAME sync.node_unauthorized as every other failure (Copilot #144).
      await expect(authenticatePeer(tailer, token)).rejects.toMatchObject({
        code: "sync.node_unauthorized",
      });
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

  it("skips the sighting write within the gate window (no redundant round-trip)", async () => {
    // Proves the `sighting_due` gate SKIPS the UPDATE on a second auth inside the minute: if it did
    // not, the second auth would re-stamp last_seen_at to a later now(), so equality is the guard.
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const { peerId, token } = await enrolPeer(pruner, { subscriberId: "cloud", name: "m" });
      const readSeen = async (): Promise<string> => {
        const r = await pruner.execute<{ seen: string }>(
          sql`select last_seen_at::text as seen from sync_peers where id = ${peerId}::uuid`,
        );
        return r.rows[0]!.seen;
      };
      await authenticatePeer(tailer, token);
      const first = await readSeen();
      await authenticatePeer(tailer, token);
      expect(await readSeen()).toBe(first); // unchanged — the second sighting was gated out
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });
});

describe("revokePeer + listPeers + rotation", () => {
  it("revoke flips active and is idempotent; rotation keeps a second token working", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const a = await enrolPeer(pruner, { subscriberId: "cloud", name: "token-1" });
      const b = await enrolPeer(pruner, { subscriberId: "cloud", name: "token-2" }); // rotation overlap
      const first = await revokePeer(pruner, a.peerId);
      expect(first.revoked).toBe(true);
      const again = await revokePeer(pruner, a.peerId);
      expect(again.revoked).toBe(false); // already revoked
      const unknown = await revokePeer(pruner, "11111111-1111-4111-8111-111111111111");
      expect(unknown.revoked).toBe(false);
      const nonUuid = await revokePeer(pruner, "not-a-uuid"); // short-circuits, matches nothing
      expect(nonUuid.revoked).toBe(false);
      // the revoked token is refused, the rotated-in one still authenticates
      await expect(authenticatePeer(tailer, a.token)).rejects.toMatchObject({
        code: "sync.node_unauthorized",
      });
      expect((await authenticatePeer(tailer, b.token)).subscriberId).toBe("cloud");
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });

  it("listPeers reports summaries without the hash", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      const { peerId } = await enrolPeer(pruner, { subscriberId: "cloud", name: "DR" });
      const peers = await listPeers(pruner);
      const found = peers.find((p) => p.peerId === peerId);
      expect(found).toMatchObject({ subscriberId: "cloud", name: "DR", active: true });
      expect(JSON.stringify(peers)).not.toMatch(/token_hash|tokenHash/);
    } finally {
      await pruner.close();
    }
  });
});
