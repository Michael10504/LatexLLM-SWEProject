/**
 * @jest-environment jsdom
 */
import { PrivacySettings } from '../src/privacy/PrivacySettings';
import { InMemorySettingsStore } from '../src/privacy/SettingsStore';
import { THIRD_PARTY_STATEMENT } from '../src/summarization/Consent';
import {
  DomConsentDialog,
  DomLocalOnlyIndicator,
  DomLocalOnlyToggle,
  DomSummaryFeedback,
  DomSummaryPanel
} from '../src/ui/dom';

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('ConsentDialog (FR-05.2, FR-05.3)', () => {
  const request = { fileName: 'thesis.pdf', sizeBytes: 2 * 1024 * 1024, provider: 'Acme', statement: THIRD_PARTY_STATEMENT };

  it('shows file name, size, provider and statement in a modal', () => {
    void new DomConsentDialog().show(request);
    expect(q('consent-dialog')?.getAttribute('aria-modal')).toBe('true');
    expect(q('consent-file')?.textContent).toBe('thesis.pdf');
    expect(q('consent-size')?.textContent).toBe('2.0 MB');
    expect(q('consent-provider')?.textContent).toBe('Acme');
    expect(q('consent-statement')?.textContent).toBe(THIRD_PARTY_STATEMENT);
  });

  it('Send returns an unused consent and removes the dialog', async () => {
    const p = new DomConsentDialog().show(request);
    q('consent-send')!.click();
    const consent = await p;
    expect(consent?.isUsed()).toBe(false);
    expect(q('consent-dialog')).toBeNull();
  });

  it.each([
    ['Cancel', () => q('consent-cancel')!.click()],
    ['Escape (close)', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['click outside', () => q('consent-backdrop')!.click()]
  ])('%s returns null', async (_label, act) => {
    const p = new DomConsentDialog().show(request);
    act();
    expect(await p).toBeNull();
  });

  it('never renders file names as HTML', () => {
    void new DomConsentDialog().show({ ...request, fileName: '<img src=x onerror=alert(1)>.pdf' });
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('SummaryPanel (FR-05.5)', () => {
  it('renders the summary in a read-only field', () => {
    const container = document.createElement('div');
    document.body.append(container);
    new DomSummaryPanel(container).showReadOnly('x.pdf', '<b>not bold</b>');
    const text = q('summary-text') as HTMLTextAreaElement;
    expect(text.readOnly).toBe(true);
    expect(text.value).toBe('<b>not bold</b>');
    expect(document.querySelector('b')).toBeNull();
  });
});

describe('Error with Retry (FR-05.6)', () => {
  it('Retry resolves true; Close resolves false; no Retry button when not retryable', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const fb = new DomSummaryFeedback(container);

    const a = fb.showError('timeout', { retry: true });
    q('summary-retry')!.click();
    expect(await a).toBe(true);

    const b = fb.showError('timeout', { retry: true });
    q('summary-dismiss')!.click();
    expect(await b).toBe(false);

    void fb.showError('local only', { retry: false });
    expect(q('summary-retry')).toBeNull();
  });
});

describe('Local Only toggle and indicator (FR-06.1, FR-06.5)', () => {
  it('two toggles (login screen + main window) stay in sync with one setting', () => {
    const settings = new PrivacySettings(new InMemorySettingsStore());
    const login = document.createElement('div');
    const main = document.createElement('div');
    document.body.append(login, main);
    new DomLocalOnlyToggle(login, settings);
    new DomLocalOnlyToggle(main, settings);
    new DomLocalOnlyIndicator(main, settings);

    const [loginBox, mainBox] = Array.from(
      document.querySelectorAll('[data-testid="local-only-toggle"]')
    ) as HTMLInputElement[];
    const badge = q('local-only-indicator')!;
    expect(badge.hidden).toBe(true);

    loginBox.click();
    expect(settings.isLocalOnly()).toBe(true);
    expect(mainBox.checked).toBe(true);
    expect(badge.hidden).toBe(false);

    mainBox.click();
    expect(settings.isLocalOnly()).toBe(false);
    expect(loginBox.checked).toBe(false);
    expect(badge.hidden).toBe(true);
  });
});
