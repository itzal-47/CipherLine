import { useEffect, useRef, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Lock } from 'lucide-react';
import { downloadAndDecryptAudio } from '@/lib/media';
import type { RoomCrypto } from '@/lib/roomCrypto';

interface AudioPlayerProps {
  storagePath: string;
  rc: RoomCrypto;
  messageId: string;
  durationSeconds: number | null;
  isScrambled: boolean;
  onDecode: () => void;
  onPlay?: () => void;
}

export function AudioPlayer({ storagePath, rc, messageId, durationSeconds, isScrambled, onDecode, onPlay }: AudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [error, setError] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleDecode = async () => {
    if (audioUrl) {
      togglePlay();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const blob = await downloadAndDecryptAudio(storagePath, rc, { messageId, type: 'audio' });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      onDecode();

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onloadedmetadata = () => {
        if (audio.duration && !isNaN(audio.duration)) {
          setDuration(Math.ceil(audio.duration));
        }
      };
      audio.ontimeupdate = () => {
        setCurrentTime(audio.currentTime);
        if (audio.duration) {
          setProgress((audio.currentTime / audio.duration) * 100);
        }
      };
      audio.onended = () => {
        setPlaying(false);
        setProgress(0);
        setCurrentTime(0);
      };
      audio.play().then(() => { setPlaying(true); onPlay?.(); }).catch(() => setError('FALHA AO REPRODUZIR ÁUDIO'));
    } catch {
      setError('FALHA AO DECODIFICAR ÁUDIO');
    } finally {
      setLoading(false);
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => { setPlaying(true); onPlay?.(); }).catch(() => {});
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const waveformBars = useMemo(() => {
    return Array.from({ length: 32 }, (_, i) => {
      return isScrambled ? Math.random() * 20 + 4 : Math.sin(i * 0.4) * 12 + 16;
    });
  }, [isScrambled]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {error && <span className="font-mono text-[10px] text-cyber-red">{error}</span>}
      <div className="flex items-center gap-3">
        <button
          onClick={handleDecode}
          disabled={loading}
          className="shrink-0 text-cyber-green transition-colors hover:text-cyber-green-dim disabled:opacity-50"
        >
          {isScrambled ? <Lock size={20} className="text-cyber-amber" /> : playing ? <Pause size={20} /> : <Play size={20} />}
        </button>

        <div className="flex h-8 flex-1 items-center gap-0.5 overflow-hidden">
          {waveformBars.map((h, i) => {
            const active = isScrambled ? false : (i / 32) * 100 < progress;
            return (
              <motion.div
                key={i}
                className={`w-1 shrink-0 rounded-full ${active ? 'bg-cyber-green' : isScrambled ? 'bg-cyber-amber/40' : 'bg-cyber-green/30'}`}
                style={{ height: `${h}px` }}
                animate={isScrambled ? { opacity: [0.3, 0.7, 0.3] } : {}}
                transition={isScrambled ? { duration: 0.5, repeat: Infinity, delay: i * 0.02 } : {}}
              />
            );
          })}
        </div>

        <span className="shrink-0 font-mono text-[10px] text-cyber-text-faint">
          {isScrambled ? '?? : ??' : `${formatTime(currentTime)} / ${formatTime(duration)}`}
        </span>
      </div>
      {loading && <span className="font-mono text-[10px] text-cyber-cyan/60">DECODIFICANDO...</span>}
    </div>
  );
}