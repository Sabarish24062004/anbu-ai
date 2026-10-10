import { useRef } from 'react';

const randomKey = () =>
  `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

/**
 * Returns an Idempotency-Key for a form submission. Re-submitting the same body (for example after
 * a timeout, when the first attempt may have reached the server) reuses the key, so the server
 * applies it once. A changed body gets a new key.
 */
export function useIdempotencyKey() {
  const last = useRef<{ body: string; key: string } | null>(null);
  return (body: unknown): string => {
    const json = JSON.stringify(body);
    if (last.current?.body !== json) last.current = { body: json, key: randomKey() };
    return last.current.key;
  };
}
