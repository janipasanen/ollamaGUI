// Structured-output helpers: validate a user-supplied JSON Schema before sending,
// and check a model response against it (lightweight, dependency-free) (#148).

export interface SchemaCheck {
  ok: boolean;
  schema?: any; // undefined = plain "json" mode (no schema)
  error?: string;
}

/** Validate the schema textarea. Empty = plain json mode. Returns the parsed schema or an error. */
export function parseSchemaInput(text: string): SchemaCheck {
  if (!text.trim()) return { ok: true, schema: undefined };
  let schema: any;
  try {
    schema = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON' };
  }
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return { ok: false, error: 'Schema must be a JSON object' };
  }
  return { ok: true, schema };
}

/** Parse text as JSON without throwing. */
export function tryParseJson(text: string): { ok: boolean; value?: any } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Minimal JSON-Schema conformance check (type/required/properties/items). */
export function validateAgainstSchema(value: any, schema: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const typeOf = (v: any): string => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

  const check = (val: any, sch: any, path: string) => {
    if (!sch || typeof sch !== 'object') return;
    if (sch.type) {
      const actual = typeOf(val);
      const ok =
        sch.type === 'integer' ? (typeof val === 'number' && Number.isInteger(val)) :
        sch.type === 'number' ? actual === 'number' :
        sch.type === actual;
      if (!ok) errors.push(`${path || 'value'}: expected ${sch.type}, got ${actual}`);
    }
    if (sch.type === 'object' && val && typeof val === 'object' && !Array.isArray(val)) {
      for (const req of sch.required ?? []) {
        if (!(req in val)) errors.push(`${path || 'value'}: missing required "${req}"`);
      }
      for (const [k, ps] of Object.entries(sch.properties ?? {})) {
        if (k in val) check(val[k], ps, path ? `${path}.${k}` : k);
      }
    }
    if (sch.type === 'array' && Array.isArray(val) && sch.items) {
      val.forEach((item, i) => check(item, sch.items, `${path}[${i}]`));
    }
  };

  check(value, schema, '');
  return { valid: errors.length === 0, errors };
}

/** Classify a response for the UI badge: not-json | valid | invalid (against schema). */
export function classifyResponse(content: string, schema?: any): 'valid' | 'invalid' {
  const parsed = tryParseJson(content);
  if (!parsed.ok) return 'invalid';
  if (!schema) return 'valid'; // plain json mode — valid JSON is enough
  return validateAgainstSchema(parsed.value, schema).valid ? 'valid' : 'invalid';
}
