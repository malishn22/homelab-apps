/** Safely extract a human-readable error message from an unknown caught value. */
export const getErrorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);
