import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Plus, LogOut, Hash, Lock, Users, Archive, Pin, BellOff, MessageSquare, ChevronRight, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { UserProfile, RoomMember, PublicRoom } from '@/types';

interface DashboardScreenProps {
  profile: UserProfile;
  onSignOut: () => void;
  onJoinRoom: (roomCode: string, roomId: string, isPermanent: boolean) => void;
  onCreateChannel: () => void;
  onJoinByCode: (code: string) => void;
}

type Tab = 'recentes' | 'publicos' | 'grupos' | 'privado';

interface RoomPreview {
  roomId: string;
  roomCode: string;
  roomName: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  isArchived: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isPublic: boolean;
  isPrivate: boolean;
  topic: string | null;
}

export function DashboardScreen({ profile, onSignOut, onJoinRoom, onCreateChannel, onJoinByCode }: DashboardScreenProps) {
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

  useEffect(() => {
    loadMembership();
    loadPublicRooms();
  }, []);

  const loadMembership = async () => {
    const { data } = await supabase
      .from('room_members')
      .select(`
        *,
        rooms!inner(id, code, is_public, topic, is_permanent)
      `)
      .eq('user_id', profile.id);

    if (data) {
      const active = (data as any[]).filter((r) => !r.is_archived);
      const archived = (data as any[]).filter((r) => r.is_archived);
      setRooms(active as any);
      setArchivedRooms(archived as any);
    }
    setLoading(false);
  };

  const loadPublicRooms = async () => {
    const { data, error } = await supabase.rpc('get_public_rooms');
    if (!error && data) {
      setPublicRooms(data as PublicRoom[]);
    }
  };

  const loadPreviews = useCallback(async () => {
    const store = await getPreviewStore();
    const allRooms = [...rooms, ...archivedRooms];
    const map = new Map<string, RoomPreview>();

    for (const rm of allRooms) {
      const roomData = (rm as any).rooms;
      if (!roomData) continue;
      const key = `preview:${roomData.id}`;
      const stored = await store.get(key);
      map.set(roomData.id, {
        roomId: roomData.id,
        roomCode: roomData.code,
        roomName: roomData.code,
        lastMessage: stored?.lastMessage || '',
        lastMessageAt: stored?.lastMessageAt || '',
        unreadCount: stored?.unreadCount || 0,
        isArchived: rm.is_archived,
        isPinned: rm.is_pinned,
        isMuted: rm.is_muted,
        isPublic: roomData.is_public,
        isPrivate: !roomData.is_public,
        topic: roomData.topic,
      });
    }
    setPreviews(map);
  }, [rooms, archivedRooms]);

  useEffect(() => {
    loadPreviews();
  }, [loadPreviews]);

  const handleJoinPublic = async (room: PublicRoom) => {
    await supabase
      .from('room_members')
      .insert({ room_id: room.id, user_id: profile.id, role: 'member' });
    onJoinRoom(room.code, room.id, true);
  };

  const handleJoinExisting = (rm: RoomMember) => {
    const roomData = (rm as any).rooms;
    if (roomData) {
      onJoinRoom(roomData.code, roomData.id, roomData.is_permanent);
    }
  };

  const handleArchive = async (roomId: string) => {
    await supabase
      .from('room_members')
      .update({ is_archived: true })
      .eq('room_id', roomId)
      .eq('user_id', profile.id);
    loadMembership();
  };

  const handleUnarchive = async (roomId: string) => {
    await supabase
      .from('room_members')
      .update({ is_archived: false })
      .eq('room_id', roomId)
      .eq('user_id', profile.id);
    loadMembership();
    setShowArchived(false);
  };

  const handlePin = async (roomId: string) => {
    const rm = rooms.find((r) => (r as any).rooms?.id === roomId);
    await supabase
      .from('room_members')
      .update({ is_pinned: !rm?.is_pinned })
      .eq('room_id', roomId)
      .eq('user_id', profile.id);
    loadMembership();
  };

  const handleMute = async (roomId: string) => {
    const rm = rooms.find((r) => (r as any).rooms?.id === roomId);
    await supabase
      .from('room_members')
      .update({ is_muted: !rm?.is_muted })
      .eq('room_id', roomId)
      .eq('user_id', profile.id);
    loadMembership();
  };

  const handleLeaveGroup = async (roomId: string) => {
    await supabase
      .from('room_members')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', profile.id);
    loadMembership();
  };

  const handleJoinByCode = () => {
    if (joinCode.trim()) {
      onJoinByCode(joinCode.trim().toUpperCase());
      setJoinCode('');
      setShowJoinCode(false);
    }
  };

  const filteredRooms = rooms.filter((rm) => {
    const roomData = (rm as any).rooms;
    if (!roomData) return false;
    const preview = previews.get(roomData.id);
    const name = roomData.code.toLowerCase();
    const topic = (roomData.topic || '').toLowerCase();
    const q = search.toLowerCase();
    if (q && !name.includes(q) && !topic.includes(q)) return false;

    if (tab === 'recentes') return true;
    if (tab === 'grupos') return !roomData.is_public;
    if (tab === 'privado') return false;
    return true;
  }).sort((a, b) => {
    const aPin = a.is_pinned ? 1 : 0;
    const bPin = b.is_pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    const aTime = previews.get((a as any).rooms?.id)?.lastMessageAt || '';
    const bTime = previews.get((b as any).rooms?.id)?.lastMessageAt || '';
    return bTime.localeCompare(aTime);
  });

  const filteredPublic = publicRooms.filter((r) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return r.code.toLowerCase().includes(q) || (r.topic || '').toLowerCase().includes(q);
  });

  const relativeTime = (iso: string) => {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min}min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'ontem';
    if (d < 7) return `${d}d`;
    return new Date(iso).toLocaleDateString('pt-BR');
  };

  return (
    <div className="flex h-full flex-col bg-cyber-bg">
      {/* Header */}
      <div className="glass clip-hud-sm z-20 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold tracking-widest text-cyber-green glow-green">
            CIPHERLINE
          </span>
          <span className="font-mono text-[10px] tracking-widest text-cyber-text-faint">
            · {profile.nickname}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowArchived(true)}
            className="font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-cyan"
          >
            <Archive size={14} />
          </button>
          <button
            onClick={onSignOut}
            className="flex items-center gap-1 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red"
          >
            <LogOut size={14} />
            SAIR
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <div className="glass clip-hud-sm flex items-center gap-2 px-4 py-2.5">
          <Search size={14} className="text-cyber-text-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="buscar canais e conversas..."
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-cyber-green placeholder-cyber-text-faint focus:outline-none"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4">
        {([
          { key: 'recentes', label: 'RECENTES' },
          { key: 'publicos', label: 'PÚBLICOS' },
          { key: 'grupos', label: 'GRUPOS' },
          { key: 'privado', label: 'PRIVADO' },
        ] as { key: Tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`clip-hud-sm px-3 py-2 font-mono text-[10px] tracking-widest transition-colors ${
              tab === t.key
                ? 'border border-cyber-green/30 bg-cyber-green/10 text-cyber-green'
                : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {loading && (
            <div className="py-8 text-center font-mono text-xs text-cyber-text-faint">
              CARREGANDO...
            </div>
          )}

          {!loading && tab === 'publicos' && filteredPublic.length === 0 && (
            <EmptyState text="NENHUM CANAL PÚBLICO ENCONTRADO" />
          )}

          {!loading && tab !== 'publicos' && filteredRooms.length === 0 && (
            <EmptyState text={tab === 'recentes' ? 'NENHUMA CONVERSA AINDA' : tab === 'grupos' ? 'NENHUM GRUPO' : 'NENHUMA CONVERSA PRIVADA'} />
          )}

          {/* Public rooms list */}
          {tab === 'publicos' && filteredPublic.map((room) => (
            <RoomItem
              key={room.id}
              name={room.code}
              topic={room.topic || ''}
              lastMessage={`${room.member_count} membros`}
              timestamp={relativeTime(room.created_at)}
              unreadCount={0}
              isPublic
              onClick={() => handleJoinPublic(room)}
            />
          ))}

          {/* User's rooms list */}
          {tab !== 'publicos' && filteredRooms.map((rm) => {
            const roomData = (rm as any).rooms;
            if (!roomData) return null;
            const preview = previews.get(roomData.id);
            return (
              <RoomItem
                key={rm.id}
                name={roomData.code}
                topic={roomData.topic || ''}
                lastMessage={preview?.lastMessage || 'sem mensagens'}
                timestamp={relativeTime(preview?.lastMessageAt || roomData.created_at)}
                unreadCount={preview?.unreadCount || 0}
                isPinned={rm.is_pinned}
                isMuted={rm.is_muted}
                isPublic={roomData.is_public}
                onClick={() => handleJoinExisting(rm)}
                onArchive={() => handleArchive(roomData.id)}
                onPin={() => handlePin(roomData.id)}
                onMute={() => handleMute(roomData.id)}
                onLeave={() => handleLeaveGroup(roomData.id)}
              />
            );
          })}
        </div>
      </div>

      {/* Floating action button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowCreate(true)}
        className="absolute bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-cyber-green/30 bg-cyber-green/10 text-cyber-green shadow-[0_0_20px_rgba(0,255,65,0.15)] transition-colors hover:bg-cyber-green/20"
      >
        <Plus size={24} />
      </motion.button>

      {/* Create menu */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass clip-hud mx-6 max-w-sm border-cyber-green/20 p-6"
            >
              <p className="mb-4 font-mono text-sm tracking-widest text-cyber-green">NOVO CANAL</p>
              <div className="space-y-2">
                <button
                  onClick={() => { setShowCreate(false); onCreateChannel(); }}
                  className="clip-hud-sm flex w-full items-center gap-3 border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20"
                >
                  <Hash size={16} />
                  CRIAR CANAL
                </button>
                <button
                  onClick={() => { setShowCreate(false); setShowJoinCode(true); }}
                  className="clip-hud-sm flex w-full items-center gap-3 border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20"
                >
                  <Lock size={16} />
                  ENTRAR COM CÓDIGO
                </button>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="mt-4 block w-full text-center font-mono text-[10px] tracking-widest text-cyber-text-faint transition-colors hover:text-cyber-red"
              >
                CANCELAR
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Join by code */}
      <AnimatePresence>
        {showJoinCode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowJoinCode(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass clip-hud mx-6 max-w-sm border-cyber-cyan/20 p-6"
            >
              <p className="mb-4 font-mono text-sm tracking-widest text-cyber-cyan">ENTRAR COM CÓDIGO</p>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="CÓDIGO DO CANAL"
                maxLength={12}
                className="mb-4 w-full bg-transparent font-mono text-lg text-cyber-green placeholder-cyber-text-faint focus:outline-none"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowJoinCode(false)}
                  className="clip-hud-sm flex-1 border border-cyber-text-faint/30 px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-text"
                >
                  CANCELAR
                </button>
                <button
                  onClick={handleJoinByCode}
                  className="clip-hud-sm flex-1 border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20"
                >
                  ENTRAR
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Archived rooms */}
      <AnimatePresence>
        {showArchived && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowArchived(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass clip-hud mx-6 max-w-sm max-h-[80vh] overflow-y-auto border-cyber-text-faint/20 p-6"
            >
              <p className="mb-4 font-mono text-sm tracking-widest text-cyber-text-dim">ARQUIVADAS</p>
              {archivedRooms.length === 0 ? (
                <p className="py-4 text-center font-mono text-[10px] tracking-widest text-cyber-text-faint">
                  NENHUMA CONVERSA ARQUIVADA
                </p>
              ) : (
                <div className="space-y-2">
                  {archivedRooms.map((rm) => {
                    const roomData = (rm as any).rooms;
                    if (!roomData) return null;
                    return (
                      <div key={rm.id} className="flex items-center gap-2">
                        <span className="flex-1 truncate font-mono text-xs text-cyber-text-dim">{roomData.code}</span>
                        <button
                          onClick={() => handleUnarchive(roomData.id)}
                          className="font-mono text-[10px] tracking-widest text-cyber-cyan transition-colors hover:text-cyber-green"
                        >
                          DESARQUIVAR
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <button
                onClick={() => setShowArchived(false)}
                className="mt-4 block w-full text-center font-mono text-[10px] tracking-widest text-cyber-text-faint transition-colors hover:text-cyber-red"
              >
                FECHAR
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RoomItem(props: any) {
  const [showActions, setShowActions] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleLongPressStart = () => {
    const t = setTimeout(() => setShowActions(true), 500);
    setLongPressTimer(t);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative"
    >
      <div
        onClick={props.onClick}
        onContextMenu={(e) => { e.preventDefault(); setShowActions(!showActions); }}
        onTouchStart={handleLongPressStart}
        onTouchEnd={handleLongPressEnd}
        className="clip-hud-sm flex cursor-pointer items-center gap-3 border border-cyber-border bg-cyber-panel/30 px-4 py-3 transition-colors hover:border-cyber-green/20 hover:bg-cyber-panel/50"
      >
        {/* Icon */}
        <div className="shrink-0">
          {props.isPublic ? (
            <Hash size={18} className="text-cyber-cyan" />
          ) : (
            <Lock size={18} className="text-cyber-green" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm font-bold text-cyber-green">{props.name}</span>
            {props.isPinned && <Pin size={10} className="shrink-0 text-cyber-amber" />}
            {props.isMuted && <BellOff size={10} className="shrink-0 text-cyber-text-faint" />}
          </div>
          {props.topic ? (
            <p className="truncate font-mono text-[10px] text-cyber-text-faint">{props.topic}</p>
          ) : (
            <p className="truncate font-mono text-[10px] text-cyber-text-faint">{props.lastMessage}</p>
          )}
        </div>

        {/* Right side */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-mono text-[10px] text-cyber-text-faint">{props.timestamp}</span>
          {props.unreadCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-cyber-green/20 px-1.5 font-mono text-[10px] font-bold text-cyber-green">
              {props.unreadCount}
            </span>
          )}
        </div>
      </div>

      {/* Action menu */}
      <AnimatePresence>
        {showActions && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="absolute right-2 top-2 z-20 flex flex-col gap-1 rounded-lg border border-cyber-green/20 bg-cyber-bg/95 p-2 backdrop-blur"
          >
            <button onClick={() => { props.onPin(); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-amber">
              <Pin size={12} /> FIXAR
            </button>
            <button onClick={() => { props.onMute(); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-cyan">
              <BellOff size={12} /> SILENCIAR
            </button>
            <button onClick={() => { props.onArchive(); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-text">
              <Archive size={12} /> ARQUIVAR
            </button>
            <button onClick={() => { props.onLeave(); setShowActions(false); }} className="flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red">
              <LogOut size={12} /> SAIR
            </button>
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

// ============================================================
// IndexedDB preview store — zero-knowledge local message previews
// ============================================================
const DB_NAME = 'cipherline-previews';
const STORE_NAME = 'previews';

async function getPreviewStore(): Promise<{
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      resolve({
        get: (key: string) => new Promise((res, rej) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(key);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        }),
        set: (key: string, value: any) => new Promise((res, rej) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(value, key);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        }),
      });
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveMessagePreview(roomId: string, lastMessage: string, lastMessageAt: string) {
  const store = await getPreviewStore();
  await store.set(`preview:${roomId}`, { lastMessage, lastMessageAt, unreadCount: 0 });
}

export async function clearMessagePreview(roomId: string) {
  const store = await getPreviewStore();
  await store.set(`preview:${roomId}`, { lastMessage: '', lastMessageAt: '', unreadCount: 0 });
}
