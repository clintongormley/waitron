import { startServer } from "./boot.js";
import { nameVenueHolder } from "./holder-identity.js";
import { installShutdownHandlers } from "./run-server.js";
import "./errors.js";

nameVenueHolder("server", process.env);
const server = await startServer(process.env);
installShutdownHandlers(server);
