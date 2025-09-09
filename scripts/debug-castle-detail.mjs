// Usage: node scripts/debug-castle-detail.mjs <castle_url>
import { chromium as pwChromium } from 'playwright'

const url = process.argv[2]
if (!url) { console.error('Provide a Castle URL, e.g. https://thecastlecinema.com/bookings/14462/materialists'); process.exit(1) }

const browser = await pwChromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London' })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}

const out = await page.evaluate(() => {
  const res = {}
  const txt = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\s+/g,' ').trim()
  res.title = txt('h1, .film-title, .title, .tile-name, .poster_name')
  res.filmDirectorSpan = txt('span.film-director')
  res.metaLines = Array.from(document.querySelectorAll('.meta .meta-line')).map(el => (el.textContent || '').replace(/\s+/g,' ').trim())
  res.filmLinks = Array.from(document.querySelectorAll('a[href*="/film/"]')).map(a => a.getAttribute('href'))
  return res
})

console.log(JSON.stringify(out, null, 2))
await browser.close()

