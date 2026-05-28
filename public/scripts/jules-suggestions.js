/*
 * jules-suggestions.js
 * Pre-populates Jewels's coaching feedback as sticky notes on the three
 * follow-up review decks. Loads AFTER presentation.js and calls the
 * RyujinDeckSeedJewels hook it exposes.
 *
 * Synthesized from 7 Fathom calls with Jewels Grace, 2026-01-21 to
 * 2026-05-13. Highest-value sources: Apr 16 SMS critique (verbatim "kill
 * just" + "renovation or repair"), Mar 11 10-day sequence map, Apr 23
 * 40-45 day flow + Three E's + cost-of-inaction.
 *
 * Note ids are stable. Editing the text in this file does NOT update
 * existing notes; the user must delete and re-seed (refresh the page).
 * Deleting a Jewels note on one device does not block re-seed on another
 * device — that's by design for now.
 */
(function () {
  'use strict';

  var IE = {
    't1': [
      {
        id: 'jules-ie-t1-direct-question',
        text: 'Trails off, no question, no tag-generator. Open with a direct binary: "Was that estimate for now, this spring, or just sizing it up?" Forces a reply and tags the lead. (Apr 16 — Rule 2: lead with a binary)'
      },
      {
        id: 'jules-ie-t1-just',
        text: '"Just wanted to say hey" — drop "just." Jewels Apr 16 verbatim: "You said just a lot in your text...that\'s a very passive way to talk to someone." (Rule 1: kill "just")'
      },
      {
        id: 'revised-ie-t1',
        author: 'revised',
        text: 'REVISED Touch 1 SMS — paste this in GHL:\n\nHey {first_name}, Mackenzie from Plus Ultra Roofing here. Saw you ran a quote on our estimator. Was that for a roof you\'re replacing this season, planning for next spring, or sizing it up for later? Helps me know how to follow up. No wrong answer.\n\nTag reply by bucket (now / spring / future) for downstream segmentation.'
      }
    ],
    't2': [
      {
        id: 'jules-ie-t2-third-gen',
        text: 'Add the 3rd-generation roofer line here — first long-form touch is the load-bearing authority signal slot. (Jan 21 + Mar 11 — Rule 13)'
      },
      {
        id: 'revised-ie-t2',
        author: 'revised',
        text: 'REVISED Touch 2 Email — paste this in GHL:\n\nSubject: Your roof estimate, {first_name}\n\nHey {first_name},\n\nThanks for using our Instant Estimator. Quick context before we get to the number: I\'m Mackenzie, third generation roofing in Moncton. My grandfather started on rooftops in the 60s, my dad ran the trucks, and now it\'s me. So when I look at an estimate, I\'m pulling 40+ years of Atlantic Canada roofs into the read.\n\nBased on what you put in, you\'re looking at somewhere between ${ie_estimate_low} and ${ie_estimate_high} for a {ie_selected_package} package on a {ie_roof_size} roof.\n\nThat\'s a ballpark, not a quote. The real number depends on what we find when we get up there: deck condition, ventilation, flashing, ice and water shield coverage, all the stuff a tape measure on a satellite photo can\'t see.\n\nWhenever you\'re ready, we\'ll come out, walk the roof, take photos, and put a real number in front of you. Inspection is free, takes about 45 minutes, and you walk away with everything in writing.\n\nReply to this email or text me at 506-616-4607 and we\'ll set it up.\n\nMackenzie\nPlus Ultra Roofing'
      }
    ],
    't3': [
      {
        id: 'jules-ie-t3-day2-story',
        text: 'Day 2 is the "why story" slot in Jewels\'s 10-day map, not a value tip. Move ventilation to Day 3 and run a story-based Day 2: "I built this estimator after seeing one too many bad install calls." (Mar 11 — Rule 3)'
      },
      {
        id: 'revised-ie-t3',
        author: 'revised',
        text: 'REVISED — Replace this slide with a NEW Day-2 story email, move the ventilation tip to a NEW Day-3 slot.\n\nNEW Touch 3 Email (Day 2) — Subject: Why I built this estimator\n\nHey {first_name},\n\nQuick story. Reason this estimator exists: I got tired of homeowners telling me they\'d been quoted $14K, $22K, and $9K on the same roof by three contractors in the same week. Half of that spread is honest variation. The other half is contractors using the lack of price transparency as their margin.\n\nSo I built the calculator to put a real range out front. Not perfect, but it gets you to the right zip code on price before anyone walks the roof. That way when the inspection happens, the conversation is "here\'s why the number moved" instead of "here\'s the number, take it or leave it."\n\nIf anything in the range surprised you, hit reply and I\'ll walk through what drives it. Or if you want to schedule the inspection, text me at 506-616-4607.\n\nMackenzie\n\n(The existing ventilation tip becomes the NEW Touch 4 at Day 3.)'
      }
    ],
    't4': [
      {
        id: 'jules-ie-t4-three-sins',
        text: 'Three Jewels sins in one SMS: "just checking in" (passive AI tell), no direct question, double-CTA (questions OR in-person — pick one). Rewrite: "What stopped you from booking the in-person look — the price range, timing, or you\'re still sizing it up?" (Apr 16 — Rules 1+2)'
      },
      {
        id: 'revised-ie-t4',
        author: 'revised',
        text: 'REVISED Touch 4 SMS (originally Touch 5 after the Day-2 story addition above) — paste this in GHL:\n\nHey {first_name}, quick one. What stopped you from booking the in-person look — the price range, the timing, or you\'re still sizing it up? Helps me know how to be useful.\n\nTag reply by obstacle (price / timing / sizing) for downstream segmentation.'
      }
    ],
    't5': [
      {
        id: 'jules-ie-t5-keep',
        text: 'KEEP. Subject is the right shape (Day 6-10 "are you still interested" pattern from Mar 11). Three-bucket body framing is Jewels-aligned. (Rule 3)'
      },
      {
        id: 'revised-ie-t5',
        author: 'revised',
        text: 'REVISED Touch 5 Email — minor cleanup. Two "just"s purged + business line swap:\n\nSubject: Still thinking about your new roof?\n(Was "Still thinking about the roof?" — add "your new" per Jewels @45:07)\n\nBody: change "or just sizing up the future" → "or sizing up the future"\nChange "Just hit reply" → "Hit reply"\nChange 506-540-1052 → 506-616-4607 (business line, not Mac\'s cell)\n\nOtherwise keep as-is.'
      }
    ],
    't6': [
      {
        id: 'jules-ie-t6-reframe',
        text: '"Free Platinum upgrade" reads transactional. Jewels Apr 21 frame: lead with the outcome, not the discount. Try: "A bigger guarantee for you, {first_name}" — reveal the upgrade as the reward. (Rule 14: no negative/transactional framing)'
      },
      {
        id: 'revised-ie-t6',
        author: 'revised',
        text: 'REVISED Touch 6 Email — paste this in GHL:\n\nSubject: A bigger guarantee for you, {first_name}\n(Was "Free Platinum upgrade for {first_name}")\n\nHey {first_name},\n\nIf you\'re still in the market: I\'ve got a slot in the spring schedule, and if you book the inspection in the next 7 days and end up signing for the {ie_selected_package} package, you\'ll walk away with a roof that\'s better built and longer warrantied than what you priced.\n\nFor Standard customers, that means CertainTeed Landmark Pro shingles instead of standard 3-tab, our 25-year workmanship warranty instead of 10, and the upgraded synthetic underlayment. Real upgrades, not cosmetic — the kind that matter when a Nor\'easter hits in February.\n\nIf that\'s the kind of roof you want over your family, reply with a couple of times that work this week and I\'ll send you a confirmation. If you\'re not there yet, no worries either way.\n\nMackenzie\n506-616-4607\n\nGuard logic stays the same (Standard / Platinum / Diamond branches).'
      }
    ],
    't7': [
      {
        id: 'jules-ie-t7-ama',
        text: 'Good guide-tone exit. Add the Day-5 AMA ask before the goodbye: "Before I step back, anything I can answer in one reply?" (Mar 11 — Rule 3)'
      },
      {
        id: 'revised-ie-t7',
        author: 'revised',
        text: 'REVISED Touch 7 Email — move from Day 14 to Day 45 (per Jewels 40-45d floor) + add AMA before close + "just" purge + business line:\n\nSubject: Last note from me, {first_name}\n\nHey {first_name},\n\nThis\'ll be my last note for now. I don\'t want to be the contractor who clutters your inbox.\n\nBefore I step back: anything I could answer in one reply? Pricing, financing, scope, warranty, any of it. If something stopped you from moving forward, even a one-line "the timing isn\'t right" tells me what to do next.\n\nIf not, the door\'s open. Text me at 506-616-4607 or reply to any of these emails and I\'ll pick it back up. We do quality work, we don\'t disappear after the deposit, and we treat your home like it\'s our own.\n\nWhenever you\'re ready.\n\nMackenzie\nPlus Ultra Roofing'
      }
    ],
    'signoff': [
      {
        id: 'jules-ie-gap-tail',
        text: 'GAP: sequence cliff-falls at Day 14. Jewels Apr 23 rule is 40-45 days of flow. Add a Day 21 / Day 30 / Day 45 reactivation tail. Segment by stage so irrelevant messages stop. (Rule 4)'
      },
      {
        id: 'jules-ie-gap-motivation',
        text: 'GAP: missing the eight-figure question. Insert "What motivated you to call us?" at the inspection-confirmation step. (Apr 23 — Rule 11: shifts the dynamic to remind the customer they chose to reach out)'
      },
      {
        id: 'jules-ie-gap-cost-of-inaction',
        text: 'GAP: no cost-of-inaction anywhere. No touch educates on damage escalation, mold, or NB freeze-thaw risk. Borrow from Rejuvenation Touch 6. (Apr 23 — Rule 6)'
      },
      {
        id: 'jules-ie-gap-owner-video',
        text: 'GAP: no personalized owner-video. Tony Robbins / Dean Graciosi pattern. After automation sends, owner sends a short personalized video naming the recipient. (Apr 23 — Rule 10)'
      },
      {
        id: 'revised-ie-new-touch-cost',
        author: 'revised',
        text: 'NEW Touch 8 (Day 14) — Cost-of-inaction Email\n\nSubject: One thing about roofs in NB nobody mentions\n\nHey {first_name},\n\nOne thing worth mentioning if you\'re on the fence:\n\nAtlantic Canada chews through roofs at almost double the national rate. The reason isn\'t shingle quality. It\'s the freeze-thaw cycle. Every time the temp crosses 0°C — which around here happens 80+ times a winter — moisture under the shingles expands and contracts. Each cycle is a tiny crack. A few winters of that and an aging roof tips from "good for another decade" to "leaking by April."\n\nThe cost of waiting isn\'t a higher quote next year. It\'s the deck rebuild that gets added when the leak finds the OSB underneath. We see it every spring. $4K to $8K of avoidable damage stacked on top of the roof you were going to replace anyway.\n\nIf your roof is over 15 years old, the inspection is worth doing this season, even if you\'re not ready to commit on the spot.\n\n{calendar_link}\n\nMackenzie'
      },
      {
        id: 'revised-ie-new-touch-motivation',
        author: 'revised',
        text: 'NEW Touch 9 (Day 21) — Eight-figure motivation SMS\n\nHey {first_name}, can I ask one question — what made you reach out to us originally? Whatever it was, helps me know how to be more useful as we go. Mackenzie'
      },
      {
        id: 'revised-ie-new-touch-video',
        author: 'revised',
        text: 'NEW Touch 10 (Day 30) — Personalized owner-video Email\n\nSubject: Quick video for you, {first_name}\n\nHey {first_name},\n\nRecorded this for you. Quick walk-through of what your estimate range covers, what it doesn\'t, and what I\'d want you to think about before this roof gets another winter.\n\n[VIDEO: Mac records 60-90s · reusable 30s shell + per-lead 30s middle clip · concat via existing in-system pipeline]\n\nNo agenda — figured a real face was worth more than another email.\n\nIf you\'re ready to schedule the look, reply or text 506-616-4607.\n\nMackenzie\n\nBuild note: Cat creates a "ready-for-Mac-video" tag at Day 28, Mac batches video recording on Day 29, automation sends Day 30.'
      },
      {
        id: 'revised-ie-downsell-rejuvenation',
        author: 'revised',
        text: 'NEW WORKFLOW BRANCH — 14+ Day Non-Converter Downsell (per Jewels May 28 IE call @39:09)\n\nAt the end of Touch 7 (Day 14, soft exit currently — moves to Day 45 in revised flow), add a parallel workflow:\n\nIF contact does NOT have tag `ie-booked` by Day 14:\n  1. Apply tag `ie-cold-rejuvenation-downsell-candidate`\n  2. Enroll into existing Revive Rejuvenation 90-day workflow (live at booking.plusultraroofing.com/optin2026 funnel)\n  3. Tag carry-over: contact stays in IE 14-day nurture; downsell sequence runs in parallel for ~14 days then IE exits naturally at Day 45\n\nCat builds this as a separate workflow in GHL.'
      }
    ]
  };

  var INSPECTIONS = {
    't1': [
      {
        id: 'jules-10cm-t1-third-gen',
        text: 'Add the 3rd-generation roofer line. First long-form email is the right place for the authority signal. (Jan 21 + Mar 11 — Rule 13)'
      },
      {
        id: 'revised-10cm-t1',
        author: 'revised',
        text: 'REVISED Touch 1 Email — add 3rd-gen line. Paste:\n\nSubject: Your 10 Costly Mistakes guide, and a quick hello\n\nHey {first_name}, thanks for grabbing the guide.\n\nQuick context: I\'m Mackenzie, third generation roofing in Moncton. My grandfather started on rooftops in the 60s, my dad ran the trucks, now it\'s me. I wrote that guide because 80% of the roofs I see have one of the same 10 install errors. Most homeowners find out the hard way.\n\nQuick welcome video below. The chapters that surprise most homeowners are 4 (10 Questions to Ask Any Contractor) and 10 (Why Workmanship Matters More Than Warranty).\n\n[VIDEO: Thank you for downloading.mp4]\n\nIf anything jumps out at you, hit reply.\n\nMackenzie'
      }
    ],
    't2': [
      {
        id: 'jules-10cm-t2-textbook',
        text: 'TEXTBOOK JEWELS. Direct binary, forces tag. Best opener in any of the three decks. Keep verbatim. (Apr 16 — Rule 2)'
      },
      {
        id: 'revised-10cm-t2',
        author: 'revised',
        text: 'KEEP VERBATIM. Only change: 506-540-1052 → 506-616-4607 (business line, not Mac\'s cell). Body unchanged.'
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
      },
      {
        id: 'revised-10cm-t8',
        author: 'revised',
        text: 'REVISED Touch 8 Email E4 — add AMA invite. Paste:\n\nSubject: Three questions homeowners ask me most often\n\nHey {first_name}, three things I get asked on most inspections:\n\n1. "Can my roof be repaired or does it need full replacement?" Depends on age, material, and what\'s underneath. We always check decking before recommending.\n\n2. "How long should it actually last?" 20 to 25 years for asphalt in Atlantic Canada if installed right. The "right" part is the catch.\n\n3. "What\'s the difference between your warranty and the manufacturer warranty?" Manufacturer covers the shingles. Workmanship warranty covers the install. The install is what fails 80% of the time.\n\nIf you\'ve got a different question I haven\'t answered, hit reply — I\'ll answer it directly. Or happy to walk through any of these in person. Free, 20 minutes.\n\n[BOOKING LINK]\n\nMackenzie'
      }
    ],
    't9': [
      {
        id: 'jules-10cm-t9-keep',
        text: 'KEEP VERBATIM. 9-word framework, exact Jewels pattern. The single highest-converting line in any of the three sequences. (Rule 3)'
      }
    ],
    't10': [
      {
        id: 'jules-10cm-t10-bridge',
        text: 'KEEP. Names the actual obstacle (timing / price / financing / spouse). Jewels\'s Apr 23 bridge-of-trust frame. (Rule 12)'
      }
    ],
    't11': [
      {
        id: 'jules-10cm-t11-no-pressure',
        text: '"No pressure at all" is the same passive AI tell Jewels killed Apr 16. Replace with a hard timing frame: "Heading into [storm season]. If you want me to look before then, this week or next works — otherwise I\'ll step back." (Rule 1)'
      },
      {
        id: 'revised-10cm-t11',
        author: 'revised',
        text: 'REVISED Touch 11 SMS T6 — hard timing replacement. Paste:\n\nHey {first_name}, Mackenzie one more time. Heading into storm season here in NB. If you want me to take a look before then, this week or next works. Otherwise I\'ll step back. Book anytime at plusultraroofing.com.'
      }
    ],
    't12': [
      {
        id: 'jules-10cm-t12-ama',
        text: 'Add the AMA before the close: "Before I step back, anything I can answer in one reply?" (Mar 11 — Rule 3)'
      },
      {
        id: 'revised-10cm-t12',
        author: 'revised',
        text: 'REVISED Touch 12 Email E6 — add AMA before close. Paste:\n\nSubject: Last note from me\n\nHey {first_name}, last note from this thread.\n\nBefore I step back: anything I could answer in one reply? Pricing, scope, contractor questions, any of it. Even a "the timing isn\'t right" tells me what to do next.\n\nIf not, whenever you\'re ready to look at your roof, we\'re here. Save my number, no rush, no follow-ups after this one.\n\nMackenzie'
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
      },
      {
        id: 'revised-10cm-new-touch-cost',
        author: 'revised',
        text: 'NEW Touch (Day 12-13) — Cost-of-inaction email. Insert between current Touch 8 and Touch 9.\n\nSubject: One thing about roofs in NB nobody mentions\n\nHey {first_name},\n\nOne thing worth mentioning if you\'re on the fence:\n\nAtlantic Canada chews through roofs at almost double the national rate. The reason isn\'t shingle quality. It\'s the freeze-thaw cycle. Every time the temp crosses 0°C — which around here happens 80+ times a winter — moisture under the shingles expands and contracts. Each cycle is a tiny crack. A few winters of that and an aging roof tips from "good for another decade" to "leaking by April."\n\nThe cost of waiting isn\'t a higher quote next year. It\'s the deck rebuild that gets added when the leak finds the OSB underneath. We see it every spring. $4K to $8K of avoidable damage.\n\nIf your roof is over 15 years old, the inspection is worth doing this season, even if you\'re not ready to commit on the spot.\n\n[BOOKING LINK]\n\nMackenzie'
      },
      {
        id: 'revised-10cm-new-touch-owner-video',
        author: 'revised',
        text: 'NEW Touch (post-inspection-booked) — Personalized owner-video Email\n\nFires automatically when the lead books the inspection on the GHL calendar widget.\n\nSubject: Quick video before {first_name}\'s inspection\n\nHey {first_name},\n\nRecorded this for you ahead of {appointment_date}. Quick walk-through of what we\'ll look at, what to have ready, and what you\'ll have in writing when we leave.\n\n[VIDEO: Mac records 60-90s · per-booking · reusable shell + personalized intro]\n\nLooking forward to it.\n\nMackenzie\n506-616-4607'
      }
    ]
  };

  var REJUVENATION = {
    't1': [
      {
        id: 'jules-rejuv-t1-two-sins',
        text: 'TWO JEWELS SINS: "just reply here" (passive AI tell) and "no pressure, no rush" (negative framing). Rewrite as a direct binary: "Was this for a roof you own now, or one you\'re sizing up? Either way I can point you in the right direction." (Apr 16 — Rules 1+2+14)'
      },
      {
        id: 'revised-rejuv-t1',
        author: 'revised',
        text: 'REVISED Touch 1 SMS — paste:\n\nHey {first_name}, this is Mackenzie with Plus Ultra Roofing. Saw you grabbed the Roof Rejuvenation PDF. Was that for a roof you own now, or one you\'re sizing up? Either way I can point you toward what makes sense.'
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
      },
      {
        id: 'revised-rejuv-t2',
        author: 'revised',
        text: 'REVISED Touch 2 Email — add 3rd-gen line + business line swap:\n\nSubject: Your Roof Rejuvenation PDF + a quick question\n\nHi {first_name},\n\nThanks for downloading the Plus Ultra Roof Rejuvenation guide. Quick context: I\'m Mackenzie, third generation roofing in Moncton. My grandfather started on rooftops in the 60s — so when I look at a roof, I\'m pulling 40+ years of Atlantic Canada experience into the read.\n\nIf your roof still has good shingles but is starting to look tired (faded color, light granule loss, edges curling), rejuvenation can buy you another 5 to 15 years for a fraction of what a replacement costs. The product we apply is a silica-based treatment called GoNano — developed in Atlantic Canada, featured on Dragon\'s Den, engineered for our climate.\n\nA few quick things that help me figure out if your roof is a candidate:\n\n  1. Roughly how old is it?\n  2. Any active leaks or large patches of missing shingles?\n  3. Are you planning on staying in the home another 5+ years?\n\nIf you reply with those, I can tell you in a day or two whether rejuvenation makes sense, or if a different option fits better. Either way, no obligation.\n\nOr book a free spray feasibility inspection directly:\n\n{calendar_link}\n\nTalk soon,\nMac\nPlus Ultra Roofing\n(506) 616-4607\n\n[Post-booking video placeholder]'
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
        text: 'KEEP. Hits Rule 5 (Educate→Empower→Engage) hard. The 3-factor decision-criteria frame is exactly Jewels\'s Mar 11 "what your product is NOT" pattern. (Rule 5)'
      }
    ],
    't5': [
      {
        id: 'jules-rejuv-t5-three-sins',
        text: 'THREE Rule-1 sins in one SMS: "no rush," "just dropping by," "happy to answer anything." Jewels Apr 16 verdict on identical phrasing: "very passive way to talk to someone." Rewrite: "What\'s the biggest thing holding you back from booking the spray feasibility look — cost, timing, or you\'re not sure your roof\'s a fit?" (Rule 1+2)'
      },
      {
        id: 'revised-rejuv-t5',
        author: 'revised',
        text: 'REVISED Touch 5 SMS — paste:\n\nHey {first_name}, quick one. What\'s the biggest thing holding you back from booking the spray feasibility look — cost, timing, or you\'re not sure your roof\'s a fit? Mackenzie\n\nTag reply by obstacle (cost / timing / fit) for downstream segmentation.'
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
        text: 'KEEP. "5 signs you\'re a candidate / 2 signs you\'re not" is Jewels\'s Apr 21 "what your product is NOT" frame from the Eileen healthcare scope call. (Rule 5)'
      }
    ],
    't9': [
      {
        id: 'jules-rejuv-t9-just',
        text: 'Drop the "Just" opener. Rewrite: "Sent you a checklist by email — free 45-min inspection is still on the table if you want a definitive yes/no on rejuvenation." (Apr 16 — Rule 1)'
      },
      {
        id: 'revised-rejuv-t9',
        author: 'revised',
        text: 'REVISED Touch 9 SMS — paste:\n\nSent you a checklist by email — free 45-min inspection is still on the table if you want a definitive yes/no on rejuvenation.'
      }
    ],
    't10': [
      {
        id: 'jules-rejuv-t10-best-sms',
        text: 'BEST SMS IN ANY DECK. Jewels-grade cost-of-inaction + neighborhood urgency. KEEP VERBATIM. Template for the IE + 10CM additions. (Rules 6+15)'
      }
    ],
    't11': [
      {
        id: 'jules-rejuv-t11-just',
        text: 'Drop "just" from "just text this number." Otherwise the evergreen-reactivation framing is exactly Jewels\'s Rule 4 spirit (40-45 day flow + segmented re-engagement). (Apr 16 — Rule 1)'
      },
      {
        id: 'revised-rejuv-t11',
        author: 'revised',
        text: 'REVISED Touch 11 SMS — paste:\n\nLast note from me, {first_name}. If you ever want to revisit roof rejuvenation, text this number. No expiry, no pressure. Thanks for the look.\n\n(Drops "just" before "text this number" per Jewels Apr 16.)'
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
        text: 'STRENGTH: 90-day flow exceeds the 40-45 day floor (Rule 4). This deck is closest to Jewels\'s full ideal — preserve as the model when extending IE + 10CM. (Apr 23)'
      },
      {
        id: 'revised-rejuv-new-touch-motivation',
        author: 'revised',
        text: 'NEW Touch (booking confirmation) — Eight-figure motivation\n\nFires when the lead books the Spray Feasibility Inspection on Diego\'s calendar widget. Insert into the existing booking-confirm SMS or as a separate touch.\n\nHey {first_name}, looking forward to {appointment_date}. Quick question before we come out: what made you reach out to us originally? Whatever it was, helps me know how to make the visit most useful. Mackenzie'
      },
      {
        id: 'revised-rejuv-new-touch-owner-video',
        author: 'revised',
        text: 'NEW Touch (post-booking confirmation) — Personalized owner-video Email\n\nFires automatically after the lead books. Mac records a short personalized video acknowledging them by name.\n\nSubject: Quick video before {first_name}\'s rejuvenation look\n\nHey {first_name},\n\nRecorded this for you ahead of {appointment_date}. Quick walk-through of what we\'ll spray-test, what to look for in the next 48 hours after we leave, and what your yes/no on rejuvenation will look like in writing.\n\n[VIDEO: Mac records 60-90s · per-booking · reusable shell + named intro]\n\nLooking forward to it.\n\nMac\n506-616-4607'
      }
    ]
  };

  function applyAll() {
    if (typeof window.RyujinDeckSeedJewels !== 'function') {
      setTimeout(applyAll, 50);
      return;
    }
    window.RyujinDeckSeedJewels('follow-up-instant-estimator', IE);
    window.RyujinDeckSeedJewels('follow-up-inspections', INSPECTIONS);
    window.RyujinDeckSeedJewels('follow-up-revive-rejuvenation', REJUVENATION);
  }

  applyAll();
})();
