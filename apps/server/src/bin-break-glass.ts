#!/usr/bin/env node
import { runBreakGlassReset } from "./break-glass-command.js";

/* v8 ignore start -- process wiring, exercised by an operator not a unit test */
runBreakGlassReset({
  argv: process.argv.slice(2),
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
}).then((code) => process.exit(code));
/* v8 ignore stop */
