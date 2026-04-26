# Marketing Clips API — UI Contract

For the Ryujin UI session. Backend: `api/marketing.js`, `api/marketing-render.js`, `lib/marketingRenderer.js`.

## What it does

Mobile-first fire-and-forget flow: user uploads a selfie-style video → backend auto-transcribes (Whisper), flags emphasis keywords (Claude Haiku), silence/reframe/caption-burn with ffmpeg, uploads rendered 9:16 MP4 to Vercel Blob → user reviews on Calendar → scheduled auto-post via GHL Social Planner (push step is stubbed in v1).

## Status lifecycle

```
queued → rendering → ready → scheduled → posted
                         ↘ failed (terminal)
```

Poll `GET /api/marketing?id=X` or the list endpoint; `status` transitions live. No websocket in v1 — polling every 5-10s while status in `queued|rendering` is fine.

## Endpoints

All endpoints require `x-tenant-id` header (e.g. `plus-ultra`).

### GET `/api/marketing`
List clips for tenant.
Query: `?status=ready` (optional)
Returns: `{ clips: MarketingClip[] }`

### GET `/api/marketing?id=CLIP_ID`
Fetch single clip.
Returns: `MarketingClip`

### POST `/api/marketing`
**Multipart form-data.** Creates clip + kicks render. Returns `202` immediately.
Fields:
- `file` — video blob (mp4/mov/webm, max 200MB) — **required**
- `title` — string (defaults to filename)
- `description` — string
- `platforms` — CSV: `"facebook,youtube,gbp"`
- `scheduled_at` — ISO 8601; if omitted, backend computes "next available slot" (latest scheduled + 24h, or now + 1h)
- `hashtags` — CSV: `"roofing,moncton"`
- `created_by` — user UUID (optional)

Returns: `{ clip: MarketingClip }` with `status: "queued"`.

### PUT `/api/marketing`
Edit metadata / reschedule / adjust captions.
Body: `{ id, title?, description?, hashtags?, target_platforms?, scheduled_at?, caption_style?, emphasis_indices? }`
Editable fields: `title`, `description`, `hashtags`, `target_platforms`, `scheduled_at`, `caption_style`, `emphasis_indices`.
Returns: updated `MarketingClip`.

### DELETE `/api/marketing?id=CLIP_ID`
Deletes clip row. (Does NOT clean up Blob files in v1 — manual cleanup if needed.)

### POST `/api/marketing-render?id=CLIP_ID`
Internal — triggered by upload handler. UI should not need to call this directly.
Requires `x-internal-key` header if `INTERNAL_RENDER_KEY` env is set.

### POST `/api/marketing-publish?id=CLIP_ID`
Bridge from `marketing_clips` → `scheduled_posts` (GHL Social Planner). Resolves the clip's `target_platforms` to matching `brand_accounts` rows for the tenant and fans out one scheduled post per account. Promotes clip status `ready → scheduled` on success.
- Requires `x-tenant-id` header.
- Idempotent: returns 409 `skipped` if the clip already has any `scheduled_posts` rows.
- Returns: `{ clip_id, status, scheduled, failed, results: [...] }`.
- Status values: `scheduled` (≥1 fan-out succeeded), `failed` (all failed or no matching accounts), `skipped` (preconditions not met or already published), `error` (unexpected).
- Use this for a UI "Publish now" button. Cron runs the sweep variant automatically (every 10 min, picks up clips whose `scheduled_at` falls within 24h).

## MarketingClip shape

