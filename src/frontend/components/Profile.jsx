import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { CookieContext } from './CookieContext';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const Profile = () => {
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [links, setLinks] = useState([]);
  const [spreadsheets, setSpreadsheets] = useState([]);
  const [profile, setProfile] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [paymentDetails, setPaymentDetails] = useState({ cardNumber: '', cardHolder: '', expiryDate: '', cvv: '' });
  const [autoPay, setAutoPay] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [activeTab, setActiveTab] = useState('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const [modal, setModal] = useState({ isOpen: false, message: '', onConfirm: null, isConfirm: false });
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const context = useContext(CookieContext);
const hasCookieConsent = context ? context.hasCookieConsent : true;
  const [cookieError, setCookieError] = useState(null);

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    const fetchUser = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/user`, {
          withCredentials: true,
        });
        setUser(response.data);
        setProfile({
          firstName: response.data.profile?.firstName || '',
          lastName: response.data.profile?.lastName || '',
          email: response.data.profile?.email || '',
          phone: response.data.profile?.phone || '',
        });
        setPaymentDetails({
          cardNumber: response.data.paymentDetails?.cardNumber || '',
          cardHolder: response.data.paymentDetails?.cardHolder || '',
          expiryDate: response.data.paymentDetails?.expiryDate || '',
          cvv: response.data.paymentDetails?.cvv || '',
        });
        setAutoPay(response.data.autoPay || false);
        if (response.data.paymentDetails?.cardNumber) {
          setIsAddingPayment(false);
        } else {
          setIsAddingPayment(true);
        }
      } catch (err) {
        setModal({
          isOpen: true,
          message: 'Failed to fetch user data. Please log in again.',
          onConfirm: () => {
            navigate('/login');
          },
          isConfirm: false,
        });
      }
    };

    const fetchProjectsAndData = async () => {
      try {
        const projectsResponse = await axios.get(`${apiBaseUrl}/projects`, {
          withCredentials: true,
        });
        setProjects(projectsResponse.data);

        const allLinks = [];
        const allSpreadsheets = [];
        for (const project of projectsResponse.data) {
          const linksResponse = await axios.get(`${apiBaseUrl}/${project._id}/links`, {
            withCredentials: true,
          });
          allLinks.push(...linksResponse.data);

          const spreadsheetsResponse = await axios.get(`${apiBaseUrl}/${project._id}/spreadsheets`, {
            withCredentials: true,
          });
          allSpreadsheets.push(...spreadsheetsResponse.data);
        }
        setLinks(allLinks);
        setSpreadsheets(allSpreadsheets);
      } catch (err) {
        setError('Failed to fetch projects, links, or spreadsheets.');
        setLinks([]);
        setSpreadsheets([]);
      }
    };

    fetchUser();
    fetchProjectsAndData();
  }, [navigate]);

  const handleProfileUpdate = async (e) => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    e.preventDefault();
    try {
      await axios.put(`${apiBaseUrl}/profile`, profile, {
        withCredentials: true,
      });
      setModal({
        isOpen: true,
        message: 'Profile updated successfully',
        onConfirm: null,
        isConfirm: false,
      });
      setIsEditing(false);
      const response = await axios.get(`${apiBaseUrl}/user`, {
        withCredentials: true,
      });
      setUser(response.data);
      setError(null);
    } catch (err) {
      setError('Failed to update profile.');
    }
  };

  const handlePaymentUpdate = async (e) => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    e.preventDefault();
    try {
      if (selectedPlan) {
        await axios.post(`${apiBaseUrl}/process-payment`, { ...paymentDetails, autoPay }, {
          withCredentials: true,
        });
        setModal({
          isOpen: true,
          message: 'Payment details updated and plan activated',
          onConfirm: () => window.location.reload(),
          isConfirm: false,
        });
      } else {
        await axios.post(`${apiBaseUrl}/process-payment`, { ...paymentDetails, autoPay }, {
          withCredentials: true,
        });
        setModal({
          isOpen: true,
          message: 'Payment details updated',
          onConfirm: null,
          isConfirm: false,
        });
      }
      setSelectedPlan('');
      setIsAddingPayment(false);
      const response = await axios.get(`${apiBaseUrl}/user`, {
        withCredentials: true,
      });
      setUser(response.data);
      setAutoPay(response.data.autoPay);
      setError(null);
    } catch (err) {
      setError('Failed to update payment details.');
    }
  };

  const handlePlanSelect = async (plan) => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    try {
      await axios.post(`${apiBaseUrl}/select-plan`, { plan }, {
        withCredentials: true,
      });
      setSelectedPlan(plan);
      if (user.paymentDetails?.cardNumber) {
        await axios.post(`${apiBaseUrl}/process-payment`, { autoPay }, {
          withCredentials: true,
        });
        setModal({
          isOpen: true,
          message: 'Plan activated using saved payment method',
          onConfirm: () => window.location.reload(),
          isConfirm: false,
        });
        setSelectedPlan('');
        const response = await axios.get(`${apiBaseUrl}/user`, {
          withCredentials: true,
        });
        setUser(response.data);
        setAutoPay(response.data.autoPay);
      } else {
        setIsAddingPayment(true);
        setModal({
          isOpen: true,
          message: 'Plan selected, please add a payment method',
          onConfirm: null,
          isConfirm: false,
        });
      }
      setError(null);
    } catch (err) {
      setError('Failed to select plan.');
    }
  };

  const handleCancelSubscription = () => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    setModal({
      isOpen: true,
      message: 'Are you sure you want to cancel your subscription? Your plan will be reverted to Free.',
      onConfirm: async () => {
        try {
          await axios.post(`${apiBaseUrl}/cancel-subscription`, {}, {
            withCredentials: true,
          });
          setModal({
            isOpen: true,
            message: 'Subscription cancelled, reverted to Free plan',
            onConfirm: () => window.location.reload(),
            isConfirm: false,
          });
          const response = await axios.get(`${apiBaseUrl}/user`, {
            withCredentials: true,
          });
          setUser(response.data);
          setAutoPay(false);
          setError(null);
        } catch (err) {
          setError('Failed to cancel subscription.');
        }
      },
      isConfirm: true,
    });
  };

  const handleDeleteAccount = () => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    setModal({
      isOpen: true,
      message: 'Are you sure you want to delete your account? This action cannot be undone.',
      onConfirm: async () => {
        try {
          const response = await axios.delete(`${apiBaseUrl}/account`, {
            withCredentials: true,
          });
          setModal({
            isOpen: true,
            message: response.data.message || 'Account deleted successfully',
            onConfirm: () => {
              navigate('/');
            },
            isConfirm: false,
          });
          setError(null);
        } catch (err) {
          setError(err.response?.data?.message || 'Failed to delete account. Please try again.');
        }
      },
      isConfirm: true,
    });
  };

  // Аналитика для Manual Links
  const manualStats = {
    ok: links.filter(link => {
      const isCanonicalMatch = !link.canonicalUrl || (
        typeof link.url === 'string' &&
        typeof link.canonicalUrl === 'string' &&
        link.url.toLowerCase().replace(/\/$/, '') === link.canonicalUrl.toLowerCase().replace(/\/$/, '')
      );
      return link.isIndexable && link.responseCode === '200' && link.rel !== 'not found' && isCanonicalMatch;
    }).length,
    problem: links.filter(link => {
      const isCanonicalMatch = !link.canonicalUrl || (
        typeof link.url === 'string' &&
        typeof link.canonicalUrl === 'string' &&
        link.url.toLowerCase().replace(/\/$/, '') === link.canonicalUrl.toLowerCase().replace(/\/$/, '')
      );
      return !(link.isIndexable && link.responseCode === '200' && link.rel !== 'not found' && isCanonicalMatch);
    }).length,
  };

  // Аналитика для Google Sheets
  const sheetStats = {
    ok: spreadsheets.reduce((acc, sheet) => acc + (sheet.links?.filter(link => {
      const isCanonicalMatch = !link.canonicalUrl || (
        typeof link.url === 'string' &&
        typeof link.canonicalUrl === 'string' &&
        link.url.toLowerCase().replace(/\/$/, '') === link.canonicalUrl.toLowerCase().replace(/\/$/, '')
      );
      return link.isIndexable && link.responseCode === '200' && link.rel !== 'not found' && isCanonicalMatch;
    })?.length || 0), 0),
    problem: spreadsheets.reduce((acc, sheet) => acc + (sheet.links?.filter(link => {
      const isCanonicalMatch = !link.canonicalUrl || (
        typeof link.url === 'string' &&
        typeof link.canonicalUrl === 'string' &&
        link.url.toLowerCase().replace(/\/$/, '') === link.canonicalUrl.toLowerCase().replace(/\/$/, '')
      );
      return !(link.isIndexable && link.responseCode === '200' && link.rel !== 'not found' && isCanonicalMatch);
    })?.length || 0), 0),
  };

  const chartDataManual = {
    labels: ['OK', 'Problem'],
    datasets: [{
      label: 'Manual Links',
      data: [manualStats.ok, manualStats.problem],
      backgroundColor: ['#10B981', '#EF4444'],
    }],
  };

  const chartDataSheets = {
    labels: ['OK', 'Problem'],
    datasets: [{
      label: 'Google Sheets',
      data: [sheetStats.ok, sheetStats.problem],
      backgroundColor: ['#10B981', '#EF4444'],
    }],
  };

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  // Маскировка номера карты
  const maskCardNumber = (cardNumber) => {
    if (!cardNumber) return 'No card added';
    const lastFour = cardNumber.slice(-4);
    return `**** **** **** ${lastFour}`;
  };

  // Лимиты ссылок
  const planLimits = {
    free: 100,
    basic: 10000,
    pro: 50000,
    premium: 200000,
    enterprise: Infinity,
  };
  const linksChecked = user?.linksCheckedThisMonth || 0;
  const linkLimit = user?.isSuperAdmin ? Infinity : planLimits[user?.plan] || 0;
  const linkPercentage = user?.isSuperAdmin ? 100 : linkLimit ? Math.min((linksChecked / linkLimit) * 100, 100) : 0;

  // Лимиты таблиц Google Sheets
  const planSpreadsheetLimits = {
    free: 0,
    basic: 1,
    pro: 5,
    premium: 20,
    enterprise: Infinity,
  };
  const maxSpreadsheets = user?.isSuperAdmin ? Infinity : planSpreadsheetLimits[user?.plan] || 0;
  const spreadsheetCount = spreadsheets.length;
  const spreadsheetPercentage = user?.isSuperAdmin ? 100 : maxSpreadsheets ? Math.min((spreadsheetCount / maxSpreadsheets) * 100, 100) : 0;

  return (
    <div className="relative">
      {modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-lg">
            <p className="text-gray-800 text-center mb-4">{modal.message}</p>
            <div className="flex justify-center gap-3">
              {modal.isConfirm ? (
                <>
                  <button
                    onClick={() => {
                      modal.onConfirm();
                      setModal({ isOpen: false, message: '', onConfirm: null, isConfirm: false });
                    }}
                    className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setModal({ isOpen: false, message: '', onConfirm: null, isConfirm: false })}
                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition-colors"
                  >
                    No
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    if (modal.onConfirm) modal.onConfirm();
                    setModal({ isOpen: false, message: '', onConfirm: null, isConfirm: false });
                  }}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-900 underline"
          >
            Close
          </button>
        </div>
      )}

      {cookieError && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
          {cookieError}
          <button
            onClick={() => setCookieError(null)}
            className="ml-2 text-red-900 underline"
          >
            Close
          </button>
        </div>
      )}

      <motion.div
        className="max-w-7xl mx-auto p-4 sm:p-6 bg-white rounded-lg shadow-md overflow-hidden"
        initial="hidden"
        animate="visible"
        variants={fadeInUp}
      >
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-6">Your Profile</h2>

        <div className="border-b border-gray-200 mb-6">
          <nav className="flex space-x-4">
            {['profile', 'payment', 'analytics'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-2 px-4 text-sm font-medium rounded-t-lg transition-colors duration-200 ${
                  activeTab === tab
                    ? 'bg-green-500 text-white border-b-2 border-green-500'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                {tab === 'profile' && 'Profile Info'}
                {tab === 'payment' && 'Payment Methods'}
                {tab === 'analytics' && 'Analytics'}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-4">
          {activeTab === 'profile' && (
            <div className="bg-gray-50 p-4 sm:p-6 rounded-lg shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-700">Profile Information</h3>
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md text-sm"
                  >
                    Edit
                  </button>
                )}
              </div>
              {isEditing ? (
                <form onSubmit={handleProfileUpdate} className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">First Name</label>
                      <input
                        type="text"
                        value={profile.firstName}
                        onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-white text-sm sm:text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Last Name</label>
                      <input
                        type="text"
                        value={profile.lastName}
                        onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-white text-sm sm:text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Email</label>
                      <input
                        type="email"
                        value={profile.email}
                        onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-white text-sm sm:text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Phone</label>
                      <input
                        type="text"
                        value={profile.phone}
                        onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-white text-sm sm:text-base"
                      />
                    </div>
                  </div>
                  <div className="flex gap-3 mt-4">
                    <button
                      type="submit"
                      className="bg-green-500 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md text-sm sm:text-base"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="bg-gray-300 text-gray-700 px-4 sm:px-6 py-2 rounded-lg hover:bg-gray-400 transition-colors shadow-md text-sm sm:text-base"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Username</p>
                    <p className="text-lg text-gray-800">{user?.username}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Current Plan</p>
                    <p className="text-lg text-gray-800 capitalize">{user?.plan}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">First Name</p>
                    <p className="text-lg text-gray-800">{user?.profile?.firstName || 'Not set'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Last Name</p>
                    <p className="text-lg text-gray-800">{user?.profile?.lastName || 'Not set'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Email</p>
                    <p className="text-lg text-gray-800">{user?.profile?.email || 'Not set'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Phone</p>
                    <p className="text-lg text-gray-800">{user?.profile?.phone || 'Not set'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Subscription Status</p>
                    <p className={`text-lg capitalize ${user?.subscriptionStatus === 'active' ? 'text-green-600' : 'text-red-600'}`}>
                      {user?.subscriptionStatus}
                    </p>
                  </div>
                  {user?.subscriptionEnd && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">Subscription Ends</p>
                      <p className="text-lg text-gray-800">{new Date(user.subscriptionEnd).toLocaleDateString()}</p>
                    </div>
                  )}
                  <div className="col-span-1 sm:col-span-2">
                    <p className="text-sm font-medium text-gray-500">Link Analysis Limit</p>
                    {user?.isSuperAdmin ? (
                      <p className="text-lg text-gray-800">Unlimited</p>
                    ) : (
                      <>
                        <div className="w-full bg-gray-200 rounded-full h-4 mt-1">
                          <div
                            className={`bg-green-500 h-4 rounded-full ${linkPercentage > 80 ? 'bg-red-500' : 'bg-green-500'}`}
                            style={{ width: `${linkPercentage}%` }}
                          ></div>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          {linksChecked} / {linkLimit} links checked this month
                        </p>
                      </>
                    )}
                  </div>
                  {user?.plan !== 'free' && (
                    <div className="col-span-1 sm:col-span-2">
                      <p className="text-sm font-medium text-gray-500">Google Sheets Limit</p>
                      {user?.isSuperAdmin ? (
                        <p className="text-lg text-gray-800">Unlimited</p>
                      ) : (
                        <>
                          <div className="w-full bg-gray-200 rounded-full h-4 mt-1">
                            <div
                              className={`bg-green-500 h-4 rounded-full ${spreadsheetPercentage > 80 ? 'bg-red-500' : 'bg-green-500'}`}
                              style={{ width: `${spreadsheetPercentage}%` }}
                            ></div>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">
                            {spreadsheetCount} / {maxSpreadsheets} spreadsheets added
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="mt-6">
                <button
                  onClick={handleDeleteAccount}
                  className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors shadow-md text-sm"
                >
                  Delete Account
                </button>
              </div>
            </div>
          )}

          {activeTab === 'payment' && (
            <div className="bg-gray-50 p-4 sm:p-6 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold text-gray-700 mb-4">Payment Methods</h3>
              {!user?.isSuperAdmin && (
                <>
                  {user?.paymentDetails?.cardNumber && !isAddingPayment ? (
                    <div className="mb-6">
                      <h4 className="text-md font-semibold text-gray-600 mb-2">Current Payment Method</h4>
                      <div className="flex items-center justify-between p-4 bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="flex items-center gap-3">
                          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                          <div>
                            <p className="text-sm font-medium text-gray-700">Card ending in {user.paymentDetails.cardNumber.slice(-4)}</p>
                            <p className="text-xs text-gray-500">Expires {user.paymentDetails.expiryDate}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setIsAddingPayment(true)}
                          className="text-green-600 hover:underline text-sm"
                        >
                          Change
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mb-6">
                      <h4 className="text-md font-semibold text-gray-600 mb-2">No Payment Method Added</h4>
                      <button
                        onClick={() => setIsAddingPayment(true)}
                        className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md text-sm"
                      >
                        Add Payment Method
                      </button>
                    </div>
                  )}

                  <div className="mb-6">
                    <h4 className="text-md font-semibold text-gray-600 mb-2">Select a Plan</h4>
                    <div className="flex flex-wrap gap-3">
                      {['basic', 'pro', 'premium', 'enterprise'].map(plan => (
                        <button
                          key={plan}
                          onClick={() => handlePlanSelect(plan)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            selectedPlan === plan
                              ? 'bg-green-500 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          {plan.charAt(0).toUpperCase() + plan.slice(1)} (${{ basic: 20, pro: 50, premium: 100, enterprise: 500 }[plan]}/month)
                        </button>
                      ))}
                    </div>
                  </div>

                  {isAddingPayment && (
                    <div>
                      <h4 className="text-md font-semibold text-gray-600 mb-2">Add Payment Method</h4>
                      <form onSubmit={handlePaymentUpdate} className="flex flex-col gap-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Card Number</label>
                            <input
                              type="text"
                              placeholder="1234 5678 9012 3456"
                              value={paymentDetails.cardNumber}
                              onChange={(e) => setPaymentDetails({ ...paymentDetails, cardNumber: e.target.value })}
                              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-white text-sm sm:text-base"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Card Holder</label>
                            <input
                              type="text"
                              placeholder="John Doe"
                              value={paymentDetails.cardHolder}
                              onChange={(e) => setPaymentDetails({ ...paymentDetails, cardHolder: e.target.value })}
                              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-white text-sm sm:text-base"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Expiry Date (MM/YY)</label>
                            <input
                              type="text"
                              placeholder="MM/YY"
                              value={paymentDetails.expiryDate}
                              onChange={(e) => setPaymentDetails({ ...paymentDetails, expiryDate: e.target.value })}
                              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-white text-sm sm:text-base"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">CVV</label>
                            <input
                              type="text"
                              placeholder="123"
                              value={paymentDetails.cvv}
                              onChange={(e) => setPaymentDetails({ ...paymentDetails, cvv: e.target.value })}
                              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-white text-sm sm:text-base"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-4">
                          <input
                            type="checkbox"
                            checked={autoPay}
                            onChange={(e) => setAutoPay(e.target.checked)}
                            className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                          />
                          <label className="text-sm text-gray-700">Enable Auto-Pay</label>
                        </div>
                        <div className="flex gap-3 mt-4">
                          <button
                            type="submit"
                            className="bg-green-500 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md text-sm sm:text-base"
                          >
                            {selectedPlan ? 'Process Payment' : 'Save Payment Method'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsAddingPayment(false)}
                            className="bg-gray-300 text-gray-700 px-4 sm:px-6 py-2 rounded-lg hover:bg-gray-400 transition-colors shadow-md text-sm sm:text-base"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {user?.subscriptionStatus === 'active' && (
                    <div className="mt-6">
                      <button
                        onClick={handleCancelSubscription}
                        className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors shadow-md text-sm"
                      >
                        Cancel Subscription
                      </button>
                    </div>
                  )}
                </>
              )}
              {user?.isSuperAdmin && (
                <p className="text-gray-600">SuperAdmin does not need to add payment methods.</p>
              )}
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="bg-gray-50 p-4 sm:p-6 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold text-gray-700 mb-4">Link Analysis Statistics</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="text-md font-semibold text-gray-600 mb-2">Manual Links</h4>
                  <Bar data={chartDataManual} options={{ responsive: true, plugins: { legend: { position: 'top' } } }} />
                </div>
                {user?.plan !== 'free' && (
                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <h4 className="text-md font-semibold text-gray-600 mb-2">Google Sheets</h4>
                    <Bar data={chartDataSheets} options={{ responsive: true, plugins: { legend: { position: 'top' } } }} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default Profile;