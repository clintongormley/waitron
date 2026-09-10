export type LoginMethod = "password" | "passkey" | "google";

export interface LoginPreference {
  email: string;
  method: LoginMethod;
  persistent: boolean;
}

const KEY = "waitron-login-preference";

function parse(value: string | null): Omit<LoginPreference, "persistent"> | null {
  if (value === null) return null;
  try {
    const candidate = JSON.parse(value) as { email?: unknown; method?: unknown };
    if (
      typeof candidate.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email) ||
      (candidate.method !== "password" &&
        candidate.method !== "passkey" &&
        candidate.method !== "google")
    ) {
      return null;
    }
    return { email: candidate.email, method: candidate.method };
  } catch {
    return null;
  }
}

type StorageName = "sessionStorage" | "localStorage";

function getStorage(name: StorageName): Storage | null {
  try {
    return window[name];
  } catch {
    return null;
  }
}

function read(storage: Storage | null): Omit<LoginPreference, "persistent"> | null {
  if (storage === null) return null;
  try {
    return parse(storage.getItem(KEY));
  } catch {
    return null;
  }
}

export function readLoginPreference(): LoginPreference | null {
  const tab = read(getStorage("sessionStorage"));
  const saved = read(getStorage("localStorage"));
  const preference = tab ?? saved;
  if (preference === null) return null;
  return {
    ...preference,
    persistent: saved?.email === preference.email,
  };
}

export function rememberSuccessfulLogin(
  emailValue: string,
  method: LoginMethod,
  persistent: boolean,
): void {
  const email = emailValue.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  const serialized = JSON.stringify({ email, method });
  const tab = getStorage("sessionStorage");
  const saved = getStorage("localStorage");
  try {
    tab?.setItem(KEY, serialized);
  } catch {
    // The shortcut is optional; authentication does not depend on browser storage.
  }
  try {
    if (persistent) {
      saved?.setItem(KEY, serialized);
    } else if (read(saved)?.email === email) {
      saved?.removeItem(KEY);
    }
  } catch {
    // The current-tab shortcut above remains useful when persistent storage is unavailable.
  }
}

function removeMatching(storage: Storage | null, email?: string): void {
  if (storage === null) return;
  try {
    if (email === undefined || read(storage)?.email === email.trim().toLowerCase()) {
      storage.removeItem(KEY);
    }
  } catch {
    // A denied store is already equivalent to forgetting it for this page.
  }
}

export function clearTabLoginPreference(): void {
  removeMatching(getStorage("sessionStorage"));
}

export function disablePersistentLoginPreference(email: string): void {
  removeMatching(getStorage("localStorage"), email);
}

export function forgetLoginPreference(email?: string): void {
  for (const name of ["sessionStorage", "localStorage"] as const) {
    try {
      removeMatching(getStorage(name), email);
    } catch {
      // A denied store is already equivalent to forgetting it for this page.
    }
  }
}
