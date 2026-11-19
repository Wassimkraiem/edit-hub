// starts Edit Hub's TypeScript (server/hub.ts) without a build: the loader in ts.js strips the types as files load
import './ts.js';
await import('./hub.ts');
