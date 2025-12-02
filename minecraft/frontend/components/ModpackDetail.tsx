import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Modpack } from '../types';
import { ArrowLeft, Download, Package, Tag, Server, Users, Sparkles } from 'lucide-react';

interface ModpackDetailProps {
    modpack: Modpack;
    onBack: () => void;
    onInstall?: (modpack: Modpack) => void;
    loading?: boolean;
    error?: string | null;
}

const ModpackDetail: React.FC<ModpackDetailProps> = ({ modpack, onBack, onInstall, loading, error }) => {
    const mainCategories = modpack.categories?.slice(0, 6) ?? [];
    const sanitizeSchema = {
        ...defaultSchema,
        tagNames: [...(defaultSchema.tagNames || []), 'center', 'iframe'],
        attributes: {
            ...(defaultSchema.attributes || {}),
            a: [...(defaultSchema.attributes?.a || []), 'target', 'rel'],
            iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy'],
            img: [...(defaultSchema.attributes?.img || []), 'loading'],
        },
    };

    return (
        <div className="h-full min-h-0 flex flex-col gap-6 animate-[fadeIn_0.3s_ease-out] overflow-y-auto pb-10">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-text-muted hover:text-white border border-white/10 transition-colors"
                >
                    <ArrowLeft size={18} />
                </button>
                <div className="text-sm text-text-dim">Back to Modpacks</div>
            </div>

            <div className="glass-panel rounded-2xl overflow-hidden border border-border-main/60 shadow-2xl">
                <div className="h-64 bg-bg-surface relative">
                    <img src={modpack.imageUrl} alt={modpack.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                    <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
                        <div>
                            <div className="text-xs uppercase tracking-wider text-text-muted mb-1">Modrinth Pack</div>
                            <h1 className="text-3xl font-bold text-white">{modpack.title}</h1>
                            <div className="text-sm text-text-muted">by {modpack.author}</div>
                        </div>
                        <div className="flex items-center gap-3">
                            {loading && <span className="text-text-dim text-xs">Loading…</span>}
                            <button
                                onClick={() => onInstall?.(modpack)}
                                className="px-4 py-2 rounded-xl bg-primary text-white font-semibold flex items-center gap-2 shadow-glow shadow-primary/30 hover:bg-primary/90 transition-colors"
                            >
                                <Download size={18} /> Install
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex flex-wrap gap-2">
                        {mainCategories.map((cat) => (
                            <span
                                key={cat}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-text-muted uppercase tracking-wider"
                            >
                                <Tag size={12} /> {cat}
                            </span>
                        ))}
                        {(modpack.loaders || []).map((loader) => (
                            <span
                                key={`loader-${loader}`}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary uppercase tracking-wider"
                            >
                                <Sparkles size={12} /> {loader}
                            </span>
                        ))}
                        {(modpack.gameVersions || []).slice(0, 4).map((ver) => (
                            <span
                                key={`ver-${ver}`}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-text-muted uppercase tracking-wider"
                            >
                                <Tag size={12} /> {ver}
                            </span>
                        ))}
                    </div>

                    {error && (
                        <div className="text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                            {error}
                        </div>
                    )}

                    <div className="border border-white/5 rounded-xl p-4 bg-bg-surface/60">
                        <div className="text-xs uppercase tracking-wider text-text-dim mb-3">Description</div>
                        <div className="prose prose-invert max-w-none text-text-muted text-[15px] leading-relaxed markdown-body">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                            >
                                {modpack.longDescription || modpack.description}
                            </ReactMarkdown>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default ModpackDetail;
