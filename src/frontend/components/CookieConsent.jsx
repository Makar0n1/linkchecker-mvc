import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const CookieConsent = ({ onConsentChange }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookieConsent');
    if (!consent) {
      setIsVisible(true); // Показываем уведомление, если выбор ещё не сделан
    } else {
      onConsentChange(consent === 'accepted'); // Передаём статус согласия
    }
  }, [onConsentChange]);

  const handleAccept = () => {
    localStorage.setItem('cookieConsent', 'accepted');
    setIsVisible(false);
    onConsentChange(true);
  };

  const handleDecline = () => {
    localStorage.setItem('cookieConsent', 'declined');
    setIsVisible(false);
    onConsentChange(false);
  };

  if (!isVisible) return null;

  return (
    <motion.div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-lg">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Cookie Consent</h3>
        <p className="text-gray-600 text-sm mb-6">
          We use cookies to ensure the best experience on our website. Cookies are necessary for authentication and session management. By accepting, you agree to our use of cookies. You can decline, but some features may not work.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={handleAccept}
            className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
          >
            Accept
          </button>
          <button
            onClick={handleDecline}
            className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition-colors"
          >
            Decline
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default CookieConsent;