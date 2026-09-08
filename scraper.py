import base64
import json
import os
import sys
from pathlib import Path

import requests
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
EBAY_APP_ID = os.environ.get("EBAY_APP_ID")
EBAY_CERT_ID = os.environ.get("EBAY_CERT_ID")
MARKETPLACE = os.environ.get("EBAY_MARKETPLACE_ID", "EBAY_US")
LISTINGS_PATH = Path(__file__).resolve().parent / "listings.json"

QUERIES = [
    ("Air Jordan 1 Retro High", "sneakers"),
    ("Nike Dunk Low", "sneakers"),
    ("HP Victus Gaming Laptop", "tech"),
    ("ASUS ROG Strix Laptop", "tech"),
    ("Rolex GMT-Master II", "luxury"),
    ("Rolex Submariner", "luxury"),
]


def ebay_app_token() -> str:
    if not EBAY_APP_ID or not EBAY_CERT_ID:
        raise RuntimeError("EBAY_APP_ID and EBAY_CERT_ID are required")
    basic = base64.b64encode(f"{EBAY_APP_ID}:{EBAY_CERT_ID}".encode()).decode()
    res = requests.post(
        "https://api.ebay.com/identity/v1/oauth2/token",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {basic}",
        },
        data={
            "grant_type": "client_credentials",
            "scope": "https://api.ebay.com/oauth/api_scope",
        },
        timeout=20,
    )
    res.raise_for_status()
    token = res.json().get("access_token")
    if not token:
        raise RuntimeError("eBay token response missing access_token")
    return token


def search_ebay(token: str, query: str, category: str, limit: int = 8) -> list[dict]:
    res = requests.get(
        "https://api.ebay.com/buy/browse/v1/item_summary/search",
        params={
            "q": query,
            "limit": str(limit),
            "filter": "buyingOptions:{FIXED_PRICE}",
        },
        headers={
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
        },
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
        url = item.get("itemWebUrl") or ""
        image = (item.get("image") or {}).get("imageUrl") or ""
        records.append(
            {
                "title": item.get("title") or query,
                "category": category,
                "item_type": "physical",
                "original_price": round(sale_price * 1.2, 2),
                "sale_price": sale_price,
                "discount_percent": 16.6,
                "affiliate_url": url,
                "image_url": image,
                "source_platform": "ebay",
                "currency": price.get("currency") or "USD",
            }
        )
    return records


def scrape_flipculture_inventory() -> list[dict]:
    token = ebay_app_token()
    records = []
    seen = set()
    for query, cat in QUERIES:
        try:
            batch = search_ebay(token, query, cat)
            print(f"eBay {query}: {len(batch)} items")
            for row in batch:
                key = row.get("affiliate_url") or row["title"]
                if key in seen:
                    continue
                seen.add(key)
                records.append(row)
        except Exception as exc:
            print(f"Error searching {query}: {exc}")
    return records


def supabase_rows(records: list[dict]) -> list[dict]:
    allowed = {
        "title",
        "category",
        "item_type",
        "original_price",
        "sale_price",
        "discount_percent",
        "affiliate_url",
        "source_platform",
    }
    return [{k: row[k] for k in allowed if k in row} for row in records]


if __name__ == "__main__":
    try:
        data = scrape_flipculture_inventory()
    except Exception as exc:
        print(f"eBay API error: {exc}")
        sys.exit(1)

    LISTINGS_PATH.write_text(json.dumps({"items": data, "count": len(data)}, indent=2))
    print(f"Wrote {len(data)} listings to {LISTINGS_PATH.name}")

    if not data:
        print("CRITICAL: eBay returned 0 listings")
        sys.exit(1)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Supabase env not set; skipped database sync")
        sys.exit(0)

    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        payload = supabase_rows(data)
        supabase.table("inventory").upsert(payload).execute()
        print(f"Successfully synced {len(payload)} items to flipculture!")
    except Exception as exc:
        print(f"Database execution error: {exc}")
        sys.exit(1)
