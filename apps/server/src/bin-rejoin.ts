#!/usr/bin/env node
import { nameVenueHolder } from "./holder-identity.js";
import { runRejoin } from "./rejoin-command.js";

/* v8 ignore start -- process wiring, exercised by an operator not a unit test */
nameVenueHolder("rejoin", process.env);
runRejoin({
  argv: process.argv.slice(2),
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
})
  .then((code) => process.exit(code))
  // Backstop for a throw `runRejoin` does not catch: never print `err` or its message here.
  .catch(() => {
    process.stderr.write("rejoin failed\n");
    process.exit(1);
  });
/* v8 ignore stop */
