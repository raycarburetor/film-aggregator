// Usage: node scripts/debug-closeup-detail.mjs <closeup_film_url>
import { chromium as pwChromium } from 'playwright'

const url = process.argv[2]
if (!url) { console.error('Provide a Close-Up film URL'); process.exit(1) }

const browser = await pwChromium.launch({ headless: true })
const page = await browser.newPage({ timezoneId: 'Europe/London' })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}

const out = await page.evaluate(() => {
  const res = {}
  const scope = document.querySelector('div#film_program_support.inner_block_2_l, #film_program_support') || document
  const get = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\s+/g,' ').trim()
  res.title = get('h1, title')
  res.anchors = Array.from(scope.querySelectorAll('a[href]')).map(a => ({
    href: a.getAttribute('href'),
    text: (a.textContent || '').replace(/\s+/g,' ').trim()
  }))
  res.bodySnippet = (document.body.textContent || '').slice(0,500)
  return res
})

console.log(JSON.stringify(out, null, 2))
await browser.close()

