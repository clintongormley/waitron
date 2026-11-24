import type { PersonHold } from "../start-clock-check.js";

/** A hold for an identity change under which a person's confirmation always stands. */
export function standingHold(onHeld: () => void = () => {}): PersonHold {
  return { standing: () => () => true, onHeld };
}
