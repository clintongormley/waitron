// The public surface of @waitron/provisioning. Re-exports only — no logic here.
export { runCli } from "./cli.js";
export type { CliDeps } from "./cli.js";
export { assertIdentifier, generatePassword, quoteIdent, withRole } from "./identifiers.js";
export { generateKeyRing, runKeyring } from "./keyring-command.js";
export type { GeneratedKeyRing } from "./keyring-command.js";
export type { ProvisioningIo } from "./io.js";
export { INSTANCE_ROLES, INSTANCE_MIGRATOR_ROLE, readInstanceState } from "./instance-state.js";
export { REPLICATION_ROLE, replicationBootstrapStatements } from "./replication-bootstrap.js";
export type { InstanceRole, InstanceState, InsideState, RoleFacts } from "./instance-state.js";
export {
  assertReplicationReady,
  readReplicationReadiness,
  replicationReadinessGaps,
} from "./replication-readiness.js";
export type { ReplicationReadiness } from "./replication-readiness.js";
export { planInstance } from "./instance-plan.js";
export type { InstanceAction, InstanceRequest } from "./instance-plan.js";
export { applyInstance, withDatabase } from "./instance-apply.js";
export type { ApplyDeps } from "./instance-apply.js";
export { formatStatus } from "./status-command.js";
export { planVenue, describeVenueAction } from "./venue-plan.js";
export type { AdoptResult, VenueRequest, VenueAction } from "./venue-plan.js";
export { applyVenue } from "./venue-apply.js";
export type { VenueApplyDeps, VenueResult } from "./venue-apply.js";
export { FISCAL_TERRITORIES, resolveFiscalModules } from "./fiscal-modules.js";
export type { FiscalModules } from "./fiscal-modules.js";
export { venueFiscalSelection } from "./venue-fiscal.js";
export type { VenueFiscalSelection } from "./venue-fiscal.js";
export { deriveTenantId } from "./tenant-id.js";
export { assertNoForeignTenant, readTenantIdentities } from "./tenant-guard.js";
export type { TenantIdentity } from "./tenant-guard.js";
import "./errors.js";
