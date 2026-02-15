import type { FastifyInstance } from 'fastify';
import fastifyMetrics from 'fastify-metrics';

export async function registerMetrics(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMetrics.default, {
    endpoint: '/metrics',
    defaultMetrics: { enabled: true },
    routeMetrics: { enabled: true },
  });
}
