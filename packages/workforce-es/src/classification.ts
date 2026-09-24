import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const STATE = "manager configuration / live service; copied to a standby, never drained back";

export const WORKFORCE_ES_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("convenio_config", "state", STATE),
];
