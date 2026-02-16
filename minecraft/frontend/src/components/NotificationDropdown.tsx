import React from 'react';
import { Bell } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';

const NotificationDropdown: React.FC = () => {
    const {
        notifications,
        unreadCount,
        showNotifications,
        setShowNotifications,
        markRead,
        notificationsRef,
    } = useNotifications();

    return (
        <div className="relative" ref={notificationsRef}>
            <button
                className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-full transition-all relative"
                onClick={() => {
                    setShowNotifications(!showNotifications);
                    if (!showNotifications) markRead();
                }}
                onMouseEnter={() => showNotifications && markRead()}
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-accent text-[10px] text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 border border-bg-body">
                        {unreadCount}
                    </span>
                )}
            </button>
            {showNotifications && (
                <div
                    className="absolute right-0 mt-2 w-72 bg-bg-surface border border-border-main rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.35)] overflow-hidden z-20"
                    onMouseEnter={() => markRead()}
                >
                    <div className="px-4 py-2 border-b border-border-main/80 text-xs text-text-dim uppercase tracking-wide">
                        Notifications
                    </div>
                    <div className="max-h-64 overflow-auto">
                        {notifications.length === 0 ? (
                            <div className="px-4 py-4 text-text-muted text-sm">No updates yet.</div>
                        ) : (
                            notifications.map((n) => (
                                <div
                                    key={n.id}
                                    className="px-4 py-3 border-b border-border-main/60 last:border-b-0 hover:bg-white/5 transition-colors"
                                >
                                    <div className="text-sm text-white">{n.message}</div>
                                    <div className="text-[11px] text-text-dim">{n.time}</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationDropdown;
