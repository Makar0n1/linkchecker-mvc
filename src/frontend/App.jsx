import React from 'react';
import Dashboard from './components/Dashboard';
import ScrollToTopButton from './components/ScrollToTopButton';

const App = () => (
  <div className="bg-gray-100 font-sans">
    <Dashboard />
    <ScrollToTopButton />
  </div>
);

export default App;