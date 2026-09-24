import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStaffCsr, installStaffCertificate } from "../src/cloud-remote.js";

const [command, stateDir, hostname, file, ...extra] = process.argv.slice(2);
if (
  !stateDir ||
  !hostname ||
  !file ||
  extra.length ||
  !["csr", "install"].includes(command ?? "")
) {
  console.error("Usage: cloud-certificate.ts csr|install STATE_DIR HOSTNAME FILE");
  process.exitCode = 1;
} else {
  try {
    if (command === "csr") {
      const csr = await createStaffCsr(resolve(stateDir), hostname);
      await writeFile(file, csr, { mode: 0o600 });
    } else {
      await installStaffCertificate(resolve(stateDir), hostname, await readFile(file, "utf8"));
    }
  } catch {
    console.error(
      command === "csr"
        ? "Could not create the signing request. Check the assigned lowercase hostname and private key file permissions."
        : "Could not install the staff certificate. Check the PEM chain, assigned lowercase hostname and private key file permissions.",
    );
    process.exitCode = 1;
  }
}
