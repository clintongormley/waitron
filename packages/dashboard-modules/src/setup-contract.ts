export interface InitialSetupActions {
  candidates(proposal: unknown): Promise<unknown>;
  request(): Promise<unknown>;
  importInput(input: unknown): Promise<unknown>;
  enrol(publicKey: unknown, comparison: unknown): Promise<void>;
  confirm(statement: unknown): Promise<void>;
}

export interface SetupContribution {
  readonly module: string;
  create(context: { locale: "en" | "es"; request: unknown; api: InitialSetupActions }): HTMLElement;
}
