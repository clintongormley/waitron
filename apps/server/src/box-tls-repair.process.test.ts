import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, it } from "vitest";
import { mintSelfSignedServerCert, type SelfSignedMaterial } from "./self-signed-cert.js";

const run = promisify(execFile);
let material: SelfSignedMaterial;
beforeAll(() => {
  material = mintSelfSignedServerCert({
    now: new Date(),
    hostnames: ["waitron.local", "localhost"],
    ipAddresses: ["127.0.0.1"],
  });
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tls-process-"));
  dirs.push(root);
  const stateDir = join(root, "state");
  await mkdir(join(stateDir, "tls"), { recursive: true });
  await writeFile(join(stateDir, "tls/ca.key"), material.caKeyPem);
  await writeFile(join(stateDir, "tls/server.crt"), material.serverCertPem);
  await writeFile(join(stateDir, "secrets.env"), "unchanged synthetic vault");
  await writeFile(join(stateDir, "first-setup.json"), "unchanged synthetic attempt");
  const script = join(root, "repair.mts");
  await writeFile(
    script,
    `
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const [stateDir,boundary] = process.argv.slice(2);
const stop = () => { writeFileSync(1,"INTERRUPTED\\n");process.exit(73); };
let markers=0;
const rename=fs.rename;
fs.rename=async(from,to)=>{
 await rename(from,to);
 const target=String(to);
 if(target.endsWith("/repair-pending.json")) markers++;
 if((boundary==="pending"&&markers===1)||(boundary==="complete"&&markers===2)||
    (boundary&&!["pending","complete","archive-file"].includes(boundary)&&target.endsWith("/"+boundary))) stop();
};
const open=fs.open;
fs.open=async(path,...args)=>{
 const handle=await open(path,...args);
 if(boundary==="archive-file"&&String(path).includes("/repair-archive/")&&String(path).endsWith("/ca.key")){
  const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();stop();};
 }
 return handle;
};
syncBuiltinESMExports();
const {repairBoxTls}=await import(${JSON.stringify(new URL("./box-tls-repair.ts", import.meta.url).pathname)});
const result=await repairBoxTls({stateDir,hostnames:["waitron.local","localhost"],listIpv4:()=>[],now:()=>new Date()});
writeFileSync(1,JSON.stringify(result));
`,
  );
  const child = async (boundary = "") =>
    run(process.execPath, ["--import", import.meta.resolve("tsx"), script, stateDir, boundary], {
      timeout: 25000,
      maxBuffer: 1024 * 1024,
    });
  return { root, stateDir, child };
}

it.each([
  "archive-file",
  "manifest.json",
  "pending",
  "candidate.json",
  "ca.crt",
  "ca.key",
  "server.crt",
  "server.key",
  "complete",
])(
  "a process interrupted after %s preserves originals and resumes under the released lock",
  async (boundary) => {
    const f = await fixture();
    const failed = await f.child(boundary).then(
      () => ({ code: 0, stdout: "" }),
      (error) => ({ code: error.code, stdout: error.stdout }),
    );
    expect(failed).toEqual({ code: 73, stdout: "INTERRUPTED\n" });
    const archiveRoot = join(f.stateDir, "tls/repair-archive");
    const before = await readdir(archiveRoot);
    const archivedKey = await readFile(join(archiveRoot, before[0]!, "ca.key"), "utf8");
    expect(archivedKey).toBe(material.caKeyPem);
    const candidate = await readFile(join(archiveRoot, before[0]!, "candidate.json"), "utf8").then(
      JSON.parse,
      (error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    const resumed = JSON.parse((await f.child()).stdout);
    expect(resumed).toMatchObject({ state: "healthy", trust: "new-required", caAvailable: true });
    const ca = await readFile(join(f.stateDir, "tls/ca.crt"), "utf8");
    if (candidate !== null) expect(ca).toBe(candidate.caCertPem);
    const leaf = new X509Certificate(await readFile(join(f.stateDir, "tls/server.crt")));
    expect(leaf.verify(new X509Certificate(ca).publicKey)).toBe(true);
    expect(
      leaf.checkPrivateKey(createPrivateKey(await readFile(join(f.stateDir, "tls/server.key")))),
    ).toBe(true);
    expect(await readFile(join(archiveRoot, before[0]!, "ca.key"), "utf8")).toBe(material.caKeyPem);
    expect(await readFile(join(f.stateDir, "secrets.env"), "utf8")).toBe(
      "unchanged synthetic vault",
    );
    expect(await readFile(join(f.stateDir, "first-setup.json"), "utf8")).toBe(
      "unchanged synthetic attempt",
    );
    if (candidate !== null) expect(await readdir(archiveRoot)).toEqual(before);
  },
);

it("two real processes produce one repair generation and identical public trust", async () => {
  const f = await fixture();
  const results = await Promise.all([f.child(), f.child()]);
  const states = results.map((r) => JSON.parse(r.stdout));
  expect(states[0]).toMatchObject({ state: "healthy", trust: "new-required" });
  expect(states[1]).toEqual(states[0]);
  expect(await readdir(join(f.stateDir, "tls/repair-archive"))).toHaveLength(1);
});
