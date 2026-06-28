// Markdown formatter for the Daily Brief.
// Output is plain markdown — works in email (rendered or raw) and Obsidian.

function dollar(n) { return `$${(Math.round(n * 100) / 100).toLocaleString()}`; }
function pct(n) { return `${Math.round(n * 100)}%`; }
function statusEmoji(level) { return level === 'red' ? '🔴' : level === 'yellow' ? '🟡' : '🟢'; }

function formatTime(iso, tz = 'America/Moncton') {
  if (!iso) return 'All day';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
}

function ymd(d) { return d.toISOString().slice(0, 10); }

// Determine overall status: red if any required system is broken or any KPI is red.
function overallStatus({ pulse, systems, reconcile }) {
  if (systems && systems.ok === false) return 'red';
  if (reconcile && reconcile.metaLeads != null && reconcile.gmailFormSubmits != null && !reconcile.agree) return 'red';
  if (pulse && pulse.spendYesterday != null) {
    const target = 90;
    const spend = pulse.spendYesterday;
    if (spend < target * 0.5 || spend > target * 1.5) return 'red';
    if (spend < target * 0.75 || spend > target * 1.25) return 'yellow';
  }
  return 'green';
}

export function buildBriefMarkdown(ctx) {
  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Moncton' });
  const status = overallStatus(ctx);
  const sEmoji = statusEmoji(status);

  const lines = [];
  lines.push(`# Daily Brief — ${dateLabel} · ${sEmoji}`);
  lines.push('');

  // === TODAY ===
  // Calendar = Google events + live GHL bookings (briefing.js merges them). When
  // the Google fetch fails we say so honestly instead of printing "Empty
  // calendar" over a day that may well have a confirmed booking in GHL.
  lines.push('## Today');
  if (ctx.calendar && ctx.calendar.length) {
    for (const e of ctx.calendar.slice(0, 8)) {
      const t = formatTime(e.start);
      const src = e.source === 'GHL' ? ' [GHL]' : '';
      lines.push(`- **${t}** - ${e.summary || '(no title)'}${src}`);
    }
  } else if (ctx.calendarError) {
    lines.push('- Calendar unavailable (Google auth) - check GHL for bookings');
  } else {
    lines.push('- Nothing scheduled');
  }
  lines.push('');

  // Top 3
  lines.push('### Top 3 priorities');
  if (ctx.top3 && ctx.top3.length) {
    ctx.top3.slice(0, 3).forEach((t, i) => {
      lines.push(`${i + 1}. ${t}`);
    });
  } else {
    lines.push('_No carry-forward priorities found in vault or session context._');
  }
  lines.push('');

  // Pending
  const pendingLines = [];
  if (ctx.pendingConvs && ctx.pendingConvs.count > 0) {
    pendingLines.push(`- **${ctx.pendingConvs.count} GHL conversation${ctx.pendingConvs.count > 1 ? 's' : ''} unanswered** (oldest ${ctx.pendingConvs.items?.[0]?.ageHours || '?'}h)`);
    for (const c of (ctx.pendingConvs.items || []).slice(0, 3)) {
      pendingLines.push(`  - ${c.contactName} (${c.ageHours}h ago, ${c.lastMessageType})`);
    }
  }
  if (ctx.unreadEmails && ctx.unreadEmails.count > 0) {
    pendingLines.push(`- **${ctx.unreadEmails.count} important email${ctx.unreadEmails.count > 1 ? 's' : ''} unread**`);
    for (const m of (ctx.unreadEmails.items || []).slice(0, 3)) {
      pendingLines.push(`  - ${m.from}: ${m.subject}`);
    }
  }
  if (pendingLines.length > 0) {
    lines.push('### Pending');
    lines.push(...pendingLines);
    lines.push('');
  }

  // === MARKETING ===
  lines.push('## Marketing');
  if (ctx.pulse) {
    const p = ctx.pulse;
    const spend = p.spendYesterday != null ? dollar(p.spendYesterday) : '—';
    const leads = p.leadsYesterday != null ? p.leadsYesterday : '—';
    const cpl = (p.spendYesterday > 0 && p.leadsYesterday > 0)
      ? dollar(p.spendYesterday / p.leadsYesterday)
      : '—';
    lines.push(`Yesterday   ${spend} spend · ${leads} leads · ${cpl} blended CPL`);
    if (p.roas30d != null) lines.push(`ROAS (30d)  ${p.roas30d}:1`);
    if (p.cac7d != null) lines.push(`CAC (7d)    ${dollar(p.cac7d)}`);
    lines.push('');

    if (p.bySource && p.bySource.length) {
      lines.push('By source         spend / leads / CPL');
      for (const s of p.bySource) {
        const cpl = s.leads > 0 ? dollar(s.spend / s.leads) : '—';
        const flag = s.flag || '🟢';
        lines.push(`  ${s.name.padEnd(15)} ${dollar(s.spend).padStart(7)} / ${String(s.leads).padStart(2)} / ${cpl.padStart(7)}  ${flag}`);
      }
      lines.push('');
    }
  } else {
    lines.push('_Marketing data unavailable._');
    lines.push('');
  }

  // Cross-source check
  if (ctx.reconcile) {
    const r = ctx.reconcile;
    const ok = r.agree;
    lines.push('### Cross-source check');
    lines.push(`Meta API: ${r.metaLeads ?? '?'} · Gmail: ${r.gmailFormSubmits ?? '?'} · GHL: ${r.ghlNewContacts ?? '?'} · IE: ${r.ieSubmissions ?? '?'}`);
    lines.push(ok ? '✓ Sources agree' : '🔴 Sources disagree — investigate tracking');
    if (r.notes && r.notes.length) {
      for (const n of r.notes) lines.push(`_${n}_`);
    }
    lines.push('');
  }

  // === SYSTEMS ===
  lines.push('## Systems');
  if (ctx.systems) {
    const c = ctx.systems.checks || {};
    const fmt = (k, v) => {
      const sym = v.ok ? '✓' : '🔴';
      let detail = '';
      if (k === 'snapshot' && v.ageMinutes != null) detail = `(${v.ageMinutes} min ago)`;
      else if (k === 'metaToken' && v.daysLeft != null) detail = `(${v.daysLeft} days left)`;
      else if (!v.ok && v.error) detail = `(${v.error.slice(0, 40)})`;
      return `  ${sym} ${k} ${detail}`;
    };
    for (const [k, v] of Object.entries(c)) lines.push(fmt(k, v));
  } else {
    lines.push('_Systems check unavailable._');
  }
  lines.push('');

  // === PIPELINE ===
  lines.push('## Pipeline');
  if (ctx.pipeline) {
    lines.push(`${ctx.pipeline.drafts ?? '?'} drafts · ${ctx.pipeline.quoteSent ?? '?'} Quote Sent (${dollar(ctx.pipeline.quoteSentValue || 0)}) · ${ctx.pipeline.accepted ?? '?'} accepted · ${ctx.pipeline.ready ?? '?'} ready`);
  }
  if (ctx.newSinceYesterday) lines.push(`New contacts since yesterday: ${ctx.newSinceYesterday}`);
  if (ctx.activeConvs24h != null) lines.push(`Active GHL conversations (24h): ${ctx.activeConvs24h}`);
  lines.push('');

  return { markdown: lines.join('\n'), status, dateLabel, ymdToday: ymd(today) };
}
