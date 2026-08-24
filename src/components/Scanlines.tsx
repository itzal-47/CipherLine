import { motion } from 'framer-motion';

export function Scanlines() {
  return (
    <>
      <div className="scanlines" />
      <motion.div
        className="pointer-events-none fixed left-0 right-0 h-32 z-[9999]"
        style={{
          background:
            'linear-gradient(to bottom, transparent, rgba(0,255,157,0.04), transparent)',
        }}
        initial={{ top: '-8rem' }}
        animate={{ top: '100vh' }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: 'linear',
        }}
      />
    </>
  );
}
