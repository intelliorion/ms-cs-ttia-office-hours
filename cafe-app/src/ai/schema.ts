/** A small, local JSON-schema subset: enough to check AI output before anything is saved. */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  enum?: readonly unknown[];
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

export class AiError extends Error {}

const kind = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Returns a list of problems; an empty list means the value matches. */
export function validate(schema: JsonSchema, value: unknown, at = '$'): string[] {
  const errs: string[] = [];
  const t = schema.type;
  if (t) {
    const ok = t === 'integer' ? Number.isInteger(value)
      : t === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : kind(value) === t;
    if (!ok) return [`${at} should be ${t}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at} is not one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${at} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${at} is above ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${at} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${at} is longer than ${schema.maxLength}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${at} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${at} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items!, v, `${at}[${i}]`)));
  }
  if (kind(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in obj)) errs.push(`${at}.${k} is missing`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (sub) errs.push(...validate(sub, v, `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}.${k} is not allowed`);
    }
  }
  return errs;
}

/** The first balanced {...} in the text that parses as JSON, or undefined. */
export function firstJsonObject(text: string): unknown {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return undefined;
}

/** Extracts the first JSON object and checks it, or throws AiError('invalid output: …'). */
export function parseChecked<T>(raw: string, schema: JsonSchema): T {
  const value = firstJsonObject(raw);
  if (value === undefined) throw new AiError('invalid output: no JSON object in the reply');
  const errs = validate(schema, value);
  if (errs.length) throw new AiError(`invalid output: ${errs.slice(0, 3).join('; ')}`);
  return value as T;
}
