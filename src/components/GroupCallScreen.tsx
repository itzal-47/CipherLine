import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PhoneOff, Mic, MicOff, Video, VideoOff, Users } from 'lucide-react';
import {
  createPeerConnection,
  sendOnChannel,
  subscribeSignaling,
  getUserMediaStream,
  type SignalingMessage,
} from '@/lib/webrtc';

interface GroupCallScreenProps {
  roomId: string;
  myId: string;
  myNickname: string;
  withVideo: boolean;
  onEnd: () => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  nickname: string;
}

// Chamada em grupo via malha (mesh): cada participante abre uma conexão
// direta com CADA outro participante — sem servidor de mídia central. Isso
// funciona bem para grupos pequenos (até uns 5-6 participantes); além
// disso, o número de conexões por pessoa cresce rápido demais (N-1 conexões
// cada) e a qualidade tende a cair — limitação honesta de não ter um
// servidor SFU dedicado.
export function GroupCallScreen({ roomId, myId, myNickname, withVideo, onEnd }: GroupCallScreenProps) {
  const [peers, setPeers] = useState<Map<string, PeerEntry>>(new Map());
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const signalChannelRef = useRef<ReturnType<typeof subscribeSignaling> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const syncPeers = () => setPeers(new Map(peersRef.current));

  const removePeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (entry) {
      entry.pc.close();
      peersRef.current.delete(peerId);
      syncPeers();
    }
  }, []);

  const createConnectionTo = useCallback((peerId: string, nickname: string): RTCPeerConnection => {
    const pc = createPeerConnection();
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && signalChannelRef.current) {
        sendOnChannel(signalChannelRef.current, myId, peerId, 'ice', e.candidate.toJSON()).catch(() => {});
      }
    };

    pc.ontrack = (e) => {
      const entry = peersRef.current.get(peerId);
      if (entry) {
        entry.stream = e.streams[0];
        syncPeers();
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        removePeer(peerId);
      }
    };

    peersRef.current.set(peerId, { pc, stream: null, nickname });
    syncPeers();
    return pc;
  }, [myId, removePeer]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const stream = await getUserMediaStream(withVideo);
      if (cancelled) return;
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const channel = subscribeSignaling(roomId, myId, async (msg: SignalingMessage) => {
        if (msg.from === myId) return;

        switch (msg.type) {
          case 'call-join': {
            // Alguém entrou na chamada — se eu já estava aqui, sou eu quem
            // inicia a oferta (evita "glare" de duas ofertas simultâneas:
            // só quem tem o ID "maior" inicia).
            if (myId > msg.from) {
              const pc = createConnectionTo(msg.from, msg.payload?.nickname || 'PARTICIPANTE');
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              if (signalChannelRef.current) {
                await sendOnChannel(signalChannelRef.current, myId, msg.from, 'offer', offer);
              }
            }
            break;
          }
          case 'offer': {
            const pc = peersRef.current.get(msg.from)?.pc || createConnectionTo(msg.from, msg.payload?.nickname || 'PARTICIPANTE');
            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (signalChannelRef.current) {
              await sendOnChannel(signalChannelRef.current, myId, msg.from, 'answer', answer);
            }
            break;
          }
          case 'answer': {
            const entry = peersRef.current.get(msg.from);
            if (entry) await entry.pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
            break;
          }
          case 'ice': {
            const entry = peersRef.current.get(msg.from);
            if (entry) {
              try {
                await entry.pc.addIceCandidate(new RTCIceCandidate(msg.payload));
              } catch {
                // candidato tardio — ignora
              }
            }
            break;
          }
          case 'call-leave':
            removePeer(msg.from);
            break;
        }
      });
      signalChannelRef.current = channel;

      // Anuncia minha entrada — quem já estiver na chamada vai me oferecer
      // uma conexão automaticamente ao ver isto.
      await sendOnChannel(channel, myId, 'all', 'call-join', { nickname: myNickname, withVideo });

      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    };

    init();

    return () => {
      cancelled = true;
      if (signalChannelRef.current) {
        sendOnChannel(signalChannelRef.current, myId, 'all', 'call-leave', {}).catch(() => {});
        signalChannelRef.current.unsubscribe();
      }
      peersRef.current.forEach((entry) => entry.pc.close());
      peersRef.current.clear();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myId]);

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => (t.enabled = muted));
    setMuted(!muted);
  };

  const toggleVideo = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => (t.enabled = videoOff));
    setVideoOff(!videoOff);
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex flex-col bg-cyber-bg"
    >
      <div className="glass clip-hud-sm flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-xs tracking-widest text-cyber-green">
          <Users size={14} />
          CHAMADA EM GRUPO · {peers.size + 1} PARTICIPANTES
        </div>
        <span className="font-mono text-xs text-cyber-cyan">{formatDuration(duration)}</span>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto p-2 sm:grid-cols-3">
        <div className="relative aspect-square overflow-hidden rounded border border-cyber-green/30 bg-cyber-panel">
          {withVideo && !videoOff ? (
            <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-cyber-green">VOCÊ</div>
          )}
          <span className="absolute bottom-1 left-1 font-mono text-[9px] text-cyber-text-dim">
            {myNickname} (VOCÊ)
          </span>
        </div>

        <AnimatePresence>
          {Array.from(peers.entries()).map(([peerId, entry]) => (
            <PeerTile key={peerId} entry={entry} />
          ))}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-center gap-6 px-4 py-6">
        <button
          onClick={toggleMute}
          className={`clip-hud-sm rounded-full p-4 transition-colors ${muted ? 'bg-cyber-red/20 text-cyber-red' : 'bg-cyber-panel-2 text-cyber-text'}`}
        >
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        {withVideo && (
          <button
            onClick={toggleVideo}
            className={`clip-hud-sm rounded-full p-4 transition-colors ${videoOff ? 'bg-cyber-red/20 text-cyber-red' : 'bg-cyber-panel-2 text-cyber-text'}`}
          >
            {videoOff ? <VideoOff size={22} /> : <Video size={22} />}
          </button>
        )}
        <button
          onClick={onEnd}
          className="clip-hud-sm rounded-full bg-cyber-red/20 p-4 text-cyber-red transition-colors hover:bg-cyber-red/30"
        >
          <PhoneOff size={22} />
        </button>
      </div>
    </motion.div>
  );
}

function PeerTile({ entry }: { entry: PeerEntry }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && entry.stream) {
      videoRef.current.srcObject = entry.stream;
    }
  }, [entry.stream]);

  const hasVideo = entry.stream?.getVideoTracks().some((t) => t.enabled);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative aspect-square overflow-hidden rounded border border-cyber-cyan/30 bg-cyber-panel"
    >
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center font-mono text-xs text-cyber-cyan">
          {entry.nickname?.[0]?.toUpperCase() || '?'}
        </div>
      )}
      <span className="absolute bottom-1 left-1 font-mono text-[9px] text-cyber-text-dim">
        {entry.nickname}
      </span>
    </motion.div>
  );
}
