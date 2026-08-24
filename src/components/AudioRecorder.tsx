import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, X, Send, Upload } from 'lucide-react';

interface AudioRecorderProps {
  onSend: (blob: Blob, durationSeconds: number) => void;
  onCancel: () => void;
}

export function AudioRecorder({ onSend, onCancel }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      stopRecording(true);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setError('');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('GRAVAÇÃO DE ÁUDIO INDISPONÍVEL NESTE NAVEGADOR/CONEXÃO (REQUER HTTPS)');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setPreviewBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
      };

      mr.start();
      setIsRecording(true);
      setDuration(0);
      setWaveform([]);

      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateWaveform = () => {
        analyser.getByteFrequencyData(dataArray);
        const bars: number[] = [];
        for (let i = 0; i < 24; i++) {
          const idx = Math.floor((i / 24) * dataArray.length);
          bars.push(dataArray[idx] / 255);
        }
        setWaveform(bars);
        rafRef.current = requestAnimationFrame(updateWaveform);
      };
      updateWaveform();

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('ACESSO AO MICROFONE NEGADO — VERIFIQUE AS PERMISSÕES DO NAVEGADOR');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('NENHUM MICROFONE ENCONTRADO NESTE DISPOSITIVO');
      } else if (name === 'NotReadableError') {
        setError('MICROFONE EM USO POR OUTRO APLICATIVO');
      } else {
        setError('FALHA AO ACESSAR MICROFONE — TENTE NOVAMENTE');
      }
    }
  };

  const stopRecording = (silent = false) => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!silent) setIsRecording(false);
  };

  const handleDiscard = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewBlob(null);
    setPreviewUrl(null);
    setDuration(0);
    setWaveform([]);
    onCancel();
  };

  const handleSend = () => {
    if (previewBlob) {
      onSend(previewBlob, duration);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      setError('FORMATO INVÁLIDO — SELECIONE UM ARQUIVO DE ÁUDIO');
      return;
    }
    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
      setPreviewBlob(blob);
      setPreviewUrl(url);
      setDuration(Math.ceil(audio.duration) || 0);
    };
    audio.onerror = () => {
      setError('FALHA AO CARREGAR ARQUIVO DE ÁUDIO');
      URL.revokeObjectURL(url);
    };
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="glass clip-hud-sm p-4">
      {error && (
        <div className="mb-3 font-mono text-xs text-cyber-red glow-red">{error}</div>
      )}

      {/* Recording state */}
      {isRecording && !previewUrl && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="h-3 w-3 rounded-full bg-cyber-red"
            />
            <span className="font-mono text-sm text-cyber-red glow-red">GRAVANDO</span>
            <span className="font-mono text-sm text-cyber-text-dim">{formatTime(duration)}</span>
          </div>
          <div className="flex h-12 items-center gap-0.5">
            {waveform.map((h, i) => (
              <motion.div
                key={i}
                className="w-1 rounded-full bg-cyber-green"
                animate={{ height: `${Math.max(h * 48, 4)}px` }}
                transition={{ duration: 0.05 }}
              />
            ))}
          </div>
          <button
            onClick={() => stopRecording(false)}
            className="clip-hud-sm flex items-center gap-2 border border-cyber-red/30 bg-cyber-red/10 px-6 py-3 font-mono text-xs tracking-widest text-cyber-red transition-colors hover:bg-cyber-red/20"
          >
            <Square size={14} />
            PARAR
          </button>
        </div>
      )}

      {/* Preview state */}
      {previewUrl && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 flex-1 items-center gap-0.5 overflow-hidden">
              {Array.from({ length: 40 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 shrink-0 rounded-full bg-cyber-green/40"
                  style={{ height: `${Math.sin(i * 0.5) * 15 + 20}px` }}
                />
              ))}
            </div>
            <span className="shrink-0 font-mono text-xs text-cyber-text-dim">{formatTime(duration)}</span>
          </div>
          <audio src={previewUrl} controls className="hidden" />
          <div className="flex gap-3">
            <button
              onClick={handleDiscard}
              className="clip-hud-sm flex flex-1 items-center justify-center gap-2 border border-cyber-text-faint/30 px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-red"
            >
              <X size={14} />
              DESCARTAR
            </button>
            <button
              onClick={handleSend}
              className="clip-hud-sm flex flex-1 items-center justify-center gap-2 border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20"
            >
              <Send size={14} />
              ENVIAR
            </button>
          </div>
        </div>
      )}

      {/* Idle state */}
      {!isRecording && !previewUrl && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-3">
            <button
              onClick={startRecording}
              className="clip-hud-sm flex items-center gap-2 border border-cyber-green/30 bg-cyber-green/10 px-6 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20"
            >
              <Mic size={14} />
              GRAVAR ÁUDIO
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="clip-hud-sm flex items-center gap-2 border border-cyber-cyan/30 bg-cyber-cyan/10 px-6 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20"
            >
              <Upload size={14} />
              ANEXAR
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
          <button
            onClick={onCancel}
            className="font-mono text-[10px] tracking-widest text-cyber-text-faint transition-colors hover:text-cyber-red"
          >
            CANCELAR
          </button>
        </div>
      )}
    </div>
  );
}
