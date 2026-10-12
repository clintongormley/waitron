#!/usr/bin/env node
import { runPaperCustodian } from "./paper-custodian.js";

process.exitCode = await runPaperCustodian(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
});
