import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
EBAY_APP_ID = os.environ.get("EBAY_APP_ID") or os.environ.get("EBAY_CLIENT_ID")
EBAY_CERT_ID = os.environ.get("EBAY_CERT_ID") or os.environ.get("EBAY_CLIENT_SECRET")
CAMPAIGN_ID = os.environ.get("EBAY_CAMPAIGN_ID") or os.environ.get("EPN_CAMPID") or "5339168299"
MARKETPLACE = os.environ.get("EBAY_MARKETPLACE_ID", "EBAY_US")
LISTINGS_PATH = Path(__file__).resolve().parent / "listings.json"

QUERIES = [
    ("Air Jordan 1 Retro sneaker", "sneakers", "15709", True),
    ("Air Jordan 4 Retro sneaker", "sneakers", "15709", True),
    ("Air Jordan 11 Retro sneaker", "sneakers", "15709", True),
    ("Nike Kobe Bryant sneaker", "sneakers", "15709", True),
    ("Travis Scott Jordan sneaker", "sneakers", "15709", True),
    ("Nike Dunk Low", "sneakers", "15709", True),
    ("Supreme hoodie", "streetwear", "1059", False),
    ("Corteiz hoodie", "streetwear", "1059", False),
    ("True Religion jeans", "streetwear", "1059", False),
    ("Panini Prizm PSA 10", "collectibles", "212", True),
    ("Michael Jordan game used jersey relic", "collectibles", "64482", False),
    ("Rolex Submariner watch", "watches", "31387", True),
    ("Patek Philippe Nautilus watch", "watches", "31387", True),
    ("Omega Speedmaster watch", "watches", "31387", True),
]


def affiliate_url(raw: str) -> str:
    if not raw:
        return ""
    parts = urlsplit(raw)
    host = (parts.hostname or "").lower()
    if "ebay." not in host:
        return raw
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update(
        {
            "mkcid": "1",
            "mkrid": "711-53200-19255-0",
            "mkevt": "1",
            "campid": CAMPAIGN_ID,
            "toolid": "10001",
        }
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def classify(title: str, expected: str) -> str | None:
    t = title or ""
    low = t.lower()
    if any(x in low for x in ("laptop", "victus", "rog strix", "steam deck", "shop jacket")):
        return None
    if any(x in low for x in ("bracelet", "bezel insert", "caseback", "coaster", " ballpoint")):
        return None
    shoe = any(x in low for x in ("sneaker", "shoe", "jordan", "dunk", "yeezy", "kobe"))
    apparel = any(x in low for x in ("hoodie", "sweatshirt", "t-shirt", "tee", "jeans", "denim"))
    card = any(x in low for x in ("psa", "panini", "topps", "bowman", "game used", "relic", "autograph"))
    watch = any(x in low for x in ("rolex", "omega", "patek", "watch", "submariner", "speedmaster"))
    if watch and not shoe and not apparel:
        return "watches"
    if card and not shoe:
        return "collectibles"
    if apparel and not shoe:
        return "streetwear"
    if shoe:
        return "sneakers"
    return expected


def ebay_app_token() -> str:
    if not EBAY_APP_ID or not EBAY_CERT_ID:
        raise RuntimeError("EBAY_APP_ID and EBAY_CERT_ID are required")
    res = requests.post(
        "https://api.ebay.com/identity/v1/oauth2/token",
        auth=(EBAY_APP_ID, EBAY_CERT_ID),
        data={"grant_type": "client_credentials", "scope": "https://api.ebay.com/oauth/api_scope"},
        timeout=20,
    )
    res.raise_for_status()
    token = res.json().get("access_token")
    if not token:
        raise RuntimeError("eBay token response missing access_token")
    return token


def search_ebay(token: str, query: str, expected: str, category_id: str, authenticity: bool, limit: int = 12) -> list[dict]:
    filt = (
        "qualifiedPrograms:{AUTHENTICITY_GUARANTEE},buyingOptions:{FIXED_PRICE}"
        if authenticity
        else "buyingOptions:{FIXED_PRICE}"
    )
    params = {"q": query, "limit": str(limit), "filter": filt, "category_ids": category_id}
    res = requests.get(
        "https://api.ebay.com/buy/browse/v1/item_summary/search",
        params=params,
        headers={"Authorization": f"Bearer {token}", "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE},
        timeout=20,
    )
    res.raise_for_status()
    records = []
    for item in res.json().get("itemSummaries") or []:
        price = item.get("price") or {}
        try:
            sale_price = float(price.get("value") or 0)
        except (TypeError, ValueError):
            sale_price = 0.0
        if sale_price <= 0:
            continue
        title = item.get("title") or query
        category = classify(title, expected)
        if category != expected:
            continue
        records.append(
            {
                "title": title,
                "category": category,
                "item_type": "physical",
                "original_price": round(sale_price * 1.2, 2),
                "sale_price": sale_price,
                "discount_percent": 16.6,
                "affiliate_url": affiliate_url(item.get("itemWebUrl") or ""),
                "image_url": (item.get("image") or {}).get("imageUrl") or "",
                "source_platform": "ebay",
                "currency": price.get("currency") or "USD",
            }
        )
    return records


if __name__ == "__main__":
    token = ebay_app_token()
    records = []
    seen = set()
    for query, cat, cid, ag in QUERIES:
        try:
            batch = search_ebay(token, query, cat, cid, ag)
            print(f"eBay {query}: {len(batch)} items")
            for row in batch:
                key = row.get("affiliate_url") or row["title"]
                if key in seen:
                    continue
                seen.add(key)
                records.append(row)
        except Exception as exc:
            print(f"Error searching {query}: {exc}")
    LISTINGS_PATH.write_text(json.dumps({"items": records, "count": len(records)}, indent=2))
    print(f"Wrote {len(records)} listings to {LISTINGS_PATH.name}")
    if not records:
        sys.exit(1)
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit(0)
    from supabase import create_client

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    supabase.table("inventory").upsert(records).execute()
    print(f"Synced {len(records)} items")
