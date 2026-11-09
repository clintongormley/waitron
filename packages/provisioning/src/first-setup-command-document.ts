import { constants, type Stats } from "node:fs";
import { access, open, realpath, rm, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { initialSetupFor, type WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { createFirstSetupOwner, FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type { createFirstSetupNodeKeys } from "./first-setup-node-key.js";
import type { createFirstSetupRecoveryDelivery } from "./first-setup-recovery-delivery.js";
import type { FirstSetupState } from "./first-setup-state.js";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
import { firstFiscalPublicDigest } from "./first-setup-public-digest.js";
import type { ProvisioningIo } from "./io.js";
import "./errors.js";

function refuse(): never {
  throw new AppError("setup.not_ready", {});
}
const hasCode = (error: unknown, code: string) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;
const missing = (error: unknown) => hasCode(error, "ENOENT");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const limit = 8 * 1024 * 1024;

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!missing(error)) throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}
function inside(path: string, root: string) {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}
const stopped =
  "The setup stopped here and cannot carry on. Open the box's setup page in a browser and choose Start again, then run the command again.";
const cannotWrite = (path: string) =>
  `The setup could not write the recovery pack to ${path}, and has left no file there. Make sure its folder can be written to and has free space.`;
const leftBehind = (path: string) =>
  `The setup could not write the recovery pack to ${path}, and an incomplete file is left there. Name a different file when you run the command again.`;
const alreadyThere = (path: string) =>
  `A file already exists at ${path}, and the setup never writes over one: it may be an earlier setup's recovery pack, the only copy of that setup's keys. Name a file that does not exist yet, or move the existing file to another folder first.`;

/** True when no file this write created is left at `output`. Another file found there is never
 * removed; a swap between the `lstat` and the `rm` is not caught. */
async function removePartial(output: string, created: Stats | undefined): Promise<boolean> {
  let found: Stats;
  try {
    found = await lstat(output);
  } catch (error) {
    return missing(error);
  }
  if (created === undefined) return false;
  if (found.dev !== created.dev || found.ino !== created.ino) return true;
  return rm(output).then(
    () => true,
    () => false,
  );
}

function stop(io: ProvisioningIo, line: string, after: string): never {
  io.stderr(line);
  io.stderr(after);
  return refuse();
}
/** Prints why the destination is refused, then `after`, then refuses. */
async function destination(
  path: string,
  roots: readonly string[],
  io: ProvisioningIo,
  after: string,
) {
  if (path.trim() === "")
    stop(
      io,
      "--recovery-pdf was left empty. It must name a .pdf file by its full path, starting with /.",
      after,
    );
  if (!isAbsolute(path) || !path.toLowerCase().endsWith(".pdf"))
    stop(
      io,
      `--recovery-pdf must name a .pdf file by its full path, starting with /; ${path} does not.`,
      after,
    );
  const notFolder = () =>
    stop(io, `${dirname(path)} is not a folder. Name a file in a folder that exists.`, after);
  let parent: string;
  try {
    parent = await realpath(dirname(path));
  } catch (error) {
    if (hasCode(error, "ENOTDIR")) return notFolder();
    if (!missing(error)) throw error;
    return stop(
      io,
      `The folder ${dirname(path)} does not exist. Name a file in a folder that exists.`,
      after,
    );
  }
  const target = join(parent, basename(path));
  for (const root of roots) {
    if (inside(resolve(path), resolve(root)) || inside(target, await canonicalPath(resolve(root))))
      stop(
        io,
        `${path} is inside the box's own state or venue folder. Name a file outside both, so the pack is kept apart from the box.`,
        after,
      );
  }
  try {
    await lstat(target);
  } catch (error) {
    if (hasCode(error, "ENOTDIR")) return notFolder();
    if (!missing(error) && !hasCode(error, "EACCES")) throw error;
    try {
      await access(parent, constants.W_OK | constants.X_OK);
    } catch {
      return stop(
        io,
        `The setup cannot write to the folder ${dirname(path)}. Name a file in a folder it can write to.`,
        after,
      );
    }
    return target;
  }
  return stop(io, alreadyThere(path), after);
}
async function readSaved(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) refuse();
    const bytes = await file.readFile();
    if (bytes.length > limit) refuse();
    return bytes;
  } finally {
    await file.close();
  }
}

