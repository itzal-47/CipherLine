import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { downloadAndDecryptImage } from '@/lib/media';

interface ImageViewerProps {
  storagePath: string;
  roomCode: string;
  onClose: () => void;
}

export function ImageViewer({ storagePath, roomCode, onClose }: ImageViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let revokeUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const blob = await downloadAndDecryptImage(storagePath, roomCode);
        if (cancelled) return;
        revokeUrl = URL.createObjectURL(blob);
        setUrl(revokeUrl);
      } catch {
        // falha silenciosa — o fallback visual mostra "CARREGANDO..." eterno
      }
    })();

    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [storagePath, roomCode]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md"
        onClick={onClose}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 text-cyber-text-dim transition-colors hover:text-cyber-red"
        >
          <X size={24} />
        </button>

        {url && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0, filter: 'blur(10px)' }}
            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
            exit={{ scale: 0.9, opacity: 0, filter: 'blur(10px)' }}
            transition={{ duration: 0.3 }}
            className="relative max-h-full max-w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={url}
              alt="fullscreen"
              className="max-h-[90vh] max-w-[90vw] object-contain"
              onLoad={() => setLoaded(true)}
            />
            {loaded && (
              <motion.div
                className="absolute left-0 top-0 h-full w-1 bg-cyber-green/50"
                initial={{ y: '-100%' }}
                animate={{ y: '100%' }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              />
            )}
          </motion.div>
        )}

        {!url && (
          <div className="font-mono text-xs text-cyber-text-dim">CARREGANDO...</div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}