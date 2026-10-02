import { describe, expect, it, vi } from 'vitest';
import { experimental_evaluate } from 'ai';
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import type { Experimental_EvaluationModelV4 as EvaluationModelV4, Experimental_EvaluationModelV4Result as EvaluationModelV4Result } from '@ai-sdk/provider';
import { decisionExecutor, evaluationModel } from '../src/index.ts';
import type { DecisionModel, DecisionRequest } from '../src/index.ts';
import { actionTarget, answer, context, twoFields } from './helpers.ts';

/** A scripted transport; no network. */
function transport(decide: DecisionModel['decide'], options?: { structured?: boolean }): DecisionModel {
  return { provider: 'scripted', modelId: 'scripted', ...(options?.structured === undefined ? {} : { structured: options.structured }), decide };
}

const question = {
  type: 'choice' as const,
  instructions: 'Which team should handle this?',
  criteria: { billing: 'Payments and refunds', support: 'Other requests' },
};

describe('AI SDK evaluation model', () => {
  it('answers one choice question through the transport', async () => {
    const seen: DecisionRequest[] = [];
    const evaluated = evaluationModel(transport(async (request) => {
      seen.push(request);
      return answer(request, 'billing');
    }, { structured: true }));
    const result = await evaluated.doEvaluate({ state: { message: 'I was charged twice.' }, questions: { department: question } });
    const department = result.answers.department;
    if (department?.type !== 'choice') throw new Error('Expected a choice answer.');
    expect(department.choice).toBe('billing');
    expect(department.probabilities?.billing).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      state: { message: 'I was charged twice.' },
      instructions: 'Which team should handle this?',
      criteria: { billing: 'Payments and refunds', support: 'Other requests' },
    });
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 0 });
    expect(result.providerMetadata?.scripted).toMatchObject({ confidence: { department: 1 } });
    expect(result.response?.modelId).toBe('scripted');
  });

  it('evaluates every question over the same state and sums usage', async () => {
    const states: unknown[] = [];
    const evaluated = evaluationModel(transport(async (request) => {
      states.push(request.state);
      return answer(request, 'billing');
    }, { structured: true }));
    const result = await evaluated.doEvaluate({ state: 'I was charged twice.', questions: { first: question, second: question } });
    expect(Object.keys(result.answers)).toEqual(['first', 'second']);
    expect(states).toEqual(['I was charged twice.', 'I was charged twice.']);
    expect(result.usage).toMatchObject({ inputTokens: 200, outputTokens: 0 });
    expect(result.providerMetadata?.scripted).toMatchObject({ confidence: { first: 1, second: 1 } });
  });

  it('rejects non-choice questions before any provider I/O', async () => {
    const decide = vi.fn(async (request: DecisionRequest) => answer(request, 'billing'));
    const evaluated = evaluationModel(transport(decide, { structured: true }));
    await expect(evaluated.doEvaluate({
      state: 'I was charged twice.',
      questions: { severity: { type: 'score', instructions: 'How severe?', criteria: ['Low', 'High'] } },
    })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    expect(decide).not.toHaveBeenCalled();
  });

  it('answers through AI SDK evaluate', async () => {
    const result = await experimental_evaluate({
      model: evaluationModel(transport(async (request) => answer(request, 'support'), { structured: true })),
      state: { message: 'General question.' },
      questions: { department: question },
    });
    expect(result.answers.department.choice).toBe('support');
    expect(result.answers.department.probabilities?.support).toBe(1);
  });

  it('leaves score questions to AI SDK evaluate', async () => {
    const decide = vi.fn(async (request: DecisionRequest) => answer(request, 'billing'));
    await expect(experimental_evaluate({
      model: evaluationModel(transport(decide, { structured: true })),
      state: 'I was charged twice.',
      questions: { severity: { type: 'score', instructions: 'How severe?', criteria: ['Low', 'High'] } },
    })).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });

  it('rejects an invalid distribution instead of answering', async () => {
    const evaluated = evaluationModel(transport(async () => ({
      choice: 'billing', modelId: 'scripted', confidence: 1,
      probabilities: { billing: 0.4, support: 0.4 },
    }), { structured: true }));
    await expect(evaluated.doEvaluate({ state: 'text', questions: { department: question } }))
      .rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('sends flat strings to unstructured transports', async () => {
    const seen: DecisionRequest[] = [];
    const evaluated = evaluationModel(transport(async (request) => {
      seen.push(request);
      return answer(request, 'billing');
    }));
    await evaluated.doEvaluate({
      state: 'text',
      questions: { department: { type: 'choice', instructions: { goal: 'route' }, criteria: { billing: 'Pay', support: null } } },
    });
    expect(seen[0]?.instructions).toBe(JSON.stringify({ goal: 'route' }));
    expect(seen[0]?.criteria).toEqual({ billing: 'Pay', support: '' });
  });

  it('forwards the evaluation abort signal to the transport', async () => {
    const seen: AbortSignal[] = [];
    const evaluated = evaluationModel(transport(async (request) => {
      seen.push(request.signal);
      return answer(request, 'billing');
    }, { structured: true }));
    const controller = new AbortController();
    await evaluated.doEvaluate({ state: 'text', questions: { department: question }, abortSignal: controller.signal });
    expect(seen[0]).toBe(controller.signal);
  });

  it('keeps __proto__ question and choice ids as own entries', async () => {
    const seen: DecisionRequest[] = [];
    const evaluated = evaluationModel(transport(async (request) => {
      seen.push(request);
      return answer(request, '__proto__');
    }, { structured: true }));
    const questions = JSON.parse('{"__proto__": {"type": "choice", "instructions": "pick", "criteria": {"__proto__": "first", "other": "second"}}}') as Record<string, typeof question>;
    const result = await evaluated.doEvaluate({ state: 'text', questions });
    expect(Object.keys(seen[0]?.criteria ?? {})).toEqual(['__proto__', 'other']);
    expect(Object.hasOwn(result.answers, '__proto__')).toBe(true);
    expect(result.answers['__proto__']).toMatchObject({ type: 'choice', choice: '__proto__' });
    expect(Object.hasOwn(result.providerMetadata?.scripted?.['confidence'] as object, '__proto__')).toBe(true);
  });
});

/** A hand-written AI SDK evaluation model whose one answer the test controls. */
function evaluating(reply: () => Partial<EvaluationModelV4Result> & Pick<EvaluationModelV4Result, 'answers'>): EvaluationModelV4 {
  return {
    specificationVersion: 'v4', provider: 'mock', modelId: 'mock-1', supportedQuestionTypes: ['choice'],
    doEvaluate: async () => ({ warnings: [], ...reply() }),
  };
}

describe('decision executor on AI SDK evaluation models', () => {
  it('judges through the official TypeSafe provider, including its two-place rounding', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      model: 'jev-1.13.0',
      // Rounded to two places: the distribution sums to 0.99.
      answers: { decision: { type: 'choice', choice: 'holds', probabilities: { holds: 0.95, fails: 0.03, inconclusive: 0.01 }, confidence: 0.93 } },
      usage: { input_tokens: 120, output_tokens: 0 },
    }));
    const model = createTypeSafeAi({ apiKey: 'credential', fetch: fetcher }).evaluationModel('jev-latest');
    const fixture = context({ kind: 'assert' });
    expect(await decisionExecutor({ model }).runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('jev-latest');
    expect(body.questions.decision).toMatchObject({ type: 'choice', instructions: { goal: expect.any(String) } });
    expect(Object.keys(body.questions.decision.criteria)).toEqual(['holds', 'fails', 'inconclusive']);
    expect(fixture.usage).toEqual([expect.objectContaining({ provider: model.provider, modelId: 'jev-1.13.0', inputTokens: 120 })]);
  });

  it('acts through experimental_evaluate with operation then target', async () => {
    const fixture = context({ params: { name: 'Ada' }, tree: twoFields });
    let turn = 0;
    const scripted: DecisionModel = {
      provider: 'scripted', modelId: 'scripted', structured: true,
      decide: async (request) => {
        const plan = ['type', actionTarget, 'complete', 'holds'] as const;
        const step = plan[turn++] ?? 'unsupported';
        return answer(request, typeof step === 'string' ? step : step(request, 'type', 'Ada'));
      },
    };
    expect(await decisionExecutor({ model: evaluationModel(scripted) }).runStep(fixture.ctx)).toMatchObject({ status: 'passed' });
    expect(fixture.actions.type).toHaveBeenCalledExactlyOnceWith({ id: 'name' }, 'Ada');
    expect(fixture.usage).toHaveLength(4);
  });

  it('treats a missing confidence statistic as 0', async () => {
    const model = evaluating(() => ({ answers: { decision: { type: 'choice', choice: 'holds', probabilities: { holds: 1, fails: 0, inconclusive: 0 } } } }));
    expect(await decisionExecutor({ model }).runStep(context({ kind: 'assert' }).ctx)).toMatchObject({ status: 'passed' });
    expect(await decisionExecutor({ model, minConfidence: 0.5 }).runStep(context({ kind: 'assert' }).ctx)).toMatchObject({ status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE' });
  });

  it('rejects an answer without a choice distribution', async () => {
    const model = evaluating(() => ({ answers: { decision: { type: 'choice', choice: 'holds' } } }));
    await expect(decisionExecutor({ model }).runStep(context({ kind: 'assert' }).ctx)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('maps provider failures without echoing their text', async () => {
    const model: EvaluationModelV4 = { ...evaluating(() => ({ answers: {} })), doEvaluate: async () => { throw new Error('upstream detail'); } };
    const failure = decisionExecutor({ model }).runStep(context({ kind: 'assert' }).ctx);
    await expect(failure).rejects.toMatchObject({ code: 'MODEL_PROVIDER_FAILED' });
    await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining('upstream detail') });
  });

  it('refuses an evaluation model that cannot answer choice questions', () => {
    const model: EvaluationModelV4 = { ...evaluating(() => ({ answers: {} })), supportedQuestionTypes: ['boolean'] };
    expect(() => decisionExecutor({ model })).toThrow('does not answer choice questions');
  });
});
