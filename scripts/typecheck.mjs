import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { constants as osConstants, homedir } from "node:os";
import { dirname, join } from "node:path";
import { isMainScript } from "./is-main-script.mjs";

// Darwin's O_EXLOCK binds the lock to the descriptor inherited by the compiler.
const exclusiveOpen = constants.O_CREAT | constants.O_RDWR | 0x00000020;

async function acquireSlot(file) {
  await mkdir(dirname(file), { recursive: true });
  try {
    return await open(file, exclusiveOpen | constants.O_NONBLOCK, 0o600);
  } catch (error) {
    if (error.code !== "EAGAIN") throw error;
  }
  console.error(`Waiting for the Waitron typecheck slot at ${file}`);
  return open(file, exclusiveOpen, 0o600);
}

function run(command, args, options) {
  const { status, signal, error } = spawnSync(command, args, options);
  if (error) throw error;
  return status ?? 128 + osConstants.signals[signal];
}

export async function runTypecheck(
  args,
  {
    cwd = process.cwd(),
    platform = process.platform,
    lockFile = join(homedir(), "Library", "Caches", "waitron-typecheck.lock"),
  } = {},
) {
  const fromPackage = createRequire(join(cwd, "package.json"));
  const manifest = fromPackage.resolve("typescript/package.json");
  if (platform !== "darwin") {
    const { bin } = fromPackage(manifest);
    return run(process.execPath, [join(dirname(manifest), bin.tsc), ...args], {
      cwd,
      stdio: "inherit",
    });
  }

  // The TypeScript Node launcher execs the native binary and closes extra descriptors.
  const fromTypeScript = createRequire(manifest);
  const native = fromTypeScript.resolve(
    `@typescript/typescript-darwin-${process.arch}/package.json`,
  );
  const compiler = join(dirname(native), "lib", "tsc");
  const env = { ...process.env, GOMEMLIMIT: process.env.GOMEMLIMIT || "8GiB" };
  let lock;
  try {
    lock = await acquireSlot(lockFile);
  } catch (error) {
    if (error.code !== "EACCES" && error.code !== "EPERM") throw error;
    console.error(
      `Waitron typecheck could not open the slot at ${lockFile}. Running without the lock.`,
    );
    return run(compiler, args, { cwd, env, stdio: "inherit" });
  }
  try {
    return run(compiler, args, { cwd, env, stdio: ["inherit", "inherit", "inherit", lock.fd] });
  } finally {
    await lock.close();
  }
}

if (isMainScript(import.meta.url)) {
  process.exitCode = await runTypecheck(process.argv.slice(2));
}