export function createFirstSetupCommandDelivery(options: {
  stateDir: string;
  venueDir: string;
  modules: readonly WaitronModule[];
  owner: ReturnType<typeof createFirstSetupOwner>;
  keys: ReturnType<typeof createFirstSetupNodeKeys>;
  recoveryDelivery: ReturnType<typeof createFirstSetupRecoveryDelivery>;
  assertSelection(state: FirstSetupState): void;
}) {
  const roots = [options.stateDir, options.venueDir];
  return {
    /** Checked before the setup records anything, so a refusal here leaves nothing to start again. */
    async checkDestination(path: string, io: ProvisioningIo) {
      await destination(
        path,
        roots,
        io,
        "Nothing was changed, so you can run the command again straight away.",
      );
    },
    async deliver(
      owner: FirstSetupOwnerAttempt,
      io: ProvisioningIo,
      path: string,
      locale: "en" | "es",
    ) {
      options.recoveryDelivery.invalidate(owner.attemptId);
      const state = await options.owner.authorize(owner);
      options.assertSelection(state);
      if (state.status !== "consumption-intent" || !["en", "es"].includes(locale)) refuse();
      const offerings = state.frozen.modules.flatMap(({ module }) => {
        const seat = initialSetupFor(options.modules, module);
        return seat?.recoveryDocument === undefined ? [] : [{ module, seat }];
      });
      if (offerings.length !== 1 || offerings[0]!.seat.commandRecoveryDocument === undefined)
        refuse();
      const { module, seat } = offerings[0]!;
      const output = await destination(path, roots, io, stopped);
      const staged = await options.keys.stageInitialNodeKey(
        owner,
        await options.owner.reconfirm(
          owner,
          await io.promptSecret("Confirm setup password: "),
          "block-use",
        ),
      );
      const context = firstSetupModuleContext(state, module);
      const document = await seat.commandRecoveryDocument!(
        context,
        seat.inspect(context, state.inputs[module]),
        {
          key: staged.key,
          identity: {
            taxpayerName: state.frozen.request.legalName,
            venueName: state.frozen.request.name,
            timeZone: state.frozen.request.timeZone,
          },
          locale,
        },
      );
      if (document.bytes.length === 0 || document.bytes.length > limit) refuse();
      await options.owner.authorize(owner);
      let file;
      try {
        file = await open(
          output,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
      } catch (error) {
        if (hasCode(error, "EEXIST")) stop(io, alreadyThere(path), stopped);
        stop(io, cannotWrite(path), stopped);
      }
      let created: Stats | undefined;
      let removed: boolean | undefined;
      try {
        created = await file.stat();
        await file.writeFile(document.bytes);
        await file.sync();
      } catch {
        // Checked while the handle is open, so a replacement cannot have reused the file's inode.
        removed = await removePartial(output, created);
      }
      const closed = await file.close().then(
        () => true,
        () => false,
      );
      if (removed !== undefined || !closed)
        stop(
          io,
          (removed ?? (await removePartial(output, created)))
            ? cannotWrite(path)
            : leftBehind(path),
          stopped,
        );
      const reference = {
        module,
        stageId: staged.stage.stageId,
        inputDigest: firstFiscalPublicDigest(state.inputs[module]),
        bindingDigest: firstFiscalPublicDigest(document.statement),
        documentDigest: digest(document.bytes),
        statement: document.statement,
      };
      await options.recoveryDelivery.registerRecoveryDocumentDelivery(owner, reference);
      io.stdout(`Recovery pack: ${output}`);
      const kept = (await io.prompt("Have you kept this recovery pack? [y/N]: "))
        .trim()
        .toLowerCase();
      await options.owner.authorize(owner);
      if (kept !== "y" && kept !== "yes") return { status: "cancelled" as const };
      const { statement: _, ...publicReference } = reference;
      void _;
      const confirmation = await options.owner.reconfirm(
        owner,
        await io.promptSecret("Confirm setup password: "),
        "activation",
      );
      if (digest(await readSaved(output)) !== reference.documentDigest) refuse();
      await options.recoveryDelivery.confirmRecoveryDocumentKept(
        owner,
        { ...publicReference, kept: true },
        confirmation,
      );
      return { status: "ready" as const };
    },
  };
}
