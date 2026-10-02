// Probes one OpenCodeX model with a one-line chat completion.
// Usage: node scripts/opencodex-probe.mjs [model-id] | --catalog
const base = process.env.OPENCODEX_BASE_URL ?? 'http://127.0.0.1:10100/v1';
if (process.argv[2] === '--catalog') {
  const catalog = await (await fetch(base + '/models')).json();
  for (const m of catalog.data) {
    if (String(m.id).toLowerCase().includes('luna')) console.log(m.id + ' :: ' + JSON.stringify(m.api_types));
  }
  process.exit(0);
}
const model = process.argv[2] ?? 'gpt-6-luna';
const flag = process.argv[3];
const withTools = flag === '--tools' || process.argv[4] === '--tools';
const toolDef = [{ type: 'function', function: { name: 'tap', description: 'Tap a node by id', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } }];
const endpoint = flag === '--responses' ? '/responses' : flag === '--anthropic' ? '/messages' : '/chat/completions';
const body = endpoint === '/responses'
  ? { model, input: 'Reply with the single word ok', max_output_tokens: 20 }
  : endpoint === '/messages'
    ? { model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the single word ok' }] }
    : { model, messages: [{ role: 'user', content: 'Reply with the single word ok' }], max_tokens: 20, ...(withTools ? { tools: toolDef } : {}) };
const res = await fetch(base + endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(90000),
});
console.log('HTTP ' + res.status);
console.log((await res.text()).slice(0, 400));
