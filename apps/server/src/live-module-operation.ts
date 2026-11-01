import type { LiveModuleOperationBridge, ProvisionedNode } from "@waitron/module";
import type { Context } from "hono";
import type { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { createLiveOperationRateLimit } from "./live-operation-rate-limit.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import { requestFromBox } from "./request-from-box.js";

export function createLiveModuleOperation(options: {
  node: ProvisionedNode;
  preparation: ReturnType<typeof createNodeOperationPreparation>;
  requestFromBox?: (c: Context) => boolean;
}): LiveModuleOperationBridge {
  return {
    node: Object.freeze({ ...options.node }),
    requireHttps: requireNodeOperationHttps,
    client: (c) => ({ onBox: (options.requestFromBox ?? requestFromBox)(c) }),
    ...createLiveOperationRateLimit(),
    run: (binding, key, isolation, body) =>
      options.preparation.withLiveRecovery(binding, key, isolation, body),
  };
}
