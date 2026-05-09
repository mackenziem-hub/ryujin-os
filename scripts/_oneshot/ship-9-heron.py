"""One-shot: ship 9 Heron Ct (Frank Ariganello) Darcy-owned proposal.

Pattern: ship-3-jobs-apr27.py
Customer: Frank Ariganello, 9 Heron Court, Bouctouche NB
Source: website form, in Darcy's pipeline at Inspection Scheduled
Distance: 52.4 km from Riverview, Day Trip pricing model
Pitch: 8/12 main (43 x 40 footprint + 6 x 20 dormer = 1840 sqft footprint -> 22 SQ at 8/12)
Complexity: Complex (95 LF valleys + 5 rakes + dormer)

Engine rates aligned to Ryan's 2025 official sub-contracting rate sheet (Apr 28).
"""
import json, urllib.request, urllib.parse, urllib.error, mimetypes, os, uuid, sys

BASE = "https://ryujin-os.vercel.app"
TENANT = "plus-ultra"
JOBS_BASE = r"C:\Users\macke\OneDrive\Desktop\Plus Ultra\Jobs"

JOB = {
    "label": "9 Heron Ct",
    "folder": os.path.join(JOBS_BASE, "9 Heron Ct"),
    "ghl_contact_id": None,  # Frank not yet surfaced via lookup; Mac to link manually
    "customer": {
        "full_name": "Frank Ariganello",
        "phone": "",
        "email": "",
        "address": "9 Heron Court",
        "city": "Bouctouche",
        "province": "NB",
    },
    "measurements": {
        "squareFeet": 1840,        # 43*40 main + 6*20 dormer footprint
        "pitch": "8/12",
        "complexity": "complex",
        "eavesLF": 120, "ridgesLF": 105, "rakesLF": 105,
        "valleysLF": 95, "hipsLF": 0, "wallsLF": 0,
        "pipes": 1, "vents": 1, "chimneys": 0,
        "stories": 2, "extraLayers": 0, "distanceKM": 52.4,
    },
    "footprint_sqft": 1840,
    "notes": (
        "Frank Ariganello, 9 Heron Court Bouctouche. 22 SQ at 8/12, complex. "
        "43x40 main footprint + 6x20 backside protruding dormer. "
        "Eaves 120 / Ridge 105 / Rakes 105 (5 rakes) / Valleys 95 LF. "
        "1 hydro mast, 1 pipe flashing, no chimney, no skylights, no redeck (newer house). "
        "52.4 km Day Trip pricing. Darcy-owned via website form, Inspection Scheduled stage."
    ),
    "photos": [
        ("cover photo.png",     True,  None),
        ("street side view.png", False, "street side view"),
        ("street view 2.png",   False, "street view"),
    ],
    "tags": ["sales_owner:darcy", "bouctouche", "source:website-form"],
}


def post_json(path, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE}{path}{'&' if '?' in path else '?'}tenant={TENANT}",
        data=body,
        headers={"Content-Type": "application/json", "x-tenant-id": TENANT},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {e.code} on {path}: {body_err}")


def upload_photo(estimate_id, file_path, is_cover=False, caption=None):
    boundary = uuid.uuid4().hex
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="estimate_id"\r\n\r\n{estimate_id}\r\n'.encode()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="is_cover"\r\n\r\n{"true" if is_cover else "false"}\r\n'.encode()
    if caption:
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="caption"\r\n\r\n{caption}\r\n'.encode()
    fname = os.path.basename(file_path)
    ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="photos"; filename="{fname}"\r\n'.encode()
    body += f"Content-Type: {ctype}\r\n\r\n".encode()
    with open(file_path, "rb") as f:
        body += f.read()
    body += b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{BASE}/api/estimate-photos?tenant={TENANT}",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "x-tenant-id": TENANT},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def ship(job):
    print(f"\n========== {job['label']} ==========")

    print("1/4  Compare quote...")
    measurements = dict(job["measurements"])
    measurements["squareFeet"] = job["footprint_sqft"]
    compare = post_json("/api/quote?mode=compare", {"measurements": measurements, "choices": {}})
    for slug in ("gold", "platinum", "diamond"):
        s = compare["offers"].get(slug, {}).get("summary", {})
        if s:
            print(f"     {slug:9s} ${s.get('sellingPrice', 0):>8,.0f} pre-HST  |  ${s.get('totalWithTax', 0):>8,.0f} w/HST")

    print("2/4  Create estimate...")
    body = {
        "customer": job["customer"],
        "proposal_mode": "Roof Only",
        "pricing_model": "Day Trip",
        "roof_area_sqft": measurements["squareFeet"],
        "roof_pitch": measurements["pitch"],
        "complexity": measurements["complexity"],
        "eaves_lf": measurements["eavesLF"],
        "rakes_lf": measurements["rakesLF"],
        "ridges_lf": measurements["ridgesLF"],
        "valleys_lf": measurements["valleysLF"],
        "hips_lf": measurements["hipsLF"],
        "walls_lf": measurements["wallsLF"],
        "pipes": measurements["pipes"],
        "vents": measurements["vents"],
        "chimneys": measurements["chimneys"],
        "stories": measurements["stories"],
        "extra_layers": measurements["extraLayers"],
        "distance_km": measurements["distanceKM"],
        "calculated_packages": compare["offers"],
        "selected_package": "platinum",
        "status": "draft",
        "notes": [{"author": "claude", "timestamp": "2026-04-28", "note": job["notes"]}],
        "tags": job["tags"],
        "ghl_contact_id": job.get("ghl_contact_id"),
    }
    est = post_json("/api/estimates", body)
    print(f"     Estimate id:  {est['id']}")
    print(f"     Share token:  {est.get('share_token')}")

    print("3/4  Upload photos...")
    for fname, is_cover, cap in job["photos"]:
        path = os.path.join(job["folder"], fname)
        if not os.path.exists(path):
            print(f"     SKIP (missing): {fname}")
            continue
        try:
            r = upload_photo(est["id"], path, is_cover=is_cover, caption=cap)
            for p in r.get("photos", []):
                if p.get("error"):
                    print(f"     FAIL {fname}: {p['error']}")
                else:
                    print(f"     OK   {fname}  cover={p.get('is_cover')}  caption={p.get('caption')}")
        except Exception as e:
            print(f"     FAIL upload {fname}: {e}")

    share = est.get("share_token") or est["id"]
    share_url = f"{BASE}/proposal-client.html?share={share}"
    admin_url = f"{BASE}/sales-proposal.html?id={est['id']}"
    print(f"4/4  Share URL: {share_url}")
    print(f"     Admin URL: {admin_url}")
    return {"label": job["label"], "estimate_id": est["id"], "share_url": share_url, "admin_url": admin_url}


if __name__ == "__main__":
    try:
        r = ship(JOB)
        print("\n========== SUMMARY ==========")
        print(f"  {r['label']}:")
        print(f"    Share: {r['share_url']}")
        print(f"    Admin: {r['admin_url']}")
    except Exception as e:
        print(f"ERROR shipping {JOB['label']}: {e}")
