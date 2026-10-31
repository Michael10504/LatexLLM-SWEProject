import { SessionSource } from './auth/SessionSource';
import { NetworkGateway, NetworkGatewayOptions } from './network/NetworkGateway';
import { PrivacyGuard } from './privacy/PrivacyGuard';
import { PrivacySettings } from './privacy/PrivacySettings';
import { SettingsStore } from './privacy/SettingsStore';
import { PageCounter, PdfValidator } from './summarization/PdfValidator';
import { SummarizationService } from './summarization/SummarizationService';
import { CloudSummarizerAdapter, CloudSummarizerAdapterOptions } from './summarization/SummarizerAdapter';
import { ConsentDialog, SummaryFeedback, SummaryPanel } from './ui/views';

export * from './auth/SessionSource';
export * from './network/errors';
export * from './network/NetworkGateway';
export * from './privacy/PrivacyGuard';
export * from './privacy/PrivacySettings';
export * from './privacy/SettingsStore';
export * from './summarization/Consent';
export * from './summarization/PdfValidator';
export * from './summarization/ExactPageCounter';
export * from './summarization/SummarizationService';
export * from './summarization/SummarizerAdapter';
export * from './ui/views';

export interface Ws6Config {
  settingsStore: SettingsStore;
  session: SessionSource;
  server: CloudSummarizerAdapterOptions;
  consentDialog: ConsentDialog;
  summaryPanel: SummaryPanel;
  feedback: SummaryFeedback;
  requireLogin: () => void;
  gatewayOptions?: NetworkGatewayOptions;
  /** Pass a PDF.js-based counter in the Electron client. */
  pageCounter?: PageCounter;
}

/**
 * Composition root for WS-6. Call once at app start, BEFORE the login screen
 * renders, so the persisted Local Only flag applies from the first frame.
 * Hand `gateway` and `guard` to the other tracks (AuthClient, SharingClient,
 * SyncService) so every outbound call shares the same exit point.
 */
export function createWs6(config: Ws6Config) {
  const settings = new PrivacySettings(config.settingsStore);
  const guard = new PrivacyGuard(settings);
  const gateway = new NetworkGateway(guard, config.gatewayOptions);
  gateway.attach(settings);

  const adapter = new CloudSummarizerAdapter(gateway, config.server);
  const summarization = new SummarizationService({
    guard,
    session: config.session,
    validator: new PdfValidator(config.pageCounter),
    adapter,
    consentDialog: config.consentDialog,
    summaryPanel: config.summaryPanel,
    feedback: config.feedback,
    requireLogin: config.requireLogin
  });

  return { settings, guard, gateway, adapter, summarization };
}
