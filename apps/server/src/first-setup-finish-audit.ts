import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  firstSetupAnchorFor,
  type FirstSetupState,
  type RegisterAnswer,
} from "@waitron/provisioning";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { checkedFirstFiscalCommit } from "./first-fiscal-activation.js";
import "./errors.js";

export function assertFinishRegister(
  answer: unknown,
): asserts answer is Extract<RegisterAnswer, { kind: "current-master" }> {
  if (
    typeof answer !== "object" ||
    answer === null ||
    Array.isArray(answer) ||
    Object.keys(answer).length !== 5 ||
    !("kind" in answer) ||
    answer.kind !== "current-master" ||
    !("status" in answer) ||
    answer.status !== "Consumed" ||
    !("custodian" in answer) ||
    typeof answer.custodian !== "string" ||
    !answer.custodian.trim() ||
    answer.custodian.length > 256 ||
    !("reference" in answer) ||
    typeof answer.reference !== "string" ||
    !/^[a-f0-9]{64}$/.test(answer.reference) ||
    !("consultedAt" in answer) ||
    typeof answer.consultedAt !== "string" ||
    !Number.isFinite(Date.parse(answer.consultedAt)) ||
    new Date(answer.consultedAt).toISOString() !== answer.consultedAt
  )
    throw new AppError("setup.attempt_invalid", {});
}

// The caller holds venue exclusion and the coordinator; the audit grants no publication authority.
export async function prepareFirstSetupFinishAudit(
  host: FirstFiscalHost,
  state: FirstSetupState,
  checked: NonNullable<Awaited<ReturnType<typeof checkedFirstFiscalCommit>>>,
  register: RegisterAnswer,
) {
  const snapshot = await host.resolution.captureFirstSetupOriginals();
  if (
    snapshot.inspection.revision !== state.revision ||
    snapshot.inspection.ownerGeneration !== state.ownerGeneration
  )
    throw new AppError("setup.attempt_conflict", {});
  const anchor = await firstSetupAnchorFor(state);
  const records = createFirstSetupResolutionStore({
    ...anchor,
    coordinator: createFirstSetupCoordinator(),
  });
  const prepared = await records.prepare(
    {
      resolutionId: randomUUID(),
      attemptId: state.frozen.attemptId,
      observedRevision: state.revision,
      observedOwnerGeneration: state.ownerGeneration,
      database: "committed-exact",
      authority: "original-password",
      register,
      action: "finish-publication",
      nextWorkspace: null,
    },
    [
      ...snapshot.originals,
      { name: "checked-commit.json", bytes: Buffer.from(JSON.stringify(checked)) },
    ],
  );
  return () => records.apply(prepared);
}
