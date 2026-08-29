#!/usr/bin/env node
import { runRecoveryUnpack } from "./recovery-unpack-command.js";

/* v8 ignore start -- process wiring, exercised by an operator not a unit test */
runRecoveryUnpack({
  argv: process.argv.slice(2),
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
}).then((code) => process.exit(code));
/* v8 ignore stop */
