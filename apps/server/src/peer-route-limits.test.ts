import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { signEnvelope } from "@waitron/handover";
import { generateNodeKeyPair } from "@waitron/membership";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { PEER_ROUTES } from "../test/peer-route-inventory.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { mountNodeApi } from "./node-api.js";
import { mountNodeEnrolApi } from "./node-enrol-api.js";
import { mountNodeMembershipApi } from "./node-membership-api.js";
import { mountHandoverStatusApi } from "./handover-status-api.js";
import { mountHandoverSourceApi } from "./handover-source-api.js";
import { mountHandoverDestinationApi } from "./handover-destination-api.js";
import { mountHandoverSourceStartApi } from "./handover-source-start-api.js";
import { mountHandoverPreparationApi } from "./handover-preparation.js";
import { mountHandoverActivationApi } from "./handover-activation.js";
import { mountHandoverEmergencyApi } from "./handover-emergency-api.js";
import { mountSpareSettingsApi } from "./spare-settings-api.js";
import { mountReturnRecordsApi } from "./return-records-api.js";
import { mountPromoteApi } from "./promote-api.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import type { Logger } from "./logger.js";

function mounted() {
  const app = new Hono();
  let armed = false;
  let reads = 0;
  function mount<D>(fn: (app: Hono, deps: D, log: Logger) => unknown) {
    const deps = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === "isMirror") return false;
          if (armed) {
            reads++;
            throw new Error("handler reached a dependency");
          }
          return undefined;
        },
      },
    ) as D;
    fn(app, deps, () => {});
  }
  mount(mountPeerStatusApi);
  mount(mountNodeApi);
  mount(mountNodeEnrolApi);
  mount(mountNodeMembershipApi);
  mount(mountHandoverStatusApi);
  mount(mountHandoverSourceApi);
  mount(mountHandoverDestinationApi);
  mount(mountHandoverSourceStartApi);
  mount(mountHandoverPreparationApi);
  mount(mountHandoverActivationApi);
  mount(mountHandoverEmergencyApi);
  mount(mountSpareSettingsApi);
  mount(mountReturnRecordsApi);
  mount(mountPromoteApi);
  mount(mountMirrorBundleApi);
  armed = true;
  return { app, reads: () => reads };
}

const pathOf = (path: string) =>
  path.replace(":operationId", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const limited = PEER_ROUTES.filter(
  (row): row is readonly [string, string, number] => row[2] !== null,
);

function streamed(
  app: Hono,
  path: string,
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
) {
  return app.request(
    new Request(`https://box.test${pathOf(path)}`, {
      method: "POST",
      headers,
      body: new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            const chunk = chunks.shift();
            if (chunk) controller.enqueue(chunk);
            else controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: "half",
    } as RequestInit),
  );
}

describe("peer route request limits", () => {
  it("allows a signed return envelope around a 256 KiB module payload", async () => {
    const { app, reads } = mounted();
    const key = generateNodeKeyPair();
    const body = JSON.stringify(
      signEnvelope(
        "return-batch",
        {
          sourceNodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          destinationNodeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          payload: { data: "x".repeat(262133) },
        },
        { nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", privateKey: key.privateKey },
      ),
    );
    expect(Buffer.byteLength(body)).toBeGreaterThan(262144);
    const response = await streamed(app, "/api/node/return-records", [
      new TextEncoder().encode(body),
    ]);
    expect(response.status).not.toBe(413);
    expect(reads()).toBeGreaterThan(0);
  });

  it("keeps the emergency upload's own budget instead of a control-message cap", async () => {
    const app = new Hono();
    mountHandoverEmergencyApi(app, { backup: { uploadLimit: 2 * 1024 * 1024 } } as Parameters<
      typeof mountHandoverEmergencyApi
    >[1]);
    const socket = new TLSSocket(new Socket());
    try {
      for (const [bytes, field] of [
        [1048577, "body"],
        [3 * 1024 * 1024, "artifact"],
      ] as const) {
        const response = await app.request(
          "https://box.test/api/node/handover/emergency/backup",
          {
            method: "POST",
            headers: {
              origin: "https://box.test",
              "content-type": "multipart/form-data; boundary=missing",
              "content-length": String(bytes),
            },
            body: bytes === 1048577 ? "x".repeat(bytes) : "",
          },
          { incoming: { socket } },
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: { code: "setup.request_invalid", params: { field } },
        });
      }
    } finally {
      socket.destroy();
    }
  });

  it("classifies every route the actual mounts register", () => {
    const { app } = mounted();
    const registered = [
      ...new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`)),
    ].sort();
    expect(registered).toEqual(PEER_ROUTES.map(([method, path]) => `${method} ${path}`).sort());
  });

  it.each(limited)(
    "%s %s refuses declared oversize before dependencies",
    async (_method, path, max) => {
      const { app, reads } = mounted();
      const response = await streamed(app, path, [], { "content-length": String(max + 1) });
      expect(response.status).toBe(413);
      expect(reads()).toBe(0);
      expect(await response.json()).toEqual(
        path.endsWith("backup-settings")
          ? { error: { code: "spare.settings_invalid", params: { reason: "size" } } }
          : {
              error: {
                code:
                  path.startsWith("/management-api/promote") || path.endsWith("mirror-bundle")
                    ? "management.request_invalid"
                    : "handover.request_invalid",
                params: { field: "body" },
              },
            },
      );
    },
  );

  it.each(limited)(
    "%s %s counts streamed bytes and permits its boundary",
    async (_method, path, max) => {
      const { app, reads } = mounted();
      const overflow = await streamed(app, path, [new Uint8Array(max), new Uint8Array(1)]);
      expect(overflow.status).toBe(413);
      expect(reads()).toBe(0);
      const atLimit = await streamed(app, path, [
        new TextEncoder().encode(" ".repeat(max - 2) + "{}"),
      ]);
      expect(atLimit.status).not.toBe(413);
      expect(atLimit.status).not.toBe(404);
    },
  );
});
