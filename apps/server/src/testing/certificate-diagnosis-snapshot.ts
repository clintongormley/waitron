import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

export async function diagnosisSnapshot(db: Database) {
  return db.withWriteLock(async () => {
    const tables = Object.fromEntries(
      db
        .all<{ name: string }>(
          sql`select name from sqlite_master where type = 'table' order by name`,
        )
        .map(({ name }) => [
          name,
          db
            .all(sql`select * from ${sql.identifier(name)}`)
            .map((row) => JSON.stringify(row))
            .sort(),
        ]),
    );
    return { tables, writes: db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n };
  });
}

export async function diagnosisChildFixture() {
  const root = await mkdtemp(join(tmpdir(), "diagnosis-http-"));
  const source = join(root, "entry.ts");
  const entry = pathToFileURL(join(root, "entry.js"));
  try {
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      source,
      `
import { writeFileSync } from "node:fs";
import { runCertificateDiagnosisEntry } from ${JSON.stringify(resolve("src/fiscal-certificate-diagnosis-dispatch.ts"))};
import { makeCertificateDiagnosisChild } from ${JSON.stringify(resolve("../../packages/fiscal-verifactu/src/certificate-diagnosis-child.ts"))};
import { openCertificateFile } from ${JSON.stringify(resolve("../../packages/fiscal-verifactu/src/certificate-file.ts"))};
import { diagnosticTransport } from ${JSON.stringify(resolve("../../packages/fiscal-verifactu/src/certificate-diagnosis-transport.ts"))};
await runCertificateDiagnosisEntry(() => ({ diagnoseInChild: async (input, signal, report) => {
  writeFileSync(input.marker, String(process.pid));
  return makeCertificateDiagnosisChild({
    open: (...args) => {
      if (input.phase === "opening") {
        report({ stage: "local", category: "unknown", httpStatus: null });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
      }
      return openCertificateFile(...args);
    },
    endpointFor: () => input.endpoint,
    transport: (material, options) => {
      const transport = diagnosticTransport(material, { ...options, ca: input.ca });
      return input.phase === "cleanup" ? { ...transport, close: async () => {
        writeFileSync(input.marker + ".cleanup", "held");
        await new Promise(() => {});
      }} : transport;
    },
  })(input.data, signal, report);
}}));
`,
    );
    await promisify(execFile)(
      "pnpm",
      ["exec", "node", "../../scripts/bundle-node.mjs", `${source}=${entry.pathname}`],
      { timeout: 90_000, maxBuffer: 2_000_000 },
    );
    await rm(source);
    return { root, entry, close: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
