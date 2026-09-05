import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { MembershipNode, SignedMembershipDocument } from "@waitron/membership";
import { mountNodeApi } from "./node-api.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

const NODE = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

function doc(nodes: readonly MembershipNode[], term = 3): SignedMembershipDocument {
  return signedMembershipDoc(term, { signerNodeId: NODE, nodes });
}

function mount(overrides: Partial<Parameters<typeof mountNodeApi>[1]> = {}): Hono {
  const app = new Hono();
  mountNodeApi(app, {
    nodeId: NODE,
    acceptingSales: true,
    environment: "preproduction",
    readMembership: () =>
      Promise.resolve(
        doc([{ nodeId: NODE, contactUrl: "https://box.deli.test", standing: "serving-primary" }]),
      ),
    ...overrides,
  });
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

  it("sends no-store so a probe is never cached", async () => {
    const res = await mount().request("/api/node");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
