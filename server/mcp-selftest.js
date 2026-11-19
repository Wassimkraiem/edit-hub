// starts Edit Hub's TypeScript (server/mcp-selftest.ts) without a build: the loader in ts.js strips the types as files load
import './ts.js';
await import('./mcp-selftest.ts');
