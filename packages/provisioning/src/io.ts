/** Everything this package does to the outside world, injected — so the tests need no process, no
 * real tty and no temp files, and nothing here can print a secret behind the suite's back. The
 * shape `packages/credentials/src/cli.ts`'s `CliIo` already uses, plus the two a wizard needs. */
export interface ProvisioningIo {
  stdout(line: string): void;
  stderr(line: string): void;
  /** Reads one line from the tty, ECHOED. Never used for a secret — that is `promptSecret`'s job,
   * and the split is the whole reason there are two methods rather than one with a flag. */
  prompt(question: string): Promise<string>;
  /**
   * Reads one line from the tty with the echo turned OFF, for a value that must not appear on the
   * screen or in a screen recording.
   *
   * What this package reads through it today is the first admin's till PIN and dashboard password.
   * Each is a PROMPT and never a flag, because `argv` is world-readable in `ps` and lands in shell
   * history — the constraint `src/errors.ts`'s header states, and `cli.test.ts`'s "refuses any flag
   * that would put a secret in argv" pins. `WAITRON_ADMIN_PIN` and `WAITRON_ADMIN_PASSWORD` are the
   * only other ways in. The venue DIRECTORY is not read through here: a path is not a secret.
   *
   * A real terminal implementation turns off `echo` for the duration and restores it afterwards,
   * whether or not the read succeeded. Whatever is read is returned to the caller and never printed
   * back, not even truncated: a password is not a prefix of anything safe.
   */
  promptSecret(question: string): Promise<string>;
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
