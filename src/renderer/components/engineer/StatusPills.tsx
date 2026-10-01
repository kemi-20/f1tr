import { useEngineerStore, useConfigStore } from '../../store'

type Status = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: 'thinking', label: 'THINKING', color: '#FFB020' },
  { id: 'speaking', label: 'SPEAKING', color: '#FF6A00' },
  { id: 'error', label: 'ERROR', color: '#FF3B3B' }
]

export function StatusPills(): React.ReactElement {
  const status = useEngineerStore((s) => s.status)
  const speaking = useEngineerStore((s) => s.speaking)
  const pitwall = useConfigStore((s) => s.config?.ui.style === 'pitwall')
  if (pitwall) {
    const current = STATUSES.find(s => s.id === status)
    return <div className="radio-status" role="status">
      <span style={{ color: current?.color ?? '#a1a5ac' }}><i />{current?.label ?? 'STANDBY'}</span>
      {speaking && status !== 'speaking' && <span style={{ color: '#30d7ab' }}><i />SPEAKING</span>}
    </div>
  }
  return (
    <div className="status-pills">
      {STATUSES.map((s) => {
        const active = s.id === 'speaking' ? speaking : status === s.id
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
