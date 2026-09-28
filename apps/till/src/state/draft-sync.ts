import { compareDecimal, decimal } from "@waitron/shared";
import type { Draft, DraftLine, DraftLineInput, TillApi, TillProduct } from "../api/client.js";
import { toDraftLineInput } from "./draft-lines.js";
import { WorkingOrderStore, type LineSelection, type OrderLine } from "./working-order.js";

/** How long after a person's last edit their draft is saved. */
export const DRAFT_SAVE_DELAY_MS = 400;

/** The refusals that mean the till's copy of the draft is no longer the server's. */
export const DRAFT_REFUSALS: ReadonlySet<string> = new Set([
  "draft.out_of_date",
  "draft.taken_over",
  "draft.not_found",
  "draft.already_submitted",
]);

/** A table draft: a tap adds into a line that orders the same thing, as the server's save does. */
export class DraftStore extends WorkingOrderStore {
  override addProduct(product: TillProduct, quantity: string, selection?: LineSelection): void {
    this.addMerging(product, quantity, selection);
  }

  /** The server's `unavailable`, one per line in order. Display and sending only: not an edit. */
  setUnavailableOnServer(flags: readonly boolean[]): void {
    let changed = false;
    this.lines.forEach((line, index) => {
      const flagged = flags[index] === true;
      if ((line.unavailableOnServer === true) === flagged) return;
      changed = true;
      if (flagged) line.unavailableOnServer = true;
      else delete line.unavailableOnServer;
    });
    if (changed) this.emit("changed");
  }
}

/** `failed`: no answer, and the edits stay unsaved. `refused` names the refusal, and a
 * `draft.taken_over` names the person who now holds the draft. */
export type DraftSaveOutcome = "saved" | "failed" | DraftRefused;

export interface DraftRefused {
  refused: string;
  ownerName?: string;
}

/** `taken`: the draft is the person's own now, shown as the server answered it. `unsaved`: the
 * person's own edits could not be saved first, so nothing was taken; a refusal of that save has
 * gone to `onRefused`. */
export type TakeOverOutcome = "taken" | "failed" | "unsaved" | DraftRefused;

export interface DraftSyncOptions {
  api: Pick<TillApi, "listDrafts" | "saveDraft" | "takeOverDraft">;
  visitId: string;
  personId: string;
  /** The saved lines as the till shows them, from the table's offers. */
  rebuild: (lines: readonly DraftLine[]) => OrderLine[];
  /** A save was refused. When the draft itself was, the drafts have been read again first. */
  onRefused: (code: string, ownerName?: string) => void;
  /** The server's draft has replaced what the store held. */
  onReplaced?: () => void;
  /** How long one read or save may stay out before it is cut off. */
  requestLimitMs: number;
}

/** A signal that aborts after `ms`, or with `also`. */
function limited(ms: number, also?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const own = new AbortController();
  const timer = setTimeout(() => own.abort(), ms);
  return {
    signal: also === undefined ? own.signal : AbortSignal.any([own.signal, also]),
    done: () => clearTimeout(timer),
  };
}

/** Settles when `signal` aborts. */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** A coded refusal, with the new owner's name when it carries one; undefined for no answer. */
function asRefusal(error: unknown): DraftRefused | undefined {
  const { code, ownerName } = (error ?? {}) as { code?: unknown; ownerName?: unknown };
  if (typeof code !== "string") return undefined;
  return typeof ownerName === "string" ? { refused: code, ownerName } : { refused: code };
}

/** What a line orders, with its answers and picks in a fixed order. */
function lineKey(input: DraftLineInput): string {
  return JSON.stringify([
    input.menuItemId,
    input.variantId,
    input.menuVersionId,
    input.note,
    input.courseId,
    input.noMerge,
    input.options.map((answer) => `${answer.listId} ${answer.labelId}`).sort(),
    input.extras
      .flatMap(({ listId, picks }) =>
        picks.map((pick) => `${listId} ${pick.productId} ${pick.quantity}`),
      )
      .sort(),
  ]);
}

/** Whether the server's lines are the till's, in the same places. */
function sameLines(till: readonly DraftLineInput[], saved: readonly DraftLine[]): boolean {
  return (
    till.length === saved.length &&
    till.every(
      (line, index) =>
        lineKey(line) === lineKey(saved[index]!) &&
        compareDecimal(decimal(line.quantity), decimal(saved[index]!.quantity)) === 0,
    )
  );
}

