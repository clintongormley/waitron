import { createHash, randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { SavedCloudState, CloudConnection } from "./cloud-client.js";
import { serviceExchange, type OnRefusal } from "./cloud-translation.js";
import "./errors.js";

export interface CloudGuestMenuView {
  version: 1;
  url: string;
  revision: number;
  state: "off" | "current" | "blocked";
  publication: null | { bodySha256: string; defaultLanguage: string; receivedAt: string };
}

function readView(value: Record<string, unknown>, state: SavedCloudState): CloudGuestMenuView {
  const unavailable = () => new AppError("cloud.unavailable", {});
  if (
    typeof value.url !== "string" ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    typeof value.state !== "string" ||
    !["off", "current", "blocked"].includes(value.state)
  )
    throw unavailable();
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw unavailable();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/m/${state.view?.registration?.venueId}`
  )
    throw unavailable();
  const publication = value.publication as CloudGuestMenuView["publication"];
  if (
    value.state === "current"
      ? !publication ||
        typeof publication.bodySha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(publication.bodySha256) ||
        typeof publication.defaultLanguage !== "string" ||
        publication.defaultLanguage === "" ||
        typeof publication.receivedAt !== "string" ||
        !Number.isFinite(Date.parse(publication.receivedAt))
      : publication !== null
  )
    throw unavailable();
  return {
    version: 1,
    url: value.url,
    revision: Number(value.revision),
    state: value.state as CloudGuestMenuView["state"],
    publication,
  };
}

export async function fetchGuestMenuStatus(
  state: SavedCloudState,
  signal?: AbortSignal,
  onRefusal?: OnRefusal,
): Promise<CloudGuestMenuView> {
  return readView(
    await serviceExchange(
      state,
      "guest-menu-status",
      randomUUID(),
      JSON.stringify({ version: 1 }),
      {},
      signal,
      onRefusal,
    ),
    state,
  );
}

export async function publishCloudGuestMenu(
  state: SavedCloudState,
  expectedRevision: number,
  body: string,
  signal?: AbortSignal,
  onRefusal?: OnRefusal,
): Promise<CloudGuestMenuView> {
  const bodyBytes = Buffer.byteLength(body);
  if (bodyBytes > 2097152) throw new AppError("cloud.request_invalid", {});
  const signed = {
    version: 1,
    expectedRevision,
    bodySha256: createHash("sha256").update(body).digest("hex"),
    bodyBytes,
  };
  return readView(
    await serviceExchange(
      state,
      "guest-menu-publish",
      randomUUID(),
      JSON.stringify(signed),
      { body },
      signal,
      onRefusal,
    ),
    state,
  );
}

export async function withdrawCloudGuestMenu(
  state: SavedCloudState,
  signal?: AbortSignal,
  onRefusal?: OnRefusal,
): Promise<CloudGuestMenuView> {
  return readView(
    await serviceExchange(
      state,
      "guest-menu-withdraw",
      randomUUID(),
      JSON.stringify({ version: 1 }),
      {},
      signal,
      onRefusal,
    ),
    state,
  );
}

export interface GuestMenuDeliveryStatus {
  state: "not_connected" | "pending" | "current" | "off" | "blocked" | "refused";
  receivedAt: string | null;
}

export function createGuestMenuDelivery(options: {
  connection: CloudConnection;
  readPages: () => Promise<{ defaultLanguage: string; pages: Record<string, string> } | null>;
  isPrimary: () => boolean;
}) {
  let confirmed: CloudGuestMenuView | undefined;
  let identity: string | undefined;
  let refused: string | undefined;
  const digest = (body: string) => createHash("sha256").update(body).digest("hex");
  const desiredBody = async () => {
    const pages = await options.readPages();
    return pages === null ? null : JSON.stringify(pages);
  };
  const currentIdentity = async () => (await options.connection.status()).registration?.venueId;
  return {
    async reconcile(signal: AbortSignal) {
      if (signal.aborted || !options.isPrimary()) return;
      const venue = await currentIdentity();
      const remote = await options.connection.guestMenuStatus(signal);
      confirmed = remote;
      identity = venue;
      const body = await desiredBody();
      if (signal.aborted || !options.isPrimary()) return;
      try {
        if (body === null) {
          if (remote.state === "current")
            confirmed = await options.connection.withdrawGuestMenu(signal);
        } else if (remote.state !== "blocked" && remote.publication?.bodySha256 !== digest(body)) {
          confirmed = await options.connection.publishGuestMenu(remote.revision, body, signal);
        }
        refused = undefined;
      } catch (error) {
        if (error instanceof AppError && error.code === "cloud.request_invalid")
          refused = body === null ? "off" : digest(body);
        throw error;
      }
    },
    async status(): Promise<GuestMenuDeliveryStatus> {
      const local = await options.connection.status();
      const venue = local.registration?.venueId;
      if (!venue || local.installation?.state === "revoked")
        return { state: "not_connected", receivedAt: null };
      const body = await desiredBody();
      const remote = venue === identity && options.isPrimary() ? confirmed : undefined;
      const state =
        remote?.state === "blocked"
          ? "blocked"
          : remote && refused === (body === null ? "off" : digest(body))
            ? "refused"
            : body === null
              ? remote?.state === "off"
                ? "off"
                : "pending"
              : remote?.state === "current" && remote.publication?.bodySha256 === digest(body)
                ? "current"
                : "pending";
      return { state, receivedAt: remote?.publication?.receivedAt ?? null };
    },
  };
}
