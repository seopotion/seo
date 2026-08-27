import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { toStrictJsonSchema } from '../src/json-schema';

const schemaOf = (s: z.ZodType) => toStrictJsonSchema(s, 'test').schema;

describe('toStrictJsonSchema', () => {
  test('names the schema for the provider', () => {
    expect(toStrictJsonSchema(z.object({ a: z.string() }), 'my_shape').name).toBe('my_shape');
  });

  test('requires every property and forbids extras', () => {
    expect(schemaOf(z.object({ a: z.string(), b: z.boolean() }))).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'boolean' } },
      required: ['a', 'b'],
      additionalProperties: false,
    });
  });

  // The regression this whole change exists for: a field the model may omit is
  // a field the model WILL eventually omit.
  test('a defaulted field is still required on the wire', () => {
    const schema = schemaOf(z.object({ target: z.array(z.string()).default([]) }));
    expect(schema.required).toEqual(['target']);
    expect(schema.properties).toEqual({ target: { type: 'array', items: { type: 'string' } } });
  });

  test('an optional field is still required on the wire', () => {
    expect(schemaOf(z.object({ a: z.string(), b: z.string().optional() })).required).toEqual([
      'a',
      'b',
    ]);
  });

  test('strips defaults and validation keywords, keeping structure', () => {
    const schema = schemaOf(
      z.object({ items: z.array(z.string()).max(7).default([]), n: z.number().int() }),
    );
    const json = JSON.stringify(schema);
    expect(json).not.toContain('default');
    expect(json).not.toContain('maxItems');
    expect(json).not.toContain('minimum');
    expect(schema.properties).toEqual({
      items: { type: 'array', items: { type: 'string' } },
      n: { type: 'integer' },
    });
  });

  test('drops the $schema dialect marker', () => {
    expect(Object.keys(schemaOf(z.object({ a: z.string() })))).not.toContain('$schema');
  });

  test('applies strictness to nested objects and array elements', () => {
    const schema = schemaOf(
      z.object({
        cover: z.object({ alt: z.string() }),
        inline: z.array(z.object({ alt: z.string(), heading: z.string().optional() })),
      }),
    );
    expect(schema.properties).toEqual({
      cover: {
        type: 'object',
        properties: { alt: { type: 'string' } },
        required: ['alt'],
        additionalProperties: false,
      },
      inline: {
        type: 'array',
        items: {
          type: 'object',
          properties: { alt: { type: 'string' }, heading: { type: 'string' } },
          required: ['alt', 'heading'],
          additionalProperties: false,
        },
      },
    });
  });

  test('keeps enum members verbatim', () => {
    const schema = schemaOf(z.object({ kind: z.enum(['how_to_guide', 'listicle']) }));
    expect(schema.properties).toEqual({
      kind: { type: 'string', enum: ['how_to_guide', 'listicle'] },
    });
  });

  test('keeps nullable unions', () => {
    const schema = schemaOf(z.object({ index: z.number().int().nullable() }));
    expect(schema.properties).toEqual({
      index: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    });
  });

  // A property literally named "type" or "items" must survive the keyword
  // filter — property names are data, not JSON Schema keywords.
  test('does not mistake property names for keywords', () => {
    const schema = schemaOf(z.object({ type: z.string(), items: z.string() }));
    expect(schema.properties).toEqual({ type: { type: 'string' }, items: { type: 'string' } });
    expect(schema.required).toEqual(['type', 'items']);
  });
});