/**
 * One person's draft on one party, kept on the server. Every edit to {@link store} is saved after
 * {@link DRAFT_SAVE_DELAY_MS}; saves go one at a time, and edits made while one is out go in the
 * next. Each save names the draft id and revision the last one answered.
 */
export class DraftSync {
  readonly store = new DraftStore();
  readonly visitId: string;
  readonly personId: string;
  /** Other people's open drafts on the party, as last read. */
  others: Draft[] = [];
  readonly #options: DraftSyncOptions;
  #draftId: string | null = null;
  #revision = 0;
  /** The line ids the server last answered, by position. */
  #lineIds: string[] = [];
  /** An edit not yet sent in a save. */
  #unsaved = false;
  #queue: Promise<DraftSaveOutcome> = Promise.resolve("saved");
  /** A save is out. */
  #saving = false;
  /** Signing out: no save starts after this. */
  #closed = false;
  #timer?: ReturnType<typeof setTimeout>;
  /** Moved on by each read, so a save answering after it is not taken. */
  #reads = 0;
  #muted = false;
  #dropped = false;
  readonly #unsubscribe: () => void;

  constructor(options: DraftSyncOptions) {
    this.#options = options;
    this.visitId = options.visitId;
    this.personId = options.personId;
    this.#unsubscribe = this.store.subscribe(() => this.#onChange());
  }

  get draftId(): string | null {
    return this.#draftId;
  }

  get revision(): number {
    return this.#revision;
  }

  /** A save is out. */
  get saving(): boolean {
    return this.#saving;
  }

