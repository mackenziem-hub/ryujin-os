/*
 * jules-suggestions.js
 * Pre-populates Jules's coaching feedback as sticky notes on the three
 * follow-up review decks. Loads AFTER presentation.js and calls the
 * RyujinDeckSeedJules hook it exposes.
 *
 * Synthesized from 7 Fathom calls with Jewels Grace, 2026-01-21 to
 * 2026-05-13. Highest-value sources: Apr 16 SMS critique (verbatim "kill
 * just" + "renovation or repair"), Mar 11 10-day sequence map, Apr 23
 * 40-45 day flow + Three E's + cost-of-inaction.
 *
 * Note ids are stable. Editing the text in this file does NOT update
 * existing notes; the user must delete and re-seed (refresh the page).
 * Deleting a Jules note on one device does not block re-seed on another
 * device — that's by design for now.
 */
(function () {
  'use strict';

  var IE = {
    /* IE deck v2 (May 28 2026): all 30+ Jules sticky-note suggestions were applied
       directly to the touch copy. Sticky notes left empty so the deck shows the
       final spec without overlap. Reference reasoning lives in slide 09 (Overview)
       and slide 25 (Open Items). */
    'cover': [
      {
        id: 'jules-ie-v2-applied',
        text: 'IE deck v2 — all Jules suggestions from the May 28 meeting are now baked into the touch copy. 11 touches, 45 days, post-Jules. The other two decks (10CM, Rejuvenation) still carry their Jules sticky notes for Cat to manually apply in GHL.'
      }
    ]
  };

  var INSPECTIONS = {
    't1': [
      {
        id: 'jules-10cm-t1-third-gen',
        text: 'Add the 3rd-generation roofer line. First long-form email is the right place for the authority signal. (Jan 21 + Mar 11 — Rule 13)'
      }
    ],
    't2': [
      {
        id: 'jules-10cm-t2-textbook',
        text: 'TEXTBOOK JULES. Direct binary, forces tag. Best opener in any of the three decks. Keep verbatim. (Apr 16 — Rule 2)'
      }
    ],
    't3': [
      {
        id: 'jules-10cm-t3-no-pressure',
        text: '"No pressure" is borderline (Mac uses it often) but here it\'s earned because the binary in Touch 2 just fired. Keep but watch the count — appears 4x across the three decks. (Rule 1 family)'
      }
    ],
    't5': [
      {
        id: 'jules-10cm-t5-third-gen-lands',
        text: '3rd-generation line lands here naturally. "If anything hit close to home, reply" is direct. KEEP. (Rule 13)'
      }
    ],
    't8': [
      {
        id: 'jules-10cm-t8-ama-invite',
        text: 'Day-5 AMA slot inverted as preset FAQ — good, but add an explicit "reply with whatever else is on your mind" invite alongside the answered questions. (Mar 11 — Rule 3)'
      }
    ],
    't9': [
      {
        id: 'jules-10cm-t9-keep',
        text: 'KEEP VERBATIM. 9-word framework, exact Jules pattern. The single highest-converting line in any of the three sequences. (Rule 3)'
      }
    ],
    't10': [
      {
        id: 'jules-10cm-t10-bridge',
        text: 'KEEP. Names the actual obstacle (timing / price / financing / spouse). Jules\'s Apr 23 bridge-of-trust frame. (Rule 12)'
      }
    ],
    't11': [
      {
        id: 'jules-10cm-t11-no-pressure',
        text: '"No pressure at all" is the same passive AI tell Jules killed Apr 16. Replace with a hard timing frame: "Heading into [storm season]. If you want me to look before then, this week or next works — otherwise I\'ll step back." (Rule 1)'
      }
    ],
    't12': [
      {
        id: 'jules-10cm-t12-ama',
        text: 'Add the AMA before the close: "Before I step back, anything I can answer in one reply?" (Mar 11 — Rule 3)'
      }
    ],
    'signoff': [
      {
        id: 'jules-10cm-gap-cost-of-inaction',
        text: 'GAP: no cost-of-inaction touch. Add at Day 12-13 with NB freeze-thaw + Atlantic Canada double-the-failure-rate frame (already used in Rejuvenation Touch 6 — reuse). (Apr 23 — Rule 6)'
      },
      {
        id: 'jules-10cm-gap-owner-video',
        text: 'GAP: no personalized owner-video after inspection is booked. Tony Robbins / Dean Graciosi pattern. (Apr 23 — Rule 10)'
      }
    ]
  };

  var REJUVENATION = {
    't1': [
      {
        id: 'jules-rejuv-t1-two-sins',
        text: 'TWO JULES SINS: "just reply here" (passive AI tell) and "no pressure, no rush" (negative framing). Rewrite as a direct binary: "Was this for a roof you own now, or one you\'re sizing up? Either way I can point you in the right direction." (Apr 16 — Rules 1+2+14)'
      }
    ],
    't2': [
      {
        id: 'jules-rejuv-t2-third-gen',
        text: 'Add the 3rd-generation roofer line. (Jan 21 + Mar 11 — Rule 13)'
      },
      {
        id: 'jules-rejuv-t2-three-es',
        text: 'STRONG. "If you reply with those, I can tell you in a day or two whether rejuvenation makes sense" — this IS the Educate→Empower→Engage path. (Apr 23 — Rule 5)'
      }
    ],
    't3': [
      {
        id: 'jules-rejuv-t3-keep',
        text: 'KEEP. Direct double-question. Good. (Rule 2)'
      }
    ],
    't4': [
      {
        id: 'jules-rejuv-t4-educate',
        text: 'KEEP. Hits Rule 5 (Educate→Empower→Engage) hard. The 3-factor decision-criteria frame is exactly Jules\'s Mar 11 "what your product is NOT" pattern. (Rule 5)'
      }
    ],
    't5': [
      {
        id: 'jules-rejuv-t5-three-sins',
        text: 'THREE Rule-1 sins in one SMS: "no rush," "just dropping by," "happy to answer anything." Jules Apr 16 verdict on identical phrasing: "very passive way to talk to someone." Rewrite: "What\'s the biggest thing holding you back from booking the spray feasibility look — cost, timing, or you\'re not sure your roof\'s a fit?" (Rule 1+2)'
      }
    ],
    't6': [
      {
        id: 'jules-rejuv-t6-best',
        text: 'BEST EMAIL IN ANY DECK. Educate + local context + cost-of-inaction (freeze-thaw, salt air). Apr 15 "context marketing > content marketing." KEEP VERBATIM. Use this as the template for adding cost-of-inaction touches to IE and 10CM. (Rules 5+6+8)'
      }
    ],
    't7': [
      {
        id: 'jules-rejuv-t7-tag-generator',
        text: 'KEEP. Tag-generating direct question with three buckets. Excellent. (Rule 2)'
      }
    ],
    't8': [
      {
        id: 'jules-rejuv-t8-what-its-not',
        text: 'KEEP. "5 signs you\'re a candidate / 2 signs you\'re not" is Jules\'s Apr 21 "what your product is NOT" frame from the Eileen healthcare scope call. (Rule 5)'
      }
    ],
    't9': [
      {
        id: 'jules-rejuv-t9-just',
        text: 'Drop the "Just" opener. Rewrite: "Sent you a checklist by email — free 45-min inspection is still on the table if you want a definitive yes/no on rejuvenation." (Apr 16 — Rule 1)'
      }
    ],
    't10': [
      {
        id: 'jules-rejuv-t10-best-sms',
        text: 'BEST SMS IN ANY DECK. Jules-grade cost-of-inaction + neighborhood urgency. KEEP VERBATIM. Template for the IE + 10CM additions. (Rules 6+15)'
      }
    ],
    't11': [
      {
        id: 'jules-rejuv-t11-just',
        text: 'Drop "just" from "just text this number." Otherwise the evergreen-reactivation framing is exactly Jules\'s Rule 4 spirit (40-45 day flow + segmented re-engagement). (Apr 16 — Rule 1)'
      }
    ],
    'signoff': [
      {
        id: 'jules-rejuv-gap-motivation',
        text: 'GAP: "What motivated you to call us?" — natural fit in the spray-feasibility confirmation message. (Apr 23 — Rule 11: the eight-figure question)'
      },
      {
        id: 'jules-rejuv-gap-owner-video',
        text: 'GAP: no personalized owner-video after inspection. Tony Robbins / Dean Graciosi pattern. After automation sends the booking confirm, Mac sends a short personalized video naming the recipient. (Apr 23 — Rule 10)'
      },
      {
        id: 'jules-rejuv-strength',
        text: 'STRENGTH: 90-day flow exceeds the 40-45 day floor (Rule 4). This deck is closest to Jules\'s full ideal — preserve as the model when extending IE + 10CM. (Apr 23)'
      }
    ]
  };

  function applyAll() {
    if (typeof window.RyujinDeckSeedJules !== 'function') {
      setTimeout(applyAll, 50);
      return;
    }
    window.RyujinDeckSeedJules('follow-up-instant-estimator', IE);
    window.RyujinDeckSeedJules('follow-up-inspections', INSPECTIONS);
    window.RyujinDeckSeedJules('follow-up-revive-rejuvenation', REJUVENATION);
  }

  applyAll();
})();
