/** Errors from the API client. Kept free of React Native imports so it can be unit tested. */
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
