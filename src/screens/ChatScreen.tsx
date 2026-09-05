import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, ArrowDown, Send, AlertTriangle, Settings, Lock, Clock, X, Users, Smartphone, Monitor, Mic, Image as ImageIcon, Phone, Video, Reply, XCircle, WifiOff, Sparkles, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { encryptText, decryptText } from '@/lib/crypto';
import { playSendSound, playReceiveSound } from '@/lib/audio';
import { getDeviceId, getHiddenMessageIds, hideMessageLocally } from '@/lib/device';
import { requestNotificationPermission, subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import { uploadEncryptedAudio, uploadImage, uploadBackgroundImage, getImageUrl, deleteStorageFile } from '@/lib/media';
import { StatusDot } from '@/components/StatusDot';
import { CopyButton } from '@/components/CopyButton';
import { Typewriter } from '@/components/Typewriter';
import { ChatMessage } from '@/components/ChatMessage';
import { AudioRecorder } from '@/components/AudioRecorder';
import { ImageUploader } from '@/components/ImageUploader';
import { CapsuleComposer } from '@/components/CapsuleComposer';
import { ChatBackground, type BackgroundMode } from '@/components/ChatBackground';
import { jsonToBurnConfig, createBurnConfig } from '@/types';
import type { DecodedMessage, Participant, Reaction, ReadReceipt, BurnConfig, MessageType } from '@/types';

const CallScreen = lazy(() => import('@/components/CallScreen').then(m => ({ default: m.CallScreen })));
const GroupCallScreen = lazy(() => import('@/components/GroupCallScreen').then(m => ({ default: m.GroupCallScreen })));
import { subscribeSignaling, sendOnChannel, type SignalingMessage } from '@/lib/webrtc';

interface ChatScreenProps {
  roomId: string;
  roomCode: string;
  participantId: string;
  nickname: string;
  isPermanent: boolean;
  onLeave: () => void;
  userId?: string;
  onSuppressScanlines?: (suppress: boolean) => void;
  onOpenPrivateReply?: (roomId: string, roomCode: string, quote: { text: string; sender: string; roomName: string }) => void;
  initialQuote?: { text: string; sender: string; roomName: string } | null;
  onQuoteConsumed?: () => void;
}

const PRESENCE_INTERVAL = 10000;
const PRESENCE_TIMEOUT_MS = 20000;
const PRESENCE_CHECK_INTERVAL = 5000;
const TYPING_TIMEOUT = 3000;

const BURN_OPTIONS: { label: string; value: BurnConfig['mode'] }[] = [
  { label: 'Desativado', value: 'off' },
  { label: 'Ao ser lida (6s)', value: 'on_read' },
  { label: '24 horas', value: '24h' },
  { label: '7 dias', value: '7d' },
];

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // silent fallback
    }
  }
}

