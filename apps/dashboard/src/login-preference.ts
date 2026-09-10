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

function read(storage: Storage): Omit<LoginPreference, "persistent"> | null {
  try {
    return parse(storage.getItem(KEY));
  } catch {
    return null;
  }
}

export function readLoginPreference(): LoginPreference | null {
  const tab = read(sessionStorage);
  const saved = read(localStorage);
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
  try {
    sessionStorage.setItem(KEY, serialized);
  } catch {
    // The shortcut is optional; authentication does not depend on browser storage.
  }
  try {
    if (persistent) {
      localStorage.setItem(KEY, serialized);
    } else if (read(localStorage)?.email === email) {
      localStorage.removeItem(KEY);
    }
  } catch {
    // The current-tab shortcut above remains useful when persistent storage is unavailable.
  }
}

export function forgetLoginPreference(): void {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      storage.removeItem(KEY);
    } catch {
      // A denied store is already equivalent to forgetting it for this page.
    }
  }
}
