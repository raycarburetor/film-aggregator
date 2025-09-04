import { fetchPrinceCharles } from './cinemas/princecharles.mjs'

const items = await fetchPrinceCharles()
console.log('Found', items.length, 'screenings (PCC)')
console.log(items.slice(0, 10))

