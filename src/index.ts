import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { registerHealthRoutes } from './health.js';
import { registerGuardrailRoute } from './guardrail-route.js';
import { registerMetrics } from './metrics.js';

const config = loadConfig();

const app = Fastify({
  ajv: {
    customOptions: {
      coerceTypes: false,
    },
  },
  logger: {
    level: config.logLevel,
    ...(process.env['NODE_ENV'] !== 'production'
      ? { transport: { target: 'pino-pretty' } }
      : {}),
  },
  bodyLimit: 1_048_576,
});

await registerMetrics(app);
await registerHealthRoutes(app);
await registerGuardrailRoute(app, config);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, 'Shutting down');
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
