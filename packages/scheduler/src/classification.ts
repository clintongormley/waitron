import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

export const SCHEDULER_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify(
    "scheduled_runs",
    "state",
    "the venue's record of which duty ran for which period; a node that takes over continues it",
  ),
];
