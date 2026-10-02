import { AgentError } from 'e2e/agent';
import { z } from 'zod';
import type { JsonValue } from 'e2e';
import type { ClefOptions, DecisionModel, DecisionResult, JevOptions, SystemOneOptions } from './types.ts';

const probability = z.number().min(0).max(1);
const resultSchema = z.object({
  model: z.string().min(1),
  answers: z.object({ decision: z.object({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }) }),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
const cloudflareSchema = z.object({ success: z.literal(true), result: resultSchema });

/** Connects to the System One choice API, including self-hosted compatible endpoints. */
export function systemOne(options: SystemOneOptions): DecisionModel {
  const transport = options.fetch ?? fetch;
  const endpoint = new URL(options.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('The decision endpoint must be an HTTP or HTTPS URL without embedded credentials.');
  }
  const decimals = options.probabilityDecimals;
  if (decimals !== undefined && (!Number.isInteger(decimals) || decimals < 0 || decimals > 15)) {
    throw new Error('probabilityDecimals must be an integer from 0 to 15.');
  }
  return {
    provider: options.provider,
    modelId: options.model,
    ...(options.structured === undefined ? {} : { structured: options.structured }),
    async decide(request) {
      if (!options.apiKey) throw new AgentError('MODEL_UNAVAILABLE', 'Set the decision provider API key.');
      request.signal.throwIfAborted();
      let response: Response;
      try {
        response = await transport(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
          signal: request.signal,
          body: JSON.stringify({
            model: options.model,
            state: request.state,
            questions: { decision: { type: 'choice', instructions: request.instructions, criteria: request.criteria } },
          }),
        });
      } catch {
        request.signal.throwIfAborted();
        throw new AgentError('MODEL_PROVIDER_FAILED', 'The decision request could not reach the provider.');
      }
      if (!response.ok) {
        throw new AgentError('MODEL_PROVIDER_FAILED', `The decision provider returned HTTP ${response.status}.`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        request.signal.throwIfAborted();
        throw new AgentError('MODEL_OUTPUT_INVALID', 'The decision provider returned invalid JSON.');
      }
      if (options.envelope === 'cloudflare') {
        const envelope = z.object({ success: z.boolean() }).safeParse(body);
        if (envelope.success && !envelope.data.success) {
          throw new AgentError('MODEL_PROVIDER_FAILED', 'Cloudflare declined the decision request.');
        }
      }
      const parsed = options.envelope === 'cloudflare' ? cloudflareSchema.safeParse(body) : resultSchema.safeParse(body);
      if (!parsed.success) throw new AgentError('MODEL_OUTPUT_INVALID', 'The decision response did not match the choice schema.');
      const data = 'result' in parsed.data ? parsed.data.result : parsed.data;
      return {
        ...data.answers.decision,
        modelId: data.model,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        ...(decimals === undefined ? {} : { probabilityDecimals: decimals }),
      };
    },
  };
}

/** Uses Cloudflare's hosted Clef or Clef-flash decision API. */
export function clef(options: ClefOptions): DecisionModel {
  if (!options.accountId) throw new Error('Set the Cloudflare account id.');
  const model = options.model ?? 'clef-flash';
  return systemOne({
    provider: 'cloudflare',
    endpoint: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/ai/run/@cf/cloudflare/${model}`,
    apiKey: options.apiKey,
    model,
    envelope: 'cloudflare',
    structured: true,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

/** Uses TypeSafe's hosted Jev decision API. */
export function jev(options: JevOptions): DecisionModel {
  return systemOne({
    provider: 'typesafe',
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    apiKey: options.apiKey,
    model: options.model ?? 'jev-latest',
    // The TypeSafe API accepts structured instructions and criteria values.
    structured: true,
    // TypeSafe rounds probabilities to two places (its AI SDK provider
    // declares the same), so a long distribution need not sum to exactly 1.
    probabilityDecimals: 2,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

/** Validates custom transports too; a malformed or out-of-domain answer never authorizes an action. Only the choice ids matter, so flat and structured criteria validate the same way. */
export function validateDecision(result: DecisionResult, criteria: Readonly<Record<string, JsonValue>>): void {
  const invalid = () => new AgentError('MODEL_OUTPUT_INVALID', 'The decision response contains an invalid choice or probability distribution.');
  if (result === null || typeof result !== 'object') throw invalid();
  const probabilities = (result as { probabilities?: unknown }).probabilities;
  if (probabilities === null || typeof probabilities !== 'object') throw invalid();
  const distribution = probabilities as Record<string, number>;
  const keys = Object.keys(criteria);
  const values = keys.map((key) => distribution[key]);
  const decimals = result.probabilityDecimals;
  if (decimals !== undefined && (!Number.isInteger(decimals) || decimals < 0 || decimals > 15)) throw invalid();
  // Half a unit in the last place per rounded probability, accumulated over the sum.
  const tolerance = 0.001 + (decimals === undefined ? 0 : keys.length * 0.5 * 10 ** -decimals);
  const valid = typeof result.choice === 'string' &&
    Object.hasOwn(criteria, result.choice) &&
    Object.keys(distribution).length === keys.length &&
    Object.keys(distribution).every((key) => Object.hasOwn(criteria, key)) &&
    values.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) &&
    Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1;
  if (!valid || Math.abs(values.reduce<number>((sum, value) => sum + (value ?? 0), 0) - 1) > tolerance ||
    distribution[result.choice] !== Math.max(...values.map((value) => value ?? 0))) {
    throw new AgentError('MODEL_OUTPUT_INVALID', 'The decision response contains an invalid choice or probability distribution.');
  }
}
