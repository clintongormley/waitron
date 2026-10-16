import { AppError } from "@waitron/shared";
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import { createFirstSetupCoordinator } from "./first-setup-state.js";
import {
  canonicalFirstSetupDirectory,
  firstSetupDirectory,
  validateWorkspaceBinding,
  createFirstSetupResolutionStore,
  type WorkspaceBinding,
  type ResolutionRecord,
} from "./first-setup-resolution.js";
import "./errors.js";

export interface FirstSetupAnchor {
  venueDir: string;
  stateDir: string;
}
export interface FirstSetupBootTarget extends FirstSetupAnchor {
  binding: WorkspaceBinding | null;
}
interface Witness {
  version: 1;
  binding: WorkspaceBinding;
  evidenceDigest: string;
  resolutionDigest: string;
}
const LIMIT = 65536;
function uncertain(): never {
  throw new AppError("setup.attempt_uncertain", {});
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function canonical(anchor: FirstSetupAnchor): Promise<FirstSetupAnchor> {
  return {
    venueDir: await canonicalFirstSetupDirectory(anchor.venueDir),
    stateDir: await canonicalFirstSetupDirectory(anchor.stateDir),
  };
}
function store(anchor: FirstSetupAnchor) {
  return createFirstSetupResolutionStore({ ...anchor, coordinator: createFirstSetupCoordinator() });
}
function checkedWitness(value: unknown): Witness {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 4 ||
    !["version", "binding", "evidenceDigest", "resolutionDigest"].every((key) =>
      Object.hasOwn(value, key),
    )
  )
    uncertain();
  const witness = value as Witness;
  validateWorkspaceBinding(witness.binding);
  if (
    witness.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(witness.evidenceDigest) ||
    !/^[a-f0-9]{64}$/.test(witness.resolutionDigest)
  )
    uncertain();
  return witness;
}
async function read(path: string) {
  await firstSetupDirectory(dirname(path));
  return readDurableHostJson(path, LIMIT);
}
async function writeOnce(path: string, witness: Witness) {
  const current = await read(path);
  if (current !== null) {
    if (!isDeepStrictEqual(current, witness)) uncertain();
    return;
  }
  await writeDurableHostJson(path, witness, LIMIT);
}
async function originalsUnchanged(anchor: FirstSetupAnchor, record: ResolutionRecord) {
  const originals = await store(anchor).readOriginals(record.resolutionId);
  for (const required of [
    "state/first-setup.json",
    "venue/first-setup-claim.json",
    "venue/venue.db",
  ])
    if (!originals.some((original) => original.name === required)) uncertain();
  for (const original of originals) {
    const directory = original.name.startsWith("directory:");
    const label = directory ? original.name.slice("directory:".length) : original.name;
    let path: string;
    if (label.startsWith("outside-file:") || (directory && label.startsWith("outside:"))) {
      path = label.slice(label.indexOf(":") + 1);
      if (resolve(path) !== path) uncertain();
    } else {
      if (!label.startsWith("state/") && !label.startsWith("venue/")) uncertain();
      const [root, ...parts] = label.split("/");
      if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\")))
        uncertain();
      path = join(root === "state" ? anchor.stateDir : anchor.venueDir, ...parts);
    }
    await firstSetupDirectory(dirname(path));
    if (directory) {
      try {
        await firstSetupDirectory(path);
        const bytes = Buffer.from(JSON.stringify((await readdir(path)).sort()));
        if (original.bytes === null || !bytes.equals(original.bytes)) uncertain();
      } catch (error) {
        if (!(
          original.bytes === null &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      continue;
    }
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await file.stat();
      if (original.bytes === null || !info.isFile() || info.size !== original.bytes.length)
        uncertain();
      const bytes = await file.readFile();
      if (!bytes.equals(original.bytes)) uncertain();
    } catch (error) {
      if (!(
        original.bytes === null &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    } finally {
      await file?.close();
    }
  }
}
async function checkedApplied(
  anchor: FirstSetupAnchor,
  record: ResolutionRecord,
): Promise<WorkspaceBinding> {
  const records = await store(anchor).read(record.resolutionId);
  if (
    records.length !== 2 ||
    !isDeepStrictEqual(records[1], record) ||
    record.phase !== "applied" ||
    record.action !== "retire" ||
    record.nextWorkspace === null
  )
    uncertain();
  const binding = record.nextWorkspace;
  validateWorkspaceBinding(binding);
  if (binding.anchorVenueDir !== anchor.venueDir || binding.anchorStateDir !== anchor.stateDir)
    uncertain();
  await originalsUnchanged(anchor, record);
  return binding;
}
export async function selectFirstSetupWorkspace(
  anchorInput: FirstSetupAnchor,
  record: ResolutionRecord,
): Promise<WorkspaceBinding> {
  try {
    const anchor = await canonical(anchorInput),
      binding = await checkedApplied(anchor, record);
    const witness: Witness = {
      version: 1,
      binding,
      evidenceDigest: record.evidenceDigest,
      resolutionDigest: digest(record),
    };
    const retirement = join(anchor.venueDir, "first-setup-retirement.json");
    const backlink = join(binding.venueDir, "first-setup-workspace.json");
    const current = await read(backlink);
    if (current !== null && !isDeepStrictEqual(current, witness)) uncertain();
    if (current === null) {
      for (const path of [binding.venueDir, binding.stateDir]) {
        await firstSetupDirectory(path, true);
        if ((await readdir(path)).length !== 0) uncertain();
      }
    }
    // Both target directories exist before retirement; no selection is published until retirement survives.
    await writeOnce(retirement, witness);
    await writeOnce(backlink, witness);
    await writeOnce(join(anchor.stateDir, "first-setup-selection.json"), witness);
    await writeOnce(join(anchor.venueDir, "first-setup-selection.json"), witness);
    await resolveFirstSetupWorkspace(anchor);
    return binding;
  } catch {
    uncertain();
  }
}
export async function resolveFirstSetupWorkspace(
  anchorInput: FirstSetupAnchor,
): Promise<FirstSetupBootTarget> {
  try {
    const anchor = await canonical(anchorInput);
    const venue = await read(join(anchor.venueDir, "first-setup-selection.json"));
    const state = await read(join(anchor.stateDir, "first-setup-selection.json"));
    const retirement = await read(join(anchor.venueDir, "first-setup-retirement.json"));
    if (venue === null && state === null && retirement === null)
      return { ...anchor, binding: null };
    if (
      venue === null ||
      state === null ||
      retirement === null ||
      !isDeepStrictEqual(venue, state) ||
      !isDeepStrictEqual(venue, retirement)
    )
      uncertain();
    const witness = checkedWitness(venue),
      binding = witness.binding;
    if (binding.anchorVenueDir !== anchor.venueDir || binding.anchorStateDir !== anchor.stateDir)
      uncertain();
    await firstSetupDirectory(binding.venueDir);
    await firstSetupDirectory(binding.stateDir);
    const backlink = await read(join(binding.venueDir, "first-setup-workspace.json"));
    if (!isDeepStrictEqual(backlink, witness)) uncertain();
    const records = await store(anchor).read(binding.resolutionId),
      applied = records[1];
    if (
      applied === undefined ||
      witness.resolutionDigest !== digest(applied) ||
      witness.evidenceDigest !== applied.evidenceDigest ||
      !isDeepStrictEqual(await checkedApplied(anchor, applied), binding)
    )
      uncertain();
    return { venueDir: binding.venueDir, stateDir: binding.stateDir, binding };
  } catch {
    uncertain();
  }
}
export async function assertFirstSetupVenueTarget(venueInput: string): Promise<void> {
  try {
    const venueDir = await canonicalFirstSetupDirectory(venueInput);
    if (
      (await read(join(venueDir, "first-setup-retirement.json"))) !== null ||
      (await read(join(venueDir, "first-setup-selection.json"))) !== null
    )
      uncertain();
    const backlink = await read(join(venueDir, "first-setup-workspace.json"));
    if (backlink === null) {
      if (basename(dirname(dirname(venueDir))) === "first-setup-workspaces") uncertain();
      return;
    }
    const witness = checkedWitness(backlink);
    const resolved = await resolveFirstSetupWorkspace({
      venueDir: witness.binding.anchorVenueDir,
      stateDir: witness.binding.anchorStateDir,
    });
    if (resolved.venueDir !== venueDir || !isDeepStrictEqual(resolved.binding, witness.binding))
      uncertain();
  } catch {
    uncertain();
  }
}
export async function assertFirstSetupBootTarget(targetInput: FirstSetupAnchor): Promise<void> {
  try {
    const target = await canonical(targetInput);
    if (
      (await read(join(target.venueDir, "first-setup-retirement.json"))) !== null ||
      (await read(join(target.venueDir, "first-setup-selection.json"))) !== null ||
      (await read(join(target.stateDir, "first-setup-selection.json"))) !== null
    )
      uncertain();
    const backlink = await read(join(target.venueDir, "first-setup-workspace.json"));
    if (backlink === null) {
      if (basename(dirname(dirname(target.venueDir))) === "first-setup-workspaces") uncertain();
      return;
    }
    const witness = checkedWitness(backlink);
    const resolved = await resolveFirstSetupWorkspace({
      venueDir: witness.binding.anchorVenueDir,
      stateDir: witness.binding.anchorStateDir,
    });
    if (
      resolved.venueDir !== target.venueDir ||
      resolved.stateDir !== target.stateDir ||
      !isDeepStrictEqual(resolved.binding, witness.binding)
    )
      uncertain();
  } catch {
    uncertain();
  }
}
