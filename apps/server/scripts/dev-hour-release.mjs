// Preloaded by `dev-server.mjs` into a source run: a bundle has its release stamp compiled in
// (`scripts/bundle-node.mjs`), and this gives a `tsx` run the stamp the launcher computed from HEAD.
const raw = process.env.WAITRON_DEV_HOUR_RELEASE;
if (raw !== undefined && raw !== "") {
  try {
    globalThis.__WAITRON_HOUR_RELEASE__ = Object.freeze(JSON.parse(raw));
  } catch {
    // An unreadable stamp leaves the run without one, as a plain source start is.
  }
}
