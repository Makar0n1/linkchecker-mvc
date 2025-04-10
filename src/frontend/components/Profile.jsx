import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const Profile = () => {
  const [user, setUser] = useState(null);
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
  const navigate = useNavigate();

  const apiBaseUrl = `http://${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem('token');
      try {
        const response = await axios.get(`${apiBaseUrl}/user`, {
          headers: { Authorization: `Bearer ${token}` },
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
            localStorage.removeItem('token');
            navigate('/login');
          },
          isConfirm: false,
        });
      }
    };

    const fetchLinks = async () => {
      const token = localStorage.getItem('token');
      try {
        const response = await axios.get(`${apiBaseUrl}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLinks(response.data);
      } catch (err) {
        setModal({
          isOpen: true,
          message: 'Failed to fetch links.',
          onConfirm: null,
          isConfirm: false,
        });
      }
    };

    const fetchSpreadsheets = async () => {
      const token = localStorage.getItem('token');
      try {
        const response = await axios.get(`${apiBaseUrl}/spreadsheets`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSpreadsheets(response.data);
      } catch (err) {
        setModal({
          isOpen: true,
          message: err.response?.data?.message || 'Failed to fetch spreadsheets.',
          onConfirm: null,
          isConfirm: false,
        });
      }
    };

    fetchUser();
    fetchLinks();
    fetchSpreadsheets();
  }, [navigate]);

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    try {
      await axios.put(`${apiBaseUrl}/profile`, profile, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setModal({
        isOpen: true,
        message: 'Profile updated successfully',
        onConfirm: null,
        isConfirm: false,
      });
      setIsEditing(false);
      const response = await axios.get(`${apiBaseUrl}/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(response.data);
    } catch (err) {
      setModal({
        isOpen: true,
        message: 'Failed to update profile.',
        onConfirm: null,
        isConfirm: false,
      });
    }
  };

  const handlePaymentUpdate = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    try {
      if (selectedPlan) {
        await axios.post(`${apiBaseUrl}/process-payment`, { ...paymentDetails, autoPay }, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setModal({
          isOpen: true,
          message: 'Payment details updated and plan activated',
          onConfirm: null,
          isConfirm: false,
        });
      } else {
        await axios.post(`${apiBaseUrl}/process-payment`, { ...paymentDetails, autoPay }, {
          headers: { Authorization: `Bearer ${token}` },
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
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(response.data);
      setAutoPay(response.data.autoPay);
    } catch (err) {
      setModal({
        isOpen: true,
        message: 'Failed to update payment details.',
        onConfirm: null,
        isConfirm: false,
      });
    }
  };

  const handlePlanSelect = async (plan) => {
    const token = localStorage.getItem('token');
    try {
      await axios.post(`${apiBaseUrl}/select-plan`, { plan }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSelectedPlan(plan);
      if (user.paymentDetails?.cardNumber) {
        await axios.post(`${apiBaseUrl}/process-payment`, { autoPay }, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setModal({
          isOpen: true,
          message: 'Plan activated using saved payment method',
          onConfirm: null,
          isConfirm: false,
        });
        setSelectedPlan('');
        const response = await axios.get(`${apiBaseUrl}/user`, {
          headers: { Authorization: `Bearer ${token}` },
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
    } catch (err) {
      setModal({
        isOpen: true,
        message: 'Failed to select plan.',
        onConfirm: null,
        isConfirm: false,
      });
    }
  };

  const handleCancelSubscription = () => {
    setModal({
      isOpen: true,
      message: 'Are you sure you want to cancel your subscription? Your plan will be reverted to Free.',
      onConfirm: async () => {
        const token = localStorage.getItem('token');
        try {
          await axios.post(`${apiBaseUrl}/cancel-subscription`, {}, {
            headers: { Authorization: `Bearer ${token}` },
          });
          setModal({
            isOpen: true,
            message: 'Subscription cancelled, reverted to Free plan',
            onConfirm: null,
            isConfirm: false,
          });
          const response = await axios.get(`${apiBaseUrl}/user`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          setUser(response.data);
          setAutoPay(false);
        } catch (err) {
          setModal({
            isOpen: true,
            message: 'Failed to cancel subscription.',
            onConfirm: null,
            isConfirm: false,
          });
        }
      },
      isConfirm: true,
    });
  };

  const handleDeleteAccount = () => {
    setModal({
      isOpen: true,
      message: 'Are you sure you want to delete your account? This action cannot be undone.',
      onConfirm: async () => {
        const token = localStorage.getItem('token');
        try {
          if (!token) {
            throw new Error('No token found. Please log in again.');
          }
          const response = await axios.delete(`${apiBaseUrl}/account`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          setModal({
            isOpen: true,
            message: response.data.message || 'Account deleted successfully',
            onConfirm: () => {
              localStorage.removeItem('token');
              navigate('/');
            },
            isConfirm: false,
          });
        } catch (err) {
          setModal({
            isOpen: true,
            message: err.response?.data?.message || 'Failed to delete account. Please try again.',
            onConfirm: null,
            isConfirm: false,
          });
        }
      },
      isConfirm: true,
    });
  };

  // Аналитика для Manual Links
  const manualStats = {
    ok: links.filter(link => {
      const isCanonicalMatch = !link.canonicalUrl || link.url.toLowerCase().replace(/\/$/, '') === link.canonicalUrl.toLowerCase().replace(/\/$/, '');
      return link.isIndexable && link.responseCode === '200' && link.rel !== 'not found' && isCanonicalMatch;
    }).length,
    problem: links.filter(link => {
      const isCanonicalMatch = !link.canonicalUrl || link.url.toLowerCase().replace(/\/$/, '') === link.canonicalUrl.toLowerCase().replace(/\/$/, '');
      return !(link.isIndexable && link.responseCode === '200' && link.rel !== 'not found' && isCanonicalMatch);
    }).length,
  };

  // Аналитика для Google Sheets
  const sheetStats = {
    ok: spreadsheets.reduce((acc, sheet) => acc + (sheet.links?.filter(link => {
      const isCanonicalMatch = !link.canonicalUrl || link.url.toLowerCase().replace(/\/$/, '') === link.canonicalUrl.toLowerCase().replace(/\/$/, '');
      return link.isIndexable && link.responseCode === '200' && link.rel !== 'not found' && isCanonicalMatch;
    })?.length || 0), 0),
    problem: spreadsheets.reduce((acc, sheet) => acc + (sheet.links?.filter(link => {
      const isCanonicalMatch = !link.canonicalUrl || link.url.toLowerCase().replace(/\/$/, '') === link.canonicalUrl.toLowerCase().replace(/\/$/, '');
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
    enterprise: Infinity
  };
  const linksRemaining = user?.isSuperAdmin ? 'Unlimited' : (planLimits[user?.plan] || 0) - (user?.linksCheckedThisMonth || 0);

  return (
    <div className="relative">
      {/* Модальное окно */}
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

      <motion.div
        className="max-w-7xl mx-auto p-4 sm:p-6 bg-white rounded-lg shadow-md overflow-hidden"
        initial="hidden"
        animate="visible"
        variants={fadeInUp}
      >
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-6">Your Profile</h2>

        {/* Вкладки */}
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

        {/* Содержимое вкладок */}
        <div className="mt-4">
          {/* Вкладка Profile Info */}
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
                  <div>
                    <p className="text-sm font-medium text-gray-500">Links Remaining</p>
                    <p className="text-lg text-gray-800">{linksRemaining}</p>
                  </div>
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

          {/* Вкладка Payment Methods */}
          {activeTab === 'payment' && (
            <div className="bg-gray-50 p-4 sm:p-6 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold text-gray-700 mb-4">Payment Methods</h3>
              {!user?.isSuperAdmin && (
                <>
                  {/* Текущий метод оплаты (сниппет) */}
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

                  {/* Выбор плана */}
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

                  {/* Форма оплаты */}
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

                  {/* Кнопка отмены подписки */}
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

          {/* Вкладка Analytics */}
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