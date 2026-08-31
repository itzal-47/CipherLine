import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Clock, Trash2, Check, CheckCheck, ImageIcon, AudioLines, Reply, UserRound } from 'lucide-react';
import { playDestroySound } from '@/lib/audio';
import { getImageUrl } from '@/lib/media';
import { CapsuleContent } from '@/components/CapsuleContent';
import type { DecodedMessage, Reaction } from '@/types';

const AudioPlayer = lazy(() => import('@/components/AudioPlayer').then(m => ({ default: m.AudioPlayer })));
const ImageViewer = lazy(() => import('@/components/ImageViewer').then(m => ({ default: m.ImageViewer })));

const QUICK_EMOJIS = ['👍', '🔥', '😂', '😮'];

interface ChatMessageProps {
  message: DecodedMessage;
  roomCode: string;
  onDestroy: (id: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: DecodedMessage) => void;
  onReplyPrivate: (message: DecodedMessage) => void;
  onScrollToMessage: (messageId: string) => void;
}

export function ChatMessage({ message, roomCode, onDestroy, onReact, onReply, onReplyPrivate, onScrollToMessage }: ChatMessageProps) {
  const [displayText, setDisplayText] = useState('');
  const [destroyCountdown, setDestroyCountdown] = useState(0);
  const [showReactions, setShowReactions] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [thumbUrl, setThumbUrl] = useState('');

  useEffect(() => {
    if (message.messageType === 'image' && message.storagePath) {
      getImageUrl(message.storagePath).then(setThumbUrl).catch(() => {});
    }
  }, [message.messageType, message.storagePath]);
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<number>(0);
  const destroyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const burnSeconds = message.burnConfig?.seconds ?? 0;
  const hasBurn = burnSeconds > 0;
  const isText = message.messageType === 'text';
  const isAudio = message.messageType === 'audio';
  const isImage = message.messageType === 'image';
  const isCapsule = message.messageType === 'capsule';

  // Decoded state: countdown to self-destruct (only if burn is active)
  useEffect(() => {
    if (message.state !== 'decoded' || message.destroyAt === null || !hasBurn) return;
    setDestroyCountdown(burnSeconds);
    const startTime = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const remaining = Math.ceil((burnSeconds * 1000 - elapsed) / 1000);
      setDestroyCountdown(Math.max(remaining, 0));
      if (remaining <= 0) {
        playDestroySound();
        onDestroy(message.id);
      }
    };
    destroyTimerRef.current = setInterval(tick, 200);
    return () => {
      if (destroyTimerRef.current) clearInterval(destroyTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.state, message.destroyAt]);

  // Inicializa o texto exibido assim que a mensagem chega já decodificada
  // (tanto enviada quanto recebida — não existe mais a etapa de "tocar para
  // decodificar").
  useEffect(() => {
    if (message.state === 'decoded' && !displayText) {
      setDisplayText(message.plaintext);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.state, message.plaintext]);

  if (message.state === 'destroyed') return null;

  const isScrambled = false;
  const isDecoding = false;
  const isDecoded = message.state === 'decoded';

  const handleClick = () => {
    if (isDecoded) {
      const now = Date.now();
      if (now - lastTapRef.current < 350) {
        setShowReactions((s) => !s);
        setShowDelete(false);
        setShowActions(false);
      } else {
        setShowActions((s) => !s);
        setShowDelete(false);
      }
      lastTapRef.current = now;
    }
  };

  const handleReact = (emoji: string) => {
    onReact(message.id, emoji);
    setShowReactions(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    playDestroySound();
    onDestroy(message.id);
  };

  const handleLongPressStart = () => {
    if (!isDecoded) return;
    const timer = setTimeout(() => setShowActions(true), 500);
    setLongPressTimer(timer);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  const readByNames = message.readBy.map((r) => r.participant_id).filter((id) => id !== message.senderId);

  const renderScrambledContent = () => {
    if (isAudio) {
      return (
        <div className="flex min-w-0 items-center gap-2 py-1">
          <Lock size={12} className="shrink-0 text-cyber-amber" />
          <AudioLines size={16} className="shrink-0 text-cyber-amber/70" />
          <span className="min-w-0 break-all font-mono text-xs text-cyber-amber/70" style={{ overflowWrap: 'break-word', wordBreak: 'break-all' }}>
            {displayText}
          </span>
        </div>
      );
    }
    if (isImage) {
      return (
        <div className="flex min-w-0 items-center gap-2 py-1">
          <Lock size={12} className="shrink-0 text-cyber-amber" />
          <ImageIcon size={16} className="shrink-0 text-cyber-amber/70" />
          <span className="min-w-0 break-all font-mono text-xs text-cyber-amber/70" style={{ overflowWrap: 'break-word', wordBreak: 'break-all' }}>
            {displayText}
          </span>
        </div>
      );
    }
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Lock size={12} className="shrink-0 text-cyber-amber" />
        <span
          className={`min-w-0 break-all font-mono text-sm ${isScrambled ? 'text-cyber-amber/70' : 'text-cyber-green'}`}
          style={{ overflowWrap: 'break-word', wordBreak: 'break-all' }}
        >
          {displayText}
        </span>
      </div>
    );
  };

  const renderDecodedContent = () => {
    if (isAudio && message.storagePath) {
      return (
        <div className="min-w-0">
          <Suspense fallback={<span className="font-mono text-xs text-cyber-text-dim">CARREGANDO PLAYER...</span>}>
            <AudioPlayer
              storagePath={message.storagePath}
              roomCode={roomCode}
              durationSeconds={message.durationSeconds}
              isScrambled={false}
              onDecode={() => {}}
            />
          </Suspense>
        </div>
      );
    }
    if (isImage && message.storagePath) {
      return (
        <div className="relative min-w-0">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="relative overflow-hidden clip-hud-sm"
          >
            <img
              src={thumbUrl}
              alt="img"
              className="max-h-64 w-full cursor-pointer object-cover"
              onClick={(e) => {
                e.stopPropagation();
                setShowImageViewer(true);
              }}
            />
            <motion.div
              className="absolute left-0 top-0 h-full w-0.5 bg-cyber-green/60"
              initial={{ y: '-100%' }}
              animate={{ y: '100%' }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            />
          </motion.div>
        </div>
      );
    }
    if (isCapsule) {
      return <CapsuleContent message={message} />;
    }
    // Text
    return (
      <div className="relative min-w-0">
        <p
          className="min-w-0 break-words whitespace-pre-wrap font-sans text-sm leading-relaxed text-cyber-text"
          style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}
        >
          {displayText || message.plaintext}
        </p>
      </div>
    );
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, filter: 'blur(8px)', scale: 0.9 }}
      transition={{ duration: 0.2 }}
      className={`flex min-w-0 ${message.isOwn ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`flex min-w-0 max-w-[80%] flex-col ${message.isOwn ? 'items-end' : 'items-start'}`}>
        {!message.isOwn && (
          <div className="mb-1 ml-1 break-all font-mono text-[10px] tracking-widest text-cyber-text-dim">
            {message.senderNickname}
          </div>
        )}
        <motion.div
          onClick={handleClick}
          onContextMenu={(e) => {
            if (isDecoded && message.isOwn) {
              e.preventDefault();
              setShowDelete((s) => !s);
            }
          }}
          onTouchStart={handleLongPressStart}
          onTouchEnd={handleLongPressEnd}
          className={`clip-hud-sm relative min-w-0 overflow-hidden border px-4 py-3 ${
            isScrambled ? 'cursor-pointer' : isDecoded ? 'cursor-pointer' : ''
          } ${
            message.isOwn
              ? 'border-cyber-green/20 bg-cyber-green/5'
              : 'border-cyber-cyan/20 bg-cyber-cyan/5'
          } ${isScrambled ? 'hover:border-cyber-amber/40' : ''}`}
          whileHover={isScrambled ? { scale: 1.01 } : {}}
          whileTap={isScrambled ? { scale: 0.99 } : {}}
        >
          {/* Reply quote */}
          {isDecoded && message.replyToMessageId && message.replyToSenderNickname && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onScrollToMessage(message.replyToMessageId!);
              }}
              className="mb-2 w-full border-l-2 border-cyber-cyan/40 bg-cyber-cyan/5 px-3 py-1.5 text-left transition-colors hover:bg-cyber-cyan/10"
            >
              <div className="font-mono text-[10px] tracking-widest text-cyber-cyan/60">
                {message.replyToSenderNickname}
              </div>
              <div className="truncate font-mono text-xs text-cyber-text-dim">
                {message.replyToPlaintext || '[mensagem]'}
              </div>
            </button>
          )}

          {/* Scrambled / Decoding */}
          {(isScrambled || isDecoding) && renderScrambledContent()}

          {/* Decoded */}
          {isDecoded && renderDecodedContent()}

          {/* Burn timer (applies to all message types) */}
          {isDecoded && hasBurn && message.destroyAt !== null && (
            <div className="mt-2 flex items-center gap-1.5">
              <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-cyber-border">
                <motion.div
                  className="h-full bg-cyber-green"
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: burnSeconds, ease: 'linear' }}
                />
              </div>
              <Clock size={10} className="shrink-0 text-cyber-text-faint" />
              <span className="shrink-0 font-mono text-[10px] text-cyber-text-faint">
                {destroyCountdown}s
              </span>
            </div>
          )}

          {/* Reactions */}
          {message.reactions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {message.reactions.slice(-6).map((r: Reaction, i: number) => (
                <motion.span
                  key={`${r.id}-${i}`}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-sm"
                >
                  {r.emoji}
                </motion.span>
              ))}
            </div>
          )}

          {/* Read receipts for own messages */}
          {message.isOwn && isDecoded && (
            <div className="mt-1 flex items-center justify-end gap-1">
              {readByNames.length > 0 ? (
                <>
                  <CheckCheck size={11} className="text-cyber-cyan" />
                  <span className="font-mono text-[9px] text-cyber-cyan/60">
                    LIDA{readByNames.length > 1 ? ` POR ${readByNames.length}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <Check size={11} className="text-cyber-text-faint" />
                  <span className="font-mono text-[9px] text-cyber-text-faint">ENVIADA</span>
                </>
              )}
            </div>
          )}

          {/* Timestamp */}
          <div
            className={`mt-1 font-mono text-[10px] text-cyber-text-faint ${
              message.isOwn ? 'text-right' : 'text-left'
            }`}
          >
            {new Date(message.createdAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>

          {/* Manual delete button (own messages only) */}
          <AnimatePresence>
            {showDelete && message.isOwn && isDecoded && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={handleDelete}
                className="absolute right-1 top-1 z-20 rounded border border-cyber-red/30 bg-cyber-bg/80 p-1 text-cyber-red backdrop-blur transition-colors hover:bg-cyber-red/20"
                title="Apagar mensagem"
              >
                <Trash2 size={12} />
              </motion.button>
            )}
          </AnimatePresence>

          {/* Quick reaction picker */}
          <AnimatePresence>
            {showReactions && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.8 }}
                className="absolute -top-12 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-lg border border-cyber-green/30 bg-cyber-panel/95 px-2 py-1.5 backdrop-blur"
              >
                {QUICK_EMOJIS.map((emoji) => (
                  <motion.button
                    key={emoji}
                    whileHover={{ scale: 1.3 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReact(emoji);
                    }}
                    className="text-lg"
                  >
                    {emoji}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action menu (reply, reply private, delete) */}
          <AnimatePresence>
            {showActions && isDecoded && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className={`absolute z-30 flex flex-col gap-1 rounded-lg border border-cyber-green/20 bg-cyber-panel/95 p-1.5 backdrop-blur ${
                  message.isOwn ? 'right-0' : 'left-0'
                } -top-2`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReply(message);
                    setShowActions(false);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-cyan transition-colors hover:text-cyber-green"
                >
                  <Reply size={12} /> RESPONDER
                </button>
                {!message.isOwn && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReplyPrivate(message);
                      setShowActions(false);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-amber transition-colors hover:text-cyber-green"
                  >
                    <UserRound size={12} /> RESPONDER EM PRIVADO
                  </button>
                )}
                {message.isOwn && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(e);
                      setShowActions(false);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-red transition-colors hover:text-cyber-red"
                  >
                    <Trash2 size={12} /> APAGAR
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Fullscreen image viewer */}
      {showImageViewer && isImage && message.storagePath && (
        <Suspense fallback={null}>
          <ImageViewer
            storagePath={message.storagePath}
            onClose={() => setShowImageViewer(false)}
          />
        </Suspense>
      )}
    </motion.div>
  );
}
