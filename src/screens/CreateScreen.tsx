import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Radar, X, AlertCircle, Check, Loader2, Info, Hash, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { generateRoomCode } from '@/lib/crypto';
import { saveParticipantCreds } from '@/lib/device';
import { joinRoomSecure } from '@/lib/participant';
import { CopyButton } from '@/components/CopyButton';
import { Typewriter } from '@/components/Typewriter';
import type { BurnConfig } from '@/types';
import { CRYPTO_V2_CREATE } from '@/lib/flags';
import { generateRoomSecret } from '@/lib/cryptoV2';
import { getRoomSecret, saveRoomSecret } from '@/lib/roomKeys';
import { InviteSheet } from '@/components/InviteSheet';
import { getJoinToken } from '@/lib/roomCrypto';

interface CreateScreenProps {
  nickname: string;
  onBack: () => void;
  onChannelCreated: (
    roomId: string,
    roomCode: string,
    participantId: string,
    secret: string | null,
    isPermanent: boolean,
    cryptoVersion: 1 | 2,
  ) => void;
  isGuest?: boolean;
  userId?: string;
  userNickname?: string;
}

type CodeType = 'auto' | 'custom';
type Duration = 'temp' | 'permanent';
type Visibility = 'private' | 'public';

export function CreateScreen({ nickname, onBack, onChannelCreated, isGuest, userId, userNickname }: CreateScreenProps) {
  const [codeType, setCodeType] = useState<CodeType>('auto');
  const [duration, setDuration] = useState<Duration>('temp');
  const [deadManDays, setDeadManDays] = useState<number | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [topic, setTopic] = useState('');
  const [roomName, setRoomName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [codeStatus, setCodeStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [roomCode, setRoomCode] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [createdCryptoVersion, setCreatedCryptoVersion] = useState<1 | 2>(1);
  const [, setParticipantId] = useState('');
  const [status, setStatus] = useState('INICIALIZANDO CANAL SEGURO...');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'config' | 'creating' | 'waiting'>('config');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (channelRef.current) channelRef.current.unsubscribe();
    };
  }, []);

  const checkCodeAvailability = useCallback((code: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCodeStatus('checking');
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.rpc('find_room_by_code', { p_code: code });
      setCodeStatus(data && data.length > 0 ? 'taken' : 'available');
    }, 500);
  }, []);

  const sanitizeCode = (raw: string): string => {
    return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  };

  const handleCustomCodeChange = (raw: string) => {
    const sanitized = sanitizeCode(raw);
    setCustomCode(sanitized);
    if (sanitized.length < 4) {
      setCodeStatus('idle');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    checkCodeAvailability(sanitized);
  };

  const canCreate = () => {
    if (codeType === 'auto') return true;
    return customCode.length >= 4 && customCode.length <= 24 && codeStatus === 'available';
  };

  const handleCreate = async () => {
    setError('');
    setPhase('creating');

    const code = codeType === 'auto' ? generateRoomCode() : customCode;
    const isPermanent = isGuest ? false : duration === 'permanent';
    const burnConfig: BurnConfig = { mode: 'off', seconds: 0 };
    const isPublic = visibility === 'public';
    const cryptoVersion: 1 | 2 = !isPublic && CRYPTO_V2_CREATE ? 2 : 1;
    const secret = cryptoVersion === 2 ? generateRoomSecret() : null;
    setCreatedCryptoVersion(cryptoVersion);
    const joinToken = secret ? await getJoinToken(code, secret) : null;

    setRoomCode(code);

    const { data: room, error: roomErr } = await supabase.rpc('create_room', {
      p_code: code,
      p_is_permanent: isPermanent,
      p_owner_id: userId || null,
      p_name: roomName.trim() || null,
      p_is_public: isPublic,
      p_topic: topic || null,
      p_dead_man_switch_days: isPermanent ? deadManDays : null,
      p_default_burn_config: JSON.parse(JSON.stringify(burnConfig)),
      p_crypto_version: cryptoVersion,
      p_join_token: joinToken,
    });

    if (roomErr || !room || room.length === 0) {
      setError(roomErr?.message?.includes('JÁ EM USO') ? 'CÓDIGO JÁ EM USO' : 'FALHA AO CRIAR CANAL');
      setPhase('config');
      return;
    }

    const createdRoom = Array.isArray(room) ? room[0] : room;

    // Entrada segura: cria/retoma participante e obtém segredo único.
    let joined;
    try {
      joined = await joinRoomSecure(code, userNickname || nickname, userId || null, joinToken);
    } catch (err) {
      setError((err as Error).message || 'FALHA AO REGISTRAR PARTICIPANTE');
      setPhase('config');
      return;
    }

    saveParticipantCreds(code, userNickname || nickname, joined.participantId, joined.secret);
    if (secret) {
      saveRoomSecret(code, secret);
    }
    setParticipantId(joined.participantId);
    setStatus('AGUARDANDO PARTICIPANTES...');
    setPhase('waiting');

    channelRef.current = supabase.channel(`room-${createdRoom.id}`);
    channelRef.current
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${createdRoom.id}` },
        (payload) => {
          if (payload.new.id !== joined.participantId) {
            onChannelCreated(createdRoom.id, code, joined.participantId, joined.secret, isPermanent, cryptoVersion);
          }
        },
      )
      .subscribe();
  };

  if (phase === 'waiting') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <button
          onClick={onBack}
          className="absolute left-4 top-4 flex items-center gap-1 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red"
        >
          <X size={14} />
          CANCELAR
        </button>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="glass clip-hud p-8 text-center">
            <div className="mb-3 font-mono text-xs tracking-widest text-cyber-text-dim">
              CÓDIGO DO CANAL
            </div>
            <div className="mb-4 flex items-center justify-center gap-3">
              <h2 className="break-all font-mono text-4xl font-bold tracking-[0.12em] text-cyber-green glow-green sm:text-5xl" translate="no">
                {roomCode}
              </h2>
            </div>
            {createdCryptoVersion === 2 ? (
              <>
                <div className="mb-4 inline-flex min-h-8 items-center gap-2 rounded border border-cyber-green/30 bg-cyber-green/10 px-3 font-mono text-xs text-cyber-green">
                  <Lock size={14} aria-hidden="true" /> Sala cifrada
                </div>
                <CopyButton text={roomCode} label="COPIAR CÓDIGO" />
                <button
                  onClick={() => setShowInvite(true)}
                  className="clip-hud-sm mt-4 min-h-12 w-full border border-cyber-green/40 bg-cyber-green/10 px-5 py-3 font-mono text-sm font-bold tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-green/60"
                >
                  CONVIDAR
                </button>
                <p className="mt-3 font-mono text-xs leading-relaxed text-cyber-text-dim">As pessoas com o convite podem ler o histórico. Neste dispositivo, o segredo fica guardado para voltar a abrir a sala.</p>
              </>
            ) : (
              <CopyButton text={roomCode} label="COPIAR CÓDIGO" />
            )}
            {duration === 'permanent' && !isGuest && (
              <div className="mt-3 font-mono text-[10px] tracking-widest text-cyber-cyan/50">
                [ SALA PERMANENTE ]
              </div>
            )}
            {visibility === 'public' && !isGuest && (
              <div className="mt-1 font-mono text-[10px] tracking-widest text-cyber-cyan/50">
                [ CANAL PÚBLICO ]
              </div>
            )}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex flex-col items-center"
          >
            <div className="relative mb-4 flex h-24 w-24 items-center justify-center">
              <motion.div
                className="absolute inset-0 rounded-full border border-cyber-green/30"
                animate={{ scale: [0.8, 1.4], opacity: [0.8, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-0 rounded-full border border-cyber-green/20"
                animate={{ scale: [0.8, 1.4], opacity: [0.6, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
              />
              <Radar size={32} className="text-cyber-green animate-radar" />
            </div>
            <div className="font-mono text-sm tracking-widest text-cyber-cyan glow-cyan">
              <Typewriter text={status} speed={30} />
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="mt-4 font-mono text-xs tracking-widest text-cyber-text-faint"
            >
              COMPARTILHE O CÓDIGO COM SEU CONTATO
            </motion.div>
          </motion.div>

          {showInvite && createdCryptoVersion === 2 && getRoomSecret(roomCode) && (
            <InviteSheet roomCode={roomCode} secret={getRoomSecret(roomCode)!} onClose={() => setShowInvite(false)} />
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-6 py-16">
      <button
        onClick={onBack}
        className="fixed left-4 top-4 z-10 flex items-center gap-1 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red"
      >
        <X size={14} />
        VOLTAR
      </button>

      <div className="m-auto w-full max-w-md">

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8 text-center"
      >
        <h2 className="font-mono text-2xl font-bold tracking-[0.15em] text-cyber-green glow-green">
          CRIAR CANAL
        </h2>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-4 font-mono text-xs text-cyber-red glow-red"
        >
          {`[!] ${error}`}
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="w-full max-w-md space-y-6"
      >
        {/* Nome do canal */}
        <div className="glass clip-hud p-5">
          <div className="mb-3 font-mono text-xs tracking-widest text-cyber-text-dim">
            NOME DO CANAL
          </div>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            maxLength={60}
            placeholder="Ex: Amigos, Família, Projeto X (opcional)"
            className="w-full bg-transparent font-mono text-sm text-cyber-green placeholder-cyber-text-faint focus:outline-none"
          />
          <p className="mt-2 font-mono text-[10px] text-cyber-text-faint">
            SÓ APARECE VISUALMENTE — NÃO SUBSTITUI O CÓDIGO DE ACESSO
          </p>
        </div>

        {/* Code type */}
        <div className="glass clip-hud p-5">
          <div className="mb-3 font-mono text-xs tracking-widest text-cyber-text-dim">
            TIPO DE CÓDIGO
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setCodeType('auto')}
              className={`clip-hud-sm flex-1 px-4 py-3 font-mono text-xs tracking-widest transition-colors ${
                codeType === 'auto'
                  ? 'border border-cyber-green/40 bg-cyber-green/10 text-cyber-green'
                  : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
              }`}
            >
              GERAR AUTOMATICAMENTE
            </button>
            <button
              onClick={() => setCodeType('custom')}
              className={`clip-hud-sm flex-1 px-4 py-3 font-mono text-xs tracking-widest transition-colors ${
                codeType === 'custom'
                  ? 'border border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan'
                  : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
              }`}
            >
              ESCOLHER MEU CÓDIGO
            </button>
          </div>

          {codeType === 'custom' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="overflow-hidden"
            >
              <input
                type="text"
                value={customCode}
                onChange={(e) => handleCustomCodeChange(e.target.value)}
                maxLength={24}
                placeholder="MEU-CANAL-SECRETO"
                className="mt-4 w-full bg-transparent font-mono text-lg tracking-widest text-cyber-cyan placeholder-cyber-text-faint focus:outline-none"
                autoFocus
                style={{ textTransform: 'uppercase' }}
              />
              <div className="mt-2 flex items-center gap-2">
                {codeStatus === 'checking' && (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-cyber-text-dim">
                    <Loader2 size={10} className="animate-spin" />
                    VERIFICANDO...
                  </span>
                )}
                {codeStatus === 'available' && (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-cyber-green glow-green">
                    <Check size={10} />
                    DISPONÍVEL
                  </span>
                )}
                {codeStatus === 'taken' && (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-cyber-red glow-red">
                    <AlertCircle size={10} />
                    CÓDIGO JÁ EM USO
                  </span>
                )}
                {codeStatus === 'idle' && customCode.length < 4 && customCode.length > 0 && (
                  <span className="font-mono text-[10px] text-cyber-text-faint">
                    MÍNIMO 4 CARACTERES
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-start gap-2 rounded border border-cyber-amber/20 bg-cyber-amber/5 px-3 py-2">
                <Info size={12} className="mt-0.5 shrink-0 text-cyber-amber" />
                <span className="font-mono text-[10px] leading-relaxed text-cyber-amber/70">
                  CÓDIGOS PERSONALIZADOS SÃO MAIS FÁCEIS DE ADIVINHAR — USE ALGO NÃO ÓBVIO PARA MAIS SEGURANÇA
                </span>
              </div>
            </motion.div>
          )}
        </div>

        {/* Visibility */}
        {!isGuest && (
          <div className="glass clip-hud p-5">
            <div className="mb-3 font-mono text-xs tracking-widest text-cyber-text-dim">
              VISIBILIDADE
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setVisibility('private')}
                className={`clip-hud-sm flex-1 px-4 py-3 font-mono text-xs tracking-widest transition-colors ${
                  visibility === 'private'
                    ? 'border border-cyber-green/40 bg-cyber-green/10 text-cyber-green'
                    : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
                }`}
              >
                <Lock size={12} className="mb-1 mx-auto" />
                PRIVADO
              </button>
              <button
                onClick={() => setVisibility('public')}
                className={`clip-hud-sm flex-1 px-4 py-3 font-mono text-xs tracking-widest transition-colors ${
                  visibility === 'public'
                    ? 'border border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan'
                    : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
                }`}
              >
                <Hash size={12} className="mb-1 mx-auto" />
                PÚBLICO
              </button>
            </div>
            {visibility === 'public' && (
              <>
                <p className="mt-3 rounded border border-cyber-amber/30 bg-cyber-amber/5 p-3 font-mono text-xs leading-relaxed text-cyber-amber">Canais públicos não são privados: qualquer conta pode ler as mensagens.</p>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={100}
                  placeholder="Tópico/descrição do canal (opcional)"
                  className="mt-3 w-full bg-transparent font-mono text-sm text-cyber-cyan placeholder-cyber-text-faint focus:outline-none"
                />
              </>
            )}
          </div>
        )}

        {/* Duration */}
        <div className="glass clip-hud p-5">
          <div className="mb-3 font-mono text-xs tracking-widest text-cyber-text-dim">
            DURAÇÃO DA SALA
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setDuration('temp')}
              className={`clip-hud-sm flex-1 px-4 py-3 font-mono text-xs tracking-widest transition-colors ${
                duration === 'temp'
                  ? 'border border-cyber-green/40 bg-cyber-green/10 text-cyber-green'
                  : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
              }`}
            >
              TEMPORÁRIA · 24H
            </button>
            <button
              onClick={() => setDuration('permanent')}
              disabled={isGuest}
              className={`clip-hud-sm flex-1 px-4 py-3 font-mono text-xs tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                duration === 'permanent' && !isGuest
                  ? 'border border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan'
                  : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
              }`}
            >
              PERMANENTE
            </button>
          </div>
          <div className="mt-2 font-mono text-[10px] leading-relaxed text-cyber-text-faint">
            {isGuest
              ? 'MODO CONVIDADO — APENAS SALAS TEMPORÁRIAS. CRIE UMA CONTA PARA SALAS PERMANENTES'
              : duration === 'temp'
                ? 'A SALA EXPIRA APÓS 24H DE INATIVIDADE'
                : 'A SALA PERMANECE ATIVA INDEFINIDAMENTE, MESMO VAZIA'}
          </div>
        </div>

        {duration === 'permanent' && !isGuest && (
          <div className="glass clip-hud p-5">
            <div className="mb-3 font-mono text-xs tracking-widest text-cyber-text-dim">
              GATILHO DE INATIVIDADE
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'DESATIVADO', value: null },
                { label: '30 DIAS', value: 30 },
                { label: '90 DIAS', value: 90 },
                { label: '180 DIAS', value: 180 },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setDeadManDays(opt.value)}
                  className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors ${
                    deadManDays === opt.value
                      ? 'border border-cyber-amber/40 bg-cyber-amber/10 text-cyber-amber'
                      : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="mt-2 font-mono text-[10px] leading-relaxed text-cyber-text-faint">
              {deadManDays
                ? `SE NINGUÉM ENVIAR MENSAGEM POR ${deadManDays} DIAS, A SALA E TUDO NELA É APAGADO PERMANENTEMENTE`
                : 'A SALA NUNCA É APAGADA POR INATIVIDADE'}
            </div>
          </div>
        )}

        <motion.button
          whileHover={canCreate() ? { scale: 1.02 } : {}}
          whileTap={canCreate() ? { scale: 0.98 } : {}}
          onClick={handleCreate}
          disabled={!canCreate()}
          className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-green/30 bg-cyber-green/5 px-6 py-4 font-mono text-sm font-bold tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/10 hover:shadow-[0_0_20px_rgba(0,255,157,0.2)] disabled:opacity-30 disabled:hover:bg-cyber-green/5"
        >
          INICIALIZAR CANAL
        </motion.button>
      </motion.div>
      </div>
    </div>
  );
}
