// Usage: node scripts/debug-barbican-detail.mjs <barbican_event_url>
import { chromium as pwChromium } from 'playwright'

const url = process.argv[2]
if (!url) {
  console.error('Provide a Barbican event URL, e.g. https://www.barbican.org.uk/whats-on/2025/event/christy')
  process.exit(1)
}

const browser = await pwChromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London' })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}
try { await page.waitForSelector('.label-value-list, .label-value-list__label, div.sidebar-item', { timeout: 10000 }) } catch {}

const res = await page.evaluate(() => {
  const dump = []
  const scopes = Array.from(document.querySelectorAll('div.sidebar-item .label-value-list, .sidebar-item .label-value-list, .label-value-list'))
  for (const scope of scopes) {
    const rows = Array.from(scope.querySelectorAll('.label-value-list__row'))
    if (rows.length) {
      for (const r of rows) {
        const lab = (r.querySelector('.label-value-list__label')?.textContent || '').replace(/\s+/g, ' ').trim()
        const valEl = r.querySelector('.label-value-list__value')
        const anchors = Array.from(valEl?.querySelectorAll('a') || []).map(a => (a.textContent || '').trim()).filter(Boolean)
        const val = anchors.length ? anchors.join(', ') : ((valEl?.textContent || '').replace(/\s+/g, ' ').trim())
        if (lab || val) dump.push({ lab, val })
      }
    } else {
      const labs = Array.from(scope.querySelectorAll('.label-value-list__label'))
      for (const labEl of labs) {
        const lab = (labEl.textContent || '').replace(/\s+/g, ' ').trim()
        let dd = labEl.nextElementSibling
        while (dd && !(dd.classList?.contains('label-value-list__value'))) {
          if (dd.classList?.contains('label-value-list__label')) break
          dd = dd.nextElementSibling
        }
        const anchors = Array.from(dd?.querySelectorAll('a') || []).map(a => (a.textContent || '').trim()).filter(Boolean)
        const val = anchors.length ? anchors.join(', ') : ((dd?.textContent || '').replace(/\s+/g, ' ').trim())
        if (lab || val) dump.push({ lab, val })
      }
    }
  }
  return dump
})

console.log('Found', res.length, 'rows in label-value-list:')
for (const row of res) console.log('-', row.lab, '=>', row.val)

await browser.close()

