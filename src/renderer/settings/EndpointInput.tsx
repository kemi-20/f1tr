import { useEffect, useState } from 'react'
import { TextInput } from './SettingsModal'

/** Keep partially typed URLs local; main-process validation still guards persistence. */
export function EndpointInput({ value, placeholder, onSave }: {
  value: string; placeholder: string; onSave: (value: string) => Promise<void>
}): React.ReactElement {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(value); setError('') }, [value])
  const save = (): void => {
    const next = draft.trim()
    if (next === value) return
    try {
      if (next) {
        const url = new URL(next)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error()
      }
      setError('')
      void onSave(next).catch(() => setError('地址保存失败，请重试'))
    } catch { setError('请输入完整的 HTTP 或 HTTPS 地址') }
  }
  return <div className="flex flex-col gap-1">
    <TextInput value={draft} placeholder={placeholder} aria-invalid={!!error}
      onChange={(e) => { setDraft(e.target.value); setError('') }} onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
    {error && <span role="alert" className="text-xs text-red-300">{error}</span>}
  </div>
}
