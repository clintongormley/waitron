import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  makeAuthority,
  SIN_DATOS_BODY,
} from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { startDiagnosticServer } from "@waitron/fiscal-verifactu/test/certificate-diagnosis-fixtures.js";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";

const run = promisify(execFile);
const authority = makeAuthority();
const first = authority.issue({ commonName: "isolated first" });
const second = authority.issue({ commonName: "isolated second" });
let root: string | undefined;
let entry: URL;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "diagnosis-bundle-"));
  entry = pathToFileURL(join(root, "fiscal-certificate-diagnosis.js"));
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await run(
    "pnpm",
    [
      "exec",
      "node",
      "../../scripts/bundle-node.mjs",
      `src/fiscal-certificate-diagnosis-entry.ts=${entry.pathname}`,
      `src/fiscal-certificate-diagnosis-runner.ts=${join(root, "host.js")}`,
    ],
    { cwd: resolve("."), timeout: 180_000, maxBuffer: 2_000_000 },
  );
}, 190_000);
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function input(certKind: "sello" | "representante", operation = "inspect") {
  const file = certKind === "sello" ? first : second;
  return {
    operation,
    material: { pfxBase64: file.pfx.toString("base64"), passphrase: file.passphrase, certKind },
    taxpayer: { legalName: "PRIVATE TAXPAYER", taxId: "89890001K" },
    environment: "preproduction",
    timeZone: "Europe/Madrid",
    startedAt: "2026-10-31T23:30:00.000Z",
  };
}

async function localFixture(endpoint: string, name: string, holdCleanup = false) {
  const fixture = join(root!, `local-${name}.js`),
    source = join(root!, `local-${name}.ts`);
  const pidMarker = join(root!, `pid-${name}`);
  await writeFile(
    source,
    `
import { writeFileSync } from "node:fs";
import { runCertificateDiagnosisEntry } from ${JSON.stringify(resolve("src/fiscal-certificate-diagnosis-dispatch.ts"))};
import { makeCertificateDiagnosisChild } from ${JSON.stringify(resolve("../../packages/fiscal-verifactu/src/certificate-diagnosis-child.ts"))};
import { diagnosticTransport } from ${JSON.stringify(resolve("../../packages/fiscal-verifactu/src/certificate-diagnosis-transport.ts"))};
await runCertificateDiagnosisEntry(id => {
  if (id !== "fixture") throw new Error("unknown module");
  const child = makeCertificateDiagnosisChild({
    endpointFor: () => ${JSON.stringify(endpoint)},
    transport: (material, options) => {
      const transport = diagnosticTransport(material, { ...options, ca: ${JSON.stringify(authority.caPem)} });
      return ${JSON.stringify(holdCleanup)} ? { ...transport, close: async () => {
        writeFileSync(${JSON.stringify(pidMarker + "-cleanup")}, "ready");
        await new Promise(() => {});
      }} : transport;
    }
  });
  return { diagnoseInChild: (...args) => {
    writeFileSync(${JSON.stringify(pidMarker)}, String(process.pid));
    return child(...args);
  }};
});`,
  );
  await run("pnpm", ["exec", "node", "../../scripts/bundle-node.mjs", `${source}=${fixture}`], {
    timeout: 180_000,
    maxBuffer: 2_000_000,
  });
  await rm(source);
  return { entry: pathToFileURL(fixture), pidMarker };
}

