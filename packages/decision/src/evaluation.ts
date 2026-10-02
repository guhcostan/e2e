import type {
  Experimental_EvaluationModelV4 as EvaluationModelV4,
  Experimental_EvaluationModelV4CallOptions as EvaluationModelV4CallOptions,
  Experimental_EvaluationModelV4Input as EvaluationInput,
  Experimental_EvaluationModelV4Question as EvaluationModelV4Question,
  Experimental_EvaluationModelV4Result as EvaluationModelV4Result,
} from '@ai-sdk/provider';
import type { JsonValue } from 'e2e';
import { AgentError, isAgentError } from 'e2e/agent';
import { validateDecision } from './client.ts';
import type { DecisionModel, DecisionResult } from './types.ts';

type ChoiceQuestion = Extract<EvaluationModelV4Question, { type: 'choice' }>;
type Sdk = typeof import('ai');

/**
 * Exposes a decision transport as an AI SDK evaluation model, so `clef()`,
 * `jev()`, and `systemOne()` endpoints answer `experimental_evaluate`
 * choice questions too. Each question is one `decide` call over the shared
 * state; score and boolean questions are rejected before any provider I/O.
 * Confidence is reported per question id under the transport's provider in
 * `providerMetadata`, the convention TypeSafe's provider uses.
 */
export function evaluationModel(model: DecisionModel): EvaluationModelV4 {
  return {
    specificationVersion: 'v4',
    provider: model.provider,
    modelId: model.modelId,
    supportedQuestionTypes: ['choice'],
    async doEvaluate(options: EvaluationModelV4CallOptions): Promise<EvaluationModelV4Result> {
      const signal = options.abortSignal ?? new AbortController().signal;
      const structured = model.structured === true;
      const questions = Object.entries(options.questions);
      // Rejects before any provider call, the same as evaluate() itself.
      if (questions.some(([, question]) => question.type !== 'choice')) {
        throw new AgentError('MODEL_OUTPUT_INVALID', 'The ' + model.modelId + ' evaluation model answers choice questions only.');
      }
      const answers: EvaluationModelV4Result['answers'] = {};
      const confidence: Record<string, number> = {};
      let inputTokens: number | undefined = 0;
      let outputTokens: number | undefined = 0;
      let decimals: number | undefined;
      let responseModelId: string | undefined;
      for (const [id, question] of questions as [string, ChoiceQuestion][]) {
        const criteria = toCriteria(question.criteria, structured);
        const result = await model.decide({
          state: options.state as JsonValue,
          instructions: structured || typeof question.instructions === 'string'
            ? question.instructions as JsonValue
            : JSON.stringify(question.instructions) ?? '',
          criteria,
          signal,
        });
        signal.throwIfAborted();
        validateDecision(result, criteria);
        answers[id] = { type: 'choice', choice: result.choice, probabilities: { ...result.probabilities } };
        confidence[id] = result.confidence;
        responseModelId ??= result.modelId;
        if (result.probabilityDecimals !== undefined) decimals = Math.min(decimals ?? 15, result.probabilityDecimals);
        inputTokens = result.inputTokens === undefined || inputTokens === undefined ? undefined : inputTokens + result.inputTokens;
        outputTokens = result.outputTokens === undefined || outputTokens === undefined ? undefined : outputTokens + result.outputTokens;
      }
      return {
        answers,
        usage: {
          ...(inputTokens === undefined ? {} : { inputTokens }),
          ...(outputTokens === undefined ? {} : { outputTokens }),
        },
        ...(decimals === undefined ? {} : { rounding: { probabilityDecimals: decimals } }),
        warnings: [],
        providerMetadata: { [model.provider]: { confidence } },
        response: { modelId: responseModelId ?? model.modelId, timestamp: new Date() },
      };
    },
  };
}

/** Whether the executor was handed an AI SDK evaluation model instead of a built-in transport. */
export function isEvaluationModel(model: DecisionModel | EvaluationModelV4): model is EvaluationModelV4 {
  return 'doEvaluate' in model && typeof model.doEvaluate === 'function';
}

