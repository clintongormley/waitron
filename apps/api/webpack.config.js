module.exports = function (options) {
  // Remove ForkTsCheckerWebpackPlugin — it tries to type-check workspace
  // package sources (Drizzle ORM etc.) and hangs indefinitely. Type safety
  // is covered by `tsc --noEmit` in CI.
  const plugins = (options.plugins || []).filter(
    (p) => p.constructor.name !== "ForkTsCheckerWebpackPlugin",
  );

  // Remove TsconfigPathsPlugin — we have no tsconfig path mappings and it
  // can cause slow filesystem scans during module resolution.
  const resolve = {
    ...options.resolve,
    plugins: (options.resolve?.plugins || []).filter(
      (p) => p.constructor.name !== "TsconfigPathsPlugin",
    ),
  };

  return {
    ...options,
    plugins,
    resolve,
    // Disable persistent cache — webpack 5's filesystem cache keeps the
    // process alive after compilation, preventing `nest build` from exiting.
    cache: false,
    // Use an array so webpack invokes this as a callback-style external.
    // A bare function uses the Promise API which hangs in this webpack version.
    externals: [
      function ({ request }, callback) {
        // Bundle workspace packages inline instead of externalizing them.
        if (request.startsWith("@waitron/")) return callback();
        // Externalize bare module specifiers (npm packages). The extension
        // check prevents externalizing project file paths like "src/main.ts"
        // that lack a leading "./" due to path.join() normalisation.
        if (/^[^./]/.test(request) && !/\.[cm]?[jt]sx?$/.test(request)) {
          return callback(null, "commonjs " + request);
        }
        return callback();
      },
    ],
  };
};
