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
import { clearCachedKey } from '@/lib/crypto';
import { supabase } from '@/lib/supabase';
import type { Screen, UserProfile } from '@/types';

interface ChatSession {
  roomId: string;
  roomCode: string;
  participantId: string;
  isPermanent: boolean;
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) {
        loadProfile(s.user.id);
      } else {
        setAuthLoading(false);
      }
    });

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

    return () => listener.subscription.unsubscribe();
  }, []);

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

  const handleDashboardJoinRoom = (roomCode: string, roomId: string, isPermanent: boolean) => {
    // For logged-in users joining from dashboard, we need a participantId
    // Generate one via the same mechanism as JoinScreen
    const tempId = crypto.randomUUID();
    setNickname(profile?.nickname || 'USER');
    setChatSession({ roomId, roomCode, participantId: tempId, isPermanent });
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
      <div className="relative h-screen w-screen overflow-hidden bg-cyber-bg">
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
    <div className="relative h-screen w-screen overflow-hidden bg-cyber-bg">
      <Scanlines />

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
            />
          )}

          {screen === 'home' && (
            <HomeScreen
              onNavigate={handleNavigate}
              onLogin={() => setScreen('login')}
              isGuest={isGuest}
              hasAccount={!!session}
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
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
