import { currentIncidentsOf, markIncidentHandled, recordIncidentOnce } from "@waitron/core";
import type { CaptureMismatchSink } from "../src/capture-mismatch.js";

export const captureAlerts: CaptureMismatchSink = {
  raise: recordIncidentOnce,
  handle: markIncidentHandled,
};

export const heldAlerts = {
  raise: recordIncidentOnce,
  current: currentIncidentsOf,
  handle: markIncidentHandled,
};
