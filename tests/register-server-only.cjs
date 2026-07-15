// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node --require preloaders are CommonJS.
const Module = require("node:module");

const originalLoad = Module._load;

Module._load = function loadForIntegrationTest(request, parent, isMain) {
  if (
    request === "server-only" ||
    /[\\/]node_modules[\\/]server-only[\\/]index\.js$/.test(request)
  ) {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
