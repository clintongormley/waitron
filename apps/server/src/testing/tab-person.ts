// The file, not the package: loading `@waitron/shared` whole from a setup file would load it before a
// test file's own `vi.mock` of one of its modules could take effect.
import { PERSON_HEADER } from "@waitron/shared/src/person-header.js";

// Which person each till session token belongs to, for the requests this test file sends. Filled
// by `tab-person-setup.ts`; reset with the module graph for every test file.
const personOf = new Map<string, string>();
const leftAlone = new Set<string>();

export function noteSessionPerson(token: string, personId: string): void {
  personOf.set(token, personId);
}

/** For a test of what the box does with a request naming no one: this session's requests keep
 * whatever person header the test gives them, none included. */
export function leaveSessionAlone(token: string): void {
  leftAlone.add(token);
}

/** The person of the first known token among the cookie header's values. Values, not one cookie's
 * name: a session token is random, so no other cookie carries one. */
function personForCookies(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;
  for (const pair of cookieHeader.split(";")) {
    const value = pair.slice(pair.indexOf("=") + 1).trim();
    if (leftAlone.has(value)) return null;
    const person = personOf.get(value);
    if (person !== undefined) return person;
  }
  return null;
}

/** The init to send in place of `init`: the same, plus the person header when the request carries
 * a known token and names no one itself. `undefined` when nothing is to be added; a `Request` sent
 * with no init gains the header in place, so a test's own hooks on that object still run. */
export function initNamingPerson(
  input: unknown,
  init: RequestInit | undefined,
): RequestInit | undefined {
  if (input instanceof Request && init === undefined) {
    const person = personToName(input.headers);
    if (person !== null) input.headers.set(PERSON_HEADER, person);
    return undefined;
  }
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const person = personToName(headers);
  if (person === null) return undefined;
  headers.set(PERSON_HEADER, person);
  return { ...init, headers };
}

function personToName(headers: Headers): string | null {
  return headers.has(PERSON_HEADER) ? null : personForCookies(headers.get("cookie"));
}

/** Notes the person of a sign-in answer: a successful `POST …/api/session` whose body names a
 * `personId` and which sets a cookie. Its body stays unread for the caller. */
export async function learnFromAnswer(
  input: unknown,
  init: RequestInit | undefined,
  res: Response,
): Promise<void> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  if (method !== "POST" || !res.ok || !/\/api\/session(\?|$)/.test(url)) return;
  const cookies = res.headers.getSetCookie();
  if (cookies.length === 0) return;
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    return;
  }
  const personId = (body as { personId?: unknown } | null)?.personId;
  if (typeof personId !== "string") return;
  for (const cookie of cookies) {
    const pair = cookie.split(";")[0]!;
    const value = pair.slice(pair.indexOf("=") + 1).trim();
    if (value !== "") noteSessionPerson(value, personId);
  }
}
