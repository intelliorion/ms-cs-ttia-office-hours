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

export const MAX_RAW = 64 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const shortKey = (k: string) => (k.length > 60 ? `${k.slice(0, 60)}…` : k);

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
    for (const k of schema.required ?? []) if (!Object.hasOwn(obj, k)) errs.push(`${at}.${k} is missing`);
    for (const k of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(k)) { errs.push(`${at}.${shortKey(k)} is not allowed`); continue; }
      const props = schema.properties;
      if (props && Object.hasOwn(props, k)) errs.push(...validate(props[k], obj[k], `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}.${shortKey(k)} is not allowed`);
    }
  }
  return errs;
}

export const MAX_JSON_ATTEMPTS = 64;

/**
 * The first balanced {...} in the text that parses as a JSON object, or undefined.
 * Each candidate start is scanned once, tracking strings, escapes and depth. If the
 * candidate never closes or does not parse, scanning resumes at the character after
 * that candidate's start (never from the beginning). At most MAX_JSON_ATTEMPTS
 * candidates are tried, so the work is bounded by O(n * 64).
 */
export function firstJsonObject(text: string): unknown {
  let from = 0;
  for (let attempt = 0; attempt < MAX_JSON_ATTEMPTS; attempt++) {
    const start = text.indexOf('{', from);
    if (start === -1) return undefined;
    let depth = 0; let inStr = false; let esc = false; let end = -1;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = i; break; }
    }
    if (end !== -1) {
      try {
        const v: unknown = JSON.parse(text.slice(start, end + 1));
        if (v && typeof v === 'object' && !Array.isArray(v)) return v;
      } catch { /* not JSON: try the next candidate */ }
    }
    from = start + 1;
  }
  return undefined;
}

/** Extracts the first JSON object and checks it, or throws AiError('invalid output: …'). */
export function parseChecked<T>(raw: string, schema: JsonSchema): T {
  if (raw.length > MAX_RAW) throw new AiError(`invalid output: the reply is longer than ${MAX_RAW / 1024} KB`);
  const value = firstJsonObject(raw);
  if (value === undefined) throw new AiError('invalid output: no JSON object in the reply');
  const errs = validate(schema, value);
  if (errs.length) throw new AiError(`invalid output: ${errs.slice(0, 3).join('; ')}`);
  return value as T;
}
