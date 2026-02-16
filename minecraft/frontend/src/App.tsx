import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import NotificationDropdown from './components/NotificationDropdown';
import { View } from './types';
import type { DashboardTab } from './types';
import { HelpCircle, Loader2 } from 'lucide-react';
import { NotificationProvider } from './contexts/NotificationContext';
import { ServerProvider, useServerContext } from './contexts/ServerContext';
import ServersView from './views/ServersView';
import ModpacksView from './views/ModpacksView';
import SettingsView from './views/SettingsView';

const AppContent: React.FC = () => {
    const [currentView, setCurrentView] = useState<View>(View.SERVERS);
    const [serversViewMode, setServersViewMode] = useState<'list' | 'detail'>('list');
    const [detailTab, setDetailTab] = useState<DashboardTab>('console');
    const [sidebarExpanded, setSidebarExpanded] = useState(true);
    const [serverStatusCache, setServerStatusCache] = useState<Record<string, 'required' | 'unsupported'>>({});

    const onServerStatusUpdate = (updates: Record<string, 'required' | 'unsupported'>) => {
        setServerStatusCache((prev) => ({ ...prev, ...updates }));
    };

    const renderView = () => {
        switch (currentView) {
            case View.SERVERS:
                return (
                    <ServersView
                        serversViewMode={serversViewMode}
                        setServersViewMode={setServersViewMode}
                        detailTab={detailTab}
                        setDetailTab={setDetailTab}
                    />
                );
            case View.MODPACKS:
                return (
                    <ModpacksView
                        serverStatusCache={serverStatusCache}
                        onServerStatusUpdate={onServerStatusUpdate}
                    />
                );
            case View.SETTINGS:
                return <SettingsView />;
            default:
                return (
                    <ModpacksView
                        serverStatusCache={serverStatusCache}
                        onServerStatusUpdate={onServerStatusUpdate}
                    />
                );
        }
    };

    return (
        <ServerProvider
            currentView={currentView}
            setCurrentView={setCurrentView}
            serversViewMode={serversViewMode}
            setServersViewMode={setServersViewMode}
            detailTab={detailTab}
            setDetailTab={setDetailTab}
        >
            <AppLayout
                currentView={currentView}
                setCurrentView={setCurrentView}
                sidebarExpanded={sidebarExpanded}
                setSidebarExpanded={setSidebarExpanded}
            >
                {renderView()}
            </AppLayout>
        </ServerProvider>
    );
};

interface AppLayoutProps {
    currentView: View;
    setCurrentView: (view: View) => void;
    sidebarExpanded: boolean;
    setSidebarExpanded: (expanded: boolean) => void;
    children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({
    currentView,
    setCurrentView,
    sidebarExpanded,
    setSidebarExpanded,
    children,
}) => {
    const { isInitialLoading } = useServerContext();

    return (
        <div className="flex h-screen w-full font-sans overflow-hidden">
            <Sidebar
                currentView={currentView}
                onChangeView={setCurrentView}
                expanded={sidebarExpanded}
                onToggle={() => setSidebarExpanded(!sidebarExpanded)}
            />
            <main
                className={`flex-1 flex flex-col min-w-0 overflow-hidden relative z-0 transition-[margin] duration-300 ${
                    sidebarExpanded ? 'ml-64' : 'ml-16'
                }`}
            >
                <header className="h-20 flex items-center justify-between px-8 shrink-0 z-10">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        <span className="text-xs font-semibold text-emerald-400 tracking-wide uppercase">
                            System Operational
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <NotificationDropdown />
                        <button className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-full transition-all">
                            <HelpCircle size={20} />
                        </button>
                    </div>
                </header>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                    {isInitialLoading ? (
                        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 md:p-8 bg-bg-body/50">
                            <Loader2 className="w-14 h-14 text-primary animate-spin mb-5" strokeWidth={2} />
                            <p className="text-lg font-medium text-white mb-1">Loading dashboard</p>
                            <p className="text-sm text-text-muted">Fetching your servers and data...</p>
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0 overflow-auto pt-4 px-6 pb-6 md:pt-4 md:px-8 md:pb-8">{children}</div>
                    )}
                </div>
            </main>
        </div>
    );
};

const App: React.FC = () => (
    <NotificationProvider>
        <AppContent />
    </NotificationProvider>
);

export default App;
