import { startServerOrFirstSetupResolution } from "./node-entry.js";
import { nameVenueHolder } from "./holder-identity.js";
import { installShutdownHandlers } from "./run-server.js";
import "./errors.js";

nameVenueHolder("server", process.env);
const server = await startServerOrFirstSetupResolution(process.env);
installShutdownHandlers(server);
