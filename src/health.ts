import type { FastifyInstance } from 'fastify';
import { isVigilReachable } from './vigil-client.js';

// Read version once at module load
const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
const VERSION = pkg.version as string;

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async () => {
    return { status: 'ok', version: VERSION };
  });

  app.get('/health/ready', async (_request, reply) => {
    const reachable = isVigilReachable();
    const status = reachable ? 'ok' : 'degraded';
    const statusCode = reachable ? 200 : 503;
    return reply.status(statusCode).send({ status, vigilReachable: reachable, version: VERSION });
  });
}
