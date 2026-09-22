// The public surface of @waitron/provisioning. Re-exports only — no logic here.
export { runCli } from "./cli.js";
export type { CliDeps } from "./cli.js";
export { assertIdentifier, generatePassword, quoteIdent } from "./identifiers.js";
export { generateKeyRing, runKeyring } from "./keyring-command.js";
export type { GeneratedKeyRing } from "./keyring-command.js";
export type { ProvisioningIo } from "./io.js";
export { planVenue, describeVenueAction } from "./venue-plan.js";
export type { AdoptResult, VenueRequest, VenueAction } from "./venue-plan.js";
export { applyVenue } from "./venue-apply.js";
export type { VenueApplyDeps, VenueResult } from "./venue-apply.js";
export { FISCAL_TERRITORIES, resolveFiscalModules } from "./fiscal-modules.js";
export type { FiscalModules } from "./fiscal-modules.js";
export { venueFiscalSelection } from "./venue-fiscal.js";
export type { VenueFiscalSelection } from "./venue-fiscal.js";
export {
  assertNoForeignTenant,
  assertNoOperationalVenue,
  assertSingleOperationalVenue,
  readOperationalVenueIds,
  readTenantIdentities,
} from "./tenant-guard.js";
export type { TenantIdentity } from "./tenant-guard.js";
// `findAheadSets` and `unknownHashes` stay internal: the host calls `assertNotAhead` alone, and
// the suites reach the other two by relative path.
export { assertNotAhead } from "./schema-ahead.js";
export type { AheadSet } from "./schema-ahead.js";
import "./errors.js";
