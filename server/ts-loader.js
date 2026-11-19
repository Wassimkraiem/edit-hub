// Lets Node run Edit Hub's TypeScript as it is, with no build step (Node 22.13+): a .ts file loads with its types removed
// by Node's own stripTypeScriptTypes, and an import of "./x.js" finds "./x.ts" when only that exists (TypeScript's own
// convention), so imports read the same everywhere. Registered by server/ts.js; plain JS on purpose.
import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';
// the hooks run in their own thread: keep Node's "type stripping is experimental" notice out of every start
process.removeAllListeners('warning'); process.on('warning', w => { if (!/stripTypeScriptTypes|Type Stripping/i.test(w.message)) console.warn(w.name + ': ' + w.message); });

export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (e) {
    const local = /^(\.{1,2}\/|\/|file:)/.test(specifier);
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !local || !/\.js$/.test(specifier)) throw e;
    return next(specifier.replace(/\.js$/, '.ts'), context);
  }
}

export async function load(url, context, next) {
  if (!url.startsWith('file:') || !/\.ts$/.test(new URL(url).pathname)) return next(url, context);
  const source = stripTypeScriptTypes(await readFile(new URL(url), 'utf8'));
  return { format: 'module', source, shortCircuit: true };
}
