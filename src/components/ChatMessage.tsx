import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Clock, Trash2, Check, CheckCheck, Reply, UserRound, Pin, Sparkles, BarChart2, FileText, VolumeX } from 'lucide-react';
import { playDestroySound } from '@/lib/audio';
import { downloadAndDecryptImage } from '@/lib/media';
import { CapsuleContent } from '@/components/CapsuleContent';
import type { DecodedMessage, Reaction } from '@/types';
import type { RoomCrypto } from '@/lib/roomCrypto';

const AudioPlayer = lazy(() => import('@/components/AudioPlayer').then(m => ({ default: m.AudioPlayer })));
const ImageViewer = lazy(() => import('@/components/ImageViewer').then(m => ({ default: m.ImageViewer })));

const QUICK_EMOJIS = ['\u{1F44D}', '\u{1F525}', '\u{1F602}', '\u{1F62E}'];

interface ChatMessageProps {
  message: DecodedMessage;
  rc: RoomCrypto;
  participantId: string;
  isOwner: boolean;
  onDestroy: (id: string) => void;
  onDeleteForMe: (id: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: DecodedMessage) => void;
  onReplyPrivate: (message: DecodedMessage) => void;
  onWhisper: (message: DecodedMessage) => void;
  onPin: (message: DecodedMessage) => void;
  onScrollToMessage: (messageId: string) => void;
  onVote?: (messageId: string, optionId: string) => void; // NOVO: Para as enquetes
}

