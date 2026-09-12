import { prepareDevEnv, waitForDevServer } from "./dev.js";

if (!process.env.WAITRON_SERVER_URL?.trim()) {
  console.info("Waiting for the development server on port 8080");
  // Setup boot may mint the leaf. Choose the protocol only after its listener is up.
  await waitForDevServer();
}
Object.assign(process.env, await prepareDevEnv(process.env));
await import("./bin.js");
