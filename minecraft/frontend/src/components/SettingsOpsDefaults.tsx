import React, { useCallback, useEffect, useState } from 'react';
import { getOpsDefaults, saveOpsDefaults } from '../api/settings';
import { Check, Loader2, AlertCircle, Save } from 'lucide-react';

const SAVED_MESSAGE_DURATION = 2000;

const SettingsOpsDefaults: React.FC = () => {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const text = await getOpsDefaults();
      setContent(text);
      setOriginalContent(text);
    } catch (err) {
      setContent('[]');
      setOriginalContent('[]');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (content === originalContent) return;
    setStatus('saving');
    setErrorMessage(null);
    try {
      await saveOpsDefaults(content);
      setOriginalContent(content);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), SAVED_MESSAGE_DURATION);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 size={32} className="animate-spin text-primary mb-3" />
        <div className="text-sm text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl w-full">
      <h3 className="text-xl font-bold text-white mb-2">Ops defaults</h3>
      <p className="text-sm text-text-muted mb-4">
        Operators added here are merged into every server&apos;s ops.json on install and start.
        Format: JSON array of {`{"uuid":"...","name":"...","level":4,"bypassesPlayerLimit":false}`}.
        Find your UUID at{' '}
        <a
          href="https://mcuuid.net"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          mcuuid.net
        </a>
      </p>
      <div className="flex flex-col gap-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full h-48 px-4 py-3 rounded-lg bg-bg-surface border border-white/10 text-white text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 placeholder:text-text-dim"
          placeholder='[{"uuid":"your-uuid-here","name":"YourUsername","level":4}]'
          spellCheck={false}
        />
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={content === originalContent || status === 'saving'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {status === 'saving' ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save size={18} />
                Save
              </>
            )}
          </button>
          {status === 'saved' && (
            <span className="flex items-center gap-1 text-sm text-emerald-400">
              <Check size={16} />
              Saved
            </span>
          )}
          {status === 'error' && errorMessage && (
            <span className="flex items-center gap-1 text-sm text-red-400" title={errorMessage}>
              <AlertCircle size={16} />
              {errorMessage}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsOpsDefaults;
