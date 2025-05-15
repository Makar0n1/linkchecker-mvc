import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGesture } from '@use-gesture/react';

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
  const [scale, setScale] = useState(1);
  const [swipeOffset, setSwipeOffset] = useState({ x: 0, y: 0 });
  const [lastTap, setLastTap] = useState(0);
  const containerRef = useRef(null);
  const isDragging = useRef(false);

  // Массив всех скриншотов для каждой вкладки
  const images = {
    create: [createProject],
    manual: [manual1, manual2, manual3, manual4, manual5],
    spreadsheets: [spreadsheets1, spreadsheets2, spreadsheets3, spreadsheets4],
  };

  // Текущие изображения в зависимости от активной вкладки
  const currentImages = images[activeTab];

  // Открытие модального окна
  const openModal = (index) => {
    setCurrentImageIndex(index);
    setIsModalOpen(true);
    setScale(1);
    setSwipeOffset({ x: 0, y: 0 });
    document.body.style.overflow = 'hidden';
  };

  // Закрытие модального окна
  const closeModal = () => {
    setIsModalOpen(false);
    setScale(1);
    setSwipeOffset({ x: 0, y: 0 });
    document.body.style.overflow = 'auto';
  };

  // Обработчик двойного тапа для зума (только для мобильных устройств)
  const handleDoubleTap = (event) => {
    const currentTime = Date.now();
    const tapInterval = currentTime - lastTap;

    if (tapInterval < 300 && tapInterval > 0) {
      const rect = containerRef.current.getBoundingClientRect();
      const tapX = event.clientX - rect.left;
      const tapY = event.clientY - rect.top;

      if (scale > 1) {
        // Zoom out
        setScale(1);
        setSwipeOffset({ x: 0, y: 0 });
      } else {
        // Zoom in at tap point
        setScale(2);
        const newX = (rect.width / 2 - tapX) * 2;
        const newY = (rect.height / 2 - tapY) * 2;
        setSwipeOffset({ x: newX, y: newY });
      }
    }
    setLastTap(currentTime);
  };

  // Обработчик клика по изображению (для десктопа)
  const handleImageClick = (e) => {
    const { clientX, target } = e;
    const { left, width } = target.getBoundingClientRect();
    const clickPosition = clientX - left;

    if (clickPosition < width * 0.3 && currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
    } else if (clickPosition > width * 0.7 && currentImageIndex < currentImages.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    }
  };

  // Обработчик жестов с помощью @use-gesture/react (только для мобильных устройств)
  useGesture(
    {
      onDrag: ({ movement: [mx, my], first, last, velocity, direction, pinching }) => {
        // Пропускаем, если это десктоп
        if (window.innerWidth >= 640) return;

        if (pinching) return;

        if (first) {
          isDragging.current = true;
        }

        if (scale > 1) {
          // Pan when zoomed, with boundaries
          const rect = containerRef.current.getBoundingClientRect();
          const imgRect = document.querySelector(`img[alt="Screenshot ${currentImageIndex + 1}"]`)?.getBoundingClientRect();
          
          if (imgRect) {
            const scaledWidth = imgRect.width * scale;
            const scaledHeight = imgRect.height * scale;
            const maxX = (scaledWidth - rect.width) / 2 / scale;
            const maxY = (scaledHeight - rect.height) / 2 / scale;

            const newX = Math.max(-maxX, Math.min(maxX, mx / scale));
            const newY = Math.max(-maxY, Math.min(maxY, my / scale));

            setSwipeOffset({
              x: newX * scale,
              y: newY * scale,
            });
          }
        } else {
          // Swipe to navigate or close
          const absX = Math.abs(mx);
          const absY = Math.abs(my);
          if (absX > absY) {
            // Horizontal swipe
            setSwipeOffset({ x: mx, y: 0 });
          } else {
            // Vertical swipe
            setSwipeOffset({ x: 0, y: my });
          }
        }

        if (last) {
          isDragging.current = false;
          const swipeThreshold = 100;
          const velocityThreshold = 0.3;

          if (scale <= 1) {
            const absX = Math.abs(mx);
            const absY = Math.abs(my);
            if (absX > absY && (absX > swipeThreshold || Math.abs(velocity[0]) > velocityThreshold)) {
              // Horizontal swipe to navigate
              if (mx > 0 && currentImageIndex > 0) {
                setCurrentImageIndex(currentImageIndex - 1);
              } else if (mx < 0 && currentImageIndex < currentImages.length - 1) {
                setCurrentImageIndex(currentImageIndex + 1);
              }
            } else if (absY > swipeThreshold || Math.abs(velocity[1]) > velocityThreshold) {
              // Vertical swipe to close
              closeModal();
            }
          }
          setSwipeOffset({ x: scale > 1 ? swipeOffset.x : 0, y: scale > 1 ? swipeOffset.y : 0 });
        }
      },
      onPinch: ({ origin, offset: [s], first, last }) => {
        // Пропускаем, если это десктоп
        if (window.innerWidth >= 640) return;

        if (first) {
          isDragging.current = true;
        }
        const newScale = Math.min(Math.max(s, 1), 3);
        setScale(newScale);

        if (!last) {
          const rect = containerRef.current.getBoundingClientRect();
          const pinchX = origin[0] - rect.left;
          const pinchY = origin[1] - rect.top;
          const newX = (rect.width / 2 - pinchX) * newScale + (rect.width / 2 - pinchX);
          const newY = (rect.height / 2 - pinchY) * newScale + (rect.height / 2 - pinchY);
          setSwipeOffset({ x: newX, y: newY });
        }

        if (last) {
          isDragging.current = false;
        }
      },
      onClick: ({ event }) => {
        // Пропускаем, если это десктоп
        if (window.innerWidth >= 640) return;

        if (!isDragging.current) {
          handleDoubleTap(event);
        }
      },
    },
    {
      target: containerRef,
      drag: { filterTaps: true },
      pinch: { scaleBounds: { min: 1, max: 3 } },
    }
  );

  // Сброс зума и смещения при смене изображения
  useEffect(() => {
    setScale(1);
    setSwipeOffset({ x: 0, y: 0 });
  }, [currentImageIndex]);

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
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[100]"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalVariants}
            onClick={() => {
              console.log('Clicked on outer container');
              closeModal(); // Закрытие работает на всех устройствах
            }}
          >
            <div
              ref={containerRef}
              className="relative w-full max-h-[70vh] flex items-center justify-center"
              onClick={(e) => {
                console.log('Clicked on inner container');
                e.stopPropagation();
              }}
              style={{ touchAction: 'none', overflow: 'visible' }}
            >
              {/* Контейнер для изображений */}
              {window.innerWidth >= 640 ? (
                // На десктопе рендерим только текущее изображение
                <motion.img
                  key={currentImageIndex}
                  src={currentImages[currentImageIndex]}
                  alt={`Screenshot ${currentImageIndex + 1}`}
                  className="max-w-full max-h-[60vh] sm:max-h-[70vh] object-contain rounded-lg"
                  animate={{
                    x: 0,
                    y: 0,
                    scale: 1,
                    opacity: 1,
                    transition: { type: 'spring', stiffness: 300, damping: 30 },
                  }}
                  style={{
                    zIndex: 10,
                    transformOrigin: 'center center',
                    userSelect: 'none',
                  }}
                  onClick={handleImageClick}
                />
              ) : (
                // На мобильных устройствах рендерим все изображения для свайпа
                currentImages.map((image, index) => {
                  const xPosition = (index - currentImageIndex) * window.innerWidth + swipeOffset.x;
                  console.log(`Rendering image ${index}, currentImageIndex: ${currentImageIndex}, xPosition: ${xPosition}, swipeOffset.x: ${swipeOffset.x}`);
                  console.log(`Container dimensions: width=${containerRef.current?.getBoundingClientRect().width}, height=${containerRef.current?.getBoundingClientRect().height}`);
                  return (
                    <motion.img
                      key={index}
                      src={image}
                      alt={`Screenshot ${index + 1}`}
                      className="absolute max-w-full max-h-[60vh] object-contain rounded-lg"
                      initial={{ x: (index - currentImageIndex) * window.innerWidth }}
                      animate={{
                        x: xPosition,
                        y: swipeOffset.y,
                        scale: scale,
                        opacity: index === currentImageIndex ? 1 : (Math.abs(index - currentImageIndex) <= 1 ? 0.3 : 0),
                        transition: { type: 'spring', stiffness: 300, damping: 30 },
                      }}
                      style={{
                        zIndex: index === currentImageIndex ? 10 : 5,
                        transformOrigin: 'center center',
                        userSelect: 'none',
                        width: '100%',
                      }}
                    />
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default FAQ;