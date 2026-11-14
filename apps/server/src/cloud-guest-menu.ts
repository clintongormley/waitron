import { createHash, randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { SavedCloudState } from "./cloud-client.js";
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
