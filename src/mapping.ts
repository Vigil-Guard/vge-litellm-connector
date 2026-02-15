export interface LiteLLMGuardrailRequest {
  input_type: 'request' | 'response';
  texts?: string[];
  request_data?: Record<string, unknown>;
  litellm_trace_id?: string;
  litellm_call_id?: string;
  structured_messages?: unknown[];
}

export interface LiteLLMGuardrailResponse {
  action: 'BLOCKED' | 'NONE' | 'GUARDRAIL_INTERVENED';
  blocked_reason?: string;
  texts?: string[];
}

export interface VigilAnalyzeRequest {
  text: string;
  source: 'user_input' | 'model_output';
  mode: 'full';
  metadata?: Record<string, unknown>;
}

export interface VigilAnalyzeResponse {
  requestId?: string;
  decision: 'ALLOWED' | 'BLOCKED' | 'SANITIZED';
  categories?: string[];
  decisionReason?: string;
  blockMessage?: string;
  sanitizedText?: string;
  redactedText?: string;
  outputText?: string;
}

const VALID_INPUT_TYPES = new Set(['request', 'response']);
const REQUEST_DATA_METADATA_KEYS = [
  'model',
  'model_group',
  'provider',
  'region',
  'deployment',
  'user',
  'user_id',
  'session_id',
  'conversation_id',
  'request_id',
  'tenant_id',
  'org_id',
] as const;
const MAX_METADATA_STRING_LENGTH = 500;

export function validateInputType(value: unknown): 'request' | 'response' {
  if (typeof value !== 'string' || !VALID_INPUT_TYPES.has(value)) {
    throw new Error(`Invalid input_type: expected "request" or "response", got ${JSON.stringify(value)}`);
  }
  return value as 'request' | 'response';
}

export function mapInputType(inputType: 'request' | 'response'): 'user_input' | 'model_output' {
  return inputType === 'response' ? 'model_output' : 'user_input';
}

export function extractText(texts: unknown[] | undefined): string | null {
  if (!texts) return null;
  for (const value of texts) {
    if (typeof value !== 'string') continue;
    if (value.trim().length > 0) return value;
  }
  return null;
}

export function buildVigilRequest(
  litellmRequest: LiteLLMGuardrailRequest,
): VigilAnalyzeRequest | null {
  const text = extractText(litellmRequest.texts);
  if (!text) return null;

  const metadata: Record<string, unknown> = {};
  if (litellmRequest.litellm_trace_id) metadata['litellmTraceId'] = litellmRequest.litellm_trace_id;
  if (litellmRequest.litellm_call_id) metadata['litellmCallId'] = litellmRequest.litellm_call_id;
  const requestDataMetadata = extractMetadataFromRequestData(litellmRequest.request_data);
  Object.assign(metadata, requestDataMetadata);

  return {
    text,
    source: mapInputType(litellmRequest.input_type),
    mode: 'full',
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

export function mapVigilDecision(
  vigil: VigilAnalyzeResponse,
  originalText: string,
): LiteLLMGuardrailResponse {
  if (vigil.decision === 'BLOCKED') {
    const reason =
      vigil.blockMessage ??
      vigil.decisionReason ??
      (vigil.categories && vigil.categories.length > 0 ? vigil.categories.join(', ') : null) ??
      'Blocked by policy';
    return { action: 'BLOCKED', blocked_reason: reason };
  }

  if (vigil.decision === 'SANITIZED') {
    const transformedText = vigil.sanitizedText ?? vigil.redactedText ?? vigil.outputText;
    return {
      action: 'GUARDRAIL_INTERVENED',
      texts: [transformedText ?? originalText],
    };
  }

  return { action: 'NONE' };
}

function extractMetadataFromRequestData(
  requestData: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!requestData) return {};

  const metadata: Record<string, unknown> = {};
  for (const key of REQUEST_DATA_METADATA_KEYS) {
    const value = requestData[key];
    const normalizedValue = normalizeMetadataValue(value);
    if (normalizedValue === undefined) continue;
    metadata[key] = normalizedValue;
  }

  return metadata;
}

function normalizeMetadataValue(value: unknown): string | number | boolean | string[] | undefined {
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    if (value.length <= MAX_METADATA_STRING_LENGTH) return value;
    return value.slice(0, MAX_METADATA_STRING_LENGTH);
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value.slice(0, 10).map((entry) =>
      entry.length <= MAX_METADATA_STRING_LENGTH
        ? entry
        : entry.slice(0, MAX_METADATA_STRING_LENGTH),
    );
  }

  return undefined;
}
