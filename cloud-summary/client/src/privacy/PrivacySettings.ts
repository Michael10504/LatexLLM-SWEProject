import { SettingsStore } from './SettingsStore';

export type LocalOnlyListener = (localOnly: boolean) => void;

/**
 * CD-4a «singleton» PrivacySettings
 *
 * FR-06.1: ONE global Local Only setting for all projects on the device,
 * reachable from the login screen and the main window, persisted across restarts.
 *
 * Construct exactly one instance at app start and share it (dependency
 * injection rather than a static singleton, so tests can create fresh ones).
 * Listeners are how NetworkGateway, FeatureControls and LocalOnlyIndicator
 * are "notified" (Figure 11, step 4 / step 17).
 */
export class PrivacySettings {
  private localOnly: boolean;
  private readonly listeners = new Set<LocalOnlyListener>();

  constructor(private readonly store: SettingsStore) {
    this.localOnly = store.load();
  }

  public isLocalOnly(): boolean {
    return this.localOnly;
  }

  /** Figure 11 steps 3 and 16: toggle, persist (step 21), then notify. */
  public setLocalOnly(on: boolean): void {
    if (on === this.localOnly) return;
    this.localOnly = on;
    this.store.persist(on);
    for (const listener of this.listeners) {
      listener(on);
    }
  }

  /** Returns an unsubscribe function. */
  public onChange(listener: LocalOnlyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
