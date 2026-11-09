import { CARD_PROVIDERS } from "./card-providers.js";
import { MEDIA_MODULE } from "@waitron/media";
import { CREDENTIALS_BACKUP_VERIFICATION } from "./credentials-backup-verification.js";
import { CORE_BACKUP_VERIFICATION } from "./core-backup-verification.js";
import { NODE_BACKUP_VERIFICATION } from "./node-backup-verification.js";
import {
  ADJUSTMENTS_BACKUP_VERIFICATION,
  ADJUSTMENTS_CHANGE_SOURCES,
  ADJUSTMENTS_CONFIGURATION_TRANSFER,
  ADJUSTMENTS_PERMISSIONS,
  ADJUSTMENTS_PERSONAL_DATA,
  ADJUSTMENTS_PROVISIONING,
  ADJUSTMENTS_ROUTES,
  ADJUSTMENTS_SETTINGS,
} from "@waitron/adjustments";
import { NODE_CLASSIFICATION } from "@waitron/node-db";
import {
  CATALOGUE_BACKUP_VERIFICATION,
  CATALOGUE_CHANGE_SOURCES,
  CATALOGUE_CONFIGURATION_TRANSFER,
  CATALOGUE_PROVISIONING,
} from "@waitron/catalogue";
import {
  CORE_ALERTS,
  CORE_CLASSIFICATION,
  CORE_CONFIGURATION_TRANSFER,
  CORE_CHANGE_SOURCES,
} from "@waitron/db";
import { FISCAL_NONE_SLOT, FISCAL_NONE_BACKUP_VERIFICATION } from "@waitron/fiscal-none";
import {
  FISCAL_ALERTS,
  FISCAL_CLASSIFICATION,
  FISCAL_START_AGAIN_DELETABLE,
  FISCAL_PROVISIONING,
  FISCAL_OPERATIONS,
  FISCAL_RESTORE,
  FISCAL_RECOVERY_PACK,
  FISCAL_RECOVERY_PACK_PAGE,
  FISCAL_HOUR_BACKUP_STATE,
  FISCAL_BACKUP_VERIFICATION,
  VERIFACTU_HANDOVER,
  assertFiscalRestoreCommitted,
  FISCAL_ROUTES,
  FISCAL_PERMISSIONS,
  FISCAL_SLOT,
  FISCAL_VOCABULARY,
  FISCAL_STAFF_NOTICES,
} from "@waitron/fiscal-verifactu";
import {
  BOOKINGS_CLASSIFICATION,
  BOOKINGS_BACKUP_VERIFICATION,
  BOOKINGS_CHANGE_SOURCES,
  BOOKINGS_FLOOR_ANNOTATIONS,
  BOOKINGS_TABLE_REMOVAL,
  BOOKINGS_PERMISSIONS,
  BOOKINGS_ROUTES,
} from "@waitron/bookings";
import { HANDOVER_BACKUP_VERIFICATION } from "@waitron/handover";
import {
  IDENTITY_BACKUP_VERIFICATION,
  IDENTITY_CONFIGURATION_TRANSFER,
  IDENTITY_CHANGE_SOURCES,
  IDENTITY_PERSONAL_DATA,
} from "@waitron/identity";
import { validateThemeConfiguration } from "@waitron/layouts";
import {
  combineBackupVerification,
  type ModuleConfigurationTransfer,
  type WaitronModule,
} from "@waitron/module";
import {
  PAYMENTS_ALERTS,
  PAYMENTS_CLASSIFICATION,
  paymentsBackupVerification,
  PAYMENTS_CONFIGURATION_TRANSFER,
  PAYMENTS_CHANGE_SOURCES,
  PAYMENTS_HANDOVER,
  SCHEDULER_BACKUP_VERIFICATION,
} from "@waitron/payments";
import {
  STAFFING_BACKUP_VERIFICATION,
  STAFFING_CHANGE_SOURCES,
  STAFFING_CONFIGURATION_TRANSFER,
  STAFFING_PERMISSIONS,
  STAFFING_PERSONAL_DATA,
  STAFFING_ROUTES,
  describeShifts,
} from "@waitron/staffing";
import {
  WORKFORCE_BACKUP_VERIFICATION,
  WORKFORCE_CLASSIFICATION,
  WORKFORCE_CONFIGURATION_TRANSFER,
  WORKFORCE_CHANGE_SOURCES,
  WORKFORCE_PERMISSIONS,
  WORKFORCE_PERSONAL_DATA,
} from "@waitron/workforce";
import {
  VENUE_SERVICE,
  VENUE_SERVICE_ALERTS,
  VENUE_SERVICE_BACKUP_VERIFICATION,
  VENUE_SERVICE_CHANGE_SOURCES,
  VENUE_SERVICE_CONFIGURATION_TRANSFER,
  VENUE_SERVICE_PERMISSIONS,
  VENUE_SERVICE_PROVISIONING,
  VENUE_SERVICE_ROUTES,
} from "@waitron/venue-service";
import {
  WORKFORCE_ES_BACKUP_VERIFICATION,
  WORKFORCE_ES_CLASSIFICATION,
  WORKFORCE_ES_CHANGE_SOURCES,
  WORKFORCE_ES_CONFIGURATION_TRANSFER,
  WORKFORCE_ES_RECORD_EXPORT,
  WORKFORCE_ES_VOCABULARY,
} from "@waitron/workforce-es";

