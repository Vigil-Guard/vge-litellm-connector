import { describe, it, expect } from 'vitest';
import {
  validateInputType,
  mapInputType,
  extractText,
  buildVigilRequest,
  mapVigilDecision,
} from '../../src/mapping.js';
import type { VigilAnalyzeResponse, LiteLLMGuardrailRequest } from '../../src/mapping.js';

describe('validateInputType', () => {
  it('accepts "request"', () => {
    expect(validateInputType('request')).toBe('request');
  });

  it('accepts "response"', () => {
    expect(validateInputType('response')).toBe('response');
  });

  it('throws on undefined', () => {
    expect(() => validateInputType(undefined)).toThrow('Invalid input_type');
  });

  it('throws on invalid string', () => {
    expect(() => validateInputType('invalid')).toThrow('Invalid input_type');
  });

  it('throws on number', () => {
    expect(() => validateInputType(42)).toThrow('Invalid input_type');
  });
});

describe('mapInputType', () => {
  it('maps request to user_input', () => {
    expect(mapInputType('request')).toBe('user_input');
  });

  it('maps response to model_output', () => {
    expect(mapInputType('response')).toBe('model_output');
  });
});

describe('extractText', () => {
  it('returns null for undefined', () => {
    expect(extractText(undefined)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(extractText([])).toBeNull();
  });

  it('skips whitespace-only strings', () => {
    expect(extractText(['', '  ', '\t'])).toBeNull();
  });

  it('returns first non-empty string', () => {
    expect(extractText(['', '  ', 'hello', 'world'])).toBe('hello');
  });

  it('returns first string when all non-empty', () => {
    expect(extractText(['first', 'second'])).toBe('first');
  });
});

describe('buildVigilRequest', () => {
  it('returns null when texts is undefined', () => {
    const req: LiteLLMGuardrailRequest = { input_type: 'request' };
    expect(buildVigilRequest(req)).toBeNull();
  });

  it('returns null when texts is empty', () => {
    const req: LiteLLMGuardrailRequest = { input_type: 'request', texts: [] };
    expect(buildVigilRequest(req)).toBeNull();
  });

  it('returns null when all texts are whitespace', () => {
    const req: LiteLLMGuardrailRequest = { input_type: 'request', texts: ['  ', ''] };
    expect(buildVigilRequest(req)).toBeNull();
  });

  it('builds request with trace metadata', () => {
    const req: LiteLLMGuardrailRequest = {
      input_type: 'request',
      texts: ['test prompt'],
      litellm_trace_id: 'trace-123',
      litellm_call_id: 'call-456',
    };
    expect(buildVigilRequest(req)).toEqual({
      text: 'test prompt',
      source: 'user_input',
      mode: 'full',
      metadata: { litellmTraceId: 'trace-123', litellmCallId: 'call-456' },
    });
  });

  it('omits metadata when no trace IDs', () => {
    const req: LiteLLMGuardrailRequest = {
      input_type: 'response',
      texts: ['model output'],
    };
    const result = buildVigilRequest(req);
    expect(result?.metadata).toBeUndefined();
    expect(result?.source).toBe('model_output');
  });

  it('maps response input_type to model_output source', () => {
    const req: LiteLLMGuardrailRequest = {
      input_type: 'response',
      texts: ['some text'],
    };
    expect(buildVigilRequest(req)?.source).toBe('model_output');
  });
});

describe('mapVigilDecision', () => {
  const originalText = 'original user text';

  it('maps ALLOWED to NONE', () => {
    const vigil: VigilAnalyzeResponse = { decision: 'ALLOWED' };
    expect(mapVigilDecision(vigil, originalText)).toEqual({ action: 'NONE' });
  });

  it('maps BLOCKED with blockMessage (priority 1)', () => {
    const vigil: VigilAnalyzeResponse = {
      decision: 'BLOCKED',
      blockMessage: 'Injection detected',
      decisionReason: 'some reason',
      categories: ['PROMPT_INJECTION'],
    };
    expect(mapVigilDecision(vigil, originalText)).toEqual({
      action: 'BLOCKED',
      blocked_reason: 'Injection detected',
    });
  });

  it('maps BLOCKED with decisionReason (priority 2)', () => {
    const vigil: VigilAnalyzeResponse = {
      decision: 'BLOCKED',
      decisionReason: 'High threat score',
      categories: ['PII'],
    };
    expect(mapVigilDecision(vigil, originalText)).toEqual({
      action: 'BLOCKED',
      blocked_reason: 'High threat score',
    });
  });

  it('maps BLOCKED with categories (priority 3)', () => {
    const vigil: VigilAnalyzeResponse = {
      decision: 'BLOCKED',
      categories: ['PII', 'PROMPT_INJECTION'],
    };
    expect(mapVigilDecision(vigil, originalText)).toEqual({
      action: 'BLOCKED',
      blocked_reason: 'PII, PROMPT_INJECTION',
    });
  });

  it('maps BLOCKED with empty categories to default', () => {
    const vigil: VigilAnalyzeResponse = {
      decision: 'BLOCKED',
      categories: [],
    };
    expect(mapVigilDecision(vigil, originalText)).toEqual({
      action: 'BLOCKED',
      blocked_reason: 'Blocked by policy',
    });
  });

  it('maps BLOCKED with no metadata to default reason', () => {
    const vigil: VigilAnalyzeResponse = { decision: 'BLOCKED' };
    expect(mapVigilDecision(vigil, originalText)).toEqual({
      action: 'BLOCKED',
      blocked_reason: 'Blocked by policy',
    });
  });

  it('maps SANITIZED with sanitizedText (priority 1)', () => {
    const vigil: VigilAnalyzeResponse = {
      decision: 'SANITIZED',
      sanitizedText: 'clean version',
      redactedText: 'redacted version',
      outputText: 'output version',
    };
    expect(mapVigilDecision(vigil, originalText)).toEqual({
      action: 'GUARDRAIL_INTERVENED',
      texts: ['clean version'],
    });
  });

  it('maps SANITIZED with redactedText (priority 2)', () => {
    const vigil: VigilAnalyzeResponse = {
      decision: 'SANITIZED',
      redactedText: '[REDACTED] text',
      outputText: 'output version',
    };
    expect(mapVigilDecision(vigil, originalText)).toEqual({
      action: 'GUARDRAIL_INTERVENED',
      texts: ['[REDACTED] text'],
    });
  });

  it('maps SANITIZED with outputText (priority 3)', () => {
    const vigil: VigilAnalyzeResponse = {
      decision: 'SANITIZED',
      outputText: 'alternative output',
    };
    expect(mapVigilDecision(vigil, originalText)).toEqual({
      action: 'GUARDRAIL_INTERVENED',
      texts: ['alternative output'],
    });
  });

  it('maps SANITIZED with no transformed text to original text', () => {
    const vigil: VigilAnalyzeResponse = { decision: 'SANITIZED' };
    expect(mapVigilDecision(vigil, originalText)).toEqual({
      action: 'GUARDRAIL_INTERVENED',
      texts: ['original user text'],
    });
  });
});
