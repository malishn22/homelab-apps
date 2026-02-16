/** Check whether a string looks like a Minecraft game version (e.g. "1.20.1"). */
export const isGameVersion = (value?: string): boolean => {
    if (!value) return false;
    const v = value.trim().toLowerCase();
    if (v.includes('fabric') || v.includes('forge') || v.includes('loader') || v.includes('quilt')) return false;
    const release = /^\d+(\.\d+){1,2}([.-](pre|rc)\d+)?$/i;
    return release.test(v);
};

/** Compare two version strings in descending order (newest first). */
export const compareVersionsDesc = (a?: string, b?: string): number => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const va = pa[i] ?? 0;
        const vb = pb[i] ?? 0;
        if (va !== vb) return vb - va;
    }
    return 0;
};
