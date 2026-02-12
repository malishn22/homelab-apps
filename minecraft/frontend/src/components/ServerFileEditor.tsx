import React, { useCallback, useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { getFiles, writeFile } from '../api/servers';
import { FileText, Check, Loader2, AlertCircle } from 'lucide-react';

const DEBOUNCE_MS = 500;
const SAVED_MESSAGE_DURATION = 2000;

interface ServerFileEditorProps {
  instanceId: string | null;
  filePath: string | null;
  onClose?: () => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const ServerFileEditor: React.FC<ServerFileEditorProps> = ({
  instanceId,
  filePath,
  onClose,
}) => {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveToServer = useCallback(async () => {
    if (!instanceId || !filePath || content === originalContent) return;
    setStatus('saving');
    setErrorMessage(null);
    try {
      await writeFile(instanceId, filePath, content);
      setOriginalContent(content);
      setStatus('saved');
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = setTimeout(() => {
        setStatus('idle');
        savedTimeoutRef.current = null;
      }, SAVED_MESSAGE_DURATION);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [instanceId, filePath, content, originalContent]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (content !== originalContent && instanceId && filePath) {
      debounceRef.current = setTimeout(() => {
        saveToServer();
        debounceRef.current = null;
      }, DEBOUNCE_MS);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, originalContent, instanceId, filePath, saveToServer]);

  useEffect(() => {
    if (!instanceId || !filePath) {
      setContent('');
      setOriginalContent('');
      setStatus('idle');
      setErrorMessage(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setStatus('idle');
    getFiles(instanceId, filePath)
      .then((res) => {
        const text = res.content ?? '';
        setContent(text);
        setOriginalContent(text);
      })
      .catch((err) => {
        setContent('');
        setOriginalContent('');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [instanceId, filePath]);

  const handleChange = (value: string) => {
    setContent(value);
  };

  const getLanguage = () => {
    const ext = filePath?.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'json') return json();
    return undefined;
  };

  if (!instanceId) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-text-muted">
        <FileText size={32} className="mb-3" />
        <div className="text-sm">Select a server to edit files.</div>
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-text-muted">
        <FileText size={32} className="mb-3" />
        <div className="text-sm">Select a file from the browser.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary mb-3" />
        <div className="text-sm text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={16} className="text-primary shrink-0" />
          <span className="text-sm font-medium text-white truncate">{filePath}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status === 'saving' && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <Loader2 size={12} className="animate-spin" />
              Saving...
            </span>
          )}
          {status === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Check size={12} />
              Saved
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1 text-xs text-red-400" title={errorMessage ?? ''}>
              <AlertCircle size={12} />
              Error
            </span>
          )}
          {onClose && (
            <button
              className="text-xs text-text-muted hover:text-white px-2 py-1 rounded"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
      </div>
      {errorMessage && status === 'error' && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          {errorMessage}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={content}
          height="100%"
          extensions={getLanguage() ? [getLanguage()] : []}
          onChange={handleChange}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            foldGutter: true,
          }}
          theme="dark"
          className="h-full text-sm [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
        />
      </div>
    </div>
  );
};

export default ServerFileEditor;
