import { readFileSync, writeFileSync, existsSync } from 'fs';
import { XMLParser } from 'fast-xml-parser';
import sgMail from '@sendgrid/mail';

const SITEMAP_URL = 'https://opsima.com/blog/wp-sitemap-posts-post-1.xml';
const KNOWN_URLS_FILE = new URL('./known-urls.json', import.meta.url).pathname;
const FROM_EMAIL = 'daniel.shashko@gmail.com';
const TO_EMAIL = 'alon@simaanalytics.com';

async function fetchSitemap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false });
  const result = parser.parse(xml);
  const entries = result?.urlset?.url ?? [];
  const urls = Array.isArray(entries) ? entries : [entries];
  return urls.map(u => String(u.loc)).filter(Boolean);
}

async function fetchPageMeta(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const html = await res.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaMatch =
      html.match(/<meta\s+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i) ||
      html.match(/<meta\s+content=["']([\s\S]*?)["'][^>]*name=["']description["']/i);

    const decode = s =>
      s.replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"')
       .replace(/&#8211;/g, '–')
       .replace(/&#8217;/g, "'")
       .trim();

    return {
      title: titleMatch ? decode(titleMatch[1]) : url,
      description: metaMatch ? decode(metaMatch[1]) : 'No description available.',
    };
  } catch {
    return { title: url, description: 'Could not fetch page metadata.' };
  }
}

function loadKnownUrls() {
  if (!existsSync(KNOWN_URLS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(KNOWN_URLS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveKnownUrls(urls) {
  writeFileSync(KNOWN_URLS_FILE, JSON.stringify(urls, null, 2) + '\n');
}

function buildEmailHtml(newPosts) {
  const postCards = newPosts
    .map(
      post => `
    <div style="margin-bottom:20px;padding:16px 20px;background:#f8fafc;border-left:4px solid #2563eb;border-radius:6px;">
      <h3 style="margin:0 0 6px;font-size:16px;line-height:1.4;">
        <a href="${post.url}" style="color:#1d4ed8;text-decoration:none;">${post.title}</a>
      </h3>
      <p style="margin:0 0 10px;color:#475569;font-size:14px;line-height:1.5;">${post.description}</p>
      <a href="${post.url}" style="font-size:12px;color:#94a3b8;">${post.url}</a>
    </div>`
    )
    .join('\n');

  return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#1e293b;max-width:620px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 6px;font-size:22px;">
    📝 ${newPosts.length} New Post${newPosts.length !== 1 ? 's' : ''} on the Opsima Blog
  </h2>
  <p style="color:#64748b;margin:0 0 24px;font-size:14px;">
    The following article${newPosts.length !== 1 ? 's were' : ' was'} published since the last check:
  </p>
  ${postCards}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 16px;" />
  <p style="color:#94a3b8;font-size:12px;margin:0;">
    Automated sitemap monitor ·
    <a href="https://opsima.com/blog" style="color:#94a3b8;">View all posts</a>
  </p>
</body>
</html>`;
}

async function sendEmail(newPosts) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error('SENDGRID_API_KEY env var is not set.');
  sgMail.setApiKey(apiKey);

  const count = newPosts.length;
  await sgMail.send({
    to: TO_EMAIL,
    from: FROM_EMAIL,
    subject: `📝 ${count} New Post${count !== 1 ? 's' : ''} Published on Opsima Blog`,
    html: buildEmailHtml(newPosts),
  });

  console.log(`✅ Email sent to ${TO_EMAIL} for ${count} new post(s).`);
}

async function main() {
  console.log(`🔍 Fetching sitemap: ${SITEMAP_URL}`);
  const currentUrls = await fetchSitemap(SITEMAP_URL);
  console.log(`   Found ${currentUrls.length} URL(s) in sitemap.`);

  const knownUrls = loadKnownUrls();

  // First run: bootstrap without sending email
  if (knownUrls.length === 0) {
    console.log('⚙️  First run — bootstrapping known URLs. No email sent.');
    saveKnownUrls(currentUrls);
    console.log(`   Saved ${currentUrls.length} URL(s) as baseline.`);
    return;
  }

  const knownSet = new Set(knownUrls);
  const newUrls = currentUrls.filter(url => !knownSet.has(url));
  console.log(`   ${newUrls.length} new URL(s) detected.`);

  if (newUrls.length > 0) {
    console.log('🌐 Fetching metadata for new posts...');
    const newPosts = await Promise.all(
      newUrls.map(async url => {
        const meta = await fetchPageMeta(url);
        console.log(`   • ${meta.title}`);
        return { url, ...meta };
      })
    );

    await sendEmail(newPosts);
  } else {
    console.log('ℹ️  No new posts found. No email sent.');
  }

  saveKnownUrls(currentUrls);
  console.log('💾 Updated known-urls.json committed.');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
