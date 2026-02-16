import React, { useState } from 'react';
import type { Modpack } from '../types';
import ModpackBrowser from '../components/ModpackBrowser';
import ModpackDetail from '../components/ModpackDetail';
import { getModpackDetail } from '../api/modpacks';
import { useServerContext } from '../contexts/ServerContext';
import { getErrorMessage } from '../utils';

interface ModpacksViewProps {
    serverStatusCache: Record<string, 'required' | 'unsupported'>;
    onServerStatusUpdate: (updates: Record<string, 'required' | 'unsupported'>) => void;
}

const ModpacksView: React.FC<ModpacksViewProps> = ({ serverStatusCache, onServerStatusUpdate }) => {
    const { servers, handleInstallRequest } = useServerContext();
    const [selectedModpack, setSelectedModpack] = useState<Modpack | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    const handleSelect = async (modpack: Modpack) => {
        setSelectedModpack(modpack);
        setDetailError(null);
        setIsLoadingDetail(true);
        try {
            const data = await getModpackDetail(modpack.id, modpack.source);
            const uniqLower = (arr: (string | undefined)[] | undefined) => {
                const seen = new Set<string>();
                return (arr ?? []).filter((item) => {
                    if (!item) return false;
                    const key = item.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            };
            const mergedCategories = uniqLower([
                ...(Array.isArray(data.categories) ? data.categories : []),
                ...(modpack.categories ?? []),
            ]).sort((a, b) => a.localeCompare(b));
            const mergedLoaders = uniqLower([
                ...(Array.isArray(data.loaders) ? data.loaders : []),
                ...(modpack.loaders ?? []),
            ]).sort((a, b) => a.localeCompare(b));
            const mergedGameVersions = uniqLower([
                ...(Array.isArray(data.game_versions) ? data.game_versions : []),
                ...(modpack.gameVersions ?? []),
            ]);
            setSelectedModpack({
                ...modpack,
                slug: (data.slug as string) ?? modpack.slug,
                longDescription:
                    (data.body as string) ?? (data.description as string) ?? modpack.description,
                categories: mergedCategories,
                loaders: mergedLoaders,
                gameVersions: mergedGameVersions,
                imageUrl: (data.icon_url as string) ?? modpack.imageUrl,
                followers:
                    typeof data.followers === 'number'
                        ? data.followers.toLocaleString()
                        : modpack.followers,
                updatedAt:
                    (data.updated as string) ??
                    (data.date_modified as string) ??
                    modpack.updatedAt,
                serverSide: (data.server_side as string) ?? modpack.serverSide,
            });
        } catch (err: unknown) {
            setDetailError(getErrorMessage(err));
        } finally {
            setIsLoadingDetail(false);
        }
    };

    return (
        <div className="relative h-full min-h-0">
            <div className={`h-full ${selectedModpack ? 'hidden' : ''}`}>
                <ModpackBrowser
                    serverStatusCache={serverStatusCache}
                    onServerStatusUpdate={onServerStatusUpdate}
                    onSelect={handleSelect}
                />
            </div>
            {selectedModpack && (
                <div className="absolute inset-0 z-10 overflow-auto">
                    <ModpackDetail
                        modpack={selectedModpack}
                        serverStatusCache={serverStatusCache}
                        onServerStatusUpdate={onServerStatusUpdate}
                        loading={isLoadingDetail}
                        error={detailError}
                        servers={servers}
                        onBack={() => {
                            setSelectedModpack(null);
                            setDetailError(null);
                        }}
                        onInstall={handleInstallRequest}
                    />
                </div>
            )}
        </div>
    );
};

export default ModpacksView;
