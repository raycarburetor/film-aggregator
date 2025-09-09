import { Pool } from 'pg'
import type { Screening } from '@/types'

// Lazily created singleton Pool. Uses DATABASE_URL.
let pool: Pool | null = null

function getPool(): Pool | null {
  const cs = process.env.DATABASE_URL
  if (!cs) return null
  if (!pool) {
    // Enable SSL when the connection string indicates it (e.g. Supabase, Neon),
    // or when running in production. This avoids self-signed cert errors locally.
    const needsSsl = /sslmode=require/i.test(cs) || /[?&]ssl=true/i.test(cs) || /(supabase|neon|vercel)/i.test(cs)
    // If the URL has ssl=true, strip it so our explicit ssl options take effect.
    let connectionString = cs
    try {
      const u = new URL(cs)
      if (u.searchParams.get('ssl') === 'true') {
        u.searchParams.delete('ssl')
        connectionString = u.toString()
      }
    } catch {}
    pool = new Pool({
      connectionString,
      ssl: needsSsl || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 5,
    })
    pool.on('error', (err) => {
      console.error('[db] pool error', err)
    })
  }
  return pool
}

// Convert snake_case DB keys to camelCase to match our API/type shape
function toCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function coerceIso(val: unknown): string | undefined {
  if (val == null) return undefined
  if (val instanceof Date) return val.toISOString()
  const s = String(val)
  // If s is a valid date string, return as-is; otherwise undefined
  const t = new Date(s)
  return isNaN(t.getTime()) ? undefined : t.toISOString()
}

function coerceNum(val: unknown): number | undefined {
  if (val == null) return undefined
  const n = Number(val)
  return Number.isFinite(n) ? n : undefined
}

function coerceGenres(val: unknown): string[] | undefined {
  if (Array.isArray(val)) return val.filter(Boolean).map(String)
  if (typeof val === 'string') {
    const arr = val.split(/[|,]/).map(s => s.trim()).filter(Boolean)
    return arr.length ? arr : undefined
  }
  return undefined
}

function mapRowToScreening(row: Record<string, any>): Screening {
  // Normalize keys to camelCase first
  const obj: Record<string, any> = {}
  for (const [k, v] of Object.entries(row)) obj[toCamelKey(k)] = v

  const s: Screening = {
    id: String(obj.id),
    filmTitle: String(obj.filmTitle ?? ''),
    cinema: String(obj.cinema) as any,
    screeningStart: coerceIso(obj.screeningStart) || String(obj.screeningStart || ''),
    screeningEnd: coerceIso(obj.screeningEnd),
    bookingUrl: obj.bookingUrl ? String(obj.bookingUrl) : undefined,
    // Ensure releaseDate is a stable ISO string so frontend slice(0,4) yields a year
    releaseDate: coerceIso(obj.releaseDate),
    websiteYear: coerceNum(obj.websiteYear),
    director: obj.director ? String(obj.director) : undefined,
    synopsis: obj.synopsis ? String(obj.synopsis) : undefined,
    genres: coerceGenres(obj.genres),
    posterPath: obj.posterPath ? String(obj.posterPath) : undefined,
    tmdbId: coerceNum(obj.tmdbId),
    imdbId: obj.imdbId ? String(obj.imdbId) : undefined,
    rottenTomatoesPct: obj.rottenTomatoesPct == null ? null : (coerceNum(obj.rottenTomatoesPct) ?? null),
    letterboxdRating: obj.letterboxdRating == null ? null : (coerceNum(obj.letterboxdRating) ?? null),
  }
  return s
}

function sanitizeTableName(name: string | undefined): string {
  const fallback = 'listings'
  if (!name) return fallback
  return /^[A-Za-z0-9_]+$/.test(name) ? name : fallback
}

export async function getAllListings(): Promise<Screening[] | null> {
  const p = getPool()
  if (!p) return null
  const table = sanitizeTableName(process.env.LISTINGS_TABLE)
  // Select all columns; we'll map keys to camelCase in JS.
  // Consumers filter by time window and other params in the route.
  const sql = `select * from ${table}`
  const res = await p.query(sql)
  const items = res.rows.map(mapRowToScreening)
  // Drop clearly malformed entries (lack filmTitle or screeningStart)
  return items.filter(i => i && i.filmTitle && i.screeningStart)
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {})
    pool = null
  }
}
