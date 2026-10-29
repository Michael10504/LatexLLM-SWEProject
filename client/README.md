# WS-6 — Cloud PDF Summarization + Local Only stub (client)

Client-side half of IF-07 and the FR-06.1 PrivacyGuard stub. The server half
(`POST /summarize`, stateless relay, encrypted key) is WS-1's
`src/controllers/SummarizationController.ts`; this module talks to it.

## Requirement map

| Requirement | Where | Test |
|---|---|---|
| FR-05.1 valid PDF, ≤ 20 MB, ≤ 100 pages, transmit nothing otherwise | `summarization/PdfValidator.ts`, `SummarizationService.summarize` | `summarization.clienttest.ts` |
| FR-05.2 modal consent: file name, size, provider, third-party statement; one request only | `summarization/Consent.ts`, `ui/dom.ts DomConsentDialog` | both test files |
| FR-05.3 Cancel / close → nothing sent | `SummarizationService`, `DomConsentDialog` (Cancel, Esc, click-outside) | both |
| FR-05.4 cloud only for summaries, single exit point | `network/NetworkGateway.ts`, `CloudSummarizerAdapter`, `eslint.network-rule.json` | `privacy.clienttest.ts` |
| FR-05.5 read-only summary, never inserted | `ui/dom.ts DomSummaryPanel` | both |
| FR-05.6 error / 60 s timeout → Retry | `CloudSummarizerAdapter`, `DomSummaryFeedback` | both |
| FR-05.7 Local Only → popup, no dialog, nothing sent | `SummarizationService.start` + per-attempt re-check | `summarization.clienttest.ts` |
| FR-06.1 one global, persisted Local Only setting (login screen + main window) | `privacy/PrivacySettings.ts`, `SettingsStore.ts`, `PrivacyGuard.ts`, `DomLocalOnlyToggle` | both |

Also covered on the way: in-flight abort within 1 s (FR-06.2), loopback exempt
(FR-06.4), indicator (FR-06.5), no replay (FR-06.6), TLS-only (NFR-08).

## Run

```bash
npm run test:client       # 42 tests (jest + ts-jest, jsdom for the UI tests)
npm run typecheck:client
```

## Wiring (Electron renderer or main)

```ts
import { createWs6, FileSettingsStore } from './client/src';
import { DomConsentDialog, DomSummaryPanel, DomSummaryFeedback } from './client/src/ui/dom';

const ws6 = createWs6({
  settingsStore: new FileSettingsStore(`${userDataDir}/settings.json`),
  session: authClient,                       // WS-1: implements SessionSource
  server: { serverBaseUrl: 'https://<project-server>:3443', providerName: 'Your provider' },
  consentDialog: new DomConsentDialog(),
  summaryPanel: new DomSummaryPanel(document.getElementById('summary')!),
  feedback: new DomSummaryFeedback(document.getElementById('ai-status')!),
  requireLogin: () => showLoginScreen()
});

// "Summarize paper" button:
if (!ws6.summarization.start()) {
  const file = await pickPdf();               // { name, bytes: Uint8Array }
  await ws6.summarization.summarize(file);
}
```

Give `ws6.gateway` and `ws6.guard` to WS-1 (AuthClient), and to SharingClient
and SyncService later, so every outbound request goes through the same gateway.

## Notes for the team

- The default page counter is dependency-free. For exact counts on compressed
  PDFs, pass a PDF.js counter via `pageCounter` (Design Spec 4.1).
- Client tests use the `*.clienttest.ts` suffix so the root `npm test` (server)
  does not pick them up.
- Local dev against the HTTP fallback server: pass
  `gatewayOptions: { allowInsecureLoopback: true }`. Non-loopback hosts always
  require https.
