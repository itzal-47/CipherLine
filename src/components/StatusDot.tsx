import { motion } from 'framer-motion';

export function StatusDot({ online, size = 8 }: { online: boolean; size?: number }) {
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{
          backgroundColor: online ? 'rgb(var(--cyber-green))' : '#3a3a4e',
        }}
        animate={
          online
            ? {
                boxShadow: [
                  '0 0 0 0 rgba(0,255,157,0.5)',
                  '0 0 0 6px rgba(0,255,157,0)',
                ],
              }
            : {}
        }
        transition={{
          duration: 1.5,
          repeat: online ? Infinity : 0,
          ease: 'easeOut',
        }}
      />
      <span
        className="relative rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: online ? 'rgb(var(--cyber-green))' : '#3a3a4e',
          boxShadow: online ? '0 0 6px rgba(0,255,157,0.8)' : 'none',
        }}
      />
    </div>
  );
}
