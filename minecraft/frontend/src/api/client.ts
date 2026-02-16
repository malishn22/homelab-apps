/**
 * Centralized API client with typed responses, AbortController support,
 * and optional retry logic.
 */

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly statusText: string,
        public readonly body: string,
    ) {
        super(`API error ${status}: ${body || statusText}`);
        this.name = 'ApiError';
    }
}

interface RequestOptions {
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
    /** Extra headers to merge */
    headers?: Record<string, string>;
    /** Number of retry attempts for 5xx errors (default: 0) */
    retries?: number;
    /** Base delay between retries in ms (default: 1000, doubles each attempt) */
    retryDelay?: number;
}

function sanitizeErrorBody(status: number, body: string): string {
    const trimmed = body.trim();
    if (trimmed.toLowerCase().startsWith('<!') || trimmed.toLowerCase().includes('<html')) {
        if (status === 502) return 'Backend unavailable (Bad Gateway).';
        if (status >= 500) return 'Server error. Try again later.';
    }
    return trimmed.slice(0, 200) || '';
}

async function parseResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const body = await res.text();
        const message = sanitizeErrorBody(res.status, body) || res.statusText;
        throw new ApiError(res.status, res.statusText, message);
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        return res.json() as Promise<T>;
    }
    return res.text() as unknown as T;
}

async function withRetry<T>(fn: () => Promise<T>, retries: number, delay: number): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const isRetryable =
                err instanceof ApiError && err.status >= 500 && attempt < retries;
            if (!isRetryable) throw err;
            await new Promise((r) => setTimeout(r, delay * Math.pow(2, attempt)));
        }
    }
    throw lastError;
}

export function createApiClient(baseUrl: string) {
    const request = async <T>(
        method: string,
        path: string,
        body?: unknown,
        options: RequestOptions = {},
    ): Promise<T> => {
        const { signal, headers: extraHeaders, retries = 0, retryDelay = 1000 } = options;
        const url = `${baseUrl}${path}`;

        const headers: Record<string, string> = { ...extraHeaders };
        let bodyStr: string | undefined;

        if (body !== undefined && body !== null) {
            if (typeof body === 'string') {
                headers['Content-Type'] = headers['Content-Type'] ?? 'text/plain';
                bodyStr = body;
            } else {
                headers['Content-Type'] = 'application/json';
                bodyStr = JSON.stringify(body);
            }
        }

        const doFetch = () =>
            fetch(url, { method, headers, body: bodyStr, signal }).then((res) =>
                parseResponse<T>(res),
            );

        return withRetry(doFetch, retries, retryDelay);
    };

    return {
        get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
        post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
            request<T>('POST', path, body, opts),
        put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
            request<T>('PUT', path, body, opts),
        patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
            request<T>('PATCH', path, body, opts),
        delete: <T>(path: string, opts?: RequestOptions) =>
            request<T>('DELETE', path, undefined, opts),
    };
}

/** Pre-configured client: VITE_API_BASE_URL for direct backend, else /api (proxy) */
const API_BASE = (() => {
    const envBase = (import.meta.env.VITE_API_BASE_URL ?? '').toString().replace(/\/+$/, '');
    return envBase ? `${envBase}/api` : '/api';
})();
export const api = createApiClient(API_BASE);
