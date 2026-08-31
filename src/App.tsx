import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Scanlines } from '@/components/Scanlines';
import { HomeScreen } from '@/screens/HomeScreen';
import { CreateScreen } from '@/screens/CreateScreen';
import { JoinScreen } from '@/screens/JoinScreen';
import { ChatScreen } from '@/screens/ChatScreen';
import { ExpiredScreen } from '@/screens/ExpiredScreen';
import { LoginScreen } from '@/screens/LoginScreen';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { clearCachedKey } from '@/lib/crypto';
import { supabase } from '@/lib/supabase';
import type { Screen, UserProfile } from '@/types';

interface ChatSession {
  roomId: string;
  roomCode: string;
  participantId: string;
  isPermanent: boolean;
}

const CHAT_SESSION_KEY = 'cipherline_chat_session';

function saveChatSession(session: ChatSession, nickname: string) {
  try {
    localStorage.setItem(CHAT_SESSION_KEY, JSON.stringify({ ...session, nickname }));
  } catch {
    // localStorage indisponível (modo privado, etc.) — segue sem persistir
  }
}

function loadChatSession(): (ChatSession & { nickname: string }) | null {
  try {
    const raw = localStorage.getItem(CHAT_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearChatSession() {
  try {
    localStorage.removeItem(CHAT_SESSION_KEY);
  } catch {
    // ignore
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [nickname, setNickname] = useState('');
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [expiredCode, setExpiredCode] = useState('');
  const [panicFlash, setPanicFlash] = useState(false);
  const escPressesRef = useRef<number[]>([]);

  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [suppressScanlines, setSuppressScanlines] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setThemeState] = useState<'default' | 'overide'>(
    () => (localStorage.getItem('cipherline_theme') as 'default' | 'overide') || 'default',
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Aplica a preferência salva na conta assim que o perfil carrega
  useEffect(() => {
    if (profile?.theme_preference) {
      setThemeState(profile.theme_preference as 'default' | 'overide');
    }
  }, [profile?.theme_preference]);

  const setTheme = async (next: 'default' | 'overide') => {
    setThemeState(next);
    localStorage.setItem('cipherline_theme', next);
    if (profile) {
      await supabase.from('profiles').update({ theme_preference: next }).eq('id', profile.id);
    }
  };

  useEffect(() => {
    // As duas verificações de inicialização (sessão de login + sala ativa
    // salva) rodam em paralelo e são coordenadas aqui antes de decidir a
    // tela final — evitando que o carregamento do perfil "vença a corrida"
    // e jogue o usuário de volta pro dashboard mesmo quando ele estava
    // legitimamente voltando para uma sala aberta (ex: trocou de aba).
    let cancelled = false;

    const bootstrap = async () => {
      const [{ data: { session: s } }, restoredChat] = await Promise.all([
        supabase.auth.getSession(),
        restoreChatSessionIfValid(),
      ]);

      if (cancelled) return;

      setSession(s);

      let loadedProfile: UserProfile | null = null;
      if (s) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', s.user.id)
          .maybeSingle();
        if (cancelled) return;
        loadedProfile = (data as UserProfile) || null;
        setProfile(loadedProfile);
      }

      if (restoredChat) {
        setChatSession(restoredChat.session);
        setNickname(restoredChat.nickname);
        setScreen('chat');
      } else if (loadedProfile) {
        setScreen('dashboard');
      }

      setAuthLoading(false);
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      (async () => {
        setSession(s);
        if (s) {
          setIsGuest(false);
          await loadProfile(s.user.id);
        } else {
          setProfile(null);
          setAuthLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (chatSession) {
      saveChatSession(chatSession, nickname);
    } else {
      clearChatSession();
    }
  }, [chatSession, nickname]);

  // Ao voltar de background (troca de aba, minimizar, etc.) sem recarregar
  // a página inteira, revalida se a sala ainda existe de verdade — o React
  // pode manter o estado em memória mesmo se o servidor já não reconhece
  // mais aquele participante, e isso deixava a UI "mentindo" sobre estar
  // na sala.
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible' || !chatSession) return;
      const { data: participant } = await supabase
        .from('participants')
        .select('id')
        .eq('id', chatSession.participantId)
        .maybeSingle();
      if (!participant) {
        // A sala/participante não existe mais de verdade — evita deixar o
        // usuário preso numa tela de chat fantasma.
        setChatSession(null);
        setScreen(profile ? 'dashboard' : 'home');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [chatSession, profile]);

  const restoreChatSessionIfValid = async (): Promise<{ session: ChatSession; nickname: string } | null> => {
    const saved = loadChatSession();
    if (!saved) return null;

    const { data: participant } = await supabase
      .from('participants')
      .select('id, room_id')
      .eq('id', saved.participantId)
      .maybeSingle();

    if (!participant) {
      clearChatSession();
      return null;
    }

    return {
      session: {
        roomId: saved.roomId,
        roomCode: saved.roomCode,
        participantId: saved.participantId,
        isPermanent: saved.isPermanent,
      },
      nickname: saved.nickname,
    };
  };

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (data) {
      setProfile(data as UserProfile);
      setScreen('dashboard');
    }
    setAuthLoading(false);
  };

  const handleNavigate = (target: 'create' | 'join', name: string) => {
    setNickname(name);
    setScreen(target);
  };

  const handleChannelCreated = (roomId: string, roomCode: string, participantId: string, isPermanent: boolean) => {
    setChatSession({ roomId, roomCode, participantId, isPermanent });
    setScreen('chat');
  };

  const handleExpired = (roomCode: string) => {
    setExpiredCode(roomCode);
    setScreen('expired');
  };

  const handleLeave = useCallback(() => {
    clearCachedKey();
    setChatSession(null);
    setNickname('');
    if (profile) {
      setScreen('dashboard');
    } else if (isGuest) {
      setScreen('home');
    } else {
      setScreen('home');
    }
  }, [profile, isGuest]);

  const handleGuest = () => {
    setIsGuest(true);
    setScreen('home');
  };

  const handleAuthSuccess = () => {
    // onAuthStateChange will load profile and set screen to dashboard
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setIsGuest(false);
    setScreen('home');
  };

  const handleDashboardJoinRoom = async (roomCode: string, roomId: string, isPermanent: boolean) => {
    const name = profile?.nickname || 'USER';
    setNickname(name);

    // Reusa um participante existente com o mesmo apelido nesta sala (mesma
    // pessoa reconectando), ou cria um novo — nunca inventa um ID que não
    // existe no banco (isso quebrava a restauração de sessão e deixava
    // presença "fantasma" quando a pessoa saía).
    const { data: existing } = await supabase
      .from('participants')
      .select('id')
      .eq('room_id', roomId)
      .eq('nickname', name)
      .maybeSingle();

    let participantId: string;
    if (existing) {
      await supabase
        .from('participants')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', existing.id);
      participantId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from('participants')
        .insert({ room_id: roomId, nickname: name })
        .select()
        .single();
      if (error || !created) return;
      participantId = created.id;
    }

    setChatSession({ roomId, roomCode, participantId, isPermanent });
    setScreen('chat');
  };

  const handleDashboardCreate = () => {
    setNickname(profile?.nickname || 'USER');
    setScreen('create');
  };

  const handleDashboardJoinByCode = (code: string) => {
    setNickname(profile?.nickname || 'USER');
    setScreen('join');
  };

  // Panic mode: double ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const now = Date.now();
      escPressesRef.current = escPressesRef.current.filter((t) => now - t < 500);
      escPressesRef.current.push(now);

      if (escPressesRef.current.length >= 2) {
        escPressesRef.current = [];
        setPanicFlash(true);
        clearCachedKey();
        setChatSession(null);
        setNickname('');
        if (session) {
          supabase.auth.signOut();
          setSession(null);
          setProfile(null);
        }
        setIsGuest(false);
        setScreen('home');
        setTimeout(() => setPanicFlash(false), 200);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session]);

  // Loading state
  if (authLoading) {
    return (
      <div className="app-viewport relative w-screen overflow-hidden bg-cyber-bg">
        <Scanlines />
        <div className="flex h-full items-center justify-center">
          <motion.div
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="font-mono text-sm tracking-widest text-cyber-green"
          >
            INICIALIZANDO...
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-viewport relative w-screen overflow-hidden bg-cyber-bg">
      {!suppressScanlines && <Scanlines />}

      <AnimatePresence mode="wait">
        {panicFlash ? (
          <motion.div
            key="panic"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[100] bg-cyber-red"
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={panicFlash ? { duration: 0 } : { duration: 0.3 }}
          className="h-full w-full"
        >
          {screen === 'login' && (
            <LoginScreen onGuest={handleGuest} onAuthSuccess={handleAuthSuccess} />
          )}

          {screen === 'dashboard' && profile && (
            <DashboardScreen
              profile={profile}
              onSignOut={handleSignOut}
              onJoinRoom={handleDashboardJoinRoom}
              onCreateChannel={handleDashboardCreate}
              onJoinByCode={handleDashboardJoinByCode}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}

          {screen === 'home' && (
            <HomeScreen
              onNavigate={handleNavigate}
              onLogin={() => setScreen('login')}
              isGuest={isGuest}
              hasAccount={!!session}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}

          {screen === 'create' && (
            <CreateScreen
              nickname={nickname}
              onBack={() => (profile ? setScreen('dashboard') : setScreen('home'))}
              onChannelCreated={handleChannelCreated}
              isGuest={isGuest}
              userId={profile?.id}
              userNickname={profile?.nickname}
            />
          )}

          {screen === 'join' && (
            <JoinScreen
              nickname={nickname}
              onBack={() => (profile ? setScreen('dashboard') : setScreen('home'))}
              onChannelJoined={handleChannelCreated}
              onExpired={handleExpired}
              userId={profile?.id}
            />
          )}

          {screen === 'expired' && (
            <ExpiredScreen
              roomCode={expiredCode}
              onCreateNew={() => setScreen('create')}
              onBack={() => (profile ? setScreen('dashboard') : setScreen('home'))}
            />
          )}

          {screen === 'chat' && chatSession && (
            <ChatScreen
              roomId={chatSession.roomId}
              roomCode={chatSession.roomCode}
              participantId={chatSession.participantId}
              nickname={nickname}
              isPermanent={chatSession.isPermanent}
              onLeave={handleLeave}
              userId={profile?.id}
              onSuppressScanlines={setSuppressScanlines}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <SettingsScreen
            profile={profile}
            theme={theme}
            onSetTheme={setTheme}
            onClose={() => setShowSettings(false)}
            onSignOut={() => {
              setShowSettings(false);
              handleSignOut();
            }}
            onAccountDeleted={() => {
              setShowSettings(false);
              setSession(null);
              setProfile(null);
              setScreen('home');
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
