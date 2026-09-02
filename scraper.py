import os
import re
import sys
import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"
}

def clean_price(price_str: str) -> float:
    if not price_str:
        return 0.0
    cleaned = re.sub(r"[^\d.]", "", price_str)
    try:
        return float(cleaned)
    except ValueError:
        return 0.0

def scrape_flipculture_inventory():
    records = []
    queries = [
        ("Air Jordan 1 Retro High", "sneakers"),
        ("Nike Dunk Low", "sneakers"),
        ("HP Victus Gaming Laptop", "tech"),
        ("ASUS ROG Strix Laptop", "tech"),
        ("Rolex GMT-Master II", "luxury"),
        ("Rolex Submariner", "luxury")
    ]
    
    for query, cat in queries:
        try:
            url = f"https://www.ebay.com/sch/i.html?_nkw={query.replace(' ', '+')}&_sop=10&LH_BIN=1&_ipg=10"
            res = requests.get(url, headers=HEADERS, timeout=10)
            if res.status_code == 200:
                soup = BeautifulSoup(res.text, "html.parser")
                for card in soup.select(".s-item__info"):
                    title_el = card.select_one(".s-item__title")
                    price_el = card.select_one(".s-item__price")
                    link_el = card.select_one("a.s-item__link")
                    
                    if title_el and price_el and link_el:
                        title = title_el.get_text(strip=True)
                        if "Shop on eBay" in title: continue
                        sale_price = clean_price(price_el.get_text(strip=True))
                        raw_url = link_el.get("href", "").split("?")[0]
                        
                        if sale_price > 0:
                            records.append({
                                "title": title,
                                "category": cat,
                                "item_type": "physical",
                                "original_price": round(sale_price * 1.2, 2),
                                "sale_price": sale_price,
                                "discount_percent": 16.6,
                                "affiliate_url": f"{raw_url}?campid=FLIPCULTURE_EBAY",
                                "source_platform": "flipculture_curated"
                            })
        except Exception as e:
            print(f"Error scraping {query}: {e}")
            continue

    saas_tools = [
        {
            "title": "Supabase PostgreSQL Database",
            "category": "infrastructure",
            "item_type": "digital",
            "original_price": 25.0,
            "sale_price": 0.0,
            "discount_percent": 100.0,
            "recurring_payout_pct": 20.0,
            "affiliate_url": "https://supabase.com/?ref=flipculture",
            "source_platform": "flipculture_stack"
        },
        {
            "title": "Make.com Automation Workflow",
            "category": "automation",
            "item_type": "digital",
            "original_price": 9.0,
            "sale_price": 0.0,
            "discount_percent": 100.0,
            "recurring_payout_pct": 30.0,
            "affiliate_url": "https://www.make.com/?ref=flipculture",
            "source_platform": "flipculture_stack"
        }
    ]
    records.extend(saas_tools)
    return records

if __name__ == "__main__":
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("CRITICAL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from environment variables!")
        sys.exit(1)

    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        data = scrape_flipculture_inventory()
        if data:
            supabase.table("inventory").upsert(data).execute()
            print(f"Successfully synced {len(data)} items to flipculture!")
    except Exception as e:
        print(f"Database execution error: {e}")
        sys.exit(1)
