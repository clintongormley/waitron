import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * The setup database could not be copied or read, as opposed to a read that refused what it found.
 * `failure` is what failed, so a full disk can be told apart; it never reaches the answer.
 */
export class SetupDatabaseReadFailed extends AppError<"setup.not_ready"> {
  declare readonly failure: unknown;

  constructor(reason: string, failure?: unknown) {
    super("setup.not_ready", { cause: "unreadable" }, { reason });
    Object.defineProperty(this, "failure", { value: failure, enumerable: false });
  }
}
