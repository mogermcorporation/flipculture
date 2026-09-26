import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

export async function GET() {
  const { data: products } = await supabase
    .from('product_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  const itemsXml = (products || [])
    .map(
      (item) => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <guid>${item.ebay_item_id}</guid>
      <link>${item.affiliate_url}</link>
      <price>$${item.price} ${item.currency}</price>
      <media:content url="${item.image_url}" medium="image" />
      <pubDate>${new Date(item.created_at).toUTCString()}</pubDate>
    </item>`
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Flip Culture Feed</title>
    <link>https://flipculture-two.vercel.app</link>
    <description>Top eBay listings for Flip Culture</description>
    ${itemsXml}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate',
    },
  });
}
