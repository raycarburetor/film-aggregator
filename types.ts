export type CinemaKey = 'bfi' | 'princecharles' | 'ica' | 'castle' | 'garden' | 'genesis'

export type Screening = {
  id: string
  filmTitle: string
  cinema: CinemaKey
  screeningStart: string
  screeningEnd?: string
  bookingUrl?: string
  releaseDate?: string
  // Optional: release year as stated on the cinema website (parsed from listing)
  websiteYear?: number
  director?: string
  synopsis?: string
  genres?: string[]
  posterPath?: string
  tmdbId?: number
  imdbId?: string
  rottenTomatoesPct?: number | null
  // Letterboxd average rating (0–5). Preferred over Rotten Tomatoes in UI.
  letterboxdRating?: number | null
}
