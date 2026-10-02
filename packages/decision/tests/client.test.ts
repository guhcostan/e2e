import { describe, expect, it, vi } from 'vitest';
import { clef, jev, systemOne } from '../src/index.ts';
import type { DecisionRequest } from '../src/index.ts';

const request: DecisionRequest = {
  state: { screen: 'Ready' }, instructions: 'Is it ready?',
  criteria: { holds: 'Ready', fails: 'Not ready' }, signal: new AbortController().signal,
};
const result = {
  model: 'test-model',
  answers: { decision: { type: 'choice', choice: 'holds', confidence: 0.99, probabilities: { holds: 0.99, fails: 0.01 } } },
  usage: { input_tokens: 100, output_tokens: 0 },
};

describe('System One transports', () => {
  it.each(['clef', 'clef-flash'] as const)('uses the %s URL and unwraps Cloudflare responses', async (model) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, result }));
    const decision = await clef({ accountId: 'account/test', apiKey: 'credential', model, fetch: transport }).decide(request);
    const [url, init] = transport.mock.calls[0]!;
    expect(String(url)).toBe(`https://api.cloudflare.com/client/v4/accounts/account%2Ftest/ai/run/@cf/cloudflare/${model}`);
    expect(init).toMatchObject({ redirect: 'error', signal: request.signal, method: 'POST' });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer credential');
    expect(JSON.parse(String(init?.body))).toEqual({ model, state: request.state, questions: { decision: {
      type: 'choice', instructions: request.instructions, criteria: request.criteria,
    } } });
    expect(decision).toMatchObject({ choice: 'holds', inputTokens: 100, outputTokens: 0, modelId: 'test-model' });
  });

  it('uses the Jev endpoint and a pinned model', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result));
    await jev({ apiKey: 'credential', model: 'jev-1.13.0', fetch: transport }).decide(request);
    const [url, init] = transport.mock.calls[0]!;
    expect(String(url)).toBe('https://api.typesafe.ai/v1/systemone');
    expect(JSON.parse(String(init?.body)).model).toBe('jev-1.13.0');
  });

  it.each([401, 429, 529])('reports HTTP %s without response content', async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('credential and secret', { status }));
    const operation = jev({ apiKey: 'credential', fetch: transport }).decide(request);
    await expect(operation).rejects.toMatchObject({ code: 'MODEL_PROVIDER_FAILED', message: `The decision provider returned HTTP ${status}.` });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not retain network errors that can contain credentials', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('credential in endpoint'));
    await expect(jev({ apiKey: 'credential', fetch: transport }).decide(request)).rejects.toMatchObject({
      code: 'MODEL_PROVIDER_FAILED', message: 'The decision request could not reach the provider.',
    });
  });

  it.each([
    new Response('not json'),
    Response.json({ ...result, answers: { decision: { type: 'noul', noul: 1 } } }),
    Response.json({ ...result, usage: { input_tokens: -1, output_tokens: 0 } }),
  ])('rejects malformed provider output', async (response) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(jev({ apiKey: 'credential', fetch: transport }).decide(request)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('classifies a Cloudflare error envelope as provider failure', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: false, errors: [{ message: 'secret' }] }));
    await expect(clef({ accountId: 'test', apiKey: 'credential', fetch: transport }).decide(request)).rejects.toMatchObject({
      code: 'MODEL_PROVIDER_FAILED', message: 'Cloudflare declined the decision request.',
    });
  });

  it('does not send a request without a key or after cancellation', async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(jev({ apiKey: '', fetch: transport }).decide(request)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    const controller = new AbortController();
    controller.abort();
    await expect(jev({ apiKey: 'credential', fetch: transport }).decide({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('supports compatible endpoints and refuses non-HTTP or embedded credentials', () => {
    expect(systemOne({ endpoint: 'http://localhost/v1/systemone', model: 'local', provider: 'local', apiKey: 'test' }).provider).toBe('local');
    for (const endpoint of ['file:///tmp/model', 'data:text/plain,model', 'https://user:password@example.test']) {
      expect(() => systemOne({ endpoint, model: 'local', provider: 'local', apiKey: 'test' })).toThrow('HTTP or HTTPS');
    }
  });
});