export function ChatScreen({ roomId, roomCode, participantId, nickname, isPermanent, onLeave, userId, onSuppressScanlines, onOpenPrivateReply, initialQuote, onQuoteConsumed }: ChatScreenProps) {
  const [messages, setMessages] = useState<DecodedMessage[]>([]);
  const [input, setInput] = useState('');

  // Ao chegar aqui vindo de "Responder em Privado", pré-preenche o campo
  // com a citação da mensagem original, pra dar contexto sem precisar de
  // um mecanismo de resposta entre salas diferentes.
  useEffect(() => {
    if (initialQuote) {
      setInput(`↩️ Sobre "${initialQuote.text}" (${initialQuote.sender}, em ${initialQuote.roomName}):\n`);
      onQuoteConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [peers, setPeers] = useState<Participant[]>([]);
  const [typingPeers, setTypingPeers] = useState<Set<string>>(new Set());
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [systemMessage, setSystemMessage] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showBurnSettings, setShowBurnSettings] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgMode, setBgMode] = useState<BackgroundMode>('default');
  const [showBgSettings, setShowBgSettings] = useState(false);
  const [bgStep, setBgStep] = useState<'menu' | 'upload' | 'mode' | 'scope'>('menu');
  const [pendingBgBlob, setPendingBgBlob] = useState<Blob | null>(null);
  const [pendingBgMode, setPendingBgMode] = useState<BackgroundMode>('default');
  const [bgSaving, setBgSaving] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const [roomName, setRoomName] = useState('');
  const [eivorakThinking, setEivorakThinking] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [pasteSaving, setPasteSaving] = useState(false);
  const pasteTextareaFocusedRef = useRef(false);
  const pasteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCapsuleComposer, setShowCapsuleComposer] = useState(false);
  const [showEivorakMenu, setShowEivorakMenu] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [editRoomName, setEditRoomName] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(false);
  const [channelSettingsSaving, setChannelSettingsSaving] = useState(false);
  const [showParticipantPanel, setShowParticipantPanel] = useState(false);
  const [burnConfig, setBurnConfig] = useState<BurnConfig>({ mode: 'off', seconds: 0 });
  const [customBurnValue, setCustomBurnValue] = useState('');
  const [customBurnUnit, setCustomBurnUnit] = useState<'seconds' | 'minutes' | 'hours'>('minutes');
  const [onlinePeerIds, setOnlinePeerIds] = useState<Set<string>>(new Set());
  const [hasInteracted, setHasInteracted] = useState(false);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [showAudioRecorder, setShowAudioRecorder] = useState(false);
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [activeCall, setActiveCall] = useState<{ peerId: string; peerNickname: string; withVideo: boolean; isInitiator: boolean } | null>(null);
  const [activeGroupCall, setActiveGroupCall] = useState<{ withVideo: boolean } | null>(null);
  const [groupCallInvite, setGroupCallInvite] = useState<{ withVideo: boolean } | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ from: string; fromNickname: string; withVideo: boolean } | null>(null);
  const [replyTo, setReplyTo] = useState<DecodedMessage | null>(null);
  const webrtcChannelRef = useRef<any>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'offline'>('connected');
  const chatChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const connectionGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const presenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceIdRef = useRef<string>(getDeviceId());

  // Load existing messages + participants + room burn config
  useEffect(() => {
    loadInitialData();
    loadBackground();
    loadPaste();
    supabase.from('rooms').select('name, is_public').eq('id', roomId).maybeSingle().then(({ data }) => {
      if (data?.name) setRoomName(data.name);
      setEditRoomName(data?.name || '');
      setEditIsPublic(data?.is_public || false);
    });

    const pasteChannel = supabase
      .channel(`paste-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_pastes', filter: `room_id=eq.${roomId}` },
        async (payload: any) => {
          // Não sobrescreve o que a pessoa está digitando agora mesmo
          if (pasteTextareaFocusedRef.current) return;
          const encrypted = payload.new?.encrypted_content;
          if (encrypted) {
            const plain = await decryptText(encrypted, roomCode);
            if (plain !== '[DECRYPT_FAILED]') setPasteContent(plain);
          }
        },
      )
      .subscribe();

    setupRealtime();
    setupPresence();
    updateLastSeen();

    presenceIntervalRef.current = setInterval(updateLastSeen, PRESENCE_INTERVAL);
    presenceCheckRef.current = setInterval(checkOnlineStatus, PRESENCE_CHECK_INTERVAL);

    const handleOffline = () => setConnectionStatus('offline');
    const handleOnline = () => {
      // Rede voltou — força reconexão imediata em vez de esperar o próximo
      // passo do backoff, que pode levar até 15s.
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnectionStatus('reconnecting');
      supabase.channel(`chat-${roomId}`).unsubscribe();
      supabase.channel(`reactions-${roomId}`).unsubscribe();
      supabase.channel(`receipts-${roomId}`).unsubscribe();
      setupRealtime();
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      if (presenceIntervalRef.current) clearInterval(presenceIntervalRef.current);
      if (presenceCheckRef.current) clearInterval(presenceCheckRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (connectionGraceTimerRef.current) clearTimeout(connectionGraceTimerRef.current);
      if (pasteSaveTimerRef.current) clearTimeout(pasteSaveTimerRef.current);
      typingTimeoutsRef.current.forEach((t) => clearTimeout(t));
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      supabase.channel(`chat-${roomId}`).unsubscribe();
      supabase.channel(`presence-${roomId}`).unsubscribe();
      supabase.channel(`typing-${roomId}`).unsubscribe();
      supabase.channel(`reactions-${roomId}`).unsubscribe();
      supabase.channel(`receipts-${roomId}`).unsubscribe();
      supabase.channel(`paste-${roomId}`).unsubscribe();
      if (webrtcChannelRef.current) webrtcChannelRef.current.unsubscribe();
      unsubscribeFromPush(participantId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Carrega o fundo: prioridade pra configuração específica desta sala,
  // caindo pro padrão do perfil se não houver nenhuma, e sem nada pra
  // convidados (que só podem definir um fundo local pra sessão atual).
  // CipherPaste: bloco de notas cifrado compartilhado da sala
  const loadPaste = async () => {
    const { data } = await supabase
      .from('room_pastes')
      .select('encrypted_content')
      .eq('room_id', roomId)
      .maybeSingle();
    if (data?.encrypted_content) {
      const plain = await decryptText(data.encrypted_content, roomCode);
      setPasteContent(plain === '[DECRYPT_FAILED]' ? '' : plain);
    }
  };

  const savePaste = async (content: string) => {
    setPasteSaving(true);
    try {
      const encrypted = await encryptText(content, roomCode);
      await supabase
        .from('room_pastes')
        .upsert({ room_id: roomId, encrypted_content: encrypted, updated_by: nickname, updated_at: new Date().toISOString() });
    } finally {
      setPasteSaving(false);
    }
  };

  const handlePasteChange = (value: string) => {
    setPasteContent(value);
    if (pasteSaveTimerRef.current) clearTimeout(pasteSaveTimerRef.current);
    pasteSaveTimerRef.current = setTimeout(() => savePaste(value), 800);
  };

  const saveChannelSettings = async () => {
    setChannelSettingsSaving(true);
    try {
      const { error } = await supabase
        .from('rooms')
        .update({ name: editRoomName.trim() || null, is_public: userId ? editIsPublic : false })
        .eq('id', roomId);
      if (error) {
        setSystemMessage('FALHA AO SALVAR — VERIFIQUE SE AS MIGRATIONS FORAM APLICADAS');
        setTimeout(() => setSystemMessage(''), 5000);
        return;
      }
      setRoomName(editRoomName.trim());
      setShowChannelSettings(false);
    } finally {
      setChannelSettingsSaving(false);
    }
  };

  const loadBackground = async () => {
    if (!userId) return;

    const { data: rm } = await supabase
      .from('room_members')
      .select('background_path, background_mode')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();

    if (rm?.background_path) {
      const url = await getImageUrl(rm.background_path);
      setBgUrl(url);
      setBgMode((rm.background_mode as BackgroundMode) || 'default');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('default_background_path, default_background_mode')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.default_background_path) {
      const url = await getImageUrl(profile.default_background_path);
      setBgUrl(url);
      setBgMode((profile.default_background_mode as BackgroundMode) || 'default');
    }
  };

  const saveBackground = async (blob: Blob, mode: BackgroundMode, scope: 'room' | 'global') => {
    setBgSaving(true);
    try {
      if (!userId) {
        // Convidado: fundo só para esta sessão, sem upload nem persistência
        const localUrl = URL.createObjectURL(blob);
        setBgUrl(localUrl);
        setBgMode(mode);
        setShowBgSettings(false);
        setBgStep('menu');
        return;
      }

      const path = await uploadBackgroundImage(userId, blob);

      if (scope === 'room') {
        const { data: existing } = await supabase
          .from('room_members')
          .select('background_path')
          .eq('room_id', roomId)
          .eq('user_id', userId)
          .maybeSingle();
        if (existing?.background_path) {
          await deleteStorageFile(existing.background_path).catch(() => {});
        }
        await supabase
          .from('room_members')
          .update({ background_path: path, background_mode: mode })
          .eq('room_id', roomId)
          .eq('user_id', userId);
      } else {
        const { data: existing } = await supabase
          .from('profiles')
          .select('default_background_path')
          .eq('id', userId)
          .maybeSingle();
        if (existing?.default_background_path) {
          await deleteStorageFile(existing.default_background_path).catch(() => {});
        }
        await supabase
          .from('profiles')
          .update({ default_background_path: path, default_background_mode: mode })
          .eq('id', userId);
      }

      const url = await getImageUrl(path);
      setBgUrl(url);
      setBgMode(mode);
      setShowBgSettings(false);
      setBgStep('menu');
      setPendingBgBlob(null);
    } catch {
      setSystemMessage('FALHA AO SALVAR FUNDO');
      setTimeout(() => setSystemMessage(''), 3000);
    } finally {
      setBgSaving(false);
    }
  };

  const clearBackground = async (scope: 'room' | 'global') => {
    setBgSaving(true);
    try {
      if (userId) {
        if (scope === 'room') {
          await supabase
            .from('room_members')
            .update({ background_path: null, background_mode: null })
            .eq('room_id', roomId)
            .eq('user_id', userId);
        } else {
          await supabase
            .from('profiles')
            .update({ default_background_path: null, default_background_mode: null })
            .eq('id', userId);
        }
      }
      setBgUrl(null);
      setShowBgSettings(false);
      setBgStep('menu');
    } finally {
      setBgSaving(false);
    }
  };

  // O modo "padrão" de fundo deve ficar limpo de verdade — nem os efeitos
  // globais da plataforma (scanlines) podem cobrir a imagem original.
  useEffect(() => {
    onSuppressScanlines?.(bgMode === 'default' && !!bgUrl);
    return () => onSuppressScanlines?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgMode, bgUrl]);

  const loadInitialData = async () => {
    const [{ data: existingMsgs }, { data: parts }, { data: reactions }, { data: receipts }] = await Promise.all([
      supabase.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true }),
      supabase.from('participants').select('*').eq('room_id', roomId),
      supabase.from('reactions').select('*'),
      supabase.from('read_receipts').select('*'),
    ]);

    if (parts) {
      setAllParticipants(parts);
      setPeers(parts.filter((p) => p.id !== participantId));
      const online = new Set<string>();
      const now = Date.now();
      for (const p of parts) {
        if (p.id !== participantId && now - new Date(p.last_seen).getTime() < PRESENCE_TIMEOUT_MS) {
          online.add(p.id);
        }
      }
      setOnlinePeerIds(online);
    }

    if (existingMsgs) {
      const plaintextById = new Map<string, { plaintext: string; senderNickname: string }>();
      for (const msg of existingMsgs) {
        const plaintext = await decryptText(msg.encrypted_content, roomCode);
        const sender = parts?.find((p) => p.id === msg.sender_id);
        plaintextById.set(msg.id, { plaintext, senderNickname: sender?.nickname || 'UNKNOWN' });
      }

      const decoded = await Promise.all(
        existingMsgs.map(async (msg) => {
          const { plaintext } = plaintextById.get(msg.id)!;
          const sender = parts?.find((p) => p.id === msg.sender_id);
          const msgReactions = (reactions ?? []).filter((r: Reaction) => r.message_id === msg.id);
          const msgReceipts = (receipts ?? []).filter((r: ReadReceipt) => r.message_id === msg.id);
          const msgBurn = msg.burn_config ? jsonToBurnConfig(msg.burn_config) : null;
          const replyInfo = msg.reply_to_message_id ? plaintextById.get(msg.reply_to_message_id) : null;
          return {
            id: msg.id,
            senderId: msg.sender_id,
            senderNickname: sender?.nickname || 'UNKNOWN',
            encryptedContent: msg.encrypted_content,
            plaintext,
            createdAt: msg.created_at,
            isOwn: msg.sender_id === participantId,
            state: msg.destroyed_at ? 'destroyed' : 'decoded',
            destroyAt: msgBurn && msgBurn.seconds > 0 ? Date.now() : null,
            burnConfig: msgBurn,
            reactions: msgReactions,
            readBy: msgReceipts,
            messageType: (msg.message_type as MessageType) || 'text',
            storagePath: msg.storage_path || null,
            durationSeconds: msg.duration_seconds || null,
            replyToMessageId: msg.reply_to_message_id || null,
            replyToSenderNickname: replyInfo?.senderNickname || null,
            replyToPlaintext: replyInfo?.plaintext?.slice(0, 80) || null,
            capsuleUnlockAt: msg.capsule_unlock_at || null,
          } as DecodedMessage;
        }),
      );
      const toMarkRead = decoded.filter(
        (m) => m.state !== 'destroyed' && !m.isOwn && !m.readBy.some((r) => r.participant_id === participantId),
      );
      const hiddenIds = getHiddenMessageIds(roomId);
      setMessages(decoded.filter((m) => m.state !== 'destroyed' && !hiddenIds.has(m.id)));
      toMarkRead.forEach((m) => markAsRead(m.id));
    }
  };

  // Reconexão com backoff progressivo: 1s, 2s, 5s, 10s, depois a cada 15s
  // até conseguir. Evita bombardear o servidor com tentativas constantes
  // enquanto ainda dá espaço pra reconectar rápido nas primeiras tentativas.
  const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 15000];
  const scheduleReconnect = () => {
    if (reconnectTimerRef.current) return; // já tem uma tentativa agendada
    const attempt = reconnectAttemptRef.current;
    const delay = BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)];
    reconnectAttemptRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      supabase.channel(`chat-${roomId}`).unsubscribe();
      supabase.channel(`reactions-${roomId}`).unsubscribe();
      supabase.channel(`receipts-${roomId}`).unsubscribe();
      setupRealtime();
    }, delay);
  };

  const setupRealtime = () => {
    const channel = supabase.channel(`chat-${roomId}`);
    channel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const msg = payload.new as any;
          if (msg.sender_id === participantId) return;

          const plaintext = await decryptText(msg.encrypted_content, roomCode);
          const { data: sender } = await supabase
            .from('participants')
            .select('nickname')
            .eq('id', msg.sender_id)
            .maybeSingle();

          const msgBurn = msg.burn_config ? jsonToBurnConfig(msg.burn_config) : null;

          playReceiveSound();
          setPulseKey((k) => k + 1);
          vibrate(60);
          setSystemMessage('NOVA TRANSMISSÃO RECEBIDA');
          setTimeout(() => setSystemMessage(''), 2000);

          setMessages((prev) => {
            const replySource = msg.reply_to_message_id
              ? prev.find((m) => m.id === msg.reply_to_message_id)
              : null;
            return [
              ...prev,
              {
                id: msg.id,
                senderId: msg.sender_id,
                senderNickname: sender?.nickname || 'UNKNOWN',
                encryptedContent: msg.encrypted_content,
                plaintext,
                createdAt: msg.created_at,
                isOwn: false,
                state: 'decoded',
                destroyAt: msgBurn && msgBurn.seconds > 0 ? Date.now() : null,
                burnConfig: msgBurn,
                reactions: [],
                readBy: [],
                messageType: (msg.message_type as MessageType) || 'text',
                storagePath: msg.storage_path || null,
                durationSeconds: msg.duration_seconds || null,
                replyToMessageId: msg.reply_to_message_id || null,
                replyToSenderNickname: replySource?.senderNickname || null,
                replyToPlaintext: replySource?.plaintext?.slice(0, 80) || null,
                capsuleUnlockAt: msg.capsule_unlock_at || null,
              },
            ];
          });
          markAsRead(msg.id);

          // Incoming call signaling
          if ((msg.message_type === 'text') && msg.encrypted_content?.startsWith('{"call"')) {
            try {
              const callData = JSON.parse(await decryptText(msg.encrypted_content, roomCode));
              if (callData.call === 'start' && callData.to === participantId) {
                setIncomingCall({ from: msg.sender_id, fromNickname: sender?.nickname || 'UNKNOWN', withVideo: callData.withVideo });
              }
            } catch { /* not a call signal */ }
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const msg = payload.old as any;
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, state: 'destroyed' as const } : m)),
          );
        },
      )
      .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        chatChannelRef.current = channel;
        if (connectionGraceTimerRef.current) {
          clearTimeout(connectionGraceTimerRef.current);
          connectionGraceTimerRef.current = null;
        }
        const wasReconnecting = reconnectAttemptRef.current > 0;
        reconnectAttemptRef.current = 0;
        setConnectionStatus('connected');
        if (wasReconnecting) {
          // Reconcilia o estado após uma queda: busca de novo o que pode ter
          // sido perdido enquanto o tempo real estava fora do ar, em vez de
          // confiar apenas nos eventos que chegarem daqui pra frente.
          loadInitialData();
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Só mostra "reconectando" se a queda persistir por um tempo —
        // blips momentâneos (comuns até em rede boa) se resolvem sozinhos
        // antes disso e nunca chegam a aparecer na tela.
        if (!connectionGraceTimerRef.current) {
          connectionGraceTimerRef.current = setTimeout(() => {
            connectionGraceTimerRef.current = null;
            setConnectionStatus('reconnecting');
          }, 4000);
        }
        scheduleReconnect();
      }
    });
    const reactionChannel = supabase.channel(`reactions-${roomId}`);
    reactionChannel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reactions' },
        (payload) => {
          const r = payload.new as any;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === r.message_id
                ? { ...m, reactions: [...m.reactions, r as Reaction] }
                : m,
            ),
          );
        },
      )
      .subscribe();

    // Read receipts realtime
    const receiptChannel = supabase.channel(`receipts-${roomId}`);
    receiptChannel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'read_receipts' },
        (payload) => {
          const r = payload.new as any;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === r.message_id
                ? { ...m, readBy: [...m.readBy, r as ReadReceipt] }
                : m,
            ),
          );
        },
      )
      .subscribe();
  };

  const setupPresence = () => {
    const channel = supabase.channel(`presence-${roomId}`);
    channel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const p = payload.new as any;
          if (p.id === participantId) return;
          setPeers((prev) => {
            if (prev.find((x) => x.id === p.id)) return prev;
            return [...prev, p];
          });
          setAllParticipants((prev) => {
            if (prev.find((x) => x.id === p.id)) return prev;
            return [...prev, p];
          });
          setOnlinePeerIds((prev) => new Set(prev).add(p.id));
          setSystemMessage(`${p.nickname.toUpperCase()} CONECTADO`);
          setTimeout(() => setSystemMessage(''), 3000);
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const p = payload.old as any;
          if (p.id === participantId) return;
          setPeers((prev) => prev.filter((x) => x.id !== p.id));
          setAllParticipants((prev) => prev.filter((x) => x.id !== p.id));
          setOnlinePeerIds((prev) => {
            const next = new Set(prev);
            next.delete(p.id);
            return next;
          });
          setSystemMessage(`${p.nickname?.toUpperCase() || 'PARTICIPANTE'} DESCONECTADO`);
          setTimeout(() => setSystemMessage(''), 3000);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const p = payload.new as any;
          if (p.id === participantId) return;
          setPeers((prev) => prev.map((x) => (x.id === p.id ? p : x)));
          setAllParticipants((prev) => prev.map((x) => (x.id === p.id ? p : x)));
        },
      )
      .subscribe();
  };

  // Rede de segurança: mesmo com a assinatura de tempo real ativa, confere
  // periodicamente quem está na sala via busca direta — assim, se o realtime
  // falhar silenciosamente por qualquer motivo, a tela nunca fica presa em
  // "aguardando participantes" indefinidamente.
  const reconcileParticipants = async () => {
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('room_id', roomId);

    if (!data) return;

    setPeers((prev) => {
      const known = new Set(prev.map((p) => p.id));
      const fresh = data.filter((p) => p.id !== participantId);
      const newcomers = fresh.filter((p) => !known.has(p.id));
      newcomers.forEach((p) => {
        setSystemMessage(`${p.nickname?.toUpperCase() || 'PARTICIPANTE'} CONECTADO`);
        setTimeout(() => setSystemMessage(''), 3000);
      });
      return fresh;
    });
    setAllParticipants(data);
  };

  useEffect(() => {
    const reconcileInterval = setInterval(reconcileParticipants, 5000);
    return () => clearInterval(reconcileInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const updateLastSeen = async () => {
    await supabase
      .from('participants')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', participantId);
  };

  const checkOnlineStatus = () => {
    const now = Date.now();
    const online = new Set<string>();
    for (const peer of peers) {
      const lastSeen = new Date(peer.last_seen).getTime();
      if (now - lastSeen < PRESENCE_TIMEOUT_MS) {
        online.add(peer.id);
      }
    }
    setOnlinePeerIds(online);
  };

  // Typing broadcast — reutiliza UM único canal inscrito (em vez de criar um
  // canal novo a cada tecla digitada, que agredia o mesmo tópico repetidamente
  // e podia desestabilizar outras assinaturas de tempo real da sala).
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const broadcastTyping = useCallback(() => {
    typingChannelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { participantId, nickname, isTyping: true },
    });
  }, [participantId, nickname]);

  const setupTypingListener = () => {
    const channel = supabase.channel(`typing-${roomId}`);
    channel.on('broadcast', { event: 'typing' }, (payload: any) => {
      const data = payload.payload;
      if (!data || data.participantId === participantId) return;
      setTypingPeers((prev) => new Set(prev).add(data.participantId));
      const existing = typingTimeoutsRef.current.get(data.participantId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        setTypingPeers((prev) => {
          const next = new Set(prev);
          next.delete(data.participantId);
          return next;
        });
        typingTimeoutsRef.current.delete(data.participantId);
      }, TYPING_TIMEOUT);
      typingTimeoutsRef.current.set(data.participantId, timer);
    });
    channel.subscribe();
    typingChannelRef.current = channel;
  };

  useEffect(() => {
    setupTypingListener();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  useEffect(() => {
    if (autoScroll) {
      scrollToBottom();
    }
  }, [messages, autoScroll, scrollToBottom]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    setAutoScroll(atBottom);
    setShowScrollButton(!atBottom);
  };

  const maybeRequestPush = async () => {
    if (hasInteracted) return;
    setHasInteracted(true);
    const granted = await requestNotificationPermission();
    if (granted) {
      await subscribeToPush(participantId);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;

    maybeRequestPush();

    const encrypted = await encryptText(text, roomCode);
    const burnJson = burnConfig.seconds > 0 ? JSON.parse(JSON.stringify(burnConfig)) : null;

    const { data: msg, error: insertErr } = await supabase
      .from('messages')
      .insert({
        room_id: roomId,
        sender_id: participantId,
        encrypted_content: encrypted,
        burn_config: burnJson,
        reply_to_message_id: replyTo?.id || null,
      })
      .select()
      .single();

    if (insertErr) {
      setSystemMessage('FALHA AO ENVIAR MENSAGEM');
      return;
    }

    if (msg) {
      playSendSound();
      setPulseKey((k) => k + 1);
      setMessages((prev) => [
        ...prev,
        {
          id: msg.id,
          senderId: participantId,
          senderNickname: nickname,
          encryptedContent: encrypted,
          plaintext: text,
          createdAt: msg.created_at,
          isOwn: true,
          state: 'decoded',
          destroyAt: burnConfig.seconds > 0 ? Date.now() : null,
          burnConfig: burnConfig.seconds > 0 ? burnConfig : null,
          reactions: [],
          readBy: [],
          messageType: 'text' as MessageType,
          storagePath: null,
          durationSeconds: null,
          replyToMessageId: replyTo?.id || null,
          replyToSenderNickname: replyTo?.senderNickname || null,
          replyToPlaintext: replyTo?.plaintext?.slice(0, 80) || null,
          capsuleUnlockAt: null,
        },
      ]);
      setInput('');
      const repliedTo = replyTo;
      setReplyTo(null);

      if (/@eivorak\b/i.test(text)) {
        triggerEivorak(text, repliedTo);
      }
    }
  };

  // Agente convocável @eivorak — roda no aparelho de quem enviou a
  // mensagem que mencionou, sem depender de mais ninguém estar na sala.
  // Não guarda histórico em lugar nenhum: cada chamada só usa as últimas
  // mensagens já visíveis nesta tela como contexto.
  const eivorakParticipantIdRef = useRef<string | null>(null);

  const getOrCreateEivorakParticipant = async (): Promise<string> => {
    if (eivorakParticipantIdRef.current) return eivorakParticipantIdRef.current;

    const { data: existing } = await supabase
      .from('participants')
      .select('id')
      .eq('room_id', roomId)
      .eq('nickname', 'EiVORAK')
      .maybeSingle();

    if (existing) {
      eivorakParticipantIdRef.current = existing.id;
      return existing.id;
    }

    const { data: created } = await supabase
      .from('participants')
      .insert({ room_id: roomId, nickname: 'EiVORAK' })
      .select()
      .single();

    eivorakParticipantIdRef.current = created?.id || null;
    return created?.id || '';
  };

  const triggerEivorak = async (userMessage: string, repliedTo: DecodedMessage | null) => {
    try {
      setEivorakThinking(true);
      const recentContext = messages
        .slice(-10)
        .map((m) => `${m.senderNickname}: ${m.plaintext}`)
        .join('\n');

      const urlMatch = userMessage.match(/https?:\/\/[^\s]+/i);
      const cleanMessage = userMessage.replace(/@eivorak\b/i, '').trim() || userMessage;

      let imageUrl: string | null = null;
      if (repliedTo?.messageType === 'image' && repliedTo.storagePath) {
        imageUrl = await getImageUrl(repliedTo.storagePath);
      }

      const { data, error } = await supabase.functions.invoke('eivorak-agent', {
        body: {
          message: cleanMessage,
          recentContext,
          linkUrl: urlMatch ? urlMatch[0] : null,
          imageUrl,
        },
      });

      if (error || !data?.reply) {
        const detail = (data as any)?.error || error?.message;
        setSystemMessage(detail ? `EIVORAK: ${String(detail).slice(0, 80)}` : 'EIVORAK NÃO RESPONDEU — TENTE DE NOVO');
        setTimeout(() => setSystemMessage(''), 6000);
        return;
      }

      const eivorakId = await getOrCreateEivorakParticipant();
      if (!eivorakId) return;

      const encryptedReply = await encryptText(data.reply, roomCode);
      const { data: replyMsg, error: replyErr } = await supabase
        .from('messages')
        .insert({
          room_id: roomId,
          sender_id: eivorakId,
          encrypted_content: encryptedReply,
        })
        .select()
        .single();

      if (!replyErr && replyMsg) {
        setMessages((prev) => [
          ...prev,
          {
            id: replyMsg.id,
            senderId: eivorakId,
            senderNickname: 'EiVORAK',
            encryptedContent: encryptedReply,
            plaintext: data.reply,
            createdAt: replyMsg.created_at,
            isOwn: false,
            state: 'decoded',
            destroyAt: null,
            burnConfig: null,
            reactions: [],
            readBy: [],
            messageType: 'text' as MessageType,
            storagePath: null,
            durationSeconds: null,
            replyToMessageId: null,
            replyToSenderNickname: null,
            replyToPlaintext: null,
            capsuleUnlockAt: null,
          },
        ]);
        playReceiveSound();
      }
    } finally {
      setEivorakThinking(false);
    }
  };

  const handleSendAudio = async (blob: Blob, durationSeconds: number) => {
    setShowAudioRecorder(false);
    maybeRequestPush();
    setUploadProgress(0);

    const tempId = crypto.randomUUID();
    const burnJson = burnConfig.seconds > 0 ? JSON.parse(JSON.stringify(burnConfig)) : null;

    try {
      const storagePath = await uploadEncryptedAudio(roomId, tempId, blob, roomCode, setUploadProgress);

      const placeholder = await encryptText('[audio]', roomCode);
      const { data: msg, error: insertErr } = await supabase
        .from('messages')
        .insert({
          room_id: roomId,
          sender_id: participantId,
          encrypted_content: placeholder,
          burn_config: burnJson,
          message_type: 'audio',
          storage_path: storagePath,
          duration_seconds: durationSeconds,
        })
        .select()
        .single();

      if (insertErr) {
        throw insertErr;
      }

      if (msg) {
        playSendSound();
      setPulseKey((k) => k + 1);
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            senderId: participantId,
            senderNickname: nickname,
            encryptedContent: placeholder,
            plaintext: '[audio]',
            createdAt: msg.created_at,
            isOwn: true,
            state: 'decoded',
            destroyAt: burnConfig.seconds > 0 ? Date.now() : null,
            burnConfig: burnConfig.seconds > 0 ? burnConfig : null,
            reactions: [],
            readBy: [],
            messageType: 'audio' as MessageType,
            storagePath,
            durationSeconds,
            replyToMessageId: null,
            replyToSenderNickname: null,
            replyToPlaintext: null,
            capsuleUnlockAt: null,
          },
        ]);
      }
    } catch (err) {
      setSystemMessage('FALHA AO ENVIAR ÁUDIO');
      setTimeout(() => setSystemMessage(''), 3000);
    } finally {
      setUploadProgress(null);
    }
  };

  const handleSendImage = async (blob: Blob) => {
    setShowImageUploader(false);
    maybeRequestPush();
    setUploadProgress(0);

    const tempId = crypto.randomUUID();
    const burnJson = burnConfig.seconds > 0 ? JSON.parse(JSON.stringify(burnConfig)) : null;

    try {
      const storagePath = await uploadImage(roomId, tempId, blob, setUploadProgress);

      const placeholder = await encryptText('[image]', roomCode);
      const { data: msg, error: insertErr } = await supabase
        .from('messages')
        .insert({
          room_id: roomId,
          sender_id: participantId,
          encrypted_content: placeholder,
          burn_config: burnJson,
          message_type: 'image',
          storage_path: storagePath,
        })
        .select()
        .single();

      if (insertErr) {
        throw insertErr;
      }

      if (msg) {
        playSendSound();
      setPulseKey((k) => k + 1);
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            senderId: participantId,
            senderNickname: nickname,
            encryptedContent: placeholder,
            plaintext: '[image]',
            createdAt: msg.created_at,
            isOwn: true,
            state: 'decoded',
            destroyAt: burnConfig.seconds > 0 ? Date.now() : null,
            burnConfig: burnConfig.seconds > 0 ? burnConfig : null,
            reactions: [],
            readBy: [],
            messageType: 'image' as MessageType,
            storagePath,
            durationSeconds: null,
            replyToMessageId: null,
            replyToSenderNickname: null,
            replyToPlaintext: null,
            capsuleUnlockAt: null,
          },
        ]);
      }
    } catch (err) {
      setSystemMessage('FALHA AO ENVIAR IMAGEM');
      setTimeout(() => setSystemMessage(''), 3000);
    } finally {
      setUploadProgress(null);
    }
  };

  // Cápsula do tempo: cifra com tlock-js (drand) — não usa a chave da sala,
  // já que a garantia de "só abre depois de X" vem da rede drand, não do
  // AES da sala. O que fica em `encrypted_content` aqui é o texto cifrado
  // do tlock, autocontido.
  const handleSendCapsule = async (text: string, unlockAt: Date) => {
    setShowCapsuleComposer(false);
    try {
      const { timelockEncryptText } = await import('@/lib/timelock');
      const capsuleCiphertext = await timelockEncryptText(text, unlockAt);
      const { data: msg, error: insertErr } = await supabase
        .from('messages')
        .insert({
          room_id: roomId,
          sender_id: participantId,
          encrypted_content: capsuleCiphertext,
          message_type: 'capsule',
          capsule_unlock_at: unlockAt.toISOString(),
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      if (msg) {
        playSendSound();
        setPulseKey((k) => k + 1);
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            senderId: participantId,
            senderNickname: nickname,
            encryptedContent: capsuleCiphertext,
            plaintext: '',
            createdAt: msg.created_at,
            isOwn: true,
            state: 'decoded',
            destroyAt: null,
            burnConfig: null,
            reactions: [],
            readBy: [],
            messageType: 'capsule' as MessageType,
            storagePath: null,
            durationSeconds: null,
            replyToMessageId: null,
            replyToSenderNickname: null,
            replyToPlaintext: null,
            capsuleUnlockAt: unlockAt.toISOString(),
          },
        ]);
      }
    } catch {
      setSystemMessage('FALHA AO CRIAR CÁPSULA DO TEMPO');
      setTimeout(() => setSystemMessage(''), 3000);
    }
  };

  const handleStartCall = (withVideo: boolean) => {
    if (peers.length === 0) {
      setSystemMessage('NENHUM PARTICIPANTE ONLINE');
      setTimeout(() => setSystemMessage(''), 3000);
      return;
    }
    if (peers.length >= 2) {
      // Sala com mais de 2 pessoas — chamada em grupo (malha), não 1-pra-1
      setActiveGroupCall({ withVideo });
      const channel = supabase.channel(`webrtc-${roomId}`);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          sendOnChannel(channel, participantId, 'all', 'call-start', { withVideo, isGroup: true }).finally(() => {
            channel.unsubscribe();
          });
        }
      });
      return;
    }
    const peer = peers[0];
    setActiveCall({ peerId: peer.id, peerNickname: peer.nickname, withVideo, isInitiator: true });
  };

  const handleEndCall = (reason?: 'failed') => {
    setActiveCall(null);
    if (webrtcChannelRef.current) {
      webrtcChannelRef.current.unsubscribe();
      webrtcChannelRef.current = null;
    }
    if (reason === 'failed') {
      setSystemMessage('CHAMADA NÃO COMPLETOU — REDE INSTÁVEL. CONTINUE POR TEXTO.');
      setTimeout(() => setSystemMessage(''), 5000);
    }
  };

  const handleAcceptCall = () => {
    if (!incomingCall) return;
    setActiveCall({ peerId: incomingCall.from, peerNickname: incomingCall.fromNickname, withVideo: incomingCall.withVideo, isInitiator: false });
    setIncomingCall(null);
  };

  const handleDeclineCall = () => {
    setIncomingCall(null);
  };

  const handleReply = (message: DecodedMessage) => {
    setReplyTo(message);
  };

  const handleReplyPrivate = async (message: DecodedMessage) => {
    if (!userId) {
      setSystemMessage('PRECISA DE CONTA PARA CONVERSAS PRIVADAS');
      setTimeout(() => setSystemMessage(''), 3000);
      return;
    }

    const { data: senderParticipant } = await supabase
      .from('participants')
      .select('user_id')
      .eq('id', message.senderId)
      .maybeSingle();

    if (!senderParticipant?.user_id) {
      setSystemMessage('ESSA PESSOA ESTÁ SEM CONTA — SEM COMO ABRIR CONVERSA PRIVADA AINDA');
      setTimeout(() => setSystemMessage(''), 4000);
      return;
    }

    if (senderParticipant.user_id === userId) {
      setSystemMessage('ESSA MENSAGEM É SUA');
      setTimeout(() => setSystemMessage(''), 3000);
      return;
    }

    const { data: dmResult, error: dmErr } = await supabase.rpc('find_or_create_dm', {
      p_other_user_id: senderParticipant.user_id,
    });

    if (dmErr || !dmResult || dmResult.length === 0) {
      setSystemMessage('FALHA AO ABRIR CONVERSA PRIVADA');
      setTimeout(() => setSystemMessage(''), 3000);
      return;
    }

    const dm = dmResult[0];
    onOpenPrivateReply?.(dm.room_id, dm.room_code, {
      text: message.plaintext.slice(0, 200),
      sender: message.senderNickname,
      roomName: roomName || roomCode,
    });
  };

  const handleScrollToMessage = (messageId: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-cyber-green/50');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-cyber-green/50');
      }, 2000);
    }
  };

  // Marca como lida automaticamente: como a sala está aberta e a mensagem já
  // aparece legível na hora (sem mais o passo de "tocar para decodificar"),
  // a leitura é registrada assim que a mensagem chega/é carregada na tela.
  const markAsRead = (id: string) => {
    supabase
      .from('read_receipts')
      .insert({ message_id: id, participant_id: participantId })
      .then();
  };

  const handleDestroy = (id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, state: 'destroying' as const } : m)));
    const target = messages.find((m) => m.id === id);
    (async () => {
      const { error: deleteErr } = await supabase.from('messages').delete().eq('id', id);

      if (deleteErr) {
        // A exclusão de verdade falhou no servidor — não finge que apagou.
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, state: 'decoded' as const } : m)));
        setSystemMessage('FALHA AO APAGAR MENSAGEM');
        setTimeout(() => setSystemMessage(''), 3000);
        return;
      }

      if (target?.storagePath) {
        // Best-effort: a mensagem já foi apagada de verdade acima; se a
        // limpeza do arquivo falhar, não é motivo pra reverter nada.
        await supabase.storage.from('cipherline-media').remove([target.storagePath]).catch(() => {});
      }

      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, state: 'destroyed' as const } : m)));
    })();
  };

  // "Apagar só para mim": não mexe no servidor, só esconde neste
  // dispositivo — os outros continuam vendo normalmente.
  const handleDeleteForMe = (id: string) => {
    hideMessageLocally(roomId, id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  // WebRTC signaling listener for incoming calls
  useEffect(() => {
    const channel = supabase.channel(`webrtc-${roomId}`);
    webrtcChannelRef.current = channel;
    channel.on('broadcast', { event: 'signal' }, (res: any) => {
      const msg = res.payload as SignalingMessage;
      if (msg.to !== participantId && msg.to !== 'all') return;
      if (msg.type === 'call-start') {
        if (msg.payload?.isGroup) {
          if (msg.from !== participantId) {
            setGroupCallInvite({ withVideo: msg.payload?.withVideo ?? false });
          }
          return;
        }
        const peer = allParticipants.find((p) => p.id === msg.from);
        setIncomingCall({ from: msg.from, fromNickname: peer?.nickname || 'UNKNOWN', withVideo: msg.payload?.withVideo ?? false });
      }
    });
    channel.subscribe();
    return () => { channel.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, participantId]);

  const handleReact = async (messageId: string, emoji: string) => {
    const { data } = await supabase
      .from('reactions')
      .insert({ message_id: messageId, participant_id: participantId, emoji })
      .select()
      .single();

    if (data) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, reactions: [...m.reactions, data as Reaction] } : m,
        ),
      );
    }
  };

  const handleSaveBurnConfig = async () => {
    let config = burnConfig;
    if (burnConfig.mode === 'custom' && customBurnValue) {
      const val = parseInt(customBurnValue, 10);
      if (val > 0) {
        const multiplier = customBurnUnit === 'seconds' ? 1 : customBurnUnit === 'minutes' ? 60 : 3600;
        config = createBurnConfig('custom', val * multiplier);
      }
    }
    setBurnConfig(config);
    await supabase
      .from('rooms')
      .update({ default_burn_config: JSON.parse(JSON.stringify(config)) })
      .eq('id', roomId);
    setShowBurnSettings(false);
  };

  const handleLeaveClick = () => {
    doLeave();
  };

  const doLeave = async () => {
    await unsubscribeFromPush(participantId).catch(() => {});
    await supabase.from('participants').delete().eq('id', participantId);
    if (!isPermanent) {
      const { count } = await supabase
        .from('participants')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', roomId);
      if (count === 0) {
        const { data: mediaMsgs } = await supabase
          .from('messages')
          .select('storage_path')
          .eq('room_id', roomId)
          .not('storage_path', 'is', null);

        if (mediaMsgs && mediaMsgs.length > 0) {
          const paths = mediaMsgs.map((m) => m.storage_path).filter(Boolean) as string[];
          await supabase.storage.from('cipherline-media').remove(paths);
        }

        await supabase.from('messages').delete().eq('room_id', roomId);
        await supabase.from('rooms').delete().eq('id', roomId);
      }
    }
    onLeave();
  };

  const onlineCount = onlinePeerIds.size;
  const totalParticipants = allParticipants.length;
  const burnLabel = burnConfig.mode === 'off' ? 'OFF' : burnConfig.mode === 'on_read' ? '6s' : burnConfig.mode === '24h' ? '24H' : burnConfig.mode === '7d' ? '7D' : `${burnConfig.seconds}s`;

  // Typing indicator text
  const typingNames = Array.from(typingPeers).map((id) => {
    const p = allParticipants.find((x) => x.id === id);
    return p?.nickname || '';
  }).filter(Boolean);

  const typingText = typingNames.length === 0
    ? ''
    : typingNames.length === 1
      ? `${typingNames[0]} está digitando`
      : typingNames.length === 2
        ? `${typingNames[0]} e ${typingNames[1]} estão digitando`
        : `${typingNames.length} pessoas estão digitando`;

  const getDeviceIcon = (p: Participant) => {
    if (p.device_id === deviceIdRef.current) {
      return /Mobi|Android/i.test(navigator.userAgent) ? <Smartphone size={9} className="text-cyber-cyan/40" /> : <Monitor size={9} className="text-cyber-cyan/40" />;
    }
    return null;
  };

  return (
    <div className="relative flex h-full flex-col">
      {bgUrl && <ChatBackground imageUrl={bgUrl} mode={bgMode} pulseKey={pulseKey} />}
      {/* Header */}
      <div className="glass clip-hud-sm relative z-20 flex items-center justify-between px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <motion.span
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="shrink-0"
              >
                <Lock size={12} className="text-cyber-green glow-green" />
              </motion.span>
              <span className="truncate font-mono text-sm font-bold tracking-widest text-cyber-green glow-green">
                {roomName || roomCode}
              </span>
              <CopyButton text={roomCode} label="COPIAR" />
              {roomName && (
                <span className="shrink-0 font-mono text-[9px] tracking-widest text-cyber-text-faint">
                  {roomCode}
                </span>
              )}
              {connectionStatus !== 'connected' && (
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className={`flex shrink-0 items-center gap-1 font-mono text-[9px] tracking-widest ${
                    connectionStatus === 'offline' ? 'text-red-400' : 'text-cyber-amber'
                  }`}
                >
                  <WifiOff size={10} />
                  {connectionStatus === 'offline' ? 'OFFLINE' : 'RECONECTANDO...'}
                </motion.span>
              )}
            </div>
            <button
              onClick={() => setShowParticipantPanel(true)}
              className="mt-0.5 flex items-center gap-1.5"
            >
              <StatusDot online={onlineCount > 0} size={6} />
              <span className="font-mono text-[10px] tracking-widest text-cyber-text-dim">
                {onlineCount > 0
                  ? `${onlineCount + 1} CONECTADO${onlineCount + 1 > 1 ? 'S' : ''}`
                  : 'AGUARDANDO PARTICIPANTES'}
              </span>
              <Users size={10} className="text-cyber-text-faint" />
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={() => handleStartCall(false)}
            disabled={peers.length === 0}
            className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-green disabled:opacity-30"
            title="Chamada de voz"
          >
            <Phone size={14} />
          </button>
          <button
            onClick={() => handleStartCall(true)}
            disabled={peers.length === 0}
            className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-cyan disabled:opacity-30"
            title="Chamada de vídeo"
          >
            <Video size={14} />
          </button>
          <button
            onClick={() => setShowBurnSettings(true)}
            className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-green"
          >
            <Clock size={12} />
            <span className={burnConfig.mode !== 'off' ? 'text-cyber-green' : ''}>{burnLabel}</span>
          </button>
          <button
            onClick={() => setShowBgSettings(true)}
            className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-cyan"
            title="Fundo de tela"
          >
            <ImageIcon size={12} className={bgUrl ? 'text-cyber-cyan' : ''} />
          </button>
          <button
            onClick={() => setShowPaste(true)}
            className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-magenta"
            title="CipherPaste"
          >
            <FileText size={12} className={pasteContent ? 'text-cyber-magenta' : ''} />
          </button>
          <button
            onClick={() => setShowChannelSettings(true)}
            className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-green"
            title="Configurações do canal"
          >
            <Settings size={12} />
          </button>
          <button
            onClick={handleLeaveClick}
            className="flex items-center gap-1 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red"
          >
            <LogOut size={14} />
            SAIR
          </button>
        </div>
      </div>

      {/* System message bar */}
      <AnimatePresence>
        {systemMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="z-10 flex items-center justify-center py-1"
          >
            <span className="font-mono text-[10px] tracking-widest text-cyber-cyan/60">
              {`[ ${systemMessage} ]`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <div className="mb-4 text-center">
            <span className="font-mono text-[10px] tracking-widest text-cyber-text-faint">
              <Typewriter text="CANAL SEGURO ATIVO · MENSAGENS SÃO CIFRADAS PONTA-A-PONTA" speed={20} showCursor={false} />
            </span>
          </div>
          <AnimatePresence>
            {messages.map((msg) => (
              <div key={msg.id} data-msg-id={msg.id} className="rounded transition-all duration-1000">
              <ChatMessage
                message={msg}
                roomCode={roomCode}
                onDestroy={handleDestroy}
                onDeleteForMe={handleDeleteForMe}
                onReact={handleReact}
                onReply={handleReply}
                onReplyPrivate={handleReplyPrivate}
                onScrollToMessage={handleScrollToMessage}
              />
              </div>
            ))}
          </AnimatePresence>
          {eivorakThinking && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex min-w-0 items-center gap-2"
            >
              <span className="truncate font-mono text-xs text-cyber-magenta/70">EIVORAK ESTÁ PENSANDO</span>
              <div className="flex shrink-0 gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-1 w-1 rounded-full bg-cyber-magenta"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
          {typingText && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex min-w-0 items-center gap-2"
            >
              <span className="truncate font-mono text-xs text-cyber-cyan/60">{typingText}</span>
              <div className="flex shrink-0 gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-1 w-1 rounded-full bg-cyber-cyan"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Scroll to bottom button */}
      <AnimatePresence>
        {showScrollButton && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={() => {
              setAutoScroll(true);
              scrollToBottom();
            }}
            className="absolute bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 clip-hud-sm border border-cyber-green/30 bg-cyber-bg/80 px-4 py-2 font-mono text-xs tracking-widest text-cyber-green backdrop-blur"
          >
            <ArrowDown size={12} />
            NOVAS MENSAGENS
          </motion.button>
        )}
      </AnimatePresence>

      {/* Audio recorder */}
      <AnimatePresence>
        {showAudioRecorder && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="z-20 px-4 pb-2"
          >
            <div className="mx-auto max-w-2xl">
              <AudioRecorder
                onSend={handleSendAudio}
                onCancel={() => setShowAudioRecorder(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image uploader */}
      <AnimatePresence>
        {showImageUploader && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="z-20 px-4 pb-2"
          >
            <div className="mx-auto max-w-2xl">
              <ImageUploader
                onSend={handleSendImage}
                onCancel={() => setShowImageUploader(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload progress bar */}
      {uploadProgress !== null && (
        <div className="z-20 px-4 pb-1">
          <div className="mx-auto max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-cyber-cyan/60">ENVIANDO...</span>
              <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-cyber-border">
                <motion.div
                  className="h-full bg-cyber-cyan"
                  animate={{ width: `${uploadProgress}%` }}
                  transition={{ duration: 0.2 }}
                />
              </div>
              <span className="font-mono text-[10px] text-cyber-cyan/60">{uploadProgress}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Reply quote preview */}
      {replyTo && (
        <div className="z-20 px-4 pb-1">
          <div className="mx-auto max-w-2xl">
            <div className="flex items-center gap-2 border-l-2 border-cyber-cyan/40 bg-cyber-cyan/5 px-3 py-2">
              <Reply size={12} className="shrink-0 text-cyber-cyan/60" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] tracking-widest text-cyber-cyan/60">
                  {replyTo.senderNickname}
                </div>
                <div className="truncate font-mono text-xs text-cyber-text-dim">
                  {replyTo.plaintext?.slice(0, 80) || '[mensagem]'}
                </div>
              </div>
              <button
                onClick={() => setReplyTo(null)}
                className="shrink-0 text-cyber-text-faint transition-colors hover:text-cyber-red"
              >
                <XCircle size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="relative z-20 px-4 pb-4 pt-2">
        <div className="mx-auto max-w-2xl">
          <div className="glass clip-hud-sm flex items-center gap-2 px-4 py-3">
            <span className="font-mono text-cyber-green-dim">&gt;</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                broadcastTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              maxLength={500}
              placeholder="digite sua mensagem..."
              className="min-w-0 flex-1 bg-transparent font-mono text-sm text-cyber-green placeholder-cyber-text-faint focus:outline-none"
            />
            <div className="relative shrink-0">
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowEivorakMenu((v) => !v)}
                className="text-cyber-magenta transition-colors hover:text-cyber-magenta/70"
                title="EiVORAK"
              >
                <Sparkles size={16} />
              </motion.button>
              <AnimatePresence>
                {showEivorakMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="absolute bottom-10 right-0 z-30 w-52 clip-hud-sm border border-cyber-magenta/30 bg-cyber-bg/95 p-1 backdrop-blur"
                  >
                    {[
                      { label: 'RESUMIR CONVERSA', prompt: '@eivorak resume a conversa até aqui' },
                      { label: 'CONVIDAR PRO JOGO', prompt: '@eivorak vamos jogar ' },
                      { label: 'TRADUZIR', prompt: '@eivorak traduz: ' },
                      { label: 'TIRAR UMA DÚVIDA', prompt: '@eivorak ' },
                      { label: 'ANALISAR LINK', prompt: '@eivorak o que achas deste link: ' },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => {
                          setInput(opt.prompt);
                          setShowEivorakMenu(false);
                          inputRef.current?.focus();
                        }}
                        className="block w-full px-3 py-2 text-left font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:bg-cyber-magenta/10 hover:text-cyber-magenta"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowImageUploader(true)}
              className="shrink-0 text-cyber-cyan transition-colors hover:text-cyber-cyan-dim"
              title="Enviar imagem"
            >
              <ImageIcon size={16} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowCapsuleComposer(true)}
              className="shrink-0 text-cyber-amber transition-colors hover:text-cyber-amber/70"
              title="Cápsula do tempo"
            >
              <Clock size={16} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowAudioRecorder(true)}
              className="shrink-0 text-cyber-cyan transition-colors hover:text-cyber-cyan-dim"
              title="Gravar áudio"
            >
              <Mic size={16} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleSend}
              disabled={!input.trim()}
              className="shrink-0 text-cyber-green transition-colors hover:text-cyber-green-dim disabled:opacity-30"
            >
              <Send size={16} />
            </motion.button>
          </div>
        </div>
      </div>

      {/* Incoming call modal */}
      <AnimatePresence>
        {incomingCall && !activeCall && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass clip-hud mx-6 max-w-sm border-cyber-green/30 p-6 text-center"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="mx-auto mb-4"
              >
                {incomingCall.withVideo ? <Video size={32} className="text-cyber-cyan" /> : <Phone size={32} className="text-cyber-green" />}
              </motion.div>
              <p className="mb-1 font-mono text-sm text-cyber-green">{incomingCall.fromNickname}</p>
              <p className="mb-6 font-mono text-xs text-cyber-text-dim">{incomingCall.withVideo ? 'CHAMADA DE VÍDEO' : 'CHAMADA DE VOZ'}</p>
              <div className="flex gap-3">
                <button
                  onClick={handleDeclineCall}
                  className="clip-hud-sm flex-1 border border-cyber-red/30 bg-cyber-red/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-red transition-colors hover:bg-cyber-red/20"
                >
                  RECUSAR
                </button>
                <button
                  onClick={handleAcceptCall}
                  className="clip-hud-sm flex-1 border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20"
                >
                  ACEITAR
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active call overlay */}
      {activeCall && (
        <Suspense fallback={null}>
          <CallScreen
            roomId={roomId}
            roomCode={roomCode}
            myId={participantId}
            myNickname={nickname}
            peerId={activeCall.peerId}
            peerNickname={activeCall.peerNickname}
            withVideo={activeCall.withVideo}
            isInitiator={activeCall.isInitiator}
            onEnd={handleEndCall}
          />
        </Suspense>
      )}

      {activeGroupCall && (
        <Suspense fallback={null}>
          <GroupCallScreen
            roomId={roomId}
            myId={participantId}
            myNickname={nickname}
            withVideo={activeGroupCall.withVideo}
            onEnd={() => setActiveGroupCall(null)}
          />
        </Suspense>
      )}

      {groupCallInvite && !activeGroupCall && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-3 clip-hud-sm border border-cyber-green/40 bg-cyber-bg/95 px-4 py-2 backdrop-blur"
        >
          <span className="font-mono text-[10px] tracking-widest text-cyber-green">
            CHAMADA EM GRUPO ATIVA
          </span>
          <button
            onClick={() => {
              setActiveGroupCall({ withVideo: groupCallInvite.withVideo });
              setGroupCallInvite(null);
            }}
            className="clip-hud-sm border border-cyber-green/50 bg-cyber-green/10 px-3 py-1 font-mono text-[10px] tracking-widest text-cyber-green hover:bg-cyber-green/20"
          >
            ENTRAR
          </button>
          <button
            onClick={() => setGroupCallInvite(null)}
            className="text-cyber-text-dim hover:text-cyber-red"
          >
            <X size={12} />
          </button>
        </motion.div>
      )}

      {/* Leave confirmation modal */}
      <AnimatePresence>
        {showLeaveConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowLeaveConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass clip-hud mx-6 max-w-sm border-cyber-red/30 p-6 text-center"
            >
              <AlertTriangle size={32} className="mx-auto mb-4 text-cyber-red glow-red" />
              <p className="mb-2 font-mono text-sm text-cyber-red">
                MENSAGENS NÃO DECODIFICADAS
              </p>
              <p className="mb-6 font-mono text-xs text-cyber-text-dim">
                SERÃO PERDIDAS PERMANENTEMENTE — CONFIRMAR SAÍDA?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowLeaveConfirm(false)}
                  className="clip-hud-sm flex-1 border border-cyber-text-faint/30 px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-text"
                >
                  CANCELAR
                </button>
                <button
                  onClick={doLeave}
                  className="clip-hud-sm flex-1 border border-cyber-red/30 bg-cyber-red/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-red transition-colors hover:bg-cyber-red/20"
                >
                  CONFIRMAR
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Burn settings modal */}
      <AnimatePresence>
        {showBurnSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowBurnSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass clip-hud mx-6 max-w-sm border-cyber-green/20 p-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings size={16} className="text-cyber-green" />
                  <span className="font-mono text-sm tracking-widest text-cyber-green">
                    AUTODESTRUIÇÃO
                  </span>
                </div>
                <button
                  onClick={() => setShowBurnSettings(false)}
                  className="text-cyber-text-dim transition-colors hover:text-cyber-red"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-2">
                {BURN_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setBurnConfig(createBurnConfig(opt.value))}
                    className={`clip-hud-sm flex w-full items-center justify-between px-4 py-3 font-mono text-xs tracking-widest transition-colors ${
                      burnConfig.mode === opt.value
                        ? 'border border-cyber-green/40 bg-cyber-green/10 text-cyber-green'
                        : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
                    }`}
                  >
                    {opt.label}
                    {burnConfig.mode === opt.value && <span className="text-cyber-green">●</span>}
                  </button>
                ))}

                {/* Custom */}
                <div className={`clip-hud-sm border px-4 py-3 ${
                  burnConfig.mode === 'custom'
                    ? 'border-cyber-cyan/40 bg-cyber-cyan/10'
                    : 'border-cyber-border'
                }`}>
                  <button
                    onClick={() => setBurnConfig(createBurnConfig('custom', 30))}
                    className={`flex w-full items-center justify-between font-mono text-xs tracking-widest transition-colors ${
                      burnConfig.mode === 'custom' ? 'text-cyber-cyan' : 'text-cyber-text-dim hover:text-cyber-text'
                    }`}
                  >
                    PERSONALIZADO
                    {burnConfig.mode === 'custom' && <span className="text-cyber-cyan">●</span>}
                  </button>
                  {burnConfig.mode === 'custom' && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="number"
                        value={customBurnValue}
                        onChange={(e) => setCustomBurnValue(e.target.value)}
                        placeholder="30"
                        min="1"
                        className="w-20 bg-transparent font-mono text-sm text-cyber-cyan placeholder-cyber-text-faint focus:outline-none"
                      />
                      <select
                        value={customBurnUnit}
                        onChange={(e) => setCustomBurnUnit(e.target.value as any)}
                        className="bg-transparent font-mono text-xs text-cyber-cyan focus:outline-none"
                      >
                        <option value="seconds" className="bg-cyber-panel">SEG</option>
                        <option value="minutes" className="bg-cyber-panel">MIN</option>
                        <option value="hours" className="bg-cyber-panel">HORAS</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleSaveBurnConfig}
                className="clip-hud-sm mt-4 w-full border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20"
              >
                APLICAR
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background settings */}
      <AnimatePresence>
        {showBgSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => {
              setShowBgSettings(false);
              setBgStep('menu');
              setPendingBgBlob(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass clip-hud mx-6 w-full max-w-sm border-cyber-cyan/20 p-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon size={16} className="text-cyber-cyan" />
                  <span className="font-mono text-sm tracking-widest text-cyber-cyan">
                    FUNDO DE TELA
                  </span>
                </div>
                <button
                  onClick={() => {
                    setShowBgSettings(false);
                    setBgStep('menu');
                    setPendingBgBlob(null);
                  }}
                  className="text-cyber-text-dim transition-colors hover:text-cyber-red"
                >
                  <X size={16} />
                </button>
              </div>

              {bgStep === 'menu' && (
                <div className="space-y-2">
                  <button
                    onClick={() => setBgStep('upload')}
                    className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20"
                  >
                    <ImageIcon size={14} />
                    {bgUrl ? 'TROCAR IMAGEM' : 'DEFINIR IMAGEM'}
                  </button>
                  {bgUrl && (
                    <>
                      <button
                        onClick={() => clearBackground('room')}
                        disabled={bgSaving}
                        className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-border px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red disabled:opacity-40"
                      >
                        REMOVER DESTA SALA
                      </button>
                      {userId && (
                        <button
                          onClick={() => clearBackground('global')}
                          disabled={bgSaving}
                          className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-border px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red disabled:opacity-40"
                        >
                          REMOVER PADRÃO GLOBAL
                        </button>
                      )}
                    </>
                  )}
                  {!userId && (
                    <p className="pt-2 text-center font-mono text-[10px] tracking-widest text-cyber-text-faint">
                      SEM CONTA: FUNDO VALE SÓ PARA ESTA SESSÃO
                    </p>
                  )}
                </div>
              )}

              {bgStep === 'upload' && (
                <ImageUploader
                  onSend={(blob) => {
                    setPendingBgBlob(blob);
                    setBgStep('mode');
                  }}
                  onCancel={() => setBgStep('menu')}
                />
              )}

              {bgStep === 'mode' && pendingBgBlob && (
                <div className="space-y-3">
                  <p className="font-mono text-[10px] tracking-widest text-cyber-text-dim">
                    ESCOLHA O ESTILO
                  </p>
                  {([
                    { mode: 'default' as BackgroundMode, label: 'PADRÃO', desc: 'Imagem original, sem nenhum efeito' },
                    { mode: 'parallax' as BackgroundMode, label: 'PARALLAX REATIVO', desc: 'Move com giroscópio/mouse' },
                    { mode: 'reactive' as BackgroundMode, label: 'FUNDO VIVO', desc: 'Pulsa a cada mensagem' },
                  ]).map((opt) => (
                    <button
                      key={opt.mode}
                      onClick={() => setPendingBgMode(opt.mode)}
                      className={`clip-hud-sm flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left font-mono transition-colors ${
                        pendingBgMode === opt.mode
                          ? 'border border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan'
                          : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
                      }`}
                    >
                      <span className="text-xs tracking-widest">{opt.label}</span>
                      <span className="text-[10px] text-cyber-text-faint">{opt.desc}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => setBgStep('scope')}
                    className="clip-hud-sm mt-2 w-full border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20"
                  >
                    CONTINUAR
                  </button>
                </div>
              )}

              {bgStep === 'scope' && pendingBgBlob && (
                <div className="space-y-2">
                  <p className="font-mono text-[10px] tracking-widest text-cyber-text-dim">
                    APLICAR ONDE?
                  </p>
                  <button
                    onClick={() => saveBackground(pendingBgBlob, pendingBgMode, 'room')}
                    disabled={bgSaving}
                    className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20 disabled:opacity-40"
                  >
                    SÓ NESTA SALA
                  </button>
                  {userId && (
                    <button
                      onClick={() => saveBackground(pendingBgBlob, pendingBgMode, 'global')}
                      disabled={bgSaving}
                      className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20 disabled:opacity-40"
                    >
                      TODAS AS SALAS (PADRÃO)
                    </button>
                  )}
                  {bgSaving && (
                    <p className="text-center font-mono text-[10px] text-cyber-text-faint">SALVANDO...</p>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CipherPaste */}
      <AnimatePresence>
        {showPaste && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setShowPaste(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass clip-hud flex h-[80vh] w-full max-w-lg flex-col border-cyber-magenta/20 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-cyber-magenta" />
                  <span className="font-mono text-sm tracking-widest text-cyber-magenta">
                    CIPHERPASTE
                  </span>
                  {pasteSaving && (
                    <span className="font-mono text-[9px] text-cyber-text-faint">SALVANDO...</span>
                  )}
                </div>
                <button onClick={() => setShowPaste(false)} className="text-cyber-text-dim hover:text-cyber-red">
                  <X size={16} />
                </button>
              </div>
              <p className="mb-2 font-mono text-[9px] leading-relaxed text-cyber-text-faint">
                BLOCO DE NOTAS CIFRADO DA SALA — TODOS AQUI VEEM E EDITAM. SOME QUANDO A SALA FOR APAGADA.
              </p>
              <textarea
                value={pasteContent}
                onChange={(e) => handlePasteChange(e.target.value)}
                onFocus={() => { pasteTextareaFocusedRef.current = true; }}
                onBlur={() => { pasteTextareaFocusedRef.current = false; }}
                placeholder="Cole código, texto, notas..."
                className="flex-1 resize-none border border-cyber-border bg-transparent px-3 py-2 font-mono text-xs text-cyber-text placeholder:text-cyber-text-faint focus:border-cyber-magenta/50 focus:outline-none"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cápsula do tempo */}
      <AnimatePresence>
        {showCapsuleComposer && (
          <CapsuleComposer
            onCancel={() => setShowCapsuleComposer(false)}
            onSend={handleSendCapsule}
          />
        )}
      </AnimatePresence>

      {/* Channel settings */}
      <AnimatePresence>
        {showChannelSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setShowChannelSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass clip-hud w-full max-w-sm border-cyber-green/20 p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings size={16} className="text-cyber-green" />
                  <span className="font-mono text-sm tracking-widest text-cyber-green">
                    CONFIGURAÇÕES DO CANAL
                  </span>
                </div>
                <button onClick={() => setShowChannelSettings(false)} className="text-cyber-text-dim hover:text-cyber-red">
                  <X size={16} />
                </button>
              </div>

              <p className="mb-1 font-mono text-[10px] tracking-widest text-cyber-text-dim">NOME DO CANAL</p>
              <input
                type="text"
                value={editRoomName}
                onChange={(e) => setEditRoomName(e.target.value)}
                maxLength={60}
                placeholder="Sem nome (usa o código)"
                className="mb-4 w-full border border-cyber-border bg-transparent px-3 py-2 font-mono text-sm text-cyber-green placeholder:text-cyber-text-faint focus:border-cyber-green/50 focus:outline-none"
              />

              <p className="mb-1 font-mono text-[10px] tracking-widest text-cyber-text-dim">CÓDIGO DE ACESSO</p>
              <div className="mb-4 flex items-center justify-between border border-cyber-border px-3 py-2">
                <span className="font-mono text-sm text-cyber-text">{roomCode}</span>
                <CopyButton text={roomCode} label="COPIAR" />
              </div>

              {userId ? (
                <>
                  <p className="mb-2 font-mono text-[10px] tracking-widest text-cyber-text-dim">VISIBILIDADE</p>
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setEditIsPublic(false)}
                      className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors ${
                        !editIsPublic
                          ? 'border border-cyber-green/40 bg-cyber-green/10 text-cyber-green'
                          : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
                      }`}
                    >
                      PRIVADO
                    </button>
                    <button
                      onClick={() => setEditIsPublic(true)}
                      className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors ${
                        editIsPublic
                          ? 'border border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan'
                          : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
                      }`}
                    >
                      PÚBLICO
                    </button>
                  </div>
                </>
              ) : (
                <p className="mb-4 font-mono text-[9px] leading-relaxed text-cyber-text-faint">
                  ENTRE COM UMA CONTA PARA CONTROLAR VISIBILIDADE PÚBLICA/PRIVADA
                </p>
              )}

              <button
                onClick={saveChannelSettings}
                disabled={channelSettingsSaving}
                className="clip-hud-sm w-full border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20 disabled:opacity-50"
              >
                {channelSettingsSaving ? 'SALVANDO...' : 'SALVAR'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Participant panel */}
      <AnimatePresence>
        {showParticipantPanel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowParticipantPanel(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass clip-hud mx-6 max-w-sm border-cyber-cyan/20 p-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-cyber-cyan" />
                  <span className="font-mono text-sm tracking-widest text-cyber-cyan">
                    PARTICIPANTES · {totalParticipants}
                  </span>
                </div>
                <button
                  onClick={() => setShowParticipantPanel(false)}
                  className="text-cyber-text-dim transition-colors hover:text-cyber-red"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="max-h-64 space-y-2 overflow-y-auto">
                {/* Self */}
                <div className="flex items-center gap-2 rounded border border-cyber-green/20 bg-cyber-green/5 px-3 py-2">
                  <StatusDot online={true} size={6} />
                  <span className="font-mono text-xs text-cyber-green">{nickname}</span>
                  <span className="font-mono text-[9px] text-cyber-text-faint">(VOCÊ)</span>
                  {getDeviceIcon({ id: participantId, room_id: roomId, nickname, joined_at: '', last_seen: '', device_id: deviceIdRef.current })}
                </div>

                {/* Peers */}
                {allParticipants.filter((p) => p.id !== participantId).map((p) => {
                  const isOnline = onlinePeerIds.has(p.id);
                  const isSameDevice = p.device_id === deviceIdRef.current;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 rounded border border-cyber-border px-3 py-2"
                    >
                      <StatusDot online={isOnline} size={6} />
                      <span className="truncate font-mono text-xs text-cyber-text">{p.nickname}</span>
                      {isSameDevice && (
                        <span className="font-mono text-[9px] text-cyber-cyan/40">OUTRO DISPOSITIVO SEU</span>
                      )}
                      {getDeviceIcon(p)}
                    </div>
                  );
                })}

                {allParticipants.length <= 1 && (
                  <div className="py-4 text-center font-mono text-[10px] tracking-widest text-cyber-text-faint">
                    AGUARDANDO PARTICIPANTES...
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
