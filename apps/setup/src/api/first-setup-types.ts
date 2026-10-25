import type {
  AeatCertDraft,
  EmailSettingsDraft,
  ProvisionBody,
  RecoveryBackupPreview,
  RecoveryPreparationSource,
  RecoveryRestoreCredentials,
} from "./client.js";

export interface FirstSetupOwner {
  attemptId: string;
  revision: number;
  ownerGeneration: number;
  capability: string;
}
export interface FirstSetupState {
  attemptId: string;
  nodeId: string;
  administratorId: string;
  revision: number;
  ownerGeneration: number;
  status:
    | "claimed"
    | "consumption-intent"
    | "activation-started"
    | "committed"
    | "publication"
    | "complete"
    | "abandoned"
    | "uncertain";
  consumptionIntent: boolean;
  environment: "production" | "preproduction";
  venue: Omit<ProvisionBody["venue"], "admin" | "fullSeriesCode" | "taxpayerDomicile"> & {
    fullSeriesCode?: string;
    taxpayerDomicile?: string | null;
    admin: {
      firstNames?: string | null;
      lastNames?: string | null;
      displayName: string;
      email: string;
      locale?: string | null;
    };
  };
  modules: { module: string; version: string }[];
}
export interface FirstSetupOwnership {
  state: FirstSetupState;
  capability: string;
  ownerGeneration: number;
}
export interface FirstSetupStatus {
  claimed: boolean;
  conflict?: boolean;
  resolution?: boolean;
  state?: FirstSetupState;
}
export interface FirstSetupInspection {
  version: 2;
  inspectionId: string;
  pair: "missing" | "partial" | "invalid" | "valid" | "repairable";
  database:
    "missing" | "unreadable" | "corrupt" | "partial" | "unknown" | "no-venue-rows" | "occupied";
  password: "checkable" | "uncheckable";
  revision: number | null;
  ownerGeneration: number | null;
  repairEligible: boolean;
  emptyDatabase: boolean;
  artifacts: {
    name: string;
    status: "missing" | "present" | "invalid" | "unreadable";
    digest?: string;
  }[];
}
export type FirstSetupResolutionSnapshot = Pick<FirstSetupInspection, "inspectionId"> & {
  revision: number;
  ownerGeneration: number;
};
export interface FirstSetupUpdate {
  state: FirstSetupState;
}
export interface FirstSetupPublicRequest {
  attemptId: string;
  modules: { module: string; request: unknown }[];
}
export interface FirstSetupProvisionBody {
  mode: "live";
  firstSetup: { attemptId: string; revision: number };
  aeatCert?: AeatCertDraft;
  email?: EmailSettingsDraft;
}

export function firstSetupHeaders(owner: FirstSetupOwner): Record<string, string> {
  return {
    "X-Waitron-Setup-Owner": owner.capability,
    "X-Waitron-Setup-Attempt": owner.attemptId,
    "X-Waitron-Setup-Revision": String(owner.revision),
    "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
  };
}

export interface BackupRepairObservation {
  inspectionId: string;
  revision: number | null;
  ownerGeneration: number | null;
}
export interface BackupRepairProof {
  observation: BackupRepairObservation;
  nodeRecoverySecret: string;
  context: { oldBoxGone: boolean; soleRecovery: boolean };
}
export interface BackupRepairOpenRequest extends BackupRepairProof {
  source: Exclude<RecoveryPreparationSource, { kind: "staged" }>;
  recoveryId?: string;
}
export interface BackupRepairResumeRequest extends BackupRepairProof {
  recoveryId: string;
}
export interface BackupRepairSession {
  sessionId: string;
  recoveryId: string;
  preview: RecoveryBackupPreview;
  binding: RecoveryRestoreCredentials["recoveryOperation"]["binding"];
  input?: unknown;
}
export interface StartAgainSummary {
  reached: "claimed" | "named" | "fiscal-started" | "fiscal-finished";
  lastName: string | null;
  recoveryRecordDamaged?: true;
}
export interface BackupRepairStatus {
  phase: "unstarted" | "prepared" | "placement-started" | "restored" | "selected" | "uncertain";
  recoveryId?: string;
  proofRequired: true;
}
