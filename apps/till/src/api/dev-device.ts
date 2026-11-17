/** A tab stores only its chosen device id; authentication stays in server-set cookies. */
export const DEV_DEVICE_STORAGE_KEY = "waitron.devDeviceId";
export const DEV_DEVICE_HEADER = "x-waitron-dev-device";

export function readDevDeviceId(): string | null {
  const value = sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY);
  return value === null || value === "" ? null : value;
}

export function setDevDeviceId(id: string): void {
  sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, id);
}

export function clearDevDeviceId(): void {
  sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
}

export function withDevDeviceHeader(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const id = readDevDeviceId();
    if (id === null) return fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    headers.set(DEV_DEVICE_HEADER, id);
    return fetchImpl(input, { ...init, headers });
  };
}
