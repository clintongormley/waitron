/** A new master key shown on a pack whose arrival the browser has not yet confirmed. Kept in memory
 * only, so a restart forgets it and the box keeps its current master key. */
export interface WaitingMasterKey {
  readonly pack: number;
  readonly personId: string;
  readonly name: string;
  readonly checkValue: string;
  readonly publicKey: Uint8Array;
  readonly madeAt: string;
  /** The backup key number the pack printed, written as it is whatever `backup.env` holds by then. */
  readonly backupKeyNumber: number;
}

/** Holds at most one waiting key: a later make replaces it. Makes and confirms take the backup
 * turns, so nothing replaces the key between a confirm's check and its `forget`. */
export class WaitingMasterKeyHolder {
  #waiting: WaitingMasterKey | undefined;

  get waiting(): WaitingMasterKey | undefined {
    return this.#waiting;
  }

  hold(key: WaitingMasterKey): void {
    this.#waiting = key;
  }

  forget(): void {
    this.#waiting = undefined;
  }
}
