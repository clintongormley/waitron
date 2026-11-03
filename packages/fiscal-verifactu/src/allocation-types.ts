import type { OperationOperator } from "@waitron/module/src/operation-authority.js";

export interface FiscalAllocation {
  readonly version: 1;
  readonly allocationId: string;
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: "preproduction" | "production";
  readonly installationIdentity: string;
  readonly series: readonly { readonly code: string; readonly purpose: string }[];
  readonly source: "initial-paper" | "paper" | "cloud" | "emergency" | "hour";
  readonly reservationEvidence: unknown;
  readonly issuedAt: string;
}

export type RecoveryApproval = RecoveryApprovalV1 | RecoveryApprovalV2;

export interface RecoveryApprovalV1 extends RecoveryApprovalFields {
  readonly version: 1;
}

export interface RecoveryApprovalV2 extends RecoveryApprovalFields {
  readonly version: 2;
  readonly oldMachineRelinquished: boolean;
}

interface RecoveryApprovalFields {
  readonly eventId: string;
  readonly operatorId: OperationOperator;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly oldMachineOffline: boolean;
  readonly oldMachineAbsent: boolean;
  readonly noParallelRecovery: boolean;
  readonly confirmedAt: string;
  readonly incidentEvidence: string;
}

export interface ActivationResult {
  readonly activationEventId: string;
  readonly sifId: string;
  readonly series: readonly {
    readonly id: string;
    readonly code: string;
    readonly purpose: string;
  }[];
}
