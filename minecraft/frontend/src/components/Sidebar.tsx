import React from 'react';
import { View } from '../types';
import { Box, Server, Settings, Zap, ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
    currentView: View;
    onChangeView: (view: View) => void;
    expanded: boolean;
    onToggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, expanded, onToggle }) => {
    const navItems = [
        { id: View.SERVERS, label: 'Servers', icon: <Server size={20} /> },
        { id: View.MODPACKS, label: 'Browse', icon: <Box size={20} /> },
        { id: View.SETTINGS, label: 'Settings', icon: <Settings size={20} /> },
    ];

    return (
        <nav
            className={`fixed inset-y-0 left-0 h-screen overflow-y-auto bg-bg-glass backdrop-blur-xl border-r border-white/5 z-20 flex flex-col transition-[width] duration-300 ${
                expanded ? 'w-64' : 'w-16'
            }`}
        >
            <div className="flex flex-col p-4 min-h-full">
                {/* Logo Area + Toggle */}
                <div className={`flex items-center gap-3 mb-8 px-2 pt-2 ${expanded ? '' : 'justify-center'}`}>
                    {expanded && (
                        <>
                            <div className="w-10 h-10 bg-gradient-to-br from-primary to-accent rounded-xl flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
                                <Zap className="text-white fill-white" size={20} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <span className="text-lg font-bold tracking-tight text-white block leading-none">Mali</span>
                                <span className="text-xs text-text-muted font-medium tracking-wide">MINECRAFT</span>
                            </div>
                            <button
                                onClick={onToggle}
                                className="p-2 rounded-lg text-text-muted hover:text-white hover:bg-white/5 transition-colors shrink-0"
                                title="Collapse sidebar"
                            >
                                <ChevronLeft size={18} />
                            </button>
                        </>
                    )}
                    {!expanded && (
                        <button
                            onClick={onToggle}
                            className="p-2 rounded-lg text-text-muted hover:text-white hover:bg-white/5 transition-colors"
                            title="Expand sidebar"
                        >
                            <ChevronRight size={20} />
                        </button>
                    )}
                </div>

                {/* User Profile */}
                <div className={`mb-6 ${expanded ? '' : 'flex justify-center'}`}>
                    <div className={`glass-panel p-3 rounded-2xl flex items-center gap-3 group cursor-pointer transition-colors hover:bg-white/5 ${expanded ? '' : 'w-10 h-10 p-0 justify-center'}`}>
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent to-blue-600 p-[2px] shrink-0">
                            <div className="w-full h-full rounded-[10px] bg-bg-surface flex items-center justify-center overflow-hidden">
                                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="User" />
                            </div>
                        </div>
                        {expanded && (
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate group-hover:text-primary transition-colors">Mali User</div>
                                <div className="text-xs text-text-muted flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                    No Plan
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Navigation */}
                <div className="flex flex-col gap-1.5 flex-1">
                    {navItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onChangeView(item.id)}
                            title={!expanded ? item.label : undefined}
                            className={`
                                flex items-center gap-3 py-3 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden group
                                ${expanded ? 'px-4' : 'px-0 justify-center w-full'}
                                ${currentView === item.id
                                    ? 'text-white bg-white/5 shadow-inner'
                                    : 'text-text-muted hover:text-white hover:bg-white/5'
                                }
                            `}
                        >
                            {currentView === item.id && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full shadow-[0_0_10px_var(--tw-shadow-color)] shadow-primary"></div>
                            )}
                            <span className={`relative z-10 transition-colors ${currentView === item.id ? 'text-primary' : 'group-hover:text-white'}`}>
                                {item.icon}
                            </span>
                            {expanded && <span className="relative z-10">{item.label}</span>}
                        </button>
                    ))}
                </div>
            </div>
        </nav>
    );
};

export default Sidebar;
