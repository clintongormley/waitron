import "../errors.js";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AppError, isAppError, readSoftwareProducer } from "@waitron/shared";
import {
  refuseProducerSettings,
  runningProducer,
  SOFTWARE_IDENTITY,
} from "../software-identity.js";
import { writeReleaseFolder } from "./folder.js";
import { BREAK_OR_CONTROL, renderDeclaration, type DeclarationProducer } from "./render.js";
import {
  declarationItems,
  prepareDeclarationSource,
  refuseBlockers,
  releaseBlockers,
  SI_NO,
  spanishDate,
} from "./source.js";

export interface DeclarationIo {
  root: string;
  env: Readonly<Record<string, string | undefined>>;
  stdout(text: string): void;
  stderr(text: string): void;
}

export function nodeIo(): DeclarationIo {
  return {
    root: fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, ""),
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
}

const OPTIONS = {
  show: ["draft", "version", "place", "date"],
  write: ["version", "place", "date"],
  check: ["version"],
  render: ["version", "out"],
} as const;

type Subcommand = keyof typeof OPTIONS;

interface Arguments {
  draft: boolean;
  version: string;
  place: string;
  date: string;
  out: string;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function refuse(argument: string): never {
  throw new AppError("declaration.argument_invalid", { argument });
}

function parse(argv: string[]): { command: Subcommand; args: Arguments } {
  const [command = "", ...rest] = argv;
  if (!Object.hasOwn(OPTIONS, command)) refuse(command);
  const names: readonly string[] = OPTIONS[command as Subcommand];
  const { values, tokens } = parseArgs({
    args: rest,
    strict: false,
    tokens: true,
    options: Object.fromEntries(
      names.map((name) => [name, { type: name === "draft" ? "boolean" : "string" }] as const),
    ),
  });
  for (const token of tokens) {
    if (token.kind === "positional") refuse(token.value);
    if (token.kind !== "option") continue;
    if (!names.includes(token.name)) refuse(token.rawName);
    if (token.name === "draft") {
      if (token.value !== undefined) refuse(token.rawName);
    } else if (token.value === undefined || (!token.inlineValue && token.value.startsWith("-"))) {
      // Otherwise `--place --date …` would take `--date` as the place.
      refuse(token.rawName);
    }
  }
  for (const name of names) {
    if (name !== "draft" && values[name] === undefined) refuse(`--${name}`);
  }
  const args = values as Partial<Arguments>;
  if (!VERSION.test(args.version!)) refuse("--version");
  // The place is written into the source before its markup is read, so it may carry none.
  if (
    args.place !== undefined &&
    (args.place.trim() === "" || BREAK_OR_CONTROL.test(args.place) || /[‹›]|\*\*/.test(args.place))
  ) {
    refuse("--place");
  }
  if (args.out === "") refuse("--out");
  if (args.date !== undefined) spanishDate(args.date);
  return {
    command: command as Subcommand,
    args: {
      draft: args.draft === true,
      version: args.version!,
      place: args.place ?? "",
      date: args.date ?? "",
      out: args.out ?? "",
    },
  };
}

function libraryVersion(): string {
  const entry = createRequire(import.meta.url).resolve("@waitron/verifactu");
  const manifest = join(dirname(entry), "..", "package.json");
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
}

async function prepared(io: DeclarationIo, args: Arguments): Promise<string> {
  const read = (name: string) => readFile(join(io.root, "declarations", name), "utf8");
  return prepareDeclarationSource({
    template: await read("template.md"),
    functions: await read("functions.md"),
    version: args.version,
    libraryVersion: libraryVersion(),
    date: args.date,
    place: args.place,
  });
}

function producer(env: DeclarationIo["env"]): DeclarationProducer {
  refuseProducerSettings("production", { ...SOFTWARE_IDENTITY, producer: runningProducer(env) });
  // A production refusal leaves only a producer with all three settings.
  return readSoftwareProducer(env)!;
}

async function show(io: DeclarationIo, args: Arguments): Promise<void> {
  const source = await prepared(io, args);
  if (args.draft) {
    for (const blocker of releaseBlockers(source)) io.stderr(`release-blocker: ${blocker}\n`);
  } else {
    refuseBlockers(source);
  }
  io.stdout(renderDeclaration(source, producer(io.env)).text);
}

async function write(io: DeclarationIo, args: Arguments): Promise<void> {
  const source = await prepared(io, args);
  refuseBlockers(source);
  const name = writtenName(args.version);
  await writeFile(join(io.root, name), source);
  io.stdout(`wrote ${name}\n`);
}

function writtenName(version: string): string {
  return `declarations/v${version}.md`;
}

async function agreeingSource(io: DeclarationIo, version: string): Promise<string> {
  const source = await readFile(join(io.root, writtenName(version)), "utf8");
  refuseBlockers(source);
  const items = declarationItems(source);
  const expected: Record<string, string> = {
    "1.a": SOFTWARE_IDENTITY.name,
    "1.b": SOFTWARE_IDENTITY.code,
    "1.c": version,
    "1.e": SI_NO[SOFTWARE_IDENTITY.onlyVerifactu],
    "1.f": SI_NO[SOFTWARE_IDENTITY.multipleTaxpayersPossible],
  };
  for (const [item, value] of Object.entries(expected)) {
    if (items.get(item) !== value) throw new AppError("declaration.disagrees", { item });
  }
  return source;
}

async function check(io: DeclarationIo, args: Arguments): Promise<void> {
  await agreeingSource(io, args.version);
  io.stdout(`${writtenName(args.version)} agrees\n`);
}

async function render(io: DeclarationIo, args: Arguments): Promise<void> {
  const source = await agreeingSource(io, args.version);
  await writeReleaseFolder(args.out, source, producer(io.env));
  io.stdout(`wrote ${args.out}\n`);
}

const RUN: Record<Subcommand, (io: DeclarationIo, args: Arguments) => Promise<void>> = {
  show,
  write,
  check,
  render,
};

export async function runDeclarationCommand(argv: string[], io: DeclarationIo): Promise<number> {
  try {
    const { command, args } = parse(argv);
    await RUN[command](io, args);
    return 0;
  } catch (error) {
    if (!isAppError(error)) throw error;
    io.stderr(`${error.code} ${JSON.stringify(error.params)}\n`);
    return 1;
  }
}
