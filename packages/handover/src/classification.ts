import { appendOnly, type ClassifiedTable } from "@waitron/sync-enrolment";

export const HANDOVER_CLASSIFICATION: readonly ClassifiedTable[] = [
  appendOnly(
    "handover_activations",
    "ledger",
    "which box took over from which, when, who asked and on what signed evidence; nothing may change or remove it",
  ),
];
