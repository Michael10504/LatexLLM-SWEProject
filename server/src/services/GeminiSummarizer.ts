/**
 * WS-6 / IF-07: Google Gemini as the cloud summarization provider (FR-05.4).
 * The key travels in the x-goog-api-key header, never in the URL (NFR-08).
 * Nothing is written to disk (FR-05.8).
 */

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Free-tier Flash model. Override with GEMINI_MODEL in server/.env. */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

export const SUMMARY_PROMPT = [
  'You are summarizing an academic research paper for a researcher.',
  'Write a plain-text summary of 150 to 250 words covering, in this order:',
  'the research question, the method, the key results (with the most important numbers),',
  'the main conclusion, and any stated limitations.',
  'Use only information found in the paper. Do not invent results or citations.',
  'Do not use Markdown, headings or bullet points.'
].join(' ');

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeminiOptions {
  model?: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
}

export class GeminiError extends Error {
  public readonly name = 'GeminiError';
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

export async function summarizeWithGemini(
  pdfBuffer: Buffer,
  fileName: string,
  apiKey: string,
  signal: AbortSignal,
  options: GeminiOptions = {}
): Promise<string> {
  const model = options.model?.trim() || GEMINI_DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? GEMINI_BASE_URL).replace(/\/+$/, '');
  const fetchFn: FetchLike = options.fetchFn ?? ((input, init) => fetch(input, init));
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
          { text: `${SUMMARY_PROMPT}\nFile name: ${fileName}` }
        ]
      }
    ]
  };

  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(body),
    signal
  });

  let data: GeminiResponse = {};
  try {
    data = (await response.json()) as GeminiResponse;
  } catch {
    // Non-JSON body; handled below.
  }

  if (!response.ok) {
    throw new GeminiError(describeHttpError(response.status, data), response.status);
  }

  if (data.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini refused to process this file (${data.promptFeedback.blockReason}).`);
  }

  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim();

  if (!text) {
    const reason = candidate?.finishReason ? ` (finish reason: ${candidate.finishReason})` : '';
    throw new GeminiError(`Gemini returned an empty summary${reason}.`);
  }
  return text;
}

function describeHttpError(status: number, data: GeminiResponse): string {
  if (status === 429) return 'Gemini free-tier rate limit reached. Wait a minute and retry.';
  if (status === 401 || status === 403) return 'Gemini rejected the API key. Check CLOUD_SUMMARY_API_KEY in server/.env.';
  if (status === 404) return 'Gemini model not found. Check GEMINI_MODEL in server/.env.';
  const detail = data.error?.message ? `: ${data.error.message}` : '';
  return `Gemini returned HTTP ${status}${detail}`;
}