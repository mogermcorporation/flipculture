const CAMPAIGN_ID = process.env.EBAY_CAMPAIGN_ID || process.env.EBAY_PARTNER_ID || process.env.EPN_CAMPID || '5339168299';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://zhlkkihvttikuhsjwhcv.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpobGtraWh2dHRpa3Voc2p3aGN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNzgxODYsImV4cCI6MjEwMzk1NDE4Nn0.N5xCAjFUbyBawVKF2HhAi-csl4yoeYk91g2HopRyu8A';
const WALLS = ['sneakers', 'streetwear', 'collectibles', 'watches'];

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

function jordanNumber(title) {
  const t = title || '';
  const m =
    t.match(/\bair\s+jordan\s*(1[0-4]|[1-9])\b/i) ||
    t.match(/\bjordan\s*(1[0-4]|[1-9])\b/i) ||
    t.match(/\baj\s*-?\s*(1[0-4]|[1-9])\b/i);
  return m ? m[1] : null;
}

function sneakerFamily(title) {
  const t = title || '';
  if (/travis/i.test(t)) return 'travis';
  if (/\bkobe\b/i.test(t)) return 'kobe';
  const n = jordanNumber(t);
  if (n) return `jordan-${n}`;
  return 'trending';
}

function streetwearApparel(title) {
  const t = title || '';
  const denimTears = /denim\s*tears/i.test(t);
  if (/\b(jeans?|denim)\b/i.test(t) && !denimTears) return 'denim';
  if (denimTears && /\bjeans?\b/i.test(t) && !/\b(hoodie|hooded|sweatshirt)\b/i.test(t)) return 'denim';
  if (/\b(hoodie|hooded|sweatshirt)\b/i.test(t)) return 'hoodie';
  if (/\b(t-?shirts?|tees?)\b/i.test(t)) return 'tee';
  return 'top';
}

function denimBrand(title) {
  const t = title || '';
  if (/gallery\s*dept|gallery\s*department/i.test(t)) return 'Gallery Dept';
  if (/true\s*religion/i.test(t)) return 'True Religion';
  if (/\bevisu\b/i.test(t)) return 'Evisu';
  if (/\bamiri\b/i.test(t)) return 'Amiri';
  if (/purple\s*brand/i.test(t)) return 'Purple';
  if (/\bdiesel\b/i.test(t)) return 'Diesel';
  if (/\bace\s*(denim|jeans|selvedge)/i.test(t)) return 'Ace';
  if (/\bbig\s*e\b/i.test(t)) return 'Big E';
  if (/levi'?s|\blevis\b|\blvc\b|\blevi\b/i.test(t)) return "Levi's";
  return 'other';
}

function collectibleKind(title) {
  if (/\b(psa|bgs|sgc|cgc|panini|topps|bowman|prizm|chrome|rookie card|trading card|\bcards?\b|slab|patch card)\b/i.test(title || '')) {
    return 'card';
  }
  return 'memorabilia';
}

function watchTier(title) {
  const t = title || '';
  if (/nautilus|aquanaut|patek|richard mille|\brm\s*\d|royal oak|audemars|paul newman|perpetual|tourbillon|minute repeater|daytona|high complication/i.test(t)) {
    return 'grail';
  }
  return 'trending';
}

function classifyFacets(title, category) {
  const facets = {};
  if (category === 'sneakers') facets.family = sneakerFamily(title);
  if (category === 'streetwear') {
    facets.apparel = streetwearApparel(title);
    if (facets.apparel === 'denim') facets.denim_brand = denimBrand(title);
  }
  if (category === 'collectibles') facets.kind = collectibleKind(title);
  if (category === 'watches') facets.tier = watchTier(title);
  return facets;
}

function mapRow(row) {
  const category = String(row.category || '').toLowerCase();
  if (!WALLS.includes(category)) return null;
  const sale = Number(row.sale_price || row.price || 0);
  if (!sale) return null;
  const orig = Number(row.original_price || row.sold_avg || sale);
  const classified = classifyFacets(row.title || '', category);
  const family = row.family || classified.family || null;
  const apparel = row.apparel || classified.apparel || null;
  const denim_brand = apparel === 'denim' ? row.denim_brand || classified.denim_brand || null : null;
  const kind = row.collectible_kind || row.kind || classified.kind || null;
  const tier = row.watch_tier || row.tier || classified.tier || null;
  const facets = {};
  if (category === 'sneakers' && family) facets.family = family;
  if (category === 'streetwear' && apparel) {
    facets.apparel = apparel;
    if (denim_brand) facets.denim_brand = denim_brand;
  }
  if (category === 'collectibles' && kind) facets.kind = kind;
  if (category === 'watches' && tier) facets.tier = tier;
  return {
    title: row.title,
    category,
    item_type: row.item_type || 'physical',
    original_price: orig,
    sale_price: sale,
    discount_percent: row.discount_percent == null ? null : Number(row.discount_percent),
    affiliate_url: affiliateUrl(row.affiliate_url || ''),
    image_url: row.image_url || '',
    source_platform: row.source_platform || 'ebay',
    currency: row.currency || 'USD',
    ebay_id: row.ebay_id || null,
    family: category === 'sneakers' ? family : null,
    apparel: category === 'streetwear' ? apparel : null,
    denim_brand: category === 'streetwear' ? denim_brand : null,
    kind: category === 'collectibles' ? kind : null,
    tier: category === 'watches' ? tier : null,
    facets
  };
}

async function fromInventory() {
  const select = [
    'title',
    'category',
    'item_type',
    'original_price',
    'sale_price',
    'discount_percent',
    'affiliate_url',
    'image_url',
    'source_platform',
    'currency',
    'ebay_id',
    'family',
    'apparel',
    'denim_brand',
    'collectible_kind',
    'watch_tier'
  ].join(',');
  const url = `${SUPABASE_URL}/rest/v1/inventory?is_active=eq.true&category=in.(${WALLS.join(',')})&select=${select}&order=sale_price.desc&limit=1000`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`
    }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const mapped = mapRow(row);
    if (!mapped) continue;
    const key = mapped.ebay_id || mapped.affiliate_url || mapped.title;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(mapped);
  }
  if (!items.length) return null;
  return { count: items.length, items, source: 'inventory' };
}

async function snapshot(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (!host) return null;
  const res = await fetch(`${proto}://${host}/listings.json`);
  if (!res.ok) return null;
  const body = await res.json();
  if (!body.items || !body.items.length) return null;
  body.items = body.items.map((row) => mapRow(row)).filter(Boolean);
  body.count = body.items.length;
  return body;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const live = await fromInventory();
    if (live) return res.status(200).json(live);
  } catch (_) {}

  try {
    const snap = await snapshot(req);
    if (snap) return res.status(200).json({ ...snap, source: 'snapshot' });
  } catch (_) {}

  return res.status(502).json({
    error: 'Unable to load listings. Check API endpoint configuration.',
    items: []
  });
};
