import { chromium as pwChromium } from 'playwright'
import fs from 'node:fs/promises'

const browser = await pwChromium.launch({ headless: true })
const ctx = await browser.newContext({ timezoneId: 'Europe/London', locale: 'en-GB' })
const page = await ctx.newPage()
await page.goto('https://ica.art/films/next-7-days', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(1500)

const html = await page.$eval('#docket', el => el.outerHTML).catch(()=> '')
const anchors = await page.$$eval('#docket a[href]', as => as.map(a => ({ href: a.getAttribute('href'), text: (a.textContent||'').trim() })))
await fs.writeFile('./tmp-ica-docket.html', html || 'NO-DOCKET', 'utf8')
await fs.writeFile('./tmp-ica-anchors.json', JSON.stringify(anchors, null, 2), 'utf8')
console.log('Saved tmp-ica-docket.html and tmp-ica-anchors.json; anchor count:', anchors.length)
await browser.close()

