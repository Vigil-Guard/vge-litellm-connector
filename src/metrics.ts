import type { FastifyInstance } from 'fastify';
import fastifyMetrics from 'fastify-metrics';

type GuardrailAction = 'NONE' | 'BLOCKED' | 'GUARDRAIL_INTERVENED';
type VigilRequestResult = 'success' | 'error';
export type VigilBackendErrorType = 'timeout' | 'network' | 'http_4xx' | 'http_5xx' | 'unknown';

interface CounterLike {
  inc(labels: Record<string, string>, value?: number): void;
}

interface HistogramLike {
  observe(labels: Record<string, string>, value: number): void;
}

interface PromClientLike {
  Counter: new (options: { name: string; help: string; labelNames: string[] }) => CounterLike;
  Histogram: new (options: {
    name: string;
    help: string;
    labelNames: string[];
    buckets: number[];
  }) => HistogramLike;
  register: {
    getSingleMetric(name: string): unknown;
  };
}

const GUARDRAIL_DECISIONS: GuardrailAction[] = ['NONE', 'BLOCKED', 'GUARDRAIL_INTERVENED'];
const BACKEND_ERROR_TYPES: VigilBackendErrorType[] = ['timeout', 'network', 'http_4xx', 'http_5xx', 'unknown'];
const VIGIL_REQUEST_RESULTS: VigilRequestResult[] = ['success', 'error'];

let guardrailDecisionCounter: CounterLike | null = null;
let vigilBackendErrorCounter: CounterLike | null = null;
let vigilRequestDurationHistogram: HistogramLike | null = null;

export async function registerMetrics(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMetrics.default, {
    endpoint: '/metrics',
    defaultMetrics: { enabled: true },
    routeMetrics: { enabled: true },
  });

  const client = app.metrics.client as unknown as PromClientLike;

  guardrailDecisionCounter = getOrCreateCounter(
    client,
    'vge_guardrail_adapter_decisions_total',
    'Guardrail actions returned to LiteLLM',
    ['action'],
  );
  vigilBackendErrorCounter = getOrCreateCounter(
    client,
    'vge_guardrail_adapter_backend_errors_total',
    'Vigil backend call failures by error class',
    ['error_type'],
  );
  vigilRequestDurationHistogram = getOrCreateHistogram(
    client,
    'vge_guardrail_adapter_vigil_request_duration_seconds',
    'Duration of Vigil /v1/guard/analyze requests',
    ['result'],
    [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5],
  );

  for (const decision of GUARDRAIL_DECISIONS) {
    guardrailDecisionCounter.inc({ action: decision }, 0);
  }
  for (const errorType of BACKEND_ERROR_TYPES) {
    vigilBackendErrorCounter.inc({ error_type: errorType }, 0);
  }
  for (const result of VIGIL_REQUEST_RESULTS) {
    vigilRequestDurationHistogram.observe({ result }, 0);
  }
}

export function recordGuardrailDecision(action: GuardrailAction): void {
  guardrailDecisionCounter?.inc({ action });
}

export function recordVigilBackendError(errorType: VigilBackendErrorType): void {
  vigilBackendErrorCounter?.inc({ error_type: errorType });
}

export function observeVigilRequestDurationMs(durationMs: number, result: VigilRequestResult): void {
  vigilRequestDurationHistogram?.observe({ result }, durationMs / 1000);
}

function getOrCreateCounter(
  client: PromClientLike,
  name: string,
  help: string,
  labelNames: string[],
): CounterLike {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as CounterLike;
  return new client.Counter({ name, help, labelNames });
}

function getOrCreateHistogram(
  client: PromClientLike,
  name: string,
  help: string,
  labelNames: string[],
  buckets: number[],
): HistogramLike {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as HistogramLike;
  return new client.Histogram({ name, help, labelNames, buckets });
}
