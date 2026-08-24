import { motion } from 'framer-motion';
import { Clock, Plus } from 'lucide-react';

interface ExpiredScreenProps {
  roomCode: string;
  onCreateNew: () => void;
  onBack: () => void;
}

export function ExpiredScreen({ roomCode, onCreateNew, onBack }: ExpiredScreenProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Clock size={48} className="mx-auto mb-6 text-cyber-amber" style={{ filter: 'drop-shadow(0 0 8px rgba(255,170,0,0.4))' }} />
        </motion.div>

        <h2 className="mb-2 font-mono text-2xl font-bold tracking-[0.15em] text-cyber-amber" style={{ textShadow: '0 0 8px rgba(255,170,0,0.4)' }}>
          CANAL EXPIRADO
        </h2>

        <p className="mb-1 font-mono text-xs tracking-widest text-cyber-text-dim">
          O CANAL <span className="text-cyber-amber">{roomCode}</span>
        </p>
        <p className="mb-8 font-mono text-xs tracking-widest text-cyber-text-dim">
          NÃO ESTÁ MAIS DISPONÍVEL
        </p>

        <div className="flex flex-col gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCreateNew}
            className="clip-hud-sm flex items-center justify-center gap-2 border border-cyber-green/30 bg-cyber-green/5 px-6 py-4 font-mono text-sm font-bold tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/10 hover:shadow-[0_0_20px_rgba(0,255,157,0.2)]"
          >
            <Plus size={16} />
            CRIAR NOVO CANAL
          </motion.button>

          <button
            onClick={onBack}
            className="font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-text"
          >
            VOLTAR AO INÍCIO
          </button>
        </div>
      </motion.div>
    </div>
  );
}
