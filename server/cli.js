// starts Edit Hub's TypeScript (server/cli.ts) without a build: the loader in ts.js strips the types as files load
import './ts.js';
await import('./cli.ts');
