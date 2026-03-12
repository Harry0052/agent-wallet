import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, z } from 'zod';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class RequestValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'RequestValidationError';
    this.status = status;
  }
}

function flattenZodMessage(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}

function sanitizeString(value: string): string {
  return value.replace(CONTROL_CHARACTER_PATTERN, '').trim();
}

export function sanitizeUserInput<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUserInput(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(input)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) {
      continue;
    }
    output[key] = sanitizeUserInput(item);
  }

  return output as T;
}

async function parseJsonBody(
  request: NextRequest,
  options: {
    allowEmptyBody?: boolean;
  } = {},
): Promise<unknown> {
  const allowEmptyBody = options.allowEmptyBody ?? false;
  const contentType = request.headers.get('content-type')?.toLowerCase() || '';
  const contentLengthRaw = request.headers.get('content-length');
  const contentLength = contentLengthRaw ? Number.parseInt(contentLengthRaw, 10) : 0;
  const hasDeclaredBody = Number.isFinite(contentLength) && contentLength > 0;
  const hasJsonContentType = contentType.includes('application/json') || contentType.includes('+json');

  if (!hasJsonContentType && !allowEmptyBody) {
    throw new RequestValidationError('Expected application/json request body.', 415);
  }

  if (!hasJsonContentType && allowEmptyBody) {
    if (!hasDeclaredBody) {
      return {};
    }
    throw new RequestValidationError('Expected application/json request body.', 415);
  }

  try {
    const parsed = await request.json();
    return sanitizeUserInput(parsed);
  } catch {
    if (allowEmptyBody && !hasDeclaredBody) {
      return {};
    }
    throw new RequestValidationError('Malformed JSON request body.', 400);
  }
}

export async function validateJsonBody<TSchema extends ZodTypeAny>(
  request: NextRequest,
  schema: TSchema,
  options: {
    allowEmptyBody?: boolean;
  } = {},
): Promise<z.infer<TSchema>> {
  const parsedBody = await parseJsonBody(request, options);
  const validated = schema.safeParse(parsedBody);

  if (!validated.success) {
    throw new RequestValidationError(flattenZodMessage(validated.error), 400);
  }

  return validated.data;
}

function searchParamsToObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      const existing = output[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        output[key] = [existing, value];
      }
      continue;
    }

    output[key] = value;
  }

  return output;
}

export function validateSearchParams<TSchema extends ZodTypeAny>(
  searchParams: URLSearchParams,
  schema: TSchema,
): z.infer<TSchema> {
  const raw = searchParamsToObject(searchParams);
  const sanitized = sanitizeUserInput(raw);
  const validated = schema.safeParse(sanitized);

  if (!validated.success) {
    throw new RequestValidationError(flattenZodMessage(validated.error), 400);
  }

  return validated.data;
}

export function toValidationErrorResponse(
  error: unknown,
  fallbackMessage = 'Invalid request.',
): NextResponse | null {
  if (error instanceof RequestValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return NextResponse.json({ ok: false, error: flattenZodMessage(error) }, { status: 400 });
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json({ ok: false, error: 'Malformed JSON request body.' }, { status: 400 });
  }

  if (error instanceof Error && error.message) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: false, error: fallbackMessage }, { status: 400 });
}
