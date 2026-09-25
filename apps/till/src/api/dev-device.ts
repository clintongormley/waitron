/**
 * Dev-only per-tab device identity: `sessionStorage` is per tab, so one browser can run several
 * devices side by side. The server honours the header only in devMode.
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
    /* blocked storage: the tab falls back to the cookie identity */
  }
}

/** Clearing the cookie alone would leave this override in place, so the tab would keep adopting the
 * same device on its next request. */
export function clearDevDeviceId(): void {
  try {
    sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
  } catch {
    /* blocked storage: nothing to clear */
  }
}

export function withDevDeviceHeader(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const id = readDevDeviceId();
    if (id === null) return fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    headers.set(DEV_DEVICE_HEADER, id);
    return fetchImpl(input, { ...init, headers });
  };
}
