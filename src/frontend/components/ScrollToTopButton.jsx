import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Кастомная функция скролла с easing
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const smoothScrollTo = (target, duration = 1500) => {
  let start = window.scrollY;
  let end = target;

  const startTime = performance.now();

  const animateScroll = (currentTime) => {
    const elapsedTime = currentTime - startTime;
    const progress = Math.min(elapsedTime / duration, 1);
    const easedProgress = easeInOutCubic(progress);

    window.scrollTo(0, start + (end - start) * easedProgress);

    if (progress < 1) {
      requestAnimationFrame(animateScroll);
    }
  };

  requestAnimationFrame(animateScroll);
};

const ScrollToTopButton = () => {
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 300) {
        setShowScrollToTop(true);
      } else {
        setShowScrollToTop(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <AnimatePresence>
        {showScrollToTop && (
          <motion.button
            onClick={() => smoothScrollTo(0, 1500)}
            className="opacity-70 fixed bottom-20 right-4 sm:bottom-8 sm:right-8 bg-green-500 text-white p-3 rounded-full shadow-lg hover:bg-green-600 transition-colors z-50"
            initial={{ opacity: 0, y: 20, scale: 0.5, rotate: -90 }}
            animate={{ opacity: 0.7, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, y: 20, scale: 0.5, rotate: -90 }}
            transition={{
                type: "spring",
                stiffness: 260,
                damping: 20,
                duration: 0.5,
                delay: 0.1,
            }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
};

export default ScrollToTopButton;