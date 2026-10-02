import { describe, expect, it, vi } from 'vitest';
import { AgentError } from 'e2e';
import { decisionExecutor } from '../src/index.ts';
import type { DecisionModel, DecisionRequest, DecisionResult } from '../src/index.ts';
import { actionChoice, actionTarget, answer, context, offersPrefix, twoFields } from './helpers.ts';

/** A transport whose decisions are controlled by the test. */
function model(decide: DecisionModel['decide']): DecisionModel {
  return { provider: 'scripted', modelId: 'scripted', decide };
}

/** Gates are opt-in; the tests that exercise them configure these. */
const gated = { minProbability: 0.9, minConfidence: 0.9 };

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

  it.each(['probability', 'confidence'])('blocks uncertain actions on a configured %s gate before mutation', async (gate) => {
    const fixture = context({ params: { name: 'Ada' } });
    const executor = decisionExecutor({ model: model(async (request) => {
      const result = answer(request, actionChoice(request, 'type', 'Ada'));
      return gate === 'confidence' ? { ...result, confidence: 0.2 }
        : { ...result, probabilities: { ...result.probabilities, [result.choice]: 0.7, unsupported: 0.3 } };
    }), ...gated });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'blocked', errorCode: 'AUTOMATION_UNSUPPORTED' });
    expect(fixture.actions.type).not.toHaveBeenCalled();
  });

  it('follows the most probable choice when no gate is configured', async () => {
    const fixture = context({ params: { name: 'Ada' } });
    let turn = 0;
    const executor = decisionExecutor({ model: model(async (request) => {
      const choice = turn++ === 0 ? actionChoice(request, 'type', 'Ada') : turn === 2 ? 'complete' : 'holds';
      const others = Object.keys(request.criteria).filter((key) => key !== choice);
      // A weak, diffuse answer: 0.4 on the choice, the rest spread out, low confidence.
      const probabilities = Object.fromEntries([[choice, 0.4], ...others.map((key) => [key, 0.6 / others.length])]);
      return { ...answer(request, choice), probabilities, confidence: 0.1 };
    }) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
    expect(fixture.actions.type).toHaveBeenCalledExactlyOnceWith({ id: 'name' }, 'Ada');
  });

  it('gives acting decisions the step history and keeps it out of the completion check', async () => {
    const fixture = context({ params: { name: 'Ada' } });
    const requests: DecisionRequest[] = [];
    let turn = 0;
    const executor = decisionExecutor({ model: model(async (request) => {
      requests.push(request);
      return answer(request, turn++ === 0 ? actionChoice(request, 'type', 'Ada') : turn === 2 ? 'complete' : 'holds');
    }) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
    expect(requests[0]?.state).not.toHaveProperty('history');
    expect(requests[1]?.state).toMatchObject({ history: [expect.stringMatching(/^type .*"Ada".*\(completed\)$/)] });
    expect(requests[2]?.state).not.toHaveProperty('history');
  });

  it('blocks an oscillation between two actions on the same screen', async () => {
    const tree = { id: 'root', children: [
      { id: 'one', role: 'button', name: 'One' }, { id: 'two', role: 'button', name: 'Two' },
    ] };
    const fixture = context({ tree });
    let turn = 0;
    const executor = decisionExecutor({ model: model(async (request) => answer(request, actionChoice(request, 'tap', turn++ % 2 === 0 ? 'One' : 'Two'))) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'blocked', errorCode: 'AUTOMATION_UNSUPPORTED' });
    // One, Two, One, Two run; the third One is refused before dispatch.
    expect(fixture.actions.tap).toHaveBeenCalledTimes(4);
  });

  it('fails low-confidence assertions under a configured gate instead of approving them', async () => {
    const fixture = context({ kind: 'assert' });
    const executor = decisionExecutor({ model: model(async (request) => ({ ...answer(request, 'holds'), confidence: 0.1 })), ...gated });
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
      expect(offersPrefix(request, 'type ')).toBe(false);
      expect(offersPrefix(request, 'typeSecret ')).toBe(true);
      expect(JSON.stringify(request.criteria)).not.toContain('Hidden');
      expect(JSON.stringify(request.criteria)).not.toContain('Disabled');
      return answer(request, 'unsupported');
    }) });
    expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'blocked' });
  });

  it('omits empty select labels and blank destinations', async () => {
    const combo = { id: 'root', children: [{ id: 'combo', role: 'combobox', name: 'Combo' }] };
    const selecting = context({ params: { label: '' }, tree: combo });
    const selectingExecutor = decisionExecutor({ model: model(async (request) => {
      expect(offersPrefix(request, 'select ')).toBe(false);
      return answer(request, 'unsupported');
    }) });
    expect(await selectingExecutor.runStep(selecting.ctx)).toMatchObject({ status: 'blocked' });
    const navigating = context({ params: { destination: '   ' }, tree: combo });
    const navigatingExecutor = decisionExecutor({ model: model(async (request) => {
      expect(offersPrefix(request, 'navigate ')).toBe(false);
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
    for (const minProbability of [-1, 2, NaN]) expect(() => decisionExecutor({ model: model(async (request) => answer(request, 'holds')), minProbability })).toThrow();
    for (const minConfidence of [-1, 2, NaN]) expect(() => decisionExecutor({ model: model(async (request) => answer(request, 'holds')), minConfidence })).toThrow();
    expect(() => decisionExecutor({ model: model(async (request) => answer(request, 'holds')), minProbability: 0, minConfidence: 1 })).not.toThrow();
  });

  describe('structured hierarchical decisions', () => {
    type PlannedStep = string | ((request: DecisionRequest) => string);
    function scriptedPlan(plan: PlannedStep[], seen: DecisionRequest[]): DecisionModel {
      let turn = 0;
      return {
        provider: 'scripted', modelId: 'scripted', structured: true,
        decide: async (request) => {
          seen.push(request);
          const step = plan[turn++] ?? 'unsupported';
          return answer(request, typeof step === 'string' ? step : step(request));
        },
      };
    }

    it('picks the operation then the target and sends structured values', async () => {
      const fixture = context({ params: { name: 'Ada' }, tree: twoFields });
      const seen: DecisionRequest[] = [];
      const planned = scriptedPlan([() => 'type', (request) => actionTarget(request, 'type', 'Ada'), 'complete', 'holds'], seen);
      const executor = decisionExecutor({ model: planned });
      expect(await executor.runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
      expect(fixture.actions.type).toHaveBeenCalledExactlyOnceWith({ id: 'name' }, 'Ada');
      expect(seen).toHaveLength(4);
      expect(seen[0]?.instructions).toMatchObject({ goal: expect.any(String) });
      expect(seen[0]?.criteria['type']).toBe('Enter text into a field using a declared param value.');
      expect(typeof seen[1]?.instructions).toBe('object');
      for (const value of Object.values(seen[1]?.criteria ?? {})) expect(value).toMatchObject({ element: expect.any(String) });
      expect(fixture.usage).toHaveLength(4);
    });

    it('blocks an uncertain operation before asking for a target', async () => {
      const fixture = context({ params: { name: 'Ada' } });
      const decide = vi.fn<DecisionModel['decide']>(async (request) => ({ ...answer(request, 'type'), confidence: 0.2 }));
      const structured: DecisionModel = { provider: 'scripted', modelId: 'scripted', structured: true, decide };
      expect(await decisionExecutor({ model: structured, ...gated }).runStep(fixture.ctx)).toMatchObject({ status: 'blocked', errorCode: 'AUTOMATION_UNSUPPORTED' });
      expect(decide).toHaveBeenCalledTimes(1);
      expect(fixture.actions.type).not.toHaveBeenCalled();
    });

    it('blocks an uncertain target after a confident operation', async () => {
      const fixture = context({ params: { name: 'Ada' }, tree: twoFields });
      let turn = 0;
      const decide: DecisionModel['decide'] = async (request) => {
        const choice = 'complete' in request.criteria ? 'type' : actionTarget(request, 'type', 'Ada');
        const result = answer(request, choice);
        turn += 1;
        return turn === 2 ? { ...result, confidence: 0.1 } : result;
      };
      const structured: DecisionModel = { provider: 'scripted', modelId: 'scripted', structured: true, decide };
      expect(await decisionExecutor({ model: structured, ...gated }).runStep(fixture.ctx)).toMatchObject({ status: 'blocked', errorCode: 'AUTOMATION_UNSUPPORTED' });
      expect(turn).toBe(2);
      expect(fixture.actions.type).not.toHaveBeenCalled();
    });

    it('blocks an unsupported operation without asking for a target', async () => {
      const fixture = context({ params: { name: 'Ada' } });
      const seen: DecisionRequest[] = [];
      const planned = scriptedPlan(['unsupported'], seen);
      expect(await decisionExecutor({ model: planned }).runStep(fixture.ctx)).toMatchObject({ status: 'blocked' });
      expect(seen).toHaveLength(1);
    });

    it('judges assertions from structured instructions', async () => {
      const fixture = context({ kind: 'assert' });
      const seen: DecisionRequest[] = [];
      const planned = scriptedPlan(['holds'], seen);
      expect(await decisionExecutor({ model: planned }).runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
      expect(seen[0]?.instructions).toMatchObject({ goal: expect.any(String) });
    });
    it('stops before the target request when the call budget is spent', async () => {
      const fixture = context({ params: { name: 'Ada' }, tree: twoFields, maxModelCalls: 1 });
      const seen: DecisionRequest[] = [];
      const planned = scriptedPlan(['type'], seen);
      expect(await decisionExecutor({ model: planned }).runStep(fixture.ctx)).toMatchObject({ status: 'blocked', errorCode: 'AUTOMATION_UNSUPPORTED' });
      expect(seen).toHaveLength(1);
      expect(fixture.usage).toHaveLength(1);
      expect(fixture.actions.type).not.toHaveBeenCalled();
    });

    it('dispatches a lone target without a one-option question', async () => {
      const fixture = context({ params: { name: 'Ada' } });
      const seen: DecisionRequest[] = [];
      const planned = scriptedPlan(['type', 'complete', 'holds'], seen);
      expect(await decisionExecutor({ model: planned }).runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
      expect(fixture.actions.type).toHaveBeenCalledExactlyOnceWith({ id: 'name' }, 'Ada');
      expect(seen).toHaveLength(3);
      for (const request of seen) expect(Object.keys(request.criteria).length).toBeGreaterThanOrEqual(2);
    });
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
    // Only an untainted attempt ever carries pixels; a tainted viewport withholds them.
    const fixture = context({ kind: 'assert', tainted: false, observation: { pixels } });
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
    const textOnly = context({ kind: 'assert', tainted: false, observation: { pixels: { data: new Uint8Array([9]), mediaType: 'image/png' as const, width: 8, height: 6, scale: 1, maskedRegionCount: 0 } } });
    const textRequests: DecisionRequest[] = [];
    await decisionExecutor({ model: model(async (request) => { textRequests.push(request); return answer(request, 'holds'); }), vision: true }).runStep(textOnly.ctx);
    expect(textOnly.observe).toHaveBeenCalledWith({ tree: false });
    expect(textRequests[0]).not.toHaveProperty('images');
  });

  it('attaches pixels to the operation, target, and completion questions on a structured vision transport', async () => {
    const pixels = { data: new Uint8Array([4, 5]), mediaType: 'image/png' as const, width: 8, height: 6, scale: 1, maskedRegionCount: 0 };
    const fixture = context({ params: { name: 'Ada' }, tree: twoFields, tainted: false, observation: { pixels } });
    const requests: DecisionRequest[] = [];
    const plan = [() => 'type', (request: DecisionRequest) => actionTarget(request, 'type', 'Ada'), () => 'complete', () => 'holds'];
    let turn = 0;
    const visionModel: DecisionModel = { provider: 'scripted', modelId: 'scripted', structured: true, vision: true,
      decide: async (request) => { requests.push(request); return answer(request, (plan[turn++] ?? (() => 'unsupported'))(request)); } };
    expect(await decisionExecutor({ model: visionModel, vision: true }).runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
    expect(requests).toHaveLength(4);
    for (const request of requests) expect(request.images).toEqual(['data:image/png;base64,' + Buffer.from([4, 5]).toString('base64')]);
    expect(fixture.observe).toHaveBeenCalledWith({ tree: true, pixels: true });
    expect(fixture.observe).toHaveBeenCalledWith({ pixels: true });
  });

  it('keeps AI SDK evaluation models text-only even with vision on', async () => {
    const fixture = context({ kind: 'assert', tainted: false, observation: { pixels: { data: new Uint8Array([7]), mediaType: 'image/png' as const, width: 8, height: 6, scale: 1, maskedRegionCount: 0 } } });
    const doEvaluate = vi.fn(async () => ({ warnings: [], answers: { decision: { type: 'choice' as const, choice: 'holds', probabilities: { holds: 1, fails: 0, inconclusive: 0 } } } }));
    const evaluating = { specificationVersion: 'v4' as const, provider: 'mock', modelId: 'mock', supportedQuestionTypes: ['choice' as const], doEvaluate };
    expect(await decisionExecutor({ model: evaluating, vision: true }).runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
    expect(fixture.observe).toHaveBeenCalledWith({ tree: false });
    expect(JSON.stringify(doEvaluate.mock.calls)).not.toContain('data:image');
  });
});
