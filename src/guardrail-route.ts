import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { AdapterConfig } from './config.js';
import { buildVigilRequest, mapVigilDecision, extractText } from './mapping.js';
import type { LiteLLMGuardrailRequest } from './mapping.js';
import { callVigilAnalyze, failClosedResponse } from './vigil-client.js';
import { recordGuardrailDecision } from './metrics.js';

interface GuardrailRequestBody {
  input_type: 'request' | 'response';
  texts?: string[];
  request_data?: Record<string, unknown>;
  litellm_trace_id?: string;
  litellm_call_id?: string;
}

const GUARDRAIL_ROUTE_BODY_SCHEMA = {
  type: 'object',
  required: ['input_type'],
  // LiteLLM may add new fields; allow them for forward compatibility
  additionalProperties: true,
  properties: {
    input_type: { type: 'string', enum: ['request', 'response'] },
    texts: { type: 'array', items: { type: 'string', maxLength: 100_000 }, maxItems: 100 },
    request_data: { type: 'object', additionalProperties: true },
    litellm_trace_id: { type: 'string', maxLength: 256 },
    litellm_call_id: { type: 'string', maxLength: 256 },
  },
} as const;

export async function registerGuardrailRoute(
  app: FastifyInstance,
  config: AdapterConfig,
): Promise<void> {
  app.post(
    '/beta/litellm_basic_guardrail_api',
    {
      schema: {
        body: GUARDRAIL_ROUTE_BODY_SCHEMA,
      },
    },
    async (request: FastifyRequest<{ Body: GuardrailRequestBody }>, reply: FastifyReply) => {
      if (config.inboundBearerToken) {
        const authHeader = extractAuthorizationHeader(request.headers['authorization']);
        if (!matchesBearerToken(authHeader, config.inboundBearerToken)) {
          return reply.status(401).send({ error: 'Unauthorized' });
        }
      }

      const payload = request.body;

      const litellmPayload: LiteLLMGuardrailRequest = {
        input_type: payload.input_type,
        texts: payload.texts,
        request_data: payload.request_data,
        litellm_trace_id: payload.litellm_trace_id,
        litellm_call_id: payload.litellm_call_id,
      };

      request.log.debug(
        { input_type: litellmPayload.input_type, textCount: litellmPayload.texts?.length ?? 0,
          litellm_trace_id: litellmPayload.litellm_trace_id },
        'Incoming guardrail payload',
      );

      const originalText = extractText(litellmPayload.texts);
      const vigilRequest = buildVigilRequest(litellmPayload);
      if (!vigilRequest || !originalText) {
        recordGuardrailDecision('NONE');
        return reply.send({ action: 'NONE' });
      }

      try {
        const vigilResponse = await callVigilAnalyze(vigilRequest, config, request.log);
        const litellmResponse = mapVigilDecision(vigilResponse, originalText);
        recordGuardrailDecision(litellmResponse.action);

        request.log.info(
          {
            decision: vigilResponse.decision,
            action: litellmResponse.action,
            vigilRequestId: vigilResponse.requestId,
            litellmTraceId: litellmPayload.litellm_trace_id,
          },
          'Guardrail decision',
        );

        return reply.send(litellmResponse);
      } catch (err) {
        request.log.error({ err }, 'Guardrail processing failed');
        recordGuardrailDecision('BLOCKED');
        return reply.send(failClosedResponse());
      }
    },
  );
}

function extractAuthorizationHeader(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return header[0];
  return header;
}

function matchesBearerToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;

  const actualToken = authHeader.slice('Bearer '.length);
  const expectedBuffer = Buffer.from(expectedToken, 'utf8');
  const actualBuffer = Buffer.from(actualToken, 'utf8');

  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
