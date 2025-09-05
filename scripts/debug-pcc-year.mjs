// Usage: node scripts/debug-pcc-year.mjs <film_or_booknow_url>
import { chromium as pwChromium } from 'playwright'

const url = process.argv[2]
if (!url) {
  console.error('Provide a PCC URL, e.g. https://princecharlescinema.com/film/31617133/the-toxic-avenger-uncut/')
  process.exit(1)
}

function extractYear(s) {
  const m = String(s || '').match(/\b(19|20)\d{2}\b/)
  return m ? Number(m[0]) : undefined
}

const browser = await pwChromium.launch({ headless: true })
const page = await browser.newPage({ timezoneId: 'Europe/London' })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

// Prefer film detail UL, then booknow UL
try {
  await page.waitForSelector('ul.movie-info li:first-child, ul.movie-info.booknow-movieinfo li:first-child', { timeout: 15000 })
} catch {}

const res = await page.evaluate(() => {
  function text(sel) { return document.querySelector(sel)?.textContent?.trim() || '' }
  const title = text('h1, h2, .film-title, .poster_name, .poster-name, .title')
  const rawDetail = text('ul.movie-info li:first-child')
  const rawBook = text('ul.movie-info.booknow-movieinfo li:first-child')
  return { title, rawDetail, rawBook }
})

await browser.close()

const yrDetail = extractYear(res.rawDetail)
const yrBook = extractYear(res.rawBook)
const picked = yrDetail ?? yrBook

console.log('Title:', res.title)
console.log('Film detail first <li>:', res.rawDetail || '—', '=>', yrDetail ?? '—')
console.log('Booknow first <li>:', res.rawBook || '—', '=>', yrBook ?? '—')
console.log('Picked year:', picked ?? '—')

