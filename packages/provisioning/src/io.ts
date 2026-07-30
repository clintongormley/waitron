/** Everything this package does to the outside world, injected — so the tests need no process, no
 * real tty and no temp files, and nothing here can print a secret behind the suite's back. The
 * shape `packages/credentials/src/cli.ts`'s `CliIo` already uses, plus the two a wizard needs. */
export interface ProvisioningIo {
  stdout(line: string): void;
  stderr(line: string): void;
  /** Reads one line from the tty, echoed. Never used for a secret — see `promptSecret` in
   * `bin.ts` for the echo-off path, which this plan's commands do not need. */
  prompt(question: string): Promise<string>;
  clearScreen(): void;
}
