'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function MobileSearch() {
  const router = useRouter()
  const sp = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')

  useEffect(() => {
    // Keep input in sync if URL changes externally
    setQ(sp.get('q') ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(sp.toString())
      if (q.trim()) params.set('q', q.trim())
      else params.delete('q')
      router.push(`/?${params.toString()}`)
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  return (
    <div className="px-0">
      <input
        type="search"
        value={q}
        onChange={e=>setQ(e.target.value)}
        placeholder="Search by film or director"
        className="w-full rounded-lg border px-3 py-2"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        autoCorrect="off"
      />
    </div>
  )
}
