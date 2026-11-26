import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Scanlines } from '@/components/Scanlines';
import { HomeScreen } from '@/screens/HomeScreen';
import { ExpiredScreen } from '@/screens/ExpiredScreen';
import { clearCachedKey } from '@/lib/crypto';
import { supabase } from '@/lib/supabase';
import { joinRoomSecure, verifyParticipant } from '@/lib/participant';
import { clearParticipantCreds } from '@/lib/device';
import { forgetAllRoomSecrets, getRoomSecret } from '@/lib/roomKeys';
import { parseInviteUrl } from '@/lib/cryptoV2';
import { getJoinToken, panicWipeCrypto } from '@/lib/roomCrypto';
import type { Screen, UserProfile } from '@/types';
import { PROFILE_COLUMNS } from '@/lib/columns';

const ChatScreen = lazy(() => import('@/screens/ChatScreen').then((module) => ({ default: module.ChatScreen })));
const DashboardScreen = lazy(() => import('@/screens/DashboardScreen').then((module) => ({ default: module.DashboardScreen })));
const SettingsScreen = lazy(() => import('@/screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })));
const CreateScreen = lazy(() => import('@/screens/CreateScreen').then((module) => ({ default: module.CreateScreen })));
const JoinScreen = lazy(() => import('@/screens/JoinScreen').then((module) => ({ default: module.JoinScreen })));
const LoginScreen = lazy(() => import('@/screens/LoginScreen').then((module) => ({ default: module.LoginScreen })));

function ScreenLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <motion.div
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1, repeat: Infinity }}
        className="font-mono text-sm tracking-widest text-cyber-green"
      >
        INICIALIZANDO...
      </motion.div>
    </div>
  );
}

interface ChatSession {
  roomId: string;
  roomCode: string;
  participantId: string;
  secret: string | null;
  isPermanent: boolean;
  cryptoVersion: 1 | 2;
}

const CHAT_SESSION_KEY = 'cipherline_chat_session';

function saveChatSession(session: ChatSession, nickname: string) {
  try {
    localStorage.setItem(CHAT_SESSION_KEY, JSON.stringify({ ...session, nickname }));
  } catch {}
}

