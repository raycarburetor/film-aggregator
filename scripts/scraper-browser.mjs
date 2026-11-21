// Shared Playwright launcher for cinema sites fronted by a Cloudflare challenge
// (BFI Southbank, Close-Up). On GitHub's Azure runners Cloudflare challenges
// far more aggressively than on a home connection, and a few things made our
// browser trivially recognisable there:
//   - a hard-coded "Macintosh … Chrome/124" UA on a Linux box running
//     Chromium 140 (navigator.platform / userAgentData disagree with the UA)
//   - headless mode
//   - navigator.webdriver = true (Close-Up ran plain Playwright, no stealth)
// This helper keeps the UA consistent with the real browser + OS, applies the
// stealth plugin once, and lets CI run headed under Xvfb via SCRAPER_HEADED=1.

import os from 'node:os'
import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'

chromium.use(stealth())

function platformToken() {
  switch (os.platform()) {
    case 'darwin':
      return 'Macintosh; Intel Mac OS X 10_15_7'
    case 'win32':
      return 'Windows NT 10.0; Win64; x64'
    default:
      return 'X11; Linux x86_64'
  }
}

export function isHeaded(extraFlag) {
  const on = (v) => !!v && v !== '0' && v.toLowerCase?.() !== 'false'
  return on(process.env.SCRAPER_HEADED) || on(extraFlag)
}

/**
 * Launch Chromium and open a London-localised context.
 * @param {{ headed?: boolean }} [opts]
 * @returns {Promise<{ browser: import('playwright').Browser, ctx: import('playwright').BrowserContext }>}
 */
export async function launchScraperBrowser(opts = {}) {
  const headed = opts.headed ?? isHeaded()
  const browser = await chromium.launch({
    headless: !headed,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const major = String(browser.version()).split('.')[0] || '140'
  const userAgent = `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
  const ctx = await browser.newContext({
    userAgent,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    viewport: { width: 1366, height: 900 },
  })
  return { browser, ctx }
}

/** True once the page is no longer showing Cloudflare's interstitial. */
export async function isPastChallenge(page) {
  try {
    const title = await page.title()
    return !/just a moment|attention required|checking your browser/i.test(title)
  } catch {
    return false
  }
}
