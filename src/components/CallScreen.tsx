import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Phone, PhoneOff, Mic, MicOff, Camera, CameraOff, AlertTriangle, X } from 'lucide-react';
import {
  createPeerConnection,
  sendOnChannel,
  subscribeSignaling,
  getUserMediaStream,
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
  onEnd: (reason?: 'failed') => void;
}

const CALL_TIMEOUT_MS = 30000;
const ICE_RESTART_MAX_ATTEMPTS = 3;
const CONNECT_WARN_MS = 20000;

export function CallScreen({
  roomId,
  myId,
  peerId,
  peerNickname,
  withVideo,
  isInitiator,
  onEnd,
}: CallScreenProps) {
  // Both sides start in 'calling'. The callee does not need 'ringing' because
  // the incoming-call modal is handled by ChatScreen before this component mounts.
  const [callState, setCallState] = useState<CallState>('calling');
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const videoOffRef = useRef(videoOff);
  useEffect(() => {
    videoOffRef.current = videoOff;
  }, [videoOff]);

  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [callQuality, setCallQuality] = useState<'good' | 'fair' | 'poor' | null>(null);
  const [suggestAudioOnly, setSuggestAudioOnly] = useState(false);
  const poorStreakRef = useRef(0);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPacketsLostRef = useRef(0);
  const lastPacketsReceivedRef = useRef(0);

  // callStateRef keeps the most recent callState readable inside callbacks
  // that were created earlier (e.g. the 30s timeout). Without this, the
  // timeout sees the value from mount time and fires even after the call
  // was already answered.
  const callStateRef = useRef(callState);
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

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
  const signalChannelRef = useRef<ReturnType<typeof subscribeSignaling> | null>(null);
  const iceRestartAttemptsRef = useRef(0);
  const disconnectGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ICE candidates that arrived before setRemoteDescription. Buffered here
  // and drained right after setRemoteDescription succeeds. Without this,
  // candidates on slow networks are silently lost and the call fails.
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    if (disconnectGraceTimerRef.current) {
      clearTimeout(disconnectGraceTimerRef.current);
      disconnectGraceTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    pendingIceCandidatesRef.current = [];
    remoteDescriptionSetRef.current = false;
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
    if (signalChannelRef.current) {
      sendOnChannel(signalChannelRef.current, myId, peerId, 'call-end', {}).catch(() => {});
    }
    cleanup();
    onEnd();
  }, [myId, peerId, cleanup, onEnd]);

  useEffect(() => {
    let unsub: ReturnType<typeof subscribeSignaling> | null = null;

    const applyRemoteDescription = async (pc: RTCPeerConnection, desc: RTCSessionDescriptionInit) => {
      await pc.setRemoteDescription(desc);
      remoteDescriptionSetRef.current = true;
      // Drain candidates that arrived while we were still setting up
      const queued = pendingIceCandidatesRef.current;
      pendingIceCandidatesRef.current = [];
      for (const c of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch {
          // candidate late or invalid, ignore
        }
      }
    };

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

        statsIntervalRef.current = setInterval(async () => {
          if (!pcRef.current) return;
          try {
            const stats = await pcRef.current.getStats();
            let packetsLost = 0;
            let packetsReceived = 0;
            stats.forEach((report) => {
              if (report.type === 'inbound-rtp' && !report.isRemote) {
                packetsLost += report.packetsLost || 0;
                packetsReceived += report.packetsReceived || 0;
              }
            });
            const deltaLost = packetsLost - lastPacketsLostRef.current;
            const deltaReceived = packetsReceived - lastPacketsReceivedRef.current;
            lastPacketsLostRef.current = packetsLost;
            lastPacketsReceivedRef.current = packetsReceived;
            const total = deltaLost + deltaReceived;
            if (total > 0) {
              const lossRatio = deltaLost / total;
              if (lossRatio > 0.15) {
                setCallQuality('poor');
                poorStreakRef.current += 1;
                if (poorStreakRef.current >= 4 && withVideo && !videoOffRef.current) {
                  setSuggestAudioOnly(true);
                }
              } else if (lossRatio > 0.05) {
                setCallQuality('fair');
                poorStreakRef.current = 0;
              } else {
                setCallQuality('good');
                poorStreakRef.current = 0;
                setSuggestAudioOnly(false);
              }
            }
          } catch {
            // getStats unavailable, no indicator, no problem
          }
        }, 3000);

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
          if (e.candidate && signalChannelRef.current) {
            sendOnChannel(signalChannelRef.current, myId, peerId, 'ice', e.candidate.toJSON()).catch(() => {});
          }
        };

        const attemptIceRestart = async () => {
          if (iceRestartAttemptsRef.current >= ICE_RESTART_MAX_ATTEMPTS) {
            setCallState('failed');
            setError('REDE INSTAVEL - CHAMADA ENCERRADA');
            setTimeout(() => onEnd('failed'), 2000);
            return;
          }
          iceRestartAttemptsRef.current += 1;
          try {
            pc.restartIce();
            if (isInitiator) {
              const offer = await pc.createOffer({ iceRestart: true });
              await pc.setLocalDescription(offer);
              if (signalChannelRef.current) {
                await sendOnChannel(signalChannelRef.current, myId, peerId, 'offer', offer);
              }
            }
          } catch {
            // try again on the next disconnected/failed cycle
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') {
            iceRestartAttemptsRef.current = 0;
            if (disconnectGraceTimerRef.current) {
              clearTimeout(disconnectGraceTimerRef.current);
              disconnectGraceTimerRef.current = null;
            }
            setCallState('connected');
            setError('');
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            if (!timerRef.current) {
              timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
            }
          } else if (pc.connectionState === 'disconnected') {
            setCallState('reconnecting');
            setError('CONEXAO INSTAVEL - RECONECTANDO...');
            if (!disconnectGraceTimerRef.current) {
              disconnectGraceTimerRef.current = setTimeout(() => {
                disconnectGraceTimerRef.current = null;
                if (pc.connectionState !== 'connected') {
                  attemptIceRestart();
                }
              }, 3000);
            }
          } else if (pc.connectionState === 'failed') {
            setCallState('reconnecting');
            setError('CONEXAO INSTAVEL - RECONECTANDO...');
            attemptIceRestart();
          }
        };

        // Signaling handler
        unsub = subscribeSignaling(roomId, myId, async (msg: SignalingMessage) => {
          if (msg.from !== peerId) return;

          switch (msg.type) {
            case 'call-accept': {
              // Only the caller reacts to this. The callee never receives
              // its own call-accept (sendOnChannel targets peerId).
              if (!isInitiator) break;
              // Callee answered: NOW we create and send the offer.
              try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (signalChannelRef.current) {
                  await sendOnChannel(signalChannelRef.current, myId, peerId, 'offer', offer);
                }
              } catch {
                setError('FALHA AO NEGOCIAR CONEXAO');
              }
              // Do NOT mark 'connected' yet. Wait for the WebRTC connection
              // state to actually reach 'connected'. Warn if too slow.
              setTimeout(() => {
                if (pcRef.current && pcRef.current.connectionState !== 'connected' && callStateRef.current === 'calling') {
                  setError('CONEXAO INSTAVEL - TENTANDO RESTABELECER');
                }
              }, CONNECT_WARN_MS);
              break;
            }
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
            case 'offer': {
              if (isInitiator) break;
              try {
                await applyRemoteDescription(pc, msg.payload);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                if (signalChannelRef.current) {
                  await sendOnChannel(signalChannelRef.current, myId, peerId, 'answer', answer);
                }
              } catch {
                setError('FALHA AO NEGOCIAR CONEXAO');
              }
              break;
            }
            case 'answer': {
              if (!isInitiator) break;
              try {
                await applyRemoteDescription(pc, msg.payload);
              } catch {
                setError('FALHA AO ESTABELECER CONEXAO');
              }
              break;
            }
            case 'ice': {
              if (!remoteDescriptionSetRef.current) {
                pendingIceCandidatesRef.current.push(msg.payload);
                break;
              }
              try {
                await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
              } catch {
                // late ICE candidate, ignore
              }
              break;
            }
          }
        });
        signalChannelRef.current = unsub;

        if (isInitiator) {
          // Caller: announce the call. Do NOT send an offer yet - wait for
          // call-accept. This prevents the offer being lost while the
          // callee has not even mounted its CallScreen.
          if (signalChannelRef.current) {
            sendOnChannel(signalChannelRef.current, myId, peerId, 'call-start', { withVideo }).catch(() => {});
          }
          timeoutRef.current = setTimeout(() => {
            if (callStateRef.current === 'calling') {
              setCallState('no-answer');
              cleanup();
              setTimeout(() => onEnd(), 1500);
            }
          }, CALL_TIMEOUT_MS);
        } else {
          // Callee: the fact that this component is mounting means the user
          // already accepted (ChatScreen only mounts CallScreen after that).
          // Signal acceptance so the caller can send the offer.
          if (signalChannelRef.current) {
            sendOnChannel(signalChannelRef.current, myId, peerId, 'call-accept', {}).catch(() => {});
          }
        }
      } catch (err: unknown) {
        const name = (err as Error)?.name;
        if (name === 'NotAllowedError') {
          setError('ACESSO AO MICROFONE/CAMERA NEGADO - VERIFIQUE AS PERMISSOES');
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
    reconnecting: 'RECONECTANDO...',
    ended: 'CHAMADA ENCERRADA',
    declined: 'CHAMADA RECUSADA',
    'no-answer': 'SEM RESPOSTA',
    failed: 'FALHA NA CONEXAO',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-cyber-bg"
    >
      {withVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full object-cover opacity-90"
          style={{ filter: 'contrast(1.1) saturate(1.2)' }}
        />
      )}

      <div className="relative z-10 flex flex-col items-center gap-6">
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
          {(callState === 'connected' || callState === 'reconnecting') && (
            <div className="mt-1 flex items-center justify-center gap-2 font-mono text-sm text-cyber-cyan">
              {formatDuration(duration)}
              {callQuality && (
                <span className="flex items-end gap-0.5" title={`Qualidade: ${callQuality}`}>
                  {[1, 2, 3].map((bar) => {
                    const active = callQuality === 'good' ? 3 : callQuality === 'fair' ? 2 : 1;
                    const color =
                      callQuality === 'good'
                        ? 'bg-cyber-green'
                        : callQuality === 'fair'
                          ? 'bg-cyber-amber'
                          : 'bg-red-400';
                    return (
                      <span
                        key={bar}
                        className={`w-1 rounded-sm ${bar <= active ? color : 'bg-cyber-text-dim/20'}`}
                        style={{ height: `${bar * 3 + 2}px` }}
                      />
                    );
                  })}
                </span>
              )}
            </div>
          )}
        </div>

        {suggestAudioOnly && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 border border-cyber-amber/40 bg-cyber-amber/10 px-4 py-2 font-mono text-xs text-cyber-amber"
          >
            <span>REDE FRACA - DESLIGAR VIDEO MELHORA A LIGACAO?</span>
            <button
              onClick={() => {
                toggleVideo();
                setSuggestAudioOnly(false);
              }}
              className="shrink-0 border border-cyber-amber/60 px-2 py-1 tracking-widest hover:bg-cyber-amber/20"
            >
              DESLIGAR
            </button>
            <button
              onClick={() => setSuggestAudioOnly(false)}
              className="shrink-0 text-cyber-text-dim hover:text-cyber-text"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}

        {(callState === 'connected' || callState === 'reconnecting') && !withVideo && (
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

        {error && (
          <div className="flex items-center gap-2 font-mono text-xs text-cyber-red glow-red">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

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