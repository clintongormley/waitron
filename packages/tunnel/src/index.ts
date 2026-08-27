// The public surface of @waitron/tunnel. Re-exports only.
export { decodeFrame, encodeFrame } from "./protocol.js";
export type { Frame } from "./protocol.js";
export { runTunnelClient } from "./client.js";
export type { TunnelClientDeps } from "./client.js";
