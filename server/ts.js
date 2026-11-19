// Import this first (an entry file, or `node --import ./server/ts.js`) and the rest of Edit Hub can be TypeScript.
import { register } from 'node:module';
process.removeAllListeners('warning');   // Node marks type stripping experimental on every start; the app's own warnings stay on stderr
process.on('warning', w => { if (!/stripTypeScriptTypes|Type Stripping/i.test(w.message)) console.warn(w.name + ': ' + w.message); });
register('./ts-loader.js', import.meta.url);
