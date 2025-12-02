import React, { useEffect, useMemo, useState } from 'react';
import { Modpack } from '../types';
import { Search, Download, Sparkles } from 'lucide-react';

const formatDownloads = (downloads?: number): string => {
    if (typeof downloads !== 'number') return 'N/A';
    if (downloads >= 1_000_000) return `${(downloads / 1_000_000).toFixed(1)}M`;
    if (downloads >= 1_000) return `${(downloads / 1_000).toFixed(1)}K`;
    return downloads.toString();
};

const mapApiHitToModpack = (hit: any, idx: number): Modpack => ({
    id: hit.project_id || hit.slug || `modpack-${idx}`,
    title: hit.title ?? 'Untitled',
    description: hit.description ?? 'No description available.',
    author: hit.author || hit.author_name || 'Unknown',
    downloads: formatDownloads(hit.downloads),
    categories: hit.categories || hit.loaders || [],
    imageUrl: hit.icon_url || `https://api.dicebear.com/7.x/shapes/svg?seed=${hit.slug || idx}`,
});

interface ModpackBrowserProps {
    onSelect?: (modpack: Modpack) => void;
}

const ModpackBrowser: React.FC<ModpackBrowserProps> = ({ onSelect }) => {
    const [modpacks, setModpacks] = useState<Modpack[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchTop = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const resp = await fetch('/api/modpacks/top?limit=15');
                if (!resp.ok) {
                    throw new Error(`API request failed (${resp.status})`);
                }
                const data = await resp.json();
                const items = Array.isArray(data?.items) ? data.items : [];
                setModpacks(items.map(mapApiHitToModpack));
            } catch (err: any) {
                setError(err?.message || 'Failed to load modpacks.');
            } finally {
                setIsLoading(false);
            }
        };

        fetchTop();
    }, []);

    const filteredPacks = useMemo(() => {
        const q = searchQuery.toLowerCase();
        return modpacks.filter((pack) =>
            pack.title.toLowerCase().includes(q) || pack.description.toLowerCase().includes(q)
        );
    }, [modpacks, searchQuery]);

    return (
        <div className="h-full flex flex-col p-2">
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-text-muted mb-2 flex items-center gap-2">
                        <Sparkles className="text-accent" size={24} />
                        Top Modrinth Packs
                    </h2>
                    <p className="text-text-muted">Live list fetched from your backend.</p>
                </div>
                <div className="text-right hidden md:block">
                    <div className="text-xs text-text-muted uppercase tracking-wider">Showing top 15</div>
                </div>
            </div>

            {/* Search */}
            <div className="mb-6 glass-panel p-4 rounded-2xl">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-primary" size={20} />
                    <input 
                        type="text" 
                        placeholder="Search within the top list..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-bg-surface/50 border border-border-main rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-text-dim"
                    />
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto pb-10">
                {isLoading && (
                    <div className="glass-panel rounded-2xl p-6 text-text-muted">Fetching top modpacks…</div>
                )}

                {error && (
                    <div className="glass-panel rounded-2xl p-6 text-red-400 border border-red-500/30 bg-red-500/5">
                        {error}
                    </div>
                )}

                {!isLoading && !error && (
                    <div className="space-y-4">
                        {filteredPacks.map((pack, idx) => (
                            <button
                                key={pack.id}
                                onClick={() => onSelect?.(pack)}
                                className="w-full text-left glass-panel p-4 rounded-2xl flex items-center gap-4 glass-panel-hover transition-all hover:border-primary/40 hover:shadow-primary/20"
                            >
                                <div className="text-2xl font-bold text-primary w-10 text-center">{idx + 1}</div>
                                <div className="w-20 h-14 rounded-xl overflow-hidden bg-bg-surface border border-border-main/70 shrink-0">
                                    <img src={pack.imageUrl} alt={pack.title} className="w-full h-full object-cover" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-lg text-white truncate">{pack.title}</h3>
                                        {pack.categories.slice(0, 2).map((cat) => (
                                            <span key={cat} className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-white/5 border border-white/5 rounded text-text-muted">
                                                {cat}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="text-text-muted text-sm line-clamp-2 mt-1">{pack.description}</p>
                                    <div className="flex items-center gap-4 text-xs text-text-dim mt-2">
                                        <span>Author: {pack.author}</span>
                                        <span className="flex items-center gap-1 text-accent font-semibold">
                                            <Download size={14} /> {pack.downloads} downloads
                                        </span>
                                    </div>
                                </div>
                            </button>
                        ))}

                        {filteredPacks.length === 0 && (
                            <div className="glass-panel rounded-2xl p-6 text-text-muted">
                                No modpacks match your search.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ModpackBrowser;
