// ────────────────────────────────────────────────────────────────────
// Ryujin Business Manager Simulator — Phase 1 Engine
// Farming Sim meets Telltale. Moral dilemmas, stat consequences,
// character relationships, time progression.
// ────────────────────────────────────────────────────────────────────
(function(){
  const Sim = window.RyujinSim = window.RyujinSim || {};
  const SAVE_KEY = 'ry_sb_sim';

  // ── Initial game state ──
  const INITIAL = () => ({
    slot: 'slot1', slotName: 'First Run',
    day: 1, week: 1, month: 1, year: 1,
    startedAt: Date.now(),
    cash: 12500,
    reputation: 55,
    crew_morale: 65,
    customer_sat: 70,
    pipeline: 42300,
    active_jobs: 1,
    streak: 0,
    relationships: { diego: 62, marcus: 70, kelly: 80, carl: 10 },
    // Skill tree — 4 tracks, 0-3 each. Spend skill_points earned from level-ups / milestones.
    skills: { sales: 0, ops: 0, marketing: 0, finance: 0 },
    skill_points: 0,
    // Achievements (earned ids) + pending toast queue
    achievements: [],
    achievement_queue: [],
    // Week-end summary queue (rendered then cleared)
    week_summaries: [],
    last_week_cash: 12500,
    last_week_rep: 55,
    // Tracking
    events_completed: [],
    event_flags: {},
    game_over: false,
    game_over_reason: null,
    history: []
  });

  // Save slots (3) — each save stored as ry_sb_sim__slot1 / slot2 / slot3
  const slotKey = (slot) => SAVE_KEY + '__' + (slot || 'slot1');
  function save(state){ try { localStorage.setItem(slotKey(state.slot), JSON.stringify(state)); localStorage.setItem(SAVE_KEY + '_active', state.slot); } catch(e){} }
  function load(slot){ try { const r = localStorage.getItem(slotKey(slot || activeSlot())); return r ? JSON.parse(r) : null; } catch(e){ return null; } }
  function activeSlot(){ try { return localStorage.getItem(SAVE_KEY + '_active') || 'slot1'; } catch(e){ return 'slot1'; } }
  function listSlots(){
    const slots = ['slot1','slot2','slot3'];
    return slots.map(s => {
      try {
        const r = localStorage.getItem(slotKey(s));
        if (!r) return { slot: s, empty: true };
        const d = JSON.parse(r);
        return { slot: s, empty: false, name: d.slotName, day: d.day, week: d.week, month: d.month, cash: d.cash, rep: d.reputation, startedAt: d.startedAt };
      } catch(e){ return { slot: s, empty: true }; }
    });
  }

  let state = load() || INITIAL();

  // ── Characters ──
  const CHARACTERS = {
    diego: {
      name: 'Diego Márquez', role: 'Foreman · 8 yrs', tag: 'Loyal · demanding · takes no shit',
      color: '#fb923c', portrait: dragonPortrait('#fb923c', 'D')
    },
    marcus: {
      name: 'Marcus Chen', role: 'Junior installer · 2 yrs', tag: 'Eager · learning · watches everything',
      color: '#22d3ee', portrait: dragonPortrait('#22d3ee', 'M')
    },
    kelly: {
      name: 'Kelly Mazerolle', role: 'Partner · books + family', tag: 'Balances you · your conscience',
      color: '#f472b6', portrait: dragonPortrait('#f472b6', 'K')
    },
    carl: {
      name: 'Carl Dunphy', role: 'Competitor · Quick Roof Co', tag: 'Cheap bids · no warranty · poached your customer',
      color: '#ef4444', portrait: dragonPortrait('#ef4444', 'C')
    }
  };

  function dragonPortrait(color, letter){
    // Procedural SVG circle portrait (upgradeable to real images later)
    return `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g_${letter}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
          <stop offset="40%" stop-color="${color}" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="#030611" stop-opacity="1"/>
        </radialGradient>
      </defs>
      <circle cx="40" cy="40" r="38" fill="url(#g_${letter})" stroke="${color}" stroke-width="1.5"/>
      <text x="40" y="48" text-anchor="middle" font-family="Orbitron, sans-serif" font-weight="900" font-size="28" fill="#fff" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">${letter}</text>
    </svg>`;
  }

  // ── Event library (Telltale-style decision cards) ──
  // Each event = scene + 2-4 choices, each choice shifts stats and may set flags
  const EVENTS = {
    intro_day1: {
      id: 'intro_day1',
      day: 1,
      character: 'kelly',
      title: 'Day 1 · Monday morning',
      scene: 'Kelly slides a mug of coffee across the counter. "First day of a new quarter. 3 active jobs, 6 open leads. Before you fire up the truck — Diego texted. He wants to talk about his pay. Says it\'s important."',
      choices: [
        { text: 'Call him back before heading to the site.', impact: { diego: +4, crew_morale: +3 }, flag: 'talked_to_diego_early', narrative: 'You pick up before you leave. Diego respects that. "Thanks for getting back fast, boss."' },
        { text: 'Handle it on the job site — face to face.', impact: { crew_morale: +2, diego: +2 }, flag: 'diego_onsite', narrative: 'You tell him you\'ll see him at the Faulkner job. He appreciates the face-time.' },
        { text: 'Text him: "After work, I\'m booked today."', impact: { diego: -6, crew_morale: -4 }, flag: 'blew_off_diego', narrative: '"Yeah. Okay." You can hear the pause. That one cost you trust.' }
      ]
    },

    diego_raise: {
      id: 'diego_raise',
      day: 2,
      character: 'diego',
      requires: (s) => !s.event_flags.blew_off_diego, // skip if you blew him off (different branch fires)
      title: 'Day 2 · Diego asks for a raise',
      scene: '"Eight years. I\'ve never asked you for a raise." Diego leans on the tailgate, arms crossed. "Quick Roof is hiring foremen at $42. I\'m at $34. I\'m not bluffing — I need $8 more an hour or my wife\'s telling me to move."',
      choices: [
        { text: 'Give him the full $8. He\'s earned it.', impact: { cash: -6800, diego: +18, crew_morale: +10, reputation: +2 }, flag: 'diego_full_raise', narrative: '"I\'ll never forget this." He grips your shoulder. Crew sees it. Morale ripples up.' },
        { text: 'Meet in the middle — $4 now, $4 at 6 months.', impact: { cash: -3400, diego: +8, crew_morale: +3 }, flag: 'diego_half_raise', narrative: '"Fair. That\'s fair." He nods slow. He\'ll hold you to it.' },
        { text: 'I can\'t. We\'re too tight this quarter.', impact: { diego: -15, crew_morale: -12, reputation: -1 }, flag: 'diego_denied', narrative: '"Right." He walks to the truck. You can already see the job applications opening on his phone.' },
        { text: 'Offer equity — 2% of the company instead of cash.', impact: { diego: +12, crew_morale: +6 }, flag: 'diego_equity', narrative: '"Partner, huh?" He smirks. "I like that better than a raise."' }
      ]
    },

    diego_cold_response: {
      id: 'diego_cold_response',
      day: 2,
      character: 'diego',
      requires: (s) => s.event_flags.blew_off_diego,
      title: 'Day 2 · Diego didn\'t show',
      scene: 'You pull up to the Faulkner site at 7:01. Marcus is alone, unloading. "Diego said he had a doctor\'s appointment. But..." Marcus hesitates. "I saw his truck at Quick Roof\'s office."',
      choices: [
        { text: 'Drive over to Quick Roof right now.', impact: { cash: -200, diego: +3, reputation: -2 }, flag: 'intercepted_diego', narrative: 'You catch him in the parking lot. "Just talking." He looks guilty. You convince him to stay — but the trust is cracked.' },
        { text: 'Call him. Ask if he\'s quitting.', impact: { diego: -4, crew_morale: -3 }, narrative: 'He doesn\'t pick up. Texts back: "I\'ll talk tonight." Uncertain.' },
        { text: 'Say nothing. See what he does.', impact: { diego: -8, crew_morale: -6 }, flag: 'diego_ghosted', narrative: 'He shows up late. No explanation. The distance is growing.' }
      ]
    },

    wren_rot: {
      id: 'wren_rot',
      day: 3,
      character: 'marcus',
      title: 'Day 3 · Hidden rot at Wren\'s',
      scene: 'Marcus calls from the Oakley Wren tear-off. "Boss, the decking under the north valley is shot. Not a little — like, a 12\'x8\' section. Our quote had $1,200 for remediation. Real cost is closer to $3,400. She\'s a widowed pensioner. I told her we\'d call you."',
      choices: [
        { text: 'Charge the real cost. Explain transparently.', impact: { cash: +2200, reputation: +6, customer_sat: +4, marcus: +3 }, narrative: 'She cries a little on the phone. Then thanks you for being honest. "You\'re the first contractor who didn\'t lie to me."' },
        { text: 'Eat the difference. We\'ll absorb it.', impact: { cash: -2200, reputation: +3, customer_sat: +12, crew_morale: +4, marcus: +6, kelly: +5 }, flag: 'wren_absorbed', narrative: 'Kelly side-eyes you when she sees the numbers. But the Wren family will never hire another roofer. Ever.' },
        { text: 'Split it — we eat half, she pays half.', impact: { cash: -1100, reputation: +4, customer_sat: +7, marcus: +2 }, narrative: 'Reasonable. She\'s grateful. Marcus watches how you handled it. He\'s learning.' },
        { text: 'Skip the remediation. Cover it and move on.', impact: { cash: +600, reputation: -8, customer_sat: -10, marcus: -8, crew_morale: -5 }, flag: 'wren_covered_up', narrative: 'Marcus goes quiet. He knows what he saw. You know what you did.' }
      ]
    },

    weather_delay: {
      id: 'weather_delay',
      day: 4,
      character: 'diego',
      title: 'Day 4 · Storm incoming',
      scene: 'Weather app: 80% chance of heavy rain tomorrow afternoon. Faulkner job has the ridge open. "We can push hard today and button it up by 4," Diego says. "Or we stop at 5 normal and tarp. Tarp could fail in that wind."',
      choices: [
        { text: 'Push hard. Button it up today.', impact: { cash: -600, crew_morale: -8, customer_sat: +5, diego: +2 }, narrative: 'You pay overtime. Everyone\'s dog-tired. Roof is sealed by 7pm. Storm hits 4am — no leaks.' },
        { text: 'Normal day + heavy tarping.', impact: { cash: -120, customer_sat: -4 }, narrative: 'You tarp well. Storm rips one corner loose. Minor ceiling stain in the master bedroom. Faulkner isn\'t happy.' },
        { text: 'Tell Faulkner to expect a 1-day delay.', impact: { reputation: -3, customer_sat: -6, diego: +4 }, flag: 'faulkner_delay', narrative: 'He\'s annoyed but understands. Diego respects you for not burning the crew out.' }
      ]
    },

    carl_underbid: {
      id: 'carl_underbid',
      day: 5,
      character: 'carl',
      title: 'Day 5 · Carl strikes again',
      scene: 'APHL\'s Kevin Chase calls. "Hey, heads up — Quick Roof came in at $14K for the Tara Court job. Yours is $19.5K. I know why there\'s a gap, but I have to justify it to my board. Can you match?"',
      choices: [
        { text: 'Hold the price. Send the scope comparison.', impact: { cash: 0, reputation: +6, customer_sat: +3 }, flag: 'held_price', narrative: 'You send a one-pager: what\'s in yours, what\'s missing from Carl\'s. Kevin calls back 20 mins later. "You\'re in. The board saw the difference."' },
        { text: 'Meet him halfway — drop to $17K.', impact: { cash: -2500, reputation: 0, customer_sat: +1 }, narrative: 'Kevin: "Done." You win the job but the margin is tight. Feels ok but you know you left rep on the table.' },
        { text: 'Match Carl at $14K to win the relationship.', impact: { cash: -5500, reputation: -4, crew_morale: -2, customer_sat: -2 }, flag: 'matched_carl', narrative: 'You win the job but you\'ll lose money on it. Diego finds out the margin. "We\'re not Quick Roof. Why are we pricing like them?"' },
        { text: 'Walk away. Not worth it.', impact: { cash: 0, reputation: +2, pipeline: -16200 }, narrative: '"I respect that," Kevin says. "Let\'s work together on the next one." Pipeline drops. So does stress.' }
      ]
    },

    warranty_callback: {
      id: 'warranty_callback',
      day: 6,
      character: 'kelly',
      title: 'Day 6 · Warranty callback',
      scene: 'Kelly hands you a note. "Peter Russell. You did his roof 2.5 years ago. Called saying there\'s a small leak around the chimney. Workmanship guarantee is 5 years. You need to decide fast — he\'s got the Russell extended family coming over for a reunion this weekend."',
      choices: [
        { text: 'Send Diego today. Free. No questions.', impact: { cash: -800, reputation: +10, customer_sat: +8, kelly: +4 }, flag: 'russell_honored', narrative: 'Turned out to be a $40 flashing. Russell reposts the fix on Facebook with a photo. 14 shares in 2 hours.' },
        { text: 'Schedule for next week.', impact: { reputation: -4, customer_sat: -6 }, narrative: 'Russell is polite on the phone. Posts a "meh, OK service" review that weekend. No photo.' },
        { text: 'Charge a small $200 service call.', impact: { cash: +200, reputation: -10, customer_sat: -12, kelly: -8 }, narrative: 'Kelly walks away from the kitchen. "That was a warranty job." Russell never calls you again.' }
      ]
    },

    kelly_dinner: {
      id: 'kelly_dinner',
      week: 1, day: 7,
      character: 'kelly',
      title: 'Day 7 · Sunday dinner',
      scene: 'Kelly: "It\'s Sunday. First full week done. Mom\'s making roast. You coming — or am I telling her you\'re ‘working\' again?"',
      choices: [
        { text: 'I\'m coming. Phone off.', impact: { kelly: +15, crew_morale: +3, reputation: +1 }, flag: 'family_first', narrative: 'You show up 10 minutes early. Her mom hugs you. You sleep better than you have in weeks.' },
        { text: 'I\'ll be there. I just need 1 hour first.', impact: { kelly: +4 }, narrative: 'You slide in at dessert. Kelly\'s warm, but you see it — the flicker. "Next week, phone off."' },
        { text: 'Pipeline review can\'t wait. Tell her I\'m sorry.', impact: { kelly: -12, crew_morale: -4, cash: +400 }, flag: 'skipped_family', narrative: 'Kelly sends the photo of the empty chair. You know you\'ll pay for this in more ways than money.' }
      ]
    },

    // ── WEEK 2 ──
    rafael_inspect: {
      id: 'rafael_inspect', week: 2, day: 1, character: 'kelly',
      title: 'Week 2 · Monday · Rafael calls',
      scene: 'Kelly: "Rafael Nunes — the Shediac referral from Delacroix — just called. He wants an inspection Thursday. His roof is 18 years old, cedar shake. It\'s a 45-minute drive each way. Could be $30K+ if he signs."',
      choices: [
        { text: 'Book Thursday. Clear the morning.', impact: { pipeline: +28000, customer_sat: +2 }, flag: 'nunes_booked', narrative: 'Thursday AM inked. Kelly updates the calendar. You feel good about this one.' },
        { text: 'Send Marcus solo — he\'s ready.', impact: { marcus: +10, pipeline: +22000, crew_morale: +4 }, flag: 'marcus_solo', narrative: '"Really? Me?" Marcus\'s face lights up. "I won\'t let you down."' },
        { text: 'Charge a $150 inspection fee to filter serious buyers.', impact: { reputation: -3, pipeline: +18000 }, narrative: 'Rafael pauses. "Fair enough." Pays the fee. But you sense he\'s already half-decided to shop around.' }
      ]
    },

    hire_va: {
      id: 'hire_va', week: 2, day: 2, character: 'kelly',
      title: 'Week 2 · Tuesday · VA pitch',
      scene: 'Kelly hands you a laptop. "I found a VA in the Philippines. $800/month. Full-time admin — CRM cleanup, proposal follow-ups, GHL workflows. She\'s sharp. Watch this video." She looks hopeful.',
      choices: [
        { text: 'Hire her on a 30-day trial.', impact: { cash: -800, kelly: +8, reputation: +2 }, flag: 'hired_va', narrative: 'Trial starts Monday. Kelly actually exhales for the first time in weeks.' },
        { text: 'Love the idea but let\'s wait one more month.', impact: { kelly: -4 }, narrative: '"Fine." She closes the laptop a little too hard.' },
        { text: 'Let\'s hire someone local instead.', impact: { cash: -2400, kelly: +2, reputation: +4 }, flag: 'local_hire', narrative: 'Kelly respects the thought but says "$2,400/month vs $800? Let\'s prove the role first." You table it.' }
      ]
    },

    rain_day: {
      id: 'rain_day', week: 2, day: 3, character: 'diego',
      title: 'Week 2 · Wednesday · Full rain day',
      scene: '"Radar\'s a wall of green until 4pm." Diego calls. "Nobody can work outside. Do I send the crew home unpaid, pay them to sit, or do we find indoor work?"',
      choices: [
        { text: 'Pay full day. Give them the day off.', impact: { cash: -1400, crew_morale: +12, diego: +6 }, narrative: '"You\'re a good boss." The crew group-chat lights up with thanks.' },
        { text: 'Indoor work — warehouse cleanup, tool inventory.', impact: { cash: -1400, crew_morale: +2, diego: +3 }, narrative: 'Productive-ish day. The warehouse hasn\'t been this organized in a year.' },
        { text: 'Half pay, half day. That\'s the deal.', impact: { cash: -700, crew_morale: -4, diego: -2 }, narrative: '"Cool." The group chat goes silent. You know how these things linger.' }
      ]
    },

    faulkner_surprise: {
      id: 'faulkner_surprise', week: 2, day: 4, character: 'diego',
      title: 'Week 2 · Thursday · Mansard surprise',
      scene: 'Diego on FaceTime from the Faulkner mansard. "Boss — the whole south face is soft. Sheathing is 1-inch OSB from 1989 and it\'s wet. Quote had $0 for mansard repair. Real cost: $6,800 materials + labor. Faulkner\'s a lawyer. He\'ll sue if we just bill it. He\'ll also sue if we leave it."',
      choices: [
        { text: 'Document with photos/video, call Faulkner, ask for a $5K change order.', impact: { cash: +3200, reputation: +8, customer_sat: +3, diego: +6 }, flag: 'faulkner_honest', narrative: 'Detailed report. He reviews, signs. "Appreciate the transparency." Crew gets a bonus. You keep margin.' },
        { text: 'Fix it silently. Eat the cost. Keep the relationship.', impact: { cash: -6800, reputation: +4, customer_sat: +10, kelly: -6, crew_morale: -2 }, flag: 'faulkner_absorbed', narrative: 'Kelly: "We can\'t keep doing this." Faulkner leaves a glowing review. Bank account cries.' },
        { text: 'Fix minimum — spot patches, keep the mansard visually OK.', impact: { cash: -800, reputation: -6, customer_sat: -8 }, flag: 'faulkner_hack', narrative: 'Diego: "Boss, that\'s gonna fail in 3 years." You know he\'s right. You do it anyway.' }
      ]
    },

    marcus_idea: {
      id: 'marcus_idea', week: 2, day: 5, character: 'marcus',
      title: 'Week 2 · Friday · Marcus\'s idea',
      scene: 'Marcus pulls you aside. "Boss — I watched your proposal workflow. I can build a Loom library. 15 videos, one per common objection. Every time Darcy gets stuck, he watches the right video. I\'ll do it on weekends. No charge. I just want to learn the sales side."',
      choices: [
        { text: 'Say yes, pay him $40/video.', impact: { cash: -600, marcus: +15, reputation: +2, skills: 'sales' }, flag: 'marcus_loom', narrative: '"Deal." You pay him for his time. He\'s your most engaged team member by a mile.' },
        { text: 'Yes — unpaid — but give him shadow-the-sales-rep days.', impact: { marcus: +12, reputation: +1 }, narrative: 'He\'s thrilled. Next Tuesday he rides along with Darcy on 3 calls. He\'s a sponge.' },
        { text: 'Not right now — stay in your lane.', impact: { marcus: -10, crew_morale: -3 }, narrative: 'His shoulders drop. "Okay, boss." You watch him walk away. You know that moment might echo.' }
      ]
    },

    // ── WEEK 3 ──
    cold_leads: {
      id: 'cold_leads', week: 3, day: 1, character: 'kelly',
      title: 'Week 3 · Monday · Pipeline review',
      scene: 'Kelly spreads sticky notes across the counter. "68 cold leads from the last 6 months. Quote sent, ghosted. If we reach out — 10% might re-engage. Time cost: 2 full days. What do we do?"',
      choices: [
        { text: 'I\'ll do it — 2 days blocked off. No proposals either.', impact: { pipeline: +38000, reputation: +3, kelly: +4 }, flag: 'worked_cold_list', narrative: '4 replies by end of Tuesday. 2 meaningful. One of them closes next month. That list was gold.' },
        { text: 'Automate it — SMS blast with a CTA.', impact: { cash: -150, pipeline: +12000, reputation: -4 }, narrative: '42% reply with some variation of "unsubscribe." 3 say "re-quote me." Mixed bag.' },
        { text: 'Hand it to Darcy. He eats cold lists for breakfast.', impact: { pipeline: +22000, reputation: +2 }, narrative: 'Darcy calls 20 people day one. 3 serious. He earns his keep.' }
      ]
    },

    fake_review: {
      id: 'fake_review', week: 3, day: 2, character: 'carl',
      title: 'Week 3 · Tuesday · Suspicious review',
      scene: 'Google alerts you: new 1-star review on your page. "Worst roofer in Moncton. Left tools in my yard, never came back." Name you don\'t recognize. Address doesn\'t exist. Profile is 3 days old with only this review.',
      choices: [
        { text: 'Flag to Google as fake. Post a measured public reply.', impact: { reputation: -3, customer_sat: +1 }, flag: 'flagged_review', narrative: 'Google removes it in 6 days. Your professional reply earns you 2 people saying "class act."' },
        { text: 'Counter with a social post: "Competitors are scared."', impact: { reputation: -8, kelly: -4 }, narrative: 'Kelly: "That\'s petty." The post does well but your brand feels smaller for it.' },
        { text: 'Ignore it. Focus on real work.', impact: { reputation: -6 }, narrative: 'Sits at 4.8★ instead of 5.0★. A lead sees it and picks Carl.' }
      ]
    },

    russell_review: {
      id: 'russell_review', week: 3, day: 3, character: 'kelly',
      requires: (s) => s.event_flags.russell_honored,
      title: 'Week 3 · Wednesday · Russell\'s review',
      scene: 'Kelly sets her phone in front of you. "Peter Russell posted. Read it."',
      choices: [
        { text: 'Read it.', impact: { reputation: +12, customer_sat: +8, kelly: +4 }, flag: 'viral_review', narrative: '"Plus Ultra came back after 2.5 years. Fixed a warranty issue FREE. Didn\'t even flinch. You\'ll never regret hiring this family." 47 likes. 14 shares. 3 inbound inquiries within 24h.' },
        { text: 'Wait until later.', impact: { reputation: +8, customer_sat: +4 }, narrative: 'Still viral by evening. Kelly screenshots it and frames it for the office.' }
      ]
    },

    insurance_call: {
      id: 'insurance_call', week: 3, day: 4, character: 'diego',
      title: 'Week 3 · Thursday · Adjuster\'s pressure',
      scene: 'Mira Delacroix\'s insurance adjuster calls. "Your estimate is $26.4K. If you itemize in these specific categories, we can approve $32K. Nobody gets hurt. You give the customer a $2K ‘bonus refund\' afterwards. It\'s how every big outfit plays this."',
      choices: [
        { text: 'Decline. Bill the actual $26.4K.', impact: { cash: 0, reputation: +10, diego: +6, kelly: +6 }, flag: 'declined_inflate', narrative: 'He\'s quiet. "Respect." The honest estimate gets approved within a week.' },
        { text: 'Accept. It\'s how the industry works.', impact: { cash: +3600, reputation: -12, kelly: -15, diego: -8 }, flag: 'inflated_claim', narrative: 'Kelly finds out. She doesn\'t yell. She goes cold — which is worse.' },
        { text: 'Counter-offer: bill $28K honestly, explain the real scope.', impact: { cash: +1200, reputation: +4, kelly: +2 }, narrative: 'Adjuster approves $27.8K. Legit. Honest upside.' }
      ]
    },

    diego_hire: {
      id: 'diego_hire', week: 3, day: 5, character: 'diego',
      title: 'Week 3 · Friday · Diego\'s pick',
      scene: 'Diego: "Tony\'s cousin Isaac — 4 years at a bigger outfit, got laid off. He\'s solid. I can vouch. $24/hr starts Monday if we want him. We need the labor."',
      choices: [
        { text: 'Hire Isaac. Trust Diego\'s word.', impact: { cash: -960, crew_morale: +6, diego: +8, active_jobs: +0 }, flag: 'hired_isaac', narrative: 'Isaac shows up Monday 15 min early with tools in his truck. Diego nods. "Told you."' },
        { text: 'Interview first. Structured questions.', impact: { diego: +2, crew_morale: +2 }, flag: 'interviewed_isaac', narrative: 'Good interview. Technical answers check out. You hire him by Friday.' },
        { text: 'Not yet — we\'re not ready.', impact: { diego: -6, crew_morale: -3 }, narrative: 'Diego: "The right person walks past you once." Isaac gets hired at Carl\'s place within a week.' }
      ]
    },

    marcus_hurt: {
      id: 'marcus_hurt', week: 3, day: 6, character: 'marcus',
      title: 'Week 3 · Saturday · Marcus slips',
      scene: 'Marcus slides 4 feet off a wet valley. Caught by his harness. Bruised ribs, scratched hands. "I\'m fine, boss. I don\'t want to fill out forms. Please." He\'s embarrassed more than hurt.',
      choices: [
        { text: 'Go to the ER. Full report. WCB file.', impact: { cash: -400, reputation: +4, marcus: +4, crew_morale: +4 }, flag: 'marcus_wcb', narrative: 'Paperwork takes 3 hours. He gets 3 days paid rest. Crew sees you did the right thing.' },
        { text: 'Drive him to clinic only. Skip WCB.', impact: { cash: -180, reputation: -4, crew_morale: -3 }, narrative: 'He\'s fine. You\'re gambling that nobody asks questions next audit.' },
        { text: 'He\'s fine. He said so. Back to work Monday.', impact: { marcus: -12, crew_morale: -8, reputation: -6 }, flag: 'marcus_neglected', narrative: 'Monday, he\'s stiff. Quiet. Diego pulls you aside: "You fucked that one, boss."' }
      ]
    },

    // ── WEEK 4 ──
    big_close: {
      id: 'big_close', week: 4, day: 1, character: 'kelly',
      requires: (s) => s.pipeline >= 30000,
      title: 'Week 4 · Monday · Big close',
      scene: 'Kelly: "Nunes is signing. $34K contract. First deposit $10K on signature. Just need your final sign-off to send the contract."',
      choices: [
        { text: 'Send it. Big win.', impact: { cash: +10000, pipeline: -34000, reputation: +5, customer_sat: +3, active_jobs: +1 }, flag: 'nunes_closed', narrative: 'Signed in 20 minutes. "Let\'s build something beautiful." Deposit clears Wednesday.' },
        { text: 'Review the contract one more time. Catch a typo.', impact: { cash: +10000, pipeline: -34000, reputation: +6, active_jobs: +1 }, narrative: 'Found a date error. Fixed. Sent. Signed. Reviewed = professional. He comments on it.' }
      ]
    },

    material_shortage: {
      id: 'material_shortage', week: 4, day: 2, character: 'diego',
      title: 'Week 4 · Tuesday · Supply shock',
      scene: '"Architectural shingles are back-ordered 3 weeks at your usual supplier. I called around — Sterling has them but at $128/sq instead of $96/sq. Extra ~$2,500 across 3 jobs. Or we wait and blow our timelines."',
      choices: [
        { text: 'Eat the extra cost. Keep timelines.', impact: { cash: -2500, reputation: +4, customer_sat: +4 }, narrative: 'Jobs ship on time. Customers never know. Margin takes the hit.' },
        { text: 'Call customers. Offer a 2-week push or the material upgrade.', impact: { cash: -1200, reputation: +6, customer_sat: +2 }, narrative: '2 customers accept the wait. 1 pays the upgrade. Compromise works.' },
        { text: 'Switch to Sterling fully — build the relationship for next time.', impact: { cash: -2500, reputation: +2 }, flag: 'sterling_supplier', narrative: 'Sterling gives you a rep. You get priority allocation next crunch.' }
      ]
    },

    pendergrass_post: {
      id: 'pendergrass_post', week: 4, day: 3, character: 'kelly',
      title: 'Week 4 · Wednesday · Facebook post',
      scene: 'Ida Pendergrass posts a photo of her finished roof. "I\'ve been putting off this post because I wanted to stress-test the work. Week 3 after install, not a leak, not a creak, not a cleanup. Plus Ultra is the real deal. Tag your roofer." Comments pouring in.',
      choices: [
        { text: 'Comment: "Thank you Ida — team earned it."', impact: { reputation: +8, customer_sat: +5, crew_morale: +4 }, narrative: 'The comment gets 23 likes. 4 DMs follow. 1 books an inspection by Friday.' },
        { text: 'Boost the post with $50 of Facebook spend.', impact: { cash: -50, reputation: +12, pipeline: +8000, kelly: +3 }, narrative: 'Reaches 14,000 people in your service area. 9 inbound inquiries. Worth every penny.' }
      ]
    },

    tax_notice: {
      id: 'tax_notice', week: 4, day: 4, character: 'kelly',
      title: 'Week 4 · Thursday · CRA letter',
      scene: 'Kelly hands you a brown envelope. "CRA is reviewing last year\'s HST. They want documentation within 30 days. Accountant says we\'re probably fine but it\'s 6 hours of prep and he\'ll charge $650."',
      choices: [
        { text: 'Pay the accountant. Be done with it.', impact: { cash: -650, kelly: +3, reputation: +1 }, narrative: 'Submitted in 4 days. CRA closes the file in 3 weeks. Clean.' },
        { text: 'DIY it together — save the $650.', impact: { cash: -120, kelly: -4 }, narrative: '"This is a terrible use of our Saturday." She\'s right. Takes 9 hours. But you learn the process.' },
        { text: 'Delay it — we\'ve got bigger fish.', impact: { cash: 0, kelly: -8, reputation: -3 }, flag: 'tax_delayed', narrative: 'Kelly: "This will come back to bite us." You\'ll find out later if she\'s right.' }
      ]
    },

    marcus_raise: {
      id: 'marcus_raise', week: 4, day: 5, character: 'marcus',
      requires: (s) => s.relationships.marcus >= 75,
      title: 'Week 4 · Friday · Marcus steps up',
      scene: 'Marcus: "Boss — it\'s been a month. I know I haven\'t earned a full raise yet. But I want to ask: what would it take? I want to be the next Diego. I\'m playing the long game. Tell me the map."',
      choices: [
        { text: 'Lay out a clear 6-month path to $26/hr + foreman track.', impact: { marcus: +15, crew_morale: +6, skill_points: +1 }, flag: 'marcus_mentored', narrative: '"That\'s what I needed." He writes it down. Literally, in a notebook. You\'d forgotten what that kind of hunger looked like.' },
        { text: 'Give him $2/hr now as a vote of confidence.', impact: { cash: -340, marcus: +10, crew_morale: +4 }, narrative: 'He\'s genuinely grateful. "Thank you. I\'ll earn it twice over."' },
        { text: 'Tell him to earn it and we\'ll revisit in 3 months.', impact: { marcus: -4 }, narrative: 'He nods. But the spark you saw on Friday dims a little. Worth watching.' }
      ]
    },

    month_end: {
      id: 'month_end', week: 4, day: 7, character: 'kelly',
      title: 'Month 1 · Sunday · The first chapter closes',
      scene: 'Kelly slides a glass of wine across the counter. "First month done. We\'re still standing. Better than that — we\'re better than we were. You did good, boss." She clinks your glass.',
      choices: [
        { text: 'Here\'s to Month 2.', impact: { kelly: +8, crew_morale: +4, reputation: +3, skill_points: +1 }, flag: 'month_1_complete', narrative: 'You earn a skill point. Pick a track to specialize in.' },
        { text: 'Reflect honestly — what did I screw up?', impact: { kelly: +12, reputation: +2, skill_points: +1 }, flag: 'reflected_honestly', narrative: 'You talk until midnight. She reminds you of 3 things you forgot. You\'re a better operator for it.' }
      ]
    },

    // ─────────────────────────────────────────────────────────
    // MONTH 2 — THE PRESSURE COMPOUNDS
    // ─────────────────────────────────────────────────────────

    diego_equity_call: {
      id: 'diego_equity_call', week: 1, day: 2, character: 'diego',
      requires: (s) => s.month === 2 && s.event_flags.diego_equity,
      title: 'Month 2 · Tuesday · Diego calls a partner meeting',
      scene: 'Diego: "Boss — I\'m part-owner now. I\'ve been thinking. We\'re gonna lose Marcus if we don\'t make him foreman material. And Isaac? Great guy, but he\'s already drifting. I want equity in the growth decisions."',
      choices: [
        { text: 'Invite him to a weekly 30-min ownership meeting.', impact: { diego: +10, crew_morale: +5, skill_points: +1 }, flag: 'diego_ownership_table', narrative: 'You formalize the relationship. He starts carrying weight you didn\'t know was on your shoulders.' },
        { text: 'Listen this time but keep final calls with you.', impact: { diego: +2 }, narrative: 'He nods but you see it — the "we\'re supposed to be partners" look. Filed.' },
        { text: '"Equity means a share of the upside, not the steering wheel."', impact: { diego: -12, crew_morale: -4 }, flag: 'diego_silenced', narrative: 'He goes quiet. Works the rest of the day without a word. You just showed him the contract doesn\'t match what you said.' }
      ]
    },

    marcus_foreman_trial: {
      id: 'marcus_foreman_trial', week: 1, day: 3, character: 'marcus',
      requires: (s) => s.month === 2 && s.relationships.marcus >= 75,
      title: 'Month 2 · Wednesday · Marcus runs his first job',
      scene: 'Diego: "Boss — I\'m sending Marcus to lead the Cho reroof alone. Small job, 18 squares, no curveballs. If he nails it, he\'s foreman-track for real. If we hover, he doesn\'t grow. Let him fly?"',
      choices: [
        { text: 'Let him fly. Back off entirely.', impact: { marcus: +12, diego: +6, crew_morale: +5, customer_sat: +3 }, flag: 'marcus_solo_win', narrative: 'He handles a mid-day curveball (bad venting) by calling you for 30 seconds of advice. That\'s the sign. He\'s ready.' },
        { text: 'Send Isaac with him as silent backup.', impact: { marcus: +4, diego: +2 }, narrative: 'Job runs fine. Marcus senses the training wheels. He finishes the day quieter than usual.' },
        { text: 'Not yet — send Diego.', impact: { marcus: -8, diego: -3 }, narrative: 'Marcus\'s face when he hears the decision. Nothing said. But something shifted.' }
      ]
    },

    carl_poach: {
      id: 'carl_poach', week: 1, day: 5, character: 'carl',
      title: 'Month 2 · Friday · Carl calls Diego directly',
      scene: 'Diego forwards you a voicemail. "Hey Diego, Carl Dunphy. Quick Roof. I know what Plus Ultra\'s paying you. I\'ll add $4/hr plus a signing bonus. Think about it." Diego: "I\'m loyal but... you should know. Your call."',
      choices: [
        { text: 'Immediate counter: match + add retention bonus.', impact: { cash: -3200, diego: +14, crew_morale: +8 }, flag: 'beat_carl', narrative: '"I\'m here." He deletes the voicemail in front of you. Something shifted — permanent now.' },
        { text: 'Talk it through. What does he actually want?', impact: { diego: +10, crew_morale: +4 }, flag: 'honest_convo', narrative: '2 hours at the coffee shop. The money wasn\'t actually the point — he wanted security. You gave him a 1-year contract. Solved.' },
        { text: 'Let him decide. Trust him.', impact: { diego: -5, crew_morale: -6 }, narrative: 'He stays. But the fact you didn\'t fight for him eats at him for weeks.' }
      ]
    },

    supplier_backdoor: {
      id: 'supplier_backdoor', week: 2, day: 1, character: 'kelly',
      requires: (s) => s.month === 2,
      title: 'Month 2 · Monday · Supplier kickback offer',
      scene: 'Kelly: "Sterling sales rep pulled me aside. They\'ll give us a 7% volume rebate under the table — not on the invoice — if we commit to $50K in orders this quarter. Not on paper. Cash in hand at the end."',
      choices: [
        { text: 'Decline. On-invoice only.', impact: { kelly: +8, reputation: +4 }, flag: 'clean_books', narrative: 'Kelly relaxes. "I was hoping you\'d say that." She goes back to the numbers. Clean.' },
        { text: 'Accept. That\'s $3.5K free.', impact: { cash: +3500, reputation: -6, kelly: -10 }, flag: 'kickback', narrative: 'Kelly logs it to a "miscellaneous income" line. Her tone is clipped. The trust between you just took an invisible hit.' },
        { text: 'Ask for it on-invoice as a 7% discount instead.', impact: { cash: +3500, kelly: +6, reputation: +3 }, narrative: 'Rep: "Not how we do it, but let me check." Next day: approved on-invoice. Same money, cleaner.' }
      ]
    },

    review_crisis: {
      id: 'review_crisis', week: 2, day: 3, character: 'kelly',
      title: 'Month 2 · Wednesday · Real bad review',
      scene: 'Kelly hands you her phone. 2-star review from real-customer "Harvey G." "Crew was fine but workmanship is sloppy — missed flashing around chimney. Month 3 leak confirmed." Crew is Diego + Isaac. Photos attached. She looks at you: "What do we do?"',
      choices: [
        { text: 'Call Harvey. Schedule today. Fix + refund $500.', impact: { cash: -1200, reputation: +8, customer_sat: +6, diego: +4 }, flag: 'harvey_fixed', narrative: 'Harvey updates his review to 5 stars within 48h. "They made it right immediately. Restored my faith."' },
        { text: 'Fight the review — it\'s workmanship guarantee, schedule when convenient.', impact: { reputation: -10, customer_sat: -8, kelly: -5 }, narrative: 'Harvey doubles down. Posts a detailed response. His thread goes slightly viral among roofers on Reddit.' },
        { text: 'Throw Isaac under the bus publicly — point out he\'s the new hire.', impact: { crew_morale: -20, diego: -15, reputation: -15 }, flag: 'threw_isaac', narrative: 'Isaac quits by noon. Diego walks into your office: "I brought him in. You just threw us both under the bus."' }
      ]
    },

    kelly_opportunity: {
      id: 'kelly_opportunity', week: 2, day: 5, character: 'kelly',
      requires: (s) => s.month === 2,
      title: 'Month 2 · Friday · Kelly\'s pitch',
      scene: 'Kelly: "I want to pitch something. I run the books 15 hours a week. I could run marketing + CRM full-time for the cost of our VA. I\'ll 3x our follow-up rate. I\'d need to quit my nursing job."',
      choices: [
        { text: 'Green light — we need you full-time.', impact: { cash: -4200, kelly: +18, reputation: +6, pipeline: +18000 }, flag: 'kelly_fulltime', narrative: 'She hugs you. Within 3 weeks the pipeline swells. She\'s not just good — she\'s great.' },
        { text: 'Let me think about it over the weekend.', impact: { kelly: +2 }, narrative: 'She nods but her Sunday energy is noticeably lower. She wanted the green light.' },
        { text: 'Too risky right now — stay with nursing, we\'ll revisit in Q3.', impact: { kelly: -12, pipeline: -6000 }, narrative: 'She doesn\'t argue. Just closes the laptop. That evening she doesn\'t ask how work went.' }
      ]
    },

    insurance_referral_ring: {
      id: 'insurance_referral_ring', week: 3, day: 2, character: 'carl',
      title: 'Month 2 · Week 3 · The referral offer',
      scene: 'An insurance restoration "consultant" named Bryce emails you. He has a "quote-sharing network." You submit quotes into a shared platform, and insurance adjusters in the network prefer vetted contractors. It\'s $500/month. Carl Dunphy is a "gold member."',
      choices: [
        { text: 'Pass. Smells like a kickback ring.', impact: { reputation: +6, kelly: +5 }, narrative: 'Bryce pushes back hard on the phone. You hang up. 3 weeks later you see the ring exposed on Reddit.' },
        { text: 'Join as a silver member — see what it is.', impact: { cash: -500, reputation: -4 }, flag: 'bryce_silver', narrative: 'First month of "leads" are all from Bryce\'s network. 2 close but feel tainted. You\'re now on a list.' },
        { text: 'Report Bryce to the Insurance Bureau.', impact: { reputation: +10, pipeline: +8000 }, flag: 'reported_bryce', narrative: 'Bureau opens an investigation 2 months later. Your name gets quoted anonymously in a trade mag. Pipeline uptick from the story.' }
      ]
    },

    crew_expansion: {
      id: 'crew_expansion', week: 3, day: 4, character: 'diego',
      requires: (s) => s.pipeline >= 60000,
      title: 'Month 2 · Week 3 · 2nd crew decision',
      scene: 'Diego: "Pipeline\'s fat. Current crew is maxed out. We can either (a) spin up a 2nd crew, I foreman mine and hire out foreman #2, or (b) subcontract overflow to another shop. Or (c) we cap intake and keep quality tight."',
      choices: [
        { text: 'Build 2nd crew. Hire foreman #2 + 2 installers.', impact: { cash: -4200, active_jobs: +1, crew_morale: +3, skill_points: +1 }, flag: 'two_crews', narrative: 'Week 1 is chaos, week 2 finds rhythm, week 3 you\'re billing double. Diego is stretched.' },
        { text: 'Subcontract overflow to Ryan\'s crew.', impact: { cash: -1200, active_jobs: +1, reputation: -2, customer_sat: -3 }, flag: 'subcontracted', narrative: 'Ryan\'s crew is competent but not yours. 2 quality issues. Margin OK but reputation wobbles.' },
        { text: 'Cap intake. Hold quality. Grow slower.', impact: { pipeline: -15000, reputation: +6, crew_morale: +5, customer_sat: +5 }, flag: 'held_capacity', narrative: 'You turn away 3 jobs with warm handoffs. Your referral rate climbs. Slower, cleaner growth.' }
      ]
    },

    accounting_discovery: {
      id: 'accounting_discovery', week: 3, day: 6, character: 'kelly',
      requires: (s) => s.event_flags.kickback || s.event_flags.tax_delayed,
      title: 'Month 2 · Week 3 · The books don\'t lie',
      scene: 'Kelly: "Our accountant called. He noticed an unexplained $3.5K income line. And that CRA letter you sat on? They sent the follow-up. He wants to talk. In person. Tomorrow."',
      choices: [
        { text: 'Come clean. Tell him everything.', impact: { cash: -1800, reputation: +4, kelly: +10 }, narrative: 'He\'s professional. "I can fix this. It\'ll cost $1,800. Never do it again." He\'s your accountant for life.' },
        { text: 'Spin it. "It was a misunderstanding."', impact: { reputation: -4, kelly: -12 }, flag: 'spun_accountant', narrative: 'He doesn\'t buy it. Quietly starts distancing from your account. You\'ll notice his emails get shorter.' },
        { text: 'Fire him. Find a new accountant.', impact: { cash: -2500, reputation: -8, kelly: -15 }, narrative: 'New accountant will find the same things. You just delayed the reckoning. Kelly: "You\'re handling the next one alone."' }
      ]
    },

    big_bid_moment: {
      id: 'big_bid_moment', week: 4, day: 2, character: 'kelly',
      requires: (s) => s.month === 2 && s.reputation >= 65,
      title: 'Month 2 · Week 4 · APHL invites you in',
      scene: 'Kelly: "Kevin Chase from APHL wants a 10-property portfolio review. Potential $180K over 18 months. He\'s only inviting 2 contractors — you and Carl. Your proposal is due Friday."',
      choices: [
        { text: 'Go in hard. Custom proposal, site visits, personalized video for Kevin.', impact: { cash: -800, pipeline: +180000, reputation: +10, skill_points: +1 }, flag: 'aphl_hard', narrative: 'Kevin: "You\'re the only one who put in the work. You\'re in." Signed 8 of 10 properties at full margin.' },
        { text: 'Standard strong proposal, no fluff.', impact: { pipeline: +120000, reputation: +4 }, narrative: 'You\'re in but at a discounted blanket rate. Safer, less upside.' },
        { text: 'Pass. Capacity is the bottleneck right now.', impact: { reputation: -2, customer_sat: +3 }, flag: 'passed_aphl', narrative: 'Kevin respects it. "Let\'s revisit in Q4." You said no to a pipeline but kept your crew sane.' }
      ]
    },

    month_2_end: {
      id: 'month_2_end', week: 4, day: 7, character: 'kelly',
      requires: (s) => s.month === 2,
      title: 'Month 2 · Sunday · The quarter turns',
      scene: 'Kelly pours two glasses. "Month 2. We\'re bigger. Busier. The decisions are getting heavier." She looks at you. "What\'s the one thing you\'re most proud of this month?"',
      choices: [
        { text: 'The hard calls I didn\'t flinch on.', impact: { kelly: +10, reputation: +4, skill_points: +1 }, flag: 'month_2_complete', narrative: 'Skill point earned. You\'re not the same operator you were 60 days ago.' },
        { text: 'That you\'re still here with me.', impact: { kelly: +20, crew_morale: +2, skill_points: +1 }, flag: 'month_2_heart', narrative: 'She rests her head on your shoulder. "Me too. Month 3 here we come."' },
        { text: 'Honestly? I\'m exhausted.', impact: { kelly: +6, crew_morale: -2, skill_points: +1 }, flag: 'month_2_tired', narrative: 'She nods. "Me too. We need a plan to not die by Year 2."' }
      ]
    }
  };

  // ── ACHIEVEMENTS ──
  const ACHIEVEMENTS = {
    family_first: { id: 'family_first', title: 'Family First', body: 'Prioritized Sunday dinner in Week 1.', test: (s) => s.event_flags.family_first },
    held_the_line: { id: 'held_the_line', title: 'Held the Line', body: 'Refused to match Carl\'s lowball — and still won the job.', test: (s) => s.event_flags.held_price },
    diego_equity: { id: 'diego_equity', title: 'Partner in Crime', body: 'Offered Diego equity instead of a raise.', test: (s) => s.event_flags.diego_equity },
    russell_karma: { id: 'russell_karma', title: 'What Comes Around', body: 'Honored Russell\'s warranty — reaped a viral review.', test: (s) => s.event_flags.viral_review },
    honest_adjuster: { id: 'honest_adjuster', title: 'No Shortcuts', body: 'Refused to inflate the Delacroix insurance claim.', test: (s) => s.event_flags.declined_inflate },
    wren_absorbed: { id: 'wren_absorbed', title: 'Good Neighbor', body: 'Ate the rot cost at Mrs. Wren\'s place.', test: (s) => s.event_flags.wren_absorbed },
    first_month: { id: 'first_month', title: 'Survived Month 1', body: 'Completed your first 28 days in the business.', test: (s) => s.event_flags.month_1_complete },
    full_house: { id: 'full_house', title: 'Full House', body: 'Reached 75+ relationship with every named character.', test: (s) => Object.entries(s.relationships).filter(([k]) => k !== 'carl').every(([,v]) => v >= 75) },
    bankroll: { id: 'bankroll', title: 'Bankroll', body: 'Reached $25K+ cash on hand.', test: (s) => s.cash >= 25000 },
    five_star_ops: { id: 'five_star_ops', title: 'Five-Star Ops', body: 'Customer satisfaction reached 90+.', test: (s) => s.customer_sat >= 90 },
    iron_rep: { id: 'iron_rep', title: 'Iron Reputation', body: 'Reputation reached 85+.', test: (s) => s.reputation >= 85 },
    the_hard_way: { id: 'the_hard_way', title: 'The Hard Way', body: 'Survived a game over. (Yes, it counts.)', test: (s) => s.game_over },
    // Month 2
    beat_carl: { id: 'beat_carl', title: 'Kept Your Best', body: 'Out-bid Carl\'s poach and kept Diego on the crew.', test: (s) => s.event_flags.beat_carl || s.event_flags.honest_convo },
    two_crews: { id: 'two_crews', title: 'Scaled Up', body: 'Launched a second crew. Real operator now.', test: (s) => s.event_flags.two_crews },
    clean_books: { id: 'clean_books', title: 'Clean Books', body: 'Declined a supplier kickback. Kelly noticed.', test: (s) => s.event_flags.clean_books },
    aphl_hard: { id: 'aphl_hard', title: 'Portfolio Play', body: 'Won the APHL 10-property portfolio.', test: (s) => s.event_flags.aphl_hard },
    month_2_done: { id: 'month_2_done', title: 'Q1 Complete', body: 'Survived 60 days of real operator decisions.', test: (s) => s.event_flags.month_2_complete || s.event_flags.month_2_heart || s.event_flags.month_2_tired }
  };

  function checkAchievements(){
    Object.values(ACHIEVEMENTS).forEach(a => {
      if (state.achievements.includes(a.id)) return;
      try {
        if (a.test(state)) {
          state.achievements.push(a.id);
          state.achievement_queue.push(a);
        }
      } catch(e){}
    });
  }

  // ── Event scheduling ──
  function matchesCurrentDay(e){
    // week+day: exact week match. day only: matches whatever week.
    if (e.week !== undefined && e.week !== state.week) return false;
    if (e.day !== undefined && e.day !== state.day) return false;
    // Stat-triggered events (no fixed day/week) — fire when condition true
    if (e.trigger && typeof e.trigger === 'function' && !e.trigger(state)) return false;
    return true;
  }
  function eligibleEvents(){
    return Object.values(EVENTS).filter(e => {
      if (state.events_completed.includes(e.id)) return false;
      if (e.requires && !e.requires(state)) return false;
      if (!matchesCurrentDay(e)) return false;
      return true;
    });
  }
  function pendingEventToday(){ return eligibleEvents()[0] || null; }

  // ── Stat application ──
  function applyImpact(impact, narrative){
    Object.entries(impact || {}).forEach(([k, v]) => {
      if (k === 'cash' || k === 'pipeline' || k === 'active_jobs' || k === 'skill_points') {
        state[k] = (state[k] || 0) + v;
      } else if (k === 'skills') {
        // Special: grant a +1 skill token in a named track
        if (state.skills[v] !== undefined) state.skills[v] = Math.min(3, state.skills[v] + 1);
      } else if (state[k] !== undefined && typeof state[k] === 'number') {
        state[k] = clamp(0, 100, state[k] + v);
      } else if (state.relationships[k] !== undefined) {
        state.relationships[k] = clamp(0, 100, state.relationships[k] + v);
      }
    });
    if (narrative) state.history.push({ at: Date.now(), day: state.day, week: state.week, text: narrative });
    state.history = state.history.slice(-40);
    checkGameOver();
    checkAchievements();
  }
  function clamp(a, b, v){ return Math.max(a, Math.min(b, v)); }

  function checkGameOver(){
    if (state.cash < -5000) { state.game_over = true; state.game_over_reason = 'Bankrupt — ran out of cash.'; }
    if (state.reputation < 10) { state.game_over = true; state.game_over_reason = 'Reputation collapsed. Leads dried up.'; }
    if (state.crew_morale < 10) { state.game_over = true; state.game_over_reason = 'Crew walked off. Diego took Marcus with him.'; }
    if (state.relationships.kelly < 15) { state.game_over = true; state.game_over_reason = 'Kelly filed for separation. Business put on hold.'; }
  }

  // ── Actions ──
  Sim.state = () => state;
  Sim.characters = () => CHARACTERS;
  Sim.events = () => EVENTS;
  Sim.eligibleToday = pendingEventToday;
  Sim.choose = function(eventId, choiceIdx){
    const e = EVENTS[eventId];
    if (!e) return;
    const c = e.choices[choiceIdx];
    if (!c) return;
    applyImpact(c.impact, c.narrative);
    if (c.flag) state.event_flags[c.flag] = true;
    state.events_completed.push(eventId);
    // XP in sandbox
    if (window.RyujinXP) window.RyujinXP.award('Decision made · ' + e.title, 25);
    save(state);
    return { narrative: c.narrative, flags: state.event_flags };
  };

  // Skill perk modifiers — applied to daily economics
  function skillBonus(){
    return {
      cashPerJob: 180 + state.skills.ops * 40,          // Ops makes jobs more efficient
      cashPerRepPoint: 2 + state.skills.marketing * 1,  // Marketing amplifies reputation → cash
      burn: 240 - state.skills.finance * 30,            // Finance reduces daily burn
      salesPipelineBoost: state.skills.sales * 600      // Sales passively grows pipeline
    };
  }

  Sim.advanceDay = function(){
    if (state.game_over) return { blocked: true };
    if (pendingEventToday()) return { blocked: true, reason: 'Unresolved event for today' };
    const bonus = skillBonus();
    state.cash += Math.round((state.active_jobs || 0) * bonus.cashPerJob - bonus.burn);
    state.cash += Math.round((state.reputation - 50) * bonus.cashPerRepPoint);
    state.pipeline += bonus.salesPipelineBoost;
    if (state.cash > state.last_week_cash) state.streak += 1; else state.streak = 0;
    state.day += 1;
    let weekEnded = false;
    if (state.day > 7) {
      state.day = 1; state.week += 1; weekEnded = true;
      const summary = {
        week: state.week - 1,
        cash_delta: state.cash - state.last_week_cash,
        rep_delta: state.reputation - state.last_week_rep,
        end_cash: state.cash,
        end_rep: state.reputation,
        morale: state.crew_morale,
        sat: state.customer_sat,
        closed_events: state.events_completed.length,
        new_achievements: state.achievements.slice(-3)
      };
      state.week_summaries.push(summary);
      state.last_week_cash = state.cash;
      state.last_week_rep = state.reputation;
      // Award XP bonus for completing a week
      if (window.RyujinXP) window.RyujinXP.award('Completed Week ' + summary.week, 100);
    }
    if (state.week > 4) { state.week = 1; state.month += 1; state.skill_points += 1; }
    if (state.month > 12) { state.month = 1; state.year += 1; }
    checkGameOver();
    checkAchievements();
    save(state);
    document.dispatchEvent(new CustomEvent('ryujin-sim-tick', { detail: { state, weekEnded } }));
    return { ok: true, weekEnded };
  };

  // ── Skill tree: spend a skill point ──
  Sim.allocateSkill = function(track){
    if (!state.skills[track] === undefined) return false;
    if (state.skill_points < 1) return false;
    if (state.skills[track] >= 3) return false;
    state.skills[track] += 1;
    state.skill_points -= 1;
    save(state);
    document.dispatchEvent(new CustomEvent('ryujin-sim-skill', { detail: { track, level: state.skills[track] } }));
    return true;
  };

  // ── Achievements queue drain ──
  Sim.drainAchievements = function(){
    const q = state.achievement_queue.slice();
    state.achievement_queue = [];
    save(state);
    return q;
  };
  Sim.achievementsCatalog = () => ACHIEVEMENTS;

  // ── Week summaries drain ──
  Sim.drainWeekSummary = function(){
    const q = state.week_summaries.slice();
    state.week_summaries = [];
    save(state);
    return q;
  };

  // ── Save slot management ──
  Sim.listSlots = listSlots;
  Sim.loadSlot = function(slot){
    const d = load(slot);
    if (!d) { state = INITIAL(); state.slot = slot; save(state); return state; }
    state = d;
    save(state);
    document.dispatchEvent(new CustomEvent('ryujin-sim-load'));
    return state;
  };
  Sim.newGame = function(slot, name){
    state = INITIAL();
    state.slot = slot || 'slot1';
    state.slotName = name || 'New Run';
    save(state);
    document.dispatchEvent(new CustomEvent('ryujin-sim-new'));
    return state;
  };
  Sim.deleteSlot = function(slot){
    try { localStorage.removeItem(slotKey(slot)); } catch(e){}
  };

  Sim.reset = function(){
    state = INITIAL();
    state.slot = activeSlot();
    save(state);
    document.dispatchEvent(new CustomEvent('ryujin-sim-reset'));
  };

  Sim.save = () => save(state);
})();
