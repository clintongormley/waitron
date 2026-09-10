import { hostname } from "node:os";
import { serve } from "@hono/node-server";
import { createAgent, type AgentStatus } from "@waitron/print-agent";
import { readEnv } from "./config.js";
import { createContainerHost } from "./host.js";
import { createServerTrustingFetch } from "./server-ca.js";
import { createSetupApp } from "./setup-page.js";
import { FileState } from "./state.js";

// The process entry: read env, build the Host, serve the LAN setup page, and run the agent loop. Every
// piece it wires (config, state, host, page) is unit-tested directly; this file is the hand-wired boot,
// excluded from coverage and exercised by a manual container run (base spec §6).
const env = readEnv(process.env, hostname());
const state = new FileState(env.stateDir);

// The latest status the loop publishes, read live by the setup page.
let status: AgentStatus = { phase: "unconfigured", serverUrl: null, current: null };
// Trust the box's self-signed CA (fetched from its landing listener's /ca.crt) on top of Node's
// public roots, so https://127.0.0.1 verifies and a promoted cloud primary's public cert still does.
const trustingFetch = await createServerTrustingFetch({
  serverUrl: env.serverUrl,
  stateDir: env.stateDir,
  log: (msg, fields) => console.info(JSON.stringify({ level: "info", msg, ...fields })),
});
const host = createContainerHost({
  env,
  state,
  fetch: trustingFetch,
  onStatus: (next) => {
    status = next;
  },
});
const agent = createAgent({ host });

const page = createSetupApp({
  status: () => status,
  config: () => host.config(),
  saveConfig: (config) => host.saveConfig(config),
  // A compose-supplied address pins the server; the page then shows it read-only and refuses POST.
  envLocked: env.serverUrl !== undefined,
  defaultName: env.name ?? hostname(),
  // Box-local Bluetooth pairing acts only on this box's radio (§2.3).
  scanBluetooth: () => host.scan(["bluetooth"]),
  pairBluetooth: (mac) => host.pair(mac),
});

// Published on the LAN by default (0.0.0.0); a venue wanting loopback changes the compose publish line.
serve({ fetch: page.fetch, port: env.setupPort, hostname: "0.0.0.0" });
host.log.info("setup page", { port: env.setupPort });

const stop = (): void => {
  agent.stop();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await agent.start();
