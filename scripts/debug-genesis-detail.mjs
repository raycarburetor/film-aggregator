// Usage: node scripts/debug-genesis-detail.mjs <genesis_event_url>
import { chromium as pwChromium } from 'playwright'

const url = process.argv[2]
if (!url) {
  console.error('Provide a Genesis event URL, e.g. https://www.genesiscinema.co.uk/event/99419')
  process.exit(1)
}

const browser = await pwChromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London' })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}
try { await page.waitForSelector('p, .text-gray-600, script[type="application/ld+json"]', { timeout: 10000 }) } catch {}

const out = await page.evaluate(() => {
  const res = {}
  const get = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\s+/g,' ').trim()
  res.title = get('h1, .title, .film-title')
  res.pWithDirectedBy = []
  const ps = Array.from(document.querySelectorAll('p, .text-gray-600'))
  for (const p of ps) {
    const txt = (p.textContent || '').replace(/\s+/g,' ').trim()
    if (/directed\s*by/i.test(txt)) res.pWithDirectedBy.push(txt)
  }
  const bolds = Array.from(document.querySelectorAll('p b, p strong')).map(b => (b.textContent||'').trim())
  res.boldLabels = bolds
  res.ldDirectors = []
  try {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent || 'null')
        const arr = Array.isArray(data) ? data : [data]
        for (const obj of arr) {
          const d = obj?.director
          if (typeof d === 'string') res.ldDirectors.push(d)
          else if (Array.isArray(d)) res.ldDirectors.push(...d.map(x=>x?.name).filter(Boolean))
          else if (typeof d === 'object' && d?.name) res.ldDirectors.push(d.name)
        }
      } catch {}
    }
  } catch {}
  return res
})

console.log(JSON.stringify(out, null, 2))

await browser.close()

