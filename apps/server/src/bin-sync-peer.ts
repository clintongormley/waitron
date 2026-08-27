#!/usr/bin/env node
import { createPostgresDb } from "@waitron/db";
import { syncPeerCommand } from "./sync-peer-command.js";

/* v8 ignore start -- process wiring, exercised by an operator not a unit test */
syncPeerCommand({
  argv: process.argv.slice(2),
  env: process.env,
  connect: createPostgresDb,
  out: (line) => process.stdout.write(`${line}\n`),
}).then((code) => process.exit(code));
/* v8 ignore stop */
