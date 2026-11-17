#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { processIo, runBin } from "@waitron/credentials/src/bin.js";
import { resealTwoStepSecrets } from "./reseal.js";

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runBin(process.argv.slice(2), process.env, processIo(process), [
    resealTwoStepSecrets,
  ]);
}
