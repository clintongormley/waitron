export interface ProvisioningIo {
  stdout(line: string): void;
  stderr(line: string): void;
  /** ECHOED: never used for a secret. */
  prompt(question: string): Promise<string>;
  /** Echo OFF for the read, and restored afterwards whether or not the read succeeded. Whatever is
   * read is never printed back, not even truncated. */
  promptSecret(question: string): Promise<string>;
  /**
   * Clears the screen AND the scrollback. Not a security guarantee, and callers must not present
   * it as one: a terminal logging to disk, or tmux's own buffer, still has what was shown.
   */
  clearScreen(): void;
}
