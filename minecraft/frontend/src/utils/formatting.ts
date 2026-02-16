/** Format a large number with K/M suffixes. */
export const formatDownloads = (downloads?: number): string => {
    if (typeof downloads !== 'number') return 'N/A';
    if (downloads >= 1_000_000) return `${(downloads / 1_000_000).toFixed(1)}M`;
    if (downloads >= 1_000) return `${(downloads / 1_000).toFixed(1)}K`;
    return downloads.toString();
};

/** Format followers count, returning null when unavailable. */
export const formatFollowers = (followers?: number): string | null => {
    if (typeof followers !== 'number') return null;
    return formatDownloads(followers);
};

/** Format a date string as a human-readable relative or absolute date. */
export const formatUpdated = (dateStr?: string): string => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return 'N/A';

    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 7) {
        const diffHours = diffMs / (1000 * 60 * 60);
        if (diffHours < 1) {
            const mins = Math.max(1, Math.floor(diffHours * 60));
            return `${mins} min${mins === 1 ? '' : 's'} ago`;
        }
        if (diffHours < 24) {
            const hrs = Math.max(1, Math.floor(diffHours));
            return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
        }
        const days = Math.max(1, Math.floor(diffDays));
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }

    return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};
