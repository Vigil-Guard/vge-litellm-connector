import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env['VIGIL_API_URL'] = 'http://vigil-api:8787';
    process.env['VIGIL_API_KEY'] = 'vg_live_test123';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads defaults for optional values', () => {
    const config = loadConfig();
    expect(config.port).toBe(8081);
    expect(config.vigilTimeoutMs).toBe(3000);
    expect(config.failMode).toBe('closed');
    expect(config.logLevel).toBe('info');
  });

  it('reads required values', () => {
    const config = loadConfig();
    expect(config.vigilApiUrl).toBe('http://vigil-api:8787');
    expect(config.vigilApiKey).toBe('vg_live_test123');
  });

  it('strips trailing slash from API URL', () => {
    process.env['VIGIL_API_URL'] = 'http://vigil-api:8787/';
    const config = loadConfig();
    expect(config.vigilApiUrl).toBe('http://vigil-api:8787');
  });

  it('strips multiple trailing slashes', () => {
    process.env['VIGIL_API_URL'] = 'http://vigil-api:8787///';
    const config = loadConfig();
    expect(config.vigilApiUrl).toBe('http://vigil-api:8787');
  });

  it('parses open fail mode', () => {
    process.env['ADAPTER_FAIL_MODE'] = 'open';
    const config = loadConfig();
    expect(config.failMode).toBe('open');
  });

  it('defaults unknown fail mode to closed', () => {
    process.env['ADAPTER_FAIL_MODE'] = 'invalid';
    const config = loadConfig();
    expect(config.failMode).toBe('closed');
  });

  it('parses custom port', () => {
    process.env['ADAPTER_PORT'] = '9090';
    const config = loadConfig();
    expect(config.port).toBe(9090);
  });

  it('parses custom timeout', () => {
    process.env['VIGIL_TIMEOUT_MS'] = '2000';
    const config = loadConfig();
    expect(config.vigilTimeoutMs).toBe(2000);
  });

  it('falls back to default on NaN port', () => {
    process.env['ADAPTER_PORT'] = 'abc';
    const config = loadConfig();
    expect(config.port).toBe(8081);
  });

  it('falls back to default on NaN timeout', () => {
    process.env['VIGIL_TIMEOUT_MS'] = 'not-a-number';
    const config = loadConfig();
    expect(config.vigilTimeoutMs).toBe(3000);
  });
});
