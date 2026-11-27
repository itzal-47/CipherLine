import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Plus, LogIn, Terminal, User, Settings as SettingsIcon } from 'lucide-react';
import { Typewriter } from '@/components/Typewriter';

interface HomeScreenProps {
  onNavigate: (screen: 'create' | 'join', nickname: string) => void;
  onLogin: () => void;
  isGuest: boolean;
  hasAccount: boolean;
  onOpenSettings?: () => void;
}

export function HomeScreen({ onNavigate, onLogin, isGuest, hasAccount, onOpenSettings }: HomeScreenProps) {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');

  const handleNavigate = (screen: 'create' | 'join') => {
    if (!nickname.trim()) {
      setError('CODINOME OBRIGATÓRIO');
      return;
    }
    setError('');
    onNavigate(screen, nickname.trim());
  };

  return (
    <div className="relative flex h-full flex-col items-center overflow-y-auto px-6 py-16">
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="fixed right-4 top-4 z-10 text-cyber-text-dim transition-colors hover:text-cyber-cyan"
          title="Definições"
        >
          <SettingsIcon size={16} />
        </button>
      )}
      <div className="m-auto w-full max-w-md flex flex-col items-center">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-12 text-center"
      >
        <div className="mb-3 flex items-center justify-center gap-2 text-cyber-green-dim">
          <Terminal size={16} className="text-cyber-green" />
          <span className="font-mono text-xs tracking-[0.3em]">v2.0 SECURE CHANNEL</span>
        </div>

        <h1
          className="glitch-text font-mono text-5xl font-bold tracking-[0.15em] text-cyber-green glow-green sm:text-6xl"
          data-text="CIPHERLINE"
        >
          CIPHERLINE
        </h1>

        <div className="mt-4 font-mono text-xs tracking-widest text-cyber-text-dim">
          <Typewriter text="ENCRYPTED · EPHEMERAL · SECURE" speed={50} />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="w-full max-w-sm"
      >
        <div className="glass clip-hud p-6">
          <label className="mb-2 flex items-center gap-2 font-mono text-xs tracking-widest text-cyber-text-dim">
            <Lock size={12} className="text-cyber-cyan" />
            IDENTIFICADOR
          </label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNavigate('create');
            }}
            maxLength={20}
            placeholder="> digite seu codinome..."
            className="w-full bg-transparent font-mono text-sm text-cyber-green placeholder-cyber-text-faint focus:outline-none"
            autoFocus
          />
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-2 font-mono text-xs text-cyber-red glow-red"
            >
              {`[!] ${error}`}
            </motion.p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleNavigate('create')}
            className="clip-hud-sm flex flex-1 items-center justify-center gap-2 border border-cyber-green/30 bg-cyber-green/5 px-6 py-4 font-mono text-sm font-bold tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/10 hover:shadow-[0_0_20px_rgba(0,255,157,0.2)]"
          >
            <Plus size={16} />
            CRIAR CANAL
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleNavigate('join')}
            className="clip-hud-sm flex flex-1 items-center justify-center gap-2 border border-cyber-cyan/30 bg-cyber-cyan/5 px-6 py-4 font-mono text-sm font-bold tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/10 hover:shadow-[0_0_20px_rgba(0,229,255,0.2)]"
          >
            <LogIn size={16} />
            ENTRAR EM CANAL
          </motion.button>
        </div>

        {!hasAccount && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-4"
          >
            <div className="h-px w-full bg-gradient-to-r from-transparent via-cyber-border to-transparent" />
            <button
              onClick={onLogin}
              className="mt-3 flex w-full items-center justify-center gap-2 font-mono text-xs tracking-widest text-cyber-amber/60 transition-colors hover:text-cyber-amber"
            >
              <User size={14} />
              {isGuest ? 'CRIAR CONTA PARA SALAS PERMANENTES' : 'ENTRAR COM CONTA'}
            </button>
          </motion.div>
        )}
      </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-4 font-mono text-[10px] tracking-widest text-cyber-text-faint"
      >
        <span>AES-256-GCM · CIFRA NO DISPOSITIVO</span>
        <span className="mx-2">·</span>
        <a href="/privacidade.html" className="transition-colors hover:text-cyber-text-dim">Privacidade</a>
      </motion.div>
    </div>
  );
}