/**
 * Adapts an AI SDK evaluation model to the executor: every decision is one
 * `experimental_evaluate` call with one choice question, no retries, so the
 * runner's call budget counts provider requests exactly. `ai` loads on the
 * first decision only, so the built-in transports keep working without it.
 */
export function fromEvaluationModel(model: EvaluationModelV4): DecisionModel {
  if (!model.supportedQuestionTypes.includes('choice')) {
    throw new Error('The ' + model.provider + ' evaluation model does not answer choice questions.');
  }
  return {
    provider: model.provider,
    modelId: model.modelId,
    // The evaluation spec accepts JSON objects for instructions and criteria.
    structured: true,
    async decide(request): Promise<DecisionResult> {
      const sdk = await loadSdk();
      const result = await sdk.experimental_evaluate({
        model,
        state: request.state as EvaluationInput,
        questions: { decision: {
          type: 'choice',
          instructions: request.instructions as EvaluationInput,
          criteria: request.criteria as ChoiceQuestion['criteria'],
        } },
        maxRetries: 0,
        abortSignal: request.signal,
      }).catch((error: unknown) => {
        throw evaluationError(sdk, error, request.signal);
      });
      const answer = result.answers.decision;
      // LLM evaluation adapters answer without a distribution; the probability gate needs one.
      if (answer.probabilities === undefined) {
        throw new AgentError('MODEL_OUTPUT_INVALID', 'The evaluation model returned no choice distribution; the executor gates on the selected probability.');
      }
      const decimals = result.rounding?.probabilityDecimals;
      return {
        choice: answer.choice,
        probabilities: answer.probabilities,
        confidence: reportedConfidence(result.providerMetadata) ?? 0,
        modelId: result.response.modelId,
        ...(result.usage.inputTokens === undefined ? {} : { inputTokens: result.usage.inputTokens }),
        ...(result.usage.outputTokens === undefined ? {} : { outputTokens: result.usage.outputTokens }),
        ...(decimals === undefined ? {} : { probabilityDecimals: decimals }),
      };
    },
  };
}

/** Loads the AI SDK only when an evaluation model is in use. */
async function loadSdk(): Promise<Sdk> {
  try {
    return await import('ai');
  } catch {
    throw new AgentError('MODEL_UNAVAILABLE', 'Install the ai package to use an AI SDK evaluation model.');
  }
}

/** Maps AI SDK failures onto the runner's model error codes without echoing provider text. */
function evaluationError(sdk: Sdk, error: unknown, signal: AbortSignal): unknown {
  signal.throwIfAborted();
  if (isAgentError(error)) return error;
  if (sdk.LoadAPIKeyError.isInstance(error)) return new AgentError('MODEL_UNAVAILABLE', 'Set the evaluation provider API key.');
  if (sdk.InvalidResponseDataError.isInstance(error) || sdk.TypeValidationError.isInstance(error) || sdk.JSONParseError.isInstance(error)) {
    return new AgentError('MODEL_OUTPUT_INVALID', 'The evaluation model returned an invalid answer.');
  }
  return new AgentError('MODEL_PROVIDER_FAILED', 'The evaluation model request failed.');
}

/**
 * Confidence is provider-specific metadata keyed by question id (TypeSafe
 * reports it under `typesafe.confidence`). Absent means none was reported.
 */
function reportedConfidence(metadata: EvaluationModelV4Result['providerMetadata']): number | undefined {
  for (const entry of Object.values(metadata ?? {})) {
    const confidence = entry['confidence'];
    if (confidence === null || typeof confidence !== 'object' || Array.isArray(confidence)) continue;
    const value = (confidence as Readonly<Record<string, unknown>>)['decision'];
    if (typeof value === 'number') return value;
  }
  return undefined;
}

/** Choice descriptions pass through; flat transports need plain strings. */
function toCriteria(criteria: ChoiceQuestion['criteria'], structured: boolean): Record<string, JsonValue> {
  const mapped: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(criteria)) {
    mapped[key] = structured || typeof value === 'string' ? value as JsonValue : value === null ? '' : JSON.stringify(value) ?? '';
  }
  return mapped;
}
