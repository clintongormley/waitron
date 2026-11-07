/** `https://` or `http://` in any letter case, then the host: no third slash or a backslash. */
export const WEB_ADDRESS_START = /^https?:\/\/[^/\\]/i;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;

/**
 * A web address with no user name, password, query or fragment, where a secret could sit. The raw
 * text is read as well as the parse: `URL` reads `https:host` as `https://host/`, drops a tab, and
 * reads `search` and `hash` as empty for a bare `?` or `#`.
 */
export function isPlainWebAddress(value: string): boolean {
  if (!WEB_ADDRESS_START.test(value) || CONTROL_CHARACTER.test(value) || /[?#]/.test(value)) {
    return false;
  }
  const url = URL.parse(value);
  return url !== null && url.username === "" && url.password === "";
}
