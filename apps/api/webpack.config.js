module.exports = function (options) {
  return {
    ...options,
    externals: ({ request }) => {
      // Bundle workspace packages inline instead of externalizing them
      if (request.startsWith("@waitron/")) {
        return undefined;
      }
      // Externalize node_modules (default NestJS webpack behavior)
      if (/^[^./]/.test(request)) {
        return Promise.resolve("commonjs " + request);
      }
      return undefined;
    },
  };
};
