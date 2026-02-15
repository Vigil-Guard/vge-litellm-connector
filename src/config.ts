export interface AdapterConfig {
  port: number;
  vigilApiUrl: string;
  vigilApiKey: string;
  vigilTimeoutMs: number;
  failMode: 'closed' | 'open';
  logLevel: string;
  inboundBearerToken?: string;
}

const DEFAULT_PORT = 8081;
const DEFAULT_VIGIL_TIMEOUT_MS = 3000;
const MIN_PORT = 1;
const MAX_PORT = 65535;
const MIN_VIGIL_TIMEOUT_MS = 100;
const MAX_VIGIL_TIMEOUT_MS = 30000;

export function loadConfig(): AdapterConfig {
  const rawVigilApiUrl = requireEnv('VIGIL_API_URL');
  const vigilApiKey = requireEnv('VIGIL_API_KEY');
  const allowInsecureHttp = parseBooleanEnv(process.env['VIGIL_ALLOW_INSECURE_HTTP']);

  return {
    port: parseBoundedInt(
      process.env['ADAPTER_PORT'],
      DEFAULT_PORT,
      MIN_PORT,
      MAX_PORT,
      'ADAPTER_PORT',
    ),
    vigilApiUrl: validateAndNormalizeVigilApiUrl(rawVigilApiUrl, allowInsecureHttp),
    vigilApiKey,
    vigilTimeoutMs: parseBoundedInt(
      process.env['VIGIL_TIMEOUT_MS'],
      DEFAULT_VIGIL_TIMEOUT_MS,
      MIN_VIGIL_TIMEOUT_MS,
      MAX_VIGIL_TIMEOUT_MS,
      'VIGIL_TIMEOUT_MS',
    ),
    failMode: parseFailMode(process.env['ADAPTER_FAIL_MODE']),
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    inboundBearerToken: parseOptionalEnv(process.env['ADAPTER_INBOUND_BEARER_TOKEN']),
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

function parseBoundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  envName: string,
): number {
  if (!value) return fallback;
  if (!/^-?\d+$/.test(value)) {
    console.warn(`Invalid ${envName}="${value}" - using fallback ${String(fallback)}`);
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) {
    console.warn(
      `Out-of-range ${envName}="${value}" (allowed ${String(min)}-${String(max)}) - using fallback ${String(fallback)}`,
    );
    return fallback;
  }

  return parsed;
}

function parseFailMode(value: string | undefined): 'closed' | 'open' {
  if (value === 'open') return 'open';
  return 'closed';
}

function validateAndNormalizeVigilApiUrl(value: string, allowInsecureHttp: boolean): string {
  const normalizedUrl = value.replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    console.error(`Invalid VIGIL_API_URL: "${value}"`);
    process.exit(1);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    console.error('VIGIL_API_URL must use http:// or https://');
    process.exit(1);
  }

  if (parsed.protocol === 'http:' && !allowInsecureHttp) {
    console.error(
      'VIGIL_API_URL must use https:// in production. Set VIGIL_ALLOW_INSECURE_HTTP=true only for local development/testing.',
    );
    process.exit(1);
  }

  return normalizedUrl;
}

function parseBooleanEnv(value: string | undefined): boolean {
  return value === 'true';
}

function parseOptionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
