import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStaffCsr, installStaffCertificate } from "../src/cloud-remote.js";

const [command, stateDir, hostname, file, ...extra] = process.argv.slice(2);
if (!stateDir || !hostname || !file || extra.length || !["csr", "install"].includes(command ?? ""))
  throw new Error("Usage: cloud-certificate.ts csr|install STATE_DIR HOSTNAME FILE");
if (command === "csr") {
  const csr = await createStaffCsr(resolve(stateDir), hostname);
  await writeFile(file, csr, { mode: 0o600 });
} else {
  await installStaffCertificate(resolve(stateDir), hostname, await readFile(file, "utf8"));
}
