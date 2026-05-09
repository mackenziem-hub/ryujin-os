"""One-shot: ship 3 Mackenzie-owned proposals end-to-end through Ryujin.

Jobs:
  1) 212 Tobias Avenue   — John Shanahan
  2) 39 Midway Drive     — John Furlotte (mansard accent noted in internal note)
  3) 24 Chartersville Rd — Chantal Leblanc-Maldonado

Pattern lifted from ship-42-patricia.py.
"""
import json, urllib.request, urllib.parse, urllib.error, mimetypes, os, uuid, sys

BASE = "https://ryujin-os.vercel.app"
TENANT = "plus-ultra"
JOBS_BASE = r"C:\Users\macke\OneDrive\Desktop\Plus Ultra\Jobs"

JOBS = [
    {
        "label": "212 Tobias Avenue",
        "folder": os.path.join(JOBS_BASE, "212 Tobias Avenue"),
        "ghl_contact_id": "TOYS7ziaifUE3jCzSbA0",
        "customer": {
            "full_name": "John Shanahan",
            "phone": "+15063811921",
            "email": "johnneywho@hotmail.com",
            "address": "212 Tobias Avenue",
            "city": "Riverview",
            "province": "NB",
        },
        "measurements": {
            "squareFeet": 1480,        # 14.8 SQ pitched / 1.054 = ~1404 footprint, but we feed footprint
            "pitch": "4/12",
            "complexity": "simple",
            "eavesLF": 116, "ridgesLF": 44, "rakesLF": 100,
            "valleysLF": 0, "hipsLF": 0, "wallsLF": 0,
            "pipes": 1, "vents": 0, "chimneys": 1, "chimneySize": "small",
            "stories": 1, "extraLayers": 0, "distanceKM": 5,
        },
        # Engine wants 2D footprint. 44 x 32 = 1408 sqft footprint -> 14.8 SQ at 4/12 (factor 1.054).
        "footprint_sqft": 1408,
        "notes": (
            "John Shanahan, Riverview. 14.8 SQ at 4/12. Simple, single-section roof. "
            "Steel chimney re-flash, 1 pipe boot. Local (5km). Mackenzie-owned lead."
        ),
        "photos": [
            ("cover photo.png",  True,  None),
            ("before image.png", False, "before"),
            ("after image.png",  False, "after"),
        ],
        "tags": ["sales_owner:mackenzie", "riverview", "source:appointment-confirmed"],
    },
    {
        "label": "39 Midway Drive",
        "folder": os.path.join(JOBS_BASE, "39 Midway Drive"),
        "ghl_contact_id": "0nsHtgGGkcROKQ0gSs8H",
        "customer": {
            "full_name": "John Furlotte",
            "phone": "+15069620451",
            "email": "johnfurlotte1@hotmail.com",
            "address": "39 Midway Drive",
            "city": "Moncton",
            "province": "NB",
        },
        "measurements": {
            "squareFeet": 1110,        # main only — mansard noted internally; engine doesn't model dual-pitch
            "pitch": "4/12",
            "complexity": "simple",
            "eavesLF": 145, "ridgesLF": 74, "rakesLF": 30,
            "valleysLF": 0, "hipsLF": 0, "wallsLF": 0,
            "pipes": 1, "vents": 2, "chimneys": 0,
            "stories": 1, "extraLayers": 0, "distanceKM": 12,
        },
        # 11.7 SQ pitched main / 1.054 = ~1110 footprint. Mansard handled in internal note + paysheet.
        "footprint_sqft": 1110,
        "notes": (
            "John Furlotte, Moncton. Main roof 11.7 SQ at 4/12 (pitched), simple end-to-end gable. "
            "Mansard accent front + back, ~3 shingles tall (~2 ft) x 74 LF each side = ~3 SQ extra at "
            "steep pitch tier. Mansard priced separately on paysheet via mansard_sq scope_extra ($190/SQ). "
            "1 pipe boot, 2 goose-neck vents. ~12 km from Riverview. Mackenzie-owned lead."
        ),
        "photos": [
            ("cover photo.png", True,  None),
            ("before.png",      False, "before"),
            ("after.png",       False, "after"),
        ],
        "tags": ["sales_owner:mackenzie", "moncton", "source:facebook-ad"],
    },
    {
        "label": "24 Chartersville Road",
        "folder": os.path.join(JOBS_BASE, "24 Chartersville Road"),
        "ghl_contact_id": "gKvcEbeY9sJtgb3bcYaN",
        "customer": {
            "full_name": "Chantal Leblanc-Maldonado",
            "phone": "+15065880573",
            "email": "cleblancmaldonado@gmail.com",
            "address": "24 Chartersville Road",
            "city": "Dieppe",
            "province": "NB",
        },
        "measurements": {
            "squareFeet": 1680,        # 17.7 SQ pitched / 1.054 = ~1680 footprint
            "pitch": "4/12",
            "complexity": "simple",
            "eavesLF": 114, "ridgesLF": 57, "rakesLF": 60,
            "valleysLF": 0, "hipsLF": 0, "wallsLF": 0,
            "pipes": 1, "vents": 0, "chimneys": 1, "chimneySize": "small",
            "stories": 1, "extraLayers": 0, "distanceKM": 10,
        },
        "footprint_sqft": 1680,
        "notes": (
            "Chantal Leblanc-Maldonado, Dieppe. 17.7 SQ at 4/12. Simple. "
            "1 small brick chimney re-flash, 1 pipe boot. Local (~10km). Mackenzie-owned lead."
        ),
        "photos": [
            ("cover photo.png", True,  None),
            ("before photo.png", False, "before"),
            ("after photo.png",  False, "after"),
        ],
        "tags": ["sales_owner:mackenzie", "dieppe", "source:appointment-confirmed"],
    },
]


