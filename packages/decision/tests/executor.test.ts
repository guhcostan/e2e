import { describe, expect, it, vi } from 'vitest';
import { AgentError } from 'e2e';
import { decisionExecutor } from '../src/index.ts';
import type { DecisionModel, DecisionRequest, DecisionResult } from '../src/index.ts';
import { actionChoice, answer, context } from './helpers.ts';

/** A transport whose decisions are controlled by the test. */
function model(decide: DecisionModel['decide']): DecisionModel {
  return { provider: 'scripted', modelId: 'scripted', decide };
}

describe('portable decision executor', () => {
  it('fills a declared value and verifies completion independently', async () => {
    const fixture = context({ params: { name: 'Ada' } });
    let turn = 0;
    const requests: DecisionRequest[] = [];
    const executor = decisionExecutor({ model: model(async (request) => {
      requests.push(request);
      const choice = turn++ === 0 ? actionChoice(request, 'type', 'Ada') : turn === 2 ? 'complete' : 'holds';
      return answer(request, choice);
    }) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
    expect(fixture.actions.type).toHaveBeenCalledExactlyOnceWith({ id: 'name' }, 'Ada');
    expect(fixture.observe).toHaveBeenCalledTimes(3);
    expect(requests[2]?.state).toMatchObject({ feedback: '' });
    expect(JSON.stringify(requests)).not.toContain('the actor claimed success');
    expect(fixture.usage).toHaveLength(3);
    expect(fixture.usage[0]).toMatchObject({ provider: 'scripted', modelId: 'scripted', inputTokens: 100 });
  });

  it.each(['holds', 'fails', 'inconclusive'])('maps assertion %s to the runner verdict', async (choice) => {
    const fixture = context({ kind: 'assert' });
    const executor = decisionExecutor({ model: model(async (request) => answer(request, choice)) });
    const verdict = await executor.runStep(fixture.ctx);
    expect(verdict).toMatchObject(choice === 'holds' ? { status: 'passed' }
      : { status: 'failed', errorCode: choice === 'fails' ? 'ASSERTION_FAILED' : 'ASSERTION_INCONCLUSIVE' });
    expect(fixture.actions.type).not.toHaveBeenCalled();
    expect(fixture.actions.tap).not.toHaveBeenCalled();
  });

  it('does not pass on an acting model completion claim contradicted by the fresh screen', async () => {
    const fixture = context();
    let turn = 0;
    const executor = decisionExecutor({ model: model(async (request) => answer(request, turn++ === 0 ? 'complete' : 'fails')) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'failed', errorCode: 'ACTION_FAILED' });
  });

  it('keeps test params in independent judgments, including secret aliases without plaintext', async () => {
    const requests: DecisionRequest[] = [];
    const executor = decisionExecutor({ model: model(async (request) => {
      requests.push(request);
      return answer(request, 'holds');
    }) });
    for (const name of ['Ada', 'Grace']) {
      const fixture = context({ kind: 'assert', params: { name, passwordAlias: { kind: 'secret', name: 'admin.password', purpose: 'password' } } });
      await executor.runStep(fixture.ctx);
    }
    expect(requests[0]?.instructions).toContain('"Ada"');
    expect(requests[0]?.instructions).toContain('admin.password');
    expect(requests[1]?.instructions).toContain('"Grace"');
    expect(requests[1]?.instructions).not.toContain('"Ada"');
  });

  it.each(['probability', 'confidence'])('blocks uncertain actions on the %s gate before mutation', async (gate) => {
    const fixture = context({ params: { name: 'Ada' } });
    const executor = decisionExecutor({ model: model(async (request) => {
      const result = answer(request, actionChoice(request, 'type', 'Ada'));
      return gate === 'confidence' ? { ...result, confidence: 0.2 }
        : { ...result, probabilities: { ...result.probabilities, [result.choice]: 0.7, unsupported: 0.3 } };
    }) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'blocked', errorCode: 'AUTOMATION_UNSUPPORTED' });
    expect(fixture.actions.type).not.toHaveBeenCalled();
  });

  it('fails low-confidence assertions instead of approving them', async () => {
    const fixture = context({ kind: 'assert' });
    const executor = decisionExecutor({ model: model(async (request) => ({ ...answer(request, 'holds'), confidence: 0.1 })) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE' });
  });

  it.each([
    { truncated: true }, { treeUnavailable: true as const }, { text: '' },
  ])('fails an assertion without a complete semantic observation', async (observation) => {
    const fixture = context({ kind: 'assert', observation });
    const decide = vi.fn<DecisionModel['decide']>();
    expect(await decisionExecutor({ model: model(decide) }).runStep(fixture.ctx)).toMatchObject({ status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE' });
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([
    { truncated: true }, { treeUnavailable: true as const }, { text: '' },
  ])('blocks an action without a complete semantic observation', async (observation) => {
    const fixture = context({ observation });
    const decide = vi.fn<DecisionModel['decide']>();
    expect(await decisionExecutor({ model: model(decide) }).runStep(fixture.ctx)).toMatchObject({ status: 'blocked', errorCode: 'AUTOMATION_UNSUPPORTED' });
    expect(decide).not.toHaveBeenCalled();
  });

  it('blocks an act step whose completion cannot be verified', async () => {
    const fixture = context();
    let turn = 0;
    const executor = decisionExecutor({ model: model(async (request) => answer(request, turn++ === 0 ? 'complete' : 'inconclusive')) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'blocked', errorCode: 'AUTOMATION_UNSUPPORTED' });
  });

  it('enforces the model-call ceiling before an additional request', async () => {
    const fixture = context({ maxModelCalls: 1, params: { name: 'Ada' } });
    const decide = vi.fn<DecisionModel['decide']>().mockImplementation(async (request) => answer(request, actionChoice(request, 'type', 'Ada')));
    expect(await decisionExecutor({ model: model(decide) }).runStep(fixture.ctx)).toMatchObject({ status: 'blocked' });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(fixture.usage).toHaveLength(1);
  });

  it('does not bypass runner policy or replay actions after a policy refusal', async () => {
    const fixture = context({ params: { url: 'file:///tmp/private' } });
    const deny = new AgentError('POLICY_DENIED', 'Denied destination.');
    vi.mocked(fixture.actions.navigate).mockRejectedValue(deny);
    const decide = vi.fn<DecisionModel['decide']>().mockImplementation(async (request) => answer(request, actionChoice(request, 'navigate')));
    await expect(decisionExecutor({ model: model(decide) }).runStep(fixture.ctx)).rejects.toBe(deny);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it.each(['todos', './form', '../form', '?mode=edit', '#checkout'])('passes relative destination %s to runner navigation', async (destination) => {
    const fixture = context({ params: { destination }, maxModelCalls: 1 });
    const executor = decisionExecutor({ model: model(async (request) => answer(request, actionChoice(request, 'navigate'))) });
    await executor.runStep(fixture.ctx);
    expect(fixture.actions.navigate).toHaveBeenCalledExactlyOnceWith(destination);
  });

  it('blocks a repeated action after two attempts without a semantic change', async () => {
    const fixture = context({ params: { name: 'Ada' } });
    const executor = decisionExecutor({ model: model(async (request) => answer(request, actionChoice(request, 'type', 'Ada'))) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'blocked', summary: expect.stringContaining('three times') });
    expect(fixture.actions.type).toHaveBeenCalledTimes(2);
  });

  it('offers password handles only and omits hidden, disabled, and unsupported controls', async () => {
    const fixture = context({ params: { text: 'Ada', password: { kind: 'secret', name: 'password', purpose: 'password' } },
      tree: { id: 'root', children: [
        { id: 'password', role: 'textbox', name: 'Password', inputPurpose: 'password', states: { secure: true } },
        { id: 'hidden', role: 'button', name: 'Hidden', states: { hidden: true } },
        { id: 'disabled', role: 'button', name: 'Disabled', states: { disabled: true } },
      ] } });
    const executor = decisionExecutor({ model: model(async (request) => {
      const descriptions = Object.values(request.criteria);
      expect(descriptions.some((description) => description.startsWith('type '))).toBe(false);
      expect(descriptions.some((description) => description.startsWith('typeSecret '))).toBe(true);
      expect(JSON.stringify(descriptions)).not.toContain('Hidden');
      expect(JSON.stringify(descriptions)).not.toContain('Disabled');
      return answer(request, 'unsupported');
    }) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'blocked' });
  });

  it('omits empty select labels and blank destinations', async () => {
    const combo = { id: 'root', children: [{ id: 'combo', role: 'combobox', name: 'Combo' }] };
    const selecting = context({ params: { label: '' }, tree: combo });
    const selectingExecutor = decisionExecutor({ model: model(async (request) => {
      expect(Object.values(request.criteria).some((description) => description.startsWith('select '))).toBe(false);
      return answer(request, 'unsupported');
    }) });
    expect(await selectingExecutor.runStep(selecting.ctx)).toMatchObject({ status: 'blocked' });
    const navigating = context({ params: { destination: '   ' }, tree: combo });
    const navigatingExecutor = decisionExecutor({ model: model(async (request) => {
      expect(Object.values(request.criteria).some((description) => description.startsWith('navigate '))).toBe(false);
      return answer(request, 'unsupported');
    }) });
    expect(await navigatingExecutor.runStep(navigating.ctx)).toMatchObject({ status: 'blocked' });
  });
  it('does not silently truncate choices on large screens', async () => {
    const fixture = context({ tree: { id: 'root', children: Array.from({ length: 254 }, (_, index) => ({ id: `n${index}`, role: 'button', name: `Button ${index}` })) } });
    const decide = vi.fn<DecisionModel['decide']>();
    expect(await decisionExecutor({ model: model(decide) }).runStep(fixture.ctx)).toMatchObject({ status: 'blocked' });
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([
    (result: DecisionResult) => ({ ...result, choice: 'invented-node' }),
    (result: DecisionResult) => ({ ...result, choice: Object('holds') as unknown as string }),
    (result: DecisionResult) => ({ ...result, confidence: NaN }),
    (result: DecisionResult) => ({ ...result, probabilities: { holds: 2, fails: -1, inconclusive: 0 } }),
    (result: DecisionResult) => ({ ...result, probabilities: { holds: 0.1, fails: 0.9, inconclusive: 0 } }),
    (result: DecisionResult) => ({ ...result, probabilities: { holds: 0.8, fails: 0.1, inconclusive: 0 } }),
  ])('rejects invalid custom transport output and accounts for the request', async (modify) => {
    const fixture = context({ kind: 'assert' });
    const executor = decisionExecutor({ model: model(async (request) => modify(answer(request, 'holds'))) });
    await expect(executor.runStep(fixture.ctx)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    expect(fixture.usage).toHaveLength(1);
  });

  it.each(['null body', 'null distribution'])('rejects %s as invalid output', async (shape) => {
    const fixture = context({ kind: 'assert' });
    const executor = decisionExecutor({ model: model(async (request) =>
      shape === 'null body' ? (null as unknown as DecisionResult)
      : { ...answer(request, 'holds'), probabilities: null as unknown as Record<string, number> }) });
    await expect(executor.runStep(fixture.ctx)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    expect(fixture.usage).toHaveLength(1);
  });
  it('records a failed request without tokens or provider exception text', async () => {
    const fixture = context({ kind: 'assert' });
    const error = new AgentError('MODEL_PROVIDER_FAILED', 'HTTP 401');
    const executor = decisionExecutor({ model: model(async () => { throw error; }) });
    await expect(executor.runStep(fixture.ctx)).rejects.toBe(error);
    expect(fixture.usage).toHaveLength(1);
    expect(fixture.usage[0]).not.toHaveProperty('inputTokens');
  });

  it('validates probability and confidence policy at construction', () => {
    for (const minProbability of [0, 0.5, 2, NaN]) expect(() => decisionExecutor({ model: model(async (request) => answer(request, 'holds')), minProbability })).toThrow();
    for (const minConfidence of [-1, 2, NaN]) expect(() => decisionExecutor({ model: model(async (request) => answer(request, 'holds')), minConfidence })).toThrow();
  });

  it('stays text-only by default: no pixels requested, no images sent', async () => {
    const fixture = context({ kind: 'assert' });
    const requests: DecisionRequest[] = [];
    const executor = decisionExecutor({ model: model(async (request) => {
      requests.push(request);
      return answer(request, 'holds');
    }) });
    await executor.runStep(fixture.ctx);
    expect(fixture.observe).toHaveBeenCalledWith({ tree: false });
    expect(requests[0]).not.toHaveProperty('images');
  });

  it('attaches masked pixels when vision and the model both allow it', async () => {
    const pixels = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' as const, width: 8, height: 6, scale: 1, maskedRegionCount: 1 };
    const fixture = context({ kind: 'assert', observation: { pixels } });
    const requests: DecisionRequest[] = [];
    const visionModel: DecisionModel = { provider: 'scripted', modelId: 'scripted', vision: true,
      decide: async (request) => { requests.push(request); return answer(request, 'holds'); } };
    await decisionExecutor({ model: visionModel, vision: true }).runStep(fixture.ctx);
    expect(fixture.observe).toHaveBeenCalledWith({ tree: false, pixels: true });
    expect(requests[0]?.images).toEqual(['data:image/png;base64,' + Buffer.from([1, 2, 3]).toString('base64')]);
  });

  it('falls back to text when pixels are withheld and never requests them for text-only models', async () => {
    const withheld = context({ kind: 'assert', observation: { pixelsWithheld: 'PIXEL_TAINTED' as const } });
    const withheldRequests: DecisionRequest[] = [];
    const visionModel: DecisionModel = { provider: 'scripted', modelId: 'scripted', vision: true,
      decide: async (request) => { withheldRequests.push(request); return answer(request, 'holds'); } };
    expect(await decisionExecutor({ model: visionModel, vision: true }).runStep(withheld.ctx)).toMatchObject({ status: 'passed' });
    expect(withheldRequests[0]).not.toHaveProperty('images');
    const textOnly = context({ kind: 'assert', observation: { pixels: { data: new Uint8Array([9]), mediaType: 'image/png' as const, width: 8, height: 6, scale: 1, maskedRegionCount: 0 } } });
    const textRequests: DecisionRequest[] = [];
    await decisionExecutor({ model: model(async (request) => { textRequests.push(request); return answer(request, 'holds'); }), vision: true }).runStep(textOnly.ctx);
    expect(textOnly.observe).toHaveBeenCalledWith({ tree: false });
    expect(textRequests[0]).not.toHaveProperty('images');
  });
});
