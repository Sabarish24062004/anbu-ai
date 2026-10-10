import type { ApiErrorBody } from '@anbu/shared';
import { getApiBaseUrl } from './config';

const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'timeout' | 'http' | 'invalid_response',
    readonly status?: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface RawResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

/** One HTTP round trip with a timeout. Network failures become ApiError; HTTP errors do not. */
export async function sendJson(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body, headers: res.headers };
  } catch (e) {
    if (controller.signal.aborted) throw new ApiError('Request timed out', 'timeout');
    throw new ApiError(e instanceof Error ? e.message : 'Network error', 'network');
  } finally {
    clearTimeout(timer);
  }
}

export function toApiError(res: RawResponse): ApiError {
  const err = (res.body as ApiErrorBody | null)?.error;
  return new ApiError(
    err?.message ?? `HTTP ${res.status}`,
    'http',
    res.status,
    err?.code,
    err?.details,
  );
}
