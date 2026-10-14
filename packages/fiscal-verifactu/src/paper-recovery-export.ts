import { open, type FileHandle } from "node:fs/promises";
import { isUuid } from "@waitron/shared";
import { createPaperAllocationSource } from "./allocation-paper-source.js";
import { validateAllocationEnvelope } from "./allocation-envelope.js";
import { parseAllocationOperator } from "./allocation-operator.js";
import { verifyPaperBlockSnapshot } from "./paper-evidence.js";
import { WAITRON_ID_SISTEMA } from "./software.js";

function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

async function readJson(path: string): Promise<unknown> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, "r");
    if (!(await file.stat()).isFile()) throw new RangeError("Invalid recovery input");
    const buffer = Buffer.alloc(65537);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > 65536) throw new RangeError("Invalid recovery input");
    return JSON.parse(buffer.subarray(0, count).toString("utf8")) as unknown;
  } finally {
    await file?.close();
  }
}

export async function preparePaperRecoveryExport(
  values: Record<string, string | boolean | undefined>,
) {
  const approval = await readJson(values.input as string);
  if (typeof approval !== "object" || approval === null || Array.isArray(approval))
    throw new RangeError("Invalid recovery approval");
  const supplied = approval as Record<string, unknown>;
  const operatorId = parseAllocationOperator(supplied.operatorId);
  if (
    !text(supplied.eventId) ||
    !text(supplied.sourceId) ||
    typeof supplied.targetNodeId !== "string" ||
    !isUuid(supplied.targetNodeId) ||
    operatorId === null ||
    !["restore", "re-register"].includes(values.action as string) ||
    !["production", "preproduction"].includes(values.environment as string) ||
    !text(values.taxpayer)
  )
    throw new RangeError("Invalid recovery scope");
  const binding = {
    module: "fiscal-verifactu",
    action: values.action as string,
    eventId: supplied.eventId,
    sourceId: supplied.sourceId,
    targetNodeId: supplied.targetNodeId,
  };
  const current = await createPaperAllocationSource({
    custodianPath: values.custodian as string,
    confirmationPath: values.confirmation as string,
    confirmedFingerprint: values.fingerprint as string,
  })({ binding, operatorId });
  const { evidence } = current;
  const authority = evidence.authority;
  const block = await readJson(values.block as string);
  const consumption = await readJson(values.consumption as string);
  const scope = {
    taxpayerNif: values.taxpayer as string,
    softwareId: WAITRON_ID_SISTEMA,
    environment: values.environment as "production" | "preproduction",
    recipientVenueId: authority.recipientVenueId,
    requiredBases: evidence.requiredBases,
  };
  const snapshot = verifyPaperBlockSnapshot(block, authority.trust, scope);
  if (!snapshot.ok) throw new RangeError("Invalid paper block");
  const selected = snapshot.block.payload.allocations.find(
    (candidate) => candidate.allocationId === evidence.allocationId,
  );
  const allocation = { ...selected, reservationEvidence: { block: snapshot.block, consumption } };
  const verdict = validateAllocationEnvelope(allocation, approval, {
    ...scope,
    mode: "recovery",
    ...binding,
    operatorId,
    incidentEvidence: evidence.incidentEvidence,
    priorActivation: evidence.priorActivation,
    authority,
    reauthentication: { operatorId, eventId: binding.eventId },
  });
  if (!verdict.ok) throw new RangeError("Invalid recovery evidence");
  // Export validates the claimed approval; the activation host must still authenticate its operator.
  return { binding, input: { allocation: verdict.allocation, approval: verdict.approval } };
}
