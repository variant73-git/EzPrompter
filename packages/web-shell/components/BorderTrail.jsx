'use client';

import { motion } from 'framer-motion';

/**
 * Animated light that travels along the parent's border — port of
 * motion-primitives' <BorderTrail /> on top of the framer-motion dep we
 * already ship (no new package).
 *
 * Usage: place inside a position:relative parent with a border-radius.
 * The ring div clips everything outside a thin border band (double-mask
 * intersect trick), and the glowing dot rides `offset-path: rect(...)`
 * around that band.
 *
 * Props:
 *   size     — diameter of the traveling glow dot (px)
 *   radius   — corner radius of the path; should match the parent's
 *              border-radius so the trail hugs the corners
 *   duration — seconds per full lap
 *   style    — merged into the dot (e.g. custom boxShadow)
 */
export default function BorderTrail({ size = 64, radius = 22, duration = 4.5, className = '', style }) {
  return (
    <div className={`border-trail-ring ${className}`.trim()} aria-hidden="true">
      <motion.div
        className="border-trail-dot"
        style={{
          width: size,
          height: size,
          offsetPath: `rect(0 auto auto 0 round ${radius}px)`,
          ...style,
        }}
        animate={{ offsetDistance: ['0%', '100%'] }}
        transition={{ repeat: Infinity, duration, ease: 'linear' }}
      />
    </div>
  );
}
