#!/usr/bin/env node
import { runRestore } from "./restore-command.js";

/* v8 ignore start -- process wiring, exercised by an operator not a unit test */
runRestore({
  argv: process.argv.slice(2),
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
})
  .then((code) => process.exit(code))
  // Backstop, not the fix: `runRestore` itself never rejects with a raw error (it catches every
  // orchestrator failure and prints a sanitised message — restore-command.ts). This exists only so
  // a bug THERE, or a throw before `runRestore` is even reached, can never let Node print an
  // uncaught rejection's raw `.message` (which could carry the admin connection string/password)
  // straight to stderr — never re-print `err`/`err.message` here either.
  .catch(() => {
    process.stderr.write("restore failed\n");
    process.exit(1);
  });
/* v8 ignore stop */
