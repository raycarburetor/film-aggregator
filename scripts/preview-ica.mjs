import { fetchICA } from './cinemas/ica.mjs'

const items = await fetchICA()
console.log('Found', items.length, 'screenings (ICA)')
console.log(items.slice(0, 10))

