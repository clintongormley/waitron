import { WAITRON_ID_SISTEMA } from "./software.js";
import {
  readOperationAuthority,
  type OperationAuthority,
  type OperationBinding,
  type ModuleOperationHost,
  type OperationOperator,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { canSelectHour, clockRefusal, type HourClockDecision } from "./hour-clock.js";
import { projectHourHistory, type HourHistorySource, type HourScope } from "./hour-history.js";
import {
  decodeMinuteIdentity,
  encodeMinuteIdentity,
  isMinuteSeriesBases,
  isMinuteIdentity,
} from "./hour-identity.js";

export interface HourSelectionFacts {
  readonly scope: HourScope;
  readonly bases: readonly { readonly code: string; readonly purpose: string }[];
  readonly contextKey: string;
  readonly waitKey?: string;
  readonly clock: HourClockDecision;
  readonly history: readonly HourHistorySource[];
}
export type HourSelectionStore = NonNullable<ModuleOperationHost["withPreparationState"]>;
interface SelectionRequest {
  binding: OperationBinding;
  authority: OperationAuthority;
  comparisonId: string;
}
type BareRequest = Omit<SelectionRequest, "comparisonId">;
interface EntryBase {
  softwareId: string;
  operatorId: OperationOperator;
  binding: OperationBinding;
  scope: HourScope;
  bases: HourSelectionFacts["bases"];
  contextKey: string;
  continuationKey?: string;
}
interface Intent extends EntryBase {
  references: readonly string[];
  kind: "intent";
  identity: string;
  issuedAt: string;
}
interface Wait extends EntryBase {
  kind: "wait";
  targetMs: number;
}
interface Resumption extends Omit<Intent, "kind"> {
  kind: "resume";
  fromContextKey: string;
  documentBinding: string;
}
type Entry = Intent | Wait | Resumption;
type ResumeRequest = BareRequest & {
  documentBinding: string;
  validate(selected: ReturnType<typeof material>): void;
};
const MINUTE_MS = 60_000;
const WAIT_BOUND_MS = 150_000;
const SETTLE_MS = 90_000;
const WAIT_REUSE_MS = 60_000;
const EPOCH_MS = Date.parse("2026-01-01T00:00:00Z");
const END_MS = EPOCH_MS + 32 ** 5 * MINUTE_MS;
function refuse(
  reason: string,
  wait?: { allowedFromMs: number; remainingMs: number; recheckInMs: number },
): never {
  throw new AppError("sif.allocation_invalid", { reason, ...wait });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function validBinding(value: unknown): value is OperationBinding {
  return (
    record(value) &&
    ["module", "action", "eventId", "sourceId", "targetNodeId"].every((key) => text(value[key]))
  );
}
function ordered(bases: HourSelectionFacts["bases"]) {
  return bases
    .map(({ code, purpose }) => ({ code, purpose }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
function validBases(value: unknown): value is HourSelectionFacts["bases"] {
  return (
    Array.isArray(value) &&
    value.every(
      (base) => record(base) && typeof base.code === "string" && typeof base.purpose === "string",
    ) &&
    isMinuteSeriesBases(value)
  );
}
function validScope(value: unknown): value is HourScope {
  return (
    record(value) &&
    text(value.taxpayerNif) &&
    (value.environment === "production" || value.environment === "preproduction")
  );
}
function parseState(value: unknown): Entry[] {
  if (value === null) return [];
  if (!record(value) || value.version !== 1 || !Array.isArray(value.entries))
    return refuse("history_invalid");
  const keys = new Set<string>();
  for (const entry of value.entries) {
    if (
      !record(entry) ||
      !validBinding(entry.binding) ||
      !(
        text(entry.operatorId) ||
        (record(entry.operatorId) &&
          entry.operatorId.kind === "recovery-key" &&
          Object.keys(entry.operatorId).length === 3 &&
          entry.operatorId.nodeId === entry.binding.targetNodeId &&
          entry.operatorId.eventId === entry.binding.eventId)
      ) ||
      !validScope(entry.scope) ||
      !validBases(entry.bases) ||
      !text(entry.contextKey) ||
      (entry.continuationKey !== undefined && !text(entry.continuationKey)) ||
      !text(entry.softwareId)
    )
      return refuse("history_invalid");
    if (entry.kind === "intent" || entry.kind === "resume") {
      if (
        !Array.isArray(entry.references) ||
        !entry.references.every(text) ||
        !isMinuteIdentity(entry.identity) ||
        typeof entry.issuedAt !== "string" ||
        !Number.isFinite(Date.parse(entry.issuedAt)) ||
        Date.parse(entry.issuedAt) < EPOCH_MS ||
        Date.parse(entry.issuedAt) >= END_MS ||
        encodeMinuteIdentity(Date.parse(entry.issuedAt)) !== entry.identity
      )
        return refuse("history_invalid");
      if (
        entry.kind === "resume" &&
        (!text(entry.fromContextKey) ||
          entry.fromContextKey === entry.contextKey ||
          !text(entry.continuationKey) ||
          typeof entry.documentBinding !== "string" ||
          !/^[a-f0-9]{64}$/.test(entry.documentBinding))
      )
        return refuse("history_invalid");
    } else if (entry.kind === "wait") {
      if (
        !Number.isSafeInteger(entry.targetMs) ||
        (entry.targetMs as number) < EPOCH_MS ||
        (entry.targetMs as number) > END_MS ||
        (entry.targetMs as number) % MINUTE_MS !== 0
      )
        return refuse("history_invalid");
    } else return refuse("history_invalid");
    const key = entryKey(entry as unknown as Entry);
    if (keys.has(key)) return refuse("history_invalid");
    keys.add(key);
  }
  return structuredClone(value.entries) as Entry[];
}
function entryKey(entry: Entry) {
  return JSON.stringify([
    entry.binding.module,
    entry.binding.eventId,
    entry.kind,
    ...(entry.kind === "resume" ? [entry.contextKey] : []),
    ...(entry.kind === "wait" ? [entry.targetMs] : []),
  ]);
}
export function conflictPreparationStatus(
  values: readonly unknown[],
  binding: OperationBinding,
): { kind: "none" | "restart-required" } {
  let selected = false;
  for (const value of values)
    for (const entry of parseState(value)) {
      if (entry.binding.module !== binding.module || entry.binding.eventId !== binding.eventId)
        continue;
      if (
        entry.binding.action !== binding.action ||
        entry.binding.sourceId !== binding.sourceId ||
        entry.binding.targetNodeId !== binding.targetNodeId
      )
        return refuse("event_mismatch");
      if (entry.kind !== "wait") selected = true;
    }
  return { kind: selected ? "restart-required" : "none" };
}
export function publicHourSelectionHistory(values: readonly unknown[]): HourHistorySource {
  return {
    reference: "prepared-hours",
    complete: true,
    records: [
      ...values.flatMap((value) =>
        parseState(value)
          .filter((entry): entry is Intent => entry.kind === "intent")
          .map((entry) => ({
            taxpayerNif: entry.scope.taxpayerNif,
            environment: entry.scope.environment,
            reference: `intent/${entry.binding.module}/${entry.binding.eventId}`,
            kind: "intent",
            softwareId: entry.softwareId,
            nodeId: entry.binding.targetNodeId,
            identity: entry.identity,
            recordedAtMs: Date.parse(entry.issuedAt),
          })),
      ),
    ],
  };
}
function fingerprint(entry: EntryBase): string {
  return JSON.stringify([
    entry.binding.module,
    entry.binding.action,
    entry.binding.eventId,
    entry.binding.sourceId,
    entry.binding.targetNodeId,
    entry.scope.taxpayerNif,
    entry.scope.environment,
    ordered(entry.bases),
    entry.contextKey,
    entry.continuationKey ?? null,
    entry.softwareId,
    typeof entry.operatorId === "string"
      ? entry.operatorId
      : [entry.operatorId.kind, entry.operatorId.nodeId, entry.operatorId.eventId],
  ]);
}
function material(intent: Intent) {
  return { status: "selected" as const, ...structuredClone(intent) };
}

function resumedIntent(entries: readonly Entry[]) {
  const original = entries.find((entry): entry is Intent => entry.kind === "intent");
  const resumptions = entries.filter((entry): entry is Resumption => entry.kind === "resume");
  let intent = original;
  for (const resumed of resumptions) {
    if (
      intent === undefined ||
      resumed.fromContextKey !== intent.contextKey ||
      fingerprint({ ...resumed, contextKey: intent.contextKey }) !== fingerprint(intent) ||
      resumed.documentBinding !== resumptions[0]!.documentBinding ||
      resumed.identity !== intent.identity ||
      resumed.issuedAt !== intent.issuedAt ||
      JSON.stringify([...resumed.references].sort()) !==
        JSON.stringify([...intent.references].sort())
    )
      return refuse("history_invalid");
    intent = { ...intent, contextKey: resumed.contextKey };
  }
  return intent;
}

export function createHourSelection(options: {
  withState: HourSelectionStore;
  read(binding: OperationBinding, comparisonId?: string): Promise<HourSelectionFacts>;
  readCommitted?(binding: OperationBinding): Promise<Omit<HourSelectionFacts, "clock">>;
  monotonicNow(): number;
  onNewIntent?(selection: ReturnType<typeof material>): void;
}) {
  // Monotonic readings are process-local; persisted waits carry only their original UTC target.
  const timers = new Map<string, { start: number; duration: number }>();
  const perform = async (
    supplied: BareRequest & { comparisonId?: string } & Partial<ResumeRequest>,
    mode: "select" | "preview" | "selected" | "resume" | "committed",
  ) => {
    const persist = mode === "select";
    const request = {
      ...supplied,
      binding: { ...supplied.binding },
    };
    const authorize = () => {
      const operator = readOperationAuthority(request.authority, request.binding);
      if (
        request.binding.module !== "fiscal-verifactu" ||
        !["setup", "restore", "promote", "conflict-switch"].includes(request.binding.action) ||
        operator === undefined
      )
        refuse("reauthentication_required");
      return operator!.operatorId;
    };
    const operatorId = authorize();
    if (mode === "select" && !text(request.comparisonId)) refuse("event_mismatch");
    return options.withState(request.binding, async (state) => {
      authorize();
      const fresh: Omit<HourSelectionFacts, "clock"> & Partial<Pick<HourSelectionFacts, "clock">> =
        mode === "committed" && options.readCommitted !== undefined
          ? await options.readCommitted({ ...request.binding })
          : await options.read({ ...request.binding }, request.comparisonId);
      authorize();
      if (
        !validScope(fresh.scope) ||
        !validBases(fresh.bases) ||
        !text(fresh.contextKey) ||
        (fresh.waitKey !== undefined && !text(fresh.waitKey))
      )
        return refuse("event_mismatch");
      if (fresh.history.length === 0) return refuse("history_invalid");
      const facts = {
        ...fresh,
        scope: { ...fresh.scope },
        bases: ordered(fresh.bases),
        history: structuredClone(fresh.history),
      };
      if (!Array.isArray(state.history)) return refuse("history_invalid");
      const retained = new Map<string, Entry>();
      for (const value of [state.value, ...state.history]) {
        for (const entry of parseState(value)) {
          const key = entryKey(entry);
          const prior = retained.get(key);
          const detail = (value: Entry) =>
            JSON.stringify([
              fingerprint(value),
              value.kind !== "wait"
                ? [value.identity, value.issuedAt, [...value.references].sort()]
                : value.targetMs,
              ...(value.kind === "resume" ? [value.fromContextKey, value.documentBinding] : []),
            ]);
          if (prior !== undefined && detail(prior) !== detail(entry))
            return refuse("history_invalid");
          retained.set(key, entry);
        }
      }
      const entries = [...retained.values()];
      const events = new Map<string, Entry[]>();
      for (const entry of entries) {
        const key = JSON.stringify([entry.binding.module, entry.binding.eventId]);
        const group = events.get(key) ?? [];
        group.push(entry);
        events.set(key, group);
      }
      for (const group of events.values()) resumedIntent(group);
      const sameEvent = entries.filter(
        (entry) =>
          entry.binding.module === request.binding.module &&
          entry.binding.eventId === request.binding.eventId,
      );
      const original = sameEvent.find((entry): entry is Intent => entry.kind === "intent");
      const resumptions = sameEvent.filter((entry): entry is Resumption => entry.kind === "resume");
      const intent = resumedIntent(sameEvent);
      if (["selected", "resume", "committed"].includes(mode) && intent === undefined)
        return refuse("reservation_missing");
      if (
        mode === "resume" &&
        (request.binding.action !== "setup" ||
          intent!.continuationKey === undefined ||
          typeof request.documentBinding !== "string" ||
          resumptions.some((entry) => entry.documentBinding !== request.documentBinding) ||
          !/^[a-f0-9]{64}$/.test(request.documentBinding))
      )
        return refuse("event_mismatch");
      const base: EntryBase = {
        softwareId: WAITRON_ID_SISTEMA,
        operatorId,
        binding: request.binding,
        scope: facts.scope,
        bases: facts.bases,
        contextKey: facts.contextKey,
        ...(facts.waitKey === undefined ? {} : { continuationKey: facts.waitKey }),
      };
      if (
        sameEvent
          .filter((entry) => entry.kind !== "resume")
          .some(
            (entry) =>
              fingerprint(
                entry.kind === "intent"
                  ? {
                      ...entry,
                      contextKey: mode === "resume" ? facts.contextKey : intent!.contextKey,
                    }
                  : entry,
              ) !==
              fingerprint({
                ...base,
                contextKey:
                  entry.kind === "wait" ? (facts.waitKey ?? facts.contextKey) : facts.contextKey,
              }),
          )
      )
        return refuse("event_mismatch");
      if (mode === "committed") {
        if (!["restore", "conflict-switch"].includes(request.binding.action))
          return refuse("event_mismatch");
        return material(intent!);
      }
      const waits = sameEvent.filter((entry): entry is Wait => entry.kind === "wait");
      const latestWait = waits.reduce<Wait | undefined>(
        (latest, entry) =>
          latest === undefined || entry.targetMs > latest.targetMs ? entry : latest,
        undefined,
      );
      if (facts.clock === undefined) return refuse("clock_unconfirmed");
      if (!canSelectHour(facts.clock)) return refuse(clockRefusal(facts.clock));
      const now = facts.clock.usable.find((sample) => sample.source === "box")!.lowerMs;
      const history = projectHourHistory({
        scope: facts.scope,
        sources: [
          ...facts.history,
          {
            reference: "retained-intents",
            complete: true,
            records: [
              ...entries
                .filter((entry): entry is Intent => entry.kind === "intent" && entry !== original)
                .map((entry) => ({
                  ...entry.scope,
                  reference: `intent/${entry.binding.module}/${entry.binding.eventId}`,
                  kind: "intent",
                  softwareId: entry.softwareId,
                  nodeId: entry.binding.targetNodeId,
                  identity: entry.identity,
                  recordedAtMs: Date.parse(entry.issuedAt),
                })),
            ],
          },
        ],
      });
      if (history.contradictions.length > 0) return refuse("history_invalid");
      if (intent !== undefined) {
        if (history.usedMinutes.includes(decodeMinuteIdentity(intent.identity)))
          return refuse("minute_in_use");
        if (now < Date.parse(intent.issuedAt)) return refuse("minute_not_later");
      }
      const write = async (entry: Entry) => {
        authorize();
        await state.replace(
          { version: 1, entries: structuredClone([...entries, entry]) },
          entry.kind === "wait" ? "wait" : "intent",
        );
        authorize();
        entries.push(entry);
      };
      if (intent !== undefined) {
        if (mode === "resume") {
          request.validate!(material(intent));
          if (intent.contextKey !== facts.contextKey)
            await write({
              ...intent,
              kind: "resume",
              fromContextKey: intent.contextKey,
              contextKey: facts.contextKey,
              documentBinding: request.documentBinding!,
            });
        }
        return material(intent);
      }
      // A recorded wait stays current for a minute past its target; a later select gets its own.
      const currentWait =
        latestWait !== undefined && now <= latestWait.targetMs + WAIT_REUSE_MS
          ? latestWait
          : undefined;
      const settles = ["setup", "restore", "conflict-switch"].includes(request.binding.action);
      const settleTarget = !settles
        ? -Infinity
        : currentWait !== undefined
          ? currentWait.targetMs
          : persist
            ? (Math.floor((now + SETTLE_MS) / MINUTE_MS) + 1) * MINUTE_MS
            : -Infinity;
      let targetMs = Math.max(
        Math.ceil(settleTarget / MINUTE_MS) * MINUTE_MS,
        Math.floor(now / MINUTE_MS) * MINUTE_MS,
      );
      const used = new Set(history.usedMinutes);
      while (used.has((targetMs - EPOCH_MS) / MINUTE_MS)) targetMs += MINUTE_MS;
      if (targetMs >= END_MS) return refuse("minute_not_later");
      if (targetMs - now > WAIT_BOUND_MS && targetMs !== settleTarget)
        return refuse("minute_in_use", {
          allowedFromMs: targetMs,
          remainingMs: targetMs - now,
          recheckInMs: targetMs - now - WAIT_BOUND_MS,
        });
      const waiting = (wait: Wait) => {
        const timerKey = JSON.stringify([fingerprint(wait), wait.targetMs]);
        const monotonic = options.monotonicNow();
        if (!Number.isFinite(monotonic) || monotonic < 0) return refuse("clock_unconfirmed");
        let timer = timers.get(timerKey);
        if (timer === undefined) {
          timer = { start: monotonic, duration: Math.max(0, wait.targetMs - now) };
          timers.set(timerKey, timer);
        }
        if (monotonic < timer.start) return refuse("clock_unconfirmed");
        const remainingMs = Math.max(
          timer.duration - (monotonic - timer.start),
          wait.targetMs - now,
        );
        return remainingMs > 0
          ? { status: "waiting" as const, targetMs: wait.targetMs, remainingMs }
          : undefined;
      };
      // A preview counts down only a wait already recorded, never a target it has not saved.
      if (!persist) {
        const recorded = currentWait === undefined ? undefined : waiting(currentWait);
        if (recorded !== undefined) return recorded;
      } else if (now < targetMs) {
        let wait = waits.find((entry) => entry.targetMs === targetMs);
        if (wait === undefined) {
          if (latestWait !== undefined && targetMs <= latestWait.targetMs)
            return refuse("history_invalid");
          wait = { ...base, contextKey: facts.waitKey ?? facts.contextKey, kind: "wait", targetMs };
          await write(wait);
        }
        return waiting(wait)!;
      } else if (currentWait !== undefined) {
        const recorded = waiting(currentWait);
        if (recorded !== undefined) return recorded;
      }
      const selected: Intent = {
        ...base,
        kind: "intent",
        references: [...history.references],
        identity: encodeMinuteIdentity(now),
        issuedAt: new Date(now).toISOString(),
      };
      if (!persist) return { ...material(selected), status: "preview" as const };
      await write(selected);
      options.onNewIntent?.(material(selected));
      return material(selected);
    });
  };
  return {
    async committed(request: BareRequest) {
      const result = await perform(request, "committed");
      if (result.status !== "selected") return refuse("event_mismatch");
      return result;
    },
    async resume(request: ResumeRequest) {
      const result = await perform(request, "resume");
      if (result.status !== "selected") return refuse("clock_unconfirmed");
      return result;
    },
    select: (request: SelectionRequest) => perform(request, "select"),
    preview: (request: BareRequest) => perform(request, "preview"),
    async selected(request: BareRequest) {
      const result = await perform(request, "selected");
      if (result.status !== "selected") return refuse("clock_unconfirmed");
      return result;
    },
  };
}
