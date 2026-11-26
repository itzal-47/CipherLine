import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDown, Send, AlertTriangle, Settings, Lock, Clock, X, Users, Smartphone, Monitor, Mic, Image as ImageIcon, Phone, Video, Reply, XCircle, WifiOff, Sparkles, FileText, Eye, EyeOff, Pin, MoreVertical, BarChart2, Brain, Camera, Hash, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { playSendSound, playReceiveSound } from '@/lib/audio';
import { getDeviceId, getHiddenMessageIds, hideMessageLocally } from '@/lib/device';
import { requestNotificationPermission, subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import { uploadEncryptedAudio, uploadEncryptedImage, uploadBackgroundImage, getImageUrl, deleteStorageFile } from '@/lib/media';
import { insertMessageSecure, deleteMessageSecure, reactSecure, unreactSecure, markReadSecure, updatePresenceSecure, upsertPasteSecure, updateRoomSecure, updateParticipantProfileSecure, updateRoomBurnConfigSecure, leaveRoomSecure, insertEivorakReplySecure, deleteParticipantCompletelySecure, togglePinMessageSecure, votePollSecure } from '@/lib/participant';
import { PARTICIPANT_COLUMNS, PROFILE_COLUMNS } from '@/lib/columns';
import { StatusDot } from '@/components/StatusDot';
import { CopyButton } from '@/components/CopyButton';
import { Typewriter } from '@/components/Typewriter';
import { ChatMessage } from '@/components/ChatMessage';
import { AudioRecorder } from '@/components/AudioRecorder';
import { ImageUploader } from '@/components/ImageUploader';
import { CapsuleComposer } from '@/components/CapsuleComposer';
import { ChatBackground, type BackgroundMode } from '@/components/ChatBackground';
import { jsonToBurnConfig, createBurnConfig, type PollData } from '@/types';
import type { DecodedMessage, Participant, Reaction, ReadReceipt, BurnConfig, MessageType } from '@/types';
import { sendOnChannel, type SignalingMessage } from '@/lib/webrtc';
import { hasPin, setPin, verifyPin } from '@/lib/pin';
import { createRoomCrypto } from '@/lib/roomCrypto';
import { buildServerPollData, mergePollData } from '@/lib/pollData';
import { DECRYPT_FAILED, NO_KEY } from '@/lib/cryptoV2';
import { getRoomSecret } from '@/lib/roomKeys';
import { InviteSheet } from '@/components/InviteSheet';

const CallScreen = lazy(() => import('@/components/CallScreen').then(m => ({ default: m.CallScreen })));
const GroupCallScreen = lazy(() => import('@/components/GroupCallScreen').then(m => ({ default: m.GroupCallScreen })));

interface ChatScreenProps {
  roomId: string; roomCode: string; participantId: string; participantSecret: string;
  nickname: string; isPermanent: boolean; onLeave: () => void; userId?: string;
  cryptoVersion: 1 | 2;
  onSuppressScanlines?: (suppress: boolean) => void;
  onOpenPrivateReply?: (roomCode: string, roomId: string, quote: { text: string; sender: string; roomName: string }) => void;
  initialQuote?: { text: string; sender: string; roomName: string } | null;
  onQuoteConsumed?: () => void;
}

const PRESENCE_INTERVAL = 10000;
const PRESENCE_TIMEOUT_MS = 20000;
const PRESENCE_CHECK_INTERVAL = 5000;
const TYPING_TIMEOUT = 3000;

const BURN_OPTIONS: { label: string; value: BurnConfig['mode'] }[] = [
  { label: 'Desativado', value: 'off' }, { label: 'Ao ser lida (6s)', value: 'on_read' }, { label: '24 horas', value: '24h' }, { label: '7 dias', value: '7d' },
];

function vibrate(pattern: number | number[]) { if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(pattern); } catch {} } }

