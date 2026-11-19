// For tests that run a module's source text in a sandbox: the .ts source with its types removed, as Node runs it.
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
export const tsSource = url => stripTypeScriptTypes(fs.readFileSync(url, 'utf8'));
