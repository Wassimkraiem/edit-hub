import test from 'node:test';
import assert from 'node:assert/strict';
import { toEvents, safeName, modelTotals, replyShare, stale } from './director.js';

test('crew agents in the background: launched, continued with SendMessage, then finished or failed', () => {
  const briefs = new Map();
  toEvents({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'audio-cleaner', description: 'clean 3499', run_in_background: true } }] } }, briefs);
  const launched = toEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: a18c (internal ID)' }] }] } }, briefs);
  assert.deepEqual(launched, [{ kind: 'briefBackground', id: 't1', agent: 'audio-cleaner' }]);
  assert.deepEqual(toEvents({ type: 'system', subtype: 'init', session_id: 's2', model: 'm', slash_commands: ['onetake', 'clear', 'exit'], terminal_slash_commands: ['exit'] })[0].commands, ['onetake', 'clear']);   // what can follow '/', without terminal-only ones
  const resumed = toEvents({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'SendMessage', input: { to: 'a18c', summary: 'finish the cut' } }] } }, briefs);
  assert.deepEqual(resumed, [{ kind: 'briefResume', id: 't1', agent: 'audio-cleaner', text: 'finish the cut' }]);
  const note = '<task-notification>\n<task-id>a18c</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n<summary>Agent "clean 3499" finished</summary>\n<result>Clean audio: D:/a.wav</result>\n</task-notification>';
  assert.deepEqual(toEvents({ type: 'user', message: { content: note } }, briefs), [{ kind: 'briefDone', id: 't1', agent: 'audio-cleaner', agentId: 'a18c', ok: true, status: 'completed', text: 'Clean audio: D:/a.wav' }]);
  assert.deepEqual(toEvents({ type: 'system', subtype: 'task_notification', task_id: 'a18c', status: 'failed', summary: 'ffmpeg crashed' }, briefs), [{ kind: 'briefDone', id: 't1', agent: 'audio-cleaner', agentId: 'a18c', ok: false, status: 'failed', text: 'ffmpeg crashed' }]);
  assert.deepEqual(toEvents({ type: 'user', message: { content: '<task-notification><task-id>zz</task-id><status>completed</status></task-notification>' } }, briefs), []);   // unknown agent: nothing to mark
});

