import { createPublicKey } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { paperCustodianFingerprint } from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { assertDevelopmentEnvironment, createDevelopmentKey, type DevelopmentKey } from "./sign.js";

export interface CustodianDir {
  readonly custodianFile: string;
  readonly confirmationFile: string;
  readonly fingerprint: string;
}

export function custodianPaths(dir: string) {
  return {
    key: join(dir, "key.pem"),
    custodian: join(dir, "custodian.json"),
    confirmation: join(dir, "confirmation.json"),
  };
}

export async function writeFileAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

function keyFromPrivatePem(privatePem: string): DevelopmentKey {
  const publicPem = createPublicKey(privatePem).export({ type: "spki", format: "pem" }).toString();
  return {
    custodianId: "developer-custodian",
    publicPem,
    privatePem,
    fingerprint: paperCustodianFingerprint(publicPem)!,
  };
}

export async function loadDevelopmentKey(dir: string): Promise<DevelopmentKey | null> {
  try {
    return keyFromPrivatePem(await readFile(custodianPaths(dir).key, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function initCustodianDir(dir: string, env: NodeJS.ProcessEnv): Promise<CustodianDir> {
  assertDevelopmentEnvironment(env);
  const paths = custodianPaths(dir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let key = await loadDevelopmentKey(dir);
  if (key === null) {
    const created = createDevelopmentKey(env);
    await writeFile(paths.key, created.privatePem, { mode: 0o600, flag: "wx" });
    key = created;
  }
  await writeFileAtomically(
    paths.custodian,
    `${JSON.stringify({ custodianId: key.custodianId, publicKey: key.publicPem, fingerprint: key.fingerprint }, null, 2)}\n`,
  );
  return {
    custodianFile: paths.custodian,
    confirmationFile: paths.confirmation,
    fingerprint: key.fingerprint,
  };
}
