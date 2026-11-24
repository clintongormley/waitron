import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";

export async function writeAllocationInput(
  directory: string,
  fixture: ReturnType<typeof allocationFixture>,
  action: string,
) {
  const request = fixture.request(action);
  const operationFile = join(directory, "operation.json");
  const custodianFile = join(directory, "custodian.json");
  const confirmationFile = join(directory, "confirmation.json");
  await writeFile(
    operationFile,
    JSON.stringify({ binding: request.binding, input: request.input }),
  );
  await writeFile(custodianFile, JSON.stringify(fixture.custodian));
  await writeFile(confirmationFile, JSON.stringify(request.confirmation));
  return {
    WAITRON_RECOVERY_OPERATION_FILE: operationFile,
    custodianFile,
    confirmationFile,
    custodianFingerprint: fixture.custodian.fingerprint,
  };
}
