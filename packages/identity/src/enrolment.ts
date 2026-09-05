import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import { persons, webauthnCredentials } from "./schema/index.js";

/** Identity's sync enrolment (SP-2a): its config tables flow DOWN to a read-only secondary so it can
 * authenticate the venue's people on failover. Metadata verbatim from the former central ENROLLED
 * (Group E); columns derived by `enrol`. */
export const IDENTITY_ENROLMENT: readonly EnrolledTable[] = [
  // Both are config-class (membership Slice 7, R-S7-1): the venue's people and their passkeys flow
  // DOWN-only from the serving-primary, so a returned node's fence-window edit is primary-wins rejected.
  enrol(persons, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
    configClass: true,
  }),
  enrol(webauthnCredentials, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 1,
    lane: "ordered",
    configClass: true,
  }),
];
