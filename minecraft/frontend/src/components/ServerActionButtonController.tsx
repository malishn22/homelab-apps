import React from 'react';
import type { Server } from '../types';
import { Square, RefreshCw, Play } from 'lucide-react';
import { Button } from './ui';

export interface ServerActionButtonControllerProps {
    serverId: string;
    status: Server['status'];
    onStart: () => void;
    onStop: () => void;
    onRestart?: () => void;
    layout: 'console' | 'compact';
}

const ServerActionButtonController: React.FC<ServerActionButtonControllerProps> = ({
    serverId,
    status,
    onStart,
    onStop,
    onRestart,
    layout,
}) => {
    const isInProgress =
        status === 'STARTING' || status === 'STOPPING' || status === 'RESTARTING';
    const startDisabled = isInProgress || status === 'ONLINE' || status === 'PREPARING';
    const stopDisabled = isInProgress || status === 'OFFLINE';
    const restartDisabled = isInProgress || status !== 'ONLINE';

    const startLoading = status === 'STARTING';
    const stopLoading = status === 'STOPPING';
    const restartLoading = status === 'RESTARTING';
    const startLabel = startLoading ? 'Starting' : 'Start';
    const stopLabel = stopLoading ? 'Stopping' : 'Stop';
    const restartLabel = restartLoading ? 'Restarting' : 'Restart';

    if (layout === 'console') {
        return (
            <div className="flex gap-2">
                <Button
                    variant="secondary"
                    icon={<RefreshCw size={16} />}
                    onClick={onRestart ?? (() => {})}
                    disabled={restartDisabled}
                    loading={restartLoading}
                    className="bg-bg-surface hover:bg-bg-hover text-white border-border-main shadow-sm"
                >
                    <span className="hidden sm:inline">{restartLabel}</span>
                </Button>
                <Button
                    variant="secondary"
                    icon={<Play size={16} />}
                    onClick={onStart}
                    disabled={startDisabled}
                    loading={startLoading}
                    className="bg-bg-surface hover:bg-bg-hover text-white border-border-main shadow-sm"
                >
                    <span className="hidden sm:inline">{startLabel}</span>
                </Button>
                <Button
                    variant="danger"
                    icon={<Square size={16} fill="currentColor" />}
                    onClick={onStop}
                    disabled={stopDisabled}
                    loading={stopLoading}
                    className="shadow-sm shadow-red-900/10"
                >
                    <span className="hidden sm:inline">{stopLabel}</span>
                </Button>
            </div>
        );
    }

    if (layout === 'compact') {
        const compactStopLabel = status === 'STOPPING' ? 'Stopping' : undefined;
        const compactStartLabel =
            status === 'STARTING' ? 'Starting' : status === 'RESTARTING' ? 'Restarting' : undefined;
        const compactRestartLabel = status === 'RESTARTING' ? 'Restarting' : undefined;
        const isOnline = status === 'ONLINE';
        if (isOnline) {
            return (
                <>
                    <Button
                        variant="secondary"
                        icon={<RefreshCw size={18} />}
                        disabled={restartDisabled}
                        onClick={onRestart ?? (() => {})}
                        loading={restartLoading}
                        className="p-2.5 bg-bg-surface hover:bg-bg-hover text-white border-border-main"
                        title={compactRestartLabel}
                    >
                        {compactRestartLabel}
                    </Button>
                    <Button
                        variant="danger"
                        icon={<Square size={18} fill="currentColor" />}
                        disabled={stopDisabled}
                        onClick={onStop}
                        loading={stopLoading}
                        className="p-2.5"
                        title={compactStopLabel}
                    >
                        {compactStopLabel}
                    </Button>
                </>
            );
        }
        return (
            <Button
                variant="success"
                icon={<Play size={18} fill="currentColor" />}
                disabled={startDisabled}
                onClick={onStart}
                loading={startLoading || status === 'RESTARTING'}
                className="p-2.5"
                title={compactStartLabel}
            >
                {compactStartLabel}
            </Button>
        );
    }

    return null;
};

export default ServerActionButtonController;