describe("shipped certificate diagnosis entry", () => {
  it.each(["sello", "representante"] as const)(
    "inspects selected %s bytes with the composed real module and no source loader",
    async (kind) => {
      const host = (await import(pathToFileURL(join(root!, "host.js")).href)) as {
        createCertificateDiagnosisRunner: typeof createCertificateDiagnosisRunner;
      };
      const runner = host.createCertificateDiagnosisRunner({ fiscalId: "verifactu" });
      try {
        const answer = await runner.attempt(
          async (child, abort) => ({ result: await child(input(kind), abort) }),
          new AbortController().signal,
        );
        expect(answer).toEqual({
          result: {
            outcome: "completed",
            value: {
              openedFingerprint: (kind === "sello" ? first : second).fingerprint,
              kind,
              completedAt: expect.any(String),
              stage: "complete",
              category: "local-ready",
              httpStatus: null,
              localFinding: null,
            },
          },
        });
        await expect(stat(join(root!, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
        const notices = await readFile(entry.pathname + ".NOTICES.txt", "utf8");
        expect(notices).toContain("fast-xml-parser");
        expect(notices).toContain("undici");
      } finally {
        await runner.stop();
      }
    },
  );

  it("rejects an unknown module and caller-selected destinations through the production entry", async () => {
    for (const fiscalId of ["unknown", "verifactu"]) {
      const runner = createCertificateDiagnosisRunner({ fiscalId, entry, execArgv: [] });
      try {
        const result = await runner.attempt(
          async (child, abort) => ({
            result: await child({ ...input("sello"), endpoint: "https://127.0.0.1:1" }, abort),
          }),
          new AbortController().signal,
        );
        expect(result).toEqual({
          result: { outcome: "interrupted", reason: "unavailable", lastProgress: null },
        });
      } finally {
        await runner.stop();
      }
    }
  });

  it.each(["sello", "representante"] as const)(
    "runs one isolated local mTLS query for selected %s through the same dispatcher",
    async (kind) => {
      const server = await startDiagnosticServer(authority, (_request, response) => {
        response.writeHead(200);
        response.end(SIN_DATOS_BODY);
      });
      const fixture = await localFixture(server.origin, kind);
      const runner = createCertificateDiagnosisRunner({
        fiscalId: "fixture",
        entry: fixture.entry,
        execArgv: [],
      });
      try {
        const answer = await runner.attempt(
          async (child, abort) => ({ result: await child(input(kind, "check"), abort) }),
          new AbortController().signal,
        );
        expect(answer).toEqual({
          result: {
            outcome: "completed",
            value: {
              openedFingerprint: (kind === "sello" ? first : second).fingerprint,
              kind,
              completedAt: expect.any(String),
              stage: "complete",
              category: "query-completed",
              httpStatus: 200,
              localFinding: null,
            },
          },
        });
        expect(server.requests()).toBe(1);
        expect(server.clientNames).toEqual([
          kind === "sello" ? "isolated first" : "isolated second",
        ]);
        expect(server.bodies).toHaveLength(1);
        expect(server.bodies[0]).toContain("ConsultaFactuSistemaFacturacion");
        expect(server.bodies[0]).toContain("Periodo>11<");
        expect(server.bodies[0]).not.toContain("RegistroAlta");
        await server.connectionClosed;
        expect(server.openConnections()).toBe(0);
        const pid = Number(await readFile(fixture.pidMarker, "utf8"));
        expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
      } finally {
        await runner.stop();
        await server.close();
      }
    },
    240_000,
  );

  it.each(["body", "cleanup"])(
    "cancels held native %s and observes the child and TLS socket gone",
    async (phase) => {
      const server = await startDiagnosticServer(authority, (_request, response) => {
        response.writeHead(200);
        if (phase === "cleanup") response.end(SIN_DATOS_BODY);
        else response.flushHeaders();
      });
      let runner: ReturnType<typeof createCertificateDiagnosisRunner> | undefined;
      try {
        const fixture = await localFixture(server.origin, phase, phase === "cleanup");
        runner = createCertificateDiagnosisRunner({
          fiscalId: "fixture",
          entry: fixture.entry,
          execArgv: [],
          workMs: 5_000,
          cleanupMs: 200,
        });
        const abort = new AbortController();
        const pending = runner.attempt(
          async (child, signal) => ({ result: await child(input("sello", "check"), signal) }),
          abort.signal,
        );
        const outcome = pending.catch((error: unknown) => error);
        await Promise.race([
          server.requestArrived,
          outcome.then(() => {
            throw new Error("Certificate child ended before the local query arrived");
          }),
        ]);
        if (phase === "cleanup")
          await vi.waitFor(async () =>
            expect(await readFile(fixture.pidMarker + "-cleanup", "utf8")).toBe("ready"),
          );
        const pid = Number(await readFile(fixture.pidMarker, "utf8"));
        abort.abort();
        expect(await outcome).toMatchObject({
          code: "fiscal.certificate_diagnosis_unavailable",
          params: {},
        });
        expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
        await server.connectionClosed;
        expect(server.openConnections()).toBe(0);
        expect(server.requests()).toBe(1);
        await expect(
          runner.attempt(async () => "next", new AbortController().signal),
        ).resolves.toBe("next");
      } finally {
        await runner?.stop();
        await server.close();
      }
    },
    240_000,
  );
});
