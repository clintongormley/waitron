import { compareDecimal, decimal, subtractDecimal } from "@waitron/shared";
import { assertQuantityPrecision } from "@waitron/catalogue/src/unit-validation.js";
import { productUnit } from "../widgets/product-name.js";
import { trimQuantity } from "../widgets/dish-format.js";
import {
  isNetworkFailure,
  type Draft,
  type DraftLine,
  type DraftLineInput,
  type BillEditExpected,
  type BillEditState,
  type BillDraftSnapshot,
  type TillApi,
  type TillProduct,
  type WorkingOrderStatus,
} from "../api/client.js";
import { toDraftLineInput } from "./draft-lines.js";
import { WorkingOrderStore, type LineSelection, type OrderLine } from "./working-order.js";
import type { placeFor } from "./draft-place.js";

/** How long after a person's last edit their draft is saved. */
export const DRAFT_SAVE_DELAY_MS = 400;

/** The refusals that mean the till's copy of the draft is no longer the server's. */
export const DRAFT_REFUSALS: ReadonlySet<string> = new Set([
  "draft.out_of_date",
  "draft.taken_over",
  "draft.not_found",
  "draft.already_submitted",
]);

export const DRAFT_PERSON_REFUSAL = "draft.person_not_signed_in";

/** A table draft: a tap adds into a line that orders the same thing, as the server's save does. */
export class DraftStore extends WorkingOrderStore {
  #billStatus: WorkingOrderStatus = "open";
  #ownershipLocked = false;

