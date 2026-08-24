import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Camera, CameraOff, AlertTriangle } from 'lucide-react';
import {
  createPeerConnection,
  sendSignaling,
  subscribeSignaling,
  getUserMediaStream,
  adaptBitrate,
  type CallState,
  type SignalingMessage,
} from '@/lib/webrtc';

interface CallScreenProps {
  roomId: string;
  roomCode: string;
  myId: string;
  myNickname: string;
  peerId: string;
  peerNickname: string;
  withVideo: boolean;
  isInitiator: boolean;
  onEnd: () => void;
}

const CALL_TIMEOUT_MS = 30000;

export function CallScreen({
  roomId,
  myId,
  peerId,
  peerNickname,
  withVideo,
  isInitiator,
  onEnd,
}: CallScreenProps) {
  const [callState, setCallState] = useState<CallState>(isInitiator ? 'calling' : 'ringing');
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    supabaseUnsub();
  }, []);

  const supabaseUnsub = useCallback(() => {
    // channel unsubscribe handled by caller
  }, []);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const setupAudioAnalyser = (stream: MediaStream) => {
    const ctx = new AudioContext();
    audioContextRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioLevel(avg / 255);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const handleEnd = useCallback(() => {
    sendSignaling(roomId, myId, peerId, 'call-end', {}).catch(() => {});
    cleanup();
    onEnd();
  }, [roomId, myId, peerId, cleanup, onEnd]);

  // Main WebRTC setup
  useEffect(() => {
    let unsub: any = null;

    const init = async () => {
      try {
        const stream = await getUserMediaStream(withVideo);
        localStreamRef.current = stream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        setupAudioAnalyser(stream);

        const pc = createPeerConnection();
        pcRef.current = pc;

        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        const remoteStream = new MediaStream();
        remoteStreamRef.current = remoteStream;

        pc.ontrack = (e) => {
          e.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        };

        pc.onicecandidate = (e) => {
          if (e.candidate) {
            sendSignaling(roomId, myId, peerId, 'ice', e.candidate.toJSON()).catch(() => {});
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') {
            setCallState('connected');
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
          } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            setCallState('failed');
            setError('CONEXÃO PERDIDA');
          }
        };

        // Signaling
        unsub = subscribeSignaling(roomId, myId, async (msg: SignalingMessage) => {
          if (msg.from !== peerId) return;

          switch (msg.type) {
            case 'call-accept':
              setCallState('connected');
              break;
            case 'call-decline':
              setCallState('declined');
              cleanup();
              setTimeout(() => onEnd(), 1500);
              break;
            case 'call-end':
              setCallState('ended');
              cleanup();
              setTimeout(() => onEnd(), 1500);
              break;
            case 'offer':
              if (!isInitiator) {
                setCallState('connected');
                await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                sendSignaling(roomId, myId, peerId, 'answer', answer).catch(() => {});
              }
              break;
            case 'answer':
              if (isInitiator) {
                await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
              }
              break;
            case 'ice':
              try {
                await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
              } catch {
                // ignore late ICE candidates
              }
              break;
          }
        });

        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignaling(roomId, myId, peerId, 'offer', offer).catch(() => {});
          sendSignaling(roomId, myId, peerId, 'call-start', { withVideo }).catch(() => {});

          timeoutRef.current = setTimeout(() => {
            if (callState === 'calling') {
              setCallState('no-answer');
              cleanup();
              setTimeout(() => onEnd(), 1500);
            }
          }, CALL_TIMEOUT_MS);
        }
      } catch (err: any) {
        if (err?.name === 'NotAllowedError') {
          setError('ACESSO AO MICROFONE/CÂMERA NEGADO — VERIFIQUE AS PERMISSÕES DO NAVEGADOR');
        } else {
          setError('FALHA AO INICIAR CHAMADA');
        }
        setCallState('failed');
      }
    };

    init();

    return () => {
      if (unsub) unsub.unsubscribe();
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const stateLabels: Record<CallState, string> = {
    idle: 'OCIOSO',
    calling: 'CHAMANDO...',
    ringing: 'TOCANDO...',
    connected: 'CONECTADO',
    ended: 'CHAMADA ENCERRADA',
    declined: 'CHAMADA RECUSADA',
    'no-answer': 'SEM RESPOSTA',
    failed: 'FALHA NA CONEXÃO',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-cyber-bg"
    >
      {/* Remote video (full screen) */}
      {withVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full object-cover opacity-90"
          style={{ filter: 'contrast(1.1) saturate(1.2)' }}
        />
      )}

      {/* HUD overlay */}
      <div className="relative z-10 flex flex-col items-center gap-6">
        {/* Peer info */}
        <div className="text-center">
          <div className="mb-2 flex items-center justify-center gap-2">
            <motion.div
              animate={callState === 'connected' ? { scale: [1, 1.2, 1] } : {}}
              transition={{ duration: 1, repeat: callState === 'connected' ? Infinity : 0 }}
            >
              <Phone size={20} className="text-cyber-green glow-green" />
            </motion.div>
            <span className="font-mono text-2xl font-bold tracking-widest text-cyber-green glow-green">
              {peerNickname}
            </span>
          </div>
          <div className="font-mono text-xs tracking-widest text-cyber-text-dim">
            {stateLabels[callState]}
          </div>
          {callState === 'connected' && (
            <div className="mt-1 font-mono text-sm text-cyber-cyan">
              {formatDuration(duration)}
            </div>
          )}
        </div>

        {/* Audio level indicator */}
        {callState === 'connected' && !withVideo && (
          <div className="flex h-16 items-end gap-1">
            {Array.from({ length: 20 }).map((_, i) => (
              <motion.div
                key={i}
                className="w-1.5 rounded-full bg-cyber-green"
                animate={{ height: `${Math.max(audioLevel * 60 * Math.sin(i * 0.5 + Date.now() * 0.005) + 10, 4)}px` }}
                transition={{ duration: 0.1 }}
              />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 font-mono text-xs text-cyber-red glow-red">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* Local video preview (small) */}
        {withVideo && (
          <div className="absolute bottom-32 right-4 h-32 w-24 overflow-hidden clip-hud-sm border border-cyber-green/30">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-4">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={toggleMute}
            className={`flex h-14 w-14 items-center justify-center rounded-full border ${
              muted
                ? 'border-cyber-red/40 bg-cyber-red/10 text-cyber-red'
                : 'border-cyber-green/30 bg-cyber-green/10 text-cyber-green'
            } transition-colors`}
          >
            {muted ? <MicOff size={22} /> : <Mic size={22} />}
          </motion.button>

          {withVideo && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={toggleVideo}
              className={`flex h-14 w-14 items-center justify-center rounded-full border ${
                videoOff
                  ? 'border-cyber-red/40 bg-cyber-red/10 text-cyber-red'
                  : 'border-cyber-cyan/30 bg-cyber-cyan/10 text-cyber-cyan'
              } transition-colors`}
            >
              {videoOff ? <CameraOff size={22} /> : <Camera size={22} />}
            </motion.button>
          )}

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={handleEnd}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-cyber-red/40 bg-cyber-red/20 text-cyber-red transition-colors hover:bg-cyber-red/30"
          >
            <PhoneOff size={22} />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
