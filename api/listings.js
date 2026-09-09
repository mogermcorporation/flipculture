const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const CAMPAIGN_ID = process.env.EBAY_CAMPAIGN_ID || process.env.EBAY_PARTNER_ID || '5339168299';

const QUERIES = [
  ['Air Jordan 1 Retro sneaker', 'sneakers', '15709', true],
  ['Air Jordan 4 Retro sneaker', 'sneakers', '15709', true],
  ['Air Jordan 11 Retro sneaker', 'sneakers', '15709', true],
  ['Nike Kobe Bryant sneaker', 'sneakers', '15709', true],
  ['Travis Scott Jordan sneaker', 'sneakers', '15709', true],
  ['Nike Dunk Low', 'sneakers', '15709', true],
  ['Supreme hoodie', 'streetwear', '1059', false],
  ['Corteiz hoodie', 'streetwear', '1059', false],
  ['True Religion jeans', 'streetwear', '1059', false],
  ['Panini Prizm PSA 10', 'collectibles', '212', true],
  ['Michael Jordan game used jersey relic', 'collectibles', '64482', false],
  ['Rolex Submariner watch', 'watches', '31387', true],
  ['Patek Philippe Nautilus watch', 'watches', '31387', true],
  ['Omega Speedmaster watch', 'watches', '31387', true]
];

const ELECTRONICS = /laptop|macbook|steam\s*deck|gpu\b|rtx\s*\d|rog\s*(strix|ally)|victus|battlestation|handheld|nintendo\s*switch/i;
const SHOP_JACKET = /shop jacket/i;
const WATCH_PARTS = /bracelet|bezel insert|caseback|clasp|coaster|\bpen\b|teardown|\blink\b/i;
const SHOE = /sneaker|shoes?|jordan\s*\d|dunk|yeezy|kobe|air force/i;
const APPAREL = /hoodie|sweatshirt|t-shirt|\btee\b|jeans|denim|jacket/i;
const CARD = /psa|bgs|panini|topps|bowman|rookie card|game[- ]used|autograph|memorabilia|relic/i;
const WATCH = /rolex|omega|cartier|tudor|patek|audemars|richard mille|submariner|datejust|daytona|speedmaster|watch/i;

function classify(title, expected) {
  const t = title || '';
  if (ELECTRONICS.test(t) || SHOP_JACKET.test(t) || WATCH_PARTS.test(t)) return null;
  if (WATCH.test(t) && !SHOE.test(t) && !APPAREL.test(t)) return 'watches';
  if (CARD.test(t) && !SHOE.test(t)) return 'collectibles';
  if (APPAREL.test(t) && !SHOE.test(t)) return 'streetwear';
  if (SHOE.test(t)) return 'sneakers';
  return expected;
}

function affiliateUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (!/(^|\.)ebay\.(com|ca|co\.uk|de|fr|it|es|com\.au)$/i.test(u.hostname)) return raw;
    u.searchParams.set('mkcid', '1');
    u.searchParams.set('mkrid', '711-53200-19255-0');
    u.searchParams.set('mkevt', '1');
    u.searchParams.set('campid', CAMPAIGN_ID);
    u.searchParams.set('toolid', '10001');
    return u.toString();
  } catch {
    return raw;
  }
}

async function ebayToken() {
  const id = process.env.EBAY_APP_ID;
  const cert = process.env.EBAY_CERT_ID;
  if (!id || !cert) {
    const err = new Error('missing_ebay_credentials');
    err.status = 500;
    throw err;
  }
  const basic = Buffer.from(`${id}:${cert}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });
  if (!res.ok) {
    const err = new Error('ebay_token_failed');
    err.status = 502;
    throw err;
  }
  const body = await res.json();
  if (!body.access_token) {
    const err = new Error('ebay_token_failed');
    err.status = 502;
    throw err;
  }
  return body.access_token;
}

async function search(token, query, expected, categoryId, authenticity) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '12');
  const filt = authenticity
    ? 'qualifiedPrograms:{AUTHENTICITY_GUARANTEE},buyingOptions:{FIXED_PRICE}'
    : 'buyingOptions:{FIXED_PRICE}';
  url.searchParams.set('filter', filt);
  if (categoryId) url.searchParams.set('category_ids', categoryId);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': process.env.EBAY_MARKETPLACE_ID || 'EBAY_US'
    }
  });
  if (!res.ok) return [];
  const body = await res.json();
  const out = [];
  for (const item of body.itemSummaries || []) {
    const salePrice = Number(item.price?.value || 0);
    if (!salePrice) continue;
    const title = item.title || query;
    const category = classify(title, expected);
    if (category !== expected) continue;
    out.push({
      title,
      category,
      item_type: 'physical',
      original_price: Math.round(salePrice * 120) / 100,
      sale_price: salePrice,
      discount_percent: 16.6,
      affiliate_url: affiliateUrl(item.itemWebUrl || ''),
      image_url: item.image?.imageUrl || '',
      source_platform: 'ebay',
      currency: item.price?.currency || 'USD'
    });
  }
  return out;
}

async function snapshot(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (!host) return null;
  const res = await fetch(`${proto}://${host}/listings.json`);
  if (!res.ok) return null;
  const body = await res.json();
  if (!body.items || !body.items.length) return null;
  body.items = body.items
    .map((row) => ({ ...row, affiliate_url: affiliateUrl(row.affiliate_url) }))
    .filter((row) => ['sneakers', 'streetwear', 'collectibles', 'watches'].includes(row.category));
  return body;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = await ebayToken();
    const items = [];
    const seen = new Set();
    for (const [query, category, categoryId, authenticity] of QUERIES) {
      const batch = await search(token, query, category, categoryId, authenticity);
      for (const row of batch) {
        const key = row.affiliate_url || row.title;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(row);
      }
    }
    if (items.length) return res.status(200).json({ count: items.length, items, source: 'ebay' });
  } catch (_) {
    // fall through to snapshot
  }

  try {
    const snap = await snapshot(req);
    if (snap) return res.status(200).json({ ...snap, source: 'snapshot' });
  } catch (_) {}

  return res.status(502).json({
    error: 'Unable to load listings. Check API endpoint configuration.',
    items: []
  });
};
