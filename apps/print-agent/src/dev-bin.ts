import { prepareDevEnv, waitForDevServer } from "./dev.js";

if (!process.env.WAITRON_SERVER_URL?.trim()) {
  const port = Number(process.env.WAITRON_HTTP_PORT || 8080);
  console.info(`Waiting for the development server on port ${port}`);
  // Setup boot may mint the leaf. Choose the protocol only after its listener is up.
  await waitForDevServer(port);
}
Object.assign(process.env, await prepareDevEnv(process.env));
await import("./bin.js");