export function ChatScreen({ roomId, roomCode, participantId, participantSecret, nickname, isPermanent, cryptoVersion, onLeave, userId, onSuppressScanlines, onOpenPrivateReply, initialQuote, onQuoteConsumed }: ChatScreenProps) {
  const roomSecret = cryptoVersion === 2 ? getRoomSecret(roomCode) : null;
  const rc = useMemo(() => createRoomCrypto({ roomCode, cryptoVersion, secret: roomSecret }), [roomCode, cryptoVersion, roomSecret]);
  const [messages, setMessages] = useState<DecodedMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLocked, setIsLocked] = useState(() => localStorage.getItem(`cipherline_locked_${roomId}`) === 'true');
  const [pinInput, setPinInput] = useState('');
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [isGhost, setIsGhost] = useState(false);
  const [pinnedMessage, setPinnedMessage] = useState<DecodedMessage | null>(null);
  const [showPinnedBanner, setShowPinnedBanner] = useState(true);
  const [whisperTo, setWhisperTo] = useState<Participant | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  
  // EI VORAK E SALAS
  const [isSystemRoom, setIsSystemRoom] = useState(false);
  const [roomAvatarUrl, setRoomAvatarUrl] = useState<string | null>(null);

  // FOCUS MODE E DAILY RECAP
  const [focusMode] = useState(() => localStorage.getItem('cipherline_focus') === 'true');
  const [showRecapBanner, setShowRecapBanner] = useState(true);
  const [isRecaping, setIsRecaping] = useState(false);
  const [recapModalOpen, setRecapModalOpen] = useState(false);
  const [recapText, setRecapText] = useState('');

  // NOVOS ESTADOS: ENQUETES
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);

  // O efeito tem de reagir a initialQuote. Com deps vazias, se o utilizador
  // ja estava no ChatScreen quando clicou "Responder em Privado", o
  // componente nao remonta e a quote era ignorada.
  useEffect(() => {
    if (!initialQuote) return;
    setInput(`↩️ Sobre "${initialQuote.text}" (${initialQuote.sender}, em ${initialQuote.roomName}):\n`);
    onQuoteConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuote]);

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
  const [editShowProfile, setEditShowProfile] = useState(false);
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
  const [showAvatarUploader, setShowAvatarUploader] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [activeCall, setActiveCall] = useState<{ peerId: string; peerNickname: string; withVideo: boolean; isInitiator: boolean } | null>(null);
  const [activeGroupCall, setActiveGroupCall] = useState<{ withVideo: boolean } | null>(null);
  const [groupCallInvite, setGroupCallInvite] = useState<{ withVideo: boolean } | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ from: string; fromNickname: string; withVideo: boolean } | null>(null);
  const [replyTo, setReplyTo] = useState<DecodedMessage | null>(null);

  const webrtcChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chatChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const reactionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const receiptChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pasteChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'offline'>('connected');
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

  useEffect(() => {
    if (cryptoVersion === 2 && !rc.hasKey) return;
    loadInitialData(); loadBackground(); loadPaste();
    // Fetch das informações da sala (incluindo se é sala do EiVORAK e o avatar)
    supabase.from('rooms').select('name, is_public, owner_id, is_system_room, avatar_path').eq('id', roomId).maybeSingle().then(async ({ data }) => {
      if (data) {
        if (data.name) setRoomName(data.name);
        setEditRoomName(data.name || '');
        setEditIsPublic(data.is_public || false);
        setIsSystemRoom(data.is_system_room || false);
        if (data.avatar_path) {
          const url = await getImageUrl(data.avatar_path);
          setRoomAvatarUrl(url);
        }
      }
      setIsOwner(data?.owner_id === userId);
    });
    if (userId) { supabase.from('participants').select(PARTICIPANT_COLUMNS.showProfile).eq('id', participantId).maybeSingle().then(({ data }) => { setEditShowProfile(data?.show_profile || false); }); }

    pasteChannelRef.current = supabase.channel(`paste-${roomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'room_pastes', filter: `room_id=eq.${roomId}` }, async (payload: any) => {
        if (pasteTextareaFocusedRef.current) return;
        const encrypted = payload.new?.encrypted_content;
        if (encrypted) { const plain = await rc.decryptText(encrypted, { messageId: roomId, type: 'paste' }); if (plain !== DECRYPT_FAILED && plain !== NO_KEY) setPasteContent(plain); }
      }).subscribe();

    setupRealtime(); setupPresence(); updateLastSeen();
    presenceIntervalRef.current = setInterval(updateLastSeen, PRESENCE_INTERVAL);
    presenceCheckRef.current = setInterval(checkOnlineStatus, PRESENCE_CHECK_INTERVAL);

    const handleOffline = () => setConnectionStatus('offline');
    const handleOnline = () => {
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      setConnectionStatus('reconnecting');
      if (chatChannelRef.current) supabase.removeChannel(chatChannelRef.current);
      if (reactionChannelRef.current) supabase.removeChannel(reactionChannelRef.current);
      if (receiptChannelRef.current) supabase.removeChannel(receiptChannelRef.current);
      setupRealtime();
    };
    window.addEventListener('offline', handleOffline); window.addEventListener('online', handleOnline);

    return () => {
      if (presenceIntervalRef.current) clearInterval(presenceIntervalRef.current);
      if (presenceCheckRef.current) clearInterval(presenceCheckRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (connectionGraceTimerRef.current) clearTimeout(connectionGraceTimerRef.current);
      if (pasteSaveTimerRef.current) clearTimeout(pasteSaveTimerRef.current);
      typingTimeoutsRef.current.forEach((t) => clearTimeout(t));
      window.removeEventListener('offline', handleOffline); window.removeEventListener('online', handleOnline);
      if (chatChannelRef.current) supabase.removeChannel(chatChannelRef.current);
      if (presenceChannelRef.current) supabase.removeChannel(presenceChannelRef.current);
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
      if (reactionChannelRef.current) supabase.removeChannel(reactionChannelRef.current);
      if (receiptChannelRef.current) supabase.removeChannel(receiptChannelRef.current);
      if (pasteChannelRef.current) supabase.removeChannel(pasteChannelRef.current);
      if (webrtcChannelRef.current) supabase.removeChannel(webrtcChannelRef.current);
      chatChannelRef.current = null; presenceChannelRef.current = null; typingChannelRef.current = null; reactionChannelRef.current = null; receiptChannelRef.current = null; pasteChannelRef.current = null; webrtcChannelRef.current = null;
      unsubscribeFromPush(participantId).catch(() => {});
    };
  }, [roomId, userId, cryptoVersion, rc]);

  const loadPaste = async () => { const { data } = await supabase.from('room_pastes').select('encrypted_content').eq('room_id', roomId).maybeSingle(); if (data?.encrypted_content) { const plain = await rc.decryptText(data.encrypted_content, { messageId: roomId, type: 'paste' }); setPasteContent(plain === DECRYPT_FAILED || plain === NO_KEY ? '' : plain); } };
  const savePaste = async (content: string) => { setPasteSaving(true); try { const encrypted = await rc.encryptText(content, { messageId: roomId, type: 'paste' }); await upsertPasteSecure(roomId, participantId, participantSecret, encrypted); } finally { setPasteSaving(false); } };
  const handlePasteChange = (value: string) => { setPasteContent(value); if (pasteSaveTimerRef.current) clearTimeout(pasteSaveTimerRef.current); pasteSaveTimerRef.current = setTimeout(() => savePaste(value), 800); };

  const handleUploadAvatar = async (blob: Blob) => {
    setShowAvatarUploader(false);
    try {
      const tempId = crypto.randomUUID();
      const path = `rooms/${roomId}/avatar-${tempId}.jpg`;
      await supabase.storage.from('cipherline-media').upload(path, blob);
      await supabase.from('rooms').update({ avatar_path: path }).eq('id', roomId);
      const url = await getImageUrl(path);
      setRoomAvatarUrl(url);
      setSystemMessage('AVATAR DA SALA ATUALIZADO'); setTimeout(() => setSystemMessage(''), 3000);
    } catch { setSystemMessage('FALHA AO ATUALIZAR AVATAR'); setTimeout(() => setSystemMessage(''), 3000); }
  };

  const saveChannelSettings = async () => {
    setChannelSettingsSaving(true);
    try {
      try { await updateRoomSecure({ roomId, participantId, secret: participantSecret, name: editRoomName.trim() || null, isPublic: userId ? editIsPublic : null }); } 
      catch (err) { const msg = (err as Error).message || ''; if (!msg.includes('NOT_OWNER')) { setSystemMessage('FALHA AO SALVAR'); setTimeout(() => setSystemMessage(''), 5000); } }
      if (userId) await updateParticipantProfileSecure(participantId, participantSecret, editShowProfile);
      setRoomName(editRoomName.trim()); setShowChannelSettings(false);
    } finally { setChannelSettingsSaving(false); }
  };

  const loadBackground = async () => {
    if (!userId) return;
    
    // 1. Fundo específico da sala
    const { data: rm } = await supabase.from('room_members').select('background_path, background_mode').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    if (rm?.background_path) { 
      const url = await getImageUrl(rm.background_path); 
      setBgUrl(url); 
      setBgMode((rm.background_mode as BackgroundMode) || 'default'); 
      return; 
    }

    // 2. Fundo do Dashboard (se a opção estiver ligada)
    const { data: profile } = await supabase.from('profiles').select(PROFILE_COLUMNS.chatBackground).eq('id', userId).maybeSingle();
    
    if (profile?.dashboard_bg_apply_to_chats && profile?.dashboard_bg_path) {
      const url = await getImageUrl(profile.dashboard_bg_path);
      setBgUrl(url);
      setBgMode('default'); // Modo padrão para não aplicar filtros extra
      return;
    }

    // 3. Fundo padrão global
    if (profile?.default_background_path) { 
      const url = await getImageUrl(profile.default_background_path); 
      setBgUrl(url); 
      setBgMode((profile.default_background_mode as BackgroundMode) || 'default'); 
    }
  };

  const saveBackground = async (blob: Blob, mode: BackgroundMode, scope: 'room' | 'global') => {
    setBgSaving(true);
    try {
      if (!userId) { setBgUrl(URL.createObjectURL(blob)); setBgMode(mode); setShowBgSettings(false); setBgStep('menu'); return; }
      const path = await uploadBackgroundImage(userId, blob);
      if (scope === 'room') {
        const { data: existing } = await supabase.from('room_members').select('background_path').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
        if (existing?.background_path) await deleteStorageFile(existing.background_path).catch(() => {});
        await supabase.from('room_members').update({ background_path: path, background_mode: mode }).eq('room_id', roomId).eq('user_id', userId);
      } else {
        const { data: existing } = await supabase.from('profiles').select(PROFILE_COLUMNS.defaultBackground).eq('id', userId).maybeSingle();
        if (existing?.default_background_path) await deleteStorageFile(existing.default_background_path).catch(() => {});
        await supabase.from('profiles').update({ default_background_path: path, default_background_mode: mode }).eq('id', userId);
      }
      setBgUrl(await getImageUrl(path)); setBgMode(mode); setShowBgSettings(false); setBgStep('menu'); setPendingBgBlob(null);
    } catch { setSystemMessage('FALHA AO SALVAR FUNDO'); setTimeout(() => setSystemMessage(''), 3000); } finally { setBgSaving(false); }
  };

  const clearBackground = async (scope: 'room' | 'global') => {
    setBgSaving(true);
    try {
      if (userId) { if (scope === 'room') await supabase.from('room_members').update({ background_path: null, background_mode: null }).eq('room_id', roomId).eq('user_id', userId); else await supabase.from('profiles').update({ default_background_path: null, default_background_mode: null }).eq('id', userId); }
      setBgUrl(null); setShowBgSettings(false); setBgStep('menu');
    } finally { setBgSaving(false); }
  };

  useEffect(() => { onSuppressScanlines?.(bgMode === 'default' && !!bgUrl); return () => onSuppressScanlines?.(false); }, [bgMode, bgUrl]);

  const loadInitialData = async () => {
    try {
      const [{ data: existingMsgs }, { data: parts }] = await Promise.all([
        supabase.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(100),
        supabase.from('participants').select(PARTICIPANT_COLUMNS.room).eq('room_id', roomId),
      ]);

      // Buscar reactions e receipts apenas das mensagens carregadas, em vez de
      // toda a tabela (antes era SELECT * em reactions/read_receipts globais).
      const msgIds = (existingMsgs ?? []).map((m) => m.id);
      let reactions: any[] = [];
      let receipts: any[] = [];
      if (msgIds.length > 0) {
        const [rxRes, rrRes] = await Promise.all([
          supabase.from('reactions').select('*').in('message_id', msgIds),
          supabase.from('read_receipts').select('*').in('message_id', msgIds),
        ]);
        reactions = rxRes.data ?? [];
        receipts = rrRes.data ?? [];
      }

      if (parts) {
        setAllParticipants(parts);
        setPeers(parts.filter((p) => p.id !== participantId));
        const online = new Set<string>();
        const now = Date.now();
        for (const p of parts) {
          if (p.id !== participantId && now - new Date(p.last_seen).getTime() < PRESENCE_TIMEOUT_MS) online.add(p.id);
        }
        setOnlinePeerIds(online);
      }

      const profileByParticipantId = new Map<string, { displayName: string | null; avatarUrl: string | null }>();
      const revealedUserIds = (parts || []).filter((p: any) => p.show_profile && p.user_id).map((p: any) => p.user_id as string);
      if (revealedUserIds.length > 0) {
        const { data: profilesData } = await supabase.from('profiles').select(PROFILE_COLUMNS.revealedProfile).in('id', revealedUserIds);
        const avatarUrls = new Map<string, string>();
        await Promise.all(
        (profilesData || [])
          .filter((pr) => pr.avatar_path)
          .map(async (pr) => {
            const url = await getImageUrl(pr.avatar_path!);
            if (url) avatarUrls.set(pr.id, url);
          }),
      );
        for (const p of parts || []) {
          if (p.show_profile && p.user_id) {
            const pr = (profilesData || []).find((x) => x.id === p.user_id);
            if (pr) profileByParticipantId.set(p.id, { displayName: pr.display_name || null, avatarUrl: pr.avatar_path ? avatarUrls.get(pr.id) || null : null });
          }
        }
      }

      if (existingMsgs) {
        const reversedMsgs = [...existingMsgs].reverse();
        const plaintextById = new Map<string, { plaintext: string; senderNickname: string }>();
        for (const msg of reversedMsgs) {
          const decrypted = await rc.decryptText(msg.encrypted_content, { messageId: msg.id, type: msg.message_type || 'text' });
          plaintextById.set(msg.id, { plaintext: decrypted === NO_KEY ? DECRYPT_FAILED : decrypted, senderNickname: parts?.find((p) => p.id === msg.sender_id)?.nickname || 'UNKNOWN' });
        }

        const decoded = await Promise.all(reversedMsgs.map(async (msg) => {
          const { plaintext } = plaintextById.get(msg.id)!;
          const sender = parts?.find((p) => p.id === msg.sender_id);
          const identity = profileByParticipantId.get(msg.sender_id);
          const msgBurn = msg.burn_config ? jsonToBurnConfig(msg.burn_config) : null;
          const replyInfo = msg.reply_to_message_id ? plaintextById.get(msg.reply_to_message_id) : null;

          let pollData = null;
          if (msg.message_type === 'poll') {
            try { pollData = mergePollData(JSON.parse(plaintext) as PollData, msg.poll_data); } catch {}
          }

          return {
            id: msg.id, senderId: msg.sender_id, senderNickname: sender?.nickname || 'UNKNOWN', senderDisplayName: identity?.displayName || null, senderAvatarUrl: identity?.avatarUrl || null,
            encryptedContent: msg.encrypted_content, plaintext: msg.message_type === 'poll' ? '' : plaintext, createdAt: msg.created_at, isOwn: msg.sender_id === participantId,
            state: msg.destroyed_at ? 'destroyed' : 'decoded', destroyAt: msgBurn && msgBurn.seconds > 0 ? new Date(msg.created_at).getTime() + (msgBurn.seconds * 1000) : null,
            burnConfig: msgBurn, reactions: reactions.filter((r: Reaction) => r.message_id === msg.id), readBy: receipts.filter((r: ReadReceipt) => r.message_id === msg.id),
            messageType: (msg.message_type as MessageType) || 'text', storagePath: msg.storage_path || null, durationSeconds: msg.duration_seconds || null, replyToMessageId: msg.reply_to_message_id || null,
            replyToSenderNickname: replyInfo?.senderNickname || null, replyToPlaintext: replyInfo?.plaintext?.slice(0, 80) || null, capsuleUnlockAt: msg.capsule_unlock_at || null,
            targetParticipantId: msg.target_participant_id || null, isPinned: msg.is_pinned || false,
            pollData, burnAfterListen: msg.burn_after_listen || false, fileName: msg.file_name || null,
          } as DecodedMessage;
        }));

        const pinned = decoded.find((m) => m.isPinned);
        if (pinned) setPinnedMessage(pinned);
        // Nao marcar como lido no load. O unreadCount precisa de crescer para
        // o banner de recap fazer sentido. Marcacao automatica acontece apenas
        // quando o utilizador esta a ver ativamente (ver efeito dedicado).
        const hiddenIds = getHiddenMessageIds(roomId);
        setMessages(decoded.filter((m) => m.state !== 'destroyed' && !hiddenIds.has(m.id)));
      }
    } catch (err) {
      console.error('[CipherLine] Falha ao carregar dados iniciais:', err);
      setSystemMessage('FALHA AO CARREGAR MENSAGENS');
      setTimeout(() => setSystemMessage(''), 5000);
    }
  };

  const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 15000];
  const scheduleReconnect = () => {
    if (reconnectTimerRef.current) return; const delay = BACKOFF_STEPS[Math.min(reconnectAttemptRef.current, BACKOFF_STEPS.length - 1)]; reconnectAttemptRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => { reconnectTimerRef.current = null; if (chatChannelRef.current) supabase.removeChannel(chatChannelRef.current); if (reactionChannelRef.current) supabase.removeChannel(reactionChannelRef.current); if (receiptChannelRef.current) supabase.removeChannel(receiptChannelRef.current); setupRealtime(); }, delay);
  };

  const setupRealtime = () => {
    const channel = supabase.channel(`chat-${roomId}`);
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, async (payload) => {
        const msg = payload.new as any; if (msg.sender_id === participantId) return;
        const decrypted = await rc.decryptText(msg.encrypted_content, { messageId: msg.id, type: msg.message_type || 'text' }); const plaintext = decrypted === NO_KEY ? DECRYPT_FAILED : decrypted; const { data: sender } = await supabase.from('participants').select(PARTICIPANT_COLUMNS.sender).eq('id', msg.sender_id).maybeSingle();
        let senderDisplayName: string | null = null, senderAvatarUrl: string | null = null;
        if (sender?.show_profile && sender?.user_id) { const { data: pr } = await supabase.from('profiles').select(PROFILE_COLUMNS.sender).eq('id', sender.user_id).maybeSingle(); senderDisplayName = pr?.display_name || null; senderAvatarUrl = pr?.avatar_path ? await getImageUrl(pr.avatar_path) : null; }
        const msgBurn = msg.burn_config ? jsonToBurnConfig(msg.burn_config) : null;
        if (!focusMode) playReceiveSound(); 
        setPulseKey((k) => k + 1); vibrate(60); setSystemMessage('NOVA TRANSMISSÃO RECEBIDA'); setTimeout(() => setSystemMessage(''), 2000);
        
        let pollData = null;
        if (msg.message_type === 'poll') {
          try { pollData = mergePollData(JSON.parse(plaintext) as PollData, msg.poll_data); } catch {}
        }

        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          const replySource = msg.reply_to_message_id ? prev.find((m) => m.id === msg.reply_to_message_id) : null;
          return [...prev, { 
            id: msg.id, senderId: msg.sender_id, senderNickname: sender?.nickname || 'UNKNOWN', senderDisplayName, senderAvatarUrl, 
            encryptedContent: msg.encrypted_content, plaintext: msg.message_type === 'poll' ? '' : plaintext, createdAt: msg.created_at, isOwn: false, 
            state: 'decoded', destroyAt: msgBurn && msgBurn.seconds > 0 ? new Date(msg.created_at).getTime() + (msgBurn.seconds * 1000) : null, 
            burnConfig: msgBurn, reactions: [], readBy: [], messageType: (msg.message_type as MessageType) || 'text', storagePath: msg.storage_path || null, 
            durationSeconds: msg.duration_seconds || null, replyToMessageId: msg.reply_to_message_id || null, replyToSenderNickname: replySource?.senderNickname || null, 
            replyToPlaintext: replySource?.plaintext?.slice(0, 80) || null, capsuleUnlockAt: msg.capsule_unlock_at || null, targetParticipantId: msg.target_participant_id || null, 
            isPinned: msg.is_pinned || false, pollData, burnAfterListen: msg.burn_after_listen || false, fileName: msg.file_name || null
          }];
        });
        // A marcacao como lido agora e feita pelo efeito de "active viewing"
        // (autoScroll + visivel + interagiu). Antes era incondicional aqui,
        // o que impedia unreadCount de crescer.
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => {
        const msg = payload.new as any;
        setMessages(prev => prev.map(x => x.id === msg.id ? { ...x, isPinned: msg.is_pinned || false, pollData: x.messageType === 'poll' && x.pollData ? mergePollData(x.pollData, msg.poll_data) : x.pollData } : (msg.is_pinned ? { ...x, isPinned: false } : x)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => { const msg = payload.old as any; setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, state: 'destroyed' as const } : m))); })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          chatChannelRef.current = channel; 
          if (connectionGraceTimerRef.current) { clearTimeout(connectionGraceTimerRef.current); connectionGraceTimerRef.current = null; }
          const wasReconnecting = reconnectAttemptRef.current > 0; 
          reconnectAttemptRef.current = 0; 
          setConnectionStatus('connected'); 
          if (wasReconnecting) loadInitialData();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // REMOVIDO: supabase.removeChannel(channel) que causava o loop.
          if (!connectionGraceTimerRef.current) { connectionGraceTimerRef.current = setTimeout(() => { connectionGraceTimerRef.current = null; setConnectionStatus('reconnecting'); }, 4000); } 
          scheduleReconnect();
        }
      });
    reactionChannelRef.current = supabase.channel(`reactions-${roomId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (payload) => { const r = payload.new as any; setMessages((prev) => prev.map((m) => m.id === r.message_id ? { ...m, reactions: [...m.reactions.filter((x) => x.id !== r.id), r as Reaction] } : m)); }).on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (payload) => { const r = payload.old as any; if (!r?.id) return; setMessages((prev) => prev.map((m) => m.reactions.some((x) => x.id === r.id) ? { ...m, reactions: m.reactions.filter((x) => x.id !== r.id) } : m)); }).subscribe();
    // Dedupe por id E por participant_id. Antes so filtrava por id, o que
    // deixava receipts temporarios locais ("temp-<uuid>") duplicados ao lado
    // dos reais recebidos pelo realtime.
    receiptChannelRef.current = supabase.channel(`receipts-${roomId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'read_receipts' }, (payload) => { const r = payload.new as any; setMessages((prev) => prev.map((m) => m.id === r.message_id ? { ...m, readBy: [...m.readBy.filter((x) => x.id !== r.id && x.participant_id !== r.participant_id), r as ReadReceipt] } : m)); }).subscribe();
  };

  const setupPresence = () => {
    presenceChannelRef.current = supabase.channel(`presence-${roomId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, async (payload) => {
          const p = payload.new as any; if (p.id === participantId) return;
          setPeers((prev) => prev.find((x) => x.id === p.id) ? prev : [...prev, p]); setAllParticipants((prev) => prev.find((x) => x.id === p.id) ? prev : [...prev, p]);
          setOnlinePeerIds((prev) => new Set(prev).add(p.id)); setSystemMessage(`${p.nickname.toUpperCase()} CONECTADO`); setTimeout(() => setSystemMessage(''), 3000);
      }).on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, (payload) => {
          const p = payload.old as any; if (p.id === participantId) return;
          setPeers((prev) => prev.filter((x) => x.id !== p.id)); setAllParticipants((prev) => prev.filter((x) => x.id !== p.id));
          setOnlinePeerIds((prev) => { const next = new Set(prev); next.delete(p.id); return next; }); setSystemMessage(`${p.nickname?.toUpperCase() || 'PARTICIPANTE'} DESCONECTADO`); setTimeout(() => setSystemMessage(''), 3000);
      }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, (payload) => {
          const p = payload.new as any; if (p.id === participantId) return;
          setPeers((prev) => prev.map((x) => (x.id === p.id ? p : x))); setAllParticipants((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      }).subscribe();
  };

  const reconcileParticipants = async () => {
    const { data } = await supabase.from('participants').select(PARTICIPANT_COLUMNS.room).eq('room_id', roomId); if (!data) return;
    setPeers((prev) => { const known = new Set(prev.map((p) => p.id)); const fresh = data.filter((p) => p.id !== participantId); fresh.filter((p) => !known.has(p.id)).forEach((p) => { setSystemMessage(`${p.nickname?.toUpperCase() || 'PARTICIPANTE'} CONECTADO`); setTimeout(() => setSystemMessage(''), 3000); }); return fresh; });
    setAllParticipants(data);
  };

  useEffect(() => { const interval = setInterval(reconcileParticipants, 5000); return () => clearInterval(interval); }, [roomId]);

  const updateLastSeen = async () => { if (isGhost) return; await updatePresenceSecure(participantId, participantSecret); };
  const checkOnlineStatus = () => { const now = Date.now(); const online = new Set<string>(); for (const peer of peers) if (now - new Date(peer.last_seen).getTime() < PRESENCE_TIMEOUT_MS) online.add(peer.id); setOnlinePeerIds(online); };

  const broadcastTyping = useCallback(() => {
    if (isGhost || typingDebounceRef.current) return; typingChannelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { participantId, nickname, isTyping: true } }); typingDebounceRef.current = setTimeout(() => { typingDebounceRef.current = null; }, 1500);
  }, [participantId, nickname, isGhost]);

  const setupTypingListener = () => {
    typingChannelRef.current = supabase.channel(`typing-${roomId}`);
    typingChannelRef.current.on('broadcast', { event: 'typing' }, (payload: any) => {
      const data = payload.payload; if (!data || data.participantId === participantId) return;
      setTypingPeers((prev) => new Set(prev).add(data.participantId)); const existing = typingTimeoutsRef.current.get(data.participantId); if (existing) clearTimeout(existing);
      const timer = setTimeout(() => { setTypingPeers((prev) => { const next = new Set(prev); next.delete(data.participantId); return next; }); typingTimeoutsRef.current.delete(data.participantId); }, TYPING_TIMEOUT);
      typingTimeoutsRef.current.set(data.participantId, timer);
    }).subscribe();
  };

  useEffect(() => { setupTypingListener(); }, []);

  const scrollToBottom = useCallback((smooth = true) => { messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' }); }, []);
  useEffect(() => { if (autoScroll) scrollToBottom(); }, [messages, autoScroll, scrollToBottom]);
  useEffect(() => {
    const pinned = messages.find(m => m.isPinned);
    setPinnedMessage(pinned || null);
  }, [messages]);

  const handleScroll = () => {
    setHasViewedChat(true);
    const container = scrollContainerRef.current; if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    setAutoScroll(atBottom);
    setShowScrollButton(!atBottom);
  };

  const maybeRequestPush = async () => { if (hasInteracted) return; setHasInteracted(true); const granted = await requestNotificationPermission(); if (granted) await subscribeToPush(participantId); };

  const handleSend = async () => {
    setHasViewedChat(true);
    const text = input.trim(); if (!text) return; maybeRequestPush(); const messageId = crypto.randomUUID(); const encrypted = await rc.encryptText(text, { messageId, type: 'text' }); const burnJson = burnConfig.seconds > 0 ? JSON.parse(JSON.stringify(burnConfig)) : null; let msg: any;
    try { 
      msg = await insertMessageSecure({ 
        roomId, participantId, secret: participantSecret, encryptedContent: encrypted, 
        burnConfig: burnJson, replyToMessageId: replyTo?.id || null,
        targetParticipantId: whisperTo?.id || null, messageId
      }); 
    } catch { setSystemMessage('FALHA AO ENVIAR MENSAGEM'); return; }
    if (msg) {
      if (!focusMode) playSendSound(); 
      setPulseKey((k) => k + 1);
      setMessages((prev) => [...prev, { id: messageId, senderId: participantId, senderNickname: nickname, encryptedContent: encrypted, plaintext: text, createdAt: msg.created_at, isOwn: true, state: 'decoded', destroyAt: burnConfig.seconds > 0 ? Date.now() + (burnConfig.seconds * 1000) : null, burnConfig: burnConfig.seconds > 0 ? burnConfig : null, reactions: [], readBy: [], messageType: 'text' as MessageType, storagePath: null, durationSeconds: null, replyToMessageId: replyTo?.id || null, replyToSenderNickname: replyTo?.senderNickname || null, replyToPlaintext: replyTo?.plaintext?.slice(0, 80) || null, capsuleUnlockAt: null, senderDisplayName: null, senderAvatarUrl: null, targetParticipantId: whisperTo?.id || null, isPinned: false, pollData: null, burnAfterListen: false, fileName: null }]);
      setInput(''); const repliedTo = replyTo; setReplyTo(null); setWhisperTo(null); 
      
      // AQUI ESTÁ A LÓGICA: Se for sistema, ou se tiver @eivorak, chama a IA
      if (/@eivorak\b/i.test(text) || isSystemRoom) {
        triggerEivorak(text, repliedTo);
      }
    }
  };

  const handleRecap = async () => {
    if (isRecaping) return;
    setIsRecaping(true);
    try {
      const unread = messages.filter(m => !m.isOwn && !m.readBy.some(r => r.participant_id === participantId));
      const contextText = unread.map(m => `${m.senderNickname}: ${m.plaintext}`).join('\n');
      
      const { data, error } = await supabase.functions.invoke('eivorak-agent', {
        body: { 
          message: 'Faz um resumo muito breve (máximo 3 parágrafos) do que se passou nestas mensagens não lidas. Diz quem falou do quê e se houve decisões importantes.', 
          recentContext: contextText 
        }
      });
      
      if (error || !data?.reply) throw new Error('Falha no resumo');
      setRecapText(data.reply);
      setRecapModalOpen(true);
      setShowRecapBanner(false);
    } catch {
      setSystemMessage('EIVORAK NÃO CONSEGUIU RESUMIR AGORA'); setTimeout(() => setSystemMessage(''), 4000);
    } finally {
      setIsRecaping(false);
    }
  };

  const handleSendPoll = async () => {
    if (!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2) return;
    setShowPollCreator(false);
    maybeRequestPush();
    
    const pollDataObj: PollData = {
      question: pollQuestion.trim(),
      options: pollOptions.filter(o => o.trim()).map(o => ({ id: crypto.randomUUID(), text: o.trim(), votes: [] })),
      allowMultiple: false
    };
    
    const messageId = crypto.randomUUID();
    const encrypted = await rc.encryptText(JSON.stringify(pollDataObj), { messageId, type: 'poll' });
    const serverPollData = buildServerPollData(pollDataObj, cryptoVersion);
    const burnJson = burnConfig.seconds > 0 ? JSON.parse(JSON.stringify(burnConfig)) : null;
    
    try {
      const msg = await insertMessageSecure({
        roomId, participantId, secret: participantSecret, encryptedContent: encrypted,
        burnConfig: burnJson, messageType: 'poll', pollData: serverPollData, messageId
      });
      if (msg) {
        if (!focusMode) playSendSound(); 
        setPulseKey(k => k + 1);
        setMessages(prev => [...prev, {
          id: messageId, senderId: participantId, senderNickname: nickname, encryptedContent: encrypted, plaintext: '',
          createdAt: msg.created_at, isOwn: true, state: 'decoded', destroyAt: null, burnConfig: null,
          reactions: [], readBy: [], messageType: 'poll', storagePath: null, durationSeconds: null,
          replyToMessageId: null, replyToSenderNickname: null, replyToPlaintext: null, capsuleUnlockAt: null,
          senderDisplayName: null, senderAvatarUrl: null, targetParticipantId: null, isPinned: false,
          pollData: pollDataObj, burnAfterListen: false, fileName: null
        }]);
        setPollQuestion(''); setPollOptions(['', '']); setWhisperTo(null);
      }
    } catch { setSystemMessage('FALHA AO CRIAR ENQUETE'); setTimeout(() => setSystemMessage(''), 3000); }
  };

  const handleVote = async (messageId: string, optionId: string) => {
    try {
      await votePollSecure(messageId, participantId, participantSecret, optionId);
    } catch { setSystemMessage('FALHA AO VOTAR'); setTimeout(() => setSystemMessage(''), 3000); }
  };

  const handlePinMessage = async (message: DecodedMessage) => {
    try {
      const pinned = await togglePinMessageSecure(message.id, participantId, participantSecret);
      if (pinned) {
        setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isPinned: true } : { ...m, isPinned: false }));
        setSystemMessage('MENSAGEM FIXADA'); setTimeout(() => setSystemMessage(''), 3000);
      } else {
        setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isPinned: false } : m));
        setSystemMessage('MENSAGEM DESAFIXADA'); setTimeout(() => setSystemMessage(''), 3000);
      }
    } catch { setSystemMessage('FALHA AO FIXAR'); setTimeout(() => setSystemMessage(''), 3000); }
  };

  const triggerEivorak = async (userMessage: string, repliedTo: DecodedMessage | null) => {
    try {
      setEivorakThinking(true); const recentContext = messages.slice(-10).map((m) => `${m.senderNickname}: ${m.plaintext}`).join('\n'); const urlMatch = userMessage.match(/https?:\/\/[^\s]+/i); const cleanMessage = userMessage.replace(/@eivorak\b/i, '').trim() || userMessage; let imageUrl: string | null = null;
      if (repliedTo?.messageType === 'image' && repliedTo.storagePath) {
        try { const { downloadAndDecryptImage } = await import('@/lib/media'); const blob = await downloadAndDecryptImage(repliedTo.storagePath, rc, { messageId: repliedTo.id, type: 'image' }); imageUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(blob); }); } catch { imageUrl = null; }
      }
      const { data, error } = await supabase.functions.invoke('eivorak-agent', { body: { message: cleanMessage, recentContext, linkUrl: urlMatch ? urlMatch[0] : null, imageUrl, isSystemRoom } });
      if (error || !data?.reply) { const detail = (data as any)?.error || error?.message; setSystemMessage(detail ? `EIVORAK: ${String(detail).slice(0, 80)}` : 'EIVORAK NÃO RESPONDEU — TENTE DE NOVO'); setTimeout(() => setSystemMessage(''), 6000); return; }
      const messageId = crypto.randomUUID(); const encryptedReply = await rc.encryptText(data.reply, { messageId, type: 'text' }); let replyMsg: any = null;
      try {
        const rpcRes = await insertEivorakReplySecure(roomId, participantId, participantSecret, encryptedReply, messageId);
        replyMsg = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes; // Corrige o problema do array
      } catch { replyMsg = null; }
      
      if (replyMsg && replyMsg.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === replyMsg.id)) return prev;
          return [...prev, { id: replyMsg.id, senderId: replyMsg.sender_id, senderNickname: 'EiVORAK', encryptedContent: encryptedReply, plaintext: data.reply, createdAt: replyMsg.created_at, isOwn: false, state: 'decoded', destroyAt: null, burnConfig: null, reactions: [], readBy: [], messageType: 'text' as MessageType, storagePath: null, durationSeconds: null, replyToMessageId: null, replyToSenderNickname: null, replyToPlaintext: null, capsuleUnlockAt: null, senderDisplayName: null, senderAvatarUrl: null, targetParticipantId: null, isPinned: false, pollData: null, burnAfterListen: false, fileName: null }];
        });
        if (!focusMode) playReceiveSound();
      }
    } finally { setEivorakThinking(false); }
  };

  const handleSendAudio = async (blob: Blob, durationSeconds: number, fileName: string | null, burnAfterListen: boolean) => {
    setShowAudioRecorder(false); maybeRequestPush(); setUploadProgress(0); const messageId = crypto.randomUUID(); const burnJson = burnConfig.seconds > 0 ? JSON.parse(JSON.stringify(burnConfig)) : null;
    try {
      const storagePath = await uploadEncryptedAudio(roomId, blob, rc, { messageId, type: 'audio' }, setUploadProgress); const placeholder = await rc.encryptText('[audio]', { messageId, type: 'audio' });
      const msg = await insertMessageSecure({ roomId, participantId, secret: participantSecret, encryptedContent: placeholder, burnConfig: burnJson, messageType: 'audio', storagePath, durationSeconds, targetParticipantId: whisperTo?.id || null, burnAfterListen, fileName, messageId });
      if (msg) { if (!focusMode) playSendSound(); setPulseKey((k) => k + 1); setMessages((prev) => [...prev, { id: messageId, senderId: participantId, senderNickname: nickname, encryptedContent: placeholder, plaintext: '[audio]', createdAt: msg.created_at, isOwn: true, state: 'decoded', destroyAt: burnConfig.seconds > 0 ? Date.now() + (burnConfig.seconds * 1000) : null, burnConfig: burnConfig.seconds > 0 ? burnConfig : null, reactions: [], readBy: [], messageType: 'audio' as MessageType, storagePath, durationSeconds, replyToMessageId: null, replyToSenderNickname: null, replyToPlaintext: null, capsuleUnlockAt: null, senderDisplayName: null, senderAvatarUrl: null, targetParticipantId: whisperTo?.id || null, isPinned: false, pollData: null, burnAfterListen, fileName }]); setWhisperTo(null); }
    } catch { setSystemMessage('FALHA AO ENVIAR ÁUDIO'); setTimeout(() => setSystemMessage(''), 3000); } finally { setUploadProgress(null); }
  };

  const handleSendImage = async (blob: Blob) => {
    setShowImageUploader(false); maybeRequestPush(); setUploadProgress(0); const messageId = crypto.randomUUID(); const burnJson = burnConfig.seconds > 0 ? JSON.parse(JSON.stringify(burnConfig)) : null;
    try {
      const storagePath = await uploadEncryptedImage(roomId, blob, rc, { messageId, type: 'image' }, setUploadProgress); const placeholder = await rc.encryptText('[image]', { messageId, type: 'image' });
      const msg = await insertMessageSecure({ roomId, participantId, secret: participantSecret, encryptedContent: placeholder, burnConfig: burnJson, messageType: 'image', storagePath, targetParticipantId: whisperTo?.id || null, messageId });
      if (msg) { if (!focusMode) playSendSound(); setPulseKey((k) => k + 1); setMessages((prev) => [...prev, { id: messageId, senderId: participantId, senderNickname: nickname, encryptedContent: placeholder, plaintext: '[image]', createdAt: msg.created_at, isOwn: true, state: 'decoded', destroyAt: burnConfig.seconds > 0 ? Date.now() + (burnConfig.seconds * 1000) : null, burnConfig: burnConfig.seconds > 0 ? burnConfig : null, reactions: [], readBy: [], messageType: 'image' as MessageType, storagePath, durationSeconds: null, replyToMessageId: null, replyToSenderNickname: null, replyToPlaintext: null, capsuleUnlockAt: null, senderDisplayName: null, senderAvatarUrl: null, targetParticipantId: whisperTo?.id || null, isPinned: false, pollData: null, burnAfterListen: false, fileName: null }]); setWhisperTo(null); }
    } catch { setSystemMessage('FALHA AO ENVIAR IMAGEM'); setTimeout(() => setSystemMessage(''), 3000); } finally { setUploadProgress(null); }
  };

  const handleSendCapsule = async (text: string, unlockAt: Date) => {
    setShowCapsuleComposer(false);
    try {
      const messageId = crypto.randomUUID(); const { timelockEncryptText } = await import('@/lib/timelock'); const encryptedText = cryptoVersion === 2 ? await rc.encryptText(text, { messageId, type: 'capsule' }) : text; const capsuleCiphertext = await timelockEncryptText(encryptedText, unlockAt); const msg = await insertMessageSecure({ roomId, participantId, secret: participantSecret, encryptedContent: capsuleCiphertext, messageType: 'capsule', messageId, capsuleUnlockAt: unlockAt.toISOString(), targetParticipantId: whisperTo?.id || null });
      if (msg) { if (!focusMode) playSendSound(); setPulseKey((k) => k + 1); setMessages((prev) => [...prev, { id: messageId, senderId: participantId, senderNickname: nickname, encryptedContent: capsuleCiphertext, plaintext: '', createdAt: msg.created_at, isOwn: true, state: 'decoded', destroyAt: null, burnConfig: null, reactions: [], readBy: [], messageType: 'capsule' as MessageType, storagePath: null, durationSeconds: null, replyToMessageId: null, replyToSenderNickname: null, replyToPlaintext: null, capsuleUnlockAt: unlockAt.toISOString(), senderDisplayName: null, senderAvatarUrl: null, targetParticipantId: whisperTo?.id || null, isPinned: false, pollData: null, burnAfterListen: false, fileName: null }]); setWhisperTo(null); }
    } catch { setSystemMessage('FALHA AO CRIAR CÁPSULA DO TEMPO'); setTimeout(() => setSystemMessage(''), 3000); }
  };

  const handleStartCall = (withVideo: boolean) => {
    if (peers.length === 0) { setSystemMessage('NENHUM PARTICIPANTE ONLINE'); setTimeout(() => setSystemMessage(''), 3000); return; }
    if (peers.length >= 2) {
      setActiveGroupCall({ withVideo });
      // Antes criava um canal efemero (webrtc-${roomId}-${Date.now()}) que
      // ninguem escutava, por isso o convite nunca chegava aos peers. Usar
      // o canal persistente webrtc-${roomId} que ChatScreen e GroupCallScreen
      // subscrevem.
      if (webrtcChannelRef.current) {
        sendOnChannel(webrtcChannelRef.current, participantId, 'all', 'call-start', { withVideo, isGroup: true }).catch(() => {});
      }
      return;
    }
    setActiveCall({ peerId: peers[0].id, peerNickname: peers[0].nickname, withVideo, isInitiator: true });
  };

  const handleEndCall = (reason?: 'failed') => {
    setActiveCall(null);
    // NAO remover webrtcChannelRef. E o canal persistente onde chegam os
    // call-start futuros. O CallScreen tem o seu proprio canal de signaling
    // e limpa-o ao desmontar. Remover aqui significava que o utilizador
    // deixava de receber chamadas depois da primeira.
    if (reason === 'failed') {
      setSystemMessage('CHAMADA NAO COMPLETOU - REDE INSTAVEL. CONTINUE POR TEXTO.');
      setTimeout(() => setSystemMessage(''), 5000);
    }
  };
  const handleAcceptCall = () => { if (!incomingCall) return; setActiveCall({ peerId: incomingCall.from, peerNickname: incomingCall.fromNickname, withVideo: incomingCall.withVideo, isInitiator: false }); setIncomingCall(null); };
  const handleDeclineCall = () => {
    if (!incomingCall) return;
    if (webrtcChannelRef.current) {
      sendOnChannel(webrtcChannelRef.current, participantId, incomingCall.from, 'call-decline', {}).catch(() => {});
    }
    setIncomingCall(null);
  };

  const handleReplyPrivate = async (message: DecodedMessage) => {
    if (!userId) { setSystemMessage('PRECISA DE CONTA PARA CONVERSAS PRIVADAS'); setTimeout(() => setSystemMessage(''), 3000); return; }
    const { data: senderParticipant } = await supabase.from('participants').select(PARTICIPANT_COLUMNS.user).eq('id', message.senderId).maybeSingle();
    if (!senderParticipant?.user_id) { setSystemMessage('ESSA PESSOA ESTÁ SEM CONTA'); setTimeout(() => setSystemMessage(''), 4000); return; }
    if (senderParticipant.user_id === userId) { setSystemMessage('ESSA MENSAGEM É SUA'); setTimeout(() => setSystemMessage(''), 3000); return; }
    try {
      const { data: dmResult, error: dmErr } = await supabase.rpc('find_or_create_dm', { p_other_user_id: senderParticipant.user_id });
      if (dmErr || !dmResult || dmResult.length === 0) throw new Error('Falha no RPC');
      const dm = dmResult[0]; onOpenPrivateReply?.(dm.room_code, dm.room_id, { text: message.plaintext.slice(0, 200), sender: message.senderNickname, roomName: roomName || roomCode });
    } catch { setSystemMessage('FALHA AO ABRIR CONVERSA PRIVADA'); setTimeout(() => setSystemMessage(''), 3000); }
  };

  const handleScrollToMessage = (messageId: string) => { const container = scrollContainerRef.current; if (!container) return; const el = container.querySelector(`[data-msg-id="${messageId}"]`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('ring-2', 'ring-cyber-green/50'); setTimeout(() => el.classList.remove('ring-2', 'ring-cyber-green/50'), 2000); } };

  // Marcacao de leitura passa a ser explicita: so quando o utilizador esta
  // a ver (autoScroll + tab visivel + ja interagiu pelo menos uma vez).
  // Interagiu = scroll ou envio. Assim, abrir o chat com N mensagens nao
  // lidas NAO marca automaticamente, deixando o banner de recap funcionar.
  const [hasViewedChat, setHasViewedChat] = useState(false);
  const [visibilityTick, setVisibilityTick] = useState(0);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') setVisibilityTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!hasViewedChat) return;
    if (!autoScroll) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const unread = messages.filter((m) => !m.isOwn && !m.readBy.some((r) => r.participant_id === participantId));
    if (unread.length === 0) return;
    const now = new Date().toISOString();
    const idsToMark = new Set(unread.map((m) => m.id));
    setMessages((prev) => prev.map((m) => {
      if (!idsToMark.has(m.id)) return m;
      return {
        ...m,
        readBy: [...m.readBy, { id: 'temp-' + crypto.randomUUID(), participant_id: participantId, message_id: m.id, read_at: now }],
      };
    }));
    unread.forEach((m) => markReadSecure(m.id, participantId, participantSecret).catch(() => {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, autoScroll, visibilityTick, hasViewedChat, participantId, participantSecret]);

  const handleDestroy = (id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, state: 'destroying' as const } : m)));
    const target = messages.find((m) => m.id === id);
    (async () => {
      try {
        await deleteMessageSecure(id, participantId, participantSecret);
      } catch {
        // Reseta destroyAt para null. Sem isto, o countdown no ChatMessage
        // re-disparava onDestroy a cada 200ms, criando um loop infinito de
        // tentativas de delete quando o RPC falhava.
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, state: 'decoded' as const, destroyAt: null } : m)));
        setSystemMessage('FALHA AO APAGAR MENSAGEM');
        setTimeout(() => setSystemMessage(''), 3000);
        return;
      }
      if (target?.storagePath) await supabase.storage.from('cipherline-media').remove([target.storagePath]).catch(() => {});
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, state: 'destroyed' as const } : m)));
    })();
  };

  const handleDeleteForMe = (id: string) => { hideMessageLocally(roomId, id); setMessages((prev) => prev.filter((m) => m.id !== id)); };

  useEffect(() => {
    webrtcChannelRef.current = supabase.channel(`webrtc-${roomId}`).on('broadcast', { event: 'signal' }, (res: any) => {
      const msg = res.payload as SignalingMessage; if (msg.to !== participantId && msg.to !== 'all') return;
      if (msg.type === 'call-start') {
        if (msg.payload?.isGroup) { if (msg.from !== participantId) setGroupCallInvite({ withVideo: msg.payload?.withVideo ?? false }); return; }
        const peer = allParticipants.find((p) => p.id === msg.from); setIncomingCall({ from: msg.from, fromNickname: peer?.nickname || 'UNKNOWN', withVideo: msg.payload?.withVideo ?? false });
      }
    }).subscribe();
    return () => { if (webrtcChannelRef.current) supabase.removeChannel(webrtcChannelRef.current); };
  }, [roomId, participantId]);

  const handleReact = async (messageId: string, emoji: string) => {
    const current = messages.find((m) => m.id === messageId); const existing = current?.reactions.find((r) => r.participant_id === participantId && r.emoji === emoji);
    if (existing) { try { await unreactSecure(messageId, participantId, participantSecret, emoji); } catch { return; } setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions: m.reactions.filter((r) => r.id !== existing.id) } : m)); return; }
    try { const data = await reactSecure(messageId, participantId, participantSecret, emoji); if (data) setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions: [...m.reactions.filter((r) => r.id !== (data as any).id), data as Reaction] } : m)); } catch {}
  };

  const handleSaveBurnConfig = async () => {
    let config = burnConfig;
    if (burnConfig.mode === 'custom' && customBurnValue) { const val = parseInt(customBurnValue, 10); if (val > 0) { const multiplier = customBurnUnit === 'seconds' ? 1 : customBurnUnit === 'minutes' ? 60 : 3600; config = createBurnConfig('custom', val * multiplier); } }
    setBurnConfig(config);
    try { await updateRoomBurnConfigSecure(roomId, participantId, participantSecret, JSON.parse(JSON.stringify(config))); } catch { setSystemMessage('FALHA AO APLICAR AUTODESTRUIÇÃO'); setTimeout(() => setSystemMessage(''), 3000); }
    setShowBurnSettings(false);
  };

  const handleVoltar = async () => { 
    await unsubscribeFromPush(participantId).catch(() => {}); 
    try { await leaveRoomSecure(participantId, participantSecret); } catch { /* Silencia o erro 400 */ } 
    onLeave(); 
  };
  const handleSairDefinitivamente = async () => {
    await unsubscribeFromPush(participantId).catch(() => {}); try { await deleteParticipantCompletelySecure(participantId, participantSecret); } catch {}
    if (!isPermanent) { const { count } = await supabase.from('participants').select(PARTICIPANT_COLUMNS.identity, { count: 'exact', head: true }).eq('room_id', roomId); if (count === 0) { const { data: mediaMsgs } = await supabase.from('messages').select('storage_path').eq('room_id', roomId).not('storage_path', 'is', null); if (mediaMsgs && mediaMsgs.length > 0) { const paths = mediaMsgs.map((m) => m.storage_path).filter(Boolean) as string[]; await supabase.storage.from('cipherline-media').remove(paths); } } }
    onLeave();
  };

  const onlineCount = onlinePeerIds.size;
  const totalParticipants = allParticipants.length;
  const burnLabel = burnConfig.mode === 'off' ? 'OFF' : burnConfig.mode === 'on_read' ? '6s' : burnConfig.mode === '24h' ? '24H' : burnConfig.mode === '7d' ? '7D' : `${burnConfig.seconds}s`;
  const typingNames = Array.from(typingPeers).map((id) => allParticipants.find((x) => x.id === id)?.nickname || '').filter(Boolean);
  const typingText = typingNames.length === 0 ? '' : typingNames.length === 1 ? `${typingNames[0]} está digitando` : typingNames.length === 2 ? `${typingNames[0]} e ${typingNames[1]} estão digitando` : `${typingNames.length} pessoas estão digitando`;
  const getDeviceIcon = (p: Participant) => p.device_id === deviceIdRef.current ? (/Mobi|Android/i.test(navigator.userAgent) ? <Smartphone size={9} className="text-cyber-cyan/40" /> : <Monitor size={9} className="text-cyber-cyan/40" />) : null;
  const unreadCount = messages.filter(m => !m.isOwn && !m.readBy.some(r => r.participant_id === participantId)).length;

  if (cryptoVersion === 2 && !rc.hasKey) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="max-w-sm font-mono text-sm leading-relaxed text-cyber-text-dim">Falta a chave desta sala neste dispositivo. Pede um novo convite a quem criou a sala.</p>
        <button onClick={onLeave} className="clip-hud-sm min-h-12 min-w-32 border border-cyber-cyan/30 bg-cyber-cyan/10 px-6 py-3 font-mono text-sm tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20">SAIR</button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {bgUrl && <ChatBackground imageUrl={bgUrl} mode={bgMode} pulseKey={pulseKey} />}
      <div className="glass clip-hud-sm relative z-20 flex items-center justify-between px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              {roomAvatarUrl ? (
                <img
                  src={roomAvatarUrl}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-full border border-cyber-green/30 object-cover glow-green"
                />
              ) : (
                <motion.span animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} className="shrink-0"><Lock size={12} className="text-cyber-green glow-green" /></motion.span>
              )}
              <span className="truncate font-mono text-sm font-bold tracking-widest text-cyber-green glow-green">{roomName || roomCode}</span>
              <span
                title={cryptoVersion === 2 ? 'Cifragem versão 2: a chave vem do segredo do convite.' : 'Cifragem versão 1: o código da sala é a chave.'}
                aria-label={cryptoVersion === 2 ? 'Cifragem versão 2: a chave vem do segredo do convite.' : 'Cifragem versão 1: o código da sala é a chave.'}
                role="note"
                className="shrink-0 font-mono text-[8px] text-cyber-text-faint"
              >
                {cryptoVersion === 2 ? 'CIFRAGEM V2' : 'CIFRAGEM V1 · LEGADO'}
              </span>
              <CopyButton text={roomCode} label="COPIAR" />
              {roomName && <span className="shrink-0 font-mono text-[9px] tracking-widest text-cyber-text-faint">{roomCode}</span>}
              {connectionStatus !== 'connected' && (
                <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity }} className={`flex shrink-0 items-center gap-1 font-mono text-[9px] tracking-widest ${connectionStatus === 'offline' ? 'text-red-400' : 'text-cyber-amber'}`}>
                  <WifiOff size={10} />{connectionStatus === 'offline' ? 'OFFLINE' : 'RECONECTANDO...'}
                </motion.span>
              )}
            </div>
            <button onClick={() => setShowParticipantPanel(true)} className="mt-0.5 flex items-center gap-1.5">
              <StatusDot online={onlineCount > 0} size={6} />
              <span className="font-mono text-[10px] tracking-widest text-cyber-text-dim">{onlineCount > 0 ? `${onlineCount + 1} CONECTADO${onlineCount + 1 > 1 ? 'S' : ''}` : 'AGUARDANDO PARTICIPANTES'}</span>
              <Users size={10} className="text-cyber-text-faint" />
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          
          <button onClick={() => { 
            if (!hasPin()) { setShowPinSetup(true); } 
            else { setIsLocked(true); localStorage.setItem(`cipherline_locked_${roomId}`, 'true'); }
          }} className="p-2 text-cyber-amber hover:text-cyber-amber/70 transition-colors" title="Bloquear Ecrã"><Lock size={18} /></button>

          <button onClick={() => setShowMenu(true)} className="p-2 text-cyber-text-dim hover:text-cyber-text transition-colors" title="Menu"><MoreVertical size={18} /></button>

          <button onClick={handleVoltar} className="flex items-center gap-1 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-green ml-1" title="Voltar ao Dashboard"><ArrowDown className="rotate-90" size={14} />VOLTAR</button>
        </div>
      </div>

      <AnimatePresence>
        {showMenu && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={() => setShowMenu(false)}>
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-0 h-full w-64 glass border-l border-cyber-border p-4 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between mb-4 border-b border-cyber-border pb-2">
                <span className="font-mono text-xs tracking-widest text-cyber-green">OPÇÕES</span>
                <button onClick={() => setShowMenu(false)} className="text-cyber-text-dim hover:text-cyber-red"><X size={16} /></button>
              </div>

              {cryptoVersion === 2 && roomSecret && (
                <button onClick={() => { setShowInvite(true); setShowMenu(false); }} className="flex min-h-11 items-center gap-3 px-3 py-2 font-mono text-xs tracking-widest text-cyber-green hover:bg-cyber-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-green/60">
                  <UserPlus size={16} aria-hidden="true" /> CONVIDAR
                </button>
              )}
              <button onClick={() => { setIsGhost(!isGhost); setShowMenu(false); }} className={`flex items-center gap-3 px-3 py-2 font-mono text-xs tracking-widest transition-colors ${isGhost ? 'text-cyber-cyan bg-cyber-cyan/10' : 'text-cyber-text-dim hover:bg-cyber-panel/50'}`}>
                {isGhost ? <EyeOff size={16} /> : <Eye size={16} />} MODO FANTASMA
              </button>
              <button onClick={() => { handleStartCall(false); setShowMenu(false); }} className="flex items-center gap-3 px-3 py-2 font-mono text-xs tracking-widest text-cyber-text-dim hover:bg-cyber-panel/50 transition-colors">
                <Phone size={16} /> CHAMADA DE VOZ
              </button>
              <button onClick={() => { handleStartCall(true); setShowMenu(false); }} className="flex items-center gap-3 px-3 py-2 font-mono text-xs tracking-widest text-cyber-text-dim hover:bg-cyber-panel/50 transition-colors">
                <Video size={16} /> CHAMADA DE VÍDEO
              </button>
              <button onClick={() => { setShowBurnSettings(true); setShowMenu(false); }} className="flex items-center gap-3 px-3 py-2 font-mono text-xs tracking-widest text-cyber-text-dim hover:bg-cyber-panel/50 transition-colors">
                <Clock size={16} /> AUTODESTRUIÇÃO ({burnLabel})
              </button>
              <button onClick={() => { setShowBgSettings(true); setShowMenu(false); }} className="flex items-center gap-3 px-3 py-2 font-mono text-xs tracking-widest text-cyber-text-dim hover:bg-cyber-panel/50 transition-colors">
                <ImageIcon size={16} /> FUNDO DE TELA
              </button>
              <button onClick={() => { setShowPaste(true); setShowMenu(false); }} className="flex items-center gap-3 px-3 py-2 font-mono text-xs tracking-widest text-cyber-text-dim hover:bg-cyber-panel/50 transition-colors">
                <FileText size={16} /> CIPHERPASTE
              </button>
              <button onClick={() => { setShowChannelSettings(true); setShowMenu(false); }} className="flex items-center gap-3 px-3 py-2 font-mono text-xs tracking-widest text-cyber-text-dim hover:bg-cyber-panel/50 transition-colors">
                <Settings size={16} /> CONFIGURAÇÕES
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{systemMessage && (<motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="z-10 flex items-center justify-center py-1"><span className="font-mono text-[10px] tracking-widest text-cyber-cyan/60">{`[ ${systemMessage} ]`}</span></motion.div>)}</AnimatePresence>

      {/* DAILY RECAP BANNER */}
      <AnimatePresence>
        {showRecapBanner && unreadCount > 10 && !isRecaping && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="z-10 flex items-center justify-center px-4 py-2 border-b border-cyber-magenta/20 bg-cyber-magenta/5">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] text-cyber-magenta tracking-widest flex items-center gap-1"><Brain size={12} /> TENS {unreadCount} MENSAGENS NÃO LIDAS.</span>
              <button onClick={handleRecap} className="clip-hud-sm border border-cyber-magenta/40 bg-cyber-magenta/20 px-3 py-1 font-mono text-[10px] tracking-widest text-cyber-magenta hover:bg-cyber-magenta/30">RESUMIR COM EIVORAK</button>
              <button onClick={() => setShowRecapBanner(false)} className="text-cyber-text-faint hover:text-cyber-red"><X size={14} /></button>
            </div>
          </motion.div>
        )}
        {isRecaping && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="z-10 flex items-center justify-center px-4 py-2 border-b border-cyber-magenta/20 bg-cyber-magenta/5">
            <span className="font-mono text-[10px] text-cyber-magenta tracking-widest animate-pulse flex items-center gap-2"><Brain size={12} /> EIVORAK ESTÁ A LER O QUE PERDESTE...</span>
          </motion.div>
        )}
      </AnimatePresence>

      {pinnedMessage && showPinnedBanner && (
        <div className="absolute top-16 left-0 right-0 z-10 mx-auto max-w-2xl px-4">
          <div className="glass clip-hud-sm border-cyber-amber/30 bg-cyber-amber/5 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Pin size={14} className="text-cyber-amber shrink-0" />
              <div className="min-w-0 truncate">
                <span className="font-mono text-[10px] text-cyber-amber mr-2">{pinnedMessage.senderNickname}:</span>
                <span className="font-mono text-xs text-cyber-text-dim truncate">{pinnedMessage.messageType === 'poll' ? 'Enquete' : pinnedMessage.plaintext}</span>
              </div>
            </div>
            <button onClick={() => setShowPinnedBanner(false)} className="text-cyber-text-dim hover:text-cyber-red shrink-0 ml-2"><X size={14} /></button>
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} onScroll={handleScroll} className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <div className="mb-4 text-center"><span className="font-mono text-[10px] tracking-widest text-cyber-text-faint"><Typewriter text={isSystemRoom ? "ESTÁS NA SALA DO EIVORAK. ELE VAI RESPONDER A TUDO." : "CANAL SEGURO ATIVO · MENSAGENS SÃO CIFRADAS PONTA-A-PONTA"} speed={20} showCursor={false} /></span></div>
          <AnimatePresence>{messages.map((msg) => (<div key={msg.id} data-msg-id={msg.id} className="rounded transition-all duration-1000"><ChatMessage message={msg} rc={rc} participantId={participantId} isOwner={isOwner} onDestroy={handleDestroy} onDeleteForMe={handleDeleteForMe} onReact={handleReact} onReply={setReplyTo} onReplyPrivate={handleReplyPrivate} onWhisper={(m) => setWhisperTo({ id: m.senderId, nickname: m.senderNickname } as Participant)} onPin={handlePinMessage} onScrollToMessage={handleScrollToMessage} onVote={handleVote} /></div>))}</AnimatePresence>
          {eivorakThinking && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex min-w-0 items-center gap-2"><span className="truncate font-mono text-xs text-cyber-magenta/70">EIVORAK ESTÁ PENSANDO</span><div className="flex shrink-0 gap-1">{[0, 1, 2].map((i) => <motion.span key={i} className="h-1 w-1 rounded-full bg-cyber-magenta" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }} />)}</div></motion.div>)}
          {typingText && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex min-w-0 items-center gap-2"><span className="truncate font-mono text-xs text-cyber-cyan/60">{typingText}</span><div className="flex shrink-0 gap-1">{[0, 1, 2].map((i) => <motion.span key={i} className="h-1 w-1 rounded-full bg-cyber-cyan" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />)}</div></motion.div>)}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <AnimatePresence>{showScrollButton && (<motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} onClick={() => { setAutoScroll(true); scrollToBottom(); }} className="absolute bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 clip-hud-sm border border-cyber-green/30 bg-cyber-bg/80 px-4 py-2 font-mono text-xs tracking-widest text-cyber-green backdrop-blur"><ArrowDown size={12} />NOVAS MENSAGENS</motion.button>)}</AnimatePresence>

      <AnimatePresence>{showAudioRecorder && (<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="z-20 px-4 pb-2"><div className="mx-auto max-w-2xl"><AudioRecorder onSend={handleSendAudio} onCancel={() => setShowAudioRecorder(false)} /></div></motion.div>)}</AnimatePresence>

      <AnimatePresence>{showImageUploader && (<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="z-20 px-4 pb-2"><div className="mx-auto max-w-2xl"><ImageUploader onSend={handleSendImage} onCancel={() => setShowImageUploader(false)} /></div></motion.div>)}</AnimatePresence>

      {uploadProgress !== null && (<div className="z-20 px-4 pb-1"><div className="mx-auto max-w-2xl"><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-cyber-cyan/60">ENVIANDO...</span><div className="h-0.5 flex-1 overflow-hidden rounded-full bg-cyber-border"><motion.div className="h-full bg-cyber-cyan" animate={{ width: `${uploadProgress}%` }} transition={{ duration: 0.2 }} /></div><span className="font-mono text-[10px] text-cyber-cyan/60">{uploadProgress}%</span></div></div></div>)}

      {replyTo && (<div className="z-20 px-4 pb-1"><div className="mx-auto max-w-2xl"><div className="flex items-center gap-2 border-l-2 border-cyber-cyan/40 bg-cyber-cyan/5 px-3 py-2"><Reply size={12} className="shrink-0 text-cyber-cyan/60" /><div className="min-w-0 flex-1"><div className="font-mono text-[10px] tracking-widest text-cyber-cyan/60">{replyTo.senderNickname}</div><div className="truncate font-mono text-xs text-cyber-text-dim">{replyTo.plaintext?.slice(0, 80) || '[mensagem]'}</div></div><button onClick={() => setReplyTo(null)} className="shrink-0 text-cyber-text-faint transition-colors hover:text-cyber-red"><XCircle size={14} /></button></div></div></div>)}

      {whisperTo && (<div className="z-20 px-4 pb-1"><div className="mx-auto max-w-2xl"><div className="flex items-center gap-2 border-l-2 border-cyber-magenta/40 bg-cyber-magenta/5 px-3 py-2"><Sparkles size={12} className="shrink-0 text-cyber-magenta/60" /><div className="min-w-0 flex-1"><div className="font-mono text-[10px] tracking-widest text-cyber-magenta/60">SUSSURRO PARA</div><div className="truncate font-mono text-xs text-cyber-magenta/80">{whisperTo.nickname}</div></div><button onClick={() => setWhisperTo(null)} className="shrink-0 text-cyber-magenta/60 transition-colors hover:text-cyber-red"><XCircle size={14} /></button></div></div></div>)}

      <div className="relative z-20 px-4 pb-4 pt-2">
        <div className="mx-auto max-w-2xl">
          <div className="glass clip-hud-sm flex items-center gap-2 px-4 py-3">
            <span className="font-mono text-cyber-green-dim">&gt;</span>
            <input ref={inputRef} type="text" name="message" aria-label="Mensagem" autoComplete="off" value={input} onChange={(e) => { setInput(e.target.value); broadcastTyping(); }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} maxLength={500} placeholder="Escreve uma mensagem…" className="min-w-0 flex-1 bg-transparent font-mono text-sm text-cyber-green placeholder-cyber-text-faint focus:outline-none" />
            <div className="relative shrink-0">
              <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setShowEivorakMenu((v) => !v)} className="text-cyber-magenta transition-colors hover:text-cyber-magenta/70" title="EiVORAK"><Sparkles size={16} /></motion.button>
              <AnimatePresence>{showEivorakMenu && (<motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute bottom-10 right-0 z-30 w-52 clip-hud-sm border border-cyber-magenta/30 bg-cyber-bg/95 p-1 backdrop-blur">{[{ label: 'RESUMIR CONVERSA', prompt: '@eivorak resume a conversa até aqui' }, { label: 'CONVIDAR PRO JOGO', prompt: '@eivorak vamos jogar ' }, { label: 'TRADUZIR', prompt: '@eivorak traduz: ' }, { label: 'TIRAR UMA DÚVIDA', prompt: '@eivorak ' }, { label: 'ANALISAR LINK', prompt: '@eivorak o que achas deste link: ' }].map((opt) => (<button key={opt.label} onClick={() => { setInput(opt.prompt); setShowEivorakMenu(false); inputRef.current?.focus(); }} className="block w-full px-3 py-2 text-left font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:bg-cyber-magenta/10 hover:text-cyber-magenta">{opt.label}</button>))}</motion.div>)}</AnimatePresence>
            </div>
            
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setShowPollCreator(true)} aria-label="Criar enquete" className="flex h-11 w-11 shrink-0 items-center justify-center text-cyber-cyan transition-colors hover:text-cyber-cyan-dim disabled:opacity-40" title="Criar Enquete"><BarChart2 size={16} /></motion.button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setShowImageUploader(true)} aria-label="Enviar imagem" className="flex h-11 w-11 shrink-0 items-center justify-center text-cyber-cyan transition-colors hover:text-cyber-cyan-dim disabled:opacity-40" title="Enviar imagem"><ImageIcon size={16} /></motion.button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setShowCapsuleComposer(true)} aria-label="Cápsula do tempo" className="flex h-11 w-11 shrink-0 items-center justify-center text-cyber-amber transition-colors hover:text-cyber-amber/70 disabled:opacity-40" title="Cápsula do tempo"><Clock size={16} /></motion.button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setShowAudioRecorder(true)} aria-label="Gravar áudio" className="flex h-11 w-11 shrink-0 items-center justify-center text-cyber-cyan transition-colors hover:text-cyber-cyan-dim disabled:opacity-40" title="Gravar áudio"><Mic size={16} /></motion.button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={handleSend} disabled={!input.trim()} className="shrink-0 text-cyber-green transition-colors hover:text-cyber-green-dim disabled:opacity-30"><Send size={16} /></motion.button>
          </div>
        </div>
      </div>

      {/* MODAL DE RECAP */}
      <AnimatePresence>{recapModalOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setRecapModalOpen(false)}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud w-full max-w-md border-cyber-magenta/30 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2"><Brain size={18} className="text-cyber-magenta" /><span className="font-mono text-sm tracking-widest text-cyber-magenta">RESUMO DO EIVORAK</span></div>
              <button onClick={() => setRecapModalOpen(false)} className="text-cyber-text-dim hover:text-cyber-red"><X size={16} /></button>
            </div>
            <p className="font-sans text-sm text-cyber-text leading-relaxed whitespace-pre-wrap">{recapText}</p>
            <button onClick={() => setRecapModalOpen(false)} className="clip-hud-sm mt-6 w-full border border-cyber-magenta/30 bg-cyber-magenta/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-magenta transition-colors hover:bg-cyber-magenta/20">ENTENDIDO</button>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>

      {/* MODAL DE CRIAR ENQUETE */}
      <AnimatePresence>{showPollCreator && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setShowPollCreator(false)}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud w-full max-w-sm border-cyber-cyan/20 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2"><BarChart2 size={16} className="text-cyber-cyan" /><span className="font-mono text-sm tracking-widest text-cyber-cyan">NOVA ENQUETE</span></div>
              <button onClick={() => setShowPollCreator(false)} className="text-cyber-text-dim hover:text-cyber-red"><X size={16} /></button>
            </div>
            <p className="mb-1 font-mono text-[10px] tracking-widest text-cyber-text-dim">PERGUNTA</p>
            <input type="text" value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} maxLength={100} placeholder="Ex: Onde vamos jantar?" className="mb-4 w-full border border-cyber-border bg-transparent px-3 py-2 font-mono text-sm text-cyber-cyan placeholder:text-cyber-text-faint focus:border-cyber-cyan/50 focus:outline-none" />
            <p className="mb-1 font-mono text-[10px] tracking-widest text-cyber-text-dim">OPÇÕES (Mín. 2)</p>
            {pollOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input type="text" value={opt} onChange={(e) => { const newOpts = [...pollOptions]; newOpts[i] = e.target.value; setPollOptions(newOpts); }} placeholder={`Opção ${i + 1}`} className="flex-1 border border-cyber-border bg-transparent px-3 py-2 font-mono text-xs text-cyber-text focus:border-cyber-cyan/50 focus:outline-none" />
                {pollOptions.length > 2 && <button onClick={() => setPollOptions(pollOptions.filter((_, idx) => idx !== i))} className="text-cyber-red hover:text-cyber-red/70 p-1"><X size={14} /></button>}
              </div>
            ))}
            <button onClick={() => setPollOptions([...pollOptions, ''])} className="mb-4 font-mono text-[10px] tracking-widest text-cyber-cyan hover:text-cyber-green">+ ADICIONAR OPÇÃO</button>
            <button onClick={handleSendPoll} disabled={!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2} className="clip-hud-sm w-full border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20 disabled:opacity-30">ENVIAR ENQUETE</button>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>
      
      <AnimatePresence>{incomingCall && !activeCall && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"><motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="glass clip-hud mx-6 max-w-sm border-cyber-green/30 p-6 text-center"><motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }} className="mx-auto mb-4">{incomingCall.withVideo ? <Video size={32} className="text-cyber-cyan" /> : <Phone size={32} className="text-cyber-green" />}</motion.div><p className="mb-1 font-mono text-sm text-cyber-green">{incomingCall.fromNickname}</p><p className="mb-6 font-mono text-xs text-cyber-text-dim">{incomingCall.withVideo ? 'CHAMADA DE VÍDEO' : 'CHAMADA DE VOZ'}</p><div className="flex gap-3"><button onClick={handleDeclineCall} className="clip-hud-sm flex-1 border border-cyber-red/30 bg-cyber-red/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-red transition-colors hover:bg-cyber-red/20">RECUSAR</button><button onClick={handleAcceptCall} className="clip-hud-sm flex-1 border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20">ACEITAR</button></div></motion.div></motion.div>)}</AnimatePresence>
      {activeCall && <Suspense fallback={null}><CallScreen roomId={roomId} roomCode={roomCode} myId={participantId} myNickname={nickname} peerId={activeCall.peerId} peerNickname={activeCall.peerNickname} withVideo={activeCall.withVideo} isInitiator={activeCall.isInitiator} onEnd={handleEndCall} /></Suspense>}
      {activeGroupCall && <Suspense fallback={null}><GroupCallScreen roomId={roomId} myId={participantId} myNickname={nickname} withVideo={activeGroupCall.withVideo} onEnd={() => setActiveGroupCall(null)} /></Suspense>}
      {groupCallInvite && !activeGroupCall && (<motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="absolute left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-3 clip-hud-sm border border-cyber-green/40 bg-cyber-bg/95 px-4 py-2 backdrop-blur"><span className="font-mono text-[10px] tracking-widest text-cyber-green">CHAMADA EM GRUPO ATIVA</span><button onClick={() => { setActiveGroupCall({ withVideo: groupCallInvite.withVideo }); setGroupCallInvite(null); }} className="clip-hud-sm border border-cyber-green/50 bg-cyber-green/10 px-3 py-1 font-mono text-[10px] tracking-widest text-cyber-green hover:bg-cyber-green/20">ENTRAR</button><button onClick={() => setGroupCallInvite(null)} className="text-cyber-text-dim hover:text-cyber-red"><X size={12} /></button></motion.div>)}
      
      <AnimatePresence>{showLeaveConfirm && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowLeaveConfirm(false)}><motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud mx-6 max-w-sm border-cyber-red/30 p-6 text-center"><AlertTriangle size={32} className="mx-auto mb-4 text-cyber-red glow-red" /><p className="mb-2 font-mono text-sm text-cyber-red">MENSAGENS NÃO DECODIFICADAS</p><p className="mb-6 font-mono text-xs text-cyber-text-dim">SERÃO PERDIDAS PERMANENTEMENTE — CONFIRMAR SAÍDA?</p><div className="flex gap-3"><button onClick={() => setShowLeaveConfirm(false)} className="clip-hud-sm flex-1 border border-cyber-text-faint/30 px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-text">CANCELAR</button><button onClick={handleSairDefinitivamente} className="clip-hud-sm flex-1 border border-cyber-red/30 bg-cyber-red/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-red transition-colors hover:bg-cyber-red/20">CONFIRMAR</button></div></motion.div></motion.div>)}</AnimatePresence>
      
      <AnimatePresence>{showBurnSettings && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowBurnSettings(false)}><motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud mx-6 max-w-sm border-cyber-green/20 p-6"><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><Settings size={16} className="text-cyber-green" /><span className="font-mono text-sm tracking-widest text-cyber-green">AUTODESTRUIÇÃO</span></div><button onClick={() => setShowBurnSettings(false)} className="text-cyber-text-dim transition-colors hover:text-cyber-red"><X size={16} /></button></div><div className="space-y-2">{BURN_OPTIONS.map((opt) => (<button key={opt.value} onClick={() => setBurnConfig(createBurnConfig(opt.value))} className={`clip-hud-sm flex w-full items-center justify-between px-4 py-3 font-mono text-xs tracking-widest transition-colors ${burnConfig.mode === opt.value ? 'border border-cyber-green/40 bg-cyber-green/10 text-cyber-green' : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'}`}>{opt.label}{burnConfig.mode === opt.value && <span className="text-cyber-green">●</span>}</button>))}<div className={`clip-hud-sm border px-4 py-3 ${burnConfig.mode === 'custom' ? 'border-cyber-cyan/40 bg-cyber-cyan/10' : 'border-cyber-border'}`}><button onClick={() => setBurnConfig(createBurnConfig('custom', 30))} className={`flex w-full items-center justify-between font-mono text-xs tracking-widest transition-colors ${burnConfig.mode === 'custom' ? 'text-cyber-cyan' : 'text-cyber-text-dim hover:text-cyber-text'}`}>PERSONALIZADO{burnConfig.mode === 'custom' && <span className="text-cyber-cyan">●</span>}</button>{burnConfig.mode === 'custom' && (<div className="mt-3 flex gap-2"><input type="number" value={customBurnValue} onChange={(e) => setCustomBurnValue(e.target.value)} placeholder="30" min="1" className="w-20 bg-transparent font-mono text-sm text-cyber-cyan placeholder-cyber-text-faint focus:outline-none" /><select value={customBurnUnit} onChange={(e) => setCustomBurnUnit(e.target.value as any)} className="bg-transparent font-mono text-xs text-cyber-cyan focus:outline-none"><option value="seconds" className="bg-cyber-panel">SEG</option><option value="minutes" className="bg-cyber-panel">MIN</option><option value="hours" className="bg-cyber-panel">HORAS</option></select></div>)}</div></div><button onClick={handleSaveBurnConfig} className="clip-hud-sm mt-4 w-full border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20">APLICAR</button></motion.div></motion.div>)}</AnimatePresence>
      
      <AnimatePresence>{showBgSettings && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => { setShowBgSettings(false); setBgStep('menu'); setPendingBgBlob(null); }}><motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud mx-6 w-full max-w-sm border-cyber-cyan/20 p-6"><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><ImageIcon size={16} className="text-cyber-cyan" /><span className="font-mono text-sm tracking-widest text-cyber-cyan">FUNDO DE TELA</span></div><button onClick={() => { setShowBgSettings(false); setBgStep('menu'); setPendingBgBlob(null); }} className="text-cyber-text-dim transition-colors hover:text-cyber-red"><X size={16} /></button></div>{bgStep === 'menu' && (<div className="space-y-2"><button onClick={() => setBgStep('upload')} className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20"><ImageIcon size={14} />{bgUrl ? 'TROCAR IMAGEM' : 'DEFINIR IMAGEM'}</button>{bgUrl && (<><button onClick={() => clearBackground('room')} disabled={bgSaving} className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-border px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red disabled:opacity-40">REMOVER DESTA SALA</button>{userId && <button onClick={() => clearBackground('global')} disabled={bgSaving} className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-border px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red disabled:opacity-40">REMOVER PADRÃO GLOBAL</button>}</>)}{!userId && <p className="pt-2 text-center font-mono text-[10px] tracking-widest text-cyber-text-faint">SEM CONTA: FUNDO VALE SÓ PARA ESTA SESSÃO</p>}</div>)}{bgStep === 'upload' && <ImageUploader onSend={(blob) => { setPendingBgBlob(blob); setBgStep('mode'); }} onCancel={() => setBgStep('menu')} />}{bgStep === 'mode' && pendingBgBlob && (<div className="space-y-3"><p className="font-mono text-[10px] tracking-widest text-cyber-text-dim">ESCOLHA O ESTILO</p>{([{ mode: 'default' as BackgroundMode, label: 'PADRÃO', desc: 'Imagem original, sem nenhum efeito' }, { mode: 'parallax' as BackgroundMode, label: 'PARALLAX REATIVO', desc: 'Move com giroscópio/mouse' }, { mode: 'reactive' as BackgroundMode, label: 'FUNDO VIVO', desc: 'Pulsa a cada mensagem' }]).map((opt) => (<button key={opt.mode} onClick={() => setPendingBgMode(opt.mode)} className={`clip-hud-sm flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left font-mono transition-colors ${pendingBgMode === opt.mode ? 'border border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan' : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'}`}><span className="text-xs tracking-widest">{opt.label}</span><span className="text-[10px] text-cyber-text-faint">{opt.desc}</span></button>))}<button onClick={() => setBgStep('scope')} className="clip-hud-sm mt-2 w-full border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20">CONTINUAR</button></div>)}{bgStep === 'scope' && pendingBgBlob && (<div className="space-y-2"><p className="font-mono text-[10px] tracking-widest text-cyber-text-dim">APLICAR ONDE?</p><button onClick={() => saveBackground(pendingBgBlob, pendingBgMode, 'room')} disabled={bgSaving} className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20 disabled:opacity-40">SÓ NESTA SALA</button>{userId && <button onClick={() => saveBackground(pendingBgBlob, pendingBgMode, 'global')} disabled={bgSaving} className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20 disabled:opacity-40">TODAS AS SALAS (PADRÃO)</button>}{bgSaving && <p className="text-center font-mono text-[10px] text-cyber-text-faint">SALVANDO...</p>}</div>)}</motion.div></motion.div>)}</AnimatePresence>
      
      <AnimatePresence>{showPaste && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setShowPaste(false)}><motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud flex h-[80vh] w-full max-w-lg flex-col border-cyber-magenta/20 p-4"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><FileText size={16} className="text-cyber-magenta" /><span className="font-mono text-sm tracking-widest text-cyber-magenta">CIPHERPASTE</span>{pasteSaving && <span className="font-mono text-[9px] text-cyber-text-faint">SALVANDO...</span>}</div><button onClick={() => setShowPaste(false)} className="text-cyber-text-dim hover:text-cyber-red"><X size={16} /></button></div><p className="mb-2 font-mono text-[9px] leading-relaxed text-cyber-text-faint">BLOCO DE NOTAS CIFRADO DA SALA — TODOS AQUI VEEM E EDITAM. SOME QUANDO A SALA FOR APAGADA.</p><textarea value={pasteContent} onChange={(e) => handlePasteChange(e.target.value)} onFocus={() => { pasteTextareaFocusedRef.current = true; }} onBlur={() => { pasteTextareaFocusedRef.current = false; }} placeholder="Cole código, texto, notas..." className="flex-1 resize-none border border-cyber-border bg-transparent px-3 py-2 font-mono text-xs text-cyber-text placeholder:text-cyber-text-faint focus:border-cyber-magenta/50 focus:outline-none" /></motion.div></motion.div>)}</AnimatePresence>
      
      <AnimatePresence>{showCapsuleComposer && <CapsuleComposer onCancel={() => setShowCapsuleComposer(false)} onSend={handleSendCapsule} />}</AnimatePresence>
      
      <AnimatePresence>{showAvatarUploader && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setShowAvatarUploader(false)}>
          <motion.div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">
            <ImageUploader onSend={handleUploadAvatar} onCancel={() => setShowAvatarUploader(false)} />
          </motion.div>
        </motion.div>
      )}</AnimatePresence>

      <AnimatePresence>{showChannelSettings && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setShowChannelSettings(false)}><motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud w-full max-w-sm border-cyber-green/20 p-5 max-h-[85vh] overflow-y-auto"><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><Settings size={16} className="text-cyber-green" /><span className="font-mono text-sm tracking-widest text-cyber-green">CONFIGURAÇÕES DO CANAL</span></div><button onClick={() => setShowChannelSettings(false)} className="text-cyber-text-dim hover:text-cyber-red"><X size={16} /></button></div>
      
      <div className="mb-4 flex flex-col items-center gap-2">
        <button onClick={() => setShowAvatarUploader(true)} className="relative h-20 w-20 overflow-hidden rounded-full border border-cyber-border bg-cyber-panel flex items-center justify-center group">
          {roomAvatarUrl ? <img src={roomAvatarUrl} className="h-full w-full object-cover" /> : <Hash size={24} className="text-cyber-text-dim" />}
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"><Camera size={20} className="text-white" /></div>
        </button>
        <p className="font-mono text-[9px] text-cyber-text-faint">TOCA PARA MUDAR O AVATAR</p>
      </div>

      <p className="mb-1 font-mono text-[10px] tracking-widest text-cyber-text-dim">NOME DO CANAL</p><input type="text" value={editRoomName} onChange={(e) => setEditRoomName(e.target.value)} maxLength={60} placeholder="Sem nome (usa o código)" className="mb-4 w-full border border-cyber-border bg-transparent px-3 py-2 font-mono text-sm text-cyber-green placeholder:text-cyber-text-faint focus:border-cyber-green/50 focus:outline-none" /><p className="mb-1 font-mono text-[10px] tracking-widest text-cyber-text-dim">CÓDIGO DE ACESSO</p><div className="mb-4 flex items-center justify-between border border-cyber-border px-3 py-2"><span className="font-mono text-sm text-cyber-text">{roomCode}</span><CopyButton text={roomCode} label="COPIAR" /></div>{userId ? (<><p className="mb-2 font-mono text-[10px] tracking-widest text-cyber-text-dim">VISIBILIDADE</p><div className="mb-4 grid grid-cols-2 gap-2"><button onClick={() => setEditIsPublic(false)} className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors ${!editIsPublic ? 'border border-cyber-green/40 bg-cyber-green/10 text-cyber-green' : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'}`}>PRIVADO</button><button onClick={() => setEditIsPublic(true)} className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors ${editIsPublic ? 'border border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan' : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'}`}>PÚBLICO</button></div><p className="mb-2 font-mono text-[10px] tracking-widest text-cyber-text-dim">SUA IDENTIDADE NESTA SALA</p><div className="mb-4 grid grid-cols-2 gap-2"><button onClick={() => setEditShowProfile(false)} className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors ${!editShowProfile ? 'border border-cyber-green/40 bg-cyber-green/10 text-cyber-green' : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'}`}>ANÔNIMO</button><button onClick={() => setEditShowProfile(true)} className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors ${editShowProfile ? 'border border-cyber-magenta/40 bg-cyber-magenta/10 text-cyber-magenta' : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'}`}>MEU PERFIL</button></div><p className="mb-4 font-mono text-[9px] leading-relaxed text-cyber-text-faint">{editShowProfile ? 'AS PESSOAS NESTA SALA VÃO VER SEU NOME E FOTO DE PERFIL, EM VEZ DO CÓDIGO ANÔNIMO' : 'VOCÊ CONTINUA ANÔNIMO NESTA SALA, MESMO LOGADO'}</p></>) : <p className="mb-4 font-mono text-[9px] leading-relaxed text-cyber-text-faint">ENTRE COM UMA CONTA PARA CONTROLAR VISIBILIDADE PÚBLICA/PRIVADA</p>}<div className="mt-6 border-t border-cyber-border pt-4"><p className="mb-2 font-mono text-[10px] tracking-widest text-cyber-text-dim">SAIR DA SALA</p><button onClick={() => { if (window.confirm('Tens a certeza? Vais sair da sala e apagar todas as tuas mensagens. Esta ação não pode ser desfeita.')) { handleSairDefinitivamente(); } }} className="clip-hud-sm w-full border border-cyber-red/30 bg-cyber-red/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-red transition-colors hover:bg-cyber-red/20">SAIR E APAGAR MENSAGENS</button></div><button onClick={saveChannelSettings} disabled={channelSettingsSaving} className="clip-hud-sm mt-4 w-full border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20 disabled:opacity-50">{channelSettingsSaving ? 'SALVANDO...' : 'SALVAR'}</button></motion.div></motion.div>)}</AnimatePresence>
      
      <AnimatePresence>{showParticipantPanel && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowParticipantPanel(false)}><motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud mx-6 max-w-sm border-cyber-cyan/20 p-6"><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><Users size={16} className="text-cyber-cyan" /><span className="font-mono text-sm tracking-widest text-cyber-cyan">PARTICIPANTES · {totalParticipants}</span></div><button onClick={() => setShowParticipantPanel(false)} className="text-cyber-text-dim hover:text-cyber-red"><X size={16} /></button></div><div className="max-h-64 space-y-2 overflow-y-auto"><div className="flex items-center gap-2 rounded border border-cyber-green/20 bg-cyber-green/5 px-3 py-2"><StatusDot online={true} size={6} /><span className="font-mono text-xs text-cyber-green">{nickname}</span><span className="font-mono text-[9px] text-cyber-text-faint">(VOCÊ)</span>{getDeviceIcon({ id: participantId, room_id: roomId, nickname, joined_at: '', last_seen: '', device_id: deviceIdRef.current })}</div>{allParticipants.filter((p) => p.id !== participantId).map((p) => { const isOnline = onlinePeerIds.has(p.id); const isSameDevice = p.device_id === deviceIdRef.current; return (<div key={p.id} className="flex items-center gap-2 rounded border border-cyber-border px-3 py-2"><StatusDot online={isOnline} size={6} /><span className="truncate font-mono text-xs text-cyber-text">{p.nickname}</span>{isSameDevice && <span className="font-mono text-[9px] text-cyber-cyan/40">OUTRO DISPOSITIVO SEU</span>}{getDeviceIcon(p)}</div>); })}{allParticipants.length <= 1 && <div className="py-4 text-center font-mono text-[10px] tracking-widest text-cyber-text-faint">AGUARDANDO PARTICIPANTES...</div>}</div></motion.div></motion.div>)}</AnimatePresence>

      <AnimatePresence>{showPinSetup && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-sm"><motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="glass clip-hud p-6 w-80 max-w-[90%] border-cyber-amber/30 text-center"><Lock size={32} className="mx-auto mb-4 text-cyber-amber" /><h3 className="font-mono text-sm text-cyber-amber mb-4">CONFIGURAR BLOQUEIO</h3><p className="font-mono text-[10px] text-cyber-text-dim mb-6 leading-relaxed">Ainda não tens um PIN. Define um PIN de 4 dígitos para bloqueares o ecrã rapidamente no futuro.</p><input type="password" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} placeholder="****" className="w-24 border border-cyber-amber/50 bg-transparent px-4 py-2 text-center font-mono text-xl tracking-[0.5em] text-cyber-amber focus:outline-none mb-6" autoFocus /><div className="flex gap-2"><button onClick={() => { setShowPinSetup(false); setNewPin(''); }} className="clip-hud-sm flex-1 border border-cyber-border py-2 font-mono text-[10px] text-cyber-text-dim hover:text-cyber-text">CANCELAR</button><button onClick={async () => { if (newPin.length === 4) { await setPin(newPin); setShowPinSetup(false); setNewPin(''); setIsLocked(true); localStorage.setItem(`cipherline_locked_${roomId}`, 'true'); } }} disabled={newPin.length !== 4} className="clip-hud-sm flex-1 border border-cyber-amber/30 bg-cyber-amber/10 py-2 font-mono text-[10px] text-cyber-amber hover:bg-cyber-amber/20 disabled:opacity-30">SALVAR E BLOQUEAR</button></div></motion.div></motion.div>)}</AnimatePresence>

      {isLocked && (
        <div className="absolute inset-0 z-[999] flex flex-col items-center justify-center bg-cyber-bg">
          <Lock size={48} className="mb-6 text-cyber-amber animate-pulse" />
          <h2 className="mb-8 font-mono text-xl tracking-widest text-cyber-amber">ECRÃ BLOQUEADO</h2>
          <input
            type="password"
            maxLength={4}
            value={pinInput}
            onChange={async (e) => {
              const val = e.target.value.replace(/\D/g, '');
              setPinInput(val);
              if (val.length === 4) {
                const isValid = await verifyPin(val);
                if (isValid) {
                  setIsLocked(false);
                  setPinInput('');
                  localStorage.removeItem(`cipherline_locked_${roomId}`);
                } else {
                  // PIN errado: limpa o input e opcionalmente vibra
                  setPinInput('');
                  vibrate([100, 50, 100]);
                }
              }
            }}
            placeholder="****"
            className="w-32 border border-cyber-amber/50 bg-transparent px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-cyber-amber focus:outline-none"
            autoFocus
          />
        </div>
      )}
      {showInvite && cryptoVersion === 2 && roomSecret && (
        <InviteSheet roomCode={roomCode} secret={roomSecret} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}
