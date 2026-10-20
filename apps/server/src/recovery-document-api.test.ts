import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  readBreakGlassVerifier,
  readBreakGlassKeyName,
  nodeRoles,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  IDENTITY_MIGRATIONS,
  persons,
  startManagementSession,
  verifySecretAsync,
} from "@waitron/identity";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { nodeId, locationId } from "@waitron/shared";
import { mintBreakGlassSecret } from "./break-glass.js";
import { mountRecoveryPackApi } from "./recovery-pack-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const node = {
  nodeId: nodeId("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  locationId: locationId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
};
let token: string;
let oldKey: string;
const sockets: TLSSocket[] = [];
const logs: unknown[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});
beforeEach(async () => {
  logs.length = 0;
  await stampDeployment(suite.db, "preproduction");
  oldKey = await mintBreakGlassSecret(suite.db, node.nodeId);
  token = await withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Owner", role: "manager", pinHash: "unused", passwordHash: "unused" })
      .returning();
    return (await startManagementSession(tx, { personId: person!.id })).token;
  });
});

function fixture(
  options: {
    evidence?: () => Promise<Record<string, unknown>>;
    providers?: number;
    render?: (key: {
      nodeId: string;
      name: string;
      secret: string;
    }) => Promise<Uint8Array<ArrayBuffer>>;
  } = {},
) {
  const app = new Hono();
  let delivered: { nodeId: string; name: string; secret: string } | undefined;
  let renders = 0;
  const module = {
    ...fakeModule("test-regime"),
    backup: {
      async recoveryDocument(
        _tx: unknown,
        _node: unknown,
        context: { nodeKey: NonNullable<typeof delivered> },
      ) {
        renders++;
        delivered = context.nodeKey;
        return options.render
          ? options.render(context.nodeKey)
          : new TextEncoder().encode(`%PDF-synthetic-${context.nodeKey.name}`);
      },
    },
  };
  mountRecoveryPackApi(
    app,
    {
      db: suite.db,
      node,
      venueId: "venue-one",
      modules: Array.from({ length: options.providers ?? 1 }, () => module),
      now: () => new Date("2026-10-18T12:00:00.000Z"),
      documentEvidence: options.evidence ?? (async () => ({})),
    },
    (...values) => logs.push(values),
  );
  function post(
    action: string,
    body: unknown,
    session = token,
    extra: Record<string, string> = {},
    tls = true,
  ) {
    const socket = tls ? new TLSSocket(new Socket()) : undefined;
    if (socket) sockets.push(socket);
    return app.request(
      `https://box.test/api/box/recovery-document/${action}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `waitron_management_session=${session}`,
          ...extra,
        },
        body: JSON.stringify(body),
      },
      socket ? { incoming: { socket } } : undefined,
    );
  }
  return {
    post,
    get delivered() {
      return delivered;
    },
    get renders() {
      return renders;
    },
  };
}

it("a manager replaces a lost node key and reprints the identical retained document without another rotation", async () => {
  const f = fixture();
  const response = await f.post("reissue", { locale: "en" });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const id = response.headers.get("x-waitron-recovery-document");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  const bytes = await response.arrayBuffer();
  const verifier = await readBreakGlassVerifier(suite.db, node.nodeId);
  expect(await readBreakGlassKeyName(suite.db, node.nodeId)).toBe(f.delivered!.name);
  expect(await verifySecretAsync(f.delivered!.secret, verifier!)).toBe(true);
  expect(await verifySecretAsync(oldKey, verifier!)).toBe(false);
  expect(f.delivered!.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
  const again = await f.post("download", { documentId: id });
  expect(again.status).toBe(200);
  expect(await again.arrayBuffer()).toEqual(bytes);
  expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(verifier);
  expect(f.renders).toBe(1);
  expect(JSON.stringify(logs)).not.toContain(f.delivered!.secret);
  expect(JSON.stringify(logs)).not.toContain(token);
});

it("refuses key creation when the completed node has no retained verifier", async () => {
  await suite.db
    .update(nodeRoles)
    .set({ breakGlassVerifier: null })
    .where(eq(nodeRoles.nodeId, node.nodeId));
  const f = fixture();
  const response = await f.post("reissue", { locale: "en" });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "recovery.pack_invalid", params: { reason: "key_missing" } },
  });
  expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBeNull();
  expect(f.renders).toBe(0);
});

it.each(["HTTP", "forwarded HTTPS", "foreign origin", "cross site", "foreign site"])(
  "refuses %s before rotating or rendering a key",
  async (fault) => {
    const f = fixture();
    const before = await readBreakGlassVerifier(suite.db, node.nodeId);
    const extra: Record<string, string> =
      fault === "forwarded HTTPS"
        ? { "X-Forwarded-Proto": "https" }
        : fault === "foreign origin"
          ? { Origin: "https://attacker.test" }
          : fault === "cross site"
            ? { "Sec-Fetch-Site": "cross-site" }
            : fault === "foreign site"
              ? { "Sec-Fetch-Site": "same-site" }
              : {};
    const response = await f.post(
      "reissue",
      { locale: "en" },
      token,
      extra,
      !["HTTP", "forwarded HTTPS"].includes(fault),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "system.manage" } },
    });
    expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(before);
    expect(f.renders).toBe(0);
  },
);
it.each(["unknown", "staff", "suspended"])(
  "refuses the %s session before rendering or rotating a key",
  async (who) => {
    const selected =
      who === "unknown"
        ? "unknown"
        : await withTransaction(suite.db, async (tx) => {
            const [person] = await tx
              .insert(persons)
              .values({
                displayName: who,
                role: who === "staff" ? "staff" : "manager",
                pinHash: "unused",
                passwordHash: "unused",
              })
              .returning();
            const session = await startManagementSession(tx, { personId: person!.id });
            if (who === "suspended")
              await tx
                .update(persons)
                .set({ status: "suspended" })
                .where(eq(persons.id, person!.id));
            return session.token;
          });
    const f = fixture();
    const before = await readBreakGlassVerifier(suite.db, node.nodeId);
    for (const [action, body] of [
      ["reissue", { locale: "en" }],
      ["download", { documentId: "absent" }],
    ] as const) {
      const response = await f.post(action, body, selected);
      expect(response.status).toBe(who === "unknown" ? 401 : 403);
      expect((await response.json()).error.code).toBe(
        who === "unknown"
          ? "management_session.required"
          : who === "staff"
            ? "authorization.not_permitted"
            : "person.suspended",
      );
    }
    expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(before);
    expect(f.renders).toBe(0);
  },
);
it.each([
  {},
  { locale: null },
  { locale: ["en"] },
  { locale: "fr" },
  { locale: "en", secret: "unwanted" },
])("refuses malformed reissue %j without rotating a key", async (body) => {
  const f = fixture();
  const before = await readBreakGlassVerifier(suite.db, node.nodeId);
  const response = await f.post("reissue", body);
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("recovery.pack_invalid");
  expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(before);
  expect(f.renders).toBe(0);
});
it("rechecks management permission after outside evidence is read", async () => {
  const f = fixture({
    evidence: async () => {
      await suite.db.update(persons).set({ role: "staff" });
      return {};
    },
  });
  const before = await readBreakGlassVerifier(suite.db, node.nodeId);
  const response = await f.post("reissue", { locale: "en" });
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("authorization.not_permitted");
  expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(before);
  expect(f.renders).toBe(0);
});
it.each(["throw", "empty", "oversize"])(
  "a %s rendering failure leaves the current key and previous document usable",
  async (fault) => {
    let fail = false;
    const f = fixture({
      render: async (key) => {
        if (!fail) return new TextEncoder().encode("%PDF-retained");
        if (fault === "throw") throw new Error(key.secret);
        return new Uint8Array(fault === "empty" ? 0 : 8 * 1024 * 1024 + 1);
      },
    });
    const first = await f.post("reissue", { locale: "en" });
    expect(first.status).toBe(200);
    const id = first.headers.get("x-waitron-recovery-document");
    const before = await readBreakGlassVerifier(suite.db, node.nodeId);
    fail = true;
    const response = await f.post("reissue", { locale: "es" });
    expect(response.status).toBe(fault === "throw" ? 500 : 400);
    expect((await response.json()).error.code).toBe(
      fault === "throw" ? "server.internal" : "recovery.pack_invalid",
    );
    expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(before);
    const repeat = await f.post("download", { documentId: id });
    expect(repeat.status).toBe(200);
    expect(await repeat.text()).toBe("%PDF-retained");
    expect(JSON.stringify(logs)).not.toContain(f.delivered!.secret);
  },
);
it("replacing a key retires old download grants and does not change a saved verifier snapshot", async () => {
  const f = fixture();
  const oldVerifier = await readBreakGlassVerifier(suite.db, node.nodeId);
  const first = await f.post("reissue", { locale: "en" });
  const firstId = first.headers.get("x-waitron-recovery-document");
  const firstKey = f.delivered!.secret;
  const second = await f.post("reissue", { locale: "es" });
  expect(second.status).toBe(200);
  const response = await f.post("download", { documentId: firstId });
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("recovery.pack_invalid");
  expect(await verifySecretAsync(oldKey, oldVerifier!)).toBe(true);
  expect(await verifySecretAsync(firstKey, oldVerifier!)).toBe(false);
  expect(await verifySecretAsync(f.delivered!.secret, oldVerifier!)).toBe(false);
});
it("a restart loses retained PDF access rather than rotating a key during download", async () => {
  const f = fixture();
  const response = await f.post("reissue", { locale: "en" });
  const verifier = await readBreakGlassVerifier(suite.db, node.nodeId);
  const restarted = fixture();
  const lost = await restarted.post("download", {
    documentId: response.headers.get("x-waitron-recovery-document"),
  });
  expect(lost.status).toBe(400);
  expect((await lost.json()).error.code).toBe("recovery.pack_invalid");
  expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(verifier);
  expect(restarted.renders).toBe(0);
});
it("an outside key rotation revokes the retained PDF", async () => {
  const f = fixture();
  const response = await f.post("reissue", { locale: "en" });
  const key = await mintBreakGlassSecret(suite.db, node.nodeId);
  const verifier = await readBreakGlassVerifier(suite.db, node.nodeId);
  for (let n = 0; n < 2; n++) {
    const lost = await f.post("download", {
      documentId: response.headers.get("x-waitron-recovery-document"),
    });
    expect(lost.status).toBe(400);
    expect((await lost.json()).error.code).toBe("recovery.pack_invalid");
  }
  expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(verifier);
  expect(await verifySecretAsync(key, verifier!)).toBe(true);
  expect(f.renders).toBe(1);
});

it.each([0, 2])(
  "refuses %s document providers without replacing the node key",
  async (providers) => {
    const f = fixture({ providers });
    const before = await readBreakGlassVerifier(suite.db, node.nodeId);
    const response = await f.post("reissue", { locale: "en" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "recovery.pack_invalid", params: { reason: "module_unsupported" } },
    });
    expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(before);
    expect(f.renders).toBe(0);
  },
);
it("only accepts JSON requests before replacing a key", async () => {
  const f = fixture();
  const before = await readBreakGlassVerifier(suite.db, node.nodeId);
  const response = await f.post("reissue", { locale: "en" }, token, {
    "Content-Type": "text/plain",
  });
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("recovery.pack_invalid");
  expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(before);
  expect(f.renders).toBe(0);
});
it.each([{}, { documentId: null }, { documentId: "missing" }, { documentId: "id", extra: 1 }])(
  "refuses missing or malformed retained download %j",
  async (body) => {
    const f = fixture();
    const before = await readBreakGlassVerifier(suite.db, node.nodeId);
    const response = await f.post("download", body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("recovery.pack_invalid");
    expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(before);
    expect(f.renders).toBe(0);
  },
);
it("serialises concurrent key replacements so only the latest PDF grant remains usable", async () => {
  let active = 0,
    peak = 0;
  const f = fixture({
    evidence: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return {};
    },
  });
  const replies = await Promise.all([
    f.post("reissue", { locale: "en" }),
    f.post("reissue", { locale: "es" }),
  ]);
  expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
  expect(peak).toBe(1);
  const grants = await Promise.all(
    replies.map((reply) =>
      f.post("download", { documentId: reply.headers.get("x-waitron-recovery-document") }),
    ),
  );
  expect(grants.map((reply) => reply.status)).toEqual([400, 200]);
  expect(
    await verifySecretAsync(
      f.delivered!.secret,
      (await readBreakGlassVerifier(suite.db, node.nodeId))!,
    ),
  ).toBe(true);
});

it("refuses staff before reading potentially damaged recovery evidence", async () => {
  const f = fixture({
    evidence: async () => {
      throw new Error("private damaged evidence");
    },
  });
  await suite.db.update(persons).set({ role: "staff" });
  const before = await readBreakGlassVerifier(suite.db, node.nodeId);
  const response = await f.post("reissue", { locale: "en" });
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("authorization.not_permitted");
  expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(before);
});