type TransferValidate = NonNullable<
  Extract<ModuleConfigurationTransfer, { kind: "tables" }>["validate"]
>;

// The custom_themes rows' check lives in @waitron/layouts, which packages/db does not depend on,
// so it joins the core module's check here.
const validateCore: TransferValidate = CORE_CONFIGURATION_TRANSFER.validate;

const CORE_TRANSFER: ModuleConfigurationTransfer = {
  ...CORE_CONFIGURATION_TRANSFER,
  validate: (tables, bundle) => {
    validateCore(tables, bundle);
    validateThemeConfiguration(tables);
  },
};

/**
 * Every Waitron module, in composition order. The one place that names every module package: the
 * server, the provisioning CLI and the root guards all read this list. What
 * `scripts/module-seams.test.ts` enforces is narrower than "nothing else imports a module package":
 * the boundary is the swappable fiscal REGIME (`@waitron/fiscal-verifactu`, `@waitron/verifactu`),
 * which nothing under `packages/provisioning/src` may import (its `bin.ts` is the CLI's composition
 * root and imports this list instead) and which no file under `apps/server/src` may import. Test
 * files and `testing/` directories are outside the guard.
 * `@waitron/identity` and `@waitron/layouts` are ordinary dependencies of the packages that use them,
 * not slots, and the guard says nothing about them.
 *
 * Each `migrations` object carries the exact `{ name, table, from }`, and `database` where set, from
 * `packages/migrations/migrations.manifest.json`; `composition.test.ts` pins the two byte-for-byte
 * while both exist. A module with a set of its own names in `requires` every other set whose table
 * its SQL `REFERENCES`, puts a trigger `ON`, names inside a trigger body, or writes at top level; a
 * module whose tables live in another module's set (`tablesIn`) has no SQL of its own. Two modules
 * fill the `fiscal` slot — `fiscal-verifactu` and the no-regime `fiscal-none` — so exactly one is
 * enabled per deployment (`fiscalSlot`); provisioning selects it from the venue's territory.
 */
