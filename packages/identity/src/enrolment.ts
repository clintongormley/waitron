import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import { persons, webauthnCredentials } from "./schema/index.js";

/** Identity's sync enrolment (SP-2a): its config tables flow DOWN to a read-only secondary so it can
 * authenticate the venue's people on failover. Metadata verbatim from the former central ENROLLED
 * (Group E); columns derived by `enrol`. */
export const IDENTITY_ENROLMENT: readonly EnrolledTable[] = [
  enrol(persons, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  }),
  enrol(webauthnCredentials, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 1,
    lane: "ordered",
  }),
];
