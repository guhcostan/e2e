// Probes one OpenCodeX model with a one-line chat completion.
// Usage: node scripts/opencodex-probe.mjs [model-id] [--tools]
const base = process.env.OPENCODEX_BASE_URL ?? 'http://127.0.0.1:10100/v1';
const model = process.argv[2] ?? 'gpt-6-luna';
const withTools = process.argv.includes('--tools');
const res = await fetch(base + '/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(process.env.OPENCODEX_API_KEY ? { Authorization: 'Bearer ' + process.env.OPENCODEX_API_KEY } : {}) },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with the single word ok' }],
    max_tokens: 20,
    ...(withTools ? { tools: [{ type: 'function', function: { name: 'tap', description: 'Tap a node by id', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } }] } : {}),
  }),
  signal: AbortSignal.timeout(90000),
});
console.log('HTTP ' + res.status);
console.log((await res.text()).slice(0, 300));
