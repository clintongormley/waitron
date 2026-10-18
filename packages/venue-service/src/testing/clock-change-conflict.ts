/** Mockup 06's refusal: a waiting 03:00 start from Wed 21 Oct, read in Europe/Madrid. */
export const clockChangeConflict = {
  code: "hours.clock_change_conflict",
  params: {
    dayCutover: "03:00",
    startsAt: "2026-10-21T01:00:00.000Z",
    conflicts: [
      {
        departmentId: "d1",
        periodName: "Dinner",
        startsAt: "21:00",
        endsAt: "02:45",
        rangeIndex: 0,
        reason: "transition_strip",
      },
    ],
    conflictCount: 1,
  },
};

export const clockChangeConflictSentence =
  "Dinner 21:00–02:45 clashes with the new business-day start, 03:00 from Wed 21 Oct, 03:00: Hours overlap the changed start.";
