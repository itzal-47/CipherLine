import { useEffect, useRef, useState } from 'react';
import { Lock, QrCode, Share2, X } from 'lucide-react';
import { buildInviteUrl } from '@/lib/cryptoV2';
import { renderInviteQrSvg } from '@/lib/inviteQr';

interface InviteSheetProps {
  roomCode: string;
  secret: string;
  onClose: () => void;
}

type QrState = 'idle' | 'loading' | 'ready' | 'error';

export function InviteSheet({ roomCode, secret, onClose }: InviteSheetProps) {
  const [qrState, setQrState] = useState<QrState>('idle');
  const [qrSvg, setQrSvg] = useState('');
  const [feedback, setFeedback] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const isMountedRef = useRef(true);
  const triggerRef = useRef<HTMLElement | null>(null);
  const focusRestoreTimeoutRef = useRef<number | null>(null);
  const urlRef = useRef(buildInviteUrl(window.location.origin, roomCode, secret));
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    if (focusRestoreTimeoutRef.current !== null) window.clearTimeout(focusRestoreTimeoutRef.current);
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    primaryActionRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      urlRef.current = '';
      isMountedRef.current = false;
      focusRestoreTimeoutRef.current = window.setTimeout(() => triggerRef.current?.focus(), 0);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
    // close is intentionally stable for this mounted dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    setQrSvg('');
    setQrState('idle');
    setFeedback('');
    urlRef.current = '';
    onClose();
  };

  const copyInvite = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível');
      await navigator.clipboard.writeText(urlRef.current);
      setFeedback('Copiado');
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setFeedback(''), 2000);
    } catch {
      setFeedback('Não foi possível copiar o convite.');
    }
  };

  const shareInvite = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'CipherLine',
          text: 'Entra na minha sala cifrada',
          url: urlRef.current,
        });
        return;
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') return;
      }
    }
    await copyInvite();
  };

  const showQr = async () => {
    if (qrState === 'ready') {
      setQrSvg('');
      setQrState('idle');
      return;
    }
    setQrState('loading');
    setFeedback('');
    try {
      const svg = await renderInviteQrSvg(urlRef.current);
      if (!isMountedRef.current) return;
      setQrSvg(svg);
      setQrState('ready');
    } catch {
      if (isMountedRef.current) setQrState('error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-sheet-title"
        className="glass clip-hud-sm max-h-[90dvh] w-full max-w-lg overflow-y-auto overscroll-contain border border-cyber-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="invite-sheet-title" className="font-mono text-lg font-bold text-cyber-green">Convidar para a sala</h2>
          <button onClick={close} aria-label="Fechar convite" className="flex h-11 w-11 items-center justify-center text-cyber-text-dim hover:text-cyber-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-green/60">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="mb-4 rounded border border-cyber-border bg-cyber-panel/60 px-4 py-3">
          <p className="mb-1 font-mono text-xs text-cyber-text-dim">CÓDIGO DA SALA</p>
          <p className="break-all font-mono text-xl font-bold tracking-wider text-cyber-text" translate="no">{roomCode}</p>
        </div>

        <div className="space-y-3">
          <button ref={primaryActionRef} onClick={shareInvite} className="clip-hud-sm flex min-h-12 w-full items-center justify-center gap-2 border border-cyber-green/40 bg-cyber-green/10 px-4 py-3 font-mono text-sm font-bold text-cyber-green hover:bg-cyber-green/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-green/60">
            <Share2 size={18} aria-hidden="true" /> Partilhar convite
          </button>
          <button onClick={copyInvite} className="clip-hud-sm flex min-h-12 w-full items-center justify-center gap-2 border border-cyber-border px-4 py-3 font-mono text-sm text-cyber-text hover:bg-cyber-panel/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-cyan/60">
            Copiar link
          </button>
          <button onClick={showQr} disabled={qrState === 'loading'} className="clip-hud-sm flex min-h-12 w-full items-center justify-center gap-2 border border-cyber-border px-4 py-3 font-mono text-sm text-cyber-text hover:bg-cyber-panel/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-cyan/60 disabled:opacity-60">
            <QrCode size={18} aria-hidden="true" /> {qrState === 'ready' ? 'Ocultar QR' : qrState === 'loading' ? 'A gerar QR…' : 'Mostrar QR'}
          </button>
        </div>

        <p aria-live="polite" className="mt-3 min-h-5 text-center font-mono text-xs text-cyber-green">{feedback}</p>
        <p className="mt-2 flex items-start gap-2 font-mono text-xs leading-relaxed text-cyber-amber">
          <Lock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          Quem tiver este link entra na sala. Partilha-o só com quem confias.
        </p>

        {qrState === 'loading' && <p role="status" className="mt-4 text-center font-mono text-xs text-cyber-text-dim">A gerar QR…</p>}
        {qrState === 'error' && <p role="alert" className="mt-4 text-center font-mono text-xs text-cyber-red">Não foi possível gerar o QR</p>}
        {qrState === 'ready' && qrSvg && (
          <div className="mx-auto mt-4 flex aspect-square w-full max-w-[260px] items-center justify-center bg-white p-3" role="img" aria-label="Código QR do convite">
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`} alt="" width="236" height="236" className="h-full w-full" />
          </div>
        )}
      </div>
    </div>
  );
}
