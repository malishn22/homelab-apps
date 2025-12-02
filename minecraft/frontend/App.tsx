import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import ModpackBrowser from './components/ModpackBrowser';
import ModpackDetail from './components/ModpackDetail';
import ServerConsole from './components/ServerConsole';
import ServerList from './components/ServerList';
import { Modpack, View } from './types';
import { Bell, HelpCircle, Construction } from 'lucide-react';

const App: React.FC = () => {
    const [currentView, setCurrentView] = useState<View>(View.MODPACKS);
    const [selectedModpack, setSelectedModpack] = useState<Modpack | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    const handleServerSelect = (serverId: string) => {
        // In a real app, we would set the active server context here
        setCurrentView(View.DASHBOARD);
    };

    const renderView = () => {
        switch (currentView) {
            case View.DASHBOARD:
                return <ServerConsole />;
            case View.MODPACKS:
                return selectedModpack ? (
                    <ModpackDetail
                        modpack={selectedModpack}
                        loading={isLoadingDetail}
                        error={detailError}
                        onBack={() => {
                            setSelectedModpack(null);
                            setDetailError(null);
                        }}
                        onInstall={() => alert(`Install ${selectedModpack.title} coming soon`)}
                    />
                ) : (
                    <ModpackBrowser
                        onSelect={async (modpack) => {
                            setSelectedModpack(modpack);
                            setDetailError(null);
                            setIsLoadingDetail(true);
                            try {
                                const resp = await fetch(`/api/modpacks/${modpack.id}`);
                                if (!resp.ok) {
                                    throw new Error(`API request failed (${resp.status})`);
                                }
                                const data = await resp.json();
                                const uniqLower = (arr: (string | undefined)[] | undefined) => {
                                    const seen = new Set<string>();
                                    return (arr || []).filter((item) => {
                                        if (!item) return false;
                                        const key = item.toLowerCase();
                                        if (seen.has(key)) return false;
                                        seen.add(key);
                                        return true;
                                    });
                                };

                                const mergedCategories = uniqLower([
                                    ...(data.categories || []),
                                    ...(modpack.categories || []),
                                ]).sort((a, b) => a.localeCompare(b));
                                const mergedLoaders = uniqLower([
                                    ...(data.loaders || []),
                                    ...(modpack.loaders || []),
                                ]).sort((a, b) => a.localeCompare(b));
                                const mergedGameVersions = uniqLower([
                                    ...(data.game_versions || []),
                                    ...(modpack.gameVersions || []),
                                ]);

                                setSelectedModpack({
                                    ...modpack,
                                    slug: data.slug,
                                    longDescription: data.body || data.description || modpack.description,
                                    categories: mergedCategories,
                                    loaders: mergedLoaders,
                                    gameVersions: mergedGameVersions,
                                    imageUrl: data.icon_url || modpack.imageUrl,
                                    followers: data.followers ? data.followers.toLocaleString() : modpack.followers,
                                    updatedAt: data.updated || data.date_modified || modpack.updatedAt,
                                });
                            } catch (err: any) {
                                setDetailError(err?.message || 'Failed to load details.');
                            } finally {
                                setIsLoadingDetail(false);
                            }
                        }}
                    />
                );
            case View.SERVERS:
                return <ServerList onSelectServer={handleServerSelect} />;
            case View.SETTINGS:
                return (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted animate-[fadeIn_0.5s_ease-out]">
                         <div className="w-24 h-24 rounded-full bg-bg-surface/50 flex items-center justify-center border border-white/5 mb-6 shadow-glow shadow-accent/10">
                            <Construction size={40} className="text-accent opacity-80" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">Settings</h3>
                        <p>Configuration panel under construction.</p>
                    </div>
                );
            default:
                return <ModpackBrowser />;
        }
    };

    return (
        <div className="flex min-h-screen w-full font-sans overflow-auto">
            {/* Sidebar Background Blur Layer */}
            <div className="absolute inset-y-0 left-0 w-64 bg-bg-glass backdrop-blur-xl border-r border-white/5 z-10"></div>
            
            <Sidebar currentView={currentView} onChangeView={setCurrentView} />
            
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-0">
                {/* Header */}
                <header className="h-20 flex items-center justify-between px-8 shrink-0 z-10">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                        <span className="text-xs font-semibold text-emerald-400 tracking-wide uppercase">System Operational</span>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <button className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-full transition-all relative group">
                            <Bell size={20} />
                            <span className="absolute top-2 right-2 h-2 w-2 bg-accent rounded-full border-2 border-bg-body group-hover:animate-ping"></span>
                        </button>
                        <button className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-full transition-all">
                            <HelpCircle size={20} />
                        </button>
                    </div>
                </header>

                {/* Content Area */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                    <div className="flex-1 min-h-0 overflow-auto p-6 md:p-8">
                        {renderView()}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;
