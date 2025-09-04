export type CinemaKey = 'bfi' | 'princecharles' | 'ica' | 'castle'

export type Screening = {
  id: string
  filmTitle: string
  cinema: CinemaKey
  screeningStart: string
  screeningEnd?: string
  bookingUrl?: string
  releaseDate?: string
  director?: string
  synopsis?: string
  genres?: string[]
  posterPath?: string
  tmdbId?: number
  imdbId?: string
  rottenTomatoesPct?: number | null
}
