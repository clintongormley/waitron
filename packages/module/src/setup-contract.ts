export interface InitialSetupNodeKey {
  stage: { stageId: string; nodeId: string; name: string };
  key: { nodeId: string; name: string; secret: string };
}
export interface InitialSetupRecoveryReference {
  stageId: string;
  inputDigest: string;
  bindingDigest: string;
  documentDigest: string;
}
export interface InitialSetupActions {
  stageNodeKey?(): Promise<InitialSetupNodeKey>;
  reissueNodeKey?(): Promise<InitialSetupNodeKey>;
  registerRecoveryDocument?(
    value: InitialSetupRecoveryReference & { statement: unknown },
  ): Promise<void>;
  confirmRecoveryDocument?(value: InitialSetupRecoveryReference): Promise<void>;
  preparation?(proposal: unknown): Promise<unknown>;
  candidates(proposal: unknown): Promise<unknown>;
  request(): Promise<unknown>;
  importInput(input: unknown): Promise<unknown>;
  enrol(publicKey: unknown, comparison: unknown): Promise<void>;
  confirm(statement: unknown): Promise<void>;
}
export interface SetupContribution {
  readonly module: string;
  createRecovery?(context: {
    locale: "en" | "es";
    selection: RecoveryKeySelection & {
      sourceId: string;
      country: string;
      fiscalTerritory: string;
      timeZone: string;
    };
    binding: RecoveryOperationBinding;
    prepare(request: ModuleRecoveryPreparationRequest): Promise<unknown>;
  }): ModuleRecoveryEntry;
  createRecoveryKey?(context: {
    locale: "en" | "es";
    selection: RecoveryKeySelection;
  }): ModuleRecoveryKeyEntry;
  create(context: { locale: "en" | "es"; request: unknown; api: InitialSetupActions }): HTMLElement;
}

export interface RecoveryKeySelection {
  readonly taxId: string;
  readonly environment: "production" | "preproduction";
  readonly nodeId: string;
  readonly keyName: string;
}
export interface ModuleRecoveryKeyEntry extends HTMLElement {
  locale: "en" | "es";
  errorMessage?: string;
  clear(): void;
}

export interface RecoveryOperationBinding {
  module: string;
  action: string;
  eventId: string;
  sourceId: string;
  targetNodeId: string;
}
export interface ModuleRecoveryCredentials {
  recoveryOperation: { binding: RecoveryOperationBinding; input: unknown };
  nodeRecoverySecret: string;
  recoveryContext: { selectedSourceId: string; oldBoxGone: boolean; soleRecovery: boolean };
}
export interface ModuleRecoveryPreparationRequest {
  binding: RecoveryOperationBinding;
  context: ModuleRecoveryCredentials["recoveryContext"];
  nodeRecoverySecret: string;
  proposal: unknown;
}
export interface ModuleRecoveryEntry extends HTMLElement {
  locale: "en" | "es";
  errorMessage?: string;
  refusedField?: string;
  clear(): void;
  readCredentials(): ModuleRecoveryCredentials | null;
}
