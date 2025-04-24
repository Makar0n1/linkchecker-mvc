import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';

import LinkAnalysisIllustration from '../../assets/images/link-analysis-illustration.jpg';
import WorkflowIllustration from '../../assets/images/workflow-illustration.png';
import AccurateAnalysis from '../../assets/images/accurate-analysis.png';
import MultiUserSupport from '../../assets/images/multi-user-support.png';
import AutomatedSupport from '../../assets/images/automated-support.png';

const StartPage = () => {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      const fetchUser = async () => {
        try {
          const response = await axios.get(`${apiBaseUrl}/user`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          setUser(response.data);
        } catch (err) {
          localStorage.removeItem('token');
        }
      };
      fetchUser();
    }
  }, []);

  const fadeInUp = {
    hidden: { opacity: 0, y: 50 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' } },
  };

  const staggerContainer = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.2 } },
  };

  return (
    <div className="bg-gray-100 min-h-screen flex flex-col overflow-x-hidden">
      <header className="bg-green-600 text-white py-4 shadow-lg sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 flex justify-between items-center">
          <motion.h1
            onClick={() => navigate('/')}
            className="text-2xl sm:text-3xl font-bold tracking-tight cursor-pointer"
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
          >
            LinkSentry
          </motion.h1>
          <div className="flex items-center gap-2 sm:gap-4">
            {user && <span className="text-green-100 text-sm sm:text-base hidden sm:inline">Logged in as: {user.username}</span>}
            <Link to={user ? '/app/projects' : '/login'}> {/* Убрали путь /register */}
              <motion.button
                className="bg-white text-green-600 px-3 sm:px-5 py-1 sm:py-2 rounded-full font-semibold hover:bg-green-100 transition-all shadow-md text-sm sm:text-base"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {user ? 'Start Analyse' : 'Login'} {/* Заменили Register на Login */}
              </motion.button>
            </Link>
          </div>
        </div>
      </header>

      <section className="relative bg-gradient-to-b from-green-500 to-green-700 text-white py-12 sm:py-20 overflow-hidden">
        <div className="absolute inset-0">
          <motion.img
            src={LinkAnalysisIllustration}
            alt="Link Analysis Background"
            className="w-full h-full object-cover opacity-40"
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
          />
          <div className="absolute inset-0 bg-black opacity-50" />
        </div>
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 text-center relative z-10">
          <motion.h2
            className="text-4xl sm:text-5xl md:text-6xl font-extrabold mb-6 leading-tight"
            variants={fadeInUp}
            initial="hidden"
            animate="visible"
          >
            Analyze Your Backlinks with Ease
          </motion.h2>
          <motion.p
            className="text-lg sm:text-xl md:text-2xl mb-8 max-w-3xl mx-auto"
            variants={fadeInUp}
            initial="hidden"
            animate="visible"
          >
            Discover where your site is linked, check indexability, and boost your SEO with LinkSentry.
          </motion.p>
          <Link to={user ? '/app/projects' : '/login'}> {/* Убрали путь /register */}
            <motion.button
              className="bg-white text-green-600 px-6 sm:px-8 py-2 sm:py-3 rounded-full font-semibold text-base sm:text-lg hover:bg-green-100 transition-all shadow-lg"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              Get Started
            </motion.button>
          </Link>
        </div>
      </section>

      <section className="py-12 sm:py-16 bg-white">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6">
          <motion.h3
            className="text-3xl sm:text-4xl font-bold text-center text-gray-800 mb-8 sm:mb-12"
            variants={fadeInUp}
            initial="hidden"
            animate="visible"
          >
            Why Choose LinkSentry?
          </motion.h3>
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
          >
            <motion.div className="bg-green-50 p-4 sm:p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow flex flex-col items-center text-center" variants={fadeInUp}>
              <div className="w-20 sm:w-24 h-20 sm:h-24 mb-4 flex items-center justify-center">
                <img src={AccurateAnalysis} alt="Accurate Analysis" className="max-w-full max-h-full object-contain" />
              </div>
              <h4 className="text-lg sm:text-xl font-semibold text-green-600 mb-2">Accurate Analysis</h4>
              <p className="text-gray-600 text-sm sm:text-base">Leverage Puppeteer and 2Captcha to get precise backlink data, even from protected sites.</p>
            </motion.div>
            <motion.div className="bg-green-50 p-4 sm:p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow flex flex-col items-center text-center" variants={fadeInUp}>
              <div className="w-20 sm:w-24 h-20 sm:h-24 mb-4 flex items-center justify-center">
                <img src={MultiUserSupport} alt="Multi-User Support" className="max-w-full max-h-full object-contain" />
              </div>
              <h4 className="text-lg sm:text-xl font-semibold text-green-600 mb-2">Multi-User Support</h4>
              <p className="text-gray-600 text-sm sm:text-base">Up to 5 users can work independently, with separate data storage for each.</p>
            </motion.div>
            <motion.div className="bg-green-50 p-4 sm:p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow flex flex-col items-center text-center" variants={fadeInUp}>
              <div className="w-20 sm:w-24 h-20 sm:h-24 mb-4 flex items-center justify-center">
                <img src={AutomatedSupport} alt="Automated Reports" className="max-w-full max-h-full object-contain" />
              </div>
              <h4 className="text-lg sm:text-xl font-semibold text-green-600 mb-2">Automated Reports</h4>
              <p className="text-gray-600 text-sm sm:text-base">Get detailed reports synced with Google Sheets, updated every 6 hours.</p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section className="py-12 sm:py-16 bg-gray-100">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6">
          <motion.h3
            className="text-3xl sm:text-4xl font-bold text-center text-gray-800 mb-8 sm:mb-12"
            variants={fadeInUp}
            initial="hidden"
            animate="visible"
          >
            How It Works
          </motion.h3>
          <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-12">
            <motion.div className="w-full sm:w-1/2" variants={fadeInUp} initial="hidden" animate="visible">
              <img src={WorkflowIllustration} alt="Workflow Illustration" className="w-full rounded-lg shadow-lg" />
            </motion.div>
            <motion.ul className="w-full sm:w-1/2 space-y-4 sm:space-y-6 text-base sm:text-lg text-gray-600" variants={staggerContainer} initial="hidden" animate="visible">
              <motion.li variants={fadeInUp}><strong className="text-green-600">Step 1:</strong> Add your URLs manually or via Google Sheets.</motion.li>
              <motion.li variants={fadeInUp}><strong className="text-green-600">Step 2:</strong> Specify the target domain to track.</motion.li>
              <motion.li variants={fadeInUp}><strong className="text-green-600">Step 3:</strong> Let our system analyze and generate reports.</motion.li>
              <motion.li variants={fadeInUp}><strong className="text-green-600">Step 4:</strong> Review detailed insights and optimize your SEO.</motion.li>
            </motion.ul>
          </div>
        </div>
      </section>

      <section className="bg-green-600 text-white py-12 sm:py-16">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <motion.h3
            className="text-3xl sm:text-4xl font-bold mb-6"
            variants={fadeInUp}
            initial="hidden"
            animate="visible"
          >
            Ready to Boost Your SEO?
          </motion.h3>
          <motion.p
            className="text-lg sm:text-xl mb-8 max-w-2xl mx-auto"
            variants={fadeInUp}
            initial="hidden"
            animate="visible"
          >
            Join thousands of users who trust LinkSentry to monitor their backlinks effortlessly.
          </motion.p>
          <Link to={user ? '/app/projects' : '/login'}> {/* Убрали путь /register */}
            <motion.button
              className="bg-white text-green-600 px-6 sm:px-8 py-2 sm:py-3 rounded-full font-semibold text-base sm:text-lg hover:bg-green-100 transition-all shadow-lg"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              Get Started
            </motion.button>
          </Link>
        </div>
      </section>

      <footer className="bg-gray-800 text-white py-4 sm:py-6">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-sm sm:text-base">© 2025 Link-Check-Pro.Top | All rights reserved.</p>
          <p className="mt-2 text-sm sm:text-base">
            Created by Kirill Shtepa{' '}
            <a href="https://github.com/Makar0n1/" className="underline hover:text-green-400">
              github.com/Makar0n1
            </a>{' '}
            | Have a great day! :)
          </p>
        </div>
      </footer>
    </div>
  );
};

export default StartPage;