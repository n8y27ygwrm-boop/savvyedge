const FORBIDDEN_MODULE_PATH = /playwright(?:-core)?/i;

function rejectBrowserRuntime(value) {
  if (FORBIDDEN_MODULE_PATH.test(String(value))) {
    throw new Error(
      `Browser runtime entered lightweight import graph: ${value}`,
    );
  }
}

export async function resolve(specifier, context, nextResolve) {
  rejectBrowserRuntime(specifier);
  const resolved = await nextResolve(specifier, context);
  rejectBrowserRuntime(resolved.url);
  return resolved;
}

export async function load(url, context, nextLoad) {
  rejectBrowserRuntime(url);
  return nextLoad(url, context);
}
