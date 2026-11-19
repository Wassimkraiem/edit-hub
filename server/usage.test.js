import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.test-tmp', 'usage-' + process.pid);
process.env.VIDEOHUB_CLAUDE_PROJECTS = root;
const { usage, totalsOf } = await import('./usage.js');

const crew = 'C:/studio/my-crew', dir = path.join(root, 'C--studio-my-crew'), id = '11111111-2222-3333-4444-555555555555';
const msg = (mid, model, u, content = []) => JSON.stringify({ type: 'assistant', message: { id: mid, model, usage: u, content } });
fs.mkdirSync(path.join(dir, id, 'subagents'), { recursive: true });
fs.writeFileSync(path.join(dir, id + '.jsonl'), [
  msg('m1', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e5, cache_creation: { ephemeral_1h_input_tokens: 1e5 } }),
  msg('m1', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1e6 }),   // same response again (parallel tool calls): counted once
  '{"type":"user","message":{"content":"hi"}}', 'not json',
].join('\n'));
fs.writeFileSync(path.join(dir, id, 'subagents', 'agent-a1.jsonl'), msg('s1', 'claude-sonnet-5-5', { input_tokens: 0, output_tokens: 2000, cache_read_input_tokens: 5e5, cache_creation_input_tokens: 4e4 }, [{ type: 'tool_use', name: 'REPL', input: {} }]));
fs.writeFileSync(path.join(dir, id, 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'onetake-brand', description: 'Astryx brand edit' }));

test('a conversation and each crew agent: tokens split by kind and a cost at list prices', () => {
  const u = usage({ cwd: crew, session: id });
  assert.equal(u.director.calls, 1); assert.equal(u.director.cacheRead, 1e6); assert.equal(u.director.output, 1000);
  // opus: 1000×4 + 1e5×4×2 (1-hour write) + 1e6×0.2 + 1000×20 = 1,024,000 per million → $1.024
  assert.ok(Math.abs(u.director.cost - 1.024) < 1e-9);
  const a = u.agents[0]; assert.equal(a.agent, 'onetake-brand'); assert.equal(a.description, 'Astryx brand edit'); assert.equal(a.codeMode, true);
  // sonnet: 4e4×2×1.25 (5-minute write) + 5e5×0.1 + 2000×10 = 170,000 → $0.17
  assert.ok(Math.abs(a.cost - 0.17) < 1e-9);
  assert.ok(Math.abs(u.total.cost - 1.194) < 1e-9); assert.equal(u.total.codeMode, true); assert.deepEqual(Object.keys(u.total.models).sort(), ['opus', 'sonnet']);
  assert.equal(usage({ cwd: crew, session: id, agent: 'a1' }).output, 2000);
  assert.equal(usage({ cwd: crew }).session, id);   // no id: the most recent conversation
});

test('ids from the page cannot reach other files', () => {
  assert.throws(() => usage({ cwd: crew, session: '../../secrets' }), /Bad conversation id/);
  assert.throws(() => usage({ cwd: crew, session: id, agent: '../x' }), /Bad agent id/);
  assert.equal(totalsOf(path.join(dir, 'missing.jsonl')), null);
  fs.rmSync(root, { recursive: true, force: true });
});
