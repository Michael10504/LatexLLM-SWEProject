/** Public diagnostics use fixed messages only, never upstream bodies or keys. */
export class CloudProviderError extends Error {
    constructor(message: string, public readonly retryable = false) { super(message); this.name = 'CloudProviderError'; }
}
export function providerHttpError(status: number): CloudProviderError {
    const help: Record<number,string> = {
        400: 'Cloud provider rejected the request (HTTP 400). Check the saved API key, model ID and PDF. For Gemini, use a Gemini API key, not an OAuth token.',
        401: 'Cloud provider rejected the API key (HTTP 401). Enter a valid key in Account API settings and save it.',
        403: 'Cloud provider denied access (HTTP 403). Check API-key restrictions, project permissions, billing and regional availability.',
        404: 'Cloud model or endpoint was not found (HTTP 404). Choose a Gemini model ID available to your API key and save the settings.',
        413: 'Cloud provider rejected the document size (HTTP 413). Try a smaller PDF.',
        429: 'Cloud provider quota or rate limit reached (HTTP 429). Check quota and billing, or wait before retrying.'
    };
    return new CloudProviderError(help[status] || `Cloud provider returned HTTP ${status}. Try again later or check provider availability.`, status === 429 || status >= 500);
}
export function providerNetworkError(error: any): CloudProviderError {
    const code = error?.cause?.code || error?.code;
    if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code))
        return new CloudProviderError('Secure connection to the cloud provider failed certificate validation. Configure the trusted certificate authority for the server; do not disable TLS verification.');
    if (['ENOTFOUND','EAI_AGAIN'].includes(code)) return new CloudProviderError('Cloud provider hostname could not be resolved. Check the server internet connection and DNS.', true);
    return new CloudProviderError('Could not connect to the cloud provider. Check the server internet connection, proxy or firewall, then retry.', true);
}
