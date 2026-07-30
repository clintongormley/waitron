/** Everything this package does to the outside world, injected — so the tests need no process, no
 * real tty and no temp files, and nothing here can print a secret behind the suite's back. The
 * shape `packages/credentials/src/cli.ts`'s `CliIo` already uses, plus the two a wizard needs. */
export interface ProvisioningIo {
  stdout(line: string): void;
  stderr(line: string): void;
  /** Reads one line from the tty, echoed. Never used for a secret: an echo-off path is a separate
   * method, and no command in this package needs one yet. */
  prompt(question: string): Promise<string>;
  /**
   * Clears the screen AND the scrollback, so a key that has just been displayed is not one scroll
   * away.
   *
   * A real terminal implementation writes `ESC[3J` (clear scrollback), `ESC[H` (home the cursor)
   * and `ESC[2J` (clear the screen), in that order — `ESC[2J` alone leaves the scrollback intact.
   * Written as `\u001B` escapes rather than literal control bytes wherever it is implemented: a
   * raw 0x1B in a source file survives neither review nor copy-paste reliably.
   *
   * Not a security guarantee, and callers must not present it as one — it does nothing about a
   * terminal configured to log its sessions to disk, nor about tmux's own buffer under some
   * configurations.
   */
  clearScreen(): void;
}