  /** The saved ids of the lines at `positions`, or null while the store holds edits not saved. */
  lineIds(positions: readonly number[]): string[] | null {
    if (this.#unsaved || this.#lineIds.length !== this.store.lineCount) return null;
    return positions.map((position) => this.#lineIds[position]!);
  }

  /** Reads the party's drafts and shows the person's own; false when they could not be read. */
  async load(): Promise<boolean> {
    const read = ++this.#reads;
    this.#cancelTimer();
    const limit = limited(this.#options.requestLimitMs);
    let drafts: Draft[];
    try {
      drafts = await this.#options.api.listDrafts(this.visitId, { signal: limit.signal });
    } catch {
      return false;
    } finally {
      limit.done();
    }
    if (this.#dropped || read !== this.#reads) return false;
    const own = drafts.find((draft) => draft.ownerId === this.personId) ?? null;
    this.others = drafts.filter((draft) => draft !== own);
    this.#show(own);
    return true;
  }

  /** Sends any unsaved edit now; resolves once every save has answered, with the last outcome, or
   * as `failed` once `signal` aborts, which also cuts off the save this sends. */
  flush(signal?: AbortSignal): Promise<DraftSaveOutcome> {
    this.#cancelTimer();
    const saved = this.#save(signal);
    if (signal === undefined) return saved;
    return Promise.race([saved, aborted(signal).then((): DraftSaveOutcome => "failed")]);
  }

  /** At sign-out. What is unsaved is sent now only when no save is out: one started after the next
   * person has signed in would be saved as theirs. No save starts after this. */
  close(): Promise<DraftSaveOutcome> {
    this.#cancelTimer();
    const last = this.#saving ? this.#queue : this.#save(undefined, true);
    this.#closed = true;
    return last;
  }

  /** After a submission answered: the `sent` lines leave, and the rest are taken as the server's
   * `draft` when they match it, or replaced by it when they do not. */
  submitted(draft: Draft | null, sent: readonly OrderLine[]): void {
    this.#quietly(() => this.store.removeLines(sent));
    const kept = this.store.lines.map((line) => toDraftLineInput(line));
    if (draft !== null && sameLines(kept, draft.lines)) this.#keep(draft);
    else this.#show(draft);
  }

  /**
   * Makes another person's draft this person's, once their own edits are saved: a take-over is
   * never sent over an edit the server has not got. The answer, which is the person's own draft
   * with the taken lines added when they already held one, replaces what the store shows, so the
   * store takes no edit until then. A refused take-over, or one with no answer, reads the drafts
   * again and sends nothing more.
   */
  async takeOver(draftId: string, revision: number): Promise<TakeOverOutcome> {
    const locked = this.store.sending;
    this.store.sending = true;
    try {
      return await this.#takeOver(draftId, revision);
    } finally {
      this.store.sending = locked;
    }
  }

  async #takeOver(draftId: string, revision: number): Promise<TakeOverOutcome> {
    if ((await this.flush()) !== "saved") return "unsaved";
    const read = this.#reads;
    const limit = limited(this.#options.requestLimitMs);
    let taken: Draft;
    try {
      taken = await this.#options.api.takeOverDraft(this.visitId, draftId, revision, {
        signal: limit.signal,
      });
    } catch (error) {
      if (this.#dropped || read !== this.#reads) return "failed";
      await this.load();
      const refusal = asRefusal(error);
      return refusal ?? "failed";
    } finally {
      limit.done();
    }
    if (this.#dropped || read !== this.#reads) return "failed";
    this.others = this.others.filter((other) => other.id !== draftId);
    this.#show(taken);
    return "taken";
  }

  /** Replaces the lines at the given positions for display only: the saved draft does not change,
   * so nothing is saved. */
  reshow(lines: ReadonlyMap<number, OrderLine>): void {
    if (lines.size > 0) this.#quietly(() => this.store.adoptLines(lines));
  }

  /** No save is sent after this, and no answer taken. */
  drop(): void {
    this.#dropped = true;
    this.#cancelTimer();
    this.#unsubscribe();
  }

  #onChange(): void {
    if (this.#muted || this.#dropped || !this.store.dirty) return;
    this.store.markPersisted();
    this.#unsaved = true;
    this.#cancelTimer();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#save();
    }, DRAFT_SAVE_DELAY_MS);
  }

  #cancelTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /** `closing` is the sign-out's own save, queued just before {@link close} shuts the queue. */
  #save(signal?: AbortSignal, closing = false): Promise<DraftSaveOutcome> {
    this.#queue = this.#queue
      .then(() => this.#saveNow(signal, closing))
      .catch((): DraftSaveOutcome => "failed");
    return this.#queue;
  }

  async #saveNow(signal: AbortSignal | undefined, closing: boolean): Promise<DraftSaveOutcome> {
    if (this.#dropped || (this.#closed && !closing)) return "failed";
    if (!this.#unsaved) return "saved";
    const read = this.#reads;
    const lines = this.store.lines.map((line) => toDraftLineInput(line));
    this.#unsaved = false;
    const limit = limited(this.#options.requestLimitMs, signal);
    let saved: Draft;
    this.#saving = true;
    try {
      saved = await this.#options.api.saveDraft(
        this.visitId,
        { draftId: this.#draftId, revision: this.#revision, lines },
        { signal: limit.signal },
      );
    } catch (error) {
      if (this.#dropped || read !== this.#reads) return "failed";
      return await this.#refused(error);
    } finally {
      this.#saving = false;
      limit.done();
    }
    if (this.#dropped || read !== this.#reads) return "failed";
    if (this.#unsaved) this.#take(saved);
    else if (sameLines(lines, saved.lines)) this.#keep(saved);
    else this.#show(saved);
    return "saved";
  }

  /** A refusal of the draft itself shows the server's draft; after any other, and after no answer,
   * the edits stay unsaved, so the next flush sends them again. */
  async #refused(error: unknown): Promise<DraftSaveOutcome> {
    const refusal = asRefusal(error);
    if (refusal === undefined) {
      this.#unsaved = true;
      return "failed";
    }
    if (DRAFT_REFUSALS.has(refusal.refused)) await this.load();
    else this.#unsaved = true;
    this.#options.onRefused(refusal.refused, refusal.ownerName);
    return refusal;
  }

  #take(draft: Draft | null): void {
    this.#draftId = draft?.id ?? null;
    this.#revision = draft?.revision ?? 0;
    this.#lineIds = draft?.lines.map((line) => line.id) ?? [];
  }

  /** The server's draft is the store's lines, which stay, with the server's flag on each. */
  #keep(draft: Draft): void {
    this.#take(draft);
    this.#quietly(() =>
      this.store.setUnavailableOnServer(draft.lines.map((line) => line.unavailable)),
    );
  }

  /** The server's draft replaces what the store holds. */
  #show(draft: Draft | null): void {
    this.#take(draft);
    this.#unsaved = false;
    const lines = draft === null ? [] : this.#options.rebuild(draft.lines);
    this.#quietly(() => this.store.loadFrom(this.store.id, lines));
    this.#options.onReplaced?.();
  }

  #quietly(change: () => void): void {
    this.#muted = true;
    try {
      change();
    } finally {
      this.#muted = false;
      this.store.markPersisted();
    }
  }
}
