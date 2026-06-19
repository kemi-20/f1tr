import { useEngineerStore } from '../../store'

type Status = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: 'listening', label: 'LISTENING', color: '#2DD4BF' },
  { id: 'thinking', label: 'THINKING', color: '#FFB020' },
  { id: 'speaking', label: 'SPEAKING', color: '#FF6A00' },
  { id: 'error', label: 'ERROR', color: '#FF3B3B' }
]

export function StatusPills(): React.ReactElement {
  const status = useEngineerStore((s) => s.status)
  return (
    <div className="flex items-center gap-2">
      {STATUSES.map((s) => {
        const active = status === s.id
        return (
          <div
            key={s.id}
            className="chip border transition-colors duration-200"
            style={{
              borderColor: active ? s.color : 'rgba(255,255,255,0.08)',
              color: active ? s.color : 'rgba(255,255,255,0.3)',
              background: active ? `${s.color}22` : 'transparent',
              boxShadow: active ? `0 0 12px ${s.color}55` : 'none'
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: active ? s.color : 'rgba(255,255,255,0.2)',
                boxShadow: active ? `0 0 6px ${s.color}` : 'none'
              }}
            />
            {s.label}
          </div>
        )
      })}
    </div>
  )
}
