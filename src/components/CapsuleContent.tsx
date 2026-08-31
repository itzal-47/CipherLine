import { useState, useEffect } from 'react';
import { Clock, Lock, Unlock } from 'lucide-react';
import type { DecodedMessage } from '@/types';

export function CapsuleContent({ message }: { message: DecodedMessage }) {
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<'locked' | 'unlocking' | 'unlocked' | 'too-early'>('locked');
  const [plaintext, setPlaintext] = useState('');

  const unlockAt = message.capsuleUnlockAt ? new Date(message.capsuleUnlockAt).getTime() : 0;
  const isTimeUp = now >= unlockAt;

  useEffect(() => {
    if (isTimeUp) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isTimeUp]);

  const formatCountdown = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) return `${d}D ${h}H`;
    if (h > 0) return `${h}H ${m}M`;
    if (m > 0) return `${m}M ${s}S`;
    return `${s}S`;
  };

  const handleOpen = async () => {
    setStatus('unlocking');
    try {
      const { timelockDecryptText } = await import('@/lib/timelock');
      const text = await timelockDecryptText(message.encryptedContent);
      setPlaintext(text);
      setStatus('unlocked');
    } catch {
      // A rede drand ainda não gerou a rodada — matematicamente impossível
      // abrir antes da hora, mesmo se o relógio do dispositivo achar que
      // já passou.
      setStatus('too-early');
    }
  };

  if (status === 'unlocked') {
    return (
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-1 font-mono text-[9px] tracking-widest text-cyber-amber">
          <Unlock size={10} /> CÁPSULA ABERTA
        </div>
        <p className="min-w-0 break-words whitespace-pre-wrap font-sans text-sm leading-relaxed text-cyber-text">
          {plaintext}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 clip-hud-sm border border-cyber-amber/30 bg-cyber-amber/5 px-4 py-3">
      <div className="mb-1 flex items-center gap-2 font-mono text-xs tracking-widest text-cyber-amber">
        <Lock size={14} />
        CÁPSULA DO TEMPO
      </div>
      {!isTimeUp ? (
        <div className="flex items-center gap-2 font-mono text-[10px] text-cyber-text-dim">
          <Clock size={10} />
          ABRE EM {formatCountdown(unlockAt - now)}
        </div>
      ) : status === 'too-early' ? (
        <div>
          <p className="mb-2 font-mono text-[10px] text-cyber-text-dim">
            AINDA TRANCADA — A REDE ESTÁ FINALIZANDO A CHAVE, TENTE EM ALGUNS SEGUNDOS
          </p>
          <button
            onClick={handleOpen}
            className="font-mono text-[10px] tracking-widest text-cyber-amber underline"
          >
            TENTAR NOVAMENTE
          </button>
        </div>
      ) : (
        <button
          onClick={handleOpen}
          disabled={status === 'unlocking'}
          className="mt-1 clip-hud-sm border border-cyber-amber/40 bg-cyber-amber/10 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-amber transition-colors hover:bg-cyber-amber/20 disabled:opacity-50"
        >
          {status === 'unlocking' ? 'ABRINDO...' : 'ABRIR CÁPSULA'}
        </button>
      )}
    </div>
  );
}
