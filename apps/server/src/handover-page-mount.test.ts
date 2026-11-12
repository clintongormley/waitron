import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeAll, afterAll, expect, it } from "vitest";
import { CORE_MIGRATIONS, withNodeTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS, setNodeModeTx } from "@waitron/node-db";
import { beginHandover } from "./handover-store.js";
import { mountHandoverPage } from "./handover-page-mount.js";
import { mountSpa } from "./spa-api.js";
import { spareReadGate } from "./spare-read-gate.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SOURCE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
let root: string | undefined;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "waitron-handover-page-"));
  await mkdir(join(root, "assets"));
  await writeFile(
    join(root, "index.html"),
    '<html><script src="./assets/app-123.js"></script></html>',
  );
  await writeFile(join(root, "assets/app-123.js"), "// handover application");
  await writeFile(join(root, "favicon.svg"), "<svg></svg>");
});
afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});
async function build(mirror = false) {
  if (mirror) await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, NODE, "mirror"));
  await beginHandover(
    { node: suite.node, nodeId: NODE },
    {
      operationId: OP,
      scenario: "controlled",
      venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
      sourceNodeId: SOURCE,
      destinationNodeId: NODE,
      membership: { term: 3, digest: "a".repeat(64) },
    },
    "destination",
  );
  const app = new Hono();
  if (mirror) app.use("*", spareReadGate());
  mountHandoverPage(app, { root: root!, node: suite.node, nodeId: NODE }, () => {});
  mountSpa(app, { root: root!, basePath: "", navigationPath: "/tabs" }, () => {});
  return app;
}
it.each([false, true])(
  "serves the operation page before the till catch-all, mirror %s",
  async (mirror) => {
    const app = await build(mirror);
    const answer = await app.request(`/handover/${OP}`, { headers: { Accept: "text/html" } });
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-cache");
    expect(await answer.text()).toContain("./assets/app-123.js");
    expect(await (await app.request("/handover/assets/app-123.js")).text()).toBe(
      "// handover application",
    );
    expect(await (await app.request("/handover/favicon.svg")).text()).toBe("<svg></svg>");
    expect(
      (await app.request(`/handover/${OP}/private`, { headers: { Accept: "text/html" } })).status,
    ).not.toBe(200);
  },
);
it("keeps unknown operations and missing assets as 404s", async () => {
  const app = await build();
  for (const path of ["/handover/unknown", "/handover", "/handover/assets/missing.js"]) {
    expect((await app.request(path, { headers: { Accept: "text/html" } })).status).toBe(404);
  }
});
it("redirects the trailing slash to the canonical page so relative assets resolve", async () => {
  const app = await build();
  const answer = await app.request(`/handover/${OP}/`, { headers: { Accept: "text/html" } });
  expect(answer.status).toBe(302);
  expect(answer.headers.get("location")).toBe(`/handover/${OP}`);
});

it("serves the literal emergency page only on a mirror, before operation lookup", async () => {
  const app = await build(true);
  const answer = await app.request("/handover/emergency", { headers: { Accept: "text/html" } });
  expect(answer.status).toBe(200);
  expect(await answer.text()).toContain("./assets/app-123.js");
  const slash = await app.request("/handover/emergency/");
  expect(slash.status).toBe(302);
  expect(slash.headers.get("location")).toBe("/handover/emergency");
  await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, NODE, "primary"));
  expect((await app.request("/handover/emergency")).status).toBe(404);
  expect((await app.request(`/handover/${OP}`, { headers: { Accept: "text/html" } })).status).toBe(
    200,
  );
});
