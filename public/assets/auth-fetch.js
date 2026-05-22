// Ryujin OS · client-side auth-fetch helper
//
// Centralizes how portal pages send the session token + tenant header.
// Both v1 and v2 pages should import or copy this pattern instead of
// hand-rolling the localStorage read at every fetch site.
//
// Usage:
//
//   import { authHeaders, authFetch, getToken } from '/assets/auth-fetch.js';
//
//   const r = await authFetch('/api/customers');
//   if (r.status === 401) { /* auth-guard.js handles the redirect */ }
//
//   // or, headers-only for fetch calls that need custom shapes:
//   const r = await fetch('/api/files', { method: 'POST', body: fd, headers: authHeaders() });
//
// Tokens live in localStorage.ryujin_token (set by /login.html) and
// sessionStorage as a fallback for "remember me unchecked" flows.

const TOKEN_KEY = 'ryujin_token';
const TENANT_KEY = 'ryujin_tenant';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function getTenantSlug() {
  try {
    const raw = localStorage.getItem(TENANT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.slug || null;
  } catch {
    return null;
  }
}

// Returns a headers object with Authorization + x-tenant-id populated when
// available. Pass `extra` to merge in caller-specific headers (e.g. content-type).
// Null/missing values are omitted so server-side resolveSession() still works
// from the body/query token paths for pages that opt to send token there instead.
export function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const tenant = getTenantSlug();
  if (tenant) headers['x-tenant-id'] = tenant;
  return headers;
}

// Drop-in fetch wrapper that injects the auth headers. Merges any caller
// headers in `init.headers` so explicit content-type or accept overrides
// continue to work.
export async function authFetch(url, init = {}) {
  const merged = {
    ...init,
    headers: authHeaders(init.headers || {})
  };
  return fetch(url, merged);
}
