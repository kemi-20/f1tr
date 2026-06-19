/**
 * Shared types & constants — imported by BOTH main and renderer.
 * This is the only island shared between processes.
 * No main imports renderer, no renderer imports main; both import @shared/*.
 */

export * from './types/config'
export * from './types/ipc'
export * from './types/audio'
export * from './types/triggers'
export * from './types/state'
export * from './types/digest'

export * from './constants/voices'
export * from './constants/packets'
export * from './constants/tracks'

export * from './util/format'
