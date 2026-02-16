import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Textarea, SaveButton } from './ui';
import { SAVED_MESSAGE_DURATION } from '../constants';

export type SettingsEditorProps = {
  title: string;
  description: React.ReactNode;
  placeholder: string;
  textareaHeight?: string;
  emptyDefault?: string;
  loadFn: () => Promise<string>;
  saveFn: (content: string) => Promise<void>;
};

const SettingsEditor: React.FC<SettingsEditorProps> = ({
  title,
  description,
  placeholder,
  textareaHeight = 'h-48',
  emptyDefault = '',
  loadFn,
  saveFn,
}) => {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const text = await loadFn();
      setContent(text);
      setOriginalContent(text);
    } catch (err) {
      setContent(emptyDefault);
      setOriginalContent(emptyDefault);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadFn, emptyDefault]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (content === originalContent) return;
    setStatus('saving');
    setErrorMessage(null);
    try {
      await saveFn(content);
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
      <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
      <div className="text-sm text-text-muted mb-4">{description}</div>
      <div className="flex flex-col gap-3">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={textareaHeight}
          placeholder={placeholder}
          spellCheck={false}
        />
        <SaveButton
          onClick={handleSave}
          disabled={content === originalContent}
          saving={status === 'saving'}
          saved={status === 'saved'}
          error={status === 'error' ? errorMessage : null}
        />
      </div>
    </div>
  );
};

export default SettingsEditor;
