import { startServer } from "./boot.js";
import { installShutdownHandlers } from "./run-server.js";
import "./errors.js";

const server = await startServer(process.env);
installShutdownHandlers(server);
