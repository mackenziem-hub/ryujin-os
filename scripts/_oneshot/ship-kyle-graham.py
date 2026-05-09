"""One-shot: ship Kyle Graham (67 Fairisle Drive, Moncton) — warm-back lead from Aug 2025.

Customer was originally door-knocked by Darcy in Aug 2025. Got a quote (PDF on file).
Reached back out Apr 28 2026. Already in GHL Darcy's Pipeline at New Lead.
Re-quoting at current SOP + Ryan 2025 sheet to give Mac a fair-price reference for the conversation.
"""
import json, urllib.request, os

BASE = "https://ryujin-os.vercel.app"
TENANT = "plus-ultra"

JOB = {
    "ghl_contact_id": "jmr4ZiHAMjttwZjiBkco",
    "customer": {
        "full_name": "Kyle Graham",
        "phone": "",
        "email": "",
        "address": "67 Fairisle Drive",
        "city": "Moncton",
        "province": "NB",
        "postal_code": "E1G 5J9",
    },
    "measurements": {
        "squareFeet": 2420, "pitch": "4/12", "complexity": "simple",
        "eavesLF": 140, "rakesLF": 135, "ridgesLF": 68,
        "valleysLF": 14, "hipsLF": 0, "wallsLF": 0,
        "pipes": 1, "vents": 0, "chimneys": 0,
        "skylights_install_new": 1, "skylights_reuse": 0,
        "stories": 2, "extraLayers": 0, "distanceKM": 8,
    },
    "footprint_sqft": 2420,
    "notes": (
        "Kyle Graham, 67 Fairisle Drive Moncton. Warm-back lead from Aug 2025. "
        "Originally door-knocked by Darcy. Reached back out Apr 28 2026 — likely ready to make a decision. "
        "25.5 SQ at 3-6/12 walkable pitch, simple. ~140 eaves / 135 rakes / 68 ridge / 14 valleys LF. "
        "1 pipe flashing, 1 skylight (full replacement), no chimney. ~8km from Riverview, Local pricing. "
        "Original Aug 2025 pricing: Gold $14,800 / Platinum $16,157 / Diamond Metal $26,922 (all with HST). "
        "Re-quoted Apr 28 at current SOP + Ryan 2025 rates: Gold $17,020 / Platinum $20,182 / Diamond $30,676 (with HST). "
        "Pricing has risen ~15-25% with material + labor inflation. Mac to decide on honor-old vs quote-current vs split-the-diff before sending."
    ),
    "tags": ["sales_owner:darcy", "moncton", "source:door-knock-followup", "warm-back-lead"],
}


def post_json(path, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE}{path}{'&' if '?' in path else '?'}tenant={TENANT}",
        data=body,
        headers={"Content-Type": "application/json", "x-tenant-id": TENANT},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


print("1/3  Compare quote...")
m = dict(JOB["measurements"])
m["squareFeet"] = JOB["footprint_sqft"]
compare = post_json("/api/quote?mode=compare", {"measurements": m, "choices": {}})
for slug in ("gold", "platinum", "diamond"):
    s = compare["offers"].get(slug, {}).get("summary", {})
    if s:
        print(f"     {slug:9s} ${s.get('sellingPrice', 0):>8,.0f} pre-HST  |  ${s.get('totalWithTax', 0):>8,.0f} w/HST")

print("2/3  Create estimate...")
body = {
    "customer": JOB["customer"],
    "proposal_mode": "Roof Only",
    "pricing_model": "Local",
    "roof_area_sqft": JOB["footprint_sqft"],
    "roof_pitch": JOB["measurements"]["pitch"],
    "complexity": JOB["measurements"]["complexity"],
    "eaves_lf": JOB["measurements"]["eavesLF"],
    "rakes_lf": JOB["measurements"]["rakesLF"],
    "ridges_lf": JOB["measurements"]["ridgesLF"],
    "valleys_lf": JOB["measurements"]["valleysLF"],
    "hips_lf": 0, "walls_lf": 0,
    "pipes": 1, "vents": 0, "chimneys": 0,
    "stories": 2, "extra_layers": 0, "distance_km": 8,
    "calculated_packages": compare["offers"],
    "selected_package": "platinum",
    "status": "draft",
    "notes": [{"author": "claude", "timestamp": "2026-04-28", "note": JOB["notes"]}],
    "tags": JOB["tags"],
    "ghl_contact_id": JOB["ghl_contact_id"],
}
est = post_json("/api/estimates", body)
print(f"     Estimate id:  {est['id']}")
print(f"     Share token:  {est.get('share_token')}")

share = est.get("share_token") or est["id"]
print(f"3/3  Share URL: {BASE}/proposal-client.html?share={share}")
print(f"     Admin URL: {BASE}/sales-proposal.html?id={est['id']}")
