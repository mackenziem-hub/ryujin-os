// Ryujin OS — GoHighLevel (LeadConnector) API client
// Uses a Private Integration Token (PIT) scoped to a single subaccount.
// Env vars (set in Vercel):
//   GHL_TOKEN        — pit-... Private Integration Token (full permissions)
//   GHL_LOCATION_ID  — 24-char subaccount id
//   GHL_API_BASE     — optional override (default: https://services.leadconnectorhq.com)

const DEFAULT_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_VERSION = '2021-07-28';

function getConfig(){
  const token = (process.env.GHL_TOKEN || '').trim();
  const locationId = (process.env.GHL_LOCATION_ID || '').trim();
  const base = (process.env.GHL_API_BASE || DEFAULT_BASE).trim();
  if (!token) throw new Error('GHL_TOKEN env var missing');
  if (!locationId) throw new Error('GHL_LOCATION_ID env var missing');
  return { token, locationId, base };
}

async function ghlFetch(path, { method = 'GET', body, query } = {}){
  const { token, base } = getConfig();
  let url = base + path;
  if (query && Object.keys(query).length){
    const qs = new URLSearchParams(query).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: DEFAULT_VERSION,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok){
    const err = new Error(`GHL ${method} ${path} → ${res.status}: ${(data && (data.message || data.error)) || text.slice(0, 300)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ─── Social Planner ───────────────────────────────────────────
export async function listSocialAccounts(){
  const { locationId } = getConfig();
  // GHL returns { accounts: [{ id, platform, name, profilePicture, ... }] } per the public API
  return ghlFetch(`/social-media-posting/${locationId}/accounts`);
}

export async function createSocialPost(post){
  // post shape (per GHL docs):
  // {
  //   accountIds: ['acc_xxx'],           // one account per call for per-platform captions
  //   summary: 'caption text',
  //   media: [{ url, type: 'image'|'video' }],
  //   scheduleDate: '2026-04-24T15:00:00Z',  // ISO 8601 UTC
  //   status: 'scheduled',                    // or 'draft'
  //   type: 'post'
  // }
  const { locationId } = getConfig();
  return ghlFetch(`/social-media-posting/${locationId}/posts`, {
    method: 'POST',
    body: post
  });
}

export async function getSocialPost(postId){
  const { locationId } = getConfig();
  return ghlFetch(`/social-media-posting/${locationId}/posts/${postId}`);
}

export async function deleteSocialPost(postId){
  const { locationId } = getConfig();
  return ghlFetch(`/social-media-posting/${locationId}/posts/${postId}`, { method: 'DELETE' });
}

export async function getLocation(){
  const { locationId } = getConfig();
  return ghlFetch(`/locations/${locationId}`);
}

// Raw escape hatch for endpoints we haven't wrapped yet.
export { ghlFetch };
