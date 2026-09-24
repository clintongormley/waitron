import { randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { ProvisioningIo } from "./io.js";
import "./errors.js";

const KEY_BYTES = 32;

export interface GeneratedKeyRing {
  /** Base64, exactly `KEY_BYTES` decoded — the shape `loadKeyRing` (packages/credentials) validates. */
  key: string;
  version: number;
}

/** `random` is injected so a test can pin the bytes and reach the short-read branch. */
export function generateKeyRing(random: (bytes: number) => Buffer = randomBytes): GeneratedKeyRing {
  const key = random(KEY_BYTES);
  if (key.length !== KEY_BYTES) {
    throw new AppError("provisioning.key_generation_failed", { byteLength: key.length });
  }
  return { key: key.toString("base64"), version: 1 };
}

export async function runKeyring(
  io: ProvisioningIo,
  random: (bytes: number) => Buffer = randomBytes,
): Promise<number> {
  const ring = generateKeyRing(random);
  io.stdout("The credential key ring. This is shown ONCE and cannot be recovered.");
  io.stdout("");
  io.stdout(`WAITRON_CREDENTIALS_KEY=${ring.key}`);
  io.stdout(`WAITRON_CREDENTIALS_KEY_VERSION=${ring.version}`);
  io.stdout("");
  io.stdout("Store it where the host will read it from, and where you can find it again.");
  io.stdout("Without it every sealed credential is unrecoverable and the host will not migrate.");
  io.stdout("");
  io.stdout("The screen and scrollback will be cleared when you continue. That is not a");
  io.stdout("guarantee: a terminal that logs to disk, or tmux's own buffer, still has it.");
  await io.prompt("Press enter once you have stored it. ");
  io.clearScreen();
  return 0;
}
