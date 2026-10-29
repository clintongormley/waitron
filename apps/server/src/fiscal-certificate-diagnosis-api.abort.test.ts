import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { connect, type AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu/src/slot.js";
import {
  authority,
  NOW,
  parentFixture,
} from "@waitron/fiscal-verifactu/test/certificate-diagnosis-parent-fixtures.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { SIN_DATOS_BODY } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { startDiagnosticServer } from "@waitron/fiscal-verifactu/test/certificate-diagnosis-fixtures.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountFiscalCertificateApi } from "./fiscal-certificate-api.js";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";
import {
  diagnosisChildFixture,
  diagnosisSnapshot,
} from "./testing/certificate-diagnosis-snapshot.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let child: Awaited<ReturnType<typeof diagnosisChildFixture>> | undefined;
beforeAll(async () => {
  child = await diagnosisChildFixture();
}, 100_000);
afterAll(async () => {
  await child?.close();
});
const path = "/management-api/fiscal-certificate/diagnose";

describe("diagnosis HTTP disconnect and admission", () => {
  it.each(["opening", "body", "cleanup"] as const)(
    "disconnect after a complete POST during %s stops the child before admitting another attempt",
    async (phase) => {
      const f = await parentFixture(suite.db);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const endpoint = await startDiagnosticServer(authority, (_request, response) => {
        void (phase === "body" ? hold : Promise.resolve()).then(() => {
          response.writeHead(200);
          response.end(SIN_DATOS_BODY);
        });
      });
      const marker = join(child!.root, `abort-${phase}`);
      const runner = createCertificateDiagnosisRunner({
        fiscalId: "fixture",
        entry: child!.entry,
        workMs: 10_000,
        cleanupMs: 250,
      });
      let selectedPhase: string = phase;
      const logs: unknown[][] = [];
      const app = new Hono();
      mountFiscalCertificateApi(
        app,
        {
          db: suite.db,
          ring: f.deps.ring,
          seat: FISCAL_SLOT.certificate!,
          nodeId: f.deps.nodeId,
          locationId: f.deps.locationId,
          environment: "preproduction",
          now: () => NOW,
          filing: () => true,
          diagnosisRunner: {
            stop: runner.stop,
            attempt: (work, signal) =>
              runner.attempt(
                (runChild, abort) =>
                  work(
                    (data, signal) =>
                      runChild(
                        {
                          data,
                          endpoint: endpoint.origin,
                          ca: authority.caPem,
                          marker,
                          phase: selectedPhase,
                        },
                        signal,
                      ),
                    abort,
                  ),
                signal,
              ),
          },
        },
        (...args) => void logs.push(args),
      );
      let firstDone!: () => void;
      const done = new Promise<void>((resolve) => {
        firstDone = resolve;
      });
      let started = 0;
      const listener = serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          const index = started++;
          try {
            return await app.fetch(request);
          } finally {
            if (index === 0) firstDone();
          }
        },
      });
      if (!listener.listening) await once(listener, "listening");
      const port = (listener.address() as AddressInfo).port;
      const socket = connect(port, "127.0.0.1");
      const received: Buffer[] = [];
      socket.on("data", (data: Buffer) => received.push(data));
      socket.on("error", () => {});
      const before = await diagnosisSnapshot(suite.db);
      const body = JSON.stringify({ ...f.request, operation: "check" });
      const headers = {
        cookie: `${MANAGEMENT_COOKIE}=${f.session.token}`,
        "content-type": "application/json",
      };
      try {
        await once(socket, "connect");
        socket.write(
          `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${headers.cookie}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
        );
        if (phase === "body") await endpoint.requestArrived;
        else
          await vi.waitFor(
            async () =>
              expect(
                await readFile(phase === "cleanup" ? `${marker}.cleanup` : marker, "utf8"),
              ).not.toBe(""),
            { timeout: 5000 },
          );
        const busy = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
          headers,
          body,
        });
        expect(busy.status).toBe(409);
        expect(await busy.json()).toEqual({
          error: { code: "fiscal.certificate_diagnosis_busy", params: {} },
        });
        const closed = once(socket, "close");
        const disconnectedAt = performance.now();
        socket.destroy();
        await closed;
        await done;
        expect(performance.now() - disconnectedAt).toBeLessThan(3000);
        const pid = Number(await readFile(marker, "utf8"));
        expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
        if (endpoint.requests()) await endpoint.connectionClosed;
        expect(endpoint.openConnections()).toBe(0);
        expect(received).toEqual([]);
        expect(await diagnosisSnapshot(suite.db)).toEqual(before);
        expect(logs).toEqual([
          ["warn", "fiscal.certificate_diagnosis_busy", { requestId: undefined }],
        ]);
        selectedPhase = "normal";
        const next = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(f.request),
        });
        expect(next.status).toBe(200);
        expect(await next.json()).toMatchObject({ category: "local-ready", source: "installed" });
        expect(endpoint.requests()).toBe(phase === "opening" ? 0 : 1);
        expect(await diagnosisSnapshot(suite.db)).toEqual(before);
      } finally {
        socket.destroy();
        release();
        await runner.stop();
        if ("closeAllConnections" in listener) listener.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          listener.close((error) => (error ? reject(error) : resolve())),
        );
        await endpoint.close();
      }
    },
    15_000,
  );
});
