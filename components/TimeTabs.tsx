'use client'
import { useRouter, useSearchParams } from 'next/navigation'

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
] as const

export default function TimeTabs() {
  const router = useRouter()
  const sp = useSearchParams()
  const current = (sp.get('window') || 'week') as 'today'|'week'|'month'

  function setWindowTab(tab: string) {
    const params = new URLSearchParams(sp.toString())
    // 'week' is the default; omit the param when selecting it
    if (tab === 'week') params.delete('window')
    else params.set('window', tab)
    router.push(`/?${params.toString()}`)
  }

  return (
    <div className="flex gap-2">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setWindowTab(key)}
          aria-selected={current===key}
          className={`tab-btn px-3 py-2 text-base ${current===key ? 'bg-[rgb(var(--hover))] text-white':''}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