```ts
{
  id: string;                        // uuid
  tenant_id: string;
  created_by: string | null;

  // Source (raw upload)
  source_url: string;                // Vercel Blob
  source_filename: string | null;
  source_mime_type: string | null;
  source_size_bytes: number | null;
  source_duration_seconds: number | null;

  // Rendered output (null until status = 'ready')
  rendered_url: string | null;
  rendered_duration_seconds: number | null;
  thumbnail_url: string | null;

  // Captions
  transcript: {
    text: string;
    words: Array<{ word: string; start: number; end: number }>;
  } | null;
  emphasis_indices: number[];        // indices into transcript.words flagged for brand-color pop
  caption_style: object;             // {} by default; reserved for per-clip overrides

  // Post metadata
  title: string | null;
  description: string | null;
  hashtags: string[];

  // Scheduling
  target_platforms: string[];        // 'facebook' | 'youtube' | 'gbp'
  scheduled_at: string | null;       // ISO 8601
  ghl_post_id: string | null;
  posted_at: string | null;

  // State
  status: 'queued' | 'rendering' | 'ready' | 'scheduled' | 'posted' | 'failed';
  error_message: string | null;

  created_at: string;
  updated_at: string;
}
```

## Brand colors / fonts

Rendered captions use the tenant's `accent_color` from `tenant_settings` (Plus Ultra default: `#FF6B00`). Font: **Montserrat** (see Fonts setup below).

Future: `caption_style` field on a clip lets user override per-clip (color, font size, position). Not implemented in v1 UI.

## Fonts setup (one-time)

Drop `Montserrat-Bold.ttf` (and optionally regular) into:
```
lib/assets/fonts/
```
The renderer passes `fontsdir` to libass. If the folder doesn't exist, captions fall back to a system font and Montserrat will render as libass' default substitution. Functional but not on-brand until the file is in place.

Grab TTF from Google Fonts: https://fonts.google.com/specimen/Montserrat

## UI flow — recommended screens

1. **Upload** (mobile-first full-screen)
   - Big "Pick or record video" drop/button (`<input type="file" accept="video/*" capture="user">`)
   - Title input (pre-fill with filename)
   - Platform toggles (FB / YT / GBP)
   - Schedule: radio — "Next available slot" (default) OR date/time picker
   - Submit → POST multipart → on 202, navigate to Calendar

2. **Calendar** grid
   - By week/month
   - Each clip tile: thumbnail (or placeholder if still `queued`/`rendering`), title, time, status badge
   - Tap → Clip detail

3. **Clip detail**
   - Video preview (`rendered_url` if ready, else `source_url` with "rendering" overlay)
   - Title / description / hashtags editable
   - Platform toggles
   - Reschedule button
   - "Edit captions" → optional: render full transcript with word chips, user can toggle emphasis per word (updates `emphasis_indices` via PUT, then re-renders)
   - Delete button

## Known limitations (v1)

- **Silence trim**: NOT implemented. v1 keeps source timing. Add in v2 with a two-pass ffmpeg approach.
- ~~**GHL schedule push**: stub.~~ Done. `/api/marketing-publish` (manual + cron sweep every 10 min) auto-fans-out ready clips into `scheduled_posts` and posts them to GHL Social Planner. The 15-min `/api/marketing-reconcile` cron then propagates GHL post outcomes back to `marketing_clips.status` (`scheduled → posted` / `failed`).
- **Caption re-render on edit**: editing `emphasis_indices` via PUT saves them but doesn't re-render automatically. Need `POST /api/marketing-render?id=X` to regenerate.
- **Font substitution**: drop Montserrat-Bold.ttf into `lib/assets/fonts/` or captions fall back to system sans.
- **Thumbnail URL** is extracted at 1s mark — fine for most clips; may be a blank frame if user starts mid-transition.

## Env vars required

```
SUPABASE_URL
SUPABASE_SERVICE_KEY
BLOB_READ_WRITE_TOKEN          # @vercel/blob
OPENAI_API_KEY                 # Whisper
ANTHROPIC_API_KEY              # Haiku keyword tagging (optional — falls back to heuristic)
INTERNAL_RENDER_KEY            # optional — guards marketing-render endpoint
```

## Testing without the UI

```bash
# Upload
curl -X POST https://ryujin-os.vercel.app/api/marketing \
  -H "x-tenant-id: plus-ultra" \
  -F "file=@video.mp4" \
  -F "title=Test clip" \
  -F "platforms=facebook,youtube"

# Poll
curl https://ryujin-os.vercel.app/api/marketing?id=CLIP_UUID \
  -H "x-tenant-id: plus-ultra"
```
