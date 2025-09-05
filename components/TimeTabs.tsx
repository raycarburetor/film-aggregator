'use client'
import { useRouter, useSearchParams } from 'next/navigation'

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
] as const

export default function TimeTabs() {
  const router = useRouter()
  const sp = useSearchParams()
  const current = (sp.get('window') || 'all') as 'today'|'week'|'month'|'all'

  function setWindowTab(tab: string) {
    const params = new URLSearchParams(sp.toString())
    if (tab && tab !== 'all') params.set('window', tab)
    else params.delete('window')
    router.push(`/?${params.toString()}`)
  }

  return (
    <div className="flex gap-2">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setWindowTab(key)}
          aria-selected={current===key}
          className={`tab-btn px-3 py-2 text-sm font-normal ${current===key ? 'bg-[rgb(var(--hover))] text-white':''}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
