import { useEffect, useState } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

export function CopyButton({ text, label = 'COPIAR', className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
      } catch {
        // ignore
      }
      document.body.removeChild(textarea);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`font-mono text-xs tracking-widest transition-colors ${className}`}
    >
      {copied ? (
        <span className="text-cyber-cyan glow-cyan">COPIADO</span>
      ) : (
        <span className="text-cyber-green-dim hover:text-cyber-green">{label}</span>
      )}
    </button>
  );
}
