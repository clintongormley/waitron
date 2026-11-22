import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { MembershipNode, SignedMembershipDocument } from "@waitron/membership";
import { mountMainServerApi, mountNodeApi } from "./node-api.js";
import type { Logger, LogLevel } from "./logger.js";
import type { MainSilenceState } from "./main-silence-watch.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

const NODE = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

function doc(nodes: readonly MembershipNode[], term = 3): SignedMembershipDocument {
  return signedMembershipDoc(term, { signerNodeId: NODE, nodes });
}

function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

function mount(
  overrides: Partial<Parameters<typeof mountNodeApi>[1]> = {},
  log: Logger = collect([]),
): Hono {
  const app = new Hono();
  mountNodeApi(
    app,
    {
      nodeId: NODE,
      acceptingSales: true,
      environment: "preproduction",
      readMembership: () =>
        Promise.resolve(
          doc([{ nodeId: NODE, contactUrl: "https://box.deli.test", standing: "serving-primary" }]),
        ),
      ...overrides,
    },
    log,
  );
  return app;
}

describe("GET /api/node", () => {
  it("answers this node's id, term, standing, acceptingSales and environment", async () => {
    const res = await mount().request("/api/node");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      nodeId: NODE,
      term: 3,
      standing: "serving-primary",
      acceptingSales: true,
      environment: "preproduction",
    });
  });

  it("answers acceptingSales:false verbatim from the boot-captured flag", async () => {
    const res = await mount({ acceptingSales: false }).request("/api/node");
    expect(((await res.json()) as { acceptingSales: boolean }).acceptingSales).toBe(false);
  });

  it("answers null term/standing when no document is held or this node is not listed", async () => {
    const none = await mount({ readMembership: () => Promise.resolve(null) }).request("/api/node");
    expect(await none.json()).toMatchObject({ term: null, standing: null });
    const unlisted = await mount({
      readMembership: () =>
        Promise.resolve(doc([{ nodeId: OTHER, contactUrl: "", standing: "serving-primary" }])),
    }).request("/api/node");
    expect(await unlisted.json()).toMatchObject({ term: 3, standing: null });
  });

  it("answers the opaque server.internal 500 and logs under node.failed when the read throws", async () => {
    // `node.failed` is the boundary's log tag, not a wire code; the driver's message reaches
    // neither.
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    const res = await mount(
      { readMembership: () => Promise.reject(new Error("connection terminated: pw=hunter2")) },
      collect(lines),
    ).request("/api/node");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "server.internal" } });
    expect(lines).toEqual([
      {
        level: "error",
        event: "node.failed",
        fields: { errorCode: "unknown", requestId: undefined },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain("hunter2");
  });

  it("sends no-store so a probe is never cached", async () => {
    const res = await mount().request("/api/node");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/node/main", () => {
  function mountMain(held: SignedMembershipDocument | null): Hono {
    const app = new Hono();
    mountMainServerApi(app, { readMembership: () => Promise.resolve(held) }, collect([]));
    return app;
  }

  it("answers the held chart's serving primary's contact address", async () => {
    const res = await mountMain(
      doc([
        {
          nodeId: NODE,
          contactUrl: "https://box-3333.waitron.local",
          standing: "serving-secondary",
        },
        {
          nodeId: OTHER,
          contactUrl: "https://box-aaaa.waitron.local",
          standing: "serving-primary",
        },
      ]),
    ).request("/api/node/main");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      mainUrl: "https://box-aaaa.waitron.local",
      silentForMs: null,
    });
  });

  it("answers null with no chart, or a chart naming no serving primary", async () => {
    expect(await (await mountMain(null).request("/api/node/main")).json()).toEqual({
      mainUrl: null,
      silentForMs: null,
    });
    const none = doc([
      { nodeId: NODE, contactUrl: "https://box-3333.waitron.local", standing: "serving-secondary" },
    ]);
    expect(await (await mountMain(none).request("/api/node/main")).json()).toEqual({
      mainUrl: null,
      silentForMs: null,
    });
  });

  it("answers how long the spare has found the main box silent, by the spare's clock", async () => {
    const answer = async (main: MainSilenceState | undefined) => {
      const app = new Hono();
      mountMainServerApi(
        app,
        { readMembership: () => Promise.resolve(null), main: () => main, now: () => 50_000 },
        collect([]),
      );
      return (await app.request("/api/node/main")).json();
    };
    expect(await answer({ silent: true, silentSinceMs: 20_000, reached: true })).toEqual({
      mainUrl: null,
      silentForMs: 30_000,
    });
    expect(await answer({ silent: false, silentSinceMs: 45_000, reached: true })).toEqual({
      mainUrl: null,
      silentForMs: 5_000,
    });
    expect(await answer({ silent: false, silentSinceMs: null, reached: true })).toEqual({
      mainUrl: null,
      silentForMs: null,
    });
    expect(await answer(undefined)).toEqual({ mainUrl: null, silentForMs: null });
  });
});
