import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LOCAL =
  "sealed under the box's key ring, which a spare receives from the main box when it joins, so both open the main box's rows. Not keyed by node id";

/**
 * A stored secret is sealed under the box's key ring, so a box holding a different ring fails to
 * read it (`credentials.decrypt_failed`, or `credentials.key_version_unknown` when its ring holds no
 * key of the row's version), never a wrong value.
 */
export const CREDENTIALS_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("tenant_credentials", "local", LOCAL),
];
