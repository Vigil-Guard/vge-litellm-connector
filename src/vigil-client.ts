import type { AdapterConfig } from './config.js';
import type { VigilAnalyzeRequest, VigilAnalyzeResponse, LiteLLMGuardrailResponse } from './mapping.js';
import type { FastifyBaseLogger } from 'fastify';

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504, 429]);
const CONNECTIVITY_WINDOW = 5;

const recentResults: boolean[] = [];

export function recordVigilCallResult(success: boolean): void {
  recentResults.push(success);
  if (recentResults.length > CONNECTIVITY_WINDOW) recentResults.shift();
}

export function isVigilReachable(): boolean {
  if (recentResults.length === 0) return true; // no data yet = assume reachable
  return recentResults.some((r) => r);
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

  try {
    const result = await fetchWithRetry(url, vigilRequest, config, log);
    recordVigilCallResult(true);
    return result;
  } catch (error) {
    recordVigilCallResult(false);
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
    const code = (error as NodeJS.ErrnoException).code;
    if (code && RETRYABLE_STATUS_CODES.has(parseInt(code, 10))) return true;
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ECONNRESET')) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
