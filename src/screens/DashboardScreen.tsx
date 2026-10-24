import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Plus, LogOut, Hash, Lock, Archive, Pin, BellOff, MessageSquare, Settings as SettingsIcon, Trash2, Users, UserPlus, X, Check, Image as ImageIcon, Eye, EyeOff, Volume2, Sparkles, Mic, Square, ChevronLeft, ChevronRight, Zap, Copy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { decryptText, encryptText } from '@/lib/crypto';
import { getImageUrl } from '@/lib/media';
import type { UserProfile, RoomMember, PublicRoom, Friend, Story, StoryView, StoryGroup } from '@/types';

interface DashboardScreenProps {
  profile: UserProfile;
  onSignOut: () => void;
  onJoinRoom: (roomCode: string, roomId: string, isPermanent: boolean) => void;
  onCreateChannel: () => void;
  onJoinByCode: (code: string) => void;
  onOpenSettings: () => void;
}

type Tab = 'recentes' | 'publicos' | 'grupos' | 'privado' | 'amigos';

interface RoomPreview {
  roomId: string; roomCode: string; roomName: string; lastMessage: string; lastMessageAt: string;
  unreadCount: number; isArchived: boolean; isPinned: boolean; isMuted: boolean; isPublic: boolean; isPrivate: boolean; topic: string | null; isOwner: boolean;
  avatarPath: string | null;
  isSystemRoom: boolean;
}

