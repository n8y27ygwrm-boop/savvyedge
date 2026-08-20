const Module = require("node:module");

const FORBIDDEN_MODULE_PATH = /playwright(?:-core)?/i;
const originalLoad = Module._load;

Module._load = function guardedModuleLoad(request, parent, isMain) {
  if (FORBIDDEN_MODULE_PATH.test(String(request))) {
    throw new Error(
      `Browser runtime entered lightweight import graph: ${request}`,
    );
  }

  const resolved = Module._resolveFilename(request, parent, isMain);
  if (FORBIDDEN_MODULE_PATH.test(String(resolved))) {
    throw new Error(
      `Browser runtime entered lightweight import graph: ${resolved}`,
    );
  }

  return originalLoad.call(this, request, parent, isMain);
};
