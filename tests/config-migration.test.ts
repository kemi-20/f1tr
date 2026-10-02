import { expect, it, vi } from 'vitest'
import { mergeConfig } from '../src/shared/types/config'
import { ConfigStore } from '../src/main/config/ConfigStore'
const f = vi.hoisted(() => ({ stored: {} as any }))
vi.mock('electron-store', () => ({ default: class {
  constructor(options: any) { f.stored = { ...structuredClone(options.defaults), ...f.stored } }
  get store() { return f.stored }
  get(key: string) { return f.stored[key] }
  set(key: string, value: unknown) { f.stored[key] = value }
} }))
vi.mock('../src/main/config/env.ts', () => ({ loadSecrets: () => ({ aiBaseURL: '', aiKey: '', aiModel: '', mimoBaseURL: '', mimoKey: '' }) }))
it('preserves explicitly chosen former defaults after one-time migration', () => {
  const cfg = ConfigStore.patch({ triggers: { heartbeatIntervalS: 60, tyreHotC: 110 }, ui: { accent: '#2DD4BF' } })
  expect(f.stored.triggers.heartbeatIntervalS).toBe(60)
  expect(f.stored.triggers.tyreHotC).toBe(110)
  expect(cfg.triggers.heartbeatIntervalS).toBe(60)
  expect(cfg.triggers.tyreHotC).toBe(110)
  expect(cfg.ui.accent).toBe('#2DD4BF')
  expect(f.stored.migrationVersion).toBe(1)
  expect(ConfigStore.getAll().triggers.heartbeatIntervalS).toBe(60)
})

it('persists legacy migration once and respects new choices across restarts', async () => {
  f.stored = mergeConfig({ triggers: { heartbeatIntervalS: 60, globalMinGapS: 8, tyreColdC: 80, tyreHotC: 110 }, ui: { accent: '#2DD4BF' } })
  vi.resetModules()
  const migrated = (await import('../src/main/config/ConfigStore')).ConfigStore
  expect(migrated.getAll().triggers.heartbeatIntervalS).toBe(150)
  expect(f.stored.triggers.tyreHotC).toBe(115)
  expect(f.stored.migrationVersion).toBe(1)
  migrated.patch({ triggers: { heartbeatIntervalS: 60, tyreHotC: 110 }, ui: { accent: '#2DD4BF' } })
  vi.resetModules()
  const restarted = (await import('../src/main/config/ConfigStore')).ConfigStore
  expect(restarted.getAll().triggers.heartbeatIntervalS).toBe(60)
  expect(restarted.getAll().triggers.tyreHotC).toBe(110)
  expect(restarted.getAll().ui.accent).toBe('#2DD4BF')
})
