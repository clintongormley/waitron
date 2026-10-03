import { devServerPort, prepareDevEnv, waitForDevServer } from "./dev.js";

if (!process.env.WAITRON_SERVER_URL?.trim()) {
  const port = devServerPort(process.env);
  console.info(`Waiting for the development server on port ${port}`);
  // Setup boot may mint the leaf. Choose the protocol only after its listener is up.
  await waitForDevServer(port);
}
Object.assign(process.env, await prepareDevEnv(process.env));
await import("./bin.js");
