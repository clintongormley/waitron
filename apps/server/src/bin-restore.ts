#!/usr/bin/env node
import { runRestore } from "./restore-command.js";

/* v8 ignore start -- process wiring, exercised by an operator not a unit test */
runRestore({
  argv: process.argv.slice(2),
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
}).then((code) => process.exit(code));
/* v8 ignore stop */
