import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { credentialStore } from '../repositories/CredentialStore';
import { logger } from '../config/logger';
import { GeminiError, summarizeWithGemini } from '../services/GeminiSummarizer';

export type CloudProviderFn = (
  pdfBuffer: Buffer,
  fileName: string,
  apiKey: string,
  signal: AbortSignal
) => Promise<string>;

export class SummarizationController {
  public static readonly MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB (FR-05.1)
  public static readonly TIMEOUT_MS = 60 * 1000;           // 60 seconds (FR-05.6)

  private cloudProviderFn: CloudProviderFn;

  constructor() {
    this.cloudProviderFn = this.defaultCloudRelay.bind(this);
  }

  // Allows formal tests (Step 5) to inject a slow/failing mock cloud service (FR-05.6)
  public setCloudProviderFn(fn: CloudProviderFn): void {
    this.cloudProviderFn = fn;
  }

  public resetCloudProviderFn(): void {
    this.cloudProviderFn = this.defaultCloudRelay.bind(this);
  }

  private async defaultCloudRelay(
    pdfBuffer: Buffer,
    fileName: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<string> {
    if ((process.env.CLOUD_SUMMARY_PROVIDER || '').trim().toLowerCase() === 'gemini') {
      if (!process.env.CLOUD_SUMMARY_API_KEY) {
        logger.error('CLOUD_SUMMARY_PROVIDER=gemini but CLOUD_SUMMARY_API_KEY is not set in server/.env');
        throw new GeminiError('The summarization service is not configured on the server (missing API key).');
      }
      return summarizeWithGemini(pdfBuffer, fileName, apiKey, signal, {
        model: process.env.GEMINI_MODEL
      });
    }
    const externalEndpoint = process.env.CLOUD_SUMMARY_ENDPOINT;

    // If a live external provider URL is configured in .env, relay over HTTPS with 60s timeout
    if (externalEndpoint) {
      const response = await fetch(externalEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/pdf',
          'X-File-Name': fileName
        },
        body: new Uint8Array(pdfBuffer),
        signal
      });

      if (!response.ok) {
        throw new Error(`Cloud provider returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as { summary?: string };
      if (!data.summary) {
        throw new Error('Cloud provider returned an empty summary.');
      }
      return data.summary;
    }

    // Default local relay response for Sprint 1 demo when no external URL is set
    return `Summary of "${fileName}" (${pdfBuffer.byteLength} bytes): This paper presents the core methodology, experimental evaluation, and key findings extracted via stateless cloud summarization relay.`;
  }

  // POST /summarize (UC-15, FR-05.1, FR-05.4, FR-05.6, FR-05.8, NFR-08)
  public async summarize(req: AuthenticatedRequest, res: Response): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SummarizationController.TIMEOUT_MS);

    try {
      const file = req.file;
      const consentConfirmed = req.body?.consent === 'true' || req.body?.consent === true;

      if (!consentConfirmed) {
        res.status(400).json({
          error: 'Explicit per-request user consent is required before transmitting a PDF (FR-05.2).'
        });
        return;
      }

      if (!file || !file.buffer) {
        res.status(400).json({ error: 'No PDF file provided for summarization.' });
        return;
      }

      // 1. Validate size <= 20 MB and valid %PDF- magic header (FR-05.1)
      if (file.size > SummarizationController.MAX_PDF_BYTES) {
        res.status(400).json({ error: 'PDF exceeds the maximum allowed size of 20 MB (FR-05.1).' });
        return;
      }

      const header = file.buffer.subarray(0, 5).toString('ascii');
      if (header !== '%PDF-') {
        res.status(400).json({ error: 'Invalid file format: File must be a valid PDF document (FR-05.1).' });
        return;
      }

      // 2. Retrieve decrypted provider API key in memory without logging it (NFR-08)
      const providerName = (req.body?.provider as string) || 'default-cloud-provider';
      const apiKey = credentialStore.getApiKey(providerName);

      logger.info(
        {
          event: 'CLOUD_SUMMARIZE_RELAY',
          fileName: file.originalname,
          fileSize: file.size,
          provider: providerName,
          apiKey: apiKey // Automatically censored to [REDACTED_BY_NFR08] by pino logger!
        },
        'Relaying PDF to cloud summarization service (stateless, zero disk storage)'
      );

      // 3. Stream/relay buffer to cloud provider with 60-second timeout (FR-05.4, FR-05.6, FR-05.8)
      const summary = await this.cloudProviderFn(
        file.buffer,
        file.originalname,
        apiKey,
        controller.signal
      );

      // 4. Return read-only summary; buffer is garbage-collected immediately (FR-05.5, FR-05.8)
      res.status(200).json({
        fileName: file.originalname,
        provider: providerName,
        summary,
        readOnly: true
      });
    } catch (error: any) {
      const isTimeout = error?.name === 'AbortError' || controller.signal.aborted;
      if (isTimeout) {
        res.status(504).json({
          error: 'Cloud summarization service timed out after 60 seconds.',
          retryable: true
        });
        return;
      }

            logger.warn(
        { event: 'CLOUD_SUMMARIZE_FAILED', providerStatus: error instanceof GeminiError ? error.status : undefined },
        'Cloud summarization failed'
      );
      res.status(502).json({
        error: error instanceof GeminiError
          ? error.message
          : 'Cloud summarization service is unreachable or returned an error.',
        retryable: true
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const summarizationController = new SummarizationController();
