import React, { useCallback, useEffect, useState } from 'react';
import { FileEntry, deleteFile, getFiles } from '../api/servers';
import { Folder, FileText, ChevronRight, ChevronLeft, Home, Loader2, Trash2 } from 'lucide-react';

interface ServerFileBrowserProps {
  instanceId: string | null;
  currentPath: string;
  onPathChange: (path: string) => void;
  onSelectFile: (path: string) => void;
  onFileDeleted?: (path: string) => void;
}

const ServerFileBrowser: React.FC<ServerFileBrowserProps> = ({
  instanceId,
  currentPath,
  onPathChange,
  onSelectFile,
  onFileDeleted,
}) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dirs, setDirs] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!instanceId) return;
    getFiles(instanceId, currentPath)
      .then((res) => {
        setFiles(res.files ?? []);
        setDirs(res.dirs ?? []);
      })
      .catch(() => {});
  }, [instanceId, currentPath]);

  useEffect(() => {
    if (!instanceId) {
      setFiles([]);
      setDirs([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    getFiles(instanceId, currentPath)
      .then((res) => {
        setFiles(res.files ?? []);
        setDirs(res.dirs ?? []);
        if (res.content !== undefined) {
          setError('Path is a file');
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setFiles([]);
        setDirs([]);
      })
      .finally(() => setLoading(false));
  }, [instanceId, currentPath]);

  const handleDirClick = (path: string) => {
    onPathChange(path);
  };

  const handleFileClick = (path: string) => {
    onSelectFile(path);
  };

  const handleBreadcrumb = (path: string) => {
    onPathChange(path);
  };

  const handleDelete = async (path: string, name: string, isDir: boolean) => {
    const msg = isDir
      ? `Delete folder "${name}"? This will delete the folder and all its contents. This cannot be undone.`
      : `Delete "${name}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    if (!instanceId) return;
    try {
      await deleteFile(instanceId, path);
      onFileDeleted?.(path);
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  if (!instanceId) {
    return (
      <div className="flex flex-col h-full p-4 text-text-muted items-center justify-center">
        <FileText className="mb-3" size={32} />
        <div className="text-sm">Select a server to browse files.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 flex-wrap">
        {pathParts.length > 0 && (
          <button
            className="flex items-center gap-1 text-xs text-text-muted hover:text-white transition-colors p-1 -ml-1 rounded hover:bg-white/5"
            onClick={() => handleBreadcrumb(pathParts.slice(0, -1).join('/'))}
            title="Back"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        <button
          className="flex items-center gap-1 text-xs text-text-muted hover:text-white transition-colors"
          onClick={() => handleBreadcrumb('')}
        >
          <Home size={14} />
          <span>root</span>
        </button>
        {pathParts.map((part, i) => {
          const pathUpToHere = pathParts.slice(0, i + 1).join('/');
          return (
            <React.Fragment key={pathUpToHere}>
              <ChevronRight size={14} className="text-text-dim" />
              <button
                className="text-xs text-text-muted hover:text-white transition-colors"
                onClick={() => handleBreadcrumb(pathUpToHere)}
              >
                {part}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="py-4 text-sm text-red-400">{error}</div>
        ) : (
          <div className="space-y-0.5">
            {dirs.map((d) => (
              <div
                key={d.path}
                className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-sm"
              >
                <button
                  className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  onClick={() => handleDirClick(d.path)}
                >
                  <Folder size={16} className="text-accent shrink-0" />
                  <span className="text-white truncate">{d.name}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(d.path, d.name, true);
                  }}
                  className="p-1.5 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="Delete folder"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {files.map((f) => (
              <div
                key={f.path}
                className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-sm"
              >
                <button
                  className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  onClick={() => handleFileClick(f.path)}
                >
                  <FileText size={16} className="text-primary/80 shrink-0" />
                  <span className="text-gray-300 truncate">{f.name}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(f.path, f.name, false);
                  }}
                  className="p-1.5 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="Delete file"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!loading && dirs.length === 0 && files.length === 0 && (
              <div className="py-4 text-sm text-text-muted">No files</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ServerFileBrowser;
