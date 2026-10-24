import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Apanha exceções em qualquer ponto da árvore React abaixo e mostra
 * um ecrã de erro com opções de recuperação, em vez do ecrã branco
 * silencioso que o React dá por defeito.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log para o console — em produção, considera enviar para um
    // serviço de monitorização (Sentry, etc.) mais tarde.
    console.error('[CipherLine] Erro capturado pelo ErrorBoundary:', error);
    console.error('[CipherLine] Stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetCache = () => {
    try {
      // Limpa só o que é nosso — não mexe no auth da Supabase
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (
          k.startsWith('cipherline_chat_session') ||
          k.startsWith('cipherline_participant') ||
          k.startsWith('cipherline_hidden_messages')
        ) {
          localStorage.removeItem(k);
        }
      }
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const errorMessage = this.state.error?.message || 'Erro desconhecido';

    return (
      <div className="app-viewport relative w-screen overflow-hidden bg-cyber-bg">
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <div className="glass clip-hud max-w-md p-8">
            <div className="mb-4 font-mono text-3xl font-bold tracking-widest text-cyber-red glow-red">
              FALHA CRÍTICA
            </div>
            <p className="mb-2 font-mono text-xs tracking-widest text-cyber-text-dim">
              O CANAL ENCONTROU UM ERRO INESPERADO
            </p>
            <p className="mb-6 break-all font-mono text-[10px] text-cyber-text-faint">
              {errorMessage.slice(0, 200)}
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={this.handleReload}
                className="clip-hud-sm border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20"
              >
                RECARREGAR
              </button>
              <button
                onClick={this.handleResetCache}
                className="clip-hud-sm border border-cyber-amber/30 bg-cyber-amber/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-amber transition-colors hover:bg-cyber-amber/20"
              >
                LIMPAR CACHE E RECARREGAR
              </button>
            </div>

            <p className="mt-6 font-mono text-[9px] leading-relaxed text-cyber-text-faint">
              SE O PROBLEMA PERSISTIR, ABRA UM BUG REPORT EM DEFINIÇÕES → REPORTAR BUG
            </p>
          </div>
        </div>
      </div>
    );
  }
}