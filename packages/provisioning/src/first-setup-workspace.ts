import { AppError } from "@waitron/shared";
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import {
  createFirstSetupCoordinator,
  parseState,
  type FirstSetupState,
} from "./first-setup-state.js";
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
export async function inspectFirstSetupWorkspaceSelection(anchorInput: FirstSetupAnchor): Promise<{
  inspectionId: string;
  record: ResolutionRecord;
  binding: WorkspaceBinding;
  retired: FirstSetupAnchor;
} | null> {
  const anchor = await canonical(anchorInput);
  try {
    await resolveFirstSetupWorkspace(anchor);
    return null;
  } catch {
    // Only retained retirement witnesses identify an interrupted operation; never scan orphan workspaces.
  }
  const observations: unknown[] = [];
  const witnesses = new Map<string, Witness>();
  const inspect = async (path: string) => {
    const value = await read(path);
    observations.push([path, value]);
    if (value === null) return;
    const witness = checkedWitness(value);
    if (
      witness.binding.anchorVenueDir !== anchor.venueDir ||
      witness.binding.anchorStateDir !== anchor.stateDir
    )
      uncertain();
    const existing = witnesses.get(witness.binding.resolutionId);
    if (existing !== undefined && !isDeepStrictEqual(existing, witness)) uncertain();
    witnesses.set(witness.binding.resolutionId, witness);
  };
  for (const path of new Set([
    join(anchor.venueDir, "first-setup-retirement.json"),
    join(anchor.venueDir, "first-setup-selection.json"),
    join(anchor.stateDir, "first-setup-selection.json"),
  ]))
    await inspect(path);
  const visited = new Set<string>();
  for (const [id, witness] of witnesses) {
    if (witnesses.size > 64 || visited.has(id)) uncertain();
    visited.add(id);
    await inspect(join(witness.binding.venueDir, "first-setup-retirement.json"));
  }
  if (witnesses.size === 0) uncertain();
  const ordered = [...witnesses.values()].sort(
    (left, right) => right.binding.selectionGeneration - left.binding.selectionGeneration,
  );
  const witness = ordered[0]!;
  if (ordered[1]?.binding.selectionGeneration === witness.binding.selectionGeneration) uncertain();
  const records = await store(anchor).read(witness.binding.resolutionId);
  const record = records[1];
  if (
    record === undefined ||
    witness.resolutionDigest !== digest(record) ||
    witness.evidenceDigest !== record.evidenceDigest
  )
    uncertain();
  const { binding, retired, predecessor } = await checkedApplied(anchor, record);
  if (
    !isDeepStrictEqual(binding, witness.binding) ||
    !isDeepStrictEqual(await read(join(retired.venueDir, "first-setup-retirement.json")), witness)
  )
    uncertain();
  const backlink = await read(join(binding.venueDir, "first-setup-workspace.json"));
  observations.push(["backlink", backlink]);
  if (backlink !== null && !isDeepStrictEqual(backlink, witness)) uncertain();
  for (const path of new Set([
    join(anchor.venueDir, "first-setup-selection.json"),
    join(anchor.stateDir, "first-setup-selection.json"),
  ])) {
    const value = await read(path);
    if (!isDeepStrictEqual(value, predecessor) && !isDeepStrictEqual(value, witness)) uncertain();
  }
  return { inspectionId: digest([observations, records]), record, binding, retired };
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
async function originalsUnchanged(
  anchor: FirstSetupAnchor,
  record: ResolutionRecord,
  retired: FirstSetupAnchor,
  checkOutside: boolean,
) {
  const originals = await store(anchor).readOriginals(record.resolutionId);
  for (const required of [
    "state/first-setup.json",
    "venue/first-setup-claim.json",
    "venue/venue.db",
  ])
    if (!originals.some((original) => original.name === required)) uncertain();
  for (const original of originals) {
    if (original.name === "workspace:predecessor") continue;
    const directory = original.name.startsWith("directory:");
    const label = directory ? original.name.slice("directory:".length) : original.name;
    let path: string;
    if (label.startsWith("outside-file:") || (directory && label.startsWith("outside:"))) {
      path = label.slice(label.indexOf(":") + 1);
      if (resolve(path) !== path) uncertain();
      const local = [retired.venueDir, retired.stateDir].some((root) => {
        const suffix = relative(root, path);
        return (
          suffix === "" ||
          (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
        );
      });
      // Current outside sources advance independently; their archived bytes remain digest-bound.
      if (!checkOutside && !local) continue;
    } else {
      if (!label.startsWith("state/") && !label.startsWith("venue/")) uncertain();
      const [root, ...parts] = label.split("/");
      if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\")))
        uncertain();
      path = join(root === "state" ? retired.stateDir : retired.venueDir, ...parts);
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
  seen = new Set<string>(),
): Promise<{ binding: WorkspaceBinding; predecessor: Witness | null; retired: FirstSetupAnchor }> {
  if (seen.has(record.resolutionId) || seen.size >= 64) uncertain();
  seen.add(record.resolutionId);
  const records = await store(anchor).read(record.resolutionId);
  if (
    records.length < 2 ||
    records.length > 4 ||
    !isDeepStrictEqual(records[1], record) ||
    record.phase !== "applied" ||
    record.action !== "retire" ||
    record.nextWorkspace === null
  )
    uncertain();
  if (
    records[2] !== undefined &&
    !isDeepStrictEqual(records[2], {
      ...record,
      sequence: 3,
      previousRecordDigest: digest(record),
      action: "select-workspace",
      phase: "prepared",
      recordedAt: records[2].recordedAt,
    })
  )
    uncertain();
  const binding = record.nextWorkspace;
  validateWorkspaceBinding(binding);
  if (binding.anchorVenueDir !== anchor.venueDir || binding.anchorStateDir !== anchor.stateDir)
    uncertain();
  const originals = await store(anchor).readOriginals(record.resolutionId);
  const previous = originals.find((original) => original.name === "workspace:predecessor");
  const predecessor =
    previous === undefined
      ? null
      : checkedWitness(JSON.parse(previous.bytes?.toString("utf8") ?? "null"));
  if (binding.selectionGeneration === 1 ? predecessor !== null : predecessor === null) uncertain();
  let retired = anchor;
  if (predecessor !== null) {
    if (
      predecessor.binding.selectionGeneration + 1 !== binding.selectionGeneration ||
      predecessor.binding.anchorVenueDir !== anchor.venueDir ||
      predecessor.binding.anchorStateDir !== anchor.stateDir
    )
      uncertain();
    await checkedChain(anchor, predecessor, seen);
    retired = predecessor.binding;
  }
  await originalsUnchanged(anchor, record, retired, false);
  return { binding, predecessor, retired };
}
async function checkedChain(anchor: FirstSetupAnchor, witness: Witness, seen = new Set<string>()) {
  const records = await store(anchor).read(witness.binding.resolutionId),
    applied = records[1];
  if (
    records.length !== 4 ||
    applied === undefined ||
    witness.resolutionDigest !== digest(applied) ||
    witness.evidenceDigest !== applied.evidenceDigest
  )
    uncertain();
  const checked = await checkedApplied(anchor, applied, seen);
  if (!isDeepStrictEqual(checked.binding, witness.binding)) uncertain();
  await firstSetupDirectory(checked.binding.venueDir);
  await firstSetupDirectory(checked.binding.stateDir);
  if (
    !isDeepStrictEqual(
      await read(join(checked.retired.venueDir, "first-setup-retirement.json")),
      witness,
    ) ||
    !isDeepStrictEqual(
      await read(join(checked.binding.venueDir, "first-setup-workspace.json")),
      witness,
    )
  )
    uncertain();
  return { ...checked, record: applied };
}
export async function selectFirstSetupWorkspace(
  anchorInput: FirstSetupAnchor,
  record: ResolutionRecord,
): Promise<WorkspaceBinding> {
  try {
    const anchor = await canonical(anchorInput),
      { binding, predecessor, retired } = await checkedApplied(anchor, record);
    const witness: Witness = {
      version: 1,
      binding,
      evidenceDigest: record.evidenceDigest,
      resolutionDigest: digest(record),
    };
    const retirement = join(retired.venueDir, "first-setup-retirement.json");
    const backlink = join(binding.venueDir, "first-setup-workspace.json");
    const current = await read(backlink);
    if (current !== null && !isDeepStrictEqual(current, witness)) uncertain();
    const selections = [
      ...new Set([
        join(anchor.stateDir, "first-setup-selection.json"),
        join(anchor.venueDir, "first-setup-selection.json"),
      ]),
    ];
    let alreadySelected = current !== null;
    for (const path of selections) {
      const value = await read(path);
      alreadySelected &&= isDeepStrictEqual(value, witness);
      if (!isDeepStrictEqual(value, predecessor) && !isDeepStrictEqual(value, witness)) uncertain();
    }
    const archive = store(anchor);
    const records = await archive.read(record.resolutionId);
    if (alreadySelected && records.length === 4) {
      await resolveFirstSetupWorkspace(anchor);
      return binding;
    }
    await originalsUnchanged(anchor, record, retired, true);
    const {
      resolutionId,
      attemptId,
      observedRevision,
      observedOwnerGeneration,
      database,
      authority,
      register,
      nextWorkspace,
    } = record;
    const selecting = await archive.prepare(
      {
        resolutionId,
        attemptId,
        observedRevision,
        observedOwnerGeneration,
        database,
        authority,
        register,
        nextWorkspace,
        action: "select-workspace",
      },
      await archive.readOriginals(record.resolutionId),
    );
    if (current === null) {
      for (const path of [binding.venueDir, binding.stateDir]) {
        await firstSetupDirectory(path, true);
        if ((await readdir(path)).length !== 0) uncertain();
      }
    }
    // Retired roots keep their witness permanently; only the two fixed discovery records advance.
    await writeOnce(retirement, witness);
    await writeOnce(backlink, witness);
    for (const path of selections) await writeDurableHostJson(path, witness, LIMIT);
    await archive.apply(selecting);
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
    if (venue === null && state === null && retirement === null) {
      const value = await read(join(anchor.venueDir, "first-setup-workspace.json"));
      if (value === null) {
        if (basename(dirname(dirname(anchor.venueDir))) === "first-setup-workspaces") uncertain();
        return { ...anchor, binding: null };
      }
      const { binding } = checkedWitness(value);
      if (binding.venueDir !== anchor.venueDir || binding.stateDir !== anchor.stateDir) uncertain();
      const selected = await resolveFirstSetupWorkspace({
        venueDir: binding.anchorVenueDir,
        stateDir: binding.anchorStateDir,
      });
      if (!isDeepStrictEqual(selected.binding, binding)) uncertain();
      return selected;
    }
    if (venue === null || state === null || retirement === null || !isDeepStrictEqual(venue, state))
      uncertain();
    const witness = checkedWitness(venue),
      binding = witness.binding;
    if (binding.anchorVenueDir !== anchor.venueDir || binding.anchorStateDir !== anchor.stateDir)
      uncertain();
    await checkedChain(anchor, witness);
    if ((await read(join(binding.venueDir, "first-setup-retirement.json"))) !== null) uncertain();
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

export async function readFirstSetupRetirements(
  targetInput: FirstSetupAnchor,
): Promise<{ state: FirstSetupState; record: ResolutionRecord }[]> {
  try {
    const target = await canonical(targetInput);
    await assertFirstSetupBootTarget(target);
    const value = await read(join(target.venueDir, "first-setup-workspace.json"));
    if (value === null) return [];
    let witness: Witness | null = checkedWitness(value);
    const anchor = {
      venueDir: witness.binding.anchorVenueDir,
      stateDir: witness.binding.anchorStateDir,
    };
    const states: { state: FirstSetupState; record: ResolutionRecord }[] = [];
    while (witness !== null) {
      const { retired, predecessor, record } = await checkedChain(anchor, witness);
      const originals = await store(anchor).readOriginals(witness.binding.resolutionId);
      const bytes = originals.find((original) => original.name === "state/first-setup.json")?.bytes;
      if (bytes == null) uncertain();
      states.push({
        state: parseState(JSON.parse(bytes.toString("utf8")), retired.venueDir, retired.stateDir),
        record,
      });
      witness = predecessor;
    }
    return states;
  } catch {
    uncertain();
  }
}

export async function firstSetupAnchorFor(
  targetInput: FirstSetupAnchor,
): Promise<FirstSetupAnchor> {
  const target = await canonical(targetInput);
  await assertFirstSetupBootTarget(target);
  const value = await read(join(target.venueDir, "first-setup-workspace.json"));
  if (value === null) return target;
  const { binding } = checkedWitness(value);
  return { venueDir: binding.anchorVenueDir, stateDir: binding.anchorStateDir };
}

export async function readRetiredFirstSetupStates(
  target: FirstSetupAnchor,
): Promise<FirstSetupState[]> {
  return (await readFirstSetupRetirements(target)).map((entry) => entry.state);
}
