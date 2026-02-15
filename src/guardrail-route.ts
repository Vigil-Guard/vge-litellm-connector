import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AdapterConfig } from './config.js';
import { validateInputType, buildVigilRequest, mapVigilDecision, extractText } from './mapping.js';
import type { LiteLLMGuardrailRequest } from './mapping.js';
import { callVigilAnalyze, failClosedResponse } from './vigil-client.js';

export async function registerGuardrailRoute(
  app: FastifyInstance,
  config: AdapterConfig,
): Promise<void> {
  app.post(
    '/beta/litellm_basic_guardrail_api',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = request.body as Record<string, unknown>;

      let inputType: 'request' | 'response';
      try {
        inputType = validateInputType(payload['input_type']);
      } catch {
        return reply.status(400).send({
          error: 'Invalid or missing input_type',
          expected: ['request', 'response'],
        });
      }

      const litellmPayload: LiteLLMGuardrailRequest = {
        input_type: inputType,
        texts: payload['texts'] as string[] | undefined,
        request_data: payload['request_data'] as Record<string, unknown> | undefined,
        litellm_trace_id: payload['litellm_trace_id'] as string | undefined,
        litellm_call_id: payload['litellm_call_id'] as string | undefined,
      };

      const originalText = extractText(litellmPayload.texts);
      const vigilRequest = buildVigilRequest(litellmPayload);
      if (!vigilRequest || !originalText) {
        return reply.send({ action: 'NONE' });
      }

      try {
        const vigilResponse = await callVigilAnalyze(vigilRequest, config, request.log);
        const litellmResponse = mapVigilDecision(vigilResponse, originalText);

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
        return reply.send(failClosedResponse());
      }
    },
  );
}