def post_json(path, body):
    req = urllib.request.Request(
        f"{BASE}{path}{'&' if '?' in path else '?'}tenant={TENANT}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-tenant-id": TENANT},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()[:1000]
        print(f"     HTTP {e.code} on {path}")
        print(f"     Body: {body_text}")
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
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{val}\r\n'.encode()
        )

    field("estimate_id", estimate_id)
    field("is_cover", "true" if is_cover else "false")
    if caption:
        field("caption", caption)
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\n'
        f'Content-Type: {ctype}\r\n\r\n'.encode()
        + filedata
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
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

    # 1. Compare quote
    print("1/4  Compare quote...")
    measurements = dict(job["measurements"])
    measurements["squareFeet"] = job["footprint_sqft"]
    compare = post_json("/api/quote?mode=compare", {"measurements": measurements, "choices": {}})
    for slug in ("gold", "platinum", "diamond"):
        s = compare["offers"].get(slug, {}).get("summary", {})
        if s:
            print(f"     {slug:9s} ${s.get('sellingPrice', 0):>8,.0f} pre-HST  |  ${s.get('totalWithTax', 0):>8,.0f} w/HST")

    # 2. Create estimate
    print("2/4  Create estimate...")
    body = {
        "customer": job["customer"],
        "proposal_mode": "Roof Only",
        "pricing_model": "Local" if measurements["distanceKM"] <= 20 else ("Day Trip" if measurements["distanceKM"] <= 60 else "Extended Stay"),
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
        "chimney_size": measurements.get("chimneySize", "small"),
        "stories": measurements["stories"],
        "extra_layers": measurements["extraLayers"],
        "distance_km": measurements["distanceKM"],
        "calculated_packages": compare["offers"],
        "selected_package": "platinum",
        "status": "draft",
        "notes": [{"author": "claude", "timestamp": "2026-04-27", "note": job["notes"]}],
        "tags": job["tags"],
        "ghl_contact_id": job.get("ghl_contact_id"),
    }
    est = post_json("/api/estimates", body)
    print(f"     Estimate id:  {est['id']}")
    print(f"     Share token:  {est.get('share_token')}")

    # 3. Photos
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
                    url = p.get("url", "")
                    print(f"     OK   {fname}  cover={p.get('is_cover')}  caption={p.get('caption')}")
        except Exception as e:
            print(f"     FAIL upload {fname}: {e}")

    # 4. Share URL
    share = est.get("share_token") or est["id"]
    share_url = f"{BASE}/proposal-client.html?share={share}"
    admin_url = f"{BASE}/sales-proposal.html?id={est['id']}"
    print(f"4/4  Share URL: {share_url}")
    print(f"     Admin URL: {admin_url}")
    return {"label": job["label"], "estimate_id": est["id"], "share_url": share_url, "admin_url": admin_url}


if __name__ == "__main__":
    results = []
    for job in JOBS:
        try:
            results.append(ship(job))
        except Exception as e:
            print(f"ERROR shipping {job['label']}: {e}")
            results.append({"label": job["label"], "error": str(e)})

    print("\n========== SUMMARY ==========")
    for r in results:
        if "error" in r:
            print(f"  {r['label']}: ERROR — {r['error']}")
        else:
            print(f"  {r['label']}:")
            print(f"    Share: {r['share_url']}")
            print(f"    Admin: {r['admin_url']}")
