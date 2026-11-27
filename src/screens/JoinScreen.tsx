import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, LogIn, AlertTriangle, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Typewriter } from '@/components/Typewriter';
import { saveParticipantCreds } from '@/lib/device';
import { joinRoomSecure } from '@/lib/participant';
import { getJoinToken } from '@/lib/roomCrypto';
import { getRoomSecret, saveRoomSecret } from '@/lib/roomKeys';
import { SECURE_READS } from '@/lib/flags';

interface JoinScreenProps {
  nickname: string;
  onBack: () => void;
  onChannelJoined: (
    roomId: string,
    roomCode: string,
    participantId: string,
    secret: string | null,
    isPermanent: boolean,
    cryptoVersion: 1 | 2,
  ) => void;
  onExpired: (roomCode: string) => void;
  userId?: string;
  initialCode?: string;
  initialSecret?: string | null;
}

export function JoinScreen({ nickname, onBack, onChannelJoined, onExpired, userId, initialCode, initialSecret }: JoinScreenProps) {
  const [code, setCode] = useState(initialCode || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const sanitizeCode = (raw: string): string => {
    return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  };

  const handleJoin = async () => {
    const trimmed = sanitizeCode(code);
    if (!trimmed) {
      setError('INSIRA O CÓDIGO DO CANAL');
      return;
    }

    setError('');
    setLoading(true);

    const { data: roomData, error: roomErr } = await supabase.rpc('find_room_by_code', {
      p_code: trimmed,
    });

    if (roomErr || !roomData || roomData.length === 0) {
      const { data: expiredRoom } = await supabase.rpc('find_room_by_code_any', { p_code: trimmed });
      if (expiredRoom && expiredRoom.length > 0) {
        onExpired(trimmed);
        setLoading(false);
        return;
      }
      setError('SALA NÃO ENCONTRADA — VERIFIQUE O CÓDIGO');
      setLoading(false);
      return;
    }

    const room = roomData[0];
    const isPermanent = room.is_permanent ?? false;

    // Gatilho de inatividade: verifica antes de deixar entrar.
    let mediaMsgs: { storage_path: string | null }[] | null = null;
    if (!SECURE_READS) {
      const { data } = await supabase
        .from('messages')
        .select('storage_path')
        .eq('room_id', room.id)
        .not('storage_path', 'is', null);
      mediaMsgs = data;
    }
    const { data: wasWiped } = await supabase.rpc('check_and_wipe_if_inactive', {
      p_room_id: room.id,
    });
    if (wasWiped) {
      if (!SECURE_READS && mediaMsgs && mediaMsgs.length > 0) {
        const paths = mediaMsgs.map((m) => m.storage_path).filter(Boolean) as string[];
        await supabase.storage.from('cipherline-media').remove(paths);
      }
      onExpired(trimmed);
      setLoading(false);
      return;
    }

    // Entrada segura — a RPC trata de reconexão, device_id, user_id
    // e devolve o segredo único que será exigido nas escritas.
    let joined;
    let usedJoinSecret = false;
    try {
      const storedSecret = initialSecret || getRoomSecret(trimmed);
      usedJoinSecret = Boolean(storedSecret);
      const joinToken = storedSecret ? await getJoinToken(trimmed, storedSecret) : null;
      joined = await joinRoomSecure(trimmed, nickname, userId || null, joinToken);
    } catch (err) {
      const message = (err as Error).message || '';
      setError(message.includes('JOIN_TOKEN_INVALIDO')
        ? (usedJoinSecret ? 'LINK DE CONVITE INVÁLIDO' : 'ESTA SALA PRECISA DE UM LINK DE CONVITE')
        : message || 'FALHA AO ENTRAR NO CANAL');
      setLoading(false);
      return;
    }

    saveParticipantCreds(trimmed, nickname, joined.participantId, joined.secret);
    if (initialSecret) saveRoomSecret(trimmed, initialSecret);
    onChannelJoined(joined.roomId, trimmed, joined.participantId, joined.secret, isPermanent, joined.cryptoVersion);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <button
        onClick={onBack}
        className="absolute left-4 top-4 flex items-center gap-1 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red"
      >
        <X size={14} />
        VOLTAR
      </button>

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8 text-center"
      >
        <h2 className="flex items-center justify-center gap-2 font-mono text-2xl font-bold tracking-[0.15em] text-cyber-cyan glow-cyan">
          {initialSecret && <Lock size={20} aria-hidden="true" />}
          {initialSecret ? 'CONVITE RECEBIDO' : 'ENTRAR EM CANAL'}
        </h2>
        <div className="mt-3 font-mono text-xs tracking-widest text-cyber-text-dim">
          <Typewriter text={initialSecret ? 'ABRIR SALA DO CONVITE' : 'INSIRA O CÓDIGO FORNECIDO'} speed={30} />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="w-full max-w-sm"
      >
        <div className="glass-cyan clip-hud p-6">
          <label htmlFor="join-room-code" className="mb-2 flex items-center gap-2 font-mono text-xs tracking-widest text-cyber-text-dim">
            CÓDIGO DO CANAL
          </label>
          <input
            id="join-room-code"
            name="room-code"
            type="text"
            value={code}
            onChange={(e) => setCode(sanitizeCode(e.target.value))}
            readOnly={Boolean(initialSecret)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleJoin();
            }}
            maxLength={24}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent text-center font-mono text-2xl font-bold tracking-[0.15em] text-cyber-cyan placeholder-cyber-text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-cyan/50"
            style={{ textTransform: 'uppercase' }}
          />
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="mt-4 flex items-center gap-2 font-mono text-xs text-cyber-red glow-red"
          >
            <AlertTriangle size={14} />
            {error}
          </motion.div>
        )}

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleJoin}
          disabled={loading}
          className="clip-hud-sm mt-6 flex w-full items-center justify-center gap-2 border border-cyber-cyan/30 bg-cyber-cyan/5 px-6 py-4 font-mono text-sm font-bold tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/10 hover:shadow-[0_0_20px_rgba(0,229,255,0.2)] disabled:opacity-50"
        >
          <LogIn size={16} />
          {loading ? 'CONECTANDO...' : initialSecret ? 'ENTRAR' : 'CONECTAR'}
        </motion.button>
      </motion.div>
    </div>
  );
}
