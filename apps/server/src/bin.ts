import { startServerOrFirstSetupResolution } from "./first-setup-launch.js";
import { nameVenueHolder } from "./holder-identity.js";
import { installShutdownHandlers } from "./run-server.js";
import "./errors.js";

nameVenueHolder("server", process.env);
const server = await startServerOrFirstSetupResolution(process.env);
installShutdownHandlers(server);
// A start that fails after waiting for its peers exits non-zero, as one that fails before it does.
await server.fullyStarted;
