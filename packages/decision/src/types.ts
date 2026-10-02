import type { JsonValue } from 'e2e';

/**
 * One bounded choice. Descriptions and instructions are plain strings:
 * some compatible endpoints may reject structured values.
 * The binding of verb, node, and arguments stays in code; the model
 * only ever sees the choice id and its description string.
 */
export interface DecisionRequest {
  readonly state: JsonValue;
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
  // Masked viewport screenshots as data URLs, newest first. Present only
  // when the executor runs with vision true and the model declares vision
  // true; withheld, tainted, or text-only transports send none.
  readonly images?: readonly string[];
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
}

/** The transport an executor uses; it has no dependency on an engine or the AI SDK. */
export interface DecisionModel {
  readonly provider: string;
  readonly modelId: string;
  // Whether the transport can carry viewport images to the provider.
  // Clef sets this; Jev is text-only, so the executor never sends it pixels.
  readonly vision?: boolean;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

/** A System One-compatible HTTP endpoint. Credentials stay in the transport closure. */
export interface SystemOneOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly provider: string;
  readonly envelope?: 'direct' | 'cloudflare';
  // Set for endpoints that accept the System One images array, such as Clef. Defaults to false.
  readonly vision?: boolean;
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

/** Confidence and probability gates apply to every action and assertion. */
export interface DecisionExecutorOptions {
  readonly model: DecisionModel;
  /** Minimum probability of the selected option, greater than 0.5 and at most 1. Default 0.9. */
  readonly minProbability?: number;
  /** Minimum reported confidence, between 0 and 1. Default 0.9. */
  readonly minConfidence?: number;
  // Attach the masked viewport screenshot to each decision request when the
  // model supports vision. Defaults to false (semantic text only). Pixels
  // degrade: withheld or tainted viewports decide from text alone.
  readonly vision?: boolean;
}
