import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { CookieProvider, CookieContext } from './components/CookieContext';
import CookieConsent from './components/CookieConsent';
import './styles.css';

const CookieConsentWrapper = ({ children }) => {
  const { setHasCookieConsent } = React.useContext(CookieContext);
  return (
    <>
      <CookieConsent onConsentChange={setHasCookieConsent} />
      {children}
    </>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <CookieProvider>
    <CookieConsentWrapper>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </CookieConsentWrapper>
  </CookieProvider>
);