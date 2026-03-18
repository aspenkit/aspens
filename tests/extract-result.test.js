import { describe, it, expect } from 'vitest';
import { extractResultFromStream } from '../src/lib/runner.js';

function line(obj) {
  return JSON.stringify(obj);
}

describe('extractResultFromStream', () => {
  it('extracts text and output_tokens from result event', () => {
    const stream = line({
      type: 'result',
      result: 'Hello world',
      usage: { output_tokens: 42 },
    });
    const { text, usage } = extractResultFromStream(stream);
    expect(text).toBe('Hello world');
    expect(usage.output_tokens).toBe(42);
  });

  it('counts tool_use blocks', () => {
    const stream = [
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: '1', name: 'Read', input: {} },
            { type: 'tool_use', id: '2', name: 'Glob', input: {} },
          ],
        },
      }),
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'some thinking' },
            { type: 'tool_use', id: '3', name: 'Grep', input: {} },
          ],
        },
      }),
      line({ type: 'result', result: 'done', usage: { output_tokens: 10 } }),
    ].join('\n');

    const { usage } = extractResultFromStream(stream);
    expect(usage.tool_uses).toBe(3);
  });

  it('measures tool_result_chars from user events', () => {
    const fileContent = 'x'.repeat(500);
    const stream = [
      line({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', content: fileContent, tool_use_id: '1' },
          ],
        },
      }),
      line({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', content: 'short', tool_use_id: '2' },
          ],
        },
      }),
      line({ type: 'result', result: 'output', usage: { output_tokens: 5 } }),
    ].join('\n');

    const { usage } = extractResultFromStream(stream);
    expect(usage.tool_result_chars).toBe(505);
  });

  it('accumulates text from assistant messages when no result event', () => {
    const stream = [
      line({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'part 1' }] },
      }),
      line({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'part 2' }] },
      }),
    ].join('\n');

    const { text } = extractResultFromStream(stream);
    expect(text).toBe('part 1\npart 2');
  });

  it('ignores non-JSON lines', () => {
    const stream = [
      'not json at all',
      '{"broken json',
      line({ type: 'result', result: 'ok', usage: { output_tokens: 1 } }),
    ].join('\n');

    const { text } = extractResultFromStream(stream);
    expect(text).toBe('ok');
  });

  it('returns zeros for empty stream', () => {
    const { text, usage } = extractResultFromStream('');
    expect(text).toBe('');
    expect(usage.output_tokens).toBe(0);
    expect(usage.tool_uses).toBe(0);
    expect(usage.tool_result_chars).toBe(0);
  });

  it('ignores tool_result blocks with non-string content', () => {
    const stream = [
      line({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', content: { image: 'base64...' }, tool_use_id: '1' },
            { type: 'tool_result', content: 'real text', tool_use_id: '2' },
          ],
        },
      }),
      line({ type: 'result', result: 'done', usage: { output_tokens: 3 } }),
    ].join('\n');

    const { usage } = extractResultFromStream(stream);
    expect(usage.tool_result_chars).toBe(9); // only 'real text'
  });

  it('takes output_tokens from last usage event', () => {
    const stream = [
      line({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] },
        usage: { output_tokens: 5 },
      }),
      line({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'bye' }] },
        usage: { output_tokens: 12 },
      }),
      line({ type: 'result', result: 'final', usage: { output_tokens: 20 } }),
    ].join('\n');

    const { usage } = extractResultFromStream(stream);
    expect(usage.output_tokens).toBe(20);
  });
});
