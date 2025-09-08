// Usage: node scripts/debug-garden-detail.mjs <garden_film_url>
import { chromium as pwChromium } from 'playwright'

const url = process.argv[2]
if (!url) {
  console.error('Provide a Garden film URL, e.g. https://www.thegardencinema.co.uk/film/young-mothers/')
  process.exit(1)
}

const browser = await pwChromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London' })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}

const out = await page.evaluate(() => {
  const res = {}
  const getTxt = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\s+/g,' ').trim()
  res.title = getTxt('h1, .film-detail__title, .film-title, .title')
  res.stats = getTxt('div.film-detail__film__stats')
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
  // Scan for any labels that include Director
  res.labelHits = []
  const nodes = Array.from(document.querySelectorAll('p,li,dt,dd,section,article,div'))
  for (const el of nodes) {
    const tx = (el.textContent || '').replace(/\s+/g,' ').trim()
    if (/\bdirector\b/i.test(tx) || /directed by/i.test(tx)) {
      res.labelHits.push(tx.slice(0,200))
      if (res.labelHits.length > 10) break
    }
  }
  return res
})

console.log(JSON.stringify(out, null, 2))

await browser.close()

