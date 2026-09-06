/**
 * Dev-only per-tab device identity (SP-C). The chosen device's id lives in `sessionStorage` (per-tab,
 * so one browser can run several devices in separate tabs) and rides every request as the
 * `x-waitron-dev-device` header, which the server honours ONLY in devMode. Inert wherever the key is
 * unset; every storage access is guarded so a private window / blocked storage degrades to "no
 * override" rather than throwing.
 */
export const DEV_DEVICE_STORAGE_KEY = "waitron.devDeviceId";
export const DEV_DEVICE_HEADER = "x-waitron-dev-device";

export function readDevDeviceId(): string | null {
  try {
    const v = sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY);
    return v === null || v === "" ? null : v;
  } catch {
    return null;
  }
}

export function setDevDeviceId(id: string): void {
  try {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, id);
  } catch {
    /* private window / blocked storage — the tab simply falls back to the cookie identity */
  }
}

/** Drop this tab's stored device override, so the tab reverts to the cookie identity. Paired with the
 * dev chooser's cookie reset: clearing the cookie alone would leave the sessionStorage override in place,
 * so the tab would keep adopting the same device on the next request. Guarded like the accessors above —
 * a private window / blocked storage degrades to a no-op rather than throwing. */
export function clearDevDeviceId(): void {
  try {
    sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
  } catch {
    /* private window / blocked storage — nothing to clear */
  }
}

/** Wrap a `fetch` so it adds the dev-override header when this tab has a stored device id. */
export function withDevDeviceHeader(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const id = readDevDeviceId();
    if (id === null) return fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    headers.set(DEV_DEVICE_HEADER, id);
    return fetchImpl(input, { ...init, headers });
  };
}
