# Google Ads conversion tracking — verification steps

Closes the hard gate from memory `project_google_ads_strategy_revive_youtube_jun9`:
GTag conversion tracking must be verified firing BEFORE any Google Ads spend.

## What was wired

Two client-side conversion fires were added. Both use the existing Google Ads
conversion action from `deck-marketing-doctrine.html`:

- **Conversion id / label:** `AW-11274084120/2HA3CM_0pbocEJi-8_8p`
- **Action name:** "Inspection Booked" (Submit lead form, Count = One, 30-day window)

| Gate | Surface | Fires on |
|---|---|---|
| 1. IE booking funnel | `public/instant-estimator.html` | Lead submit success (same point as the Meta `fbq('track','Lead')`), POST `/api/leads` |
| 2. Revive booking | `public/rejuvenation-template.html` | "Rejuvenate My Roof" CTA success, POST `/api/rejuvenation-intent` |

Each page now loads the Google Ads global site tag (`gtag.js?id=AW-11274084120`)
in `<head>`, and fires `gtag('event','conversion', { send_to: '...' })` on the
success branch. Every fire is wrapped in try/catch so a blocked loader (ad
blocker, no JS) never breaks the form.

### Note on the order premise

The original order named server endpoints (`/api/portal-bookings` + a "Revive
booking endpoint"). Neither exists, and GTag conversions can only fire
client-side (a server POST cannot fire gtag). The implementable equivalent is
the two client-side success branches above:
- the real lead pipe is POST `/api/leads` from the IE funnel (the destination
  the YouTube/Revive strategy memory names);
- the Revive booking action is POST `/api/rejuvenation-intent` from the CTA.

If server-side measurement is wanted later (offline conversion import / GA4
Measurement Protocol), that is a separate build.

## How Mac verifies (live, in browser)

Do this on prod after Terminal A deploys, before turning on any spend.

### Option A — Google Tag Assistant (recommended)
1. Install the Tag Assistant Companion extension, or use https://tagassistant.google.com.
2. Add domain `ryujin-os.vercel.app` and "Connect" to open the IE in a tagged tab.
3. Open `/instant-estimator.html`, complete the funnel with a test address, and
   submit to the result screen.
4. In Tag Assistant, confirm a **Google Ads: AW-11274084120** tag fired with a
   **conversion** event whose `send_to` matches `AW-11274084120/2HA3CM_0pbocEJi-8_8p`.
5. Repeat on a rejuvenation page (any page cloned from `rejuvenation-template.html`)
   and tap "Rejuvenate My Roof" — confirm the same conversion fires.

### Option B — browser devtools (no extension)
1. Open `/instant-estimator.html`, DevTools → Network, filter `google`.
2. Submit the funnel. Watch for a request to
   `https://www.googleadservices.com/pagead/conversion/11274084120/` (or
   `google.com/pagead/...`) with the conversion label in the payload.
3. Console: `dataLayer` should contain the `['event','conversion', {...}]` push.
4. Repeat on a rejuvenation page CTA.

### Option C — Google Ads UI confirmation (delayed)
- Google Ads → Goals → Conversions → "Inspection Booked": status should move
  from "No recent conversions" / "Inactive" to "Recording conversions" within a
  few hours of the test submits above. This is the definitive "spend is safe"
  signal.

## Spend gate

Per the strategy memory, do NOT start Google Ads spend until the conversion is
confirmed firing in Tag Assistant (Option A) AND the Google Ads UI shows the
"Inspection Booked" action recording (Option C). The Apr 11 run burned $464/30d
at 0 tracked conversions because the pixel was broken; this verification exists
to prevent the repeat.

## Existing per-customer rejuvenation pages

Pages already cloned from the template (e.g. `1833-route-960-revive.html`,
`ranch-road-rejuvenation.html`) were cloned before this tag was added and do not
carry the gtag. They are sent to specific known customers, not paid ad traffic,
so they are out of scope for the spend gate. New clones from
`rejuvenation-template.html` inherit the tag automatically.
