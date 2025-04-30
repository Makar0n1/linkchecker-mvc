import React, { createContext, useState, useEffect } from 'react';

export const CookieContext = createContext();

export const CookieProvider = ({ children }) => {
  const [hasCookieConsent, setHasCookieConsent] = useState(true); // По умолчанию true, пока не загружено из localStorage

  useEffect(() => {
    const consent = localStorage.getItem('cookieConsent');
    if (consent) {
      setHasCookieConsent(consent === 'accepted');
    }
  }, []);

  return (
    <CookieContext.Provider value={{ hasCookieConsent, setHasCookieConsent }}>
      {children}
    </CookieContext.Provider>
  );
};
