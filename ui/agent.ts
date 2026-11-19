// Presentation preference only; stored note/status values keep their compatibility names.
let name = 'Claude';
export const agentName = () => name;
// local addition: hand a message to the Crew's Director instead of the clipboard;
// the Director chat (server/director.js) continues its conversation, starting Claude Code if needed. Resolves to a line to show, rejects with the reason.
export async function sendToDirector(text) {
  const r = await fetch('/api/director/say', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || 'The Director could not take the message.');
  dispatchEvent(new Event('vh-director-sent'));   // the editor shows its Director tab
  return 'Sent to the Director.';
}
export function setAgentName(value) { name = typeof value === 'string' && value.trim() ? value.trim().slice(0,40) : 'Claude'; return name; }
