export interface InitialSetupActions {
  candidates(proposal: unknown): Promise<unknown>;
  request(): Promise<unknown>;
  importInput(input: unknown): Promise<unknown>;
  enrol(publicKey: unknown, comparison: unknown): Promise<void>;
  confirm(statement: unknown): Promise<void>;
}
export interface SetupContribution {
  readonly module: string;
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
