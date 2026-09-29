import { describe, expect, it, vi } from 'vitest'
import { EngineerService, manualFiring } from './EngineerService'
import { getEngineerSkill } from './EngineerSkillLibrary'

vi.mock('../ipc/sender', () => ({ Sender: { send: vi.fn() } }))
vi.mock('../logging/Logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

describe('engineer radio style', () => {
  it('passes the selected style and its voice direction to the audio pipeline', () => {
    const engineer = new EngineerService()
    const speak = vi.fn()
    engineer.setSpeakHandler(speak)
    engineer.setVoice('Milo', 'calm, decisive F1 race engineer')
    engineer.setEngineerStyle('bozzi')
    engineer.acceptRadio('Target lap is 1:33.2.', manualFiring())
    expect(speak).toHaveBeenCalledWith('Target lap is 1:33.2.', expect.anything(),
      'Milo', getEngineerSkill('bozzi').ttsDirection, 'bozzi')
  })
})
