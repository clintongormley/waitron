import { VENUE_FILE, NODE_FILE } from "@waitron/store";
import { once } from "node:events";
import { join } from "node:path";
import { catalogues, lockVenueDatabase, openVenueDatabase, withTransaction } from "@waitron/db";
import { readMenuStructure } from "@waitron/catalogue";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { assertAppendOnlyIntact } from "./append-only-watch.js";
import { enabledModules, orderedMigrationSets, type ModuleConfig } from "@waitron/module";
import { assertNoStartAgainDeletion } from "@waitron/provisioning";
import { reconcileFirstSetupBeforeMode } from "./first-fiscal-mode.js";
import { ALL_MODULES } from "./modules.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { readModuleConfig } from "./module-config.js";
import { assertNotAhead } from "./upgrade-schema-check.js";
import { assertDeploymentMatches } from "./deployment-guard.js";
import { isCopyIntact } from "./handover-integrity.js";
import { makeFiscalBackend } from "./till-backend.js";
import { readFilingModule } from "./node-config.js";
import { listOrders, readOrderDetail } from "./orders-list.js";
import { closeListener } from "./close-listener.js";
import { Hono } from "hono";
import { startTradingListener } from "./boot.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";

export async function openUpgradeListener(config: ServerConfig, log: Logger) {
  const app = new Hono();
  app.all("*", (c) => c.text("Upgrade checks in progress", 503));
  const server = startTradingListener(config, app, () => new Date(), log);
  const close = () => closeListener(server);
  if (!server.listening) await once(server, "listening");
  return { server, close };
}

export async function checkUpgradeData(config: ServerConfig, env: NodeJS.ProcessEnv) {
  await assertNoStartAgainDeletion(config.venueDir);
  let moduleConfig: ModuleConfig = { overrides: new Map() };
  const firstSetupHost = createFirstSetupModuleHost({
    environment: env,
    stateDir: config.stateDir,
    venueDir: config.venueDir,
    modules: ALL_MODULES,
    moduleConfig: () => moduleConfig,
  });
  await reconcileFirstSetupBeforeMode(config, firstSetupHost.store);
  const node = config.node;
  if (node === undefined)
    throw new Error("Upgrade checks require completed first setup and a configured node");
  const available = firstSetupHost.modules;
  const hold = await lockVenueDatabase(config.venueDir);
  try {
    await assertNotAhead(config.venueDir, config.migrationsRoot);
    const probe = await openVenueDatabase(config.venueDir);
    try {
      await assertDeploymentMatches(
        probe.venue,
        config.environment,
        available.flatMap((module) => (module.fiscal === undefined ? [] : [module.fiscal])),
      );
      moduleConfig = await readModuleConfig(probe.venue);
    } finally {
      await probe.close();
    }
    const modules = enabledModules(available, moduleConfig);
    const options = migrationOptionsFor(orderedMigrationSets(modules), config.migrationsRoot);
    await applyMigrations(config.venueDir, options);
    const store = await openVenueDatabase(config.venueDir);
    try {
      const db = store.venue;
      assertAppendOnlyIntact(
        db,
        options.flatMap((set) => set.appendOnlyTables ?? []),
      );
      for (const file of [VENUE_FILE, NODE_FILE]) {
        if (!(await isCopyIntact(join(config.venueDir, file))))
          throw new Error(`Upgrade integrity check failed: ${file}`);
      }
      const backend = makeFiscalBackend(modules, await readFilingModule(db, node), db, env);
      return await withTransaction(db, async (tx) => {
        await backend.checkFilingIdentity?.(tx, node.nodeId);
        const integrity = await backend.checkIntegrity(tx, node.nodeId);
        if (!integrity.ok) throw new Error("Upgrade fiscal history check failed");
        const menus = await tx.select({ id: catalogues.id }).from(catalogues);
        for (const menu of menus) await readMenuStructure(tx, menu.id);
        const page = await listOrders(tx, {
          status: "all",
          dates: "any",
          credited: false,
          limit: 50,
          scope: "all",
        });
        for (const row of page.rows) await readOrderDetail(tx, row.id, "all", false);
        return {
          mode: "trading",
          menus: menus.length,
          orders: page.rows.length,
          fiscalRecords: integrity.checked,
        };
      });
    } finally {
      await store.close();
    }
  } finally {
    hold.release();
  }
}
