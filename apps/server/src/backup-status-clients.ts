import { isDeepStrictEqual } from "node:util";
import { codeOf } from "@waitron/server-kit";
import {
  unreadDestination,
  type DestinationRead,
  type DestinationStatus,
} from "./backup-status.js";
import type { BackupDestination, StorageBackend } from "./storage-backend.js";

interface Held {
  dest: BackupDestination;
  backend: StorageBackend;
  /** Listings lent out and not yet settled. */
  inFlight: Set<Promise<void>>;
}

/**
 * The status reads' own storage clients, one per destination, kept between reads so a bucket's
 * connection is reused. They share nothing with the running backup's clients. A client whose
 * destination's settings changed or that is no longer configured is closed once every listing lent
 * from it has settled, so a read under way on it still answers.
 */
export class StatusClients {
  readonly #build: (dest: BackupDestination) => StorageBackend;
  readonly #onCloseFailed: (backend: StorageBackend, err: unknown) => void;
  readonly #held = new Map<string, Held>();
  #closed = false;

  constructor(
    build: (dest: BackupDestination) => StorageBackend,
    onCloseFailed: (backend: StorageBackend, err: unknown) => void,
  ) {
    this.#build = build;
    this.#onCloseFailed = onCloseFailed;
  }

  /** Lends `dest`'s client to `run`; synchronous up to `run`, so the client is chosen at the call. */
  read(
    dest: BackupDestination,
    run: (backend: StorageBackend) => DestinationRead,
  ): Promise<DestinationStatus> {
    let held = this.#held.get(dest.id);
    if (held === undefined || !isDeepStrictEqual(held.dest, dest)) {
      if (held !== undefined) this.#retire(held);
      let backend: StorageBackend;
      try {
        backend = this.#build(dest);
      } catch (err) {
        return Promise.resolve(unreadDestination(dest.id, codeOf(err)));
      }
      held = { dest, backend, inFlight: new Set() };
      // After a stop nothing is kept: the client is closed when its one listing settles.
      if (this.#closed) {
        const once = held;
        const read = run(once.backend);
        void read.settled.then(() => this.#close(once.backend));
        return read.status;
      }
      this.#held.set(dest.id, held);
    }
    const lent = held;
    const read = run(lent.backend);
    lent.inFlight.add(read.settled);
    void read.settled.then(() => lent.inFlight.delete(read.settled));
    return read.status;
  }

  /** Closes the clients of destinations not in `dests`; one kept but changed is replaced by its next
   * read. */
  keepOnly(dests: readonly BackupDestination[]): void {
    const ids = new Set(dests.map(({ id }) => id));
    for (const held of [...this.#held.values()]) if (!ids.has(held.dest.id)) this.#retire(held);
  }

  /** Terminal: every later read builds its own client. */
  closeAll(): void {
    this.#closed = true;
    for (const held of [...this.#held.values()]) this.#retire(held);
  }

  #retire(held: Held): void {
    this.#held.delete(held.dest.id);
    void Promise.all(held.inFlight).then(() => this.#close(held.backend));
  }

  #close(backend: StorageBackend): void {
    try {
      backend.close();
    } catch (err) {
      this.#onCloseFailed(backend, err);
    }
  }
}
