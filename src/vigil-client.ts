import type { AdapterConfig } from './config.js';
import type { VigilAnalyzeRequest, VigilAnalyzeResponse, LiteLLMGuardrailResponse } from './mapping.js';
import type { FastifyBaseLogger } from 'fastify';
import {
  observeVigilRequestDurationMs,
  recordVigilBackendError,
  type VigilBackendErrorType,
} from './metrics.js';

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504, 429]);
const CONNECTIVITY_WINDOW = 5;
const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']);

const recentResults: boolean[] = [];

export type VigilReachability = 'unknown' | 'reachable' | 'unreachable';

export function recordVigilCallResult(success: boolean): void {
  recentResults.push(success);
  if (recentResults.length > CONNECTIVITY_WINDOW) recentResults.shift();
}

export function isVigilReachable(): boolean {
  return getVigilReachabilityStatus() === 'reachable';
}

export function getVigilReachabilityStatus(): VigilReachability {
  if (recentResults.length === 0) return 'unknown';
  return recentResults.some((r) => r) ? 'reachable' : 'unreachable';
}

export function resetConnectivityTracker(): void {
  recentResults.length = 0;
}

export async function callVigilAnalyze(
  vigilRequest: VigilAnalyzeRequest,
  config: AdapterConfig,
  log: FastifyBaseLogger,
): Promise<VigilAnalyzeResponse> {
  const url = `${config.vigilApiUrl}/v1/guard/analyze`;
  const startedAt = Date.now();

  try {
    const result = await fetchWithRetry(url, vigilRequest, config, log);
    recordVigilCallResult(true);
    observeVigilRequestDurationMs(Date.now() - startedAt, 'success');
    return result;
  } catch (error) {
    recordVigilCallResult(false);
    recordVigilBackendError(classifyVigilError(error));
    observeVigilRequestDurationMs(Date.now() - startedAt, 'error');
    log.error({ err: error }, 'Vigil API call failed');

    if (config.failMode === 'open') {
      return { decision: 'ALLOWED', categories: [] };
    }
    throw error;
  }
}

export function failClosedResponse(): LiteLLMGuardrailResponse {
  return { action: 'BLOCKED', blocked_reason: 'Guardrail backend unavailable' };
}

async function fetchWithRetry(
  url: string,
  body: VigilAnalyzeRequest,
  config: AdapterConfig,
  log: FastifyBaseLogger,
): Promise<VigilAnalyzeResponse> {
  const attempt = async (): Promise<VigilAnalyzeResponse> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.vigilTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.vigilApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        await response.body?.cancel();
        const statusError = new Error(`Vigil API returned ${String(response.status)}`);
        (statusError as NodeJS.ErrnoException).code = String(response.status);
        throw statusError;
      }

      return (await response.json()) as VigilAnalyzeResponse;
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    return await attempt();
  } catch (firstError) {
    if (!isRetryable(firstError)) throw firstError;

    const jitterMs = 50 + Math.random() * 150;
    log.warn({ jitterMs: Math.round(jitterMs) }, 'Retrying Vigil API call after transient failure');
    await sleep(jitterMs);

    return await attempt();
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true;
    const code = getErrorCode(error);
    const statusCode = parseStatusCode(code);
    if (statusCode !== null && RETRYABLE_STATUS_CODES.has(statusCode)) return true;
    if (code && NETWORK_ERROR_CODES.has(code)) return true;
    const cause = (error as { cause?: { code?: string } }).cause;
    if (cause?.code && NETWORK_ERROR_CODES.has(cause.code)) return true;
    if ([...NETWORK_ERROR_CODES].some((networkCode) => error.message.includes(networkCode))) return true;
  }
  return false;
}

function classifyVigilError(error: unknown): VigilBackendErrorType {
  if (!(error instanceof Error)) return 'unknown';
  if (error.name === 'AbortError') return 'timeout';

  const code = getErrorCode(error);
  const statusCode = parseStatusCode(code);
  if (statusCode !== null) {
    if (statusCode >= 500) return 'http_5xx';
    if (statusCode >= 400) return 'http_4xx';
  }

  if (code && NETWORK_ERROR_CODES.has(code)) return 'network';

  const cause = (error as { cause?: { code?: string } }).cause;
  if (cause?.code && NETWORK_ERROR_CODES.has(cause.code)) return 'network';

  if ([...NETWORK_ERROR_CODES].some((networkCode) => error.message.includes(networkCode))) return 'network';

  return 'unknown';
}

function getErrorCode(error: Error): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function parseStatusCode(errorCode: string | undefined): number | null {
  if (!errorCode || !/^\d{3}$/.test(errorCode)) return null;
  return Number.parseInt(errorCode, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
