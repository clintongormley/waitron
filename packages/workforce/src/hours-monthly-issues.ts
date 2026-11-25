import type { HoursOpenShift, PersonHours } from "./attendance-contract.js";
import type { readAttendanceInboxInputs } from "./attendance-reads.js";
import { localWallClock, type Period, type TimeEntryRecord } from "./projection.js";
import { entryDate } from "./record-period.js";
import { recordRoot } from "./record-projection.js";

export function monthlyIssues(
  period: Period,
  effective: TimeEntryRecord[],
  byId: ReadonlyMap<string, TimeEntryRecord>,
  { questions, commands }: Awaited<ReturnType<typeof readAttendanceInboxInputs>>,
  pending: PersonHours["pending"],
  openShifts: HoursOpenShift[],
): HoursOpenShift[] {
  const inPeriod = (date: string) => period.start <= date && date < period.end;
  const starts = new Map<string, TimeEntryRecord>();
  let start: TimeEntryRecord | undefined;
  for (const entry of effective) {
    if (entry.entryKind === "in") start = entry;
    if (start) starts.set(recordRoot(entry, byId).entryId, start);
    if (entry.entryKind === "out") start = undefined;
  }
  const startFor = (id: string | null | undefined) => {
    const entry = id ? byId.get(id) : undefined;
    return entry === undefined ? undefined : starts.get(recordRoot(entry, byId).entryId);
  };
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const questionDate = (id: string | undefined) => {
    const question = id === undefined ? undefined : questionById.get(id);
    if (!question) return undefined;
    const linked = startFor(question.openEntryId) ?? startFor(question.automaticEntryId);
    return linked ? entryDate(linked) : question.businessDay;
  };
  const questionForRequest = new Map(
    commands.flatMap((command) =>
      command.questionId === null
        ? []
        : command.entryIds.map((id) => [id, command.questionId!] as const),
    ),
  );
  const boundaries = effective
    .filter((entry) => entry.entryKind === "in" || entry.entryKind === "out")
    .reverse();
  pending.items = pending.items.filter((item) => {
    const proposedStart = item.changes.find(
      ({ target }) => "missingKind" in target && target.missingKind === "in",
    );
    if (proposedStart)
      return inPeriod(localWallClock(proposedStart.at, proposedStart.offsetMinutes).slice(0, 10));
    return item.changes.some((change, index) => {
      const proposedDate = localWallClock(change.at, change.offsetMinutes).slice(0, 10);
      if ("entryId" in change.target) {
        const linked = startFor(change.target.entryId);
        if (linked)
          return (
            inPeriod(entryDate(linked)) ||
            (linked.entryId === change.target.entryId && inPeriod(proposedDate))
          );
        const target = byId.get(change.target.entryId);
        return inPeriod(proposedDate) || (target !== undefined && inPeriod(entryDate(target)));
      }
      const linked = questionDate(questionForRequest.get(item.requestEntryIds[index]!));
      const previous = boundaries.find((entry) => entry.eventAt <= change.at);
      return inPeriod(
        linked ?? (previous?.entryKind === "in" ? entryDate(previous) : proposedDate),
      );
    });
  });
  const itemIds = new Set(pending.items.map((item) => item.id));
  pending.prompts = pending.prompts.flatMap((prompt) => {
    if (prompt.itemId !== null) return itemIds.has(prompt.itemId) ? [prompt] : [];
    const workDate = questionDate(prompt.id) ?? prompt.businessDay;
    return workDate !== null && inPeriod(workDate) ? [{ ...prompt, workDate }] : [];
  });
  const linkedDates = new Map(
    questions.flatMap((question) =>
      question.automaticEntryId === null
        ? []
        : [[question.automaticEntryId, questionDate(question.id)] as const],
    ),
  );
  pending.automaticEntryIds = pending.automaticEntryIds.filter((id) => {
    const linked = startFor(id);
    return inPeriod(linked ? entryDate(linked) : (linkedDates.get(id) ?? entryDate(byId.get(id)!)));
  });
  const linkedPrompts = new Map(
    pending.prompts.flatMap((prompt) => {
      const linked = startFor(questionById.get(prompt.id)?.openEntryId);
      return linked === undefined ? [] : [[linked.entryId, prompt.id] as const];
    }),
  );
  return openShifts
    .filter((shift) => inPeriod(entryDate(shift.start)))
    .map((shift) => {
      const questionId = linkedPrompts.get(shift.start.entryId);
      return questionId === undefined ? shift : { ...shift, questionId };
    });
}