export function DashboardScreen({ profile, onJoinRoom, onCreateChannel, onJoinByCode, onOpenSettings }: DashboardScreenProps) {
  const [tab, setTab] = useState<Tab>('recentes');
  const [search, setSearch] = useState('');
  const [rooms, setRooms] = useState<RoomMember[]>([]);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [previews, setPreviews] = useState<Map<string, RoomPreview>>(new Map());
  const [archivedRooms, setArchivedRooms] = useState<RoomMember[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem('cipherline_focus') === 'true');
  const [dashboardBgUrl, setDashboardBgUrl] = useState<string | null>(null);
  const [dashBgMode, setDashBgMode] = useState<'default' | 'clean'>('default');
  const [copiedId, setCopiedId] = useState(false);

  // --- AMIGOS E STORIES ---
  const [friends, setFriends] = useState<(Friend & { profile: UserProfile })[]>([]);
  const [pendingRequests, setPendingRequests] = useState<(Friend & { profile: UserProfile })[]>([]);
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [myStories, setMyStories] = useState<Story[]>([]);
  
  // Cache de URLs assinadas para imagens
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const loadImageUrl = async (path: string | null | undefined) => {
    if (!path || imageUrls[path]) return;
    const url = await getImageUrl(path);
    if (url) setImageUrls((prev) => ({ ...prev, [path]: url }));
  };

  // Viewer
  const [activeGroup, setActiveGroup] = useState<StoryGroup | null>(null);
  const [storyIndex, setStoryIndex] = useState(0);
  const [viewersList, setViewersList] = useState<StoryView[]>([]);
  const [showViewers, setShowViewers] = useState(false);

  // Creator
  const [showStoryCreator, setShowStoryCreator] = useState(false);
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [storyText, setStoryText] = useState('');
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [storyMediaType, setStoryMediaType] = useState<'text' | 'image' | 'audio'>('text');
  const [storyBurnTrigger, setStoryBurnTrigger] = useState<'none' | 'after_first_view' | 'after_reaction'>('none');
  const [storyUnlockAt, setStoryUnlockAt] = useState<string>('');
  const [isGlitching, setIsGlitching] = useState(false);

  // Inline Audio Recorder
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Amigos Modal
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);

  // Refs usadas pelo canal realtime. O canal e' subscrito uma unica vez
  // (deps []), por isso nao pode depender de estado que muda. As refs sao
  // sincronizadas num useEffect sem deps (corre a cada render).
  const roomIdsRef = useRef<Set<string>>(new Set());
  const loadPreviewsRef = useRef<() => Promise<void>>(async () => {});
  const loadStoriesRef = useRef<() => Promise<void>>(async () => {});
  const loadMembershipRef = useRef<() => Promise<void>>(async () => {});
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadMembership();
    loadPublicRooms();
    loadFriends();
    loadStories();
    loadDashboardBg();
  }, []);

  // Realtime do dashboard.
  // Filtro por room_ids e' feito no CLIENTE (o Supabase Realtime nao suporta
  // filter "in" em postgres_changes). Sem isto, cada mensagem em QUALQUER
  // sala do mundo disparava loadPreviews() para este user.
  useEffect(() => {
    const channel = supabase.channel('dashboard-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload: any) => {
        const roomId = payload?.new?.room_id;
        if (!roomId || !roomIdsRef.current.has(roomId)) return;
        if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = setTimeout(() => {
          void loadPreviewsRef.current();
        }, 500);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stories' }, () => {
        void loadStoriesRef.current();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, (payload: any) => {
        const roomId = payload?.new?.id;
        if (!roomId || !roomIdsRef.current.has(roomId)) return;
        void loadMembershipRef.current();
      })
      .subscribe();
    return () => {
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
      channel.unsubscribe();
    };
  }, []);

  const loadDashboardBg = async () => {
    if (!profile.id) return;
    const { data } = await supabase.from('profiles').select('dashboard_bg_path, dashboard_bg_mode').eq('id', profile.id).maybeSingle();
    if (data?.dashboard_bg_path) {
      const url = await getImageUrl(data.dashboard_bg_path);
      setDashboardBgUrl(url);
      setDashBgMode((data.dashboard_bg_mode as 'default' | 'clean') || 'default');
    } else {
      setDashboardBgUrl(null);
    }
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(profile.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const toggleFocusMode = () => {
    const next = !focusMode;
    setFocusMode(next);
    localStorage.setItem('cipherline_focus', String(next));
  };

  const loadMembership = async () => {
    const { data } = await supabase.from('room_members').select(`*, rooms!inner(id, code, name, is_public, topic, is_permanent, owner_id, avatar_path, is_system_room)`).eq('user_id', profile.id);
    if (data) {
      const active = (data as any[]).filter((r) => !r.is_archived);
      const archived = (data as any[]).filter((r) => r.is_archived);
      setRooms(active as any);
      setArchivedRooms(archived as any);

      // Carregar URLs dos avatares das salas
      for (const rm of active) {
        const roomAvatar = (rm as any).rooms?.avatar_path;
        if (roomAvatar) await loadImageUrl(roomAvatar);
      }
    }
    setLoading(false);
  };

  const loadPublicRooms = async () => {
    const { data, error } = await supabase.rpc('get_public_rooms');
    if (!error && data) setPublicRooms(data as PublicRoom[]);
  };

  const loadFriends = async () => {
    const { data } = await supabase.from('friendships').select('*').or(`user_id.eq.${profile.id},friend_id.eq.${profile.id}`);
    if (data) {
      const accepted = data.filter(f => f.status === 'accepted');
      const pending = data.filter(f => f.status === 'pending' && f.friend_id === profile.id);
      const friendIds = accepted.map(f => f.user_id === profile.id ? f.friend_id : f.user_id);
      const pendingIds = pending.map(f => f.user_id);
      const allIds = [...friendIds, ...pendingIds];
      if (allIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', allIds);
        const friendsWithProfile: (Friend & { profile: UserProfile })[] = [];
        for (const f of accepted) {
          const friendId = f.user_id === profile.id ? f.friend_id : f.user_id;
          const profileFound = profiles?.find(p => p.id === friendId);
          if (profileFound) friendsWithProfile.push({ ...f, profile: profileFound });
        }
        setFriends(friendsWithProfile);

        const pendingWithProfile: (Friend & { profile: UserProfile })[] = [];
        for (const p of pending) {
          const profileFound = profiles?.find(pr => pr.id === p.user_id);
          if (profileFound) pendingWithProfile.push({ ...p, profile: profileFound });
        }
        setPendingRequests(pendingWithProfile);
      }
    }
  };

  const loadStories = async () => {
    const { data } = await supabase.from('stories').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true });
    if (data) {
      const userIds = [...new Set(data.map(s => s.user_id))];
      const { data: profiles } = await supabase.from('profiles').select('*').in('id', userIds);
      const myStoriesData = data.filter(s => s.user_id === profile.id);
      setMyStories(myStoriesData.map(s => ({ ...s, profile: profiles?.find(p => p.id === s.user_id) })));
      const others = data.filter(s => s.user_id !== profile.id);
      const groups: Record<string, StoryGroup> = {};
      others.forEach(s => {
        if (!groups[s.user_id]) {
          const profileFound = profiles?.find(p => p.id === s.user_id);
          if (!profileFound) return;
          groups[s.user_id] = { user_id: s.user_id, profile: profileFound, stories: [], has_unseen: true, is_own: false };
        }
        groups[s.user_id].stories.push(s);
      });
      setStoryGroups(Object.values(groups));

      // Carregar URLs das imagens das stories
      for (const s of data) {
        if (s.media_path) await loadImageUrl(s.media_path);
        if (s.profile?.avatar_path) await loadImageUrl(s.profile.avatar_path);
      }
    }
  };

  // --- LOGICA DO VISUALIZADOR DE STORIES ---
  useEffect(() => {
    if (!activeGroup) return;
    const currentStory = activeGroup.stories[storyIndex];
    if (!currentStory) return;
    if (!activeGroup.is_own) {
      supabase.from('story_views').upsert({ story_id: currentStory.id, viewer_id: profile.id, is_anonymous: true }, { onConflict: 'story_id, viewer_id' }).then();
    } else {
      supabase.from('story_views').select(`*, profile:profiles(*)`).eq('story_id', currentStory.id).order('created_at', { ascending: false }).then(({ data }) => setViewersList((data as StoryView[]) || []));
    }
    const timer = setTimeout(() => { handleNextStory(); }, 5000);
    return () => clearTimeout(timer);
  }, [activeGroup, storyIndex]);

  const handleNextStory = () => {
    if (!activeGroup) return;
    if (storyIndex < activeGroup.stories.length - 1) setStoryIndex(prev => prev + 1);
    else { setActiveGroup(null); loadStories(); }
  };

  const handlePrevStory = () => { if (!activeGroup) return; if (storyIndex > 0) setStoryIndex(prev => prev - 1); };

  const openStoryGroup = (group: StoryGroup) => {
    const firstStory = group.stories[0];
    if (firstStory.unlock_at && new Date(firstStory.unlock_at) > new Date()) { alert('Este story está trancado no tempo. Aguarda mais um pouco.'); return; }
    setActiveGroup(group); setStoryIndex(0);
  };

  const handleGhostReaction = async () => {
    if (!activeGroup) return;
    const currentStory = activeGroup.stories[storyIndex];
    setIsGlitching(true); setTimeout(() => setIsGlitching(false), 800);
    await supabase.from('story_reactions').insert({ story_id: currentStory.id, reactor_id: profile.id });
    if (currentStory.burn_trigger === 'after_reaction') { await supabase.from('stories').delete().eq('id', currentStory.id); handleNextStory(); }
  };

  // --- CRIADOR DE STORIES ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr; audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => { const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' }); const file = new File([blob], 'gravacao.webm', { type: 'audio/webm' }); setStoryFile(file); setStoryMediaType('audio'); };
      mr.start(); setIsRecording(true); setRecordDuration(0);
      timerRef.current = setInterval(() => setRecordDuration(d => d + 1), 1000);
    } catch { alert('Erro ao aceder ao microfone.'); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
    // ?. em stream e' necessario: se mediaRecorderRef.current for null,
    // o ?. anterior para em undefined mas .stream.getTracks() rebenta.
    mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
  };

  const handleSaveStory = async () => {
    if (!storyText.trim() && !storyFile) return;
    let mediaPath = null;
    if (storyFile) {
      const tempId = crypto.randomUUID(); const ext = storyFile.name.split('.').pop() || 'enc';
      const path = `stories/${profile.id}/${tempId}.${ext}`;
      await supabase.storage.from('cipherline-media').upload(path, storyFile); mediaPath = path;
    }
    const encrypted = storyText.trim() ? await encryptText(storyText.trim(), profile.id) : null;
    const unlockTime = storyUnlockAt ? new Date(storyUnlockAt).toISOString() : new Date().toISOString();
    if (editingStoryId) await supabase.from('stories').update({ content_encrypted: encrypted, media_path: mediaPath, media_type: storyMediaType, burn_trigger: storyBurnTrigger, unlock_at: unlockTime }).eq('id', editingStoryId);
    else await supabase.from('stories').insert({ user_id: profile.id, content_encrypted: encrypted, media_path: mediaPath, media_type: storyMediaType, burn_trigger: storyBurnTrigger, unlock_at: unlockTime });
    setShowStoryCreator(false); setStoryText(''); setStoryFile(null); setEditingStoryId(null); setStoryMediaType('text'); setStoryBurnTrigger('none'); setStoryUnlockAt(''); loadStories();
  };

  const handleDeleteStory = async (id: string) => {
    if (!window.confirm('Apagar este story?')) return;
    await supabase.from('stories').delete().eq('id', id);
    setActiveGroup(null); loadStories();
  };

  // --- OUTRAS AÇÕES ---
  const loadPreviews = useCallback(async () => {
    const allRooms = [...rooms, ...archivedRooms];
    if (allRooms.length === 0) return;
    const roomIds = allRooms.map(r => (r as any).rooms?.id).filter(Boolean);
    if (roomIds.length === 0) return;
    const { data: msgs } = await supabase.rpc('get_latest_messages_per_room', { p_room_ids: roomIds });
    const map = new Map<string, RoomPreview>();
    for (const rm of allRooms) {
      const roomData = (rm as any).rooms; if (!roomData) continue;
      const lastMsg = msgs?.find((m: any) => m.room_id === roomData.id);
      let previewText = 'sem mensagens'; let previewTime = '';
      if (lastMsg) {
        previewTime = lastMsg.created_at;
        if (lastMsg.message_type === 'text') { const plain = await decryptText(lastMsg.encrypted_content, roomData.code); previewText = plain !== '[DECRYPT_FAILED]' ? plain : '🔒 Mensagem cifrada'; }
        else if (lastMsg.message_type === 'audio') previewText = '🎤 Mensagem de voz';
        else if (lastMsg.message_type === 'image') previewText = '🖼️ Imagem';
        else if (lastMsg.message_type === 'capsule') previewText = '⏳ Cápsula do tempo';
        else if (lastMsg.message_type === 'poll') previewText = '📊 Enquete';
      }
      map.set(roomData.id, {
        roomId: roomData.id, roomCode: roomData.code, roomName: roomData.name || roomData.code,
        lastMessage: previewText, lastMessageAt: previewTime, unreadCount: 0, isArchived: rm.is_archived, isPinned: rm.is_pinned, isMuted: rm.is_muted,
        isPublic: roomData.is_public, isPrivate: !roomData.is_public, topic: roomData.topic, isOwner: roomData.owner_id === profile.id,
        avatarPath: roomData.avatar_path || null,
        isSystemRoom: roomData.is_system_room || false,
      });
    }
    setPreviews(map);
  }, [rooms, archivedRooms, profile.id]);

  useEffect(() => { loadPreviews(); }, [loadPreviews]);

  // Sincroniza refs do realtime com as versoes mais recentes das funcoes/estado.
  // Sem dependency array: corre a cada render (barato, sem setState). Isto
  // garante que o handler do canal (que tem deps []) usa sempre a ultima versao.
  useEffect(() => {
    roomIdsRef.current = new Set(
      [...rooms, ...archivedRooms].map((r) => (r as any).rooms?.id).filter(Boolean),
    );
    loadPreviewsRef.current = loadPreviews;
    loadStoriesRef.current = loadStories;
    loadMembershipRef.current = loadMembership;
  });

  const handleSearchFriend = async () => {
    if (!friendSearch.trim()) return;
    const { data } = await supabase.rpc('find_user_for_friend', { p_search: friendSearch.trim() });
    if (data) setSearchResults(data as UserProfile[]);
  };
  const handleAddFriend = async (friendId: string) => {
    try {
      // Evita duplicados: verifica se ja existe pedido/amizade em qualquer direcao
      const { data: existing } = await supabase
        .from('friendships')
        .select('id')
        .or(`and(user_id.eq.${profile.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${profile.id})`)
        .maybeSingle();
      if (existing) {
        alert('Ja existe um pedido ou amizade com este utilizador.');
        return;
      }
      const { error } = await supabase
        .from('friendships')
        .insert({ user_id: profile.id, friend_id: friendId, status: 'pending' });
      if (error) {
        alert('Falha ao adicionar amigo.');
        return;
      }
      setShowAddFriend(false);
      setFriendSearch('');
      setSearchResults([]);
      loadFriends();
    } catch {
      alert('Falha ao adicionar amigo.');
    }
  };
  const handleAcceptFriend = async (id: string) => { await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id); loadFriends(); };
  const handleMessageFriend = async (friendId: string) => { const { data } = await supabase.rpc('find_or_create_dm', { p_other_user_id: friendId }); if (data && data.length > 0) onJoinRoom(data[0].room_code, data[0].room_id, true); };
  const handleJoinPublic = async (room: PublicRoom) => {
    try {
      await supabase
        .from('room_members')
        .upsert({ room_id: room.id, user_id: profile.id, role: 'member' }, { onConflict: 'room_id, user_id' });
      // PublicRoom (RPC get_public_rooms) nao inclui is_permanent.
      // Sem isto, salas publicas temporarias ficavam marcadas como
      // permanentes no cliente e o media nunca era apagado ao sair.
      const { data } = await supabase.rpc('find_room_by_code', { p_code: room.code });
      const isPermanent = (data as any)?.[0]?.is_permanent ?? false;
      onJoinRoom(room.code, room.id, isPermanent);
    } catch {
      alert('Falha ao entrar na sala. Tenta novamente.');
    }
  };
  const handleJoinExisting = (rm: RoomMember) => { const r = (rm as any).rooms; if (r) onJoinRoom(r.code, r.id, r.is_permanent); };

  const handleArchive = async (id: string) => {
    if (isSystemRoom(id)) return;
    await supabase.from('room_members').update({ is_archived: true }).eq('room_id', id).eq('user_id', profile.id);
    loadMembership();
  };
  const handleUnarchive = async (id: string) => { await supabase.from('room_members').update({ is_archived: false }).eq('room_id', id).eq('user_id', profile.id); loadMembership(); setShowArchived(false); };
  const handlePin = async (id: string) => { const r = rooms.find(x => (x as any).rooms?.id === id); await supabase.from('room_members').update({ is_pinned: !r?.is_pinned }).eq('room_id', id).eq('user_id', profile.id); loadMembership(); };
  const handleMute = async (id: string) => { const r = rooms.find(x => (x as any).rooms?.id === id); await supabase.from('room_members').update({ is_muted: !r?.is_muted }).eq('room_id', id).eq('user_id', profile.id); loadMembership(); };

  const isSystemRoom = (roomId: string): boolean => {
    const rm = rooms.find(x => (x as any).rooms?.id === roomId);
    return !!(rm as any)?.rooms?.is_system_room;
  };

  const handleLeaveGroup = async (id: string) => {
    if (isSystemRoom(id)) return;
    if (!window.confirm('Sair do grupo?')) return;
    await supabase.from('room_members').delete().eq('room_id', id).eq('user_id', profile.id);
    loadMembership();
  };
  const handleDeleteRoom = async (id: string) => {
    if (isSystemRoom(id)) return;
    if (!window.confirm('Eliminar grupo permanentemente?')) return;
    try { await supabase.rpc('delete_room_secure', { p_room_id: id }); loadMembership(); } catch { alert('Apenas o criador pode eliminar.'); }
  };
  const handleJoinByCode = () => { if (joinCode.trim()) { onJoinByCode(joinCode.trim().toUpperCase()); setJoinCode(''); setShowJoinCode(false); } };

  const handleOpenEivorak = () => {
    const eivorakRoom = rooms.find(r => (r as any).rooms?.is_system_room);
    if (eivorakRoom) {
      handleJoinExisting(eivorakRoom);
    } else {
      alert('Sala do EiVORAK não encontrada. Tenta novamente em instantes.');
    }
  };

  const filteredRooms = rooms.filter((rm) => {
    const r = (rm as any).rooms; 
    if (!r) return false; 
    
    // Esconder a sala de sistema do EiVORAK da lista (ela terá um botão dedicado)
    if (r.is_system_room) return false;
    
    const q = search.toLowerCase();
    if (q && !r.code.toLowerCase().includes(q) && !(r.topic || '').toLowerCase().includes(q)) return false;
    if (tab === 'recentes') return true; 
    if (tab === 'grupos') return !r.is_public; 
    return true;
  }).sort((a, b) => {
    const aPin = a.is_pinned ? 1 : 0, bPin = b.is_pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    // Fallback '0' em vez de '': strings vazias ordenam ANTES de datas
    // (''.localeCompare('2026-08-31') = -1), o que colocava salas sem
    // mensagens no topo do "recentes".
    const aTime = previews.get((a as any).rooms?.id)?.lastMessageAt || '0';
    const bTime = previews.get((b as any).rooms?.id)?.lastMessageAt || '0';
    return bTime.localeCompare(aTime);
  });

  const filteredPublic = publicRooms.filter((r) => {
    const q = search.toLowerCase(); if (!q) return true;
    return r.code.toLowerCase().includes(q) || (r.topic || '').toLowerCase().includes(q);
  });

  const relativeTime = (iso: string) => {
    if (!iso) return ''; const diff = Date.now() - new Date(iso).getTime(); const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora'; if (min < 60) return `${min}min`; const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`; const d = Math.floor(h / 24); return d === 1 ? 'ontem' : d < 7 ? `${d}d` : new Date(iso).toLocaleDateString('pt-BR');
  };

  return (
    <div className={`relative flex h-full flex-col bg-cyber-bg transition-all duration-500 ${isGlitching ? 'invert hue-rotate-180 scale-105' : ''} ${focusMode ? 'grayscale-[50%]' : ''}`}>

      {/* BACKGROUND DO DASHBOARD */}
      {dashboardBgUrl && (
        <>
          <div className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${dashboardBgUrl})`, opacity: dashBgMode === 'clean' ? 1 : 0.4 }} />
          {dashBgMode !== 'clean' && <div className="absolute inset-0 z-0 bg-cyber-bg/60 backdrop-blur-sm" />}
        </>
      )}

      {/* HEADER */}
      <div className="glass clip-hud-sm relative z-20 flex items-center justify-between px-4 py-3">
        <div className="flex flex-col">
          <span className="font-mono text-sm font-bold tracking-widest text-cyber-green glow-green">CIPHERLINE</span>
          <button onClick={handleCopyId} className="flex items-center gap-1 mt-0.5 text-cyber-text-faint hover:text-cyber-cyan transition-colors">
            <span className="font-mono text-[9px] tracking-widest">{profile.nickname}</span>
            {copiedId ? <Check size={10} className="text-cyber-green" /> : <Copy size={10} />}
          </button>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={toggleFocusMode} className={`transition-colors ${focusMode ? 'text-cyber-amber glow-amber' : 'text-cyber-text-dim hover:text-cyber-amber'}`} title="Focus Mode"><Zap size={16} /></button>
          <button onClick={onOpenSettings} className="text-cyber-text-dim hover:text-cyber-cyan" title="Definições"><SettingsIcon size={16} /></button>
          <button onClick={() => setShowArchived(true)} className="text-cyber-text-dim hover:text-cyber-cyan" title="Arquivadas"><Archive size={16} /></button>
        </div>
      </div>

      {/* STORIES BAR */}
      <div className={`relative z-10 px-4 py-3 border-b border-cyber-border/50 ${focusMode ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-hide">
          <button onClick={() => { setEditingStoryId(null); setShowStoryCreator(true); }} className="flex flex-col items-center gap-1.5 shrink-0 group">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-cyber-cyan/50 bg-cyber-panel/50 transition-all group-hover:border-cyber-cyan group-hover:bg-cyber-cyan/10">
              <Plus size={20} className="text-cyber-cyan" />
            </div>
            <span className="font-mono text-[9px] tracking-widest text-cyber-cyan">O TEU</span>
          </button>

          {myStories.length > 0 && (
            <button onClick={() => openStoryGroup({ user_id: profile.id, profile, stories: myStories, has_unseen: false, is_own: true })} className="flex flex-col items-center gap-1.5 shrink-0 group">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-cyber-green bg-cyber-panel p-0.5 shadow-[0_0_15px_rgba(0,255,157,0.3)]">
                <div className="h-full w-full rounded-full overflow-hidden bg-cyber-bg flex items-center justify-center">
                  {myStories[0].media_type === 'image' && myStories[0].media_path ? <img src={imageUrls[myStories[0].media_path] || ''} className="h-full w-full object-cover" /> : <span className="font-mono text-xs text-cyber-green">EU</span>}
                </div>
              </div>
              <span className="font-mono text-[9px] tracking-widest text-cyber-green">VER</span>
            </button>
          )}

          {storyGroups.map(group => (
            <button key={group.user_id} onClick={() => openStoryGroup(group)} className="flex flex-col items-center gap-1.5 shrink-0 group">
              <div className={`relative flex h-14 w-14 items-center justify-center rounded-full border-2 ${group.has_unseen ? 'border-cyber-magenta shadow-[0_0_15px_rgba(255,0,255,0.3)]' : 'border-cyber-border'} bg-cyber-panel p-0.5 transition-all group-hover:scale-105`}>
                <div className="h-full w-full rounded-full overflow-hidden bg-cyber-bg flex items-center justify-center">
                  {group.profile.avatar_path ? <img src={imageUrls[group.profile.avatar_path] || ''} className="h-full w-full object-cover" /> : <span className="font-mono text-xs text-cyber-text-dim">{group.profile.nickname.slice(0, 2).toUpperCase()}</span>}
                </div>
              </div>
              <span className="font-mono text-[9px] tracking-widest text-cyber-text-dim truncate max-w-[60px]">{group.profile.nickname}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={`relative z-10 px-4 py-3 ${focusMode ? 'opacity-50' : ''}`}>
        <div className="glass clip-hud-sm flex items-center gap-2 px-4 py-2.5">
          <Search size={14} className="text-cyber-text-faint" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="buscar canais e conversas..." className="min-w-0 flex-1 bg-transparent font-mono text-sm text-cyber-green placeholder-cyber-text-faint focus:outline-none" />
        </div>
      </div>

      <div className={`relative z-10 flex gap-1 px-4 mb-2 overflow-x-auto scrollbar-hide ${focusMode ? 'opacity-50' : ''}`}>
        {(['recentes', 'publicos', 'grupos', 'privado', 'amigos'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors shrink-0 ${tab === t ? 'border border-cyber-green/30 bg-cyber-green/10 text-cyber-green' : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'}`}>{t.toUpperCase()}</button>
        ))}
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 pb-24">
          {loading && <div className="py-8 text-center font-mono text-xs text-cyber-text-faint">CARREGANDO...</div>}

          {!loading && tab === 'amigos' && (
            <div className="space-y-4">
              {pendingRequests.length > 0 && (
                <div className="space-y-2">
                  <p className="font-mono text-[10px] tracking-widest text-cyber-amber">PEDIDOS PENDENTES</p>
                  {pendingRequests.map(req => (
                    <div key={req.id} className="glass clip-hud-sm p-3 flex items-center justify-between border-cyber-amber/30">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-cyber-panel flex items-center justify-center border border-cyber-border">
                          {req.profile.avatar_path ? <img src={imageUrls[req.profile.avatar_path] || ''} className="h-full w-full rounded-full object-cover" /> : <Users size={16} className="text-cyber-text-dim" />}
                        </div>
                        <div><p className="font-mono text-sm text-cyber-text">{req.profile.display_name || req.profile.nickname}</p></div>
                      </div>
                      <button onClick={() => handleAcceptFriend(req.id)} className="clip-hud-sm border border-cyber-green/30 bg-cyber-green/10 px-3 py-1.5 font-mono text-[10px] text-cyber-green hover:bg-cyber-green/20">ACEITAR</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] tracking-widest text-cyber-text-dim">A TUA LISTA ({friends.length})</p>
                <button onClick={() => setShowAddFriend(true)} className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-cyber-cyan hover:text-cyber-green"><UserPlus size={12} /> ADICIONAR</button>
              </div>
              {friends.map(f => (
                <div key={f.id} className="glass clip-hud-sm p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-cyber-panel flex items-center justify-center border border-cyber-border overflow-hidden">
                      {f.profile.avatar_path ? <img src={imageUrls[f.profile.avatar_path] || ''} className="h-full w-full object-cover" /> : <span className="font-mono text-xs text-cyber-text-dim">{f.profile.nickname.slice(0, 2).toUpperCase()}</span>}
                    </div>
                    <div><p className="font-mono text-sm text-cyber-text">{f.profile.display_name || f.profile.nickname}</p></div>
                  </div>
                  <button onClick={() => handleMessageFriend(f.profile.id)} className="clip-hud-sm border border-cyber-cyan/30 bg-cyber-cyan/10 px-3 py-1.5 font-mono text-[10px] text-cyber-cyan hover:bg-cyber-cyan/20 flex items-center gap-1"><MessageSquare size={12} /> MENSAGEM</button>
                </div>
              ))}
            </div>
          )}

          {!loading && tab === 'publicos' && filteredPublic.length === 0 && <EmptyState text="NENHUM CANAL PÚBLICO ENCONTRADO" />}
          {!loading && tab !== 'publicos' && tab !== 'amigos' && filteredRooms.length === 0 && <EmptyState text="NENHUMA CONVERSA AINDA" />}

          {tab === 'publicos' && filteredPublic.map((room) => (
            <RoomItem key={room.id} name={room.code} topic={room.topic || ''} lastMessage={`${room.member_count} membros`} timestamp={relativeTime(room.created_at)} unreadCount={0} isPublic onClick={() => handleJoinPublic(room)} />
          ))}

          {tab !== 'publicos' && tab !== 'amigos' && filteredRooms.map((rm) => {
            const roomData = (rm as any).rooms; if (!roomData) return null; const preview = previews.get(roomData.id);
            return (
              <RoomItem key={rm.id} name={roomData.name || roomData.code} topic={roomData.topic || ''} lastMessage={preview?.lastMessage || 'sem mensagens'} timestamp={relativeTime(preview?.lastMessageAt || roomData.created_at)} unreadCount={preview?.unreadCount || 0} isPinned={rm.is_pinned} isMuted={rm.is_muted} isPublic={roomData.is_public} isOwner={preview?.isOwner || false} isSystemRoom={preview?.isSystemRoom || false} avatarUrl={roomData.avatar_path ? imageUrls[roomData.avatar_path] : null} onClick={() => handleJoinExisting(rm)} onArchive={() => handleArchive(roomData.id)} onPin={() => handlePin(roomData.id)} onMute={() => handleMute(roomData.id)} onLeave={() => handleLeaveGroup(roomData.id)} onDelete={() => handleDeleteRoom(roomData.id)} />
            );
          })}
        </div>
      </div>

      {/* Botão Flutuante do EiVORAK */}
      <motion.button 
        whileHover={{ scale: 1.1 }} 
        whileTap={{ scale: 0.9 }} 
        onClick={handleOpenEivorak} 
        className="absolute bottom-6 right-24 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-cyber-magenta/50 bg-cyber-bg/80 backdrop-blur text-cyber-magenta shadow-[0_0_20px_rgba(255,0,255,0.2)] transition-colors hover:bg-cyber-magenta/20"
        title="Falar com o EiVORAK"
      >
        <Sparkles size={24} />
      </motion.button>

      {/* Botão Flutuante de Criar Canal */}
      <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setShowCreate(true)} className="absolute bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-cyber-green/30 bg-cyber-bg/80 backdrop-blur text-cyber-green shadow-[0_0_20px_rgba(0,255,65,0.15)] transition-colors hover:bg-cyber-green/20" title="Criar Canal"><Plus size={24} /></motion.button>

      {/* MODAIS (Mantidos: Story Creator, Story Viewer, Add Friend, Create, Join, Archived) */}
      <AnimatePresence>{showStoryCreator && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => { setShowStoryCreator(false); stopRecording(); }}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud mx-6 w-full max-w-sm border-cyber-cyan/20 p-6 overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-sm tracking-widest text-cyber-cyan">{editingStoryId ? 'EDITAR STORY' : 'CRIAR STORY'}</span>
              <button onClick={() => { setShowStoryCreator(false); stopRecording(); }} className="text-cyber-text-dim hover:text-cyber-red"><X size={16} /></button>
            </div>
            <textarea value={storyText} onChange={e => setStoryText(e.target.value)} placeholder="O que estás a pensar?" rows={3} className="w-full bg-transparent border border-cyber-border px-3 py-2 font-mono text-sm text-cyber-text placeholder:text-cyber-text-faint focus:border-cyber-cyan/50 focus:outline-none mb-3" />
            {!isRecording ? (
              <div className="flex flex-wrap gap-2 mb-4">
                <label className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-cyber-text-dim cursor-pointer hover:text-cyber-cyan border border-cyber-border px-2 py-1">
                  <ImageIcon size={12} /> Imagem
                  <input type="file" accept="image/*" className="hidden" onChange={e => { setStoryFile(e.target.files?.[0] || null); setStoryMediaType('image'); }} />
                </label>
                <button onClick={startRecording} className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-cyber-text-dim hover:text-cyber-cyan border border-cyber-border px-2 py-1">
                  <Mic size={12} /> Gravar Áudio
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 mb-4 bg-cyber-red/10 border border-cyber-red/30 p-2">
                <div className="h-3 w-3 rounded-full bg-cyber-red animate-pulse" />
                <span className="font-mono text-xs text-cyber-red">A GRAVAR... {recordDuration}s</span>
                <button onClick={stopRecording} className="ml-auto text-cyber-red hover:text-white"><Square size={16} /></button>
              </div>
            )}
            {storyFile && <p className="font-mono text-[9px] text-cyber-cyan truncate mb-2">Anexo: {storyFile.name}</p>}
            <div className="space-y-2 mb-4">
              <div>
                <p className="font-mono text-[10px] text-cyber-text-dim mb-1">QUEIMAR STORY</p>
                <select value={storyBurnTrigger} onChange={e => setStoryBurnTrigger(e.target.value as any)} className="w-full bg-cyber-bg border border-cyber-border px-2 py-1 font-mono text-xs text-cyber-text focus:outline-none">
                  <option value="none">Nunca (Dura 24h)</option>
                  <option value="after_first_view">Após 1ª visualização</option>
                  <option value="after_reaction">Após uma reação</option>
                </select>
              </div>
              <div>
                <p className="font-mono text-[10px] text-cyber-text-dim mb-1">DESBLOQUEAR EM (OPCIONAL)</p>
                <input type="datetime-local" value={storyUnlockAt} onChange={e => setStoryUnlockAt(e.target.value)} className="w-full bg-cyber-bg border border-cyber-border px-2 py-1 font-mono text-xs text-cyber-text focus:outline-none" />
              </div>
            </div>
            <button onClick={handleSaveStory} disabled={!storyText.trim() && !storyFile} className="clip-hud-sm w-full border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20 disabled:opacity-30">{editingStoryId ? 'GUARDAR ALTERAÇÕES' : 'PUBLICAR'}</button>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>

      <AnimatePresence>{activeGroup && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-md">
          <div className="flex gap-1 px-4 pt-4 w-full">
            {activeGroup.stories.map((_, i) => (
              <div key={i} className="h-1 flex-1 bg-white/20 rounded-full overflow-hidden">
                {i === storyIndex && <motion.div className="h-full bg-white" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 5, ease: 'linear' }} />}
                {i < storyIndex && <div className="h-full bg-white" />}
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center p-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full overflow-hidden bg-cyber-panel border border-cyber-border">
                {activeGroup.profile?.avatar_path && <img src={imageUrls[activeGroup.profile.avatar_path] || ''} className="h-full w-full object-cover" />}
              </div>
              <span className="font-mono text-sm text-white">{activeGroup.profile?.nickname}</span>
              <span className="font-mono text-[10px] text-white/50">{relativeTime(activeGroup.stories[storyIndex].created_at)}</span>
            </div>
            <div className="flex items-center gap-3">
              {activeGroup.is_own && (
                <>
                  <button onClick={() => handleDeleteStory(activeGroup.stories[storyIndex].id)} className="text-white/70 hover:text-red-500"><Trash2 size={18} /></button>
                  {showViewers ? <button onClick={() => setShowViewers(false)} className="text-white/70 hover:text-white"><EyeOff size={18} /></button> : <button onClick={() => setShowViewers(true)} className="text-white/70 hover:text-white flex items-center gap-1 font-mono text-xs"><Eye size={18} /> {viewersList.length}</button>}
                </>
              )}
              <button onClick={() => setActiveGroup(null)} className="text-white/70 hover:text-white"><X size={20} /></button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 relative group" onClick={() => { if(!showViewers) handleNextStory(); }}>
            <button onClick={(e) => { e.stopPropagation(); handlePrevStory(); }} className={`absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full text-white transition-opacity ${storyIndex === 0 ? 'opacity-0' : 'opacity-100 hover:bg-black/80'}`}><ChevronLeft size={24} /></button>
            <button onClick={(e) => { e.stopPropagation(); handleNextStory(); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full text-white transition-opacity opacity-100 hover:bg-black/80"><ChevronRight size={24} /></button>
            <div className="relative max-w-md w-full flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
              {activeGroup.stories[storyIndex].media_type === 'audio' && activeGroup.stories[storyIndex].media_path && (
                 <div className="w-full max-w-sm p-6 glass clip-hud-sm border-cyber-cyan/30 flex flex-col items-center gap-4">
                   <Volume2 size={40} className="text-cyber-cyan animate-pulse" />
                   <audio src={imageUrls[activeGroup.stories[storyIndex].media_path] || ''} controls className="w-full" autoPlay />
                 </div>
              )}
              {activeGroup.stories[storyIndex].media_type === 'image' && activeGroup.stories[storyIndex].media_path && <img src={imageUrls[activeGroup.stories[storyIndex].media_path] || ''} alt="" className="w-full rounded-lg object-contain max-h-[60vh]" />}
              {activeGroup.stories[storyIndex].content_encrypted && (
                <div className={`${activeGroup.stories[storyIndex].media_path ? 'mt-4' : 'py-12 text-center'}`}><p className="font-sans text-xl text-white drop-shadow-md">{activeGroup.stories[storyIndex].content_encrypted}</p></div>
              )}
              {!activeGroup.is_own && (
                <button onClick={(e) => { e.stopPropagation(); handleGhostReaction(); }} className="mt-8 flex items-center gap-2 px-4 py-2 border border-cyber-magenta/40 bg-cyber-magenta/10 text-cyber-magenta font-mono text-xs tracking-widest hover:bg-cyber-magenta/20 transition-all">
                  <Sparkles size={14} /> REAÇÃO FANTASMA
                </button>
              )}
            </div>
          </div>
          {showViewers && activeGroup.is_own && (
            <div className="absolute bottom-0 left-0 right-0 glass border-t border-cyber-border p-4 rounded-t-2xl bg-cyber-bg/95 backdrop-blur-xl max-h-[40vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-sm text-cyber-text tracking-widest flex items-center gap-2"><Eye size={16} /> VISUALIZAÇÕES ({viewersList.length})</span>
              </div>
              <div className="space-y-2">
                {viewersList.length === 0 && <p className="font-mono text-xs text-cyber-text-dim">Ninguém viu ainda.</p>}
                {viewersList.map(v => (
                  <div key={v.id} className="flex items-center gap-2 text-sm font-mono text-cyber-text">
                    {v.is_anonymous ? <EyeOff size={12} className="text-cyber-text-faint" /> : <Eye size={12} className="text-cyber-green" />}
                    <span>{v.is_anonymous ? 'Anónimo' : v.profile?.nickname}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}</AnimatePresence>

      <AnimatePresence>{showAddFriend && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowAddFriend(false)}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud mx-6 w-full max-w-sm border-cyber-green/20 p-6">
            <div className="flex items-center justify-between mb-4"><span className="font-mono text-sm tracking-widest text-cyber-green">ADICIONAR AMIGO</span><button onClick={() => setShowAddFriend(false)} className="text-cyber-text-dim hover:text-cyber-red"><X size={16} /></button></div>
            <div className="flex gap-2 mb-4">
              <input type="text" value={friendSearch} onChange={e => setFriendSearch(e.target.value)} placeholder="ID ou Nickname" className="flex-1 bg-transparent border border-cyber-border px-3 py-2 font-mono text-sm text-cyber-green focus:border-cyber-green/50 focus:outline-none" />
              <button onClick={handleSearchFriend} className="clip-hud-sm border border-cyber-green/30 bg-cyber-green/10 px-4 py-2 font-mono text-xs text-cyber-green hover:bg-cyber-green/20"><Search size={14} /></button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {searchResults.map(u => (
                <div key={u.id} className="flex items-center justify-between p-2 border border-cyber-border bg-cyber-panel/50">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-cyber-bg flex items-center justify-center border border-cyber-border">
                      {u.avatar_path ? <img src={imageUrls[u.avatar_path] || ''} className="h-full w-full rounded-full object-cover" /> : <Users size={14} className="text-cyber-text-dim" />}
                    </div>
                    <div><p className="font-mono text-xs text-cyber-text">{u.display_name || u.nickname}</p></div>
                  </div>
                  <button onClick={() => handleAddFriend(u.id)} className="font-mono text-[10px] text-cyber-cyan hover:text-cyber-green flex items-center gap-1"><UserPlus size={12} /> ADD</button>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>

      <AnimatePresence>{showCreate && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowCreate(false)}><motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud mx-6 max-w-sm border-cyber-green/20 p-6"><p className="mb-4 font-mono text-sm tracking-widest text-cyber-green">NOVO CANAL</p><div className="space-y-2"><button onClick={() => { setShowCreate(false); onCreateChannel(); }} className="clip-hud-sm flex w-full items-center gap-3 border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20"><Hash size={16} />CRIAR CANAL</button><button onClick={() => { setShowCreate(false); setShowJoinCode(true); }} className="clip-hud-sm flex w-full items-center gap-3 border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20"><Lock size={16} />ENTRAR COM CÓDIGO</button></div><button onClick={() => setShowCreate(false)} className="mt-4 block w-full text-center font-mono text-[10px] tracking-widest text-cyber-text-faint transition-colors hover:text-cyber-red">CANCELAR</button></motion.div></motion.div>)}</AnimatePresence>

      <AnimatePresence>{showJoinCode && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowJoinCode(false)}><motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud mx-6 max-w-sm border-cyber-cyan/20 p-6"><p className="mb-4 font-mono text-sm tracking-widest text-cyber-cyan">ENTRAR COM CÓDIGO</p><input type="text" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="CÓDIGO DO CANAL" maxLength={12} className="mb-4 w-full bg-transparent font-mono text-lg text-cyber-green placeholder-cyber-text-faint focus:outline-none" /><div className="flex gap-3"><button onClick={() => setShowJoinCode(false)} className="clip-hud-sm flex-1 border border-cyber-text-faint/30 px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-text">CANCELAR</button><button onClick={handleJoinByCode} className="clip-hud-sm flex-1 border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20">ENTRAR</button></div></motion.div></motion.div>)}</AnimatePresence>

      <AnimatePresence>{showArchived && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowArchived(false)}><motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="glass clip-hud mx-6 max-w-sm max-h-[80vh] overflow-y-auto border-cyber-text-faint/20 p-6"><p className="mb-4 font-mono text-sm tracking-widest text-cyber-text-dim">ARQUIVADAS</p>{archivedRooms.length === 0 ? (<p className="py-4 text-center font-mono text-[10px] tracking-widest text-cyber-text-faint">NENHUMA CONVERSA ARQUIVADA</p>) : (<div className="space-y-2">{archivedRooms.map((rm) => { const roomData = (rm as any).rooms; if (!roomData) return null; return (<div key={rm.id} className="flex items-center gap-2"><span className="flex-1 truncate font-mono text-xs text-cyber-text-dim">{roomData.name || roomData.code}</span><button onClick={() => handleUnarchive(roomData.id)} className="font-mono text-[10px] tracking-widest text-cyber-cyan transition-colors hover:text-cyber-green">DESARQUIVAR</button></div>); })}</div>)}<button onClick={() => setShowArchived(false)} className="mt-4 block w-full text-center font-mono text-[10px] tracking-widest text-cyber-text-faint transition-colors hover:text-cyber-red">FECHAR</button></motion.div></motion.div>)}</AnimatePresence>
    </div>
  );
}

function RoomItem(props: any) {
  const [showActions, setShowActions] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleLongPressStart = () => { const t = setTimeout(() => setShowActions(true), 500); setLongPressTimer(t); };
  const handleLongPressEnd = () => { if (longPressTimer) { clearTimeout(longPressTimer); setLongPressTimer(null); } };

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative">
      <div onClick={props.onClick} onContextMenu={(e) => { e.preventDefault(); setShowActions(!showActions); }} onTouchStart={handleLongPressStart} onTouchEnd={handleLongPressEnd} className="clip-hud-sm flex cursor-pointer items-center gap-3 border border-cyber-border bg-cyber-panel/40 px-5 py-4 transition-all hover:border-cyber-green/30 hover:bg-cyber-panel/60">
        <div className="shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-cyber-bg border border-cyber-border overflow-hidden">
          {props.avatarUrl ? (
            <img src={props.avatarUrl} alt="avatar" className="h-full w-full object-cover" />
          ) : props.isPublic ? (
            <Hash size={20} className="text-cyber-cyan" />
          ) : (
            <Lock size={20} className="text-cyber-green" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="truncate font-mono text-sm font-bold text-cyber-text">{props.name}</span>
            {props.isPinned && <Pin size={12} className="shrink-0 text-cyber-amber" />}
            {props.isMuted && <BellOff size={12} className="shrink-0 text-cyber-text-faint" />}
          </div>
          <p className="truncate font-sans text-xs text-cyber-text-dim leading-relaxed">{props.topic || props.lastMessage}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="font-mono text-[10px] text-cyber-text-faint">{props.timestamp}</span>
          {props.unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-cyber-green/20 px-2 font-mono text-[10px] font-bold text-cyber-green">{props.unreadCount}</span>}
        </div>
      </div>

      <AnimatePresence>
        {showActions && (
          <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="absolute right-2 top-2 z-20 flex flex-col gap-1 rounded-lg border border-cyber-green/20 bg-cyber-bg/95 p-2 backdrop-blur shadow-xl">
            <button onClick={() => { props.onPin(); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-amber"><Pin size={12} /> FIXAR</button>
            <button onClick={() => { props.onMute(); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-cyan"><BellOff size={12} /> SILENCIAR</button>
            {!props.isSystemRoom && (
              <button onClick={() => { props.onArchive(); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-text"><Archive size={12} /> ARQUIVAR</button>
            )}

            {!props.isSystemRoom && (
              props.isOwner ? (
                <button onClick={() => { props.onDelete(); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-red transition-colors hover:bg-cyber-red/10"><Trash2 size={12} /> ELIMINAR GRUPO</button>
              ) : (
                <button onClick={() => { props.onLeave(); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red"><LogOut size={12} /> SAIR</button>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-12 text-center">
      <MessageSquare size={32} className="mx-auto mb-3 text-cyber-text-faint/30" />
      <p className="font-mono text-[10px] tracking-widest text-cyber-text-faint">{text}</p>
    </div>
  );
}