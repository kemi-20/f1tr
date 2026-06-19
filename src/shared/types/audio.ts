/** Audio-related shared types. */
export type Priority = 'critical' | 'high' | 'normal' | 'low'

export interface SynthRequest {
  id: string
  text: string
  priority: Priority
  voice: string
  direction: string
}
