// Convert a wall-clock time in Europe/London to a real instant, independent of
// the host's TZ. `new Date(y, m, d, h, mm)` uses the process timezone, which is
// UTC on GitHub runners — so during BST every screening would be stored an
// hour late. Use this instead for any time scraped from a London cinema.

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

// Minutes London is ahead of UTC at instant `ts` (0 in GMT, 60 in BST).
function londonOffsetMinutes(ts) {
  const parts = fmt.formatToParts(new Date(ts))
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - ts) / 60000)
}

/**
 * @param {number} year
 * @param {number} month 1–12
 * @param {number} day
 * @param {number} hour 0–23
 * @param {number} minute
 * @returns {Date}
 */
export function londonDate(year, month, day, hour = 0, minute = 0) {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  let ts = wall - londonOffsetMinutes(wall) * 60000
  // Re-check near DST transitions, where the offset at `wall` can differ from
  // the offset at the resulting instant.
  const off2 = londonOffsetMinutes(ts)
  ts = wall - off2 * 60000
  return new Date(ts)
}
