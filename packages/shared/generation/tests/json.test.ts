import { describe, expect, test } from 'vitest';
import { parseJsonObject } from '../src/json';

describe('parseJsonObject', () => {
  test('parses raw JSON', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  test('strips a ```json fence', () => {
    expect(parseJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  test('strips a bare ``` fence', () => {
    expect(parseJsonObject('```\n{"a":3}\n```')).toEqual({ a: 3 });
  });
});
