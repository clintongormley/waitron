module.exports = function (options) {
  return {
    ...options,
    externals: (context, request, callback) => {
      // Bundle workspace packages inline instead of externalizing them
      if (request.startsWith("@waitron/")) {
        return callback();
      }
      // Externalize node_modules (default NestJS webpack behavior)
      if (/^[^./]/.test(request)) {
        return callback(null, "commonjs " + request);
      }
      callback();
    },
  };
};
