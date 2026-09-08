const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const QUERIES = [
  ['Air Jordan 1 Retro High', 'sneakers'],
  ['Nike Dunk Low', 'sneakers'],
  ['HP Victus Gaming Laptop', 'tech'],
  ['ASUS ROG Strix Laptop', 'tech'],
  ['Rolex GMT-Master II', 'luxury'],
  ['Rolex Submariner', 'luxury']
];

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

async function search(token, query, category) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '8');
  url.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE}');
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
    out.push({
      title: item.title || query,
      category,
      item_type: 'physical',
      original_price: Math.round(salePrice * 120) / 100,
      sale_price: salePrice,
      discount_percent: 16.6,
      affiliate_url: item.itemWebUrl || '',
      image_url: item.image?.imageUrl || '',
      source_platform: 'ebay',
      currency: item.price?.currency || 'USD'
    });
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = await ebayToken();
    const items = [];
    const seen = new Set();
    for (const [query, category] of QUERIES) {
      const batch = await search(token, query, category);
      for (const row of batch) {
        const key = row.affiliate_url || row.title;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(row);
      }
    }
    if (!items.length) {
      return res.status(502).json({
        error: 'Unable to load listings. Check API endpoint configuration.',
        items: []
      });
    }
    return res.status(200).json({ count: items.length, items });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      error: 'Unable to load listings. Check API endpoint configuration.',
      items: []
    });
  }
};