export function ChatMessage({ message, rc, participantId, isOwner, onDestroy, onDeleteForMe, onReact, onReply, onReplyPrivate, onWhisper, onPin, onScrollToMessage, onVote }: ChatMessageProps) {
  const [displayText, setDisplayText] = useState('');
  const [destroyCountdown, setDestroyCountdown] = useState(0);
  const [showReactions, setShowReactions] = useState(false);
  const [showDeleteChoice, setShowDeleteChoice] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [thumbUrl, setThumbUrl] = useState('');
  
  // NOVO: Estados para Transcrição e Áudio de 1x
  const [transcription, setTranscription] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioPlayed, setAudioPlayed] = useState(false);

  useEffect(() => {
    if (message.messageType !== 'image' || !message.storagePath) return;
    let revokeUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = await downloadAndDecryptImage(message.storagePath!, rc, { messageId: message.id, type: 'image' });
        if (cancelled) return;
        revokeUrl = URL.createObjectURL(blob);
        setThumbUrl(revokeUrl);
      } catch {}
    })();
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [message.id, message.messageType, message.storagePath, rc]);

  // Refs para long-press: se estivessem em useState, cada setLongPressTimer
  // forcava re-render desnecessario e o timer perdia-se entre renders.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flag para o onClick saber que o long-press acabou de disparar
  // (evita que o click sintetico do browser feche o menu que abrimos).
  const longPressFiredRef = useRef(false);
  const lastTapRef = useRef<number>(0);
  const destroyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Flag para nao chamar onDestroy repetidamente em cada tick de 200ms.
  const destroyFiredRef = useRef(false);

  const burnSeconds = message.burnConfig?.seconds ?? 0;
  const hasBurn = burnSeconds > 0;
  const isAudio = message.messageType === 'audio';
  const isImage = message.messageType === 'image';
  const isCapsule = message.messageType === 'capsule';
  const isPoll = message.messageType === 'poll';

  const isWhisper = !!message.targetParticipantId;
  const canReadWhisper = !isWhisper || message.isOwn || message.targetParticipantId === participantId;

  useEffect(() => {
    if (message.state !== 'decoded' || message.destroyAt === null || !hasBurn) return;

    // Usa destroyAt real (vem do banco ou do envio), nao o tempo desde o mount.
    // Isto garante que uma mensagem antiga restaurada do banco nao ganha
    // um countdown novo: se ja passou do prazo, dispara imediatamente.
    const destroyAt = message.destroyAt;
    const computeRemaining = () => Math.max(0, Math.ceil((destroyAt - Date.now()) / 1000));

    destroyFiredRef.current = false;
    const initialRemaining = computeRemaining();
    setDestroyCountdown(initialRemaining);

    if (initialRemaining <= 0) {
      // Mensagem antiga: expira logo, sem esperar 200ms
      destroyFiredRef.current = true;
      playDestroySound();
      onDestroy(message.id);
      return;
    }

    const tick = () => {
      const remaining = computeRemaining();
      setDestroyCountdown(remaining);
      // Guard: mesmo que o interval corra varias vezes, so dispara uma vez
      if (remaining <= 0 && !destroyFiredRef.current) {
        destroyFiredRef.current = true;
        if (destroyTimerRef.current) {
          clearInterval(destroyTimerRef.current);
          destroyTimerRef.current = null;
        }
        playDestroySound();
        onDestroy(message.id);
      }
    };
    destroyTimerRef.current = setInterval(tick, 200);
    return () => {
      if (destroyTimerRef.current) {
        clearInterval(destroyTimerRef.current);
        destroyTimerRef.current = null;
      }
    };
  }, [message.state, message.destroyAt]);

  useEffect(() => {
    if (message.state === 'decoded' && !displayText) setDisplayText(message.plaintext);
  }, [message.state, message.plaintext]);

  if (message.state === 'destroyed') return null;

  if (!canReadWhisper) {
    return (
      <div className={`flex min-w-0 ${message.isOwn ? 'justify-end' : 'justify-start'}`}>
        <div className="clip-hud-sm border border-cyber-magenta/30 bg-cyber-magenta/5 px-4 py-3 text-cyber-magenta/60 flex items-center gap-2">
          <Lock size={14} />
          <span className="font-mono text-xs">SUSSURRO PARA @{message.senderNickname} (PRIVADO)</span>
        </div>
      </div>
    );
  }

  const handleClick = () => {
    // Se o long-press acabou de disparar, o click sintetico que o browser
    // emite ao soltar o dedo NAO deve fechar o menu que o long-press abriu.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (message.state === 'decoded') {
      const now = Date.now();
      if (now - lastTapRef.current < 350) {
        setShowReactions((s) => !s);
        setShowActions(false);
      } else {
        setShowActions((s) => !s);
      }
      lastTapRef.current = now;
    }
  };

  const handleDelete = (e: React.MouseEvent) => { e.stopPropagation(); setShowDeleteChoice(true); };
  const confirmDeleteForEveryone = () => { setShowDeleteChoice(false); playDestroySound(); onDestroy(message.id); };
  const confirmDeleteForMe = () => { setShowDeleteChoice(false); onDeleteForMe(message.id); };

  const handleLongPressStart = () => {
    if (message.state !== 'decoded') return;
    longPressFiredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setShowActions(true);
      longPressTimerRef.current = null;
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const readByNames = message.readBy.map((r) => r.participant_id).filter((id) => id !== message.senderId);

  const renderDecodedContent = () => {
    if (isAudio && message.storagePath) {
      if (message.burnAfterListen && audioPlayed && !message.isOwn) {
        return (
          <div className="flex items-center gap-2 text-cyber-text-faint font-mono text-xs py-2">
            <VolumeX size={16} /> ÁUDIO OUVIR UMA VEZ (JÁ REPRODUZIDO)
          </div>
        );
      }

      return (
        <div className="min-w-0 flex flex-col gap-2">
          <Suspense fallback={<span className="font-mono text-xs text-cyber-text-dim">CARREGANDO...</span>}>
            <AudioPlayer 
              storagePath={message.storagePath} 
              rc={rc} messageId={message.id}
              durationSeconds={message.durationSeconds} 
              isScrambled={false} 
              onDecode={() => {}} 
              onPlay={() => setAudioPlayed(true)} // NOVO: Aciona o áudio de 1x
            />
          </Suspense>
          
          {/* Botão de Transcrição */}
          {!transcription && !message.isOwn && (
            <button 
              onClick={(e) => { e.stopPropagation(); setIsTranscribing(true); setTimeout(() => { setIsTranscribing(false); setTranscription("EiVORAK: A transcrição de áudio será ativada no próximo passo."); }, 2000); }}
              disabled={isTranscribing}
              className="flex items-center gap-1 font-mono text-[9px] text-cyber-cyan/60 hover:text-cyber-cyan transition-colors w-fit"
            >
              <FileText size={10} /> {isTranscribing ? 'A TRANSCREVER...' : 'TRANSCREVER ÁUDIO'}
            </button>
          )}
          {transcription && (
            <div className="mt-1 border-l-2 border-cyber-cyan/30 bg-cyber-cyan/5 px-2 py-1">
              <p className="font-sans text-xs text-cyber-text-dim italic">"{transcription}"</p>
            </div>
          )}
        </div>
      );
    }

    if (isImage && message.storagePath) {
      return (<div className="relative min-w-0"><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative overflow-hidden clip-hud-sm"><img src={thumbUrl} alt="img" className="max-h-64 w-full cursor-pointer object-cover" onClick={(e) => { e.stopPropagation(); setShowImageViewer(true); }} /></motion.div></div>);
    }

    if (isCapsule) return <CapsuleContent message={message} rc={rc} />;

    if (isPoll && message.pollData) {
      return (
        <div className="min-w-0 w-full max-w-xs">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-widest text-cyber-cyan">
            <BarChart2 size={12} /> ENQUETE
          </div>
          <p className="mb-3 font-sans text-sm font-bold text-cyber-text">{message.pollData.question}</p>
          <div className="space-y-2">
            {message.pollData.options.map((opt) => {
              const totalVotes = message.pollData!.options.reduce((acc, o) => acc + o.votes.length, 0);
              const myVote = opt.votes.includes(participantId);
              const percent = totalVotes === 0 ? 0 : Math.round((opt.votes.length / totalVotes) * 100);
              
              return (
                <button 
                  key={opt.id}
                  onClick={(e) => { e.stopPropagation(); if(onVote) onVote(message.id, opt.id); }}
                  className={`relative w-full overflow-hidden text-left clip-hud-sm border px-3 py-2 text-xs font-mono transition-colors ${
                    myVote ? 'border-cyber-green/50 text-cyber-green' : 'border-cyber-border text-cyber-text-dim hover:border-cyber-cyan/50'
                  }`}
                >
                  <div className="absolute inset-0 bg-cyber-green/10 transition-all" style={{ width: `${percent}%` }} />
                  <div className="relative z-10 flex justify-between items-center">
                    <span>{opt.text}</span>
                    <span className="text-[10px] opacity-70">{percent}%</span>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[9px] font-mono text-cyber-text-faint text-right">
            {message.pollData.options.reduce((acc, o) => acc + o.votes.length, 0)} votos
          </p>
        </div>
      );
    }

    return (<div className="relative min-w-0"><p className="min-w-0 break-words whitespace-pre-wrap font-sans text-sm leading-relaxed text-cyber-text" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>{displayText || message.plaintext}</p></div>);
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, filter: 'blur(8px)', scale: 0.9 }} transition={{ duration: 0.2 }} className={`flex min-w-0 ${message.isOwn ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex min-w-0 max-w-[80%] flex-col ${message.isOwn ? 'items-end' : 'items-start'}`}>
        {!message.isOwn && (
          <div className="mb-1 ml-1 flex items-center gap-1.5">
            {message.senderAvatarUrl && <img src={message.senderAvatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />}
            <span className="break-all font-mono text-[10px] tracking-widest text-cyber-text-dim">{message.senderDisplayName || message.senderNickname}</span>
            {isWhisper && <span className="font-mono text-[9px] text-cyber-magenta ml-2 px-1 border border-cyber-magenta/30 rounded">SUSSURRO</span>}
            {message.burnAfterListen && !isWhisper && <span className="font-mono text-[9px] text-cyber-amber ml-2 px-1 border border-cyber-amber/30 rounded">OUVIR 1X</span>}
          </div>
        )}
        
        <div className="relative">
          <AnimatePresence>
            {showActions && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} className={`absolute z-30 flex flex-col gap-1 rounded-lg border border-cyber-green/20 bg-cyber-panel/95 p-1.5 backdrop-blur ${message.isOwn ? 'right-0' : 'left-0'} bottom-full mb-1`}>
                <button onClick={(e) => { e.stopPropagation(); onReply(message); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-cyan transition-colors hover:text-cyber-green">
                  <Reply size={12} /> RESPONDER
                </button>
                {!message.isOwn && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); onWhisper(message); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-magenta transition-colors hover:text-cyber-green">
                      <Sparkles size={12} /> SUSSURRAR
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onReplyPrivate(message); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-amber transition-colors hover:text-cyber-green">
                      <UserRound size={12} /> RESPONDER EM PRIVADO
                    </button>
                  </>
                )}
                {isOwner && (
                  <button onClick={(e) => { e.stopPropagation(); onPin(message); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-amber transition-colors hover:text-cyber-green">
                    <Pin size={12} /> {message.isPinned ? 'DESAFIXAR' : 'FIXAR'}
                  </button>
                )}
                {message.isOwn && (
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(e); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-red transition-colors hover:text-cyber-red">
                    <Trash2 size={12} /> APAGAR
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            onClick={handleClick}
            onContextMenu={(e) => { if (message.state === 'decoded' && message.isOwn) { e.preventDefault(); setShowActions(true); } }}
            onTouchStart={handleLongPressStart}
            onTouchEnd={handleLongPressEnd}
            className={`clip-hud-sm relative min-w-0 overflow-hidden border px-4 py-3 cursor-pointer ${message.isOwn ? 'border-cyber-green/20 bg-cyber-green/5' : isWhisper ? 'border-cyber-magenta/30 bg-cyber-magenta/5' : isPoll ? 'border-cyber-cyan/40 bg-cyber-cyan/10' : 'border-cyber-cyan/20 bg-cyber-cyan/5'}`}
          >
            {message.isPinned && <Pin size={12} className="absolute top-2 right-2 text-cyber-amber" />}
            {message.aiGenerated && <div className="mb-2 font-mono text-[9px] tracking-widest text-cyber-magenta">GERADA POR IA</div>}
            {message.state === 'decoded' && message.replyToMessageId && message.replyToSenderNickname && (
              <button onClick={(e) => { e.stopPropagation(); onScrollToMessage(message.replyToMessageId!); }} className="mb-2 w-full border-l-2 border-cyber-cyan/40 bg-cyber-cyan/5 px-3 py-1.5 text-left transition-colors hover:bg-cyber-cyan/10">
                <div className="font-mono text-[10px] tracking-widest text-cyber-cyan/60">{message.replyToSenderNickname}</div>
                <div className="truncate font-mono text-xs text-cyber-text-dim">{message.replyToPlaintext || '[mensagem]'}</div>
              </button>
            )}

            {message.state === 'decoded' && renderDecodedContent()}

            {message.state === 'decoded' && hasBurn && message.destroyAt !== null && (
              <div className="mt-2 flex items-center gap-1.5">
                <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-cyber-border"><motion.div className="h-full bg-cyber-green" initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: burnSeconds, ease: 'linear' }} /></div>
                <Clock size={10} className="shrink-0 text-cyber-text-faint" />
                <span className="shrink-0 font-mono text-[10px] text-cyber-text-faint">{destroyCountdown}s</span>
              </div>
            )}

            {message.reactions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {message.reactions.slice(-6).map((r: Reaction, i: number) => (
                  <motion.span key={`${r.id}-${i}`} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-sm">{r.emoji}</motion.span>
                ))}
              </div>
            )}

            {message.isOwn && message.state === 'decoded' && (
              <div className="mt-1 flex items-center justify-end gap-1">
                {readByNames.length > 0 ? (<><CheckCheck size={11} className="text-cyber-cyan" /><span className="font-mono text-[9px] text-cyber-cyan/60">LIDA</span></>) : (<><Check size={11} className="text-cyber-text-faint" /><span className="font-mono text-[9px] text-cyber-text-faint">ENVIADA</span></>)}
              </div>
            )}

            <div className={`mt-1 font-mono text-[10px] text-cyber-text-faint ${message.isOwn ? 'text-right' : 'text-left'}`}>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>

            <AnimatePresence>{showDeleteChoice && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="absolute right-1 top-8 z-30 clip-hud-sm border border-cyber-red/30 bg-cyber-bg/95 p-2 backdrop-blur">
                  <button onClick={confirmDeleteForMe} className="block w-full px-2 py-1.5 text-left font-mono text-[10px] tracking-widest text-cyber-text-dim hover:text-cyber-text">APAGAR SÓ PARA MIM</button>
                  <button onClick={confirmDeleteForEveryone} className="block w-full px-2 py-1.5 text-left font-mono text-[10px] tracking-widest text-cyber-red hover:bg-cyber-red/10">APAGAR PARA TODOS</button>
                  <button onClick={() => setShowDeleteChoice(false)} className="block w-full px-2 py-1.5 text-left font-mono text-[10px] tracking-widest text-cyber-text-faint hover:text-cyber-text">CANCELAR</button>
                </motion.div>
            )}</AnimatePresence>

            <AnimatePresence>{showReactions && (
                <motion.div initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.8 }} className="absolute -top-12 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-lg border border-cyber-green/30 bg-cyber-panel/95 px-2 py-1.5 backdrop-blur">
                  {QUICK_EMOJIS.map((emoji) => (<motion.button key={emoji} whileHover={{ scale: 1.3 }} whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); onReact(message.id, emoji); setShowReactions(false); }} className="text-lg">{emoji}</motion.button>))}
                </motion.div>
            )}</AnimatePresence>
          </motion.div>
        </div>
      </div>
      {showImageViewer && isImage && message.storagePath && (<Suspense fallback={null}><ImageViewer storagePath={message.storagePath} rc={rc} messageId={message.id} onClose={() => setShowImageViewer(false)} /></Suspense>)}
    </motion.div>
  );
}
