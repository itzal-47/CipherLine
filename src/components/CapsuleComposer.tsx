import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Clock } from 'lucide-react';

interface CapsuleComposerProps {
  onCancel: () => void;
  onSend: (text: string, unlockAt: Date) => void;
}

const PRESETS: { label: string; ms: number }[] = [
  { label: '1 HORA', ms: 60 * 60 * 1000 },
  { label: '24 HORAS', ms: 24 * 60 * 60 * 1000 },
  { label: '7 DIAS', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 DIAS', ms: 30 * 24 * 60 * 60 * 1000 },
];

export function CapsuleComposer({ onCancel, onSend }: CapsuleComposerProps) {
  const [text, setText] = useState('');
  const [selectedMs, setSelectedMs] = useState<number | null>(24 * 60 * 60 * 1000);
  const [customDate, setCustomDate] = useState('');

  const getUnlockAt = (): Date | null => {
    if (selectedMs) return new Date(Date.now() + selectedMs);
    if (customDate) {
      const d = new Date(customDate);
      if (d.getTime() > Date.now()) return d;
    }
    return null;
  };

  const unlockAt = getUnlockAt();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass clip-hud w-full max-w-sm border-cyber-amber/20 p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-cyber-amber" />
            <span className="font-mono text-sm tracking-widest text-cyber-amber">CÁPSULA DO TEMPO</span>
          </div>
          <button onClick={onCancel} className="text-cyber-text-dim hover:text-cyber-red">
            <X size={16} />
          </button>
        </div>

        <p className="mb-3 font-mono text-[9px] leading-relaxed text-cyber-text-faint">
          A MENSAGEM FICA MATEMATICAMENTE TRANCADA ATÉ O PRAZO — NEM VOCÊ, NEM NINGUÉM, CONSEGUE ABRIR ANTES (GARANTIA CRIPTOGRÁFICA VIA REDE DRAND, NÃO REGRA DE APP).
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="O que a cápsula vai guardar..."
          className="mb-3 w-full resize-none border border-cyber-border bg-transparent px-3 py-2 font-mono text-xs text-cyber-text placeholder:text-cyber-text-faint focus:border-cyber-amber/50 focus:outline-none"
        />

        <p className="mb-2 font-mono text-[10px] tracking-widest text-cyber-text-dim">ABRE EM</p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { setSelectedMs(p.ms); setCustomDate(''); }}
              className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors ${
                selectedMs === p.ms
                  ? 'border border-cyber-amber/40 bg-cyber-amber/10 text-cyber-amber'
                  : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="datetime-local"
          value={customDate}
          onChange={(e) => { setCustomDate(e.target.value); setSelectedMs(null); }}
          min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
          className="mb-4 w-full border border-cyber-border bg-transparent px-3 py-2 font-mono text-xs text-cyber-text focus:border-cyber-amber/50 focus:outline-none"
        />

        <button
          onClick={() => unlockAt && text.trim() && onSend(text.trim(), unlockAt)}
          disabled={!text.trim() || !unlockAt}
          className="clip-hud-sm w-full border border-cyber-amber/30 bg-cyber-amber/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-amber transition-colors hover:bg-cyber-amber/20 disabled:opacity-30"
        >
          TRANCAR CÁPSULA
        </button>
      </motion.div>
    </motion.div>
  );
}
