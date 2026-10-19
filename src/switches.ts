import type { Storage } from './database'

/**
 * Feature switches the owner flips with /tools and /web. Kept in runtime_meta
 * rather than config.yaml so they survive restarts without editing files.
 */
export type SwitchName = 'tools' | 'web'

const KEY = (name: SwitchName) => `switch.${name}`

export class RuntimeSwitches {
  constructor(private storage: Storage) {}

  /** Missing or unreadable values count as off: every switch defaults to closed. */
  get(name: SwitchName) { return this.storage.getMeta(KEY(name)) === 'on' }

  set(name: SwitchName, on: boolean) { this.storage.setMeta(KEY(name), on ? 'on' : 'off') }
}
