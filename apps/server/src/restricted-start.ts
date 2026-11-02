import type { Hono } from "hono";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { StartedServer } from "./boot.js";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { mountNodeApi } from "./node-api.js";

export interface RestrictedStartDeps {
  /** The shared app, already serving `/health`. */
  app: Hono;
  nodeId: string;
  environment: DeploymentEnvironment;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  /** Routes later handover steps add to the restricted box. */
  routes: ((app: Hono) => void)[];
  log: Logger;
  /** Binds the listeners and returns the running server; starts no background work. */
  listen: (app: Hono) => StartedServer;
}

/**
 * The start of a box that has handed over or been superseded: it answers the role probe so tills
 * move to the successor, and nothing that sells, files or writes.
 */
export function startRestricted(deps: RestrictedStartDeps): StartedServer {
  mountNodeApi(
    deps.app,
    {
      nodeId: deps.nodeId,
      acceptingSales: false,
      environment: deps.environment,
      readMembership: deps.readMembership,
    },
    deps.log,
  );
  for (const mount of deps.routes) mount(deps.app);
  return deps.listen(deps.app);
}
