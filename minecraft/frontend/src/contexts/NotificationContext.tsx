import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type NotificationItem = {
    id: string;
    message: string;
    time: string;
};

interface NotificationContextValue {
    notifications: NotificationItem[];
    unreadCount: number;
    showNotifications: boolean;
    setShowNotifications: (show: boolean) => void;
    addNotifications: (messages: string[]) => void;
    markRead: () => void;
    notificationsRef: React.RefObject<HTMLDivElement | null>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export const useNotifications = (): NotificationContextValue => {
    const ctx = useContext(NotificationContext);
    if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
    return ctx;
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showNotifications, setShowNotifications] = useState(false);
    const notificationsRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!showNotifications) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
                setShowNotifications(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showNotifications]);

    const addNotifications = useCallback((messages: string[]) => {
        if (!messages.length) return;
        const now = new Date().toLocaleTimeString();
        setNotifications((prev) => [
            ...messages.map((msg, idx) => ({ id: `${Date.now()}-${idx}`, message: msg, time: now })),
            ...prev,
        ]);
        setUnreadCount((count) => count + messages.length);
    }, []);

    const markRead = useCallback(() => {
        setUnreadCount(0);
    }, []);

    return (
        <NotificationContext.Provider
            value={{
                notifications,
                unreadCount,
                showNotifications,
                setShowNotifications,
                addNotifications,
                markRead,
                notificationsRef,
            }}
        >
            {children}
        </NotificationContext.Provider>
    );
};