test('a continued agent finishes under its own id; background commands are not agents (today\'s editor run)', () => {
  const briefs = new Map();
  toEvents({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tEdit', name: 'Agent', input: { subagent_type: 'editor', run_in_background: true } }] } }, briefs);
  toEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tEdit', content: 'Async agent launched successfully.\nagentId: a62969507e0cf51f3 (internal ID)' }] } }, briefs);
  toEvents({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tSend', name: 'SendMessage', input: { to: 'a62969507e0cf51f3', summary: 'Use real brand logos' } }] } }, briefs);
  const note = (task, tool, status = 'completed') => ({ type: 'user', message: { content: `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${tool}</tool-use-id>\n<status>${status}</status>\n<summary>x</summary>\n</task-notification>` } });
  // the editor's notice names the SendMessage call, not the first one: it still closes the editor
  assert.deepEqual(toEvents(note('a62969507e0cf51f3', 'tSend'), briefs).map(e => [e.kind, e.id, e.agent]), [['briefDone', 'tEdit', 'editor']]);
  // an ffmpeg the editor ran in the background: no event at all (it used to show as a finished "crew agent")
  assert.deepEqual(toEvents(note('bk3x9q2', 'tBash'), briefs), []);
  // an agent VideoHub never saw launch (it restarted): id unknown, the server looks it up in Claude Code's log
  const unknown = toEvents(note('a1234567890abcdef', 'tOther'), briefs)[0];
  assert.equal(unknown.id, null); assert.equal(unknown.agentId, 'a1234567890abcdef');
});

test('the safety net closes an agent Claude Code marked finished after its last step, never a busy one', () => {
  const now = 1e7, seen = new Map([['t1', now - 120e3], ['t2', now - 120e3], ['t3', now - 10e3], ['t4', now - 120e3]]);
  const metas = [{ toolUseId: 't1', finished: true, mtime: now - 100e3 }, { toolUseId: 't2', finished: false, mtime: now - 100e3 },
    { toolUseId: 't3', finished: true, mtime: now - 5e3 }, { toolUseId: 't4', finished: true, mtime: now - 200e3 }];
  // t1 done; t2 still running; t3 had a step 10 s ago; t4 marked finished before its last step (continued since)
  assert.deepEqual(stale(new Set(['t1', 't2', 't3', 't4', 't5']), seen, metas, now).map(x => x.id), ['t1']);
});

test('the cost of one reply is the conversation running total minus the previous one, per model', () => {
  const t1 = { cost: 1, models: modelTotals({ 'claude-opus-5-5': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 80, cacheCreationInputTokens: 5, costUSD: 1 } }) };
  const t2 = { cost: 1.5, models: modelTotals({ 'claude-opus-5-5': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 180, cacheCreationInputTokens: 5, costUSD: 1.2 }, 'claude-sonnet-5-5': { outputTokens: 50, cacheReadInputTokens: 950, costUSD: 0.3 } }) };
  assert.deepEqual(t1.models, { 'claude-opus-5-5': { tokens: 100, cost: 1 } });
  const r = replyShare(t1, t2);
  assert.ok(Math.abs(r.cost - 0.5) < 1e-9); assert.equal(r.models['claude-opus-5-5'].tokens, 100); assert.equal(r.models['claude-sonnet-5-5'].tokens, 1000);
  assert.equal(replyShare(undefined, t2), null);                         // VideoHub restarted: only the conversation total is known
  assert.equal(replyShare(t2, { cost: 0, models: {} }), null);           // a crash result with zeroed totals
  assert.deepEqual(toEvents({ type: 'result', subtype: 'success', total_cost_usd: 1.5, modelUsage: { m: { outputTokens: 7, costUSD: 1.5 } } })[0].models, { m: { tokens: 7, cost: 1.5 } });
});

test('an attached file keeps only a safe file name: no folders, no hidden-file dot, no reserved characters', () => {
  assert.equal(safeName('reel take 2.mp4'), 'reel take 2.mp4');
  assert.equal(safeName('..\\..\\Windows\\evil.mp4'), 'evil.mp4');
  assert.equal(safeName('../../.bashrc'), 'bashrc');
  assert.equal(safeName('a:b?.mov'), 'a_b_.mov');
  assert.equal(safeName(''), 'file');
});

test('Claude Code stream events become chat events: words, steps, briefs, the agents at work, results', () => {
  const briefs = new Map();
  assert.deepEqual(toEvents({ type: 'system', subtype: 'init', session_id: 's1', model: 'm' }), [{ kind: 'session', sessionId: 's1', model: 'm' }]);
  assert.deepEqual(toEvents({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } }), [{ kind: 'delta', text: 'Hi' }]);
  const b = toEvents({ type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'video-analyzer', description: 'analyze the reel', prompt: 'Analyze https://x' } }] } }, briefs);
  assert.deepEqual(b.map(e => e.kind), ['text', 'brief']); assert.equal(b[1].agent, 'video-analyzer');
  const sub = toEvents({ type: 'assistant', parent_tool_use_id: 't1', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'yt-dlp https://x' } }] } }, briefs);
  assert.deepEqual(sub, [{ kind: 'sub', parent: 't1', agent: 'video-analyzer', what: 'tool', name: 'Bash', text: 'yt-dlp https://x' }]);
  const done = toEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Folder: D:/a' }] }] } }, briefs);
  assert.deepEqual(done, [{ kind: 'briefDone', id: 't1', agent: 'video-analyzer', ok: true, status: 'completed', text: 'Folder: D:/a' }]);
  assert.equal(toEvents({ type: 'result', subtype: 'success', total_cost_usd: 0.1 })[0].ok, true);
  assert.deepEqual(toEvents({ type: 'result', subtype: 'error_during_execution', is_error: true, result: "You've hit your limit · resets 10pm" }).map(e => e.kind), ['result', 'limit']);
});
