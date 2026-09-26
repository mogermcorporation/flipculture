import { GetServerSideProps } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  try {
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
    <title>Flip Culture Product Feed</title>
    <link>https://flipculture-two.vercel.app</link>
    <description>Top eBay listings and products for Flip Culture</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${itemsXml}
  </channel>
</rss>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.write(xml);
    res.end();
  } catch (err) {
    res.statusCode = 500;
    res.end();
  }

  return { props: {} };
};

export default function Feed() {
  return null;
}
