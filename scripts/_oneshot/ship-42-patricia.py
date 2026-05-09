"""One-shot: ship 42 Patricia proposal end-to-end through Ryujin."""
import json, urllib.request, urllib.parse, mimetypes, os, uuid, sys

BASE = "https://ryujin-os.vercel.app"
TENANT = "plus-ultra"
FOLDER = r"C:\Users\macke\OneDrive\Desktop\Plus Ultra\Jobs\42 Patricia"

MEASUREMENTS = {
    "squareFeet": 3454, "pitch": "8/12", "complexity": "complex",
    "eavesLF": 200, "rakesLF": 150, "ridgesLF": 130, "valleysLF": 110, "hipsLF": 10,
    "pipes": 3, "vents": 2, "chimneys": 0, "stories": 1, "extraLayers": 0, "distanceKM": 0,
}

CUSTOMER = {
    "full_name": "Jonathan Godbout",
    "phone": "+15068780425",
    "email": "jonathan.godbout@nbed.nb.ca",
    "address": "42 Patricia Drive",
    "city": "Riverview",
}

NOTES = [{
    "author": "claude",
    "timestamp": "2026-04-24",
    "note": (
        "Initial quote built from measurement doc + cover/before/after photos in job folder. "
        "85% of roof at 8/12 pitch, 15% porches at 5/12. Complex flagged (multi-section, 110 LF valley, skylights rear). "
        "Skylight flashing kit INCLUDED in scope. Skylight replacement available as add-on (~$700-900 installed each, client choice). "
        "Eaves/rakes estimated for pricing; field-measure on site for final material order. "
        "Tear-off baked into install labor rate ($160/SQ pitched) — engine shows phantom tear-off line, safe to ignore."
    )
}]

def post_json(path, body):
    req = urllib.request.Request(
        f"{BASE}{path}{'&' if '?' in path else '?'}tenant={TENANT}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-tenant-id": TENANT},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"     HTTP {e.code} on {path}")
        print(f"     Body: {e.read().decode()[:800]}")
        raise

def upload_photo(estimate_id, filepath, is_cover=False, caption=None):
    boundary = "----ryujin" + uuid.uuid4().hex
    ctype, _ = mimetypes.guess_type(filepath)
    ctype = ctype or "application/octet-stream"
    fname = os.path.basename(filepath)
    with open(filepath, "rb") as fh:
        filedata = fh.read()
    parts = []
    def field(name, val):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{val}\r\n'.encode())
    field("estimate_id", estimate_id)
    field("is_cover", "true" if is_cover else "false")
    if caption: field("caption", caption)
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\n'
        f'Content-Type: {ctype}\r\n\r\n'.encode()
        + filedata + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{BASE}/api/estimate-photos?tenant={TENANT}",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "x-tenant-id": TENANT},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())

# 1. Quote compare
print("1/4  Running compare quote...")
compare = post_json("/api/quote?mode=compare", {"measurements": MEASUREMENTS, "choices": {}})
tiers = {s: compare["offers"][s]["summary"] for s in ("economy","gold","platinum","diamond")}
for s, t in tiers.items():
    print(f"     {s:10s} ${t['sellingPrice']:>8,.0f} pre-HST  |  ${t['totalWithTax']:>8,.0f} w/HST  |  {t['netMargin']}")

# 2. Create estimate
print("\n2/4  Creating estimate record...")
estimate_body = {
    "customer": CUSTOMER,
    "proposal_mode": "Roof Only",
    "pricing_model": "Local",
    "roof_area_sqft": MEASUREMENTS["squareFeet"],
    "roof_pitch": MEASUREMENTS["pitch"],
    "complexity": MEASUREMENTS["complexity"],
    "eaves_lf": MEASUREMENTS["eavesLF"],
    "rakes_lf": MEASUREMENTS["rakesLF"],
    "ridges_lf": MEASUREMENTS["ridgesLF"],
    "valleys_lf": MEASUREMENTS["valleysLF"],
    "hips_lf": MEASUREMENTS["hipsLF"],
    "pipes": MEASUREMENTS["pipes"],
    "vents": MEASUREMENTS["vents"],
    "chimneys": 0, "stories": 1, "extra_layers": 0,
    "distance_km": 0,
    "calculated_packages": compare["offers"],
    "selected_package": "platinum",
    "status": "draft",
    "notes": NOTES,
    "tags": ["sales_owner:darcy", "canvassing", "riverview", "source:inspection-scheduled"],
}
est = post_json("/api/estimates", estimate_body)
print(f"     Estimate id: {est['id']}")
print(f"     Share token: {est.get('share_token')}")

# 3. Upload photos
print("\n3/4  Uploading photos...")
photos_to_upload = [
    ("Cover Photo.png", True, None),
    ("42 Patricia Before.jpg", False, "before"),
    ("42 Patricia After.jpg", False, "after"),
]
for fname, is_cover, cap in photos_to_upload:
    path = os.path.join(FOLDER, fname)
    if not os.path.exists(path):
        print(f"     SKIP (missing): {fname}"); continue
    r = upload_photo(est["id"], path, is_cover=is_cover, caption=cap)
    for p in r.get("photos", []):
        if p.get("error"):
            print(f"     FAIL {fname}: {p['error']}")
        else:
            print(f"     OK   {fname}  -> {p.get('url','')[:90]}{'...' if len(p.get('url',''))>90 else ''}  cover={p.get('is_cover')}  caption={p.get('caption')}")

# 4. Share URL
share = est.get("share_token") or est["id"]
share_url = f"{BASE}/proposal-client.html?share={share}"
print(f"\n4/4  Share URL:\n     {share_url}")
print(f"\n     Estimate admin:  {BASE}/sales-proposal.html?id={est['id']}")