function loadChatSession(): (ChatSession & { nickname: string }) | null {
  try {
    const raw = localStorage.getItem(CHAT_SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return { ...saved, cryptoVersion: saved.cryptoVersion === 2 ? 2 : 1 };
  } catch {
    return null;
  }
}

function clearChatSession() {
  try {
    localStorage.removeItem(CHAT_SESSION_KEY);
  } catch {}
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
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const signOutCancelRef = useRef<HTMLButtonElement>(null);
  const [pendingQuote, setPendingQuote] = useState<{ text: string; sender: string; roomName: string } | null>(null);
  const [prefilledJoinCode, setPrefilledJoinCode] = useState('');
  const [prefilledJoinSecret, setPrefilledJoinSecret] = useState<string | null>(null);
  const [theme, setThemeState] = useState<'default' | 'overide'>(
    () => (localStorage.getItem('cipherline_theme') as 'default' | 'overide') || 'default',
  );

  // Toast global para erros de DM / navegação
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (confirmSignOut) signOutCancelRef.current?.focus();
  }, [confirmSignOut]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const invite = parseInviteUrl(window.location.search + window.location.hash);
    if (invite.roomCode) {
      setPrefilledJoinCode(invite.roomCode.toUpperCase());
      setPrefilledJoinSecret(invite.secret);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (profile?.theme_preference) {
      setThemeState(profile.theme_preference as 'default' | 'overide');
    }
  }, [profile?.theme_preference]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const setTheme = async (next: 'default' | 'overide') => {
    setThemeState(next);
    localStorage.setItem('cipherline_theme', next);
    if (profile) {
      await supabase.from('profiles').update({ theme_preference: next }).eq('id', profile.id);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        // allSettled em vez de all: se a rede falhar numa das promises,
        // a outra nao e descartada. Cada resultado e tratado individualmente.
        const [sessionRes, chatRes] = await Promise.allSettled([
          supabase.auth.getSession(),
          restoreChatSessionIfValid(),
        ]);

        if (cancelled) return;

        if (sessionRes.status === 'rejected') {
          console.warn('[CipherLine] Falha ao obter sessao auth no arranque:', sessionRes.reason);
        }
        if (chatRes.status === 'rejected') {
          console.warn('[CipherLine] Falha ao restaurar sessao de chat:', chatRes.reason);
        }

        const s = sessionRes.status === 'fulfilled' ? sessionRes.value.data.session : null;
        const restoredChat = chatRes.status === 'fulfilled' ? chatRes.value : null;

        setSession(s);

        let loadedProfile: UserProfile | null = null;
        if (s) {
          const { data } = await supabase
            .from('profiles')
            .select(PROFILE_COLUMNS.account)
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
      } catch (err) {
        console.error('[CipherLine] Falha no bootstrap inicial:', err);
        setToastMessage('Falha ao iniciar a aplicacao. Verifica a ligacao.');
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
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

  const restoreChatSessionIfValid = async (): Promise<{ session: ChatSession; nickname: string } | null> => {
    const saved = loadChatSession();
    if (!saved) return null;

    const secret = (saved as any).secret ?? null;

    // Sessao de formato antigo (sem secret). O servidor ja nao aceita estas
    // credenciais desde a correcao do verify_participant. Limpa e forca
    // reentrada via dashboard, que gera um secret novo.
    if (!secret) {
      clearChatSession();
      clearParticipantCreds(saved.roomCode, saved.nickname);
      return null;
    }

    let valid = false;
    try {
      valid = await verifyParticipant(saved.participantId, secret);
    } catch (err) {
      // Falha de rede ao verificar. Preserva a sessao local para tentar
      // novamente no proximo arranque (nao apaga o localStorage).
      console.warn('[CipherLine] Nao foi possivel verificar participante agora:', err);
      return null;
    }

    if (!valid) {
      clearChatSession();
      clearParticipantCreds(saved.roomCode, saved.nickname);
      return null;
    }

    return {
      session: {
        roomId: saved.roomId,
        roomCode: saved.roomCode,
        participantId: saved.participantId,
        secret,
        isPermanent: saved.isPermanent,
        cryptoVersion: saved.cryptoVersion === 2 ? 2 : 1,
      },
      nickname: saved.nickname,
    };
  };

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS.account)
      .eq('id', userId)
      .maybeSingle();
    if (data) {
      setProfile(data as UserProfile);
      // Só muda para o dashboard se o utilizador estiver no login ou no home.
      // Se já estiver no chat (ex: a ler uma DM), mantém-se lá!
      setScreen((prev) => (prev === 'login' || prev === 'home' ? 'dashboard' : prev));
    }
    setAuthLoading(false);
  };

  const handleNavigate = (target: 'create' | 'join', name: string) => {
    setNickname(name);
    setScreen(target);
  };

  const handleChannelCreated = (
    roomId: string,
    roomCode: string,
    participantId: string,
    secret: string | null,
    isPermanent: boolean,
    cryptoVersion: 1 | 2 = 1,
  ) => {
    setChatSession({ roomId, roomCode, participantId, secret, isPermanent, cryptoVersion });
    setScreen('chat');
  };

  const handleExpired = (roomCode: string) => {
    setExpiredCode(roomCode);
    setScreen('expired');
  };

  const handleLeave = useCallback(() => {
    if (chatSession) {
      clearParticipantCreds(chatSession.roomCode, nickname);
    }
    clearCachedKey();
    setChatSession(null);
    setNickname('');
    if (profile) {
      setScreen('dashboard');
    } else {
      setScreen('home');
    }
  }, [profile, chatSession, nickname]);

  const handleGuest = () => {
    setIsGuest(true);
    setScreen('home');
  };

  const handleAuthSuccess = () => {};

  const handleSignOut = () => setConfirmSignOut(true);

  const confirmAndSignOut = async () => {
    setConfirmSignOut(false);
    // Limpa estado de chat ANTES de fazer signOut, para que o
    // onAuthStateChange nao dispare com uma sessao de chat "orfa".
    if (chatSession) {
      clearParticipantCreds(chatSession.roomCode, nickname);
    }
    clearChatSession();
    clearCachedKey();
    forgetAllRoomSecrets();
    setChatSession(null);
    setNickname('');
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setIsGuest(false);
    setScreen('home');
  };

  const handleDashboardJoinRoom = async (roomCode: string, _roomId: string, _isPermanent: boolean) => {
    const name = profile?.nickname || 'USER';
    setNickname(name);

    try {
      const roomSecret = getRoomSecret(roomCode);
      const joinToken = roomSecret ? await getJoinToken(roomCode, roomSecret) : null;
      const result = await joinRoomSecure(roomCode, name, profile?.id || null, joinToken);
      setChatSession({
        roomId: result.roomId,
        roomCode,
        participantId: result.participantId,
        secret: result.secret,
        isPermanent: result.isPermanent,
        cryptoVersion: result.cryptoVersion,
      });
      setScreen('chat');
    } catch (err) {
      const msg = (err as Error)?.message || '';
      if (msg.toUpperCase().includes('EXPIRADA')) {
        // Se a sala expirou, leva o utilizador para o ecrã de sala expirada
        setExpiredCode(roomCode);
        setScreen('expired');
      } else {
        setToastMessage(msg.includes('JOIN_TOKEN_INVALIDO')
          ? 'Falta a chave desta sala neste dispositivo. Pede um novo convite.'
          : 'Não foi possível entrar nessa sala. Tenta novamente.');
      }
    }
  };

  const handleOpenPrivateReply = async (
    dmRoomCode: string,
    _dmRoomId: string,
    quote: { text: string; sender: string; roomName: string },
  ) => {
    const name = profile?.nickname || 'USER';
    setNickname(name);

    try {
      const result = await joinRoomSecure(dmRoomCode, name, profile?.id || null);
      setPendingQuote(quote);
      setChatSession({
        roomId: result.roomId,
        roomCode: dmRoomCode,
        participantId: result.participantId,
        secret: result.secret,
        isPermanent: result.isPermanent,
        cryptoVersion: 1,
      });
      setScreen('chat');
    } catch (err) {
      const msg = (err as Error)?.message || '';
      setToastMessage(
        msg.toUpperCase().includes('SALA NÃO ENCONTRADA') || msg.includes('FALHA')
          ? 'Não foi possível abrir a conversa privada. Tenta novamente em instantes.'
          : 'Falha ao abrir a conversa privada. Verifica a tua ligação.',
      );
    }
  };

  const handleDashboardCreate = () => {
    setNickname(profile?.nickname || 'USER');
    setScreen('create');
  };

  const handleDashboardJoinByCode = (code: string) => {
    setNickname(profile?.nickname || 'USER');
    setPrefilledJoinCode(code);
    setScreen('join');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmSignOut) return;
      const now = Date.now();
      escPressesRef.current = escPressesRef.current.filter((t) => now - t < 500);
      escPressesRef.current.push(now);

      if (escPressesRef.current.length >= 2) {
        escPressesRef.current = [];
        setPanicFlash(true);
        clearCachedKey();
        panicWipeCrypto();
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
  }, [session, confirmSignOut]);

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
          <Suspense fallback={<ScreenLoadingFallback />}>
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
              onBack={() => {
                setPrefilledJoinCode('');
                if (profile) setScreen('dashboard');
                else setScreen('home');
              }}
              onChannelJoined={(...args) => {
                setPrefilledJoinCode('');
                handleChannelCreated(...args);
              }}
              onExpired={handleExpired}
              userId={profile?.id}
              initialCode={prefilledJoinCode}
              initialSecret={prefilledJoinSecret}
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
              participantSecret={chatSession.secret || ''}
              nickname={nickname}
              isPermanent={chatSession.isPermanent}
              cryptoVersion={chatSession.cryptoVersion}
              onLeave={handleLeave}
              userId={profile?.id}
              onSuppressScanlines={setSuppressScanlines}
              onOpenPrivateReply={handleOpenPrivateReply}
              initialQuote={pendingQuote}
              onQuoteConsumed={() => setPendingQuote(null)}
            />
          )}
          </Suspense>
        </motion.div>
      </AnimatePresence>

      <Suspense fallback={<ScreenLoadingFallback />}>
      <AnimatePresence>
        {showSettings && (
          <SettingsScreen
            profile={profile}
            theme={theme}
            onSetTheme={setTheme}
            onClose={() => setShowSettings(false)}
            onProfileUpdated={() => {
              if (session) loadProfile(session.user.id);
            }}
            onSignOut={() => {
              setShowSettings(false);
              handleSignOut();
            }}
            onAccountDeleted={() => {
              setShowSettings(false);
              // Conta eliminada - limpar tudo o que era local
              if (chatSession) {
                clearParticipantCreds(chatSession.roomCode, nickname);
              }
              clearChatSession();
              clearCachedKey();
              setChatSession(null);
              setNickname('');
              setSession(null);
              setProfile(null);
              setIsGuest(false);
              setScreen('home');
            }}
          />
        )}
      </AnimatePresence>
      </Suspense>

      {confirmSignOut && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmSignOut(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="signout-confirm-title"
            className="glass clip-hud w-full max-w-sm border border-cyber-amber/30 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setConfirmSignOut(false);
                return;
              }
              if (event.key !== 'Tab') return;
              const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
              const first = buttons[0];
              const last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <h2 id="signout-confirm-title" className="mb-3 font-mono text-lg font-bold text-cyber-amber">Terminar sessão?</h2>
            <p className="font-mono text-sm leading-relaxed text-cyber-text-dim">Ao terminar sessão, as chaves das salas cifradas deste dispositivo são apagadas. Só voltas a entrar nelas com o link de convite.</p>
            <div className="mt-5 flex gap-3">
              <button ref={signOutCancelRef} onClick={() => setConfirmSignOut(false)} className="min-h-11 flex-1 border border-cyber-border px-3 py-2 font-mono text-sm text-cyber-text hover:bg-cyber-panel/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-cyan/60">Cancelar</button>
              <button onClick={confirmAndSignOut} className="min-h-11 flex-1 border border-cyber-amber/40 bg-cyber-amber/10 px-3 py-2 font-mono text-sm text-cyber-amber hover:bg-cyber-amber/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-amber/60">Terminar sessão</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast global — erros de navegação / DM */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="pointer-events-none absolute bottom-6 left-1/2 z-[200] -translate-x-1/2"
          >
            <div className="clip-hud-sm border border-cyber-red/40 bg-cyber-bg/95 px-4 py-3 backdrop-blur-md shadow-[0_0_20px_rgba(255,51,102,0.2)]">
              <span className="font-mono text-[11px] tracking-widest text-cyber-red">
                [ ! ] {toastMessage}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
