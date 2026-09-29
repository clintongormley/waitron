import { hostname } from "node:os";
import { serve } from "@hono/node-server";
import { createAgent } from "@waitron/print-agent";
import { readEnv } from "./config.js";
import { createContainerHost, structuredLog } from "./host.js";
import { BLUETOOTH_CHECK_TICK_MS, createLinuxDevices } from "./linux-devices.js";
import { createServerTrustingFetch } from "./server-ca.js";
import { createSetupApp } from "./setup-page.js";
import { FileState } from "./state.js";

const env = readEnv(process.env, hostname());
const state = new FileState(env.stateDir);

// The box's self-signed CA on top of Node's public roots, so https://127.0.0.1 verifies and a
// promoted cloud primary's public cert still does.
const trustingFetch = await createServerTrustingFetch({
  serverUrl: env.serverUrl,
  stateDir: env.stateDir,
  log: (msg, fields) => console.info(JSON.stringify({ level: "info", msg, ...fields })),
});
const devices = createLinuxDevices({ log: structuredLog(console) });
const host = createContainerHost({
  env,
  state,
  fetch: trustingFetch,
  onStatus: () => {},
  devices,
});
const agent = createAgent({ host });

// The job poll lists Bluetooth only once the agent is approved; this reports it before then too.
void devices.checkBluetooth();
setInterval(() => void devices.checkBluetooth(), BLUETOOTH_CHECK_TICK_MS).unref();

const page = createSetupApp({
  snapshot: () => agent.setupSnapshot(),
  configure: (config) => agent.configure(config),
  beginNetworkReset: () => agent.beginNetworkReset(),
  cancelNetworkReset: () => agent.cancelNetworkReset(),
  // A compose-supplied address pins the server; the page then shows it read-only and refuses POST.
  envLocked: env.serverUrl !== undefined,
  defaultName: env.name ?? hostname(),
  now: () => host.now(),
  bluetooth: () => devices.bluetoothAvailability(),
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
