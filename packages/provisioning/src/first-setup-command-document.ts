import { constants } from "node:fs";
import { open, realpath, lstat } from "node:fs/promises";
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
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
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
async function externalPath(path: string, roots: readonly string[]) {
  if (!isAbsolute(path) || !path.toLowerCase().endsWith(".pdf")) refuse();
  const parent = await realpath(dirname(path));
  const target = join(parent, basename(path));
  for (const root of roots) {
    if (inside(resolve(path), resolve(root)) || inside(target, await canonicalPath(resolve(root))))
      refuse();
  }
  return target;
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
  return {
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
      const output = await externalPath(path, [options.stateDir, options.venueDir]);
      let reference = await options.recoveryDelivery.readRecoveryDocument(owner, module);
      if (reference === null) {
        try {
          await lstat(output);
          refuse();
        } catch (error) {
          if (!missing(error)) throw error;
        }
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
              venueName: state.frozen.request.location.name,
              timeZone: state.frozen.request.location.timeZone,
            },
            locale,
          },
        );
        if (document.bytes.length === 0 || document.bytes.length > limit) refuse();
        await options.owner.authorize(owner);
        const file = await open(
          output,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await file.writeFile(document.bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        reference = {
          module,
          stageId: staged.stage.stageId,
          inputDigest: firstFiscalPublicDigest(state.inputs[module]),
          bindingDigest: firstFiscalPublicDigest(document.statement),
          documentDigest: digest(document.bytes),
          statement: document.statement,
        };
      } else if (digest(await readSaved(output)) !== reference.documentDigest) refuse();
      await options.recoveryDelivery.registerRecoveryDocumentDelivery(owner, reference);
      io.stdout(`Recovery PDF: ${output}`);
      const kept = (await io.prompt("Have you kept this recovery PDF? [y/N]: "))
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
