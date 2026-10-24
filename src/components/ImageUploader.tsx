import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Send, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { compressImage } from '@/lib/media';

interface ImageUploaderProps {
  onSend: (blob: Blob) => void;
  onCancel: () => void;
}

export function ImageUploader({ onSend, onCancel }: ImageUploaderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null);
  const [error, setError] = useState('');
  const [compressing, setCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('FORMATO INVÁLIDO — SELECIONE UMA IMAGEM');
      return;
    }

    setCompressing(true);
    setError('');
    try {
      const blob = await compressImage(file);
      setCompressedBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setError('FALHA AO PROCESSAR IMAGEM');
    } finally {
      setCompressing(false);
    }
  };

  const handleSend = () => {
    if (compressedBlob) {
      onSend(compressedBlob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
  };

  const handleDiscard = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCompressedBlob(null);
    onCancel();
  };

  return (
    <div className="glass clip-hud-sm p-4">
      {error && (
        <div className="mb-3 flex items-center gap-2 font-mono text-xs text-cyber-red glow-red">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {compressing && (
        <div className="py-4 text-center font-mono text-xs text-cyber-cyan/60">
          PROCESSANDO IMAGEM...
        </div>
      )}

      {previewUrl && !compressing && (
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden clip-hud-sm border border-cyber-green/20">
            <img src={previewUrl} alt="preview" className="max-h-64 w-full object-contain" />
            <motion.div
              className="absolute left-0 top-0 h-full w-0.5 bg-cyber-green/60"
              initial={{ y: '-100%' }}
              animate={{ y: '100%' }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            />
          </div>
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

      {!previewUrl && !compressing && (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="clip-hud-sm flex items-center gap-2 border border-cyber-cyan/30 bg-cyber-cyan/10 px-6 py-3 font-mono text-xs tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20"
          >
            <ImageIcon size={14} />
            SELECIONAR IMAGEM
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
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