  set ownershipLocked(value: boolean) {
    if (value === this.#ownershipLocked) return;
    this.#ownershipLocked = value;
    this.emit("changed");
  }

  get billStatus(): WorkingOrderStatus {
    return this.#billStatus;
  }

  set billStatus(status: WorkingOrderStatus) {
    if (status === this.#billStatus) return;
    this.#billStatus = status;
    this.emit("changed");
  }

  get compositionLocked(): boolean {
    return this.#ownershipLocked || super.editsLocked;
  }

  override get editsLocked(): boolean {
    return this.compositionLocked || this.#billStatus !== "open";
  }

  declare placer?: (courseId: string | null, exceptIndex?: number) => ReturnType<typeof placeFor>;
  cancelSource?: (line: OrderLine, quantity: string) => void;

  override removeLine(index: number): void {
    const line = this.lines[index];
    if (line?.source === undefined) {
      super.removeLine(index);
      return;
    }
    if (!this.sending && !this.editsLocked) this.cancelSource?.(line, line.quantity);
  }

  override setLineQuantity(index: number, quantity: string): void {
    const line = this.lines[index];
    if (
      line?.source === undefined ||
      compareDecimal(decimal(quantity), decimal(line.quantity)) >= 0
    ) {
      super.setLineQuantity(index, quantity);
      return;
    }
    if (this.sending || this.editsLocked) return;
    assertQuantityPrecision(quantity, productUnit(line.product).precision, { positive: true });
    this.cancelSource?.(
      line,
      trimQuantity(subtractDecimal(decimal(line.quantity), decimal(quantity))),
    );
  }

  override setLineDetails(
    index: number,
    update: Parameters<WorkingOrderStore["setLineDetails"]>[1],
  ): boolean {
    const line = this.lines[index];
    if (
      line?.source !== undefined &&
      compareDecimal(decimal(update.quantity), decimal(line.quantity)) < 0
    ) {
      this.setLineQuantity(index, update.quantity);
      return false;
    }
    return super.setLineDetails(index, update);
  }

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

export type TakeOverOutcome = "taken" | "failed" | "unsaved" | DraftRefused;

/** `reloaded` says whether the read after the take-over counted; the bill's own row and edit state
 * come from the take-over's answer either way. */
export type TakeOverOnOutcome = { taken: true; reloaded: boolean } | DraftRefused | "failed";

export type DraftCommandOutcome<T> =
  { applied: T; reloaded: boolean } | "failed" | "unsaved" | DraftRefused;

export interface DraftCommandState {
  draftId: string | null;
  revision: number;
  personId: string;
  expectedEdit: BillEditExpected;
}

export interface RetainedDraftCandidate {
  personId: string;
  partyId: string;
  billId: string;
  base: BillEditExpected;
  lines: readonly OrderLine[];
  localGeneration: number;
}

export interface DraftSyncOptions {
  api: Pick<TillApi, "listDrafts" | "saveDraft" | "takeOverDraft">;
  partyId: string;
  billId: string;
  personId: string;
  /** The saved lines as the till shows them, from the table's offers. */
  rebuild: (lines: readonly DraftLine[]) => OrderLine[];
  /** A save was refused, or a take-over, recall or split was refused for its person. When a save's
   * draft itself was refused, the drafts have been read again first; a person refusal reads nothing. */
  onRefused: (code: string, ownerName?: string) => void;
  /** The server's draft has replaced what the store held. */
  onReplaced?: () => void;
  onSaved?: () => void;
  /** How long one read or save may stay out before it is cut off. */
  requestLimitMs: number;
  candidates?: Map<string, RetainedDraftCandidate>;
}

/**
 * How long the till waits on a request it bounds, its automatic resends included, before cancelling
 * it. It is above the server watchdog's kill bound (`WATCHDOG_KILL_MS` plus
 * `STACK_CAPTURE_MS`, `packages/store/src/venue-liveness.ts`), so a server whose main thread had
 * stopped when the wait began is killed before the till gives up.
 */
export const TABLE_REQUEST_LIMIT_MS = 150_000;

export interface DraftReadBounds {
  /** Instead of a request's limit: the read and its waits for any save that is out, together. */
  limitMs?: number;
  /** Each wait for a save, alone: past it the read answers false with nothing sent. */
  waitLimitMs?: number;
  /** Ends the waits and the read early. */
  stop?: AbortSignal;
}

/** A signal that aborts after `ms`, or with `also`; `done` clears the timer. */
export function limited(ms: number, also?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const own = new AbortController();
  const timer = setTimeout(() => own.abort(), ms);
  return {
    signal: also === undefined ? own.signal : AbortSignal.any([own.signal, also]),
    done: () => clearTimeout(timer),
  };
}

/** Settles when `signal` aborts, or after `ms` when given. */
export function pause(signal: AbortSignal, ms?: number): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = ms === undefined ? undefined : setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** How many times a submission that got no answer is sent again under the same submission id,
 * within the wait its caller's signal bounds; the server answers a repeat as it answered the first
 * (D8). A send cut off by that signal is not sent again. */
export const SUBMIT_RETRIES = 2;

/** The wait before a submission that got no answer is sent again. */
export const SUBMIT_RETRY_PAUSE_MS = 500;

/** A request that got no answer is sent again unchanged after a pause, until `signal` ends the wait
 * or `live` turns false: the operator's session may have ended and the next person signed in.
 * `onUnanswered` is called after each attempt that got no answer, before the pause or the rethrow,
 * since only the last attempt's error is thrown and an earlier attempt may have been recorded. */
export async function resendUnanswered<T>(
  send: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  live: () => boolean,
  onUnanswered?: () => void,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send(signal);
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
      onUnanswered?.();
      if (signal.aborted || attempt === SUBMIT_RETRIES) throw error;
      await pause(signal, SUBMIT_RETRY_PAUSE_MS);
      if (signal.aborted || !live()) throw error;
    }
  }
}

/** A coded refusal, with the new owner's name when it carries one; undefined for no answer. */
export function asRefusal(error: unknown): DraftRefused | undefined {
  const { code, ownerName } = (error ?? {}) as { code?: unknown; ownerName?: unknown };
  if (typeof code !== "string") return undefined;
  return typeof ownerName === "string" ? { refused: code, ownerName } : { refused: code };
}

/** What a line orders, with its answers and picks in a fixed order. */
function lineKey(input: DraftLineInput): string {
  return JSON.stringify([
    input.sourceLineId ?? null,
    input.menuItemId,
    input.variantId,
    input.menuVersionId,
    input.note,
    input.courseId,
    input.makeAt ?? null,
    input.sourceLineId == null ? input.noMerge : true,
    input.slot,
    input.joinGroupId,
    input.afterGroupId,
    (input.options ?? []).map((answer) => `${answer.listId} ${answer.labelId}`).sort(),
    (input.extras ?? [])
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

export class DraftSync {
  readonly store = new DraftStore();
  readonly partyId: string;
  readonly billId: string;
  readonly personId: string;
  /** Other people's open drafts on this bill, as last read. */
  others: Draft[] = [];
  /** Every bill's open drafts in the party, as last read. */
  partyDrafts: Draft[] = [];
  readonly #options: DraftSyncOptions;
  readonly #candidates: Map<string, RetainedDraftCandidate>;
  #edit: BillEditState | null = null;
  #billEdits: BillEditState[] = [];
  #authoritative: Draft | null = null;
  #localGeneration = 0;
  #draftId: string | null = null;
  #revision = 0;
  /** The line ids the server last answered, by position. */
  #lineIds: string[] = [];
  /** An edit not yet sent in a save. */
  #unsaved = false;
  #queue: Promise<DraftSaveOutcome> = Promise.resolve("saved");
  #savesQueued = 0;
  /** The read after a refused save is out inside the queue, so that save no longer holds reads back. */
  #readingInQueue = false;
  /** Aborted when a read waiting for a save has reason to look again. */
  #readWake = new AbortController();
  /** A save is out. */
  #saving = false;
  /** Signing out: no save starts after this. */
  #closed = false;
  #timer?: ReturnType<typeof setTimeout>;
  #reads = 0;
  #muted = false;
  #dropped = false;
  #commanding = false;
  #commandAbort?: AbortController;
  #recoveryRequired = false;
  #correctingPlaces = false;
  #saveAfterSend = false;
  #unlockRecovery?: () => void;
  readonly #unsubscribe: () => void;

  constructor(options: DraftSyncOptions) {
    this.#options = options;
    this.partyId = options.partyId;
    this.billId = options.billId;
    this.personId = options.personId;
    this.#candidates = options.candidates ?? new Map();
    this.store.ownershipLocked = true;
    this.#unsubscribe = this.store.subscribe(() => this.#onChange());
  }

  get generation(): number {
    return this.#reads;
  }

  get edit(): BillEditState | null {
    return this.#edit === null ? null : { ...this.#edit };
  }

  get expectedEdit(): BillEditExpected | null {
    return this.expectedEditFor(this.billId);
  }

  expectedEditFor(billId: string): BillEditExpected | null {
    const edit =
      billId === this.billId ? this.#edit : this.#billEdits.find((edit) => edit.billId === billId);
    return edit == null
      ? null
      : {
          billId: edit.billId,
          editorVersion: edit.editorVersion,
          draftId: edit.draftId,
          draftRevision: edit.draftRevision,
        };
  }

  get #candidateKey(): string {
    return JSON.stringify([this.personId, this.billId]);
  }

  get candidate(): RetainedDraftCandidate | null {
    return this.#candidates.get(this.#candidateKey) ?? null;
  }

  retainCandidate(): void {
    if (this.candidate !== null) return;
    const base = this.expectedEdit;
    if (base === null || (!this.#unsaved && !this.#saving)) return;
    this.#candidates.set(this.#candidateKey, {
      personId: this.personId,
      partyId: this.partyId,
      billId: this.billId,
      base,
      lines: structuredClone([...this.store.lines]),
      localGeneration: this.#localGeneration,
    });
    this.#lockAuthority();
  }

  resolveCandidate(reviewedLines: readonly OrderLine[] | null): void {
    if (this.candidate === null || this.#ended) return;
    const expected = this.expectedEdit;
    if (reviewedLines !== null) {
      if (
        expected === null ||
        this.#billRefusal !== undefined ||
        this.#recoveryRequired ||
        (this.#edit!.editorId !== null && this.#edit!.editorId !== this.personId)
      )
        return;
      const sources = new Map(this.#authoritative?.lines.map((line) => [line.id, line]) ?? []);
      for (const line of reviewedLines) {
        if (line.source === undefined) continue;
        const source = line.draftLineId === undefined ? undefined : sources.get(line.draftLineId);
        if (source?.sourceLineId !== line.source.line.id) {
          this.#options.onRefused("draft.out_of_date");
          return;
        }
      }
    }
    this.#candidates.delete(this.#candidateKey);
    if (reviewedLines === null && (this.#recoveryRequired || this.#unsaved))
      this.#show(this.#authoritative);
    this.#lockAuthority();
    if (reviewedLines !== null) {
      this.#quietly(() => this.store.loadFrom(this.store.id, structuredClone([...reviewedLines])));
      this.#unsaved = true;
      this.#localGeneration++;
    }
  }

  applyBillSnapshot(snapshot: BillDraftSnapshot, generation: number): void {
    if (this.#ended || generation !== this.#reads || snapshot.edit.billId !== this.billId) return;
    if (this.#olderEdit(snapshot.edit)) return;
    const unchanged = this.#sameEdit(snapshot.edit);
    if (!unchanged) this.retainCandidate();
    this.#edit = { ...snapshot.edit };
    this.#authoritative = snapshot.draft;
    this.others =
      snapshot.draft !== null && snapshot.edit.editorId !== this.personId ? [snapshot.draft] : [];
    if (!unchanged || this.candidate !== null) this.#show(snapshot.draft);
    else if (!this.#unsaved && !this.#saving && snapshot.draft !== null) this.#keep(snapshot.draft);
    this.#lockAuthority();
  }

  #sameEdit(edit: BillEditExpected): boolean {
    const current = this.#edit;
    return (
      current !== null &&
      edit.billId === current.billId &&
      edit.editorVersion === current.editorVersion &&
      edit.draftId === current.draftId &&
      edit.draftRevision === current.draftRevision
    );
  }

  #olderEdit(edit: BillEditExpected, current: BillEditExpected | null = this.#edit): boolean {
    return (
      current !== null &&
      (edit.editorVersion < current.editorVersion ||
        (edit.editorVersion === current.editorVersion &&
          (edit.draftRevision ?? -1) < (current.draftRevision ?? -1)))
    );
  }

  #lockAuthority(): void {
    this.store.ownershipLocked =
      this.#ended ||
      this.#recoveryRequired ||
      this.#edit === null ||
      (this.#edit.editorId !== null && this.#edit.editorId !== this.personId) ||
      this.candidate !== null;
  }

  get #editorRefusal(): DraftRefused | undefined {
    return this.#edit?.editorId != null && this.#edit.editorId !== this.personId
      ? {
          refused: "draft.taken_over",
          ...(this.#edit.editorName === null ? {} : { ownerName: this.#edit.editorName }),
        }
      : undefined;
  }

  get billStatus(): WorkingOrderStatus {
    return this.store.billStatus;
  }

  set billStatus(status: WorkingOrderStatus) {
    if (status === this.store.billStatus) return;
    this.#cancelTimer();
    this.store.billStatus = status;
    if (status === "open" && this.#unsaved) this.#scheduleSaveOfEdit();
  }

  get #billRefusal(): DraftRefused | undefined {
    if (this.billStatus === "open") return undefined;
    return {
      refused:
        this.billStatus === "placed"
          ? "bill.presented"
          : this.billStatus === "settled"
            ? "bill.paid"
            : "tab.not_open",
    };
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

  /** An edit of this till's own not yet saved: waiting, out, or kept as the candidate. */
  get ownEditWaiting(): boolean {
    return this.#unsaved || this.#saving || this.candidate !== null;
  }

  /** The saved ids of the lines at `positions`, or null while the store holds edits not saved. */
  lineIds(positions: readonly number[]): string[] | null {
    if (this.#unsaved || this.#lineIds.length !== this.store.lineCount) return null;
    return positions.map((position) => this.#lineIds[position]!);
  }

  /** A read never turns a retained local candidate into saved work. Its answer counts only if no
   * save was queued while it was out: one answering after the server took a save but before that
   * save's answer would look like someone else's change. */
  async load(bounds?: DraftReadBounds): Promise<boolean> {
    const limitMs = bounds?.limitMs ?? this.#options.requestLimitMs;
    const limit = limited(limitMs, bounds?.stop);
    try {
      const read = await this.#loadBetweenSaves(
        limitMs,
        bounds?.waitLimitMs ?? limitMs,
        limit.signal,
      );
      if (!read && this.#unsaved) this.#scheduleSave();
      return read;
    } finally {
      limit.done();
    }
  }

  async #loadBetweenSaves(
    limitMs: number,
    waitLimitMs: number,
    stop: AbortSignal,
  ): Promise<boolean> {
    for (;;) {
      const wait = limited(waitLimitMs, stop);
      while (this.#saveAhead && !this.#readDeclined && !wait.signal.aborted)
        await Promise.race([
          this.#queue,
          pause(AbortSignal.any([wait.signal, this.#readWake.signal])),
        ]);
      wait.done();
      if (stop.aborted || this.#saveAhead || this.#readDeclined) return false;
      const queue = this.#queue;
      const read = await this.#load({ limitMs, stop }, () => queue !== this.#queue);
      if (queue === this.#queue) return read;
    }
  }

  get #saveAhead(): boolean {
    return this.#savesQueued > (this.#readingInQueue ? 1 : 0);
  }

  get #readDeclined(): boolean {
    return this.#ended || this.#commanding || this.#correctingPlaces;
  }

  #wakeWaitingReads(): void {
    this.#readWake.abort();
    this.#readWake = new AbortController();
  }

  async #load(bounds?: DraftReadBounds, stale?: () => boolean): Promise<boolean> {
    const read = ++this.#reads;
    this.#cancelTimer();
    const stops = [this.#commandAbort?.signal, bounds?.stop].filter((stop) => stop !== undefined);
    const limit = limited(
      bounds?.limitMs ?? this.#options.requestLimitMs,
      stops.length === 0 ? undefined : AbortSignal.any(stops),
    );
    let answer;
    try {
      // What a read answers past its limit goes nowhere, whether or not its request stopped.
      answer = await Promise.race([
        this.#options.api.listDrafts(this.partyId, { signal: limit.signal }),
        pause(limit.signal).then(() => {
          throw new DOMException("A drafts read ended", "AbortError");
        }),
      ]);
    } catch {
      return false;
    } finally {
      limit.done();
    }
    if (
      this.#dropped ||
      (this.#commanding && this.#closed) ||
      read !== this.#reads ||
      stale?.() === true
    )
      return false;
    const edit = answer.billEdits.find((edit) => edit.billId === this.billId);
    if (edit === undefined) return false;
    if (this.#olderEdit(edit)) return false;
    const draft =
      answer.drafts.find((draft) => draft.id === edit.draftId && draft.billId === this.billId) ??
      null;
    if ((draft === null) !== (edit.draftId === null)) return false;
    const previous = new Map(this.#billEdits.map((edit) => [edit.billId, edit]));
    const newerThanRead = new Set<string>();
    this.#billEdits = answer.billEdits.map((edit) => {
      const known = previous.get(edit.billId);
      if (known === undefined || !this.#olderEdit(edit, known)) return { ...edit };
      newerThanRead.add(edit.billId);
      return known;
    });
    // A bill's rows stay with its edit state, or a read older than a take-over brings the old owner back.
    this.partyDrafts = [
      ...answer.drafts.filter((row) => !newerThanRead.has(row.billId)),
      ...this.partyDrafts.filter((row) => newerThanRead.has(row.billId)),
    ];
    this.applyBillSnapshot({ draft, edit }, read);
    this.#recoveryRequired = false;
    this.#unlockRecovery?.();
    this.#unlockRecovery = undefined;
    this.#lockAuthority();
    if (this.#unsaved) this.#scheduleSave();
    return true;
  }

  /** Sends any unsaved edit now; resolves once every save has answered, with the last outcome, or
   * as `failed` once `signal` aborts, which also cuts off the save this sends. */
  flush(signal?: AbortSignal): Promise<DraftSaveOutcome> {
    if (this.#ended || this.#edit === null || this.candidate !== null)
      return Promise.resolve(this.#editorRefusal ?? "failed");
    if (this.#editorRefusal !== undefined) return Promise.resolve(this.#editorRefusal);
    if (this.#commanding || this.#recoveryRequired || this.#correctingPlaces)
      return Promise.resolve("failed");
    this.#cancelTimer();
    const saved = this.#save(signal);
    if (signal === undefined) return saved;
    return Promise.race([saved, pause(signal).then((): DraftSaveOutcome => "failed")]);
  }

  /** Fence the old identity before a later request or answer can change its saved view. */
  close(): Promise<DraftSaveOutcome> {
    this.retainCandidate();
    this.#commandAbort?.abort();
    this.#cancelTimer();
    this.#closed = true;
    this.#lockAuthority();
    this.#wakeWaitingReads();
    return this.#queue.then(() => (this.#unsaved || this.#saving ? "failed" : "saved"));
  }

  /** After a submission answered: the `sent` lines leave, and the rest are taken as the server's
   * `draft` when they match it, or replaced by it when they do not. */
  submitted(draft: Draft | null, sent: readonly OrderLine[], edit: BillEditState): void {
    if (this.#ended || edit.billId !== this.billId || this.#olderEdit(edit)) return;
    this.#edit = { ...edit };
    this.#authoritative = draft;
    this.#quietly(() => this.store.removeLines(sent));
    const kept = this.store.lines.map((line) => toDraftLineInput(line));
    if (draft !== null && sameLines(kept, draft.lines)) this.#keep(draft);
    else this.#show(draft);
    this.#lockAuthority();
  }

  /** Takeover transfers only the saved outbox; a local candidate stays separate. */
  async takeOver(draftId: string, revision: number): Promise<TakeOverOutcome> {
    if (this.#commanding || this.#recoveryRequired) return "failed";
    const refusal = this.#billRefusal;
    if (refusal !== undefined) return refusal;
    const locked = this.store.sending;
    this.store.sending = true;
    try {
      return await this.#takeOver(draftId, revision);
    } finally {
      this.store.sending = locked;
    }
  }

  async #takeOver(draftId: string, revision: number): Promise<TakeOverOutcome> {
    this.#cancelTimer();
    this.retainCandidate();
    await this.#queue;
    if (this.#ended || this.#recoveryRequired || this.#edit === null) return "failed";
    const refusal = this.#billRefusal;
    if (refusal !== undefined) return refusal;
    const read = this.#reads;
    const limit = limited(this.#options.requestLimitMs);
    let taken: BillDraftSnapshot;
    try {
      taken = await this.#options.api.takeOverDraft(
        this.partyId,
        draftId,
        {
          revision,
          personId: this.personId,
          expectedEdit: this.expectedEdit!,
          submissionId: crypto.randomUUID(),
        },
        {
          signal: limit.signal,
        },
      );
    } catch (error) {
      if (this.#ended) return "failed";
      const refusal = asRefusal(error);
      if (refusal?.refused === DRAFT_PERSON_REFUSAL) {
        this.#recoveryRequired = true;
        this.#lockAuthority();
        return this.#refusedPerson(refusal);
      }
      if (read !== this.#reads) return "failed";
      this.#recoveryRequired = true;
      await this.#load();
      this.#lockAuthority();
      return refusal ?? "failed";
    } finally {
      limit.done();
    }
    if (this.#ended) return "failed";
    this.#unsaved = false;
    this.#recordTakeOver(taken, draftId);
    // Against the latest read, not the one this began under: whichever read overlapped it, the
    // older-edit check keeps the newer of the two, and the server has already said yes.
    this.applyBillSnapshot(taken, this.#reads);
    return "taken";
  }

  /** Takes over a draft on a bill not on screen; the bill on screen keeps `takeOver`. The read goes
   * through `load`, because a read inside a command would end its recovery. */
  async takeOverOn(billId: string, draftId: string, revision: number): Promise<TakeOverOnOutcome> {
    if (this.#ended || this.#correctingPlaces || this.#recoveryRequired || this.store.sending)
      return "failed";
    const expectedEdit = this.expectedEditFor(billId);
    if (expectedEdit === null) return "failed";
    const limit = limited(this.#options.requestLimitMs);
    let taken: BillDraftSnapshot;
    try {
      taken = await this.#options.api.takeOverDraft(
        this.partyId,
        draftId,
        { revision, personId: this.personId, expectedEdit, submissionId: crypto.randomUUID() },
        { signal: limit.signal },
      );
    } catch (error) {
      if (this.#ended) return "failed";
      const refusal = asRefusal(error);
      if (refusal?.refused === DRAFT_PERSON_REFUSAL) return this.#refusedPerson(refusal);
      await this.load();
      return this.#ended ? "failed" : (refusal ?? "failed");
    } finally {
      limit.done();
    }
    if (this.#ended) return "failed";
    this.#recordTakeOver(taken, draftId);
    const reloaded = await this.load();
    return this.#ended ? "failed" : { taken: true, reloaded };
  }

  /** The device's session is someone else's, so a read now would run as them: none is sent. */
  #refusedPerson(refusal: DraftRefused): DraftRefused {
    this.#options.onRefused(refusal.refused);
    return refusal;
  }

  #recordTakeOver({ draft, edit }: BillDraftSnapshot, draftId: string): void {
    if (this.#olderEdit(edit, this.expectedEditFor(edit.billId))) return;
    this.#billEdits = [...this.#billEdits.filter((row) => row.billId !== edit.billId), { ...edit }];
    this.partyDrafts = [
      ...this.partyDrafts.filter((row) => row.id !== draftId),
      ...(draft === null ? [] : [draft]),
    ];
  }

  /** Source commands change stored bill rows and their draft together. No edit or save may use
   * the old draft after the command until an authoritative read succeeds. */
  async runCommand<T>(
    send: (state: DraftCommandState, options: { signal: AbortSignal }) => Promise<T>,
  ): Promise<DraftCommandOutcome<T>> {
    if (
      this.#ended ||
      this.#commanding ||
      this.#recoveryRequired ||
      this.store.sending ||
      this.store.editsLocked
    )
      return "failed";
    this.#commanding = true;
    this.#cancelTimer();
    this.store.sending = true;
    this.#wakeWaitingReads();
    const abort = new AbortController();
    this.#commandAbort = abort;
    const limit = limited(this.#options.requestLimitMs, abort.signal);
    try {
      const saved = await this.#save(limit.signal);
      if (this.#ended) return "failed";
      if (saved !== "saved") return "unsaved";
      this.#recoveryRequired = true;
      let applied: T;
      try {
        applied = await send(
          {
            draftId: this.#draftId,
            revision: this.#revision,
            personId: this.personId,
            expectedEdit: this.expectedEdit!,
          },
          { signal: limit.signal },
        );
      } catch (error) {
        if (this.#ended) return "failed";
        const refusal = asRefusal(error);
        if (refusal?.refused === DRAFT_PERSON_REFUSAL) return this.#refusedPerson(refusal);
        await this.#load();
        return refusal ?? "failed";
      }
      if (this.#ended) return "failed";
      const reloaded = await this.#load();
      return this.#ended ? "failed" : { applied, reloaded };
    } finally {
      limit.done();
      this.#commandAbort = undefined;
      if (this.#recoveryRequired && !this.#ended) this.#unlockRecovery = this.store.lockEdits();
      this.#commanding = false;
      this.store.sending = false;
    }
  }

  /** A target refusal never grants permission to overwrite a newer draft. Keep the local
   * candidate on failed reads and refused correction saves, including revision races. */
  async correctPlaces(
    replacements: ReadonlyMap<number, OrderLine>,
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<DraftSaveOutcome> {
    if (this.#ended || this.#commanding || this.#recoveryRequired || this.#correctingPlaces)
      return "failed";
    this.#correctingPlaces = true;
    this.#cancelTimer();
    this.#wakeWaitingReads();
    const read = this.#reads;
    try {
      await this.#queue;
      const { drafts, billEdits } = await this.#options.api.listDrafts(this.partyId, { signal });
      if (this.#ended || signal.aborted || !live() || read !== this.#reads) return "failed";
      const own = drafts.find(
        (draft) => draft.billId === this.billId && draft.ownerId === this.personId,
      );
      const edit = billEdits.find((edit) => edit.billId === this.billId);
      if (edit === undefined || !this.#sameEdit(edit) || this.#editorRefusal !== undefined) {
        this.retainCandidate();
        return { refused: "draft.out_of_date" };
      }
      if ((own?.id ?? null) !== this.#draftId || (own?.revision ?? 0) !== this.#revision)
        return { refused: "draft.out_of_date" };
      this.#quietly(() => this.store.adoptLines(replacements));
      this.#unsaved = true;
      return await this.#save(signal);
    } catch {
      return "failed";
    } finally {
      this.#correctingPlaces = false;
    }
  }

  /** Replaces the lines at the given positions for display only: the saved draft does not change,
   * so nothing is saved. */
  reshow(lines: ReadonlyMap<number, OrderLine>): void {
    if (lines.size > 0) this.#quietly(() => this.store.adoptLines(lines));
  }

  /** No save is sent after this, and no answer taken. */
  drop(): void {
    this.retainCandidate();
    this.#dropped = true;
    this.#commandAbort?.abort();
    this.#cancelTimer();
    this.#unsubscribe();
    this.#lockAuthority();
    this.#wakeWaitingReads();
  }

  get #ended(): boolean {
    return this.#closed || this.#dropped;
  }

  #onChange(): void {
    if (this.#muted || this.#dropped) return;
    if (this.store.dirty) {
      this.store.markPersisted();
      this.#unsaved = true;
      this.#localGeneration++;
      this.#scheduleSaveOfEdit();
    } else if (this.#saveAfterSend && !this.#sendUnderWay) {
      this.#saveAfterSend = false;
      if (this.#unsaved) this.#scheduleSave();
    }
  }

  get #sendUnderWay(): boolean {
    return this.store.sending || this.#correctingPlaces;
  }

  /** For a new edit, or an edit on a bill that reopens: during a send it waits for the send's end.
   * An edit a read finds still waiting needs no such wait, because the next read tries it again. */
  #scheduleSaveOfEdit(): void {
    this.#saveAfterSend = this.#sendUnderWay;
    this.#scheduleSave();
  }

  #scheduleSave(): void {
    this.#cancelTimer();
    if (this.#ended || this.store.editsLocked || this.#sendUnderWay) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#save();
    }, DRAFT_SAVE_DELAY_MS);
  }

  #cancelTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #save(signal?: AbortSignal): Promise<DraftSaveOutcome> {
    this.#savesQueued++;
    this.#queue = this.#queue
      .then(() => this.#saveNow(signal))
      .catch((): DraftSaveOutcome => "failed")
      .finally(() => this.#savesQueued--);
    return this.#queue;
  }

  async #saveNow(signal: AbortSignal | undefined): Promise<DraftSaveOutcome> {
    if (this.#ended) return "failed";
    if (this.#edit === null || this.candidate !== null) return this.#editorRefusal ?? "failed";
    if (this.#editorRefusal !== undefined) return this.#editorRefusal;
    if (!this.#unsaved) return "saved";
    const refusal = this.#billRefusal;
    if (refusal !== undefined) {
      this.#options.onRefused(refusal.refused);
      return refusal;
    }
    const expectedEdit = this.expectedEdit!;
    const pending = [...this.store.lines];
    const lines = pending.map((line) => toDraftLineInput(line));
    const selections = pending.map((line) => line.sourceSelection);
    this.#unsaved = false;
    const limit = limited(this.#options.requestLimitMs, signal);
    let snapshot: BillDraftSnapshot;
    this.#saving = true;
    try {
      snapshot = await this.#options.api.saveDraft(
        this.partyId,
        {
          billId: this.billId,
          draftId: this.#draftId,
          revision: this.#revision,
          expectedEdit,
          lines,
          personId: this.personId,
        },
        { signal: limit.signal },
      );
    } catch (error) {
      if (this.#ended) return "failed";
      if (!this.#invalidateSave(expectedEdit)) return await this.#refused(error);
      const refusal = asRefusal(error);
      if (refusal?.refused !== DRAFT_PERSON_REFUSAL) return "failed";
      this.#options.onRefused(refusal.refused);
      return refusal;
    } finally {
      this.#saving = false;
      limit.done();
    }
    if (this.#ended || this.#invalidateSave(expectedEdit)) return "failed";
    this.#edit = { ...snapshot.edit };
    this.#authoritative = snapshot.draft;
    const saved = snapshot.draft;
    if (saved === null) {
      this.#show(null);
      this.#lockAuthority();
      return "saved";
    }
    if (this.#unsaved) {
      this.#take(saved);
      this.#attachSavedIds(saved, pending, lines, selections);
    } else if (sameLines(lines, saved.lines)) this.#keep(saved);
    else this.#show(saved);
    this.#lockAuthority();
    this.#options.onSaved?.();
    return "saved";
  }

  #invalidateSave(expected: BillEditExpected): boolean {
    if (this.#sameEdit(expected) && this.candidate === null) return false;
    if (this.candidate === null) {
      this.#unsaved = true;
      this.retainCandidate();
    }
    this.#recoveryRequired = true;
    this.#lockAuthority();
    return true;
  }

  /** A refused arrangement remains separate from the saved outbox returned by recovery. */
  async #refused(error: unknown): Promise<DraftSaveOutcome> {
    const refusal = asRefusal(error);
    if (refusal === undefined) {
      this.#unsaved = true;
      this.retainCandidate();
      this.#recoveryRequired = true;
      this.#lockAuthority();
      await this.#readInQueue();
      return "failed";
    }
    if (DRAFT_REFUSALS.has(refusal.refused)) {
      this.#unsaved = true;
      this.retainCandidate();
      this.#recoveryRequired = true;
      this.#lockAuthority();
      await this.#readInQueue();
    } else this.#unsaved = true;
    this.#options.onRefused(refusal.refused, refusal.ownerName);
    return refusal;
  }

  async #readInQueue(): Promise<void> {
    this.#readingInQueue = true;
    this.#wakeWaitingReads();
    try {
      await this.#load();
    } finally {
      this.#readingInQueue = false;
    }
  }

  #take(draft: Draft | null): void {
    this.#draftId = draft?.id ?? null;
    this.#revision = draft?.revision ?? 0;
    this.#lineIds = draft?.lines.map((line) => line.id) ?? [];
  }

  #attachSavedIds(
    draft: Draft,
    pending: readonly OrderLine[],
    inputs: readonly DraftLineInput[],
    selections: readonly OrderLine["sourceSelection"][],
  ): void {
    const retained = new Set(inputs.flatMap((line) => (line.id === undefined ? [] : [line.id])));
    const available = new Map(draft.lines.map((line) => [line.id, line]));
    for (const [index, line] of pending.entries()) {
      const input = inputs[index]!;
      const candidate =
        input.id === undefined
          ? [...available.values()].find(
              (candidate) => !retained.has(candidate.id) && lineKey(input) === lineKey(candidate),
            )
          : available.get(input.id);
      const saved =
        (candidate?.sourceLineId ?? null) === (input.sourceLineId ?? null) ? candidate : undefined;
      if (saved !== undefined) available.delete(saved.id);
      if (!this.store.lines.includes(line)) continue;
      if (saved === undefined) delete line.draftLineId;
      else {
        line.draftLineId = saved.id;
        this.#refreshSource(line, saved, selections[index]);
      }
    }
  }

  /** The server's draft is the store's lines, which stay, with the server's flag on each. */
  #keep(draft: Draft): void {
    this.#take(draft);
    this.store.lines.forEach((line, index) => {
      line.draftLineId = draft.lines[index]!.id;
      this.#refreshSource(line, draft.lines[index]!, line.sourceSelection);
    });
    this.#quietly(() =>
      this.store.setUnavailableOnServer(draft.lines.map((line) => line.unavailable)),
    );
  }

  #refreshSource(
    line: OrderLine,
    saved: DraftLine,
    selection?: OrderLine["sourceSelection"],
  ): void {
    if (saved.sourceLineId == null) return;
    const rebuilt = this.#options.rebuild([saved])[0];
    if (rebuilt !== undefined)
      this.#quietly(() => this.store.refreshRecalledLine(line, rebuilt, selection));
  }

  /** The server's draft replaces what the store holds. */
  #show(draft: Draft | null): void {
    this.#take(draft);
    this.#unsaved = false;
    const lines = draft === null ? [] : this.#options.rebuild(draft.lines);
    lines.forEach((line, index) => {
      line.draftLineId = draft!.lines[index]!.id;
    });
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
