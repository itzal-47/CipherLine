import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface AiConsentDialogProps {
  onAccept: () => void;
  onCancel: () => void;
}

export function AiConsentDialog({ onAccept, onCancel }: AiConsentDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-consent-title"
        className="glass clip-hud w-full max-w-md border border-cyber-magenta/40 p-5 sm:p-6"
      >
        <h2 id="ai-consent-title" className="mb-4 font-mono text-sm tracking-widest text-cyber-magenta">
          EIVORAK USA IA EXTERNA
        </h2>
        <p className="mb-4 font-mono text-xs leading-relaxed text-cyber-text-dim">
          O EiVORAK não tem cifra de ponta a ponta. O que lhe enviares passa em claro pelo nosso servidor e segue para a Groq, o fornecedor de IA. Por defeito enviamos só o teu pedido (e a mensagem a que respondeste). Se escolheres incluir a conversa recente, também as últimas mensagens da sala, incluindo as de outros participantes. Não uses o EiVORAK com informação sensível.
        </p>
        <a
          href="/privacidade.html"
          target="_blank"
          rel="noopener noreferrer"
          className="mb-6 inline-flex min-h-11 items-center font-mono text-xs text-cyber-magenta underline underline-offset-4"
        >
          Política de privacidade
        </a>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onAccept}
            className="min-h-11 flex-1 clip-hud-sm border border-cyber-magenta/50 bg-cyber-magenta/15 px-4 py-3 font-mono text-xs tracking-widest text-cyber-magenta transition-colors hover:bg-cyber-magenta/25"
          >
            ACEITAR
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 clip-hud-sm border border-cyber-border px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-text"
          >
            CANCELAR
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
