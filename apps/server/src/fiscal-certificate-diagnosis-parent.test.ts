import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { putCredential } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  authority,
  material,
  NOW,
  parentFixture,
  rawState,
} from "@waitron/fiscal-verifactu/test/certificate-diagnosis-parent-fixtures.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { SIN_DATOS_BODY } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { startDiagnosticServer } from "@waitron/fiscal-verifactu/test/certificate-diagnosis-fixtures.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu/src/slot.js";
import { persons } from "@waitron/identity";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });
const run = promisify(execFile);
let root: string | undefined;
let entry: URL;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "diagnosis-parent-"));
  const source = join(root, "entry.ts");
  entry = pathToFileURL(join(root, "entry.js"));
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    source,
    `
import { writeFileSync } from "node:fs";
import { runCertificateDiagnosisEntry } from ${JSON.stringify(resolve("src/fiscal-certificate-diagnosis-dispatch.ts"))};
import { makeCertificateDiagnosisChild } from ${JSON.stringify(resolve("../../packages/fiscal-verifactu/src/certificate-diagnosis-child.ts"))};
import { diagnosticTransport } from ${JSON.stringify(resolve("../../packages/fiscal-verifactu/src/certificate-diagnosis-transport.ts"))};
await runCertificateDiagnosisEntry(() => ({ diagnoseInChild: async (input, signal, report) => {
  writeFileSync(input.marker, String(process.pid));
  return makeCertificateDiagnosisChild({
    endpointFor: () => input.endpoint,
    transport: (material, options) => diagnosticTransport(material, { ...options, ca: input.ca }),
  })(input.data, signal, report);
}}));
`,
  );
  await run(
    "pnpm",
    ["exec", "node", "../../scripts/bundle-node.mjs", `${source}=${entry.pathname}`],
    { timeout: 90_000, maxBuffer: 2_000_000 },
  );
  await rm(source);
}, 100_000);
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("real certificate parent and isolated child preserve persistent state", () => {
  it.each([
    "inspect",
    "success",
    "http",
    "local",
    "deadline",
    "cancelled",
    "stale",
    "revoked",
  ] as const)(
    "%s leaves no diagnostic writes, including transient writes, after the child exits",
    async (mode) => {
      const f = await parentFixture(suite.db);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const held = ["deadline", "cancelled", "stale", "revoked"].includes(mode);
      const server = await startDiagnosticServer(authority, (_request, response) => {
        void (held ? hold : Promise.resolve()).then(() => {
          response.writeHead(mode === "http" ? 403 : 200);
          response.end(mode === "http" ? "PRIVATE RAW REFUSAL" : SIN_DATOS_BODY);
        });
      });
      const marker = join(root!, `pid-${mode}`);
      const runner = createCertificateDiagnosisRunner({
        fiscalId: "fixture",
        entry,
        execArgv: [],
        workMs: mode === "deadline" ? 1200 : 10_000,
        cleanupMs: 300,
      });
      let expected = await rawState(suite.db);
      const request =
        mode === "local"
          ? {
              ...f.request,
              source: "candidate",
              ...material(),
              passphrase: "WRONG PRIVATE PASSPHRASE",
              operation: "check",
            }
          : { ...f.request, operation: mode === "inspect" ? "inspect" : "check" };
      const pending = runner.attempt(
        async (runChild, signal) =>
          FISCAL_SLOT.certificate!.diagnose!(
            {
              ...f.deps,
              signal,
              runChild: (data, childSignal) =>
                runChild(
                  { data, endpoint: server.origin, ca: authority.caPem, marker },
                  childSignal,
                ),
            },
            request,
            NOW,
          ),
        f.controller.signal,
      );
      const outcome = pending.then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      try {
        if (held) {
          await Promise.race([
            server.requestArrived,
            outcome.then(() => {
              throw new Error("child ended before local request");
            }),
          ]);
          if (mode === "cancelled") f.controller.abort();
          if (mode === "stale" || mode === "revoked") {
            await withTransaction(suite.db, async (tx) => {
              if (mode === "stale")
                await putCredential(tx, f.deps.ring, { purpose: "fiscal.aeat", value: material() });
              else
                await tx
                  .update(persons)
                  .set({ role: "supervisor" })
                  .where(eq(persons.id, f.session.personId));
            });
            expected = await rawState(suite.db);
            release();
          }
        }
        const answer = await outcome;
        if (mode === "stale" || mode === "revoked" || mode === "cancelled")
          expect(answer).toMatchObject({
            error: {
              code:
                mode === "stale"
                  ? "fiscal.certificate_changed"
                  : mode === "revoked"
                    ? "authorization.not_permitted"
                    : "fiscal.certificate_diagnosis_unavailable",
            },
          });
        else
          expect(answer).toMatchObject({
            result: {
              category:
                mode === "inspect"
                  ? "local-ready"
                  : mode === "success"
                    ? "query-completed"
                    : mode === "http"
                      ? "http-response"
                      : mode === "local"
                        ? "local-finding"
                        : "deadline-elapsed",
              ...(mode === "http" ? { httpStatus: 403 } : {}),
            },
          });
        const pid = Number(await readFile(marker, "utf8"));
        expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
        if (server.requests() > 0) await server.connectionClosed;
        expect(server.openConnections()).toBe(0);
        expect(server.requests()).toBe(mode === "inspect" || mode === "local" ? 0 : 1);
        expect(await rawState(suite.db)).toEqual(expected);
        expect(JSON.stringify(answer)).not.toMatch(
          /PRIVATE|"openedFingerprint"|"pfxBase64"|"passphrase"/,
        );
      } finally {
        release();
        await runner.stop();
        await outcome;
        await server.close();
      }
    },
    20_000,
  );
});
