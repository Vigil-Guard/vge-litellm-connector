import { describe, it, expect, beforeEach } from 'vitest';
import {
  isRetryable,
  classifyVigilError,
  recordVigilCallResult,
  getVigilReachabilityStatus,
  resetConnectivityTracker,
} from '../../src/vigil-client.js';
import { validateVigilDecision } from '../../src/mapping.js';

function makeErrorWithCode(code: string): Error {
  const err = new Error(`Vigil API returned ${code}`);
  (err as NodeJS.ErrnoException).code = code;
  return err;
}

function makeAbortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

function makeNetworkError(code: string): Error {
  const err = new Error('fetch failed');
  (err as NodeJS.ErrnoException).code = code;
  return err;
}

describe('isRetryable', () => {
  it('returns true for AbortError', () => {
    expect(isRetryable(makeAbortError())).toBe(true);
  });

  it('returns true for 502', () => {
    expect(isRetryable(makeErrorWithCode('502'))).toBe(true);
  });

  it('returns true for 503', () => {
    expect(isRetryable(makeErrorWithCode('503'))).toBe(true);
  });

  it('returns true for 504', () => {
    expect(isRetryable(makeErrorWithCode('504'))).toBe(true);
  });

  it('returns true for 429', () => {
    expect(isRetryable(makeErrorWithCode('429'))).toBe(true);
  });

  it('returns false for 400', () => {
    expect(isRetryable(makeErrorWithCode('400'))).toBe(false);
  });

  it('returns false for 401', () => {
    expect(isRetryable(makeErrorWithCode('401'))).toBe(false);
  });

  it('returns true for ECONNREFUSED', () => {
    expect(isRetryable(makeNetworkError('ECONNREFUSED'))).toBe(true);
  });

  it('returns true for ECONNRESET', () => {
    expect(isRetryable(makeNetworkError('ECONNRESET'))).toBe(true);
  });

  it('returns true for ENOTFOUND', () => {
    expect(isRetryable(makeNetworkError('ENOTFOUND'))).toBe(true);
  });

  it('returns true for ETIMEDOUT', () => {
    expect(isRetryable(makeNetworkError('ETIMEDOUT'))).toBe(true);
  });

  it('returns true for EAI_AGAIN', () => {
    expect(isRetryable(makeNetworkError('EAI_AGAIN'))).toBe(true);
  });

  it('returns true when network code is in cause.code', () => {
    const err = new Error('fetch failed');
    (err as unknown as { cause: { code: string } }).cause = { code: 'ECONNRESET' };
    expect(isRetryable(err)).toBe(true);
  });

  it('returns true when network code is in message', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8080');
    expect(isRetryable(err)).toBe(true);
  });

  it('returns false for non-Error value', () => {
    expect(isRetryable('string error')).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(42)).toBe(false);
  });

  it('returns false for generic Error without code', () => {
    expect(isRetryable(new Error('something went wrong'))).toBe(false);
  });
});

describe('classifyVigilError', () => {
  it('returns timeout for AbortError', () => {
    expect(classifyVigilError(makeAbortError())).toBe('timeout');
  });

  it('returns http_5xx for 500', () => {
    expect(classifyVigilError(makeErrorWithCode('500'))).toBe('http_5xx');
  });

  it('returns http_5xx for 503', () => {
    expect(classifyVigilError(makeErrorWithCode('503'))).toBe('http_5xx');
  });

  it('returns http_4xx for 400', () => {
    expect(classifyVigilError(makeErrorWithCode('400'))).toBe('http_4xx');
  });

  it('returns http_4xx for 401', () => {
    expect(classifyVigilError(makeErrorWithCode('401'))).toBe('http_4xx');
  });

  it('returns network for ECONNREFUSED', () => {
    expect(classifyVigilError(makeNetworkError('ECONNREFUSED'))).toBe('network');
  });

  it('returns network when code is in cause.code', () => {
    const err = new Error('fetch failed');
    (err as unknown as { cause: { code: string } }).cause = { code: 'ECONNRESET' };
    expect(classifyVigilError(err)).toBe('network');
  });

  it('returns network when code is in message', () => {
    const err = new Error('getaddrinfo ENOTFOUND api.vigil.example');
    expect(classifyVigilError(err)).toBe('network');
  });

  it('returns unknown for non-Error', () => {
    expect(classifyVigilError('string')).toBe('unknown');
    expect(classifyVigilError(null)).toBe('unknown');
  });

  it('returns unknown for generic Error', () => {
    expect(classifyVigilError(new Error('unexpected'))).toBe('unknown');
  });
});

describe('connectivity tracker', () => {
  beforeEach(() => {
    resetConnectivityTracker();
  });

  it('returns unknown with no calls', () => {
    expect(getVigilReachabilityStatus()).toBe('unknown');
  });

  it('returns reachable after success', () => {
    recordVigilCallResult(true);
    expect(getVigilReachabilityStatus()).toBe('reachable');
  });

  it('returns unreachable after 5 failures', () => {
    for (let i = 0; i < 5; i++) recordVigilCallResult(false);
    expect(getVigilReachabilityStatus()).toBe('unreachable');
  });

  it('returns reachable with 4 failures and 1 success', () => {
    for (let i = 0; i < 4; i++) recordVigilCallResult(false);
    recordVigilCallResult(true);
    expect(getVigilReachabilityStatus()).toBe('reachable');
  });

  it('evicts oldest beyond window of 5', () => {
    recordVigilCallResult(true);
    for (let i = 0; i < 5; i++) recordVigilCallResult(false);
    // Window now has 5 failures (success evicted)
    expect(getVigilReachabilityStatus()).toBe('unreachable');
  });

  it('returns unknown after reset', () => {
    recordVigilCallResult(true);
    resetConnectivityTracker();
    expect(getVigilReachabilityStatus()).toBe('unknown');
  });
});

describe('validateVigilDecision', () => {
  it('passes through ALLOWED decision', () => {
    const input = { decision: 'ALLOWED', categories: [] };
    expect(validateVigilDecision(input)).toBe(input);
  });

  it('passes through BLOCKED decision', () => {
    const input = { decision: 'BLOCKED', blockMessage: 'nope' };
    expect(validateVigilDecision(input)).toBe(input);
  });

  it('passes through SANITIZED decision', () => {
    const input = { decision: 'SANITIZED', sanitizedText: 'clean' };
    expect(validateVigilDecision(input)).toBe(input);
  });

  it('throws for missing decision', () => {
    expect(() => validateVigilDecision({ categories: [] })).toThrow('Invalid Vigil response');
  });

  it('throws for unexpected decision value', () => {
    expect(() => validateVigilDecision({ decision: 'MAYBE' })).toThrow('Invalid Vigil response');
  });

  it('throws for non-object input', () => {
    expect(() => validateVigilDecision('not an object')).toThrow('Invalid Vigil response');
    expect(() => validateVigilDecision(null)).toThrow('Invalid Vigil response');
    expect(() => validateVigilDecision(42)).toThrow('Invalid Vigil response');
  });

  it('throws for numeric decision', () => {
    expect(() => validateVigilDecision({ decision: 200 })).toThrow('Invalid Vigil response');
  });
});
