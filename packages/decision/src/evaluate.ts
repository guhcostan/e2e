import type { Experimental_EvaluationModelV4 } from '@ai-sdk/provider';
import type { StepExecutorContext } from 'e2e';
import { AgentError, isAgentError } from 'e2e/agent';
import {
  experimental_evaluate,
  InvalidArgumentError,
  InvalidResponseDataError,
  JSONParseError,
  LoadAPIKeyError,
  TypeValidationError,
} from "ai";
import type { DecisionRequest } from "./questions.ts";
/** One gated answer: the chosen option, its probability, and the provider confidence. */
export interface Decision {
  readonly choice: string;
  readonly probability: number;
  readonly confidence: number;
}
/**
 * Makes one evaluate call under the step budget and returns the answers.
 * This is the only file that touches the SDK evaluate API, so a rename
 * there stays a one-file change.
 */
export async function evaluate(ctx: StepExecutorContext, model: Experimental_EvaluationModelV4, request: DecisionRequest): Promise<Record<string, Decision>> {
  ctx.signal.throwIfAborted();
  const started = performance.now();
  const startedAt = new Date().toISOString();
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let modelId = model.modelId;
  let providerMetadata: Record<string, Record<string, unknown>> | undefined;
  let answers: Record<string, { type: string; choice?: string; probabilities?: Record<string, number> }>;
  try {
    const call = { model, state: request.state, questions: request.questions } as unknown as Parameters<typeof experimental_evaluate>[0];
    const result = await experimental_evaluate({ ...call, maxRetries: 0, abortSignal: ctx.signal });
    ctx.signal.throwIfAborted();
    inputTokens = result.usage.inputTokens;
    outputTokens = result.usage.outputTokens;
    modelId = result.response.modelId;
    providerMetadata = result.providerMetadata as Record<string, Record<string, unknown>> | undefined;
    answers = result.answers as Record<string, { type: string; choice?: string; probabilities?: Record<string, number> }>;
  } catch (error) {
    throw evaluateError(error, ctx.signal);
  } finally {
    ctx.budgets.recordModelCall({ provider: model.provider, modelId, startedAt, durationMs: performance.now() - started, ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }) });
  }
  const decisions: Record<string, Decision> = {};
  for (const entry of Object.entries(answers)) {
    const id = entry[0];
    const answer = entry[1];
    if (answer === undefined || answer.type !== "choice" || answer.probabilities === undefined) throw new AgentError("MODEL_OUTPUT_INVALID", "The decision model returned an answer without a choice distribution.");
    decisions[id] = { choice: answer.choice ?? "", probability: answer.choice === undefined ? 0 : (answer.probabilities[answer.choice] ?? 0), confidence: reportedConfidence(providerMetadata, id) };
  }
  return decisions;
}
/** Provider-reported confidence for one question, or 0 when absent. */
function reportedConfidence(metadata: Record<string, Record<string, unknown>> | undefined, id: string): number {
  for (const section of Object.values(metadata ?? {})) {
    const confidence = section["confidence"];
    if (confidence !== null && typeof confidence === "object" && !Array.isArray(confidence)) {
      const value = (confidence as Record<string, unknown>)[id];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return 0;
}
/** Maps SDK failures onto the runner error codes without echoing provider text. */
function evaluateError(error: unknown, signal: AbortSignal): unknown {
  signal.throwIfAborted();
  if (isAgentError(error)) return error;
  if (LoadAPIKeyError.isInstance(error)) return new AgentError("MODEL_UNAVAILABLE", "Set the evaluation model API key.");
  if (InvalidArgumentError.isInstance(error)) return error;
  if (InvalidResponseDataError.isInstance(error) || TypeValidationError.isInstance(error) || JSONParseError.isInstance(error)) return new AgentError("MODEL_OUTPUT_INVALID", "The decision model returned an invalid answer.");
  return new AgentError("MODEL_PROVIDER_FAILED", "The decision model call failed.");
}
