import type { Experimental_EvaluationModelV4 } from '@ai-sdk/provider';
import type { JsonValue } from 'e2e';

/**
 * One bounded choice. Flat transports receive plain strings throughout;
 * structured transports receive objects (instructions as a labeled record,
 * criteria values as element records). Some compatible endpoints reject
 * structured values the native APIs accept.
 * The binding of verb, node, and arguments stays in code; the model
 * only ever sees the choice id and its description.
 */
export interface DecisionRequest {
  readonly state: JsonValue;
  readonly instructions: JsonValue;
  readonly criteria: Readonly<Record<string, JsonValue>>;
  readonly signal: AbortSignal;
}

/** A choice and its distribution, with optional provider token accounting. */
export interface DecisionResult {
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
  readonly modelId: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /**
   * Decimal places the provider rounds probabilities to, when it rounds.
   * Validation then allows half a unit in the last place per option in the
   * distribution sum, the same rule AI SDK evaluate applies.
   */
  readonly probabilityDecimals?: number;
}

/** The transport an executor uses; it has no dependency on an engine or the AI SDK. */
export interface DecisionModel {
  readonly provider: string;
  readonly modelId: string;
  /**
   * Whether the endpoint accepts structured instructions and criteria
   * values. Native Clef and Jev do; compatible endpoints may not, so they
   * stay on flat strings unless they opt in.
   */
  readonly structured?: boolean;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

/** A System One-compatible HTTP endpoint. Credentials stay in the transport closure. */
export interface SystemOneOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly provider: string;
  readonly envelope?: 'direct' | 'cloudflare';
  /** Set for endpoints that accept structured values, such as Clef and Jev. Defaults to false. */
  readonly structured?: boolean;
  /** Decimal places the endpoint rounds probabilities to, an integer from 0 to 15. Omit for full precision. */
  readonly probabilityDecimals?: number;
  readonly fetch?: typeof fetch;
}

/** Cloudflare's hosted Clef models. */
export interface ClefOptions {
  readonly accountId: string;
  readonly apiKey: string;
  /** Defaults to 'clef-flash'. */
  readonly model?: 'clef' | 'clef-flash';
  readonly fetch?: typeof fetch;
}

/** TypeSafe's hosted Jev model or a pinned Jev version. */
export interface JevOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly fetch?: typeof fetch;
}

/** Optional confidence and probability gates; when set, they apply to every action and assertion. */
export interface DecisionExecutorOptions {
  /**
   * A built-in transport (`clef()`, `jev()`, `systemOne()`) or any AI SDK
   * evaluation model that answers choice questions, such as
   * `typeSafeAi.evaluationModel('jev-latest')`. Evaluation models run
   * through `experimental_evaluate` and need the `ai` package.
   */
  readonly model: DecisionModel | Experimental_EvaluationModelV4;
  /**
   * Minimum probability of the selected option, between 0 and 1. Default 0:
   * no gate, the executor follows the most probable choice.
   */
  readonly minProbability?: number;
  /**
   * Minimum reported confidence, between 0 and 1. Default 0: no gate. An
   * evaluation model that reports no confidence statistic counts as 0, so
   * any value above 0 blocks it.
   */
  readonly minConfidence?: number;
}
