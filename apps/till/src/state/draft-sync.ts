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
}

/** `failed`: no answer, and the edits stay unsaved. `refused` names the refusal. */
export type DraftSaveOutcome = "saved" | "failed" | { refused: string };

export interface DraftSyncOptions {
  api: Pick<TillApi, "listDrafts" | "saveDraft">;
  visitId: string;
  personId: string;
  /** The saved lines as the till shows them, from the table's offers. */
  rebuild: (lines: readonly DraftLine[]) => OrderLine[];
  /** A save was refused. When the draft itself was, the drafts have been read again first. */
  onRefused: (code: string) => void;
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
  #last: DraftSaveOutcome = "saved";
  #queue: Promise<DraftSaveOutcome> = Promise.resolve("saved");
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

  /** The saved ids of the lines at `positions`, or null while the store holds edits not saved. */
  lineIds(positions: readonly number[]): string[] | null {
    if (this.#unsaved || this.#lineIds.length !== this.store.lineCount) return null;
    return positions.map((position) => this.#lineIds[position]!);
  }

  /** Reads the party's drafts and shows the person's own; false when they could not be read. */
  async load(): Promise<boolean> {
    const read = ++this.#reads;
    this.#cancelTimer();
    let drafts: Draft[];
    try {
      drafts = await this.#options.api.listDrafts(this.visitId);
    } catch {
      return false;
    }
    if (this.#dropped || read !== this.#reads) return false;
    const own = drafts.find((draft) => draft.ownerId === this.personId) ?? null;
    this.others = drafts.filter((draft) => draft !== own);
    this.#show(own);
    return true;
  }

  /** Sends any unsaved edit now; resolves once every save has answered, with the last outcome. */
  flush(): Promise<DraftSaveOutcome> {
    this.#cancelTimer();
    return this.#save();
  }

  /** After a submission answered: the `sent` lines leave, and the rest are taken as the server's
   * `draft` when they match it, or replaced by it when they do not. */
  submitted(draft: Draft | null, sent: readonly OrderLine[]): void {
    this.#quietly(() => this.store.removeLines(sent));
    const kept = this.store.lines.map((line) => toDraftLineInput(line));
    if (draft !== null && sameLines(kept, draft.lines)) this.#take(draft);
    else this.#show(draft);
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

  #save(): Promise<DraftSaveOutcome> {
    this.#queue = this.#queue.then(() => this.#saveNow()).catch((): DraftSaveOutcome => "failed");
    return this.#queue;
  }

  async #saveNow(): Promise<DraftSaveOutcome> {
    if (this.#dropped) return "failed";
    if (!this.#unsaved) return this.#last;
    const read = this.#reads;
    const lines = this.store.lines.map((line) => toDraftLineInput(line));
    this.#unsaved = false;
    let saved: Draft;
    try {
      saved = await this.#options.api.saveDraft(this.visitId, {
        draftId: this.#draftId,
        revision: this.#revision,
        lines,
      });
    } catch (error) {
      if (this.#dropped || read !== this.#reads) return "failed";
      this.#last = await this.#refused(error);
      return this.#last;
    }
    if (this.#dropped || read !== this.#reads) return "failed";
    if (!this.#unsaved && !sameLines(lines, saved.lines)) this.#show(saved);
    else this.#take(saved);
    this.#last = "saved";
    return this.#last;
  }

  async #refused(error: unknown): Promise<DraftSaveOutcome> {
    const code = (error as { code?: unknown } | undefined)?.code;
    if (typeof code !== "string") {
      this.#unsaved = true;
      return "failed";
    }
    if (DRAFT_REFUSALS.has(code)) await this.load();
    this.#options.onRefused(code);
    return { refused: code };
  }

  #take(draft: Draft | null): void {
    this.#draftId = draft?.id ?? null;
    this.#revision = draft?.revision ?? 0;
    this.#lineIds = draft?.lines.map((line) => line.id) ?? [];
  }

  /** The server's draft replaces what the store holds. */
  #show(draft: Draft | null): void {
    this.#take(draft);
    this.#unsaved = false;
    this.#last = "saved";
    const lines = draft === null ? [] : this.#options.rebuild(draft.lines);
    this.#quietly(() => this.store.loadFrom(this.store.id, lines));
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