export const ALL_MODULES: readonly WaitronModule[] = [
  {
    name: "core",
    version: "0.0.0",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
    alerts: CORE_ALERTS,
    classification: CORE_CLASSIFICATION,
    startAgainDeletable: ["activity_log"],
    changes: CORE_CHANGE_SOURCES,
    configurationTransfer: CORE_TRANSFER,
    backup: { verification: CORE_BACKUP_VERIFICATION },
  },
  {
    name: "node",
    version: "0.0.0",
    tier: "mandatory",
    migrations: {
      name: "node",
      table: "__drizzle_migrations_node",
      from: "../node-db/drizzle",
      database: "node",
    },
    classification: NODE_CLASSIFICATION,
    backup: { verification: NODE_BACKUP_VERIFICATION },
    configurationTransfer: { kind: "none" },
  },
  {
    name: "handover",
    version: "0.0.0",
    tier: "mandatory",
    requires: { core: "*" },
    tablesIn: "core",
    backup: { verification: HANDOVER_BACKUP_VERIFICATION },
    configurationTransfer: { kind: "none" },
  },
  {
    name: "catalogue",
    version: "0.0.0",
    tier: "mandatory",
    requires: { core: "*" },
    tablesIn: "core",
    backup: { verification: CATALOGUE_BACKUP_VERIFICATION },
    changes: CATALOGUE_CHANGE_SOURCES,
    configurationTransfer: CATALOGUE_CONFIGURATION_TRANSFER,
    provisioning: CATALOGUE_PROVISIONING,
  },
  {
    name: "venue-service",
    version: "0.0.0",
    tier: "mandatory",
    requires: { core: "*", modules: { catalogue: "*" } },
    tablesIn: "core",
    backup: { verification: VENUE_SERVICE_BACKUP_VERIFICATION },
    changes: VENUE_SERVICE_CHANGE_SOURCES,
    venueService: VENUE_SERVICE,
    configurationTransfer: VENUE_SERVICE_CONFIGURATION_TRANSFER,
    provisioning: VENUE_SERVICE_PROVISIONING,
    routes: VENUE_SERVICE_ROUTES,
    permissions: VENUE_SERVICE_PERMISSIONS,
    alerts: VENUE_SERVICE_ALERTS,
  },
  MEDIA_MODULE,
  {
    name: "identity",
    version: "0.0.0",
    tier: "mandatory",
    requires: { core: "*" },
    tablesIn: "core",
    backup: { verification: IDENTITY_BACKUP_VERIFICATION },
    changes: IDENTITY_CHANGE_SOURCES,
    configurationTransfer: IDENTITY_CONFIGURATION_TRANSFER,
    personalData: IDENTITY_PERSONAL_DATA,
  },
  {
    name: "workforce",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*", modules: { identity: "*" } },
    migrations: {
      name: "workforce",
      table: "__drizzle_migrations_workforce",
      from: "../workforce/drizzle",
    },
    backup: { verification: WORKFORCE_BACKUP_VERIFICATION },
    classification: WORKFORCE_CLASSIFICATION,
    changes: WORKFORCE_CHANGE_SOURCES,
    permissions: WORKFORCE_PERMISSIONS,
    configurationTransfer: WORKFORCE_CONFIGURATION_TRANSFER,
    personalData: WORKFORCE_PERSONAL_DATA,
  },
  {
    name: "workforce-es",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*" },
    migrations: {
      name: "workforce-es",
      table: "__drizzle_migrations_workforce_es",
      from: "../workforce-es/drizzle",
    },
    vocabulary: WORKFORCE_ES_VOCABULARY,
    backup: { verification: WORKFORCE_ES_BACKUP_VERIFICATION },
    classification: WORKFORCE_ES_CLASSIFICATION,
    changes: WORKFORCE_ES_CHANGE_SOURCES,
    configurationTransfer: WORKFORCE_ES_CONFIGURATION_TRANSFER,
    timeRecordExport: WORKFORCE_ES_RECORD_EXPORT,
  },
  {
    name: "payments",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*" },
    migrations: {
      name: "payments",
      table: "__drizzle_migrations_payments",
      from: "../payments/drizzle",
    },
    classification: PAYMENTS_CLASSIFICATION,
    backup: {
      verification: combineBackupVerification(paymentsBackupVerification(CARD_PROVIDERS), [
        SCHEDULER_BACKUP_VERIFICATION,
      ]),
    },
    changes: PAYMENTS_CHANGE_SOURCES,
    configurationTransfer: PAYMENTS_CONFIGURATION_TRANSFER,
    alerts: PAYMENTS_ALERTS,
    handover: PAYMENTS_HANDOVER,
  },
  {
    name: "credentials",
    version: "0.0.0",
    tier: "mandatory",
    requires: { core: "*" },
    tablesIn: "core",
    backup: { verification: CREDENTIALS_BACKUP_VERIFICATION },
    configurationTransfer: { kind: "none" },
  },
  {
    name: "fiscal-verifactu",
    version: "0.0.0",
    tier: "provision-only",
    requires: { core: "*" },
    migrations: {
      name: "fiscal-verifactu",
      table: "__drizzle_migrations_fiscal",
      from: "../fiscal-verifactu/drizzle",
    },
    classification: FISCAL_CLASSIFICATION,
    startAgainDeletable: FISCAL_START_AGAIN_DELETABLE,
    vocabulary: FISCAL_VOCABULARY,
    provisioning: FISCAL_PROVISIONING,
    operations: FISCAL_OPERATIONS,
    fiscal: FISCAL_SLOT,
    routes: FISCAL_ROUTES,
    permissions: FISCAL_PERMISSIONS,
    backup: {
      restore: FISCAL_RESTORE,
      recoveryPack: FISCAL_RECOVERY_PACK,
      recoveryPackPage: FISCAL_RECOVERY_PACK_PAGE,
      nonDbState: [FISCAL_HOUR_BACKUP_STATE],
      verification: FISCAL_BACKUP_VERIFICATION,
      assertRestoreCommitted: assertFiscalRestoreCommitted,
    },
    handover: VERIFACTU_HANDOVER,
    alerts: FISCAL_ALERTS,
    staffNotices: FISCAL_STAFF_NOTICES,
    configurationTransfer: { kind: "none" },
  },
  {
    name: "fiscal-none",
    version: "0.0.0",
    tier: "provision-only",
    requires: { core: "*" },
    migrations: {
      name: "fiscal-none",
      table: "__drizzle_migrations_fiscal_none",
      from: "../fiscal-none/drizzle",
    },
    fiscal: FISCAL_NONE_SLOT,
    backup: { verification: FISCAL_NONE_BACKUP_VERIFICATION },
    configurationTransfer: { kind: "none" },
  },
  {
    name: "bookings",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*" },
    migrations: {
      name: "bookings",
      table: "__drizzle_migrations_bookings",
      from: "../bookings/drizzle",
    },
    classification: BOOKINGS_CLASSIFICATION,
    backup: { verification: BOOKINGS_BACKUP_VERIFICATION },
    changes: BOOKINGS_CHANGE_SOURCES,
    routes: BOOKINGS_ROUTES,
    permissions: BOOKINGS_PERMISSIONS,
    floorAnnotations: BOOKINGS_FLOOR_ANNOTATIONS,
    tableRemoval: BOOKINGS_TABLE_REMOVAL,
    configurationTransfer: { kind: "none" },
  },
  {
    name: "adjustments",
    settings: [ADJUSTMENTS_SETTINGS],
    version: "0.0.0",
    tier: "mandatory",
    requires: { core: "*" },
    tablesIn: "core",
    backup: { verification: ADJUSTMENTS_BACKUP_VERIFICATION },
    changes: ADJUSTMENTS_CHANGE_SOURCES,
    routes: ADJUSTMENTS_ROUTES,
    permissions: ADJUSTMENTS_PERMISSIONS,
    provisioning: ADJUSTMENTS_PROVISIONING,
    configurationTransfer: ADJUSTMENTS_CONFIGURATION_TRANSFER,
    personalData: ADJUSTMENTS_PERSONAL_DATA,
  },
  {
    name: "staffing",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*", modules: { identity: "*", "venue-service": "*", workforce: "*" } },
    tablesIn: "workforce",
    backup: { verification: STAFFING_BACKUP_VERIFICATION },
    changes: STAFFING_CHANGE_SOURCES,
    routes: STAFFING_ROUTES,
    permissions: STAFFING_PERMISSIONS,
    describeShifts,
    configurationTransfer: STAFFING_CONFIGURATION_TRANSFER,
    personalData: STAFFING_PERSONAL_DATA,
  },
];
