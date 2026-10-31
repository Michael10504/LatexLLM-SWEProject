import { CloudProviderError } from '../services/CloudProviderError';
import { Response } from 'express';

import { AuthenticatedRequest } from '../middleware/authMiddleware';

import { credentialStore } from '../repositories/CredentialStore';

import { logger } from '../config/logger';

import { readSettings, accountSummary } from '../repositories/AccountCloudSettings';

import { PDFDocument } from 'pdf-lib';



export type CloudProviderFn = (

  pdfBuffer: Buffer,

  fileName: string,

  apiKey: string,

  signal: AbortSignal

) => Promise<string>;



export class SummarizationController {

  public static readonly MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB (FR-05.1)

  public static readonly TIMEOUT_MS = 5 * 60 * 1000;           // 5 minutes (FR-05.6)



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

    const externalEndpoint = process.env.CLOUD_SUMMARY_ENDPOINT;

    if (process.env.CLOUD_SUMMARY_STUB === '1') {

      return `[DEMO STUB — not an AI summary] "${fileName}" (${pdfBuffer.byteLength} bytes). No third-party provider was called.`;

    }



    // If a live external provider URL is configured in .env, relay over HTTPS with 60s timeout

    if (externalEndpoint) {

      if (new URL(externalEndpoint).protocol !== 'https:') throw new Error('Cloud provider must use HTTPS.');

      const response = await fetch(externalEndpoint, {

        method: 'POST',

        headers: {

          'Authorization': `Bearer ${apiKey}`,

          'Content-Type': 'application/pdf',

          'X-File-Name': fileName

        },

        body: new Uint8Array(pdfBuffer),

        signal

        ,redirect: 'error'

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



    throw new Error('Cloud provider is not configured.');

  }



  // POST /summarize (UC-15, FR-05.1, FR-05.4, FR-05.6, FR-05.8, NFR-08)

  public async summarize(req: AuthenticatedRequest, res: Response): Promise<void> {

    const controller = new AbortController();

    const timeoutId = setTimeout(() => controller.abort(), SummarizationController.TIMEOUT_MS);

    const disconnected = () => { if (!res.writableEnded) controller.abort(); };

    res.on('close', disconnected);



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

      try {

        const document = await PDFDocument.load(file.buffer, { updateMetadata: false });

        if (document.getPageCount() < 1 || document.getPageCount() > 100) {

          res.status(400).json({ error: 'PDF must contain between 1 and 100 pages.' }); return;

        }

      } catch {

        res.status(400).json({ error: 'PDF is unreadable or encrypted.' }); return;

      }

      const account = await readSettings(req.user!.username);

      if (!account && process.env.CLOUD_SUMMARY_STUB !== '1' && !process.env.CLOUD_SUMMARY_ENDPOINT) {

        res.status(503).json({ error: 'No Gemini API key is saved for this account. Open Paper summary > Account API settings and save your key.', retryable: false });

        return;

      }



      // 2. Retrieve decrypted provider API key in memory without logging it (NFR-08)

      const providerName = (req.body?.provider as string) || 'default-cloud-provider';

      const apiKey = account?.apiKey || (process.env.CLOUD_SUMMARY_STUB === '1' ? '' : credentialStore.getApiKey(providerName));



      logger.info(

        {

          event: 'CLOUD_SUMMARIZE_RELAY',

          fileName: file.originalname,

          fileSize: file.size,

          provider: providerName

        },

        'Relaying PDF to cloud summarization service (stateless, zero disk storage)'

      );



      // 3. Stream/relay buffer to cloud provider with 5-minute timeout (FR-05.4, FR-05.6, FR-05.8)

      const summary = account && process.env.CLOUD_SUMMARY_STUB !== '1'

        ? await accountSummary({ ...account, provider: account.provider as 'gemini' | 'custom' }, account.apiKey, file.buffer, controller.signal)

        : await this.cloudProviderFn(

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

      if (res.destroyed) return;

      const isTimeout = error?.name === 'AbortError' || controller.signal.aborted;

      if (isTimeout) {

        res.status(504).json({

          error: 'Cloud summarization service timed out after 5 minutes.',

          retryable: true

        });

        return;

      }



      if (error instanceof CloudProviderError) {
        res.status(502).json({ error: error.message, retryable: error.retryable }); return;
      }
      res.status(502).json({

        error: 'Cloud summarization service is unreachable or returned an error.',

        retryable: true

      });

    } finally {

      clearTimeout(timeoutId);

      res.removeListener('close', disconnected);

      if (req.file) req.file.buffer = Buffer.alloc(0);

    }

  }

}



export const summarizationController = new SummarizationController();

