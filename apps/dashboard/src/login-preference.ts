export type LoginMethod = "password" | "passkey" | "google";

export interface LoginPreference {
  email: string;
  method: LoginMethod;
  persistent: boolean;
}

export interface PendingLoginPreference {
  method: LoginMethod;
  persistent: boolean;
  rememberedEmail?: string;
}

const KEY = "waitron-login-preference";
const GOOGLE_INTENT_KEY = "waitron-google-login-preference";

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
  const saved = read(getStorage("localStorage"));
  return saved === null ? null : { ...saved, persistent: true };
}

export function rememberSuccessfulLogin(
  emailValue: string,
  method: LoginMethod,
  persistent: boolean,
  rememberedEmail?: string,
): void {
  if (
    !persistent ||
    (rememberedEmail !== undefined &&
      rememberedEmail.trim().toLowerCase() !== emailValue.trim().toLowerCase())
  ) {
    forgetLoginPreference();
    return;
  }
  const email = emailValue.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  try {
    getStorage("localStorage")?.setItem(KEY, JSON.stringify({ email, method }));
  } catch {
    // The shortcut is optional; authentication does not depend on browser storage.
  }
}

/** Forget the whole shortcut, including any tab-scoped value already present in this browser. */
export function forgetLoginPreference(): void {
  consumeGoogleLoginPreference(false);
  for (const name of ["sessionStorage", "localStorage"] as const) {
    try {
      getStorage(name)?.removeItem(KEY);
    } catch {
      // Failure in one store must not prevent clearing the other.
    }
  }
}

/** Carry explicit consent across Google's navigation, without saving a login identity yet. */
export function prepareGoogleLoginPreference(remember: boolean, rememberedEmail?: string): void {
  consumeGoogleLoginPreference(false);
  if (!remember) {
    forgetLoginPreference();
    return;
  }
  try {
    getStorage("sessionStorage")?.setItem(
      GOOGLE_INTENT_KEY,
      JSON.stringify({
        expiresAt: Date.now() + 10 * 60 * 1000,
        ...(rememberedEmail === undefined ? {} : { rememberedEmail }),
      }),
    );
  } catch {
    // A missing preference must not prevent authentication.
  }
}

/** Consume once, even after cancellation; only a successful callback may use the intent. */
export function consumeGoogleLoginPreference(
  isGoogleCallback: boolean,
): PendingLoginPreference | undefined {
  try {
    const storage = getStorage("sessionStorage");
    const value = storage?.getItem(GOOGLE_INTENT_KEY);
    storage?.removeItem(GOOGLE_INTENT_KEY);
    if (!isGoogleCallback || !value) return undefined;
    const intent = JSON.parse(value) as { expiresAt?: unknown; rememberedEmail?: unknown };
    if (
      typeof intent.expiresAt !== "number" ||
      !Number.isFinite(intent.expiresAt) ||
      intent.expiresAt <= Date.now() ||
      (intent.rememberedEmail !== undefined && typeof intent.rememberedEmail !== "string")
    )
      return undefined;
    return {
      method: "google",
      persistent: true,
      ...(typeof intent.rememberedEmail === "string"
        ? { rememberedEmail: intent.rememberedEmail }
        : {}),
    };
  } catch {
    return undefined;
  }
}
