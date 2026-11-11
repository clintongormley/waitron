import { nodeIo, runDeclarationCommand } from "../src/declaration/command.js";

process.exitCode = await runDeclarationCommand(process.argv.slice(2), nodeIo());
