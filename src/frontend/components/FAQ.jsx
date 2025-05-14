import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Panzoom from '@panzoom/panzoom';

// Импорт скриншотов
import createProject from '../../assets/images/faq_create_project.png';
import manual1 from '../../assets/images/faq_manual_links_1.png';
import manual2 from '../../assets/images/faq_manual_links_2.png';
import manual3 from '../../assets/images/faq_manual_links_3.png';
import manual4 from '../../assets/images/faq_manual_links_4.png';
import manual5 from '../../assets/images/faq_manual_links_5.png';
import spreadsheets1 from '../../assets/images/faq_spreadsheet_1.png';
import spreadsheets2 from '../../assets/images/faq_spreadsheet_2.png';
import spreadsheets3 from '../../assets/images/faq_spreadsheet_3.png';
import spreadsheets4 from '../../assets/images/faq_spreadsheet_4.png';

const FAQ = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('create');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const [touchStartY, setTouchStartY] = useState(null);
  const [touchCurrentX, setTouchCurrentX] = useState(null);
  const [touchCurrentY, setTouchCurrentY] = useState(null);
  const [touchStartTime, setTouchStartTime] = useState(null);
  const [lastTap, setLastTap] = useState(0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [modalOpacity, setModalOpacity] = useState(1);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState(null);
  const [hasSwiped, setHasSwiped] = useState(false);
  const panzoomInstances = useRef([]); // Для хранения экземпляров Panzoom
  const wrapperRef = useRef(null);

  // Массив всех скриншотов для каждой вкладки
  const images = {
    create: [createProject],
    manual: [manual1, manual2, manual3, manual4, manual5],
    spreadsheets: [spreadsheets1, spreadsheets2, spreadsheets3, spreadsheets4],
  };

  // Текущие изображения в зависимости от активной вкладки
  const currentImages = images[activeTab];

  // Открытие модального окна с определённым изображением
  const openModal = (index) => {
    setCurrentImageIndex(index);
    setIsModalOpen(true);
    setPanX(0);
    setPanY(0);
    setModalOpacity(1);
    setHasSwiped(false);
    document.body.style.overflow = 'hidden';
  };

  // Закрытие модального окна
  const closeModal = () => {
    setIsModalOpen(false);
    setPanX(0);
    setPanY(0);
    setModalOpacity(1);
    setHasSwiped(false);
    document.body.style.overflow = 'auto';
    // Сбрасываем Panzoom для всех изображений
    panzoomInstances.current.forEach((instance) => {
      if (instance) instance.zoom(1, { animate: false });
    });
  };

  // Следующее изображение
  const nextImage = () => {
    setCurrentImageIndex((prevIndex) =>
      prevIndex === currentImages.length - 1 ? prevIndex : prevIndex + 1
    );
    setPanX(0);
    setPanY(0);
    // Сбрасываем Panzoom для текущего изображения
    const instance = panzoomInstances.current[currentImageIndex];
    if (instance) {
      instance.zoom(1, { animate: false });
    }
  };

  // Предыдущее изображение
  const prevImage = () => {
    setCurrentImageIndex((prevIndex) =>
      prevIndex === 0 ? prevIndex : prevIndex - 1
    );
    setPanX(0);
    setPanY(0);
    // Сбрасываем Panzoom для текущего изображения
    const instance = panzoomInstances.current[currentImageIndex];
    if (instance) {
      instance.zoom(1, { animate: false });
    }
  };

  // Обработчик клика по изображению (для десктопа)
  const handleImageClick = (e) => {
    const { clientX, target } = e;
    const { left, width } = target.getBoundingClientRect();
    const clickPosition = clientX - left;

    if (clickPosition < width * 0.3) {
      prevImage();
    } else if (clickPosition > width * 0.7) {
      nextImage();
    }
  };

  // Обработчик двойного тапа для зума в точку
  const handleDoubleTap = (e, instance) => {
    const currentTime = Date.now();
    const tapInterval = currentTime - lastTap;

    if (tapInterval < 300 && tapInterval > 0) {
      // Двойной тап
      const wrapper = wrapperRef.current;
      if (wrapper && instance) {
        const rect = wrapper.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        const touchY = e.touches[0].clientY - rect.top;

        const currentScale = instance.getScale();
        if (currentScale === 1) {
          // Зум в точку
          instance.zoomToPoint(2, { clientX: touchX + rect.left, clientY: touchY + rect.top }, { animate: true });
        } else {
          // Сброс зума
          instance.zoom(1, { animate: true });
        }
      }
    }
    setLastTap(currentTime);
  };

  // Обработчики свайпа для мобильных устройств
  const handleTouchStart = (e) => {
    setTouchStartX(e.touches[0].clientX);
    setTouchStartY(e.touches[0].clientY);
    setTouchCurrentX(e.touches[0].clientX);
    setTouchCurrentY(e.touches[0].clientY);
    setTouchStartTime(Date.now());
    setIsSwiping(true);
    setSwipeDirection(null);

    const instance = panzoomInstances.current[currentImageIndex];
    if (instance) {
      const currentScale = instance.getScale();
      if (currentScale > 1) {
        setIsPanning(true);
      }
      handleDoubleTap(e, instance);
    }
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    if (!isSwiping) return;
    setTouchCurrentX(e.touches[0].clientX);
    setTouchCurrentY(e.touches[0].clientY);

    const deltaX = e.touches[0].clientX - touchStartX;
    const deltaY = e.touches[0].clientY - touchStartY;

    const instance = panzoomInstances.current[currentImageIndex];
    if (isPanning && instance) {
      // Panzoom сам управляет перемещением, нам не нужно ничего делать
      return;
    }

    // Определяем направление свайпа
    if (!swipeDirection) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        setSwipeDirection('horizontal');
        setHasSwiped(true);
      } else {
        setSwipeDirection('vertical');
      }
    }

    if (swipeDirection === 'horizontal') {
      // Горизонтальный свайп (листание фотографий)
      if (currentImages.length === 1) {
        setPanX(deltaX * 0.3);
      } else if (currentImageIndex === 0 && deltaX > 0) {
        setPanX(deltaX * 0.3);
      } else if (currentImageIndex === currentImages.length - 1 && deltaX < 0) {
        setPanX(deltaX * 0.3);
      } else {
        setPanX(deltaX);
      }
      setPanY(0);
      setModalOpacity(1);
    } else {
      // Вертикальный свайп (закрытие)
      setPanY(deltaY);
      setPanX(0);
      const maxSwipeDistance = window.innerHeight / 2;
      const swipeProgress = Math.min(Math.abs(deltaY) / maxSwipeDistance, 1);
      setModalOpacity(1 - swipeProgress);
    }
  };

  const handleTouchEnd = () => {
    if (!isSwiping) return;
    setIsSwiping(false);
    setIsPanning(false);

    const deltaX = touchCurrentX - touchStartX;
    const deltaY = touchCurrentY - touchStartY;
    const touchEndTime = Date.now();
    const swipeDuration = (touchEndTime - touchStartTime) / 1000;
    const swipeSpeed = Math.abs(deltaX) / swipeDuration;

    const instance = panzoomInstances.current[currentImageIndex];
    if (instance && instance.getScale() > 1) {
      return;
    }

    if (swipeDirection === 'horizontal') {
      const swipeThreshold = swipeSpeed > 500 ? 0 : window.innerWidth * 0.4;
      if (Math.abs(deltaX) > swipeThreshold) {
        if (deltaX > 0 && currentImageIndex > 0) {
          prevImage();
        } else if (deltaX < 0 && currentImageIndex < currentImages.length - 1) {
          nextImage();
        }
      }
      setPanX(0);
    } else {
      if (Math.abs(deltaY) > window.innerHeight * 0.2) {
        closeModal();
      } else {
        setPanY(0);
        setModalOpacity(1);
      }
    }

    setTouchStartX(null);
    setTouchStartY(null);
    setTouchCurrentX(null);
    setTouchCurrentY(null);
    setTouchStartTime(null);
    setSwipeDirection(null);
  };

  // Инициализация Panzoom для каждого изображения
  useEffect(() => {
    if (isModalOpen) {
      const imageElements = document.querySelectorAll('.panzoom-image');
      imageElements.forEach((element, index) => {
        const instance = Panzoom(element, {
          minScale: 1,
          maxScale: 3,
          contain: 'inside', // Изображение не выходит за пределы контейнера
          cursor: 'default',
          panOnlyWhenZoomed: true,
          duration: 300, // Плавная анимация зума (300ms)
          easing: 'ease-in-out',
        });
        panzoomInstances.current[index] = instance;
      });

      return () => {
        panzoomInstances.current.forEach((instance) => {
          if (instance) instance.destroy();
        });
        panzoomInstances.current = [];
      };
    }
  }, [isModalOpen, currentImageIndex]);

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const modalVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.3, ease: 'easeOut' } },
    exit: { opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } },
  };

  return (
    <motion.div
      className="max-w-full mx-auto p-4 sm:p-6 bg-white rounded-lg shadow-md overflow-hidden"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      {/* Заголовок и кнопка "назад" */}
      <div className="flex items-center gap-4 mb-6 border-b border-gray-200 pb-4">
        <button
          onClick={() => navigate('/app/projects')}
          className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">FAQ: Как пользоваться LinkSentry</h2>
      </div>

      {/* Вкладки */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-4">
          <button
            onClick={() => setActiveTab('create')}
            className={`py-2 px-4 text-sm font-medium rounded-t-lg transition-colors duration-200 ${
              activeTab === 'create'
                ? 'bg-green-500 text-white border-b-2 border-green-500'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            Create Project
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`py-2 px-4 text-sm font-medium rounded-t-lg transition-colors duration-200 ${
              activeTab === 'manual'
                ? 'bg-green-500 text-white border-b-2 border-green-500'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            Manual Links
          </button>
          <button
            onClick={() => setActiveTab('spreadsheets')}
            className={`py-2 px-4 text-sm font-medium rounded-t-lg transition-colors duration-200 ${
              activeTab === 'spreadsheets'
                ? 'bg-green-500 text-white border-b-2 border-green-500'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            Google Sheets
          </button>
        </nav>
      </div>

      {/* Контент вкладок */}
      <div className="space-y-6">
        {activeTab === 'create' && (
          <div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">1. Как создать новый проект?</h3>
            <p className="text-gray-600">
              - После входа в аккаунт вы сразу окажетесь на странице "Projects".<br />
              - Нажмите кнопку "+ New Project".<br />
              - Введите название проекта (например, "SEO Campaign 2025") и нажмите "Create Project".<br />
              - Новый проект появится в списке, и вы сможете начать работу с ним, нажав на его название.
            </p>
            <div className="mt-4">
              <img
                src={createProject}
                alt="Create Project"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(0)}
              />
            </div>
          </div>
        )}

        {activeTab === 'manual' && (
          <div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">2. Как добавить и проанализировать ссылки вручную (Manual Links)?</h3>
            <p className="text-gray-600">
              - На странице "Projects" выберите нужный проект, нажав на его название — вы сразу окажетесь во вкладке "Manual Links".<br />
              - После блока с пустой аналитикой вы увидите сводку по количеству ссылок и доменов, а также кнопки "Check All Links", "Delete All Links" и кнопку в виде плюса (+). Нажмите на неё.
            </p>
            <div className="mt-4">
              <img
                src={manual1}
                alt="Manual Links - Buttons"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(0)}
              />
            </div>
            <p className="text-gray-600 mt-4">
              - В появившемся модальном окне:<br />
                - Вставьте URL-адреса для анализа (по одному в строке, например, `https://site1.com`, `https://site2.com`).<br />
                - Укажите один целевой домен (Target Domain, например, `example.com`), ссылки на который будут искаться.<br />
              - Нажмите "Add Links".
            </p>
            <div className="mt-4">
              <img
                src={manual2}
                alt="Manual Links - Add Links Modal"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(1)}
              />
            </div>
            <p className="text-gray-600 mt-4">
              - После добавления ссылок они появятся в таблице. Напротив каждой ссылки есть кнопка "Delete" для выборочного удаления.
            </p>
            <div className="mt-4">
              <img
                src={manual3}
                alt="Manual Links - Table with Delete Buttons"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(2)}
              />
            </div>
            <p className="text-gray-600 mt-4">
              - Нажмите "Check All Links", чтобы начать анализ.
            </p>
            <div className="mt-4">
              <img
                src={manual4}
                alt="Manual Links - Check All Links"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(3)}
              />
            </div>
            <p className="text-gray-600 mt-4">
              - Чтобы обновить статус анализа и увидеть результаты, перезагружайте страницу. Рекомендуется подождать около минуты, затем обновить страницу, и повторять, пока аналитика и результаты не отобразятся полностью.<br />
              - Если нужно удалить все ссылки, нажмите "Delete All Links".
            </p>
            <div className="mt-4">
              <img
                src={manual5}
                alt="Manual Links - Analytics"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(4)}
              />
            </div>
          </div>
        )}

        {activeTab === 'spreadsheets' && (
          <div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">3. Как добавить и проанализировать ссылки через Google Sheets?</h3>
            <p className="text-gray-600">
              - На странице проекта перейдите во вкладку "Google Sheets".<br />
              - После блока с аналитикой вы увидите форму для добавления таблицы. Заполните поля:<br />
                - <strong>Spreadsheet ID</strong> и <strong>GID</strong> (можно найти в URL вашей Google Sheets таблицы).<br />
                - <strong>Target Domain</strong> (например, `example.com` — на случай пустых ячеек в столбце с целевым доменом).<br />
                - <strong>URL Column</strong> (например, `D` — колонка с URL-адресами для анализа).<br />
                - <strong>Target Column</strong> (например, `I` — колонка с целевыми URL-адресами).<br />
                - <strong>Result Range Start/End</strong> (например, `L` и `P` — диапазон для записи результатов).<br />
                - <strong>Interval Hours</strong> (например, 4 часа — частота повторного анализа).<br />
              - Нажмите "Add Spreadsheet".
            </p>
            <div className="mt-4">
              <img
                src={spreadsheets1}
                alt="Google Sheets - Add Form"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(0)}
              />
            </div>
            <p className="text-gray-600 mt-4">
              - После добавления ниже появится сниппет с вашей таблицей, содержащий кнопки "Run", "Cancel" и "Delete". Чтобы запустить анализ, нажмите "Run".
            </p>
            <div className="mt-4">
              <img
                src={spreadsheets2}
                alt="Google Sheets - Snippet with Buttons"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(1)}
              />
            </div>
            <p className="text-gray-600 mt-4">
              - Прогресс анализа будет отображаться автоматически в реальном времени, дополнительных действий не требуется.<br />
              - Если нужно отменить анализ, нажмите "Cancel" — анализ прекратится, прогресс сбросится, и его придётся запускать заново.<br />
              - Чтобы удалить таблицу, сначала нажмите "Cancel" (если анализ запущен), дождитесь начального состояния, затем нажмите "Delete".
            </p>
            <div className="mt-4">
              <img
                src={spreadsheets3}
                alt="Google Sheets - Analysis Progress"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(2)}
              />
            </div>
            <p className="text-gray-600 mt-4">
              - После завершения анализа вы увидите результаты в аналитике. Если данные не обновились, перезагрузите страницу.
            </p>
            <div className="mt-4">
              <img
                src={spreadsheets4}
                alt="Google Sheets - Analytics"
                className="w-full max-w-md rounded-lg shadow-md cursor-pointer"
                onClick={() => openModal(3)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Модальное окно для слайд-шоу */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            className="fixed inset-0 bg-black flex items-center justify-center z-50"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalVariants}
            onClick={(e) => {
              if (window.innerWidth >= 640) {
                closeModal();
              }
            }}
            style={{
              backgroundColor: `rgba(0, 0, 0, ${modalOpacity * 0.75})`,
              transition: 'background-color 0.3s ease-out',
            }}
          >
            <div
              ref={wrapperRef}
              className="relative w-[70vw] h-[70vh] sm:w-[70vw] sm:h-[70vh] w-full h-full flex items-center justify-center p-0 sm:p-4"
              onClick={(e) => e.stopPropagation()}
              style={{ touchAction: 'none' }}
            >
              {/* Кнопка "Закрыть" для мобильной версии */}
              <button
                onClick={closeModal}
                className="sm:hidden absolute top-4 right-4 bg-gray-800 bg-opacity-50 text-white rounded-full w-8 h-8 flex items-center justify-center z-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Контейнер для всех изображений */}
              <div className="relative w-full h-full flex items-center justify-center">
                {currentImages.map((image, index) => (
                  <motion.div
                    key={index}
                    className="absolute w-full h-full flex items-center justify-center"
                    animate={scale > 1 ? {} : {
                      x: (index - currentImageIndex) * window.innerWidth + panX,
                      y: panY,
                      opacity: scale > 1 && index !== currentImageIndex ? 0 : 1,
                      transition: isSwiping ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' },
                    }}
                    style={{
                      display: (!hasSwiped && index !== currentImageIndex) || (scale > 1 && index !== currentImageIndex) ? 'none' : 'flex',
                    }}
                  >
                    <img
                      className="panzoom-image w-full sm:max-w-full sm:max-h-[70vh] max-h-[80vh] sm:object-contain object-contain rounded-lg cursor-pointer"
                      src={image}
                      alt={`Screenshot ${index + 1}`}
                      onClick={window.innerWidth >= 640 ? handleImageClick : null}
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                    />
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default FAQ;