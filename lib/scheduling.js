// Ryujin OS — Marketing post scheduling
//
// Prime-time slots in Atlantic Time. Mac wants fresh content shipped at
// engagement-peak windows for local home services. If a clip is queued
// past the day's last slot, it falls to tomorrow's first slot.
//
// Slots:
//   09:00 AT — morning (GBP + FB peak)
//   13:00 AT — lunchtime (IG + FB)
//   19:00 AT — evening (cross-platform peak)
import { supabaseAdmin } from './supabase.js';

const TIMEZONE = 'America/Moncton';
const PRIME_HOURS = [9, 13, 19];
const MIN_LEAD_MS = 10 * 60 * 1000; // GHL rejects schedules <10 min ahead

// Build a UTC Date that lands at exactly hour:00 in AT for the given y/m/d.
// AT is UTC-3 (ADT) or UTC-4 (AST) depending on date — try both, keep
// whichever round-trips cleanly through the timezone.
function makeAtSlot(year, month, day, hour) {
  for (const offset of [3, 4]) {
    const dt = new Date(Date.UTC(year, month - 1, day, hour + offset, 0, 0));
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', hourCycle: 'h23',
    });
    const parts = {};
    for (const p of fmt.formatToParts(dt)) parts[p.type] = p.value;
    if (+parts.year === year && +parts.month === month && +parts.day === day && +parts.hour === hour) {
      return dt;
    }
  }
  // Fallback: assume ADT (-3); should never hit this for normal dates
  return new Date(Date.UTC(year, month - 1, day, hour + 3, 0, 0));
}

// Returns the next prime-time slot at or after `after + minLead`. Searches
// up to 7 days forward, so a wildly stale reference still yields a slot.
export function nextPrimeSlot(after = new Date(), minLeadMs = MIN_LEAD_MS) {
  const earliest = new Date(after.getTime() + minLeadMs);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  });

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const probe = new Date(earliest.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const parts = {};
    for (const p of fmt.formatToParts(probe)) parts[p.type] = p.value;
    const y = +parts.year, m = +parts.month, d = +parts.day;
    for (const hour of PRIME_HOURS) {
      const slot = makeAtSlot(y, m, d, hour);
      if (slot.getTime() >= earliest.getTime()) return slot;
    }
  }
  // Fallback (should never fire): 24h from now
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

// Returns the next prime slot for a tenant that doesn't collide with an
// already-scheduled clip. Spreads multiple uploads across slots so two
// clips never publish at the same time.
export async function nextOpenSlotForTenant(tenantId) {
  const { data } = await supabaseAdmin
    .from('marketing_clips')
    .select('scheduled_at')
    .eq('tenant_id', tenantId)
    .not('scheduled_at', 'is', null)
    .in('status', ['queued', 'rendering', 'ready', 'scheduled']) // active, not posted/failed
    .order('scheduled_at', { ascending: false })
    .limit(1);

  const latestActive = data?.[0]?.scheduled_at ? new Date(data[0].scheduled_at) : null;
  const now = new Date();

  // Anchor "after" to whichever is later: the latest scheduled clip + 1ms,
  // or now. The +1ms ensures we don't reuse the exact same slot.
  const anchor = (latestActive && latestActive > now)
    ? new Date(latestActive.getTime() + 1)
    : now;

  return nextPrimeSlot(anchor);
}

// Format a slot Date in AT for display, e.g. "Tomorrow 7:00 PM AT"
export function formatSlotForDisplay(slotDate, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hourCycle: 'h12',
  });
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const slotDay = dateFmt.format(slotDate);
  const today = dateFmt.format(now);
  const tomorrow = dateFmt.format(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hourCycle: 'h12',
  }).format(slotDate);

  if (slotDay === today) return `Today ${time} AT`;
  if (slotDay === tomorrow) return `Tomorrow ${time} AT`;
  return fmt.format(slotDate) + ' AT';
}

export const PRIME_SLOTS_AT = PRIME_HOURS;
