import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { SavedCloudState } from "./cloud-client.js";
import "./errors.js";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const key = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9+/]{43}=$/.test(value) &&
  Buffer.from(value, "base64").toString("base64") === value;
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
function refused(cause: unknown): never {
  throw Object.assign(new AppError("cloud.tunnel_unavailable", {}), { cause });
}

export async function readTunnelPublicKey(directory: string): Promise<string | undefined> {
  try {
    const file = await open(
      join(directory, "public-key"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 45) throw new Error();
      const bytes = Buffer.alloc(46),
        { bytesRead } = await file.read(bytes, 0, 46, 0);
      const publicKey = bytes.subarray(0, bytesRead).toString("utf8").trim();
      if (bytesRead > 45 || !key(publicKey)) throw new Error();
      return publicKey;
    } finally {
      await file.close();
    }
  } catch (error) {
    if (missing(error)) return undefined;
    refused(error);
  }
}

export async function writeTunnelConfiguration(
  directory: string | undefined,
  state?: SavedCloudState,
): Promise<void> {
  if (!directory) return;
  try {
    if (!(await lstat(directory)).isDirectory()) throw new Error();
  } catch (error) {
    if (missing(error)) return;
    refused(error);
  }
  const path = join(directory, "peer.json");
  const service = state?.lifecycle?.view?.services.find((s) => s.service === "remote_access");
  if (
    !state?.view?.registration ||
    state.remoteAccessEnabled === false ||
    state.lifecycle?.revoked ||
    state.lifecycle?.pending?.action === "revoke" ||
    !service ||
    !["provisioning", "ready"].includes(service.state)
  ) {
    try {
      await rm(path, { force: true });
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          /^peer\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(
            entry.name,
          )
        )
          await rm(join(directory, entry.name), { force: true });
      }
    } catch (error) {
      refused(error);
    }
    return;
  }
  let peer: { address: string; gatewayPublicKey: string; endpoint: string };
  try {
    const publicKey = await readTunnelPublicKey(directory);
    if (publicKey === undefined) {
      await rm(path, { force: true });
      return;
    }
    const p: unknown = service.configuration;
    if (
      !object(p) ||
      p.version !== 1 ||
      p.installationId !== state.view.registration.installationId ||
      p.venueId !== state.view.registration.venueId ||
      p.peerPublicKey !== publicKey ||
      !key(p.gatewayPublicKey) ||
      p.port !== 443 ||
      typeof p.address !== "string" ||
      !/^10\.77\.(0|[1-9]\d{0,2})\.([1-9]\d{0,2})$/.test(p.address) ||
      Number(p.address.split(".")[2]) > 255 ||
      Number(p.address.split(".")[3]) < 2 ||
      Number(p.address.split(".")[3]) > 254 ||
      typeof p.endpoint !== "string" ||
      p.endpoint.length > 259 ||
      !p.endpoint.endsWith(":51820") ||
      !p.endpoint
        .slice(0, -6)
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      throw new Error();
    peer = { address: p.address, gatewayPublicKey: p.gatewayPublicKey, endpoint: p.endpoint };
  } catch (error) {
    try {
      await rm(path, { force: true });
    } catch (removeError) {
      refused(removeError);
    }
    refused(error);
  }
  const temporary = join(directory, "peer." + randomUUID() + ".tmp");
  try {
    const file = await open(temporary, "wx", 0o644);
    try {
      await file.writeFile(JSON.stringify(peer));
      await file.chmod(0o644);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    refused(error);
  } finally {
    try {
      await rm(temporary, { force: true });
    } catch (error) {
      refused(error);
    }
  }
}
