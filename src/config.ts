export interface AdapterConfig {
  port: number;
  vigilApiUrl: string;
  vigilApiKey: string;
  vigilTimeoutMs: number;
  failMode: 'closed' | 'open';
  logLevel: string;
}

export function loadConfig(): AdapterConfig {
  const vigilApiUrl = requireEnv('VIGIL_API_URL');
  const vigilApiKey = requireEnv('VIGIL_API_KEY');

  return {
    port: parseIntSafe(process.env['ADAPTER_PORT'], 8081),
    vigilApiUrl: vigilApiUrl.replace(/\/+$/, ''),
    vigilApiKey,
    vigilTimeoutMs: parseIntSafe(process.env['VIGIL_TIMEOUT_MS'], 3000),
    failMode: parseFailMode(process.env['ADAPTER_FAIL_MODE']),
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseFailMode(value: string | undefined): 'closed' | 'open' {
  if (value === 'open') return 'open';
  return 'closed';
}
