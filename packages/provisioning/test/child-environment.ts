/** This process's environment, for a child whose error output a test reads exactly. */
export function childEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Stripe's SDK writes a hint to stderr when these are set (stripe@23.1.0 esm/stripe.core.js:139).
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_CHILD_SESSION;
  return env;
}
