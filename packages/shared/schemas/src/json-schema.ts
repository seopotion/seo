import { z } from 'zod';

/**
 * A JSON Schema an LLM response must conform to. Build it with
 * `toStrictJsonSchema` rather than by hand, so the schema the model is held to
 * and the schema the response is parsed with are the same definition.
 */
export interface LlmResponseSchema {
  /** Identifies the shape in provider logs. */
  name: string;
  /** Strict-mode JSON Schema: every property required, no extras. */
  schema: Record<string, unknown>;
}

/**
 * JSON Schema keywords forwarded to the provider. Structure only — validation
 * keywords (minItems, minimum, pattern, ...) are dropped on purpose: strict-mode
 * support for them varies by provider and endpoint, and a schema an endpoint
 * rejects fails the whole call rather than degrading. The provider guarantees
 * the SHAPE; the Zod schema still validates the semantics after parse.
 */
const STRUCTURAL_KEYWORDS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'items',
  'anyOf',
  'enum',
  'description',
]);

/**
 * Rewrite a JSON Schema node for strict structured outputs: keep structure,
 * require every property, and forbid extras. Forcing `required` is the whole
 * point — an optional property is exactly what lets a model omit a field.
 */
function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [keyword, value] of Object.entries(node as Record<string, unknown>)) {
    if (!STRUCTURAL_KEYWORDS.has(keyword)) continue;
    if (keyword === 'properties') {
      const properties: Record<string, unknown> = {};
      // Recurse into the property SCHEMAS; the keys are user-chosen field names,
      // not keywords, so they must not go through the keyword filter.
      for (const [field, sub] of Object.entries(value as Record<string, unknown>)) {
        properties[field] = strictify(sub);
      }
      out.properties = properties;
    } else if (keyword === 'enum') {
      out.enum = value; // literal values, not sub-schemas
    } else {
      out[keyword] = strictify(value);
    }
  }

  if (out.properties) {
    out.required = Object.keys(out.properties as Record<string, unknown>);
    out.additionalProperties = false;
  }
  return out;
}

/**
 * Derive the wire JSON Schema for a Zod schema, so the model is constrained by
 * the same definition the response is parsed with. `io: 'input'` because the
 * model produces the input to `.parse()` — `.default()` fields still become
 * required, which is what we want: a default is a tolerance for OUR callers,
 * never a licence for the model to omit the field.
 */
export function toStrictJsonSchema(schema: z.ZodType, name: string): LlmResponseSchema {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  return { name, schema: strictify(json) as Record<string, unknown> };
}
