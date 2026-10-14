import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AppError } from "@waitron/shared";
import { initCustodianDir, SignError, signSetupBody } from "./files.js";
import { assertDevelopmentEnvironment } from "./sign.js";

interface Output {
  write(text: string): unknown;
}

export interface CliIo {
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: AsyncIterable<string | Buffer>;
  readonly stdout: Output;
  readonly stderr: Output;
}

const USAGE = [
  "usage: dev:custodian init --dir <path>",
  "       dev:custodian sign --dir <path> < provision-body.json",
  "",
].join("\n");

function dirOption(args: readonly string[]): string {
  const { values } = parseArgs({
    args: [...args],
    options: { dir: { type: "string" } },
    strict: true,
  });
  if (values.dir === undefined || values.dir === "") throw new UsageError("--dir is required");
  return resolve(values.dir);
}

class UsageError extends Error {}

async function init(args: readonly string[], io: CliIo): Promise<number> {
  const dir = await initCustodianDir(dirOption(args), io.env);
  io.stdout.write(
    [
      `WAITRON_FISCAL_CUSTODIAN_FILE=${dir.custodianFile}`,
      `WAITRON_FISCAL_CONFIRMATION_FILE=${dir.confirmationFile}`,
      `WAITRON_FISCAL_CUSTODIAN_FINGERPRINT=${dir.fingerprint}`,
      "",
    ].join("\n"),
  );
  return 0;
}

async function sign(args: readonly string[], io: CliIo): Promise<number> {
  const dir = dirOption(args);
  let text = "";
  for await (const chunk of io.stdin) text += chunk.toString();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SignError("standard input is not JSON");
  }
  io.stdout.write(`${JSON.stringify(await signSetupBody(dir, body, io.env), null, 2)}\n`);
  return 0;
}

export async function runDevCustodian(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    assertDevelopmentEnvironment(io.env);
    const [command, ...rest] = argv;
    if (command === "init") return await init(rest, io);
    if (command === "sign") return await sign(rest, io);
    throw new UsageError(command === undefined ? "no subcommand" : `unknown subcommand ${command}`);
  } catch (error) {
    if (error instanceof AppError) {
      io.stderr.write(`dev:custodian: ${error.code} ${JSON.stringify(error.params)}\n`);
    } else if (error instanceof SignError) {
      io.stderr.write(`dev:custodian: ${error.message}\n`);
    } else if (
      error instanceof UsageError ||
      String((error as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS")
    ) {
      io.stderr.write(`dev:custodian: ${(error as Error).message}\n${USAGE}`);
    } else {
      io.stderr.write(`dev:custodian: ${String(error)}\n`);
    }
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  runDevCustodian(process.argv.slice(2), {
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
