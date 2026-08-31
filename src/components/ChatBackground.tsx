import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

export type BackgroundMode = 'default' | 'parallax' | 'reactive';

interface ChatBackgroundProps {
  imageUrl: string;
  mode: BackgroundMode;
  /** Incrementa a cada mensagem nova, dispara o pulso do modo "reactive" */
  pulseKey: number;
}

export function ChatBackground({ imageUrl, mode, pulseKey }: ChatBackgroundProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Modo PARALLAX: giroscópio no mobile, mouse no desktop
  useEffect(() => {
    if (mode !== 'parallax') return;

    const MAX_OFFSET = 12;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma ?? 0; // esquerda/direita, -90 a 90
      const beta = e.beta ?? 0; // frente/trás, -180 a 180
      setOffset({
        x: Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, gamma / 3)),
        y: Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, (beta - 45) / 4)),
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width - 0.5;
      const relY = (e.clientY - rect.top) / rect.height - 0.5;
      setOffset({ x: relX * MAX_OFFSET * 2, y: relY * MAX_OFFSET * 2 });
    };

    const isMobile = 'ontouchstart' in window;

    if (isMobile && typeof DeviceOrientationEvent !== 'undefined') {
      const DOEAny = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (typeof DOEAny.requestPermission === 'function') {
        // iOS exige permissão explícita — pede silenciosamente; se negar,
        // o fundo simplesmente fica parado (sem quebrar nada)
        DOEAny.requestPermission().then((res) => {
          if (res === 'granted') {
            window.addEventListener('deviceorientation', handleOrientation);
          }
        }).catch(() => {});
      } else {
        window.addEventListener('deviceorientation', handleOrientation);
      }
    } else {
      window.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [mode]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <motion.img
        src={imageUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center"
        style={{
          filter: mode === 'default' ? 'none' : 'brightness(0.5) blur(1px)',
        }}
        animate={
          mode === 'parallax'
            ? { x: offset.x, y: offset.y, scale: 1.08 }
            : mode === 'reactive'
              ? { opacity: [0.2, 0.32, 0.2] }
              : { opacity: 1 }
        }
        transition={
          mode === 'parallax'
            ? { type: 'spring', stiffness: 40, damping: 15 }
            : mode === 'reactive'
              ? { duration: 2, repeat: Infinity }
              : { duration: 0 }
        }
      />

      {/* Escurecimento para manter legibilidade — não se aplica ao modo
          "padrão", que deve ficar exatamente como a imagem original, sem
          nenhum gradiente ou efeito da plataforma por cima. */}
      {mode !== 'default' && <div className="absolute inset-0 bg-cyber-bg/70" />}

      {mode === 'reactive' && (
        <motion.div
          key={pulseKey}
          className="absolute inset-0 bg-cyber-cyan/10"
          initial={{ opacity: 0.35 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
        />
      )}
    </div>
  );
}
