import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  firstSetupAnchorFor,
  type FirstSetupState,
} from "@waitron/provisioning";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { checkedFirstFiscalCommit } from "./first-fiscal-activation.js";
import "./errors.js";

// The caller holds venue exclusion and the coordinator; the audit grants no publication authority.
export async function prepareFirstSetupFinishAudit(
  host: FirstFiscalHost,
  state: FirstSetupState,
  checked: NonNullable<Awaited<ReturnType<typeof checkedFirstFiscalCommit>>>,
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
      register: null,
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
