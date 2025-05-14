import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

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
  const [touchStartTime, setTouchStartTime] = useState(null); // Для отслеживания времени свайпа
  const [lastTap, setLastTap] = useState(0); // Для двойного тапа
  const [panX, setPanX] = useState(0); // Для горизонтального смещения при свайпе
  const [panY, setPanY] = useState(0); // Для вертикального смещения при свайпе
  const [scale, setScale] = useState(1); // Для зума
  const [offsetX, setOffsetX] = useState(0); // Для перемещения увеличенного изображения по X
  const [offsetY, setOffsetY] = useState(0); // Для перемещения увеличенного изображения по Y
  const [modalOpacity, setModalOpacity] = useState(1); // Для прозрачности фона
  const [isSwiping, setIsSwiping] = useState(false);
  const [isPanning, setIsPanning] = useState(false); // Для перемещения увеличенного изображения
  const [swipeDirection, setSwipeDirection] = useState(null); // Для определения направления свайпа
  const [hasSwiped, setHasSwiped] = useState(false); // Для отслеживания, был ли свайп
  const imageRef = useRef(null); // Для получения размеров изображения
  const wrapperRef = useRef(null); // Для получения размеров контейнера

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
    setScale(1);
    setOffsetX(0);
    setOffsetY(0);
    setPanX(0);
    setPanY(0);
    setModalOpacity(1);
    setHasSwiped(false);
    document.body.style.overflow = 'hidden';
  };

  // Закрытие модального окна
  const closeModal = () => {
    setIsModalOpen(false);
    setScale(1);
    setOffsetX(0);
    setOffsetY(0);
    setPanX(0);
    setPanY(0);
    setModalOpacity(1);
    setHasSwiped(false);
    document.body.style.overflow = 'auto';
  };

  // Следующее изображение
  const nextImage = () => {
    setCurrentImageIndex((prevIndex) =>
      prevIndex === currentImages.length - 1 ? prevIndex : prevIndex + 1
    );
    setScale(1);
    setOffsetX(0);
    setOffsetY(0);
    setPanX(0);
    setPanY(0);
  };

  // Предыдущее изображение
  const prevImage = () => {
    setCurrentImageIndex((prevIndex) =>
      prevIndex === 0 ? prevIndex : prevIndex - 1
    );
    setScale(1);
    setOffsetX(0);
    setOffsetY(0);
    setPanX(0);
    setPanY(0);
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
  const handleDoubleTap = (e) => {
    const currentTime = Date.now();
    const tapInterval = currentTime - lastTap;

    if (tapInterval < 300 && tapInterval > 0) {
      // Двойной тап
      const img = imageRef.current;
      const wrapper = wrapperRef.current;
      if (img && wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left; // Координата X касания относительно контейнера
        const touchY = e.touches[0].clientY - rect.top; // Координата Y касания относительно контейнера

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (scale === 1) {
          // Зум в точку
          setScale(2);

          // Вычисляем смещение, чтобы точка касания оказалась в центре экрана
          const naturalWidth = img.naturalWidth;
          const naturalHeight = img.naturalHeight;
          const scaledWidth = naturalWidth * 2;
          const scaledHeight = naturalHeight * 2;

          const maxOffsetX = scaledWidth > viewportWidth ? (scaledWidth - viewportWidth) / 2 / 2 : 0;
          const maxOffsetY = scaledHeight > viewportHeight ? (scaledHeight - viewportHeight) / 2 / 2 : 0;

          // Переводим координаты касания в координаты изображения с учётом масштаба
          const imageX = (touchX - viewportWidth / 2) / 2; // Учитываем масштаб 2
          const imageY = (touchY - viewportHeight / 2) / 2;

          // Ограничиваем смещение
          const newOffsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, -imageX));
          const newOffsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, -imageY));

          setOffsetX(newOffsetX);
          setOffsetY(newOffsetY);
        } else {
          // Сброс зума
          setScale(1);
          setOffsetX(0);
          setOffsetY(0);
        }
      }
    }
    setLastTap(currentTime);
  };

  // Обработчики свайпа и перемещения увеличенного изображения
  const handleTouchStart = (e) => {
    setTouchStartX(e.touches[0].clientX);
    setTouchStartY(e.touches[0].clientY);
    setTouchCurrentX(e.touches[0].clientX);
    setTouchCurrentY(e.touches[0].clientY);
    setTouchStartTime(Date.now());
    setIsSwiping(true);
    setSwipeDirection(null);
    if (scale > 1) {
      setIsPanning(true); // Если зум активен, начинаем перемещение изображения
    }
    handleDoubleTap(e); // Проверяем двойной тап
  };

  const handleTouchMove = (e) => {
    e.preventDefault(); // Предотвращаем нативное масштабирование страницы
    if (!isSwiping) return;
    setTouchCurrentX(e.touches[0].clientX);
    setTouchCurrentY(e.touches[0].clientY);

    const deltaX = e.touches[0].clientX - touchStartX;
    const deltaY = e.touches[0].clientY - touchStartY;

    if (isPanning) {
      // Перемещение увеличенного изображения
      const img = imageRef.current;
      if (img) {
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;

        const scaledWidth = naturalWidth * scale;
        const scaledHeight = naturalHeight * scale;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Вычисляем максимальные смещения
        const maxOffsetX = scaledWidth > viewportWidth ? (scaledWidth - viewportWidth) / 2 / scale : 0;
        const maxOffsetY = scaledHeight > viewportHeight ? (scaledHeight - viewportHeight) / 2 / scale : 0;

        // Ограничиваем перемещение
        let newOffsetX = offsetX + deltaX / scale;
        let newOffsetY = offsetY + deltaY / scale;

        // Жёсткие границы: края изображения всегда прилипают к краям экрана
        newOffsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, newOffsetX));
        newOffsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, newOffsetY));

        setOffsetX(newOffsetX);
        setOffsetY(newOffsetY);
      }
      return; // Блокируем свайп для листания, пока зум активен
    }

    // Определяем направление свайпа
    if (!swipeDirection) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        setSwipeDirection('horizontal');
        setHasSwiped(true); // Устанавливаем флаг, что начался свайп
      } else {
        setSwipeDirection('vertical');
      }
    }

    if (swipeDirection === 'horizontal') {
      // Горизонтальный свайп (листание фотографий)
      if (currentImages.length === 1) {
        setPanX(deltaX * 0.3); // Пружинка для единственной фотографии
      } else if (currentImageIndex === 0 && deltaX > 0) {
        setPanX(deltaX * 0.3); // Пружинка для первой фотографии (свайп вправо)
      } else if (currentImageIndex === currentImages.length - 1 && deltaX < 0) {
        setPanX(deltaX * 0.3); // Пружинка для последней фотографии (свайп влево)
      } else {
        setPanX(deltaX); // Иначе следуем за пальцем
      }
      setPanY(0);
      setModalOpacity(1);
    } else {
      // Вертикальный свайп (закрытие)
      setPanY(deltaY); // Следуем за пальцем по вертикали
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
    const swipeDuration = (touchEndTime - touchStartTime) / 1000; // Длительность в секундах
    const swipeSpeed = Math.abs(deltaX) / swipeDuration; // Скорость в px/s

    if (isPanning) {
      // Плавное возвращение увеличенного изображения к краям
      const img = imageRef.current;
      if (img) {
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;

        const scaledWidth = naturalWidth * scale;
        const scaledHeight = naturalHeight * scale;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const maxOffsetX = scaledWidth > viewportWidth ? (scaledWidth - viewportWidth) / 2 / scale : 0;
        const maxOffsetY = scaledHeight > viewportHeight ? (scaledHeight - viewportHeight) / 2 / scale : 0;

        let newOffsetX = offsetX;
        let newOffsetY = offsetY;

        newOffsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, newOffsetX));
        newOffsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, newOffsetY));

        setOffsetX(newOffsetX);
        setOffsetY(newOffsetY);
      }
      return; // Блокируем свайп для листания, пока зум активен
    }

    if (swipeDirection === 'horizontal') {
      // Определяем порог в зависимости от скорости свайпа
      const swipeThreshold = swipeSpeed > 500 ? 0 : window.innerWidth * 0.4;
      // Горизонтальный свайп (листание фотографий)
      if (Math.abs(deltaX) > swipeThreshold) {
        if (deltaX > 0 && currentImageIndex > 0) {
          // Свайп вправо — предыдущее изображение
          prevImage();
        } else if (deltaX < 0 && currentImageIndex < currentImages.length - 1) {
          // Свайп влево — следующее изображение
          nextImage();
        }
      }
      // Плавно возвращаем фото на место (эффект пружинки)
      setPanX(0);
    } else {
      // Вертикальный свайп (закрытие)
      if (Math.abs(deltaY) > window.innerHeight * 0.2) {
        // Закрываем модальное окно при свайпе вверх или вниз
        closeModal();
      } else {
        // Если свайп недостаточно сильный, возвращаем фото на место с эффектом пружинки
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

  // Обработчики для зума пальцами (pinch-to-zoom)
  const handlePinchStart = (e) => {
    e.preventDefault(); // Предотвращаем нативное масштабирование страницы
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const initialDistance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY
      );
      e.target.dataset.initialDistance = initialDistance;
      e.target.dataset.initialScale = scale;
    }
  };

  const handlePinchMove = (e) => {
    e.preventDefault(); // Предотвращаем нативное масштабирование страницы
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDistance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY
      );
      const initialDistance = parseFloat(e.target.dataset.initialDistance);
      const initialScale = parseFloat(e.target.dataset.initialScale);
      const newScale = initialScale * (currentDistance / initialDistance);
      setScale(Math.min(Math.max(newScale, 1), 3)); // Ограничиваем масштаб от 1x до 3x
    }
  };

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const modalVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.3, ease: 'easeOut' } },
    exit: { opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } },
  };

  const imageVariants = {
    hidden: { opacity: 0, x: (swipeDirection === 'horizontal' && touchCurrentX - touchStartX < 0) ? window.innerWidth : -window.innerWidth },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' } },
    exit: { opacity: 0, x: (swipeDirection === 'horizontal' && touchCurrentX - touchStartX < 0) ? -window.innerWidth : window.innerWidth, transition: { duration: 0.3, ease: 'easeIn' } },
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
              // На десктопе клик за пределами изображения закрывает модальное окно
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
              style={{ touchAction: 'none' }} // Отключаем нативный зум и скролл страницы
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
                    animate={scale > 1 ? {} : { // Отключаем Framer Motion анимации при зуме
                      x: (index - currentImageIndex) * window.innerWidth + panX,
                      y: panY,
                      opacity: scale > 1 && index !== currentImageIndex ? 0 : 1,
                      transition: isSwiping ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' },
                    }}
                    style={{
                      display: (!hasSwiped && index !== currentImageIndex) || (scale > 1 && index !== currentImageIndex) ? 'none' : 'flex', // Скрываем соседние изображения до первого свайпа или при зуме
                    }}
                  >
                    <img
                      ref={index === currentImageIndex ? imageRef : null} // Привязываем реф только к текущему изображению
                      src={image}
                      alt={`Screenshot ${index + 1}`}
                      className="w-full sm:max-w-full sm:max-h-[70vh] max-h-[80vh] sm:object-contain object-contain rounded-lg cursor-pointer"
                      onClick={window.innerWidth >= 640 ? handleImageClick : null}
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      onTouchStartCapture={handlePinchStart}
                      onTouchMoveCapture={handlePinchMove}
                      style={{
                        transform: index === currentImageIndex ? `scale(${scale}) translate(${offsetX}px, ${offsetY}px)` : 'scale(1)',
                        transformOrigin: 'center',
                        transition: isSwiping ? 'none' : 'transform 0.3s ease-in-out', // Плавный зум с небольшой анимацией
                      }}
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