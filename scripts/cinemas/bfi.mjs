import { chromium as pwChromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'

pwChromium.use(stealth())

// Scrape BFI Southbank via the A–Z "filmsindex" listing and per-film article
// pages. AudienceView's old search endpoint is aggressively Cloudflare-gated
// and its result shape has changed; the filmsindex route is stable and each
// article page renders its upcoming performances server-side as:
//   "Saturday 02 May 2026 11:50 Screen NFT2 Buy"
//   "Wednesday 13 May 2026 18:30" \n "Blue Room"

const FILMS_INDEX_URL =
  'https://whatson.bfi.org.uk/Online/default.asp?BOparam::WScontent::loadArticle::permalink=filmsindex&BOparam::WScontent::loadArticle::context_id=&menu_id=ECC1B0C0-AC0D-4914-9822-E98048BE29DA'

const MONTHS = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
}

async function gotoAndClear(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  // Poll up to 30s for Cloudflare "Just a moment…" to clear. The rendered
  // article pages are short (~2–3 KB); the challenge shell is ~260 chars.
  for (let i = 0; i < 30; i++) {
    const info = await page.evaluate(() => ({
      title: document.title,
      len: document.body?.innerText?.length || 0,
    }))
    if (!/just a moment/i.test(info.title) && info.len > 1200) return true
    await page.waitForTimeout(1000)
  }
  return false
}

function parsePerformances(text) {
  const out = []
  const re =
    /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s+(\d{1,2}):(\d{2})/g
  let m
  while ((m = re.exec(text))) {
    const day = Number(m[2])
    const mo = MONTHS[m[3]]
    const yr = Number(m[4])
    const hh = Number(m[5])
    const mm = Number(m[6])
    const when = new Date(yr, mo, day, hh, mm)
    if (isNaN(when.getTime())) continue
    // Extract venue from up to ~80 chars after the time, collapsing whitespace.
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80)
      .replace(/\s+/g, ' ')
      .trim()
    let venue
    const mv1 = after.match(/^Screen\s+([A-Za-z0-9]+)\b/)
    const mv2 = !mv1 && after.match(/^(Blue Room|Studio|NFT\d+)\b/)
    if (mv1) venue = `Screen ${mv1[1]}`
    else if (mv2) venue = mv2[1]
    out.push({ when, venue })
  }
  return out
}

function extractYear(text) {
  // Prefer the year that appears in the inline stats block:
  //   "Director Don Bluth With … USA 1986. 80min"
  const stats = text.match(/\b[A-Z][A-Za-z ]{0,30}?\s((?:19|20)\d{2})\.\s*\d{1,3}\s*min\b/)
  if (stats) {
    const y = Number(stats[1])
    if (y >= 1895 && y <= new Date().getFullYear() + 1) return y
  }
  const anyYear = text.match(/\b(19|20)\d{2}\b/)
  if (anyYear) {
    const y = Number(anyYear[0])
    if (y >= 1895 && y <= new Date().getFullYear() + 1) return y
  }
  return undefined
}

function extractDirector(text) {
  // Stop the director name at a subsequent known keyword or country.
  const re =
    /Director[s]?\s+(.{1,80}?)\s+(?:With\s+(?:voices|cast|\w)|\b(?:UK|USA|US|Germany|France|Italy|Japan|China|Spain|Netherlands|Belgium|Sweden|Norway|Denmark|Finland|Ireland|Australia|Canada|Brazil|Argentina|Mexico|India|Iran|Turkey|Poland|Czech|Russia|Ukraine|Hungary|Greece|Portugal|Korea|Taiwan|Thailand|Vietnam|Egypt|Morocco|Nigeria|South Africa|New Zealand)\b|\b(?:19|20)\d{2}\b)/
  const m = text.match(re)
  if (!m) return undefined
  return m[1].replace(/\s+/g, ' ').trim() || undefined
}

export async function fetchBFI() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const horizonDays = Number(
    process.env.BFI_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 60
  )
  const maxFilms = Number(
    process.env.BFI_MAX_DETAIL_PAGES ?? Number.MAX_SAFE_INTEGER
  )
  const now = new Date()
  const cutoff = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000)

  // 1) Load A–Z index and harvest film article URLs.
  const indexCleared = await gotoAndClear(page, FILMS_INDEX_URL)
  if (!indexCleared) {
    await browser.close()
    console.log('[BFI] filmsindex did not clear Cloudflare')
    return []
  }

  const filmLinks = await page.evaluate(() => {
    const seen = new Set()
    const out = []
    // Feature/aggregate pages that share the article/* URL shape but are not
    // individual films (they wrap lists of screenings or site info).
    const NON_FILM_SLUGS = new Set([
      '35mm70mmscreenings',
      'bfisouthbankguide',
      'accessiblescreenings',
      'programmenotes',
      'programmechanges',
    ])
    const NON_FILM_TITLE = /^(download|find\b|become a member|bfi southbank guide)/i
    for (const a of document.querySelectorAll('a[href^="article/"]')) {
      const title = (a.textContent || '').replace(/\s+/g, ' ').trim()
      if (!title || NON_FILM_TITLE.test(title)) continue
      const url = new URL(a.getAttribute('href'), location.href).toString()
      const slug = url.split('/').pop() || ''
      if (NON_FILM_SLUGS.has(slug)) continue
      if (seen.has(url)) continue
      seen.add(url)
      out.push({ title, url })
    }
    return out
  })

  const slice = filmLinks.slice(0, maxFilms)
  console.log(
    '[BFI] filmsindex films:',
    filmLinks.length,
    '| scraping detail for:',
    slice.length
  )

  // 2) Visit each film page and parse performances.
  const screenings = []
  for (const film of slice) {
    try {
      const ok = await gotoAndClear(page, film.url)
      if (!ok) continue
      // Give any server-rendered perf block a moment.
      await page.waitForTimeout(300)
      const detail = await page.evaluate(() => ({
        h1: document.querySelector('h1')?.textContent?.trim() || '',
        text: document.body.innerText || '',
      }))
      const title = detail.h1 || film.title
      const perfs = parsePerformances(detail.text)
      if (!perfs.length) continue
      const year = extractYear(detail.text)
      const director = extractDirector(detail.text)
      for (const p of perfs) {
        if (p.when < now || p.when > cutoff) continue
        const iso = p.when.toISOString()
        const screening = {
          id: `bfi-${title}-${iso}`.replace(/\W+/g, ''),
          filmTitle: title,
          cinema: 'bfi',
          screeningStart: iso,
          bookingUrl: film.url,
          filmUrl: film.url,
        }
        if (year) {
          const sy = p.when.getFullYear()
          if (year <= sy + 1) screening.websiteYear = year
        }
        if (director) screening.director = director
        if (p.venue) screening.venue = p.venue
        screenings.push(screening)
      }
    } catch {}
  }

  await browser.close()
  console.log('[BFI] screenings collected:', screenings.length)
  return screenings
}
