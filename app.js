// --- DATA ---
const supabaseConfig = window.SUPABASE_CONFIG || {};
const siteSupabase = window.supabase && supabaseConfig.url && supabaseConfig.publishableKey
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  })
  : null;
window.siteSupabase = siteSupabase;

let loadedSessionUserId = null;
let viewedCatalogProfile = null;
const gameDataPromise = (async () => {
  if (!siteSupabase) throw new Error('Сервис временно недоступен.');
  // getSession restores the persisted browser session without requiring an
  // immediate Auth network request (which may fail behind an unstable proxy).
  const { data: authData, error: authError } = await siteSupabase.auth.getSession();
  if (authError) throw authError;
  const user = authData.session && authData.session.user;
  loadedSessionUserId = user ? user.id : null;
  try { localStorage.removeItem('site_active_profile'); } catch (_) { }
  const navEntry = window.performance && window.performance.getEntriesByType && window.performance.getEntriesByType('navigation')[0];
  const isReload = navEntry ? navEntry.type === 'reload' : (window.performance && window.performance.navigation && window.performance.navigation.type === 1);

  const urlParams = new URLSearchParams(window.location.search);
  let requestedUsername = isReload ? null : urlParams.get('profile');

  if (isReload && urlParams.has('profile')) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('profile');
    window.history.replaceState(null, '', cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ''));
  }

  let targetProfile = null;

  if (requestedUsername) {
    const { data: profile, error: profileError } = await siteSupabase.from('profiles')
      .select('id, username, display_name, avatar_path')
      .eq('username', requestedUsername)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile) {
      targetProfile = profile;
    }
  }

  if (!targetProfile && user) {
    const { data: myProfile, error: myProfileError } = await siteSupabase.from('profiles')
      .select('id, username, display_name, avatar_path')
      .eq('id', user.id)
      .maybeSingle();
    if (!myProfileError && myProfile) {
      targetProfile = myProfile;
    }
  }

  if (targetProfile) {
    viewedCatalogProfile = targetProfile;
  } else if (!user) {
    return { GAMES: [], REVIEWS: {}, catalogProfile: null };
  }

  const catalogOwnerId = targetProfile ? targetProfile.id : (user ? user.id : null);

  const { data: rows, error } = await siteSupabase
    .from('games')
    .select('id, title, developer, release_year, playtime_hours, genres, ratings, review, image_path, background_position_list_x, background_position_list_y, background_scale_list, background_position_grid_x, background_position_grid_y, background_scale_grid')
    .eq('owner_id', catalogOwnerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!rows.length) return { GAMES: [], REVIEWS: {}, catalogProfile: viewedCatalogProfile };

  const { data: signedImages, error: imageError } = await siteSupabase.storage
    .from('game-covers')
    .createSignedUrls(rows.map(game => game.image_path), 604800);
  if (imageError) throw imageError;
  const imageByPath = new Map((signedImages || []).map(item => [item.path, item.signedUrl]));
  const games = rows.map(game => {
    const playtimeHours = game.playtime_hours == null ? null : Math.round(Number(game.playtime_hours));
    return {
      id: game.id,
      title: game.title,
      developer: game.developer,
      image: imageByPath.get(game.image_path) || '',
      imagePath: game.image_path,
      genres: game.genres || [],
      ratings: game.ratings || {},
      year: game.release_year == null ? '' : String(game.release_year),
      playtime: playtimeHours == null ? '' : `${playtimeHours} ч.`,
      releaseYear: game.release_year == null ? '' : String(game.release_year),
      playtimeHours: playtimeHours == null ? '' : String(playtimeHours),
      review: game.review || '',
      cardDisplay: {
        list: {
          x: game.background_position_list_x,
          y: game.background_position_list_y,
          scale: game.background_scale_list
        },
        grid: {
          x: game.background_position_grid_x,
          y: game.background_position_grid_y,
          scale: game.background_scale_grid
        }
      }
    };
  });
  const reviews = Object.fromEntries(rows.map(game => [game.id, game.review || '']));
  return { GAMES: games, REVIEWS: reviews, catalogProfile: viewedCatalogProfile };
})();

let GAMES = [];
let REVIEWS = {};
const LABELS = { rating: "Общий рейтинг", story: "Сюжет", graphics: "Графика", gameplay: "Геймплей", main_character: "Герой", characters: "Персонажи", atmosphere: "Атмосфера", sound_design: "Саунд-дизайн", year: "Год выхода", playtime: "Время прохождения" };
const LABELS_FULL = { rating: "Общий рейтинг", story: "Сюжет", graphics: "Графика", gameplay: "Геймплей", main_character: "Главный герой", characters: "Персонажи", atmosphere: "Атмосфера", sound_design: "Саунд-дизайн", year: "Год выхода", playtime: "Время прохождения" };
const SORT_SHORT = { rating: "★ Общий", story: "Сюжет", graphics: "Графика", gameplay: "Геймплей", main_character: "Герой", characters: "Персонажи", atmosphere: "Атмосфера", sound_design: "Саунд-дизайн", year: "Год", playtime: "Время" };
const SORT_KEYS = Object.keys(LABELS);

const RATING_INFO = {
  title: "Как оцениваются игры",
  lead: "Итоговая оценка — это среднее арифметическое оценок по семи критериям.",
  items: [
    { label: "Шкала", text: "Каждый критерий оценивается по шкале от 1 до 10.\n**7** - удовлетворительно \n**8** - хорошо \n**9** - отлично \n**10** - недостижимо" },
    { label: "Сюжет", text: "Рассматривается оригинальность истории, её вариативность и реиграбельность." },
    { label: "Графика", text: "Основное внимание уделяется художественному стилю, детализации и левел-дизайну." },
    { label: "Геймплей", text: "Оценивается разнообразие механик, баланс ресурсов и органичное вплетение в динамику игры." },
    { label: "Главный герой", text: "Рассматривается цельность решений персонажа, последовательность действий и харизма." },
    { label: "Персонажи", text: "Фокус на цельности второстепенных героев, их импонируемости, запоминаемости." },
    { label: "Атмосфера", text: "Способность игры погружать в мир, удачное применение музыки и точность подобранных локаций." },
    { label: "Саунд-дизайн", text: "В первую очередь оценивается качество музыки и синергия звуковых эффектов с настроением игры." },
  ],
  usage: {
    title: "Как пользоваться сайтом",
    text: "Приведённая ниже инструкция будет скорее полезна десктопным пользователям. На мобильных устройствах сайт может немного отличаться, \
    но общая логика остаётся такой же. Сайт создан для тех, кто не может определиться с выбором игры, но знает, что ищет. \n\nВы можете найти игру по **жанру** (пр. хоррор), \
    по **рейтингу** (пр. 8.5+), **году выхода** (пр. 2020+) или **студии** (пр. Bethesda) через подвижный **поиск**, расположенный в верхней части сайта. \
    Жанры также можно исключить из поиска, *поставив* перед ними *минус* (пр. -инди). \n\nПоиск можно открыть через хоткей, нажав *слэш* или *точку* на клавиатуре. \
    \n\nМожно сменить **вид отображения** игр через \"v\" или открыть окно с жанрами через \"f\". В окне жанров так же можно исключить жанр, кликнув \
    по нему *ПКМ* или *дабл-клик ЛКМ*. \n\nСайт позволяет **сортировать** игры по различным критериям, включая **год выхода** и **среднее время прохождения**, \
    которое высчитывается на основе данных сайта HowLongToBeat с возможной корректировкой от автора сайта. Учитывается время, потраченное на основной \
    сюжет и часть доп-заданий.\n\nМожно **сравнить** несколько игр по параметрам, *зажав карточку* каждой из них, затем кликнуть по кнопке \"Сравнить\", \
    в открывшемся окне также можно увидеть графическое представление, нажав на 🕸️. \n\nВ левом нижнем углу есть меню, где можно воспользоваться теми \
    же функциями. \n\nПри нажатии на карточку игры откроется окно с подробной информацией о ней. Слева: критерии в числовом виде, которые \
    можно преобразовать в график, нажав на кнопку 🕸️. Снизу: небольшое описание-ревью от автора сайта. Справа: инфо-окно с небольшой информацией. \
    Также под ним есть кнопка, позволяющая найти и отобразить похожие по жанру игры. На каждую из них можно нажать, чтобы открыть её карточку. \
    Игры ищутся и сортируются исключительно по **количеству совпадающих жанров.**",
  },
  note: "Буду рад услышать любые отзывы и предложения по улучшению взаимодействия с сайтом. Телеграм - @zvuxoed.",
};

const InfoFormattedText = ({ className, children }) => {
  const parts = String(children).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <p className={className}>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </p>
  );
};

const prepareAvatarImage = async (file) => {
  if (!file || !file.type.startsWith('image/')) throw new Error('Выберите файл изображения.');
  const bitmap = await createImageBitmap(file);
  const maxSide = 512;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не смог обработать изображение.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  for (let quality = 0.88; quality >= 0.4; quality -= 0.08) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    if (blob && blob.type === 'image/webp' && blob.size <= 400 * 1024) return blob;
  }
  throw new Error('Не удалось сжать изображение до 400 КБ. Выберите картинку попроще.');
};

let memoryLibrariesCache = null;
try {
  const stored = sessionStorage.getItem('site_cached_libraries');
  if (stored) memoryLibrariesCache = JSON.parse(stored);
} catch (_) { }

let memoryProfileCache = new Map();
const getCachedProfile = (userId) => {
  if (memoryProfileCache.has(userId)) return memoryProfileCache.get(userId);
  try {
    const stored = sessionStorage.getItem('site_cached_profile_' + userId);
    if (stored) {
      const parsed = JSON.parse(stored);
      memoryProfileCache.set(userId, parsed);
      return parsed;
    }
  } catch (_) { }
  return null;
};
const setCachedProfile = (userId, data) => {
  memoryProfileCache.set(userId, data);
  try { sessionStorage.setItem('site_cached_profile_' + userId, JSON.stringify(data)); } catch (_) { }
};

const clearLocalAuthState = () => {
  let authKeyPrefix = 'sb-';
  try {
    const projectUrl = window.SUPABASE_CONFIG?.url;
    if (projectUrl) {
      const projectRef = new URL(projectUrl).hostname.split('.')[0];
      if (projectRef) authKeyPrefix = `sb-${projectRef}-`;
    }
  } catch (_) { }

  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      Object.keys(storage)
        .filter(key => key.startsWith(authKeyPrefix))
        .forEach(key => storage.removeItem(key));
      Object.keys(storage)
        .filter(key => key === 'site_active_profile' || key === 'site_cached_avatar' || key === 'site_cached_libraries' || key.startsWith('site_cached_profile_'))
        .forEach(key => storage.removeItem(key));
    } catch (_) { }
  }
  memoryProfileCache.clear();
  memoryLibrariesCache = null;
};

const AuthModal = ({ isOpen, initialTab = 'signin', onClose, onSuccess }) => {
  const [tab, setTab] = useState(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setMessage('');
      setMessageError(false);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const normalizeAuthError = (error) => {
    const text = (error && error.message) || '';
    if (/invalid login credentials/i.test(text)) return 'Неверная почта или пароль.';
    if (/username|profiles_username_format|duplicate key/i.test(text)) return 'Этот логин уже занят или имеет неверный формат.';
    if (/already registered|User already registered/i.test(text)) return 'Пользователь с такой почтой уже зарегистрирован.';
    if (/email rate limit/i.test(text)) return 'Слишком много писем подтверждения. Попробуйте позже.';
    if (/password should be at least/i.test(text)) return 'Пароль должен содержать минимум 8 символов.';
    if (/fetch|network|supabase|rpc|postgres|schema|relation|table|violates/i.test(text)) {
      return 'Не удалось выполнить запрос. Попробуйте позже.';
    }
    return text || 'Произошла ошибка при авторизации.';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setMessageError(false);
    const client = window.siteSupabase;
    if (!client) {
      setMessage('Сервис временно недоступен.');
      setMessageError(true);
      return;
    }

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setMessage('Заполните все обязательные поля.');
      setMessageError(true);
      return;
    }

    setBusy(true);
    try {
      if (tab === 'signup') {
        const cleanUsername = username.trim().toLowerCase();
        const cleanDisplayName = displayName.trim() || cleanUsername;
        if (!cleanUsername || !/^[A-Za-z0-9_]{3,24}$/.test(cleanUsername)) {
          setMessage('Логин: 3–24 символа (латиница, цифры, _).');
          setMessageError(true);
          setBusy(false);
          return;
        }
        if (password.length < 8) {
          setMessage('Пароль должен быть не менее 8 символов.');
          setMessageError(true);
          setBusy(false);
          return;
        }

        const { data, error } = await client.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              username: cleanUsername,
              display_name: cleanDisplayName
            }
          }
        });
        if (error) throw error;

        if (!data.session) {
          setMessage('Письмо с подтверждением отправлено на почту. После подтверждения войдите.');
          setMessageError(false);
          setTab('signin');
        } else {
          onClose();
          if (onSuccess) onSuccess(data.user);
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({
          email: cleanEmail,
          password
        });
        if (error) throw error;
        onClose();
        if (onSuccess) onSuccess(data.user);
      }
    } catch (err) {
      console.error('Auth error:', err);
      setMessage(normalizeAuthError(err));
      setMessageError(true);
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="auth-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <div className="auth-modal-top">
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signin'}
              className={`auth-tab-btn ${tab === 'signin' ? 'active' : ''}`}
              onClick={() => { setTab('signin'); setMessage(''); }}
            >
              Войти
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signup'}
              className={`auth-tab-btn ${tab === 'signup' ? 'active' : ''}`}
              onClick={() => { setTab('signup'); setMessage(''); }}
            >
              Регистрация
            </button>
          </div>
          <button type="button" className="auth-close-btn" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {tab === 'signup' && (
            <>
              <div className="auth-field">
                <label htmlFor="auth-username">Логин *</label>
                <input
                  id="auth-username"
                  type="text"
                  required
                  minLength={3}
                  maxLength={24}
                  pattern="[A-Za-z0-9_]+"
                  placeholder="Только латиница, цифры и _"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  disabled={busy}
                />
                <small>Будет ссылкой на вашу публичную библиотеку</small>
              </div>
              <div className="auth-field">
                <label htmlFor="auth-display-name">Имя профиля</label>
                <input
                  id="auth-display-name"
                  type="text"
                  maxLength={48}
                  placeholder="Как вас показывать в профиле"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="nickname"
                  disabled={busy}
                />
              </div>
            </>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email">Электронная почта *</label>
            <input
              id="auth-email"
              type="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={busy}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Пароль *</label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={8}
              placeholder={tab === 'signup' ? 'Минимум 8 символов' : 'Ваш пароль'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
              disabled={busy}
            />
          </div>

          {message && (
            <div className={`auth-message ${messageError ? 'error' : ''}`} role="status">
              {message}
            </div>
          )}

          <button type="submit" className="auth-submit-btn" disabled={busy}>
            {busy ? 'Подождите…' : (tab === 'signup' ? 'Создать аккаунт' : 'Войти')}
          </button>
        </form>
      </div>
    </>
  );
};

const LibraryDrawer = ({ isOpen, onClose, onSelectProfile }) => {
  const [libraries, setLibraries] = useState(() => memoryLibrariesCache || []);
  const [loading, setLoading] = useState(() => !memoryLibrariesCache || memoryLibrariesCache.length === 0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = event => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    if (memoryLibrariesCache && memoryLibrariesCache.length > 0) {
      setLibraries(memoryLibrariesCache);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const loadLibraries = async () => {
      setError('');
      try {
        const client = window.siteSupabase;
        if (!client) throw new Error('Сервис временно недоступен.');
        const [{ data, error: listError }, { data: modData }] = await Promise.all([
          client.rpc('list_public_libraries'),
          client.from('profiles').select('id').eq('is_moderator', true)
        ]);
        if (listError) throw listError;
        const entries = data || [];
        const modIdSet = new Set((modData || []).map(m => m.id));
        const avatarPaths = entries.map(item => item.avatar_path).filter(Boolean);
        let avatarByPath = new Map();
        if (avatarPaths.length) {
          const { data: signed, error: avatarError } = await client.storage
            .from('profile-avatars').createSignedUrls(avatarPaths, 604800);
          if (avatarError) console.warn('Не удалось загрузить некоторые аватары:', avatarError);
          avatarByPath = new Map((signed || []).map(item => [item.path, item.signedUrl]));
        }
        const mapped = entries.map(item => ({
          ...item,
          is_moderator: modIdSet.has(item.profile_id),
          avatarUrl: item.avatar_path ? avatarByPath.get(item.avatar_path) || '' : ''
        }));

        // Sort: moderator always at top, then by game_count descending, then alphabetical
        mapped.sort((a, b) => {
          if (a.is_moderator && !b.is_moderator) return -1;
          if (!a.is_moderator && b.is_moderator) return 1;
          const countA = Number(a.game_count || 0);
          const countB = Number(b.game_count || 0);
          if (countB !== countA) return countB - countA;
          return (a.display_name || a.username || '').localeCompare(b.display_name || b.username || '', 'ru');
        });

        memoryLibrariesCache = mapped;
        try { sessionStorage.setItem('site_cached_libraries', JSON.stringify(mapped)); } catch (_) { }
        if (active) {
          setLibraries(mapped);
          setLoading(false);
        }
      } catch (loadError) {
        console.error('Load public libraries error:', loadError);
        if (active && (!memoryLibrariesCache || memoryLibrariesCache.length === 0)) {
          setError('Не удалось загрузить список библиотек. Попробуйте обновить страницу.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    loadLibraries();
    return () => {
      active = false;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && <motion.div
        className="library-drawer-layer"
        key="library-drawer-layer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="library-drawer-backdrop" onClick={onClose} aria-hidden="true" />
        <motion.aside
          className="library-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-drawer-title"
          initial={{ x: '-100%' }}
          animate={{ x: 0 }}
          exit={{ x: '-100%' }}
          transition={{ type: 'spring', stiffness: 360, damping: 36 }}
        >
          <div className="library-drawer-header">
            <h2 id="library-drawer-title">Библиотеки пользователей</h2>
            <button type="button" className="library-drawer-close" onClick={onClose} aria-label="Закрыть">×</button>
          </div>
          <div className="library-drawer-list">
            {loading && <p className="library-drawer-message">Загружаю список…</p>}
            {!loading && error && <p className="library-drawer-message" role="status">{error}</p>}
            {!loading && !error && libraries.length === 0 && <p className="library-drawer-message">Пока нет публичных библиотек.</p>}
            {!loading && !error && libraries.map(item => (
              <button
                type="button"
                className="library-person"
                key={item.profile_id}
                onClick={() => onSelectProfile(item.username)}
                aria-label={`Открыть библиотеку ${item.display_name}, ${formatGameCount(item.game_count)}`}
              >
                <span className="library-person-avatar">
                  {item.avatarUrl
                    ? <img src={item.avatarUrl} alt="" />
                    : <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.4 3.3-5.2 7-5.2s6.3 1.8 7 5.2" /></svg>}
                </span>
                <span className="library-person-name">
                  <strong>{item.display_name || item.username}</strong>
                  <small>@{item.username}</small>
                </span>
                <span className="library-person-count">{formatGameCount(item.game_count)}</span>
              </button>
            ))}
          </div>
        </motion.aside>
      </motion.div>}
    </AnimatePresence>
  );
};

const CommentBody = ({ text, games, onOpenGame }) => {
  const source = String(text || '');
  const candidates = (games || [])
    .map(game => ({
      game,
      token: `@${String(game.title || '').trim()}`
    }))
    .filter(item => item.token.length > 1)
    .sort((a, b) => b.token.length - a.token.length)
    .map(item => ({ ...item, lowerToken: item.token.toLocaleLowerCase() }));

  if (!source || !candidates.length || !onOpenGame) return source;
  const lowerSource = source.toLocaleLowerCase();
  const parts = [];
  let cursor = 0;
  let mentionKey = 0;

  while (cursor < source.length) {
    let match = null;
    candidates.forEach(candidate => {
      let searchFrom = cursor;
      while (searchFrom < source.length) {
        const index = lowerSource.indexOf(candidate.lowerToken, searchFrom);
        if (index < 0) break;
        const previous = index > 0 ? source[index - 1] : '';
        const next = source[index + candidate.token.length] || '';
        const isWord = value => /[A-Za-zА-Яа-яЁё0-9_]/.test(value);
        if (!isWord(previous) && !isWord(next)) {
          if (!match || index < match.index || (index === match.index && candidate.token.length > match.candidate.token.length)) {
            match = { index, candidate };
          }
          break;
        }
        searchFrom = index + 1;
      }
    });

    if (!match) {
      parts.push(source.slice(cursor));
      break;
    }
    if (match.index > cursor) parts.push(source.slice(cursor, match.index));
    parts.push(
      <button
        type="button"
        className="profile-comment-game-link"
        key={`comment-game-${mentionKey++}`}
        onClick={() => onOpenGame(match.candidate.game)}
        title={`Открыть игру «${match.candidate.game.title}»`}
      >
        {source.slice(match.index, match.index + match.candidate.token.length)}
      </button>
    );
    cursor = match.index + match.candidate.token.length;
  }

  return parts;
};

const CommentsDrawer = ({ isOpen, onClose, profile, currentUser, games, onOpenGame, onRequestAuth }) => {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState('');
  const [isModerator, setIsModerator] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = event => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    const loadComments = async () => {
      setLoading(true);
      setMessage('');
      setMessageError(false);
      setIsModerator(false);
      try {
        const client = window.siteSupabase;
        if (!client) throw new Error('Сервис временно недоступен.');
        if (!profile?.id) {
          if (active) setComments([]);
          return;
        }

        const [{ data: rows, error: commentsError }, moderatorResult] = await Promise.all([
          client.from('profile_comments')
            .select('id, profile_id, author_id, body, created_at')
            .eq('profile_id', profile.id)
            .order('created_at', { ascending: false }),
          currentUser
            ? client.from('profiles').select('is_moderator').eq('id', currentUser.id).maybeSingle()
            : Promise.resolve({ data: null })
        ]);
        if (commentsError) throw commentsError;

        const authorIds = [...new Set((rows || []).map(item => item.author_id).filter(Boolean))];
        let authorById = new Map();
        if (authorIds.length) {
          const { data: authors, error: authorsError } = await client.from('profiles')
            .select('id, username, display_name')
            .in('id', authorIds);
          if (authorsError) console.warn('Не удалось загрузить имена авторов комментариев:', authorsError);
          authorById = new Map((authors || []).map(author => [author.id, author]));
        }

        if (active) {
          setComments((rows || []).map(item => ({
            ...item,
            author: authorById.get(item.author_id) || null
          })));
          setIsModerator(Boolean(moderatorResult?.data?.is_moderator));
        }
      } catch (loadError) {
        console.error('Load profile comments error:', loadError);
        if (active) {
          setComments([]);
          setMessage('Не удалось загрузить комментарии. Попробуйте позже.');
          setMessageError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadComments();
    return () => {
      active = false;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, profile?.id, currentUser?.id, refreshKey]);

  const submitComment = async event => {
    event.preventDefault();
    const body = commentBody.trim();
    if (!body || !currentUser || !profile?.id || saving) return;
    setSaving(true);
    setMessage('');
    setMessageError(false);
    try {
      const { error } = await window.siteSupabase.from('profile_comments').insert({
        profile_id: profile.id,
        author_id: currentUser.id,
        body
      });
      if (error) throw error;
      setCommentBody('');
      setRefreshKey(value => value + 1);
    } catch (saveError) {
      console.error('Save profile comment error:', saveError);
      setMessage(saveError?.message || 'Не удалось отправить комментарий.');
      setMessageError(true);
    } finally {
      setSaving(false);
    }
  };

  const deleteComment = async comment => {
    if (!currentUser || (!isModerator && comment.author_id !== currentUser.id) || actionId) return;
    setActionId(comment.id);
    setMessage('');
    setMessageError(false);
    try {
      const { error } = await window.siteSupabase.from('profile_comments').delete().eq('id', comment.id);
      if (error) throw error;
      setRefreshKey(value => value + 1);
    } catch (deleteError) {
      console.error('Delete profile comment error:', deleteError);
      setMessage(deleteError?.message || 'Не удалось удалить комментарий.');
      setMessageError(true);
    } finally {
      setActionId('');
    }
  };

  const profileLabel = profile
    ? `${profile.display_name || profile.username || 'Профиль'}${profile.username ? ` · @${profile.username}` : ''}`
    : 'Профиль не выбран';

  return (
    <AnimatePresence>
      {isOpen && <motion.div
        className="library-drawer-layer"
        key="comments-drawer-layer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="library-drawer-backdrop" onClick={onClose} aria-hidden="true" />
        <motion.aside
          className="comments-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="comments-drawer-title"
          initial={{ x: '-100%' }}
          animate={{ x: 0 }}
          exit={{ x: '-100%' }}
          transition={{ type: 'spring', stiffness: 360, damping: 36 }}
        >
          <div className="comments-drawer-header">
            <div className="comments-drawer-heading">
              <h2 id="comments-drawer-title">Комментарии</h2>
              <p className="comments-drawer-profile">{profileLabel}</p>
            </div>
            <button type="button" className="comments-drawer-close" onClick={onClose} aria-label="Закрыть">×</button>
          </div>

          <div className="comments-drawer-content">
            {!profile && <p className="comments-form-message">Откройте профиль, чтобы посмотреть его комментарии.</p>}
            {profile && <>
              <div className="comments-list" aria-live="polite">
                {loading && <p className="comments-form-message">Загружаю комментарии…</p>}
                {!loading && !comments.length && <p className="comments-form-message">Комментариев пока нет.</p>}
                {!loading && comments.map(comment => {
                  const canDelete = currentUser && (isModerator || comment.author_id === currentUser.id);
                  const authorName = comment.author?.display_name || comment.author?.username || 'Пользователь';
                  const dateLabel = comment.created_at
                    ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(comment.created_at))
                    : '';
                  return (
                    <article className="profile-comment" key={comment.id}>
                      <div className="profile-comment-meta">
                        <span className="profile-comment-author">{authorName}</span>
                        <time className="profile-comment-date" dateTime={comment.created_at}>{dateLabel}</time>
                      </div>
                      <p className="profile-comment-body"><CommentBody text={comment.body} games={games} onOpenGame={onOpenGame} /></p>
                      {canDelete && <button
                        type="button"
                        className="profile-comment-delete"
                        onClick={() => deleteComment(comment)}
                        disabled={actionId === comment.id}
                      >
                        {actionId === comment.id ? 'Удаляю…' : 'Удалить'}
                      </button>}
                    </article>
                  );
                })}
              </div>

              {message && <p className={`comments-form-message ${messageError ? 'error' : ''}`} role="status">{message}</p>}
              {currentUser ? <form className="comments-form" onSubmit={submitComment}>
                <textarea
                  value={commentBody}
                  maxLength={1000}
                  placeholder="Оставьте комментарий…"
                  onChange={event => setCommentBody(event.target.value)}
                  disabled={saving}
                />
                <div className="comments-form-footer">
                  <span className="comments-form-limit">До 1000 символов</span>
                  <button type="submit" className="comments-form-submit" disabled={saving || !commentBody.trim()}>
                    {saving ? 'Отправляю…' : 'Оставить комментарий'}
                  </button>
                </div>
              </form> : <div className="comments-form">
                <p className="comments-form-message">Войдите, чтобы оставить комментарий.</p>
                <button type="button" className="comments-form-submit" onClick={onRequestAuth}>Войти</button>
              </div>}
            </>}
          </div>
        </motion.aside>
      </motion.div>}
    </AnimatePresence>
  );
};

const ProfilePopover = ({ isOpen, onClose, user, onAvatarChange }) => {
  const [profile, setProfile] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [moderationCount, setModerationCount] = useState(0);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const [deleteTitle, setDeleteTitle] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const renderVersionRef = useRef(0);
  const avatarInputRef = useRef(null);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !user) {
      setProfile(null);
      setIsEditingName(false);
      return;
    }
    setIsEditingName(false);
    const cached = getCachedProfile(user.id);
    if (cached) {
      setProfile(cached);
      setNameInput(cached.display_name || '');
      if (cached.avatarUrl) onAvatarChange(cached.avatarUrl);
    }
    const version = Date.now();
    renderVersionRef.current = version;
    loadProfile(version);
  }, [isOpen, user]);

  const loadProfile = async (version) => {
    const client = window.siteSupabase;
    if (!client) {
      setMessage('Сервис временно недоступен.');
      setMessageError(true);
      return;
    }

    try {
      const { data: profileData, error: profileError } = await client
        .from('profiles')
        .select('username, display_name, is_moderator')
        .eq('id', user.id)
        .single();

      if (version !== renderVersionRef.current) return;

      if (profileError) {
        console.error('Profile error:', profileError);
        setMessage('Не удалось загрузить профиль.');
        setMessageError(true);
        return;
      }

      const { data: avatarData, error: avatarError } = await client.from('profiles')
        .select('avatar_path').eq('id', user.id).single();
      if (avatarError) console.warn('Не удалось загрузить фото профиля:', avatarError);
      profileData.avatar_path = avatarError ? null : avatarData?.avatar_path || null;

      let avatarUrl = '';
      if (profileData.avatar_path) {
        const { data: signed } = await client.storage.from('profile-avatars')
          .createSignedUrl(profileData.avatar_path, 604800);
        avatarUrl = signed?.signedUrl || '';
      }
      if (version !== renderVersionRef.current) return;
      const updatedProfile = { ...profileData, avatarUrl };
      setCachedProfile(user.id, updatedProfile);
      setProfile(updatedProfile);
      onAvatarChange(avatarUrl);

      // Фоновая очистка старых/осиротевших аватаров пользователя в бакете:
      (async () => {
        try {
          const { data: fileList } = await client.storage.from('profile-avatars').list(user.id);
          if (fileList && fileList.length > 1) {
            const activeName = profileData.avatar_path ? profileData.avatar_path.split('/').pop() : '';
            const orphans = fileList
              .filter(f => f.name && f.name !== activeName && !f.name.startsWith('.'))
              .map(f => `${user.id}/${f.name}`);
            if (orphans.length > 0) {
              await client.storage.from('profile-avatars').remove(orphans);
            }
          }
        } catch (_) { }
      })();

      if (profileData.is_moderator) {
        await loadModerationCount(version);
      } else {
        await loadSubmissions(version);
      }
    } catch (err) {
      console.error('Load profile error:', err);
      setMessage('Ошибка загрузки профиля.');
      setMessageError(true);
    }
  };

  const loadSubmissions = async (version) => {
    const client = window.siteSupabase;
    try {
      // Сначала очищаем старые просмотренные заявки
      await client.rpc('cleanup_old_viewed_submissions');

      // Загружаем только последние 3 заявки
      const { data, error } = await client
        .from('game_submissions')
        .select('id, title, status, moderator_note, created_at, viewed_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(3);

      if (version !== renderVersionRef.current) return;
      if (!error) {
        setSubmissions(data || []);
        // Помечаем непросмотренные заявки как просмотренные
        (data || []).forEach(async (submission) => {
          if (!submission.viewed_at && submission.status !== 'pending') {
            await client.rpc('mark_submission_as_viewed', { p_submission_id: submission.id });
          }
        });
      }
    } catch (err) {
      console.error('Load submissions error:', err);
    }
  };

  const loadModerationCount = async (version) => {
    const client = window.siteSupabase;
    try {
      const { count, error } = await client
        .from('game_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (version !== renderVersionRef.current) return;
      if (error) throw error;
      setModerationCount(count || 0);
    } catch (err) {
      console.error('Load moderation count error:', err);
    }
  };

  const handleDeleteGame = async (e) => {
    e.preventDefault();
    const title = deleteTitle.trim();
    if (!title) return;
    if (!window.confirm('Карточка игры будет удалена без возможности восстановления. Продолжить?')) return;

    setDeleteLoading(true);
    const client = window.siteSupabase;
    try {
      const { data: imagePath, error } = await client.rpc('delete_catalog_game', {
        p_title: title,
        p_confirmation: title
      });
      if (error) throw error;

      if (imagePath) {
        await client.storage.from('game-covers').remove([imagePath]);
        setMessage('Карточка и обложка удалены безвозвратно.');
      } else {
        setMessage('Карточка удалена. Обложка сохранена, так как используется другой карточкой.');
      }
      setMessageError(false);
      setDeleteTitle('');
    } catch (error) {
      setMessage(error.message || 'Ошибка удаления.');
      setMessageError(true);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSignOut = async () => {
    const client = window.siteSupabase;
    const { error } = client ? await client.auth.signOut({ scope: 'local' }) : { error: null };
    if (error) {
      setMessage(error.message);
      setMessageError(true);
    } else {
      clearLocalAuthState();
      window.location.href = './index.html';
    }
  };

  const handleResetAuth = () => {
    clearLocalAuthState();
    window.location.href = './index.html';
  };

  const handleAvatarUpload = async (event) => {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || !user) return;

    setAvatarLoading(true);
    setMessage('');
    let uploadedPath = '';
    try {
      const image = await prepareAvatarImage(file);
      const client = window.siteSupabase;
      const nextPath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
      const { error: uploadError } = await client.storage.from('profile-avatars').upload(nextPath, image, {
        contentType: 'image/webp',
        cacheControl: '3600',
        upsert: false
      });
      if (uploadError) throw uploadError;
      uploadedPath = nextPath;

      // Обновляем аватар в профиле
      const oldPath = profile?.avatar_path;
      const { error: updateError } = await client.from('profiles')
        .update({ avatar_path: nextPath }).eq('id', user.id).select('id').single();
      if (updateError) throw updateError;

      // Создаем signed URL для загруженного аватара
      const { data: signed, error: signedError } = await client.storage.from('profile-avatars')
        .createSignedUrl(nextPath, 604800);
      if (signedError) throw signedError;

      const avatarUrl = signed?.signedUrl || '';
      setProfile(current => {
        const next = current ? { ...current, avatar_path: nextPath, avatarUrl } : current;
        if (next) setCachedProfile(user.id, next);
        return next;
      });
      onAvatarChange(avatarUrl);
      setMessage('Фото профиля обновлено.');
      setMessageError(false);

      // Надежная очистка: удаляем старый аватар и любые другие накопившиеся файлы
      try {
        if (oldPath && oldPath !== nextPath) {
          const { error: oldRemoveError } = await client.storage.from('profile-avatars').remove([oldPath]);
          if (oldRemoveError) console.warn('Ошибка удаления oldPath:', oldRemoveError);
        }
        const { data: fileList } = await client.storage.from('profile-avatars').list(user.id);
        if (fileList && fileList.length > 0) {
          const currentFileName = nextPath.split('/').pop();
          const staleFiles = fileList
            .filter(item => item.name && item.name !== currentFileName && !item.name.startsWith('.'))
            .map(item => `${user.id}/${item.name}`);
          if (staleFiles.length > 0) {
            const { error: removeError } = await client.storage.from('profile-avatars').remove(staleFiles);
            if (removeError) console.warn('Ошибка удаления старых аватаров из списка:', removeError);
          }
        }
      } catch (cleanErr) {
        console.warn('Ошибка очистки старых аватаров:', cleanErr);
      }
    } catch (error) {
      // Откатываем загруженный файл при ошибке
      if (uploadedPath) await window.siteSupabase.storage.from('profile-avatars').remove([uploadedPath]).catch(() => { });
      setMessage(error.message || 'Не удалось загрузить фото профиля.');
      setMessageError(true);
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleStartEditName = () => {
    setNameInput(profile?.display_name || '');
    setIsEditingName(true);
    setMessage('');
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setNameInput(profile?.display_name || '');
  };

  const handleSaveName = async (e) => {
    if (e) e.preventDefault();
    const trimmed = (nameInput || '').trim();
    if (!trimmed) {
      setMessage('Имя не может быть пустым.');
      setMessageError(true);
      return;
    }
    if (trimmed.length > 48) {
      setMessage('Имя не должно превышать 48 символов.');
      setMessageError(true);
      return;
    }
    if (trimmed === profile?.display_name) {
      setIsEditingName(false);
      return;
    }

    setNameSaving(true);
    setMessage('');
    const client = window.siteSupabase;
    try {
      const { error: updateError } = await client
        .from('profiles')
        .update({ display_name: trimmed })
        .eq('id', user.id);

      if (updateError) {
        console.error('Update display_name error:', updateError);
        setMessage('Не удалось обновить имя.');
        setMessageError(true);
        return;
      }

      setProfile(prev => {
        const next = prev ? { ...prev, display_name: trimmed } : prev;
        if (next) setCachedProfile(user.id, next);
        return next;
      });
      setIsEditingName(false);
      setMessage('Имя успешно обновлено.');
      setMessageError(false);
    } catch (err) {
      console.error('Save name error:', err);
      setMessage('Ошибка при сохранении имени.');
      setMessageError(true);
    } finally {
      setNameSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="profile-backdrop" onClick={onClose} />
      <div className="profile-popover">
        <div className="profile-header">
          <button
            type="button"
            className="profile-avatar-preview"
            title={avatarLoading ? 'Обработка фото…' : 'Нажмите, чтобы добавить или заменить фото'}
            aria-label={avatarLoading ? 'Фото профиля обрабатывается' : 'Добавить или заменить фото профиля'}
            disabled={avatarLoading}
            onClick={() => avatarInputRef.current?.click()}
          >
            {profile?.avatarUrl
              ? <img src={profile.avatarUrl} alt="" />
              : <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.4 3.3-5.2 7-5.2s6.3 1.8 7 5.2" /></svg>}
            <span className="profile-avatar-edit-icon" aria-hidden="true">✎</span>
          </button>
          <input ref={avatarInputRef} className="profile-avatar-file" type="file" accept="image/*" disabled={avatarLoading} onChange={handleAvatarUpload} />
          <div className="profile-info">
            {isEditingName ? (
              <form className="profile-name-edit-form" onSubmit={handleSaveName}>
                <input
                  ref={nameInputRef}
                  type="text"
                  className="profile-name-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleCancelEditName();
                  }}
                  maxLength={48}
                  placeholder="Имя профиля"
                  disabled={nameSaving}
                  aria-label="Имя профиля"
                />
                <button type="submit" className="profile-name-save-btn" disabled={nameSaving || !nameInput.trim()} title="Сохранить" aria-label="Сохранить">✓</button>
                <button type="button" className="profile-name-cancel-btn" disabled={nameSaving} onClick={handleCancelEditName} title="Отмена" aria-label="Отмена">✕</button>
              </form>
            ) : (
              <div className="profile-name-row">
                <h2>{profile?.display_name || 'Загрузка...'}</h2>
                {profile && (
                  <button
                    type="button"
                    className="profile-name-edit-btn"
                    title="Изменить имя"
                    aria-label="Изменить имя профиля"
                    onClick={handleStartEditName}
                  >
                    ✎
                  </button>
                )}
              </div>
            )}
            <p>@{profile?.username || '...'}</p>
            <p>Почта: {user?.email || 'не указана'}</p>
          </div>
          <button className="profile-close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        {profile && (
          <>
            {profile.is_moderator ? (
              <div className="profile-section">
                <h3>Модерация заявок</h3>
                <p style={{ margin: '0 0 10px', fontSize: '0.82rem', opacity: 0.68 }}>
                  Ожидающих заявок: {moderationCount}
                </p>
                <button
                  type="button"
                  className="profile-moderation-link"
                  onClick={() => { window.location.href = './moderation/moderation.html'; }}
                >
                  Открыть список заявок
                </button>
              </div>
            ) : (
              <div className="profile-section">
                <h3>Мои заявки</h3>
                {submissions.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.82rem', opacity: 0.68 }}>Заявок пока нет.</p>
                ) : (
                  submissions.map(item => (
                    <div key={item.id} className="profile-submission">
                      <strong>{item.title}</strong>
                      <div className="profile-status">
                        {item.status === 'pending' ? 'Ожидает проверки' : item.status === 'approved' ? 'Одобрена' : 'Отклонена'}
                      </div>
                      {item.moderator_note && <p style={{ margin: '4px 0 0', fontSize: '0.72rem', opacity: 0.68 }}>{item.moderator_note}</p>}
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="delete-game-section">
              <h3>Удаление своей игры</h3>
              <form className="delete-game-form" onSubmit={handleDeleteGame}>
                <input
                  type="text"
                  placeholder="Название игры"
                  value={deleteTitle}
                  onChange={(e) => setDeleteTitle(e.target.value)}
                  maxLength={120}
                  autoComplete="off"
                />
                <button type="submit" disabled={deleteLoading || !deleteTitle.trim()}>
                  {deleteLoading ? 'Удаление...' : 'Удалить'}
                </button>
              </form>
            </div>

            <div className="profile-actions">
              <button onClick={handleSignOut}>Выйти</button>
            </div>

            {message && (
              <div className={`profile-message ${messageError ? 'error' : ''}`}>
                {message}
              </div>
            )}
          </>
        )}

        {!profile && (
          <>
            <div className="profile-message error">
              {message || 'Профиль не найден. Можно выйти из аккаунта или сбросить локальную сессию.'}
            </div>
            <div className="profile-actions">
              <button onClick={handleSignOut}>Выйти</button>
              <button className="secondary" onClick={handleResetAuth}>Сбросить сессию</button>
            </div>
          </>
        )}
      </div>
    </>
  );
};


const SortDock = ({ value, onChange }) => {
  return (
    <div className="sort-dock" role="toolbar" aria-label="Сортировка по критериям">
      <div className="sort-dock-track">
        {SORT_KEYS.map((key) => {
          const isActive = value === key;
          return (
            <button
              key={key}
              type="button"
              className={`sort-dock-btn ${isActive ? 'active' : ''}`}
              onClick={() => onChange(key)}
              title={LABELS[key]}
              aria-pressed={isActive}
            >
              {isActive && (
                <motion.div
                  layoutId="sortActiveIndicator"
                  className="sort-dock-indicator"
                  transition={{
                    type: 'spring',
                    stiffness: 450,
                    damping: 32,
                  }}
                />
              )}
              <span style={{ position: 'relative', zIndex: 2 }}>
                {SORT_SHORT[key]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const CRITERIA_KEYS = ["story", "graphics", "gameplay", "main_character", "characters", "atmosphere", "sound_design"];
const calcRating = (ratings) => {
  const vals = CRITERIA_KEYS.map(k => ratings[k]).filter(v => v !== undefined);
  if (!vals.length) return 0;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(avg * 10) / 10;
};

const normalizeSearchPart = (value) =>
  value.toLowerCase().replace(/ё/g, "е").trim();

const formatGameCount = (value) => {
  const count = Number(value) || 0;
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  const word = remainder100 >= 11 && remainder100 <= 14
    ? 'игр'
    : remainder10 === 1 ? 'игра' : remainder10 >= 2 && remainder10 <= 4 ? 'игры' : 'игр';
  return `${count} ${word}`;
};

// Каждый жанр хранит только каноническое имя и список слов-синонимов через запятую.
// Это упрощает расширение: добавляем новый жанр или уточняем его слова в одном месте.
const GENRE_RULES = [
  { label: "РПГ", aliases: "rpg, ролев" },
  { label: "Экшен", aliases: "экшн, action" },
  { label: "Инди", aliases: "indie, индю" },
  { label: "Хоррор", aliases: "horror, ужас, страш, страх" },
  { label: "Приключение", aliases: "приключ, adventure, адвенч" },
  { label: "Шутер", aliases: "shooter, стрелял" },
  { label: "Платформер", aliases: "platformer" },
  { label: "Сюжетная", aliases: "сюжет, story, narrative" },
  { label: "Кооператив", aliases: "кооп, coop, co-op, совместн" },
  { label: "Головоломка", aliases: "головолом, пазл, puzzle" },
  { label: "Фэнтези", aliases: "фентези, fantasy" },
  { label: "Открытый мир", aliases: "открыт, open, мир" },
  { label: "Стелс", aliases: "stealth" },
  { label: "Соулс-лайк", aliases: "соулс, souls, сосалик" },
  { label: "Киберпанк", aliases: "cyberpunk" },
  { label: "Выживание", aliases: "выжива, выживал, survival" },
  { label: "Карточная", aliases: "карточ, card" },
  { label: "Метроидвания", aliases: "метроид, metroid" },
  { label: "QTE", aliases: "qte, quick" },
  { label: "Научная фантастика", aliases: "фантасти, scifi, sci-fi, научн, скайфай" },
  { label: "Постапокалипсис", aliases: "постапокалип, постап, postap" },
  { label: "Интерактивное кино", aliases: "интер, кино, inter" },
];
const GENRES = GENRE_RULES
  .map(({ label }) => label)
  .sort((a, b) => a.localeCompare(b, 'ru'));
const GENRE_ALIAS_INDEX = GENRE_RULES.map(({ label, aliases }) => ({
  label,
  aliases: [label, ...aliases.split(",")].map(normalizeSearchPart).filter(Boolean),
}));

const SEARCH_SUGGESTIONS = [
  {
    query: "capcom хоррор 8.1+",
    hint: "студия Capcom · жанр хоррор · рейтинг от 8.1",
  },
  {
    query: "-хоррор науч 9+ 2020-",
    hint: "без хоррора · научная фантастика · рейтинг от 9 · до 2020 года",
  },
  {
    query: "rpg 8+ 2015+",
    hint: "RPG с рейтингом от 8 · игры с 2015 года",
  },
];

const { useState, useEffect, useMemo, useRef } = React;
const { motion, AnimatePresence } = window.Motion;

const ADD_GAME_RATINGS = [
  ['story', 'Сюжет'], ['graphics', 'Графика'], ['gameplay', 'Геймплей'],
  ['main_character', 'Главный герой'], ['characters', 'Персонажи'],
  ['atmosphere', 'Атмосфера'], ['sound_design', 'Саунд-дизайн']
];

const ADD_GAME_GENRES = [
  'Выживание', 'Головоломка', 'Инди', 'Интерактивное кино', 'Карточная', 'Киберпанк',
  'Кооператив', 'Метроидвания', 'Научная фантастика', 'Открытый мир', 'Платформер',
  'Постапокалипсис', 'Приключение', 'РПГ', 'Соулс-лайк', 'Стелс', 'Сюжетная', 'Фэнтези',
  'Хоррор', 'Шутер', 'Экшен', 'QTE'
];

const DEFAULT_CARD_DISPLAY = {
  list: { x: 50, y: 50, scale: 100 },
  grid: { x: 50, y: 50, scale: 100 }
};

const clampCardDisplayValue = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

const normalizeCardDisplay = (display) => ({
  list: {
    x: clampCardDisplayValue(display?.list?.x, 0, 100, DEFAULT_CARD_DISPLAY.list.x),
    y: clampCardDisplayValue(display?.list?.y, 0, 100, DEFAULT_CARD_DISPLAY.list.y),
    scale: clampCardDisplayValue(display?.list?.scale, 100, 200, DEFAULT_CARD_DISPLAY.list.scale)
  },
  grid: {
    x: clampCardDisplayValue(display?.grid?.x, 0, 100, DEFAULT_CARD_DISPLAY.grid.x),
    y: clampCardDisplayValue(display?.grid?.y, 0, 100, DEFAULT_CARD_DISPLAY.grid.y),
    scale: clampCardDisplayValue(display?.grid?.scale, 100, 200, DEFAULT_CARD_DISPLAY.grid.scale)
  }
});

const getCardDisplay = (game, view) => normalizeCardDisplay(game?.cardDisplay)[view];

const CardBackground = ({ game, view }) => {
  const display = getCardDisplay(game, view);
  return (
    <div
      className="card-bg-layer"
      style={{
        backgroundImage: game?.image ? `url("${game.image}")` : 'none',
        backgroundPosition: `${display.x}% ${display.y}%`,
        transform: `scale(${display.scale / 100})`,
        transformOrigin: `${display.x}% ${display.y}%`
      }}
      aria-hidden="true"
    />
  );
};

const CardPreview = ({ game, view }) => (
  <div className={`card-preview-frame ${view}`}>
    <div className="card">
      <CardBackground game={game} view={view} />
      {view === 'list' && (
        <>
          <div className="badge">
            <span style={{ color: 'white', marginRight: 6 }}>#1</span>
            <span style={{ color: 'gold' }}>{calcRating(game.ratings)}</span>
          </div>
          <div className="title">{game.title || 'Название игры'}</div>
        </>
      )}
    </div>
  </div>
);

const AddGameDialog = ({ game = null, onClose, onComplete }) => {
  const isEdit = Boolean(game);
  const [fields, setFields] = useState(() => ({
    title: game?.title || '',
    developer: game?.developer || '',
    releaseYear: game?.releaseYear || game?.year || '',
    playtimeHours: game?.playtimeHours || '',
    review: game?.review || REVIEWS[game?.id] || ''
  }));
  const [ratings, setRatings] = useState(() => ({
    ...Object.fromEntries(ADD_GAME_RATINGS.map(([key]) => [key, 7])),
    ...(game?.ratings || {})
  }));
  const [selectedGenres, setSelectedGenres] = useState(() => game?.genres || []);
  const [cardDisplay, setCardDisplay] = useState(() => normalizeCardDisplay(game?.cardDisplay));
  const [previewView, setPreviewView] = useState('list');
  const [coverFile, setCoverFile] = useState(null);
  const [coverBlob, setCoverBlob] = useState(null);
  const [coverPreview, setCoverPreview] = useState(() => game?.image || '');
  const [coverSize, setCoverSize] = useState('');
  const [compressing, setCompressing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [moderatorMode, setModeratorMode] = useState(null);
  const previewUrlRef = useRef('');
  const coverTaskRef = useRef(0);
  const submitLockRef = useRef(false);
  const averageRating = (Object.values(ratings).reduce((sum, value) => sum + Number(value), 0) / ADD_GAME_RATINGS.length).toFixed(1);

  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape' && !busy && !compressing) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy, compressing]);

  useEffect(() => {
    window.siteSupabase.auth.getSession().then(async ({ data }) => {
      const user = data.session && data.session.user;
      if (!user) return;
      const { data: profile } = await window.siteSupabase.from('profiles')
        .select('is_moderator').eq('id', user.id).single();
      setModeratorMode(Boolean(profile && profile.is_moderator));
    }).catch(() => setModeratorMode(false));
  }, []);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const setValue = (key, value) => setFields(current => ({ ...current, [key]: value }));

  const chooseCover = async file => {
    if (!file) return;
    const taskId = ++coverTaskRef.current;
    setCoverFile(null);
    setCoverBlob(null);
    setCoverSize('');
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setCoverPreview('');
    if (!file.type.startsWith('image/')) {
      setCompressing(false);
      setStatus('Выберите файл изображения.');
      setStatusError(true);
      return;
    }
    setCoverFile(file);
    setCoverBlob(null);
    setCompressing(true);
    setCoverSize('Сжимаю изображение…');
    setStatus('');
    setStatusError(false);
    try {
      const compressed = await window.GameSubmission.compressCover(file);
      if (taskId !== coverTaskRef.current) return;
      const previewUrl = URL.createObjectURL(compressed);
      previewUrlRef.current = previewUrl;
      setCoverBlob(compressed);
      setCoverPreview(previewUrl);
      setCoverSize(compressed === file
        ? `Исходный файл сохранён без изменений: ${(compressed.size / 1024).toFixed(0)} КБ.`
        : `После сжатия: ${(compressed.size / 1024).toFixed(0)} КБ из 400 КБ.`);
    } catch (error) {
      if (taskId !== coverTaskRef.current) return;
      setCoverFile(null);
      setCoverSize('');
      setStatus(error.message || 'Не удалось обработать обложку.');
      setStatusError(true);
    } finally {
      if (taskId === coverTaskRef.current) setCompressing(false);
    }
  };

  const submit = async event => {
    event.preventDefault();
    if (submitLockRef.current) return;
    if (!coverBlob && !isEdit) {
      setStatus('Добавьте обложку игры.');
      setStatusError(true);
      return;
    }
    submitLockRef.current = true;
    setBusy(true);
    setStatus(isEdit ? 'Сохраняю изменения…' : 'Отправляю карточку…');
    setStatusError(false);
    try {
      const result = await window.GameSubmission.submit(window.siteSupabase, {
        ...fields,
        genres: selectedGenres,
        ratings,
        cardDisplay
      }, coverBlob, isEdit ? game : null);
      onComplete(result);
    } catch (error) {
      setStatus(error.message || 'Не удалось отправить карточку.');
      setStatusError(true);
      submitLockRef.current = false;
      setBusy(false);
    }
  };

  const currentPreviewDisplay = cardDisplay[previewView];
  const previewGame = {
    title: fields.title,
    image: coverPreview,
    ratings,
    cardDisplay,
  };

  const updatePreviewDisplay = (key, value) => {
    setCardDisplay(current => ({
      ...current,
      [previewView]: {
        ...current[previewView],
        [key]: Number(value)
      }
    }));
  };

  const cyclePreviewScale = () => {
    const nextScale = currentPreviewDisplay.scale >= 200 ? 100 : currentPreviewDisplay.scale + 25;
    updatePreviewDisplay('scale', nextScale);
  };

  return (
    <div className="add-game-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy && !compressing) onClose(); }}>
      <section className="add-game-dialog" role="dialog" aria-modal="true" aria-labelledby="add-game-title">
        <div className="form-title">
          <h2 id="add-game-title">{isEdit ? 'Изменить игру' : 'Новая игра'}</h2>
          <button type="button" className="rating-info-trigger" aria-label="Закрыть" onClick={onClose} disabled={busy || compressing}>×</button>
        </div>
        <form onSubmit={submit}>
          <fieldset>
            <legend>Основное</legend>
            <div className="add-fields">
              <label className="add-field">Название *
                <input type="text" maxLength="120" required value={fields.title} onChange={event => setValue('title', event.target.value)} placeholder="Название игры" />
              </label>
              <label className="add-field">Разработчик
                <input type="text" maxLength="120" value={fields.developer} onChange={event => setValue('developer', event.target.value)} placeholder="Студия-разработчик" />
              </label>
            </div>
            <div className="add-fields three">
              <label className="add-field">Год выхода
                <input type="number" min="1950" max="2100" value={fields.releaseYear} onChange={event => setValue('releaseYear', event.target.value)} placeholder="Например, 2015" />
              </label>
              <label className="add-field">Время прохождения, ч.
                <input type="number" min="0" max="999999" step="1" value={fields.playtimeHours} onChange={event => setValue('playtimeHours', event.target.value)} placeholder="Например, 40" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Обложка</legend>
            <label className={`add-game-drop ${dragging ? 'dragging' : ''}`}
              onDragOver={event => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); chooseCover(event.dataTransfer.files[0]); }}>
              <input type="file" accept="image/*" onChange={event => chooseCover(event.target.files[0])} />
              {coverPreview && <img className="add-game-cover" src={coverPreview} alt="Предпросмотр сжатой обложки" />}
              <span>{coverPreview ? 'Нажмите или перетащите другую картинку' : 'Нажмите или перетащите картинку сюда'}</span>
            </label>
            <p className="add-game-hint">{isEdit ? 'Оставьте текущую обложку или выберите новую. Файл до 400 КБ сохранится без изменений, больший файл будет сжат до 400 КБ.' : 'Файл до 400 КБ сохранится без изменений, больший файл будет сжат до 400 КБ.'}</p>
            {coverSize && <p className="add-game-hint">{coverSize}</p>}
          </fieldset>

          <fieldset>
            <legend>Жанры</legend>
            <div className="add-game-genres">
              {ADD_GAME_GENRES.map(genre => (
                <button key={genre} type="button" className={`add-game-genre ${selectedGenres.includes(genre) ? 'selected' : ''}`}
                  aria-pressed={selectedGenres.includes(genre)}
                  onClick={() => setSelectedGenres(current => current.includes(genre) ? current.filter(item => item !== genre) : [...current, genre])}>
                  {genre}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Оценки</legend>
            <div className="add-game-ratings">
              {ADD_GAME_RATINGS.map(([key, label]) => (
                <label className="add-game-rate" key={key}>
                  <span>{label}</span>
                  <input type="range" min="1" max="10" value={ratings[key]}
                    onChange={event => setRatings(current => ({ ...current, [key]: Number(event.target.value) }))} />
                  <output>{ratings[key]}</output>
                </label>
              ))}
            </div>
            <div className="add-game-average"><span>Средняя оценка</span><strong>{averageRating}</strong></div>
          </fieldset>

          <fieldset>
            <legend>Обзор</legend>
            <textarea maxLength="8000" value={fields.review} onChange={event => setValue('review', event.target.value)} placeholder="Ваш обзор игры" />
          </fieldset>

          <fieldset className="add-game-preview-fieldset">
            <legend>Предпросмотр карточки</legend>
            <div className="add-game-preview-toolbar">
              <div className="add-game-preview-switcher" role="group" aria-label="Режим предпросмотра карточки">
                <button type="button" className={previewView === 'list' ? 'active' : ''} onClick={() => setPreviewView('list')} aria-pressed={previewView === 'list'}>Список</button>
                <button type="button" className={previewView === 'grid' ? 'active' : ''} onClick={() => setPreviewView('grid')} aria-pressed={previewView === 'grid'}>Сетка</button>
              </div>
              <button type="button" className="add-game-preview-scale-btn" onClick={cyclePreviewScale} title="Увеличить масштаб до 200%">
                Масштаб: {currentPreviewDisplay.scale}%
              </button>
            </div>
            <div className="add-game-preview-position">
              <label>Позиция по горизонтали: {currentPreviewDisplay.x}%
                <input type="range" min="0" max="100" value={currentPreviewDisplay.x} onChange={event => updatePreviewDisplay('x', event.target.value)} />
              </label>
              <label>Позиция по вертикали: {currentPreviewDisplay.y}%
                <input type="range" min="0" max="100" value={currentPreviewDisplay.y} onChange={event => updatePreviewDisplay('y', event.target.value)} />
              </label>
            </div>
            <div className="add-game-preview-stage">
              <CardPreview game={previewGame} view={previewView} />
            </div>
            <p className="add-game-hint">Позиция и масштаб сохраняются отдельно для списка и сетки. Кнопка масштаба переключает значения от 100% до 200%. Старайтесь сохранить масштаб на 100%.</p>
          </fieldset>

          {status && <p className={`add-game-status ${statusError ? 'error' : ''}`} role="status">{status}</p>}
          <div className="add-game-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy || compressing}>Отмена</button>
            <button type="submit" className="btn primary" disabled={busy || compressing || (!coverBlob && !isEdit)}>{busy ? (isEdit ? 'Сохраняю…' : 'Отправка…') : compressing ? 'Сжимаю обложку…' : isEdit ? (moderatorMode ? 'Сохранить изменения' : 'Отправить изменения на проверку') : moderatorMode ? 'Добавить в каталог' : 'Отправить на проверку'}</button>
          </div>
        </form>
      </section>
    </div>
  );
};

const App = () => {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [view, setView] = useState(localStorage.getItem('view') || 'list');
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(() => {
    try { return sessionStorage.getItem('site_cached_avatar') || ''; } catch (_) { return ''; }
  });
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState('signin');
  const [addGameOpen, setAddGameOpen] = useState(false);
  const [editingGame, setEditingGame] = useState(null);
  const [catalogNotice, setCatalogNotice] = useState('');
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  const [gamePage, setGamePage] = useState(() => {
    if (!window.matchMedia('(max-width: 640px)').matches) return null;
    const gameId = new URLSearchParams(window.location.search).get('game');
    return GAMES.find(g => g.id === gameId) || null;
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [excludedGenres, setExcludedGenres] = useState([]);
  const [sortBy, setSortBy] = useState("rating");
  const [selectedGames, setSelectedGames] = useState([]);
  const [compareMode, setCompareMode] = useState(false);
  const [modalGame, setModalGame] = useState(null);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [showGenrePanel, setShowGenrePanel] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [speedDialOpen, setSpeedDialOpen] = useState(false);
  const [ratingInfoOpen, setRatingInfoOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [commentsDrawerOpen, setCommentsDrawerOpen] = useState(false);
  const [controlsCompact, setControlsCompact] = useState(false);
  const searchInputRef = useRef(null);
  const searchWrapperRef = useRef(null);
  const ratingInfoRef = useRef(null);

  const activeView = isMobile ? 'list' : view;
  const canEditCatalog = !viewedCatalogProfile || Boolean(currentUser && currentUser.id === viewedCatalogProfile.id);
  const searchSuggestionsOpen = searchFocused && !search.trim();

  useEffect(() => {
    const client = window.siteSupabase;
    if (!client) return;
    client.auth.getSession().then(({ data }) => {
      const user = data.session && data.session.user ? data.session.user : null;
      const userId = user ? user.id : null;
      setIsSignedIn(Boolean(userId));
      setCurrentUser(user);
      if (userId !== loadedSessionUserId) {
        loadedSessionUserId = userId;
        window.location.reload();
      }
    });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      const user = session && session.user ? session.user : null;
      const userId = user ? user.id : null;
      if (userId !== loadedSessionUserId) {
        loadedSessionUserId = userId;
        window.location.reload();
        return;
      }
      setIsSignedIn(Boolean(session));
      setCurrentUser(user);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    const loadAvatar = async () => {
      if (!currentUser || !window.siteSupabase) {
        setProfileAvatarUrl('');
        try { sessionStorage.removeItem('site_cached_avatar'); } catch (_) { }
        return;
      }
      const client = window.siteSupabase;
      const { data: profile, error } = await client.from('profiles')
        .select('avatar_path').eq('id', currentUser.id).single();
      if (error || !profile?.avatar_path || !active) return;
      const { data: signed } = await client.storage.from('profile-avatars')
        .createSignedUrl(profile.avatar_path, 604800);
      if (active && signed?.signedUrl) {
        setProfileAvatarUrl(signed.signedUrl);
        try { sessionStorage.setItem('site_cached_avatar', signed.signedUrl); } catch (_) { }
      }
    };
    loadAvatar().catch(error => console.warn('Не удалось загрузить фото профиля:', error));
    return () => { active = false; };
  }, [currentUser?.id]);

  // Keep the mobile layout isolated from the desktop view state.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 640px)');
    const handleViewportChange = (event) => setIsMobile(event.matches);
    mediaQuery.addEventListener?.('change', handleViewportChange);
    return () => {
      mediaQuery.removeEventListener?.('change', handleViewportChange);
    };
  }, []);

  // A mobile game page is a real history entry, so Back returns to the list.
  useEffect(() => {
    const handlePopState = () => {
      const gameId = new URLSearchParams(window.location.search).get('game');
      setGamePage(GAMES.find(g => g.id === gameId) || null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Debounce search state for smooth filtering without animation desync
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 150);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!searchFocused) return;
    const handleSearchOutside = (event) => {
      if (!searchWrapperRef.current?.contains(event.target)) setSearchFocused(false);
    };
    document.addEventListener('pointerdown', handleSearchOutside);
    document.addEventListener('focusin', handleSearchOutside);
    return () => {
      document.removeEventListener('pointerdown', handleSearchOutside);
      document.removeEventListener('focusin', handleSearchOutside);
    };
  }, [searchFocused]);

  // Theme Effect
  useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // View Persistence and Body Class
  useEffect(() => {
    if (!isMobile) localStorage.setItem('view', view);
    document.body.classList.toggle('grid-view', activeView === 'grid');
  }, [view, isMobile, activeView]);

  // Scroll Listener
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
      setControlsCompact(window.scrollY > 68);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Speed Dial overlay body class
  useEffect(() => {
    document.body.classList.toggle('sd-open', speedDialOpen);
  }, [speedDialOpen]);

  // Закрываем компактную справку при клике вне неё.
  useEffect(() => {
    if (!ratingInfoOpen) return;
    const handleOutsidePointer = (event) => {
      if (!ratingInfoRef.current?.contains(event.target)) setRatingInfoOpen(false);
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, [ratingInfoOpen]);

  // Scroll Lock for full-screen modals
  useEffect(() => {
    const shouldLockScroll = Boolean(modalGame || compareModalOpen || rouletteOpen || addGameOpen);
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    if (shouldLockScroll) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [modalGame, compareModalOpen, rouletteOpen, addGameOpen]);

  // Scroll Lock for rating info popover. The root keeps a stable scrollbar gutter,
  // so locking the body does not change the content width or move the layout.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (ratingInfoOpen) document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [ratingInfoOpen]);

  useEffect(() => {
    const isEditableTarget = (el) => {
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = (el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    };

    const handleGlobalShortcuts = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;

      const key = e.key.toLowerCase();

      if (key === 'escape' && (modalGame || compareModalOpen || rouletteOpen)) {
        e.preventDefault();
        setModalGame(null);
        setCompareModalOpen(false);
        setRouletteOpen(false);
        return;
      }

      if (key === 'escape' && ratingInfoOpen) {
        e.preventDefault();
        setRatingInfoOpen(false);
        return;
      }

      if (key === 'escape' && searchFocused) {
        e.preventDefault();
        setSearchFocused(false);
        searchInputRef.current?.blur();
        return;
      }

      if (isEditableTarget(e.target)) return;

      // Toggle Genres Panel (f)
      if (e.code === 'KeyF' || key === 'f' || key === 'а') {
        e.preventDefault();
        setShowGenrePanel(prev => !prev);
        setSpeedDialOpen(false);
        return;
      }

      // Change View (v)
      if (e.code === 'KeyV' || key === 'v' || key === 'м') {
        e.preventDefault();
        setView(prev => prev === 'grid' ? 'list' : 'grid');
        setSpeedDialOpen(false);
        return;
      }

      // Focus Search (/ or .)
      if (key === '/' || key === '.') {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [modalGame, compareModalOpen, rouletteOpen, ratingInfoOpen, searchFocused]);

  // Filter Logic
  const filteredGames = useMemo(() => {
    let res = GAMES;

    if (debouncedSearch.trim()) {
      const rawTokens = debouncedSearch.trim().split(/\s+/).filter(Boolean);

      const detectedGenres = new Set();
      const excludedGenresSearch = new Set();
      const yearFilters = [];
      const ratingFilters = [];
      const textTokens = [];

      const matchesAlias = (token, alias) => {
        if (token === alias) return true;
        if (token.length >= 3 && alias.length >= 3 && (alias.startsWith(token) || token.startsWith(alias))) return true;
        return false;
      };

      for (const rawToken of rawTokens) {
        const isExclude = rawToken.charAt(0) === '-' && rawToken.length > 1;
        const cleanRaw = isExclude ? rawToken.slice(1) : rawToken;
        const cleanToken = normalizeSearchPart(cleanRaw);

        // Year / Rating Pattern Matches
        const yearMinMatch = cleanRaw.match(/^(\d{4})\+$/);
        const yearMaxMatch = cleanRaw.match(/^(\d{4})-$/);
        const yearExactMatch = cleanRaw.match(/^(19\d\d|20\d\d)$/);

        const ratingMinMatch = cleanRaw.match(/^(\d+(?:[\.,]\d+)?)\+$/);
        const ratingMaxMatch = cleanRaw.match(/^(\d+(?:[\.,]\d+)?)-$/);

        if (yearMinMatch) {
          yearFilters.push({ type: 'min', val: parseInt(yearMinMatch[1], 10) });
        } else if (yearMaxMatch) {
          yearFilters.push({ type: 'max', val: parseInt(yearMaxMatch[1], 10) });
        } else if (ratingMinMatch) {
          ratingFilters.push({ type: 'min', val: parseFloat(ratingMinMatch[1].replace(',', '.')) });
        } else if (ratingMaxMatch && !(parseFloat(ratingMaxMatch[1]) >= 1900 && parseFloat(ratingMaxMatch[1]) <= 2100)) {
          ratingFilters.push({ type: 'max', val: parseFloat(ratingMaxMatch[1].replace(',', '.')) });
        } else if (yearExactMatch) {
          yearFilters.push({ type: 'exact', val: parseInt(yearExactMatch[1], 10) });
        } else {
          const matchedGenre = cleanToken.length > 0
            ? GENRE_ALIAS_INDEX.find(({ aliases }) =>
              aliases.some(alias => matchesAlias(cleanToken, alias)))
            : null;

          if (matchedGenre) {
            if (isExclude) {
              excludedGenresSearch.add(matchedGenre.label);
            } else {
              detectedGenres.add(matchedGenre.label);
            }
          } else if (!isExclude) {
            textTokens.push(cleanToken);
          }
        }
      }

      res = res.filter(g => {
        const gameTitle = normalizeSearchPart(g.title);
        const gameDeveloper = normalizeSearchPart(g.developer);
        const gameYear = parseInt(g.year, 10) || 0;
        const gameRating = calcRating(g.ratings);

        const matchesYear = yearFilters.every(f => {
          if (f.type === 'min') return gameYear >= f.val;
          if (f.type === 'max') return gameYear <= f.val;
          if (f.type === 'exact') return gameYear === f.val || gameTitle.includes(String(f.val)) || gameDeveloper.includes(String(f.val));
          return true;
        });

        const matchesRating = ratingFilters.every(f => {
          if (f.type === 'min') return gameRating >= f.val;
          if (f.type === 'max') return gameRating <= f.val;
          return true;
        });

        const matchesInclude = Array.from(detectedGenres).every(gen => g.genres.includes(gen));
        const matchesExclude = Array.from(excludedGenresSearch).every(gen => !g.genres.includes(gen));
        const matchesText = textTokens.every(tok =>
          gameTitle.includes(tok) || gameDeveloper.includes(tok)
        );

        return matchesYear && matchesRating && matchesInclude && matchesExclude && matchesText;
      });
    }

    if (selectedGenres.length > 0 || excludedGenres.length > 0) {
      res = res.filter(g =>
        selectedGenres.every(gen => g.genres.includes(gen)) &&
        excludedGenres.every(gen => !g.genres.includes(gen))
      );
    }

    const getSortValue = {
      rating: g => calcRating(g.ratings),
      year: g => parseInt(g.year, 10) || 0,
      playtime: g => parseInt(g.playtime, 10) || 0,
    }[sortBy] || (g => g.ratings[sortBy] ?? 0);

    return [...res].sort((a, b) => getSortValue(b) - getSortValue(a));
  }, [debouncedSearch, selectedGenres, excludedGenres, sortBy]);

  const genreClickTimerRef = useRef(null);
  const genreTapRef = useRef({ genre: null, time: 0 });
  const suppressGenreClickRef = useRef(false);
  const suppressNativeDoubleClickRef = useRef(false);

  const handleGenreClick = (genre) => {
    if (genreClickTimerRef.current) {
      clearTimeout(genreClickTimerRef.current);
      genreClickTimerRef.current = null;
    }
    genreClickTimerRef.current = setTimeout(() => {
      genreClickTimerRef.current = null;
      if (excludedGenres.includes(genre)) {
        setExcludedGenres(prev => prev.filter(item => item !== genre));
      } else {
        setSelectedGenres(prev => prev.includes(genre)
          ? prev.filter(item => item !== genre)
          : [...prev, genre]
        );
      }
    }, 180);
  };

  const handleGenreDoubleClick = (genre) => {
    if (genreClickTimerRef.current) {
      clearTimeout(genreClickTimerRef.current);
      genreClickTimerRef.current = null;
    }
    setSelectedGenres(prev => prev.filter(item => item !== genre));
    setExcludedGenres(prev => prev.includes(genre)
      ? prev.filter(item => item !== genre)
      : [...prev, genre]
    );
  };

  // Touch devices do not consistently emit a native dblclick event.
  // Detect a quick second tap while keeping the desktop double-click path.
  const handleGenrePointerUp = (genre, e) => {
    if (e.pointerType !== 'touch') return;

    const now = Date.now();
    const previousTap = genreTapRef.current;
    if (previousTap.genre === genre && now - previousTap.time < 360) {
      genreTapRef.current = { genre: null, time: 0 };
      suppressGenreClickRef.current = true;
      suppressNativeDoubleClickRef.current = true;
      handleGenreDoubleClick(genre);
      return;
    }

    genreTapRef.current = { genre, time: now };
  };

  const handleGenreClickEvent = (genre) => {
    if (suppressGenreClickRef.current) {
      suppressGenreClickRef.current = false;
      return;
    }
    handleGenreClick(genre);
  };

  const handleGenreDoubleClickEvent = (genre) => {
    if (suppressNativeDoubleClickRef.current) {
      suppressNativeDoubleClickRef.current = false;
      return;
    }
    handleGenreDoubleClick(genre);
  };

  const handleGenreContextMenu = (genre, e) => {
    e.preventDefault();
    handleGenreDoubleClick(genre);
  };

  const clearGenreFilters = () => {
    setSelectedGenres([]);
    setExcludedGenres([]);
  };

  const navigateToGame = (game) => {
    const url = new URL(window.location.href);
    url.searchParams.set('game', game.id);
    window.history.pushState({ gameId: game.id }, '', url);
    setGamePage(game);
    setModalGame(null);
    setRouletteOpen(false);
    setSpeedDialOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const openGameFromComment = (game) => {
    setCommentsDrawerOpen(false);
    setSpeedDialOpen(false);
    if (isMobile) {
      navigateToGame(game);
    } else {
      setModalGame(game);
    }
  };

  const closeGamePage = () => {
    if (window.history.state?.gameId) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('game');
    window.history.pushState({}, '', url);
    setGamePage(null);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleCardClick = (game) => {
    if (compareMode) {
      setSelectedGames(prev => {
        const next = prev.includes(game.id) ? prev.filter(id => id !== game.id) : [...prev, game.id];
        if (next.length === 0) {
          setCompareMode(false);
        }
        return next;
      });
    } else if (isMobile) {
      navigateToGame(game);
    } else {
      setModalGame(game);
    }
  };

  const openGameEditor = (game) => {
    if (!isSignedIn) {
      setAuthModalTab('signin');
      setAuthModalOpen(true);
      return;
    }
    if (!canEditCatalog) return;
    setCatalogNotice('');
    setModalGame(null);
    setEditingGame(game);
    setAddGameOpen(true);
  };

  const handleCardLongPress = (game) => {
    setCompareMode(true);
    setSelectedGames(prev => (prev.includes(game.id) ? prev : [...prev, game.id]));
    setSpeedDialOpen(false);
  };

  const handleCompareConfirm = () => {
    if (selectedGames.length < 2) return alert("Выберите хотя бы 2 игры.");
    setCompareModalOpen(true);
  };

  const cancelCompare = () => {
    setCompareMode(false);
    setSelectedGames([]);
  }

  const applySearchSuggestion = (query) => {
    setSearch(query);
    setDebouncedSearch(query);
    setSearchFocused(false);
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  };

  if (gamePage && isMobile) {
    return <GamePage key={gamePage.id} game={gamePage} onBack={closeGamePage} onOpenGame={navigateToGame} />;
  }

  return (
    <div>
      {addGameOpen && <AddGameDialog
        key={editingGame?.id || 'new-game'}
        game={editingGame}
        onClose={() => { setAddGameOpen(false); setEditingGame(null); }}
        onComplete={(result) => {
          setAddGameOpen(false);
          setEditingGame(null);
          setCatalogNotice(result.isModerator
            ? (result.isEdit ? 'Изменения сохранены в каталоге.' : 'Игра опубликована в каталоге.')
            : (result.isEdit ? 'Заявка на изменение отправлена модератору.' : 'Заявка отправлена на проверку модератору.'));
          if (result.isModerator) window.setTimeout(() => window.location.reload(), 1200);
        }}
      />}

      {/* Scroll to Top */}
      <button id="scroll-to-top" className={showScrollTop ? 'visible' : ''} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>

      {/* Жанровая панель */}
      <div className={`genre-panel ${showGenrePanel ? 'active' : ''}`}>
        <div className="genre-filter-tools">
          <div className="genre-helper">
            <span className="genre-helper-key">+</span>
            <span>включить жанр</span>
            <span className="genre-helper-key">−</span>
            <span>исключить жанр</span>
            <span className="genre-helper-spacer" aria-hidden="true" />
            <button className="genre-icon-btn" onClick={clearGenreFilters} title="Сбросить фильтр" aria-label="Сбросить фильтр">⟳</button>
            <button className="genre-icon-btn" onClick={() => setShowGenrePanel(false)} title="Закрыть" aria-label="Закрыть">×</button>
          </div>
        </div>

        <div className="genre-list">
          {GENRES.map(g => (
            <button
              key={g}
              type="button"
              className={`genre-tag ${selectedGenres.includes(g) ? 'active' : ''} ${excludedGenres.includes(g) ? 'excluded' : ''}`}
              onClick={() => handleGenreClickEvent(g)}
              onPointerUp={(e) => handleGenrePointerUp(g, e)}
              onDoubleClick={() => handleGenreDoubleClickEvent(g)}
              onContextMenu={(e) => handleGenreContextMenu(g, e)}
              aria-pressed={selectedGenres.includes(g)}
              title={excludedGenres.includes(g) ? 'Жанр исключён (клик/ПКМ чтобы вернуть)' : 'ПКМ или 2-й клик: исключить жанр'}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ SPEED DIAL (Веер-кнопка) ═══ */}
      <div className={`speed-dial ${speedDialOpen ? 'open' : ''}`} id="speed-dial">
        <button className="speed-dial-main" onClick={() => { setSpeedDialOpen(o => !o); setShowGenrePanel(false); }} title="Меню">
          <div className="menu__icon">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </button>
        <div className="speed-dial-items">
          {/* Рулетка */}
          <div className="sd-item">
            <div className="sd-label" title="Рулетка" onClick={() => { setRouletteOpen(true); setSpeedDialOpen(false); }}>
              <span>🎲</span> Во что сыграть?
            </div>
          </div>
          {/* Сравнение */}
          <div className="sd-item">
            <div className="sd-label" title="Сравнить" onClick={() => { compareMode ? cancelCompare() : setCompareMode(true); setSpeedDialOpen(false); }}>
              <span>⚖️</span> {compareMode ? 'Отмена сравнения' : 'Сравнить игры'}
            </div>
          </div>
          {compareMode && !isMobile && (
            <div className="sd-item">
              <div className="sd-label" style={{ background: 'rgba(46,139,87,0.18)', borderColor: 'rgba(46,139,87,0.35)' }} onClick={() => { handleCompareConfirm(); setSpeedDialOpen(false); }}>
                <span>✓</span> Подтвердить выбор
              </div>
            </div>
          )}
          {/* Жанры */}
          <div className="sd-item">
            <div className="sd-label" title="Фильтр по жанрам" style={selectedGenres.length > 0 ? { borderColor: 'rgba(197,165,128,0.6)', background: 'rgba(197,165,128,0.1)' } : {}} onClick={() => { setShowGenrePanel(o => !o); setSpeedDialOpen(false); }}>
              <span>🏷️</span> {isMobile ? 'Жанры' : 'Жанры (f)'} {selectedGenres.length + excludedGenres.length > 0 ? `(${selectedGenres.length + excludedGenres.length})` : ''}
            </div>
          </div>
          {/* Вид */}
          {!isMobile && <div className="sd-item">
            <div className="sd-label" title="Вид" onClick={() => { setView(view === 'grid' ? 'list' : 'grid'); setSpeedDialOpen(false); }}>
              <span style={{ fontSize: '1.2em' }}>{view === 'grid' ? '☰' : '⊞'}</span> {view === 'grid' ? 'Вид: список (v)' : 'Вид: сетка (v)'}
            </div>
          </div>}
        </div>
      </div>
      {/* Оверлей закрывает веер */}
      <div className="speed-dial-overlay" onClick={() => setSpeedDialOpen(false)} />

      <AnimatePresence>
        {ratingInfoOpen && (
          <motion.div
            className="rating-info-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={() => setRatingInfoOpen(false)}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Поповер профиля */}
      <ProfilePopover
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={currentUser}
        onAvatarChange={(url) => {
          setProfileAvatarUrl(url || '');
          try {
            if (url) sessionStorage.setItem('site_cached_avatar', url);
            else sessionStorage.removeItem('site_cached_avatar');
          } catch (_) { }
        }}
      />

      <LibraryDrawer
        isOpen={libraryDrawerOpen}
        onClose={() => setLibraryDrawerOpen(false)}
        onSelectProfile={(username) => {
          window.location.href = `./index.html?profile=${encodeURIComponent(username)}`;
        }}
      />

      <CommentsDrawer
        isOpen={commentsDrawerOpen}
        onClose={() => setCommentsDrawerOpen(false)}
        profile={viewedCatalogProfile}
        currentUser={currentUser}
        games={GAMES}
        onOpenGame={openGameFromComment}
        onRequestAuth={() => {
          setCommentsDrawerOpen(false);
          setAuthModalTab('signin');
          setAuthModalOpen(true);
        }}
      />

      {/* Модальное окно авторизации и регистрации */}
      <AuthModal
        isOpen={authModalOpen}
        initialTab={authModalTab}
        onClose={() => setAuthModalOpen(false)}
      />

      {/* ═══ ПРАВАЯ ПАНЕЛЬ УПРАВЛЕНИЯ ═══ */}
      <div className="site-header-right" ref={ratingInfoRef}>
        {isSignedIn ? (
          <button
            type="button"
            className="account-icon-button"
            aria-label="Открыть профиль"
            title="Профиль"
            onClick={() => {
              setProfileOpen(true);
              setRatingInfoOpen(false);
            }}
          >
            {profileAvatarUrl
              ? <img className="account-avatar-image" src={profileAvatarUrl} alt="" />
              : <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.4 3.3-5.2 7-5.2s6.3 1.8 7 5.2" /></svg>}
          </button>
        ) : (
          <button
            type="button"
            className="signin-link"
            title="Войти в аккаунт"
            onClick={() => {
              setAuthModalTab('signin');
              setAuthModalOpen(true);
            }}
          >
            <svg className="signin-link-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c.7-3.4 3.3-5.2 7-5.2s6.3 1.8 7 5.2" />
            </svg>
            <span>Войти</span>
          </button>
        )}
        <button
          type="button"
          className="rating-info-trigger"
          aria-label="Как оцениваются игры"
          aria-expanded={ratingInfoOpen}
          onClick={() => {
            setRatingInfoOpen(open => !open);
            setProfileOpen(false);
          }}
        >
          ⓘ
        </button>
        {ratingInfoOpen && (
          <div className="rating-info-popover" role="dialog" aria-label={RATING_INFO.title}>
            <h2>{RATING_INFO.title}</h2>
            <InfoFormattedText className="rating-info-lead">{RATING_INFO.lead}</InfoFormattedText>
            {RATING_INFO.items.map(item => (
              <div className="rating-info-item" key={item.label}>
                <span className="rating-info-label">{item.label}</span>
                <InfoFormattedText className="rating-info-text">{item.text}</InfoFormattedText>
              </div>
            ))}
            <h3 className="rating-info-subtitle">{RATING_INFO.usage.title}</h3>
            <InfoFormattedText className="rating-info-text rating-info-usage-text">{RATING_INFO.usage.text}</InfoFormattedText>
            <InfoFormattedText className="rating-info-note">{RATING_INFO.note}</InfoFormattedText>
          </div>
        )}
        <label htmlFor="themeToggle" className="themeToggle st-sunMoonThemeToggleBtn">
          <input
            type="checkbox"
            id="themeToggle"
            className="themeToggleInput"
            onChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            checked={theme === 'light'}
          />
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" stroke="none">
            <mask id="moon-mask">
              <rect x="0" y="0" width="20" height="20" fill="white" />
              <circle cx="11" cy="3" r="8" fill="black" />
            </mask>
            <circle className="sunMoon" cx="10" cy="10" r="8" mask="url(#moon-mask)" />
            <g>
              <line className="sunRay" x1="16.8" y1="10" x2="19.2" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <line className="sunRay sunRay2" x1="13.4" y1="15.8888" x2="14.6" y2="17.9672" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <line className="sunRay sunRay3" x1="6.6" y1="15.8888" x2="5.4" y2="17.9672" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <line className="sunRay sunRay4" x1="3.2" y1="10" x2="0.8" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <line className="sunRay sunRay5" x1="6.6" y1="4.211" x2="5.4" y2="2.1326" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <line className="sunRay sunRay6" x1="13.4" y1="4.211" x2="14.6" y2="2.1326" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </g>
          </svg>
        </label>
      </div>

      {/* ═══ ШАПКА ═══ */}
      <div className="site-header">
        <div className="site-header-left">
          <div className="site-header-actions">
            {canEditCatalog && <button
              className="add-game-trigger"
              type="button"
              aria-label="Добавить новую игру"
              title="Добавить новую игру"
              onClick={() => {
                if (!isSignedIn) {
                  setAuthModalTab('signin');
                  setAuthModalOpen(true);
                  return;
                }
                setCatalogNotice('');
                setEditingGame(null);
                setAddGameOpen(true);
              }}
            >
              <img className="add-game-svg" src="svg/addnew.svg" alt="Добавить новую игру" />
            </button>}
            <button
              className="find-libraries-trigger"
              type="button"
              aria-label="Смотреть библиотеки"
              title="Смотреть библиотеки"
              onClick={() => {
                setProfileOpen(false);
                setRatingInfoOpen(false);
                setLibraryDrawerOpen(true);
              }}
            >
              <img className="find-libraries-svg" src="svg/lib.svg" alt="Библиотеки других" />
            </button>
            <button
              className="comments-trigger"
              type="button"
              aria-label="Комментарии профиля"
              title="Комментарии профиля"
              onClick={() => {
                setProfileOpen(false);
                setRatingInfoOpen(false);
                setLibraryDrawerOpen(false);
                setCommentsDrawerOpen(true);
              }}
            >
              <img className="comments-svg" src="svg/comments.svg" alt="Комментарии" />
            </button>
          </div>
          <div className="site-header-copy">
            <div className="page-title">
              <img className="site-title-svg" src="svg/title.svg" alt="Zvux Good Games" />
            </div>
            {viewedCatalogProfile ? (
              <div className="page-subtitle">
                Библиотека @{viewedCatalogProfile.username} · {formatGameCount(GAMES.length)}{canEditCatalog ? '' : ' · только просмотр'}
                {!canEditCatalog && (
                  <button
                    type="button"
                    className="catalog-back-link"
                    onClick={() => { window.location.href = './index.html'; }}
                    title={isSignedIn ? 'Вернуться в мой каталог' : 'Вернуться на главную'}
                  >
                    {isSignedIn ? '← Мой каталог' : '← Главная'}
                  </button>
                )}
              </div>
            ) : (
              <div className="page-subtitle">{filteredGames.length} игр · сортировка: {LABELS[sortBy]}</div>
            )}
            {catalogNotice && <p className="add-game-status" role="status">{catalogNotice}</p>}
          </div>
        </div>
      </div>

      {/* ═══ ПАНЕЛЬ УПРАВЛЕНИЯ ═══ */}
      <div className={`controls-bar search-only ${controlsCompact ? 'compact' : ''}`}>
        <div
          className="search-wrapper"
          ref={searchWrapperRef}
          style={{ flex: 1 }}
          onFocus={() => setSearchFocused(true)}
        >
          <input
            ref={searchInputRef}
            type="text"
            id="search"
            placeholder={isMobile ? "Поиск по играм, студиям и многому другому..." : "Поиск по играм, жанрам, годам, оценкам или компаниям..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-expanded={searchSuggestionsOpen}
            aria-controls="search-suggestions"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          {search && <span id="clear-search" onClick={() => { setSearch(""); setDebouncedSearch(""); }} title="Очистить">×</span>}
          <AnimatePresence initial={false}>
            {searchSuggestionsOpen && (
              <motion.div
                key="search-suggestions"
                id="search-suggestions"
                className="search-suggestions"
                role="listbox"
                aria-label="Примеры поисковых запросов"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                {SEARCH_SUGGESTIONS.map(({ query, hint }) => (
                  <button
                    key={query}
                    type="button"
                    className="search-suggestion"
                    role="option"
                    aria-label={`Подставить запрос: ${query}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySearchSuggestion(query);
                    }}
                    onClick={() => applySearchSuggestion(query)}
                  >
                    <span className="search-suggestion-body">
                      <span className="search-suggestion-query">{query}</span>
                      <span className="search-suggestion-separator" aria-hidden="true">|</span>
                      <span className="search-suggestion-hint">{hint}</span>
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {compareMode && (
          <>
            <div className="controls-separator" />
            <button className="btn btn-green compare-confirm-btn" onClick={handleCompareConfirm}>Сравнить {selectedGames.length}</button>
            <button className="btn btn-red" onClick={cancelCompare}>✕</button>
          </>
        )}
      </div>

      <main>
        {/* Grid / List with Framer Motion Layout */}
        <motion.div layout key={activeView} id="grid" className={activeView === 'grid' ? 'grid-view' : ''}>
          <AnimatePresence mode="popLayout">
            {filteredGames.map((game, i) => (
              <Card
                key={game.id}
                game={game}
                view={activeView}
                onClick={() => handleCardClick(game)}
                onLongPress={() => handleCardLongPress(game)}
                selected={selectedGames.includes(game.id)}
                index={i}
                sortBy={sortBy}
              />
            ))}
          </AnimatePresence>
        </motion.div>
        {filteredGames.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ textAlign: 'center', padding: '60px 20px', opacity: 0.6, userSelect: 'none' }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
              {!isSignedIn ? 'Войдите, чтобы открыть личный каталог' : GAMES.length ? 'Ничего не найдено' : 'Ваш каталог пока пуст'}
            </div>
            <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
              {!isSignedIn ? 'У каждого аккаунта свой список игр' : GAMES.length ? 'Попробуйте изменить запрос или сбросить фильтры' : 'Добавьте первую игру — после проверки она появится здесь'}
            </div>
          </motion.div>
        )}
      </main>

      {/* Плавающий док быстрой сортировки по критериям */}
      <SortDock value={sortBy} onChange={setSortBy} />

      {/* Modals */}
      <AnimatePresence>
        {modalGame && <GameModal
          game={modalGame}
          allGames={modalGame && !filteredGames.some(game => game.id === modalGame.id) ? [modalGame, ...filteredGames] : filteredGames}
          onClose={() => setModalGame(null)}
          onNavigate={setModalGame}
          canEdit={isSignedIn && canEditCatalog}
          onEdit={openGameEditor}
        />}
        {compareModalOpen && <CompareModal
          selectedGameIds={selectedGames}
          theme={theme}
          onClose={() => {
            setCompareModalOpen(false);
            setCompareMode(false);
            setSelectedGames([]);
          }}
        />}
        {rouletteOpen && <RouletteModal onClose={() => setRouletteOpen(false)} onSelect={isMobile ? navigateToGame : setModalGame} />}
      </AnimatePresence>
    </div>
  );
};

const Card = ({ game, view, onClick, onLongPress, selected, index, sortBy }) => {
  const cardRef = useRef(null);
  const contentRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const previousSelectedRef = useRef(selected);
  const [isDeselecting, setIsDeselecting] = useState(false);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearLongPressTimer();
  }, []);

  useEffect(() => {
    if (selected) {
      previousSelectedRef.current = true;
      setIsDeselecting(false);
      return;
    }

    if (!previousSelectedRef.current) return;

    previousSelectedRef.current = false;
    setIsDeselecting(true);
    const timer = setTimeout(() => setIsDeselecting(false), 300);
    return () => clearTimeout(timer);
  }, [selected]);

  const handleMouseMove = (e) => {
    if (view === 'grid') return;
    if (!cardRef.current || !contentRef.current) return;

    const wrapper = cardRef.current;
    const card = contentRef.current;

    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const w = rect.width;
    const h = rect.height;

    // Normalize -1 to 1
    const xNorm = (x / w) * 2 - 1;
    const yNorm = (y / h) * 2 - 1;

    const maxTilt = 5;
    const rotateX = yNorm * maxTilt * -1;
    const rotateY = xNorm * maxTilt;

    card.style.transition = 'transform 0.1s ease-out';
    card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  };

  const handleMouseLeave = () => {
    if (!contentRef.current) return;
    const card = contentRef.current;
    card.style.transition = 'transform 0.5s ease-out';
    card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg)';
    clearLongPressTimer();
  };

  const startLongPress = (e) => {
    if (!onLongPress) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    longPressTriggeredRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      onLongPress();
    }, 420);
  };

  const cancelLongPress = () => {
    clearLongPressTimer();
    if (longPressTriggeredRef.current) {
      setTimeout(() => {
        longPressTriggeredRef.current = false;
      }, 0);
    }
  };

  const handlePointerMove = (e) => {
    if (!longPressTimerRef.current) return;
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    if (dx > 8 || dy > 8) {
      clearLongPressTimer();
    }
  };

  const handleClick = (e) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick();
  };

  return (
    <motion.div
      layout="position"
      ref={cardRef}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05, transition: { duration: 0.38, ease: "easeOut" } }}
      className={`card-wrap ${selected ? 'selected' : ''} ${isDeselecting ? 'deselecting' : ''}`}
      onClick={handleClick}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerMove={handlePointerMove}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      transition={{
        layout: { type: "spring", stiffness: 220, damping: 28, mass: 1.3 },
        opacity: { duration: 0.4, ease: "easeOut" },
        scale: { duration: 0.4, ease: "easeOut" },
      }}
      style={view === 'list' ? { marginBottom: 20 } : {}}
    >
      <div
        className="card"
        ref={contentRef}
      >
        <CardBackground game={game} view={view} />
        <div className="badge">
          <span style={{ color: 'white', marginRight: 6 }}>#{index + 1}</span>
          <span style={{ color: 'gold' }}>{calcRating(game.ratings)}</span>
        </div>
        {view === 'grid' && sortBy !== 'rating' && (
          <div className="grid-sort-badge">
            {sortBy === 'year' ? game.year : sortBy === 'playtime' ? game.playtime : game.ratings[sortBy]}
          </div>
        )}
        <div className="title">{game.title}</div>
        {view !== 'grid' && (
          <div className="popup">
            {Object.entries(game.ratings).filter(([k]) => k !== 'rating').map(([k, v]) => (
              <div key={k} className={k === sortBy ? 'highlight-criterion' : ''}>
                {LABELS[k]}: {v}
              </div>
            ))}
          </div>
        )}
        {/* Genres Popup */}
        <div className="genres-popup">
          {game.genres.map(g => <div key={g}>{g}</div>)}
        </div>
      </div>
    </motion.div>
  );
};

const slideVariants = {
  enter: (dir) => ({
    opacity: 0,
    position: 'relative',
  }),
  center: {
    opacity: 1,
    position: 'relative',
    transition: { duration: 0.2, ease: 'easeOut' }
  },
  exit: {
    opacity: 0,
    position: 'absolute',
    top: 0, left: 0, width: '100%',
    transition: { duration: 0.12, ease: 'easeIn' }
  }
};

const getSimilarGames = (game, games, limit = 5) => {
  const sourceGenres = new Set(game.genres || []);
  if (!sourceGenres.size || !games) return [];

  return games
    .filter(candidate => candidate.id !== game.id)
    .map(candidate => {
      const candidateGenres = new Set(candidate.genres || []);
      const sharedGenres = [...sourceGenres].filter(genre => candidateGenres.has(genre));
      const unionSize = new Set([...sourceGenres, ...candidateGenres]).size;

      return {
        game: candidate,
        sharedGenres,
        sharedCount: sharedGenres.length,
        similarity: unionSize ? sharedGenres.length / unionSize : 0,
      };
    })
    .filter(item => item.sharedCount > 0)
    .sort((a, b) => (
      b.sharedCount - a.sharedCount
      || b.similarity - a.similarity
      || calcRating(b.game.ratings) - calcRating(a.game.ratings)
      || a.game.title.localeCompare(b.game.title, 'ru')
    ))
    .slice(0, limit);
};

const SimilarGamesPanel = ({ game, games, onSelect, className = '', role = 'dialog' }) => {
  const similarGames = useMemo(() => getSimilarGames(game, games), [game, games]);

  return (
    <motion.div
      className={`similar-games-panel ${className}`.trim()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      role={role}
      aria-label={`Похожие игры для ${game.title}`}
    >
      <div className="similar-games-panel-header">
        <div className="similar-games-panel-title">Похожие игры по жанру</div>
      </div>
      <div className="similar-games-list">
        {similarGames.length > 0 ? similarGames.map(({ game: similarGame, sharedGenres }) => (
          <button
            key={similarGame.id}
            className="similar-game-item"
            type="button"
            onClick={() => onSelect(similarGame)}
            title={`Открыть ${similarGame.title}`}
          >
            <span
              className="similar-game-thumb"
              style={{ backgroundImage: `url("${similarGame.image}")` }}
              aria-hidden="true"
            />
            <span className="similar-game-copy">
              <span className="similar-game-title">{similarGame.title}</span>
              <span className="similar-game-meta">
                {sharedGenres.length} {sharedGenres.length === 1 ? 'общий жанр' : 'общих жанра'} · {sharedGenres.join(' · ')}
              </span>
            </span>
            <span className="similar-game-arrow" aria-hidden="true">→</span>
          </button>
        )) : (
          <div className="similar-games-empty">В текущем списке нет другой игры с общим жанром.</div>
        )}
      </div>
    </motion.div>
  );
};

const GameModalSlide = React.forwardRef(({ game, games, slideDir, chartMode, setChartMode, similarOpen, similarLayoutOpen, similarToggleBusy, onToggleSimilar, onSimilarSelect, onSimilarExitComplete }, ref) => {
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    if (!chartMode) return;
    const timer = setTimeout(() => {
      if (!chartRef.current) return;
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      const ctx = chartRef.current.getContext('2d');
      chartInstanceRef.current = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: Object.keys(game.ratings).filter(k => k !== 'rating').map(k => LABELS[k]),
          datasets: [{
            label: 'Рейтинг',
            data: Object.keys(game.ratings).filter(k => k !== 'rating').map(k => game.ratings[k]),
            fill: true,
            backgroundColor: 'rgba(255, 215, 0, 0.2)',
            borderColor: '#ffd700',
            pointBackgroundColor: '#ffd700',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: '#ffd700'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: 0
          },
          elements: { line: { borderWidth: 4 } },
          scales: {
            r: {
              angleLines: { color: 'rgba(255, 255, 255, 0.3)' },
              grid: { color: 'rgba(255, 255, 255, 0.3)' },
              pointLabels: {
                color: 'white',
                padding: 0,
                font: { size: 13, family: 'Inter' }
              },
              ticks: { backdropColor: 'transparent', color: 'rgba(255, 255, 255, 0.7)', showLabelBackdrop: false, stepSize: 2, font: { size: 11 } },
              suggestedMin: 0, suggestedMax: 10
            }
          },
          plugins: { legend: { display: false } }
        }
      });
    }, 50);

    return () => {
      clearTimeout(timer);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [chartMode, game]);

  return (
    <motion.div
      ref={ref}
      custom={slideDir}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Верхний ряд: критерии слева + инфо справа */}
      <div className={`modal-body ${similarLayoutOpen ? 'has-similar-games' : ''}`}>
        {/* Левая: критерии */}
        <div className="modal-left">
          <div className={`criteria ${chartMode ? 'chart-mode' : ''}`}>
            <div className="criteria-wrapper">
              <div className={`criteria-view text-view ${!chartMode ? 'active' : 'hidden'}`}>
                {Object.entries(game.ratings).filter(([k]) => k !== 'rating').map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 4 }}><b>{LABELS_FULL[k]}:</b> {v}</div>
                ))}
              </div>
              <div className={`criteria-view chart-view ${chartMode ? 'active' : 'hidden'}`}>
                <div style={{ width: 350, height: 350 }}>
                  <canvas ref={chartRef}></canvas>
                </div>
              </div>
            </div>
            <button className="toggle-chart-btn" disabled={similarOpen || similarLayoutOpen} onClick={() => setChartMode(!chartMode)} title={chartMode ? "Показать текст" : "Показать график"}>
              {chartMode ? "📝" : "🕸️"}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false} onExitComplete={onSimilarExitComplete}>
          {similarOpen && (
            <SimilarGamesPanel
              game={game}
              games={games}
              onSelect={onSimilarSelect}
            />
          )}
        </AnimatePresence>

        {/* Правая: компактная инфо-панель */}
        <div className="modal-right">
          <div className="modal-info-panel">
            <div className="modal-info-row">
              <span className="modal-info-key">Игра</span>
              <span className="modal-info-val" style={{ fontWeight: 700, fontSize: '0.92rem', lineHeight: 1.3 }}>{game.title}</span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-key">Студия</span>
              <span className="modal-info-val" style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 400 }}>{game.developer}</span>
            </div>
            {game.genres && game.genres.length > 0 && (
              <div className="modal-info-row">
                <span className="modal-info-key">Жанры</span>
                <span className="modal-info-val">
                  <div className="modal-info-genres">
                    {game.genres.map(g => <span key={g} className="modal-info-genre-tag">{g}</span>)}
                  </div>
                </span>
              </div>
            )}
            <div className="modal-info-row">
              <span className="modal-info-key">Год</span>
              <span className="modal-info-val">{game.year || "2023"}</span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-key">Время</span>
              <span className="modal-info-val">{game.playtime || "30 ч."}</span>
            </div>
          </div>
          <button
            className="similar-games-toggle"
            type="button"
            onClick={onToggleSimilar}
            disabled={similarToggleBusy}
            aria-expanded={similarOpen}
          >
            {similarOpen ? 'Скрыть' : 'Похожие игры по жанру'}
          </button>
        </div>
      </div>

      {/* Нижний ряд: описание на всю ширину */}
      <div id="modal-review">{REVIEWS[game.id] || "Описание..."}</div>

    </motion.div>
  );
});

const GameModal = ({ game, allGames, onClose, onNavigate, canEdit, onEdit }) => {
  const [slideDir, setSlideDir] = useState(0);
  const [displayGame, setDisplayGame] = useState(game);
  const [chartMode, setChartMode] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [similarLayoutOpen, setSimilarLayoutOpen] = useState(false);
  const [similarToggleBusy, setSimilarToggleBusy] = useState(false);
  const similarToggleBusyRef = useRef(false);
  const similarToggleTimerRef = useRef(null);
  const currentIndexRef = useRef(allGames ? allGames.findIndex(g => g.id === game.id) : 0);

  useEffect(() => () => {
    if (similarToggleTimerRef.current) clearTimeout(similarToggleTimerRef.current);
  }, []);

  // Sync displayGame when game prop changes (from outside, e.g. roulette)
  useEffect(() => {
    setDisplayGame(game);
    setSimilarOpen(false);
    setSimilarLayoutOpen(false);
    currentIndexRef.current = allGames ? allGames.findIndex(g => g.id === game.id) : 0;
  }, [game]);

  const currentIndex = allGames ? allGames.findIndex(g => g.id === displayGame.id) : -1;
  const total = allGames ? allGames.length : 0;

  const navigateRef = useRef(null);
  const navigate = (dir) => {
    if (!allGames || allGames.length < 2) return;
    const nextIndex = (currentIndexRef.current + dir + total) % total;
    currentIndexRef.current = nextIndex;
    const nextGame = allGames[nextIndex];
    setSlideDir(dir);
    setDisplayGame(nextGame);
    setSimilarOpen(false);
    setSimilarLayoutOpen(false);
    if (onNavigate) onNavigate(nextGame);
  };
  navigateRef.current = navigate;

  const toggleSimilar = () => {
    if (similarToggleBusyRef.current) return;

    similarToggleBusyRef.current = true;
    setSimilarToggleBusy(true);
    similarToggleTimerRef.current = setTimeout(() => {
      similarToggleBusyRef.current = false;
      similarToggleTimerRef.current = null;
      setSimilarToggleBusy(false);
    }, 240);

    if (similarOpen) {
      setSimilarOpen(false);
      return;
    }
    if (chartMode) setChartMode(false);
    setSimilarLayoutOpen(true);
    setSimilarOpen(true);
  };

  const openSimilarGame = (nextGame) => {
    const nextIndex = allGames ? allGames.findIndex(g => g.id === nextGame.id) : -1;
    if (nextIndex >= 0) currentIndexRef.current = nextIndex;
    setSlideDir(1);
    setDisplayGame(nextGame);
    setSimilarOpen(false);
    setSimilarLayoutOpen(false);
    if (onNavigate) onNavigate(nextGame);
  };

  // Keyboard navigation — подписка один раз, navigate берётся из ref
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateRef.current(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); navigateRef.current(-1); }
      if (e.key === 'Escape') { onClose(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <motion.div id="game-modal"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={displayGame.id}
            className="modal-bg-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            style={{ backgroundImage: `url("${displayGame.image}")` }}
          />
        </AnimatePresence>
        <span className="close-btn" onClick={onClose}>×</span>
        {canEdit && (
          <button
            type="button"
            className="modal-edit-btn"
            onClick={() => onEdit(displayGame)}
            aria-label={`Изменить карточку ${displayGame.title}`}
            title="Изменить карточку"
          >
            ✎
          </button>
        )}


        {/* Counter — левый верхний угол */}
        {allGames && allGames.length > 1 && (
          <div className="modal-nav-counter">
            {currentIndex + 1} / {total}
          </div>
        )}

        {/* Animated slide content */}
        <div className="modal-slide-viewport">
          <AnimatePresence custom={slideDir} mode="sync" initial={false}>
            <GameModalSlide
              key={displayGame.id}
              game={displayGame}
              games={allGames}
              slideDir={slideDir}
              chartMode={chartMode}
              setChartMode={setChartMode}
              similarOpen={similarOpen}
              similarLayoutOpen={similarLayoutOpen}
              similarToggleBusy={similarToggleBusy}
              onToggleSimilar={toggleSimilar}
              onSimilarSelect={openSimilarGame}
              onSimilarExitComplete={() => setSimilarLayoutOpen(false)}
            />
          </AnimatePresence>
        </div>

        {allGames && allGames.length > 1 && (
          <div className="modal-nav-hint">↑ ↓ — листать карточки</div>
        )}
      </motion.div>
    </motion.div>
  );
};

const GamePage = ({ game, onBack, onOpenGame }) => {
  const [chartMode, setChartMode] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    setSimilarOpen(false);
  }, [game.id]);

  useEffect(() => {
    if (!chartMode || !chartRef.current) return;

    const timer = setTimeout(() => {
      if (!chartRef.current) return;
      if (chartInstanceRef.current) chartInstanceRef.current.destroy();

      const isDark = document.body.classList.contains('dark');
      const textColor = isDark ? '#fff' : '#1a1a1a';
      const gridColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.22)';
      const criteriaKeys = Object.keys(game.ratings).filter(key => key !== 'rating');

      chartInstanceRef.current = new Chart(chartRef.current.getContext('2d'), {
        type: 'radar',
        data: {
          labels: criteriaKeys.map(key => LABELS[key]),
          datasets: [{
            label: game.title,
            data: criteriaKeys.map(key => game.ratings[key]),
            fill: true,
            backgroundColor: 'rgba(255, 215, 0, 0.2)',
            borderColor: '#d4a900',
            pointBackgroundColor: '#d4a900',
            pointBorderColor: isDark ? '#fff' : '#333'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              angleLines: { color: gridColor },
              grid: { color: gridColor },
              pointLabels: { color: textColor, font: { size: 10, family: 'Inter' } },
              ticks: { display: false },
              suggestedMin: 0,
              suggestedMax: 10
            }
          },
          plugins: { legend: { display: false } }
        }
      });
    }, 40);

    return () => {
      clearTimeout(timer);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [chartMode, game]);

  return (
    <main className="game-page">
      <div className="game-page-header">
        <button className="game-page-back" onClick={onBack}>← Назад</button>
        <div className="game-page-header-title">Карточка игры</div>
      </div>

      <section className="game-page-hero" style={{ backgroundImage: `url("${game.image}")` }}>
        <div className="game-page-hero-content">
          <h1 className="game-page-title">{game.title}</h1>
          <div className="game-page-developer">{game.developer} · оценка {calcRating(game.ratings)}</div>
        </div>
      </section>

      <section className="game-page-section">
        <h2 className="game-page-section-title">Информация</h2>
        <div className="game-page-info">
          <div className="game-page-info-item"><span className="game-page-info-key">Год</span><span className="game-page-info-value">{game.year || '2023'}</span></div>
          <div className="game-page-info-item"><span className="game-page-info-key">Время</span><span className="game-page-info-value">{game.playtime || '30 ч.'}</span></div>
          <div className="game-page-info-item" style={{ gridColumn: '1 / -1' }}><span className="game-page-info-key">Студия</span><span className="game-page-info-value">{game.developer}</span></div>
        </div>
        <div className="game-page-genres" style={{ marginTop: 10 }}>
          {game.genres.map(genre => <span key={genre} className="game-page-genre">{genre}</span>)}
        </div>
      </section>

      <section className="game-page-section">
        <h2 className="game-page-section-title">Оценки</h2>
        {!chartMode && <div className="game-page-ratings">
          {Object.entries(game.ratings).filter(([key]) => key !== 'rating').map(([key, value]) => (
            <div key={key}><b>{LABELS_FULL[key]}:</b> {value}</div>
          ))}
        </div>}
        {chartMode && <div className="game-page-chart"><canvas ref={chartRef}></canvas></div>}
        <button className="game-page-chart-toggle" onClick={() => setChartMode(mode => !mode)}>
          {chartMode ? '📝 Показать списком' : '🕸️ Показать графиком'}
        </button>
      </section>

      <section className="game-page-section">
        <h2 className="game-page-section-title">Описание</h2>
        <div className="game-page-review">{REVIEWS[game.id] || 'Описание...'}</div>
        <button
          className="game-page-similar-toggle"
          type="button"
          onClick={() => setSimilarOpen(open => !open)}
          aria-expanded={similarOpen}
        >
          {similarOpen ? 'Скрыть' : 'Похожие игры по жанру'}
        </button>
        <AnimatePresence initial={false}>
          {similarOpen && (
            <SimilarGamesPanel
              game={game}
              games={GAMES}
              className="game-page-similar-panel"
              role="region"
              onSelect={(nextGame) => {
                setSimilarOpen(false);
                if (onOpenGame) onOpenGame(nextGame);
              }}
            />
          )}
        </AnimatePresence>
      </section>
    </main>
  );
};

const COMPARE_CHART_COLORS = [
  'rgba(255, 99, 132, 0.4)',
  'rgba(54, 162, 235, 0.4)',
  'rgba(255, 206, 86, 0.4)',
  'rgba(75, 192, 192, 0.4)',
  'rgba(153, 102, 255, 0.4)',
  'rgba(255, 159, 64, 0.4)'
];

const COMPARE_CHART_BORDER_COLORS = [
  'rgba(255, 99, 132, 1)',
  'rgba(54, 162, 235, 1)',
  'rgba(255, 206, 86, 1)',
  'rgba(75, 192, 192, 1)',
  'rgba(153, 102, 255, 1)',
  'rgba(255, 159, 64, 1)'
];

const compareColorWithOpacity = (color, opacity) => {
  const match = String(color).match(/rgba?\(([^)]+)\)/);
  if (!match) return color;
  const parts = match[1].split(',').map(part => part.trim());
  const baseAlpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
  return `rgba(${parts.slice(0, 3).join(', ')}, ${(baseAlpha * opacity).toFixed(3)})`;
};

const CompareModal = ({ selectedGameIds, onClose, theme }) => {
  const [chartMode, setChartMode] = useState(false);
  const [inactiveGameIds, setInactiveGameIds] = useState([]);
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const inactiveGameIdsRef = useRef(inactiveGameIds);
  const datasetOpacityRef = useRef(new Map());
  const datasetAnimationFramesRef = useRef(new Map());
  inactiveGameIdsRef.current = inactiveGameIds;

  const allGamesToCompare = useMemo(
    () => GAMES.filter(g => selectedGameIds.includes(g.id)),
    [selectedGameIds]
  );
  const gamesToCompare = useMemo(
    () => allGamesToCompare.filter(g => !inactiveGameIds.includes(g.id)),
    [allGamesToCompare, inactiveGameIds]
  );

  const toggleCompareGame = (gameId) => {
    setInactiveGameIds(prev => prev.includes(gameId)
      ? prev.filter(id => id !== gameId)
      : [...prev, gameId]
    );
  };

  // Calculate max ratings for highlighting
  const maxRatings = useMemo(() => {
    const max = {};
    Object.keys(LABELS_FULL).filter(key => key !== 'year' && key !== 'playtime').forEach(key => {
      let m = -Infinity;
      gamesToCompare.forEach(g => {
        const val = parseFloat(key === 'rating' ? calcRating(g.ratings) : (g.ratings[key] || 0));
        if (val > m) m = val;
      });
      if (m > 0) max[key] = m;
    });
    return max;
  }, [gamesToCompare]);

  useEffect(() => {
    if (!chartMode || !chartRef.current || allGamesToCompare.length === 0) return;

    const timer = setTimeout(() => {
      if (!chartRef.current) return;
      const ctx = chartRef.current.getContext('2d');
      if (chartInstanceRef.current) chartInstanceRef.current.destroy();

      const criteriaKeys = Object.keys(LABELS).filter(k => k !== 'rating' && k !== 'year' && k !== 'playtime');
      const datasets = allGamesToCompare.map(game => {
        const colorIndex = allGamesToCompare.findIndex(item => item.id === game.id);
        const initialOpacity = inactiveGameIdsRef.current.includes(game.id) ? 0 : 1;
        datasetOpacityRef.current.set(game.id, initialOpacity);
        return {
          label: game.title,
          data: criteriaKeys.map(k => game.ratings[k]),
          backgroundColor: compareColorWithOpacity(COMPARE_CHART_COLORS[colorIndex % COMPARE_CHART_COLORS.length], initialOpacity),
          borderColor: compareColorWithOpacity(COMPARE_CHART_BORDER_COLORS[colorIndex % COMPARE_CHART_BORDER_COLORS.length], initialOpacity),
          borderWidth: 2,
          pointBackgroundColor: compareColorWithOpacity(COMPARE_CHART_BORDER_COLORS[colorIndex % COMPARE_CHART_BORDER_COLORS.length], initialOpacity),
          pointBorderColor: compareColorWithOpacity('rgba(255, 255, 255, 1)', initialOpacity),
          pointHoverBackgroundColor: compareColorWithOpacity('rgba(255, 255, 255, 1)', initialOpacity),
          pointHoverBorderColor: compareColorWithOpacity(COMPARE_CHART_BORDER_COLORS[colorIndex % COMPARE_CHART_BORDER_COLORS.length], initialOpacity)
        };
      });

      const isDark = theme === 'dark' || document.body.classList.contains('dark');
      const textColor = isDark ? 'white' : '#000';
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.4)';

      chartInstanceRef.current = new Chart(ctx, {
        type: 'radar',
        data: { labels: criteriaKeys.map(k => LABELS[k]), datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 420, easing: 'easeOutCubic' },
          layout: { padding: 18 },
          elements: { line: { borderWidth: 2 } },
          scales: {
            r: {
              angleLines: { color: gridColor },
              grid: { color: gridColor },
              pointLabels: { color: textColor, padding: 4, font: { size: 14, family: 'Inter' } },
              ticks: { display: false, backdropColor: 'transparent' },
              suggestedMin: 0,
              suggestedMax: 10
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }, 50);

    return () => {
      clearTimeout(timer);
      datasetAnimationFramesRef.current.forEach(frame => cancelAnimationFrame(frame));
      datasetAnimationFramesRef.current.clear();
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [chartMode, allGamesToCompare, theme]);

  const animateCompareGame = (game, index, targetOpacity) => {
    const chart = chartInstanceRef.current;
    if (!chart) return;

    const dataset = chart.data.datasets[index];
    if (!dataset) return;

    const previousFrame = datasetAnimationFramesRef.current.get(game.id);
    if (previousFrame) cancelAnimationFrame(previousFrame);

    const startOpacity = datasetOpacityRef.current.get(game.id) ?? targetOpacity;
    const startedAt = performance.now();
    const duration = 380;
    const colorIndex = allGamesToCompare.findIndex(item => item.id === game.id);
    const fillColor = COMPARE_CHART_COLORS[colorIndex % COMPARE_CHART_COLORS.length];
    const borderColor = COMPARE_CHART_BORDER_COLORS[colorIndex % COMPARE_CHART_BORDER_COLORS.length];

    const frame = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const opacity = startOpacity + (targetOpacity - startOpacity) * eased;

      dataset.backgroundColor = compareColorWithOpacity(fillColor, opacity);
      dataset.borderColor = compareColorWithOpacity(borderColor, opacity);
      dataset.pointBackgroundColor = compareColorWithOpacity(borderColor, opacity);
      dataset.pointBorderColor = compareColorWithOpacity('rgba(255, 255, 255, 1)', opacity);
      dataset.pointHoverBackgroundColor = compareColorWithOpacity('rgba(255, 255, 255, 1)', opacity);
      dataset.pointHoverBorderColor = compareColorWithOpacity(borderColor, opacity);
      datasetOpacityRef.current.set(game.id, opacity);
      chart.update('none');

      if (progress < 1) {
        const nextFrame = requestAnimationFrame(frame);
        datasetAnimationFramesRef.current.set(game.id, nextFrame);
      } else {
        datasetOpacityRef.current.set(game.id, targetOpacity);
        datasetAnimationFramesRef.current.delete(game.id);
      }
    };

    const frameId = requestAnimationFrame(frame);
    datasetAnimationFramesRef.current.set(game.id, frameId);
  };

  useEffect(() => {
    if (!chartMode || !chartInstanceRef.current) return;
    allGamesToCompare.forEach((game, index) => {
      animateCompareGame(game, index, inactiveGameIds.includes(game.id) ? 0 : 1);
    });
  }, [inactiveGameIds, chartMode, allGamesToCompare]);

  return (
    <motion.div id="game-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal-content compare-mode"
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <span className="close-btn" onClick={onClose}>×</span>
        <h2>Сравнение игр</h2>

        <div className={`criteria ${chartMode ? 'chart-mode' : ''}`} style={{ width: '100%', boxSizing: 'border-box', margin: 0, marginBottom: 20 }}>
          <div className="criteria-wrapper">
            {/* Table View */}
            <div className={`criteria-view text-view ${!chartMode ? 'active' : 'hidden'}`} style={{ width: '100%' }}>
              <div className="compare-table-wrapper">
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>
                        <div className="compare-header-cell">
                          <div className="compare-header-title">Критерий</div>
                          <div className="compare-header-criteria-icon" aria-hidden="true">⚖️</div>
                        </div>
                      </th>
                      {gamesToCompare.map(g => (
                        <th key={g.id} title={g.title}>
                          <div className="compare-header-cell">
                            <div className="compare-header-title">{g.title}</div>
                            <img src={g.image} alt={g.title} className="compare-header-img" loading="lazy" />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(LABELS_FULL).filter(key => key !== 'year' && key !== 'playtime').map(key => (
                      <tr key={key}>
                        <td><b>{LABELS_FULL[key]}</b></td>
                        {gamesToCompare.map(g => {
                          const val = key === 'rating' ? calcRating(g.ratings) : g.ratings[key];
                          const isMax = parseFloat(val) === maxRatings[key];
                          return <td key={g.id} className={isMax ? 'highlight-max' : ''}>{val}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Chart View */}
            <div className={`criteria-view chart-view ${chartMode ? 'active' : 'hidden'}`}>
              <div className="compare-chart-layout">
                <aside className="compare-games-list" aria-label="Игры в сравнении">
                  <div className="compare-games-list-title">Игры в сравнении</div>
                  <div className="compare-games-list-items">
                    {allGamesToCompare.map((game, index) => {
                      const isInactive = inactiveGameIds.includes(game.id);
                      return (
                        <button
                          className={`compare-game-list-item ${isInactive ? 'is-inactive' : ''}`}
                          type="button"
                          key={game.id}
                          onClick={() => toggleCompareGame(game.id)}
                          aria-pressed={!isInactive}
                          title={isInactive ? `Вернуть ${game.title} в сравнение` : `Исключить ${game.title} из сравнения`}
                        >
                          <span
                            className="compare-game-list-swatch"
                            style={{ backgroundColor: COMPARE_CHART_BORDER_COLORS[index % COMPARE_CHART_BORDER_COLORS.length] }}
                            aria-hidden="true"
                          />
                          <span>{game.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </aside>
                <div className="compare-chart-area">
                  <div className="compare-chart-shell">
                    <canvas ref={chartRef}></canvas>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
        <button className="toggle-chart-btn" onClick={() => setChartMode(!chartMode)} title={chartMode ? "Показать таблицу" : "Показать график"} style={{ bottom: 12, right: 18, width: 40, height: 40, fontSize: 20, position: 'absolute' }}>
          {chartMode ? "📝" : "🕸️"}
        </button>
      </motion.div>
    </motion.div>
  );
};

const RouletteModal = ({ onClose, onSelect }) => {
  const [spinning, setSpinning] = useState(false);
  const tapeRef = useRef(null);
  const windowRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const tapeItems = useMemo(() => {
    if (!GAMES.length) return [];
    const items = [];
    for (let i = 0; i < 100; i++) items.push(GAMES[i % GAMES.length]);
    return items;
  }, []);

  const spin = () => {
    if (spinning || !tapeItems.length || !tapeRef.current || !windowRef.current) return;

    setSpinning(true);

    tapeRef.current.style.transition = 'none';
    tapeRef.current.style.transform = 'translateX(0px)';
    void tapeRef.current.offsetHeight;

    const winnerIndex = Math.floor(Math.random() * 36) + 50; // 50..85
    const winnerGame = tapeItems[winnerIndex];

    // Read the rendered card size so mobile (120px) and desktop (160px)
    // use the same geometry as the tape animation.
    const firstCard = tapeRef.current.querySelector('.r-card');
    if (!firstCard) {
      setSpinning(false);
      return;
    }
    const cardRect = firstCard.getBoundingClientRect();
    const cardStyles = getComputedStyle(firstCard);
    const marginLeft = parseFloat(cardStyles.marginLeft) || 0;
    const marginRight = parseFloat(cardStyles.marginRight) || 0;
    const cardWidth = cardRect.width;
    const totalItemWidth = cardWidth + marginLeft + marginRight;
    const containerWidth = windowRef.current.offsetWidth;
    const winnerCenterOnTape = winnerIndex * totalItemWidth + marginLeft + cardWidth / 2;
    const targetTransform = containerWidth / 2 - winnerCenterOnTape;

    tapeRef.current.style.transition = 'transform 5s cubic-bezier(0.1, 0.95, 0.1, 1)';
    tapeRef.current.style.transform = `translateX(${targetTransform}px)`;

    timerRef.current = setTimeout(() => {
      setSpinning(false);
      if (onSelect) onSelect(winnerGame);
      onClose();
    }, 5500);
  };

  return (
    <motion.div id="roulette-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <div className="roulette-box" onClick={e => e.stopPropagation()}>
        <span className="close-btn" onClick={onClose} style={{ position: 'absolute', top: 15, right: 20, fontSize: 30, cursor: 'pointer' }}>×</span>
        <h2>Во что сыграть?</h2>
        <div className="roulette-window" ref={windowRef}>
          <div className="roulette-marker"></div>
          <div className="roulette-tape" ref={tapeRef}>
            {tapeItems.map((game, i) => (
              <div key={i} className="r-card" style={{ backgroundImage: `url("${game.image}")` }}>
                <div className="title">{game.title}</div>
              </div>
            ))}
          </div>
        </div>
        {!tapeItems.length && <p style={{ color: '#aaa' }}>В каталоге пока нет игр.</p>}
        <button id="spin-btn" onClick={spin} disabled={spinning || !tapeItems.length} style={{ background: spinning ? '#555' : '#e91e63', color: 'white', border: 'none', padding: '12px 30px', fontSize: '1.2rem', borderRadius: 30, cursor: spinning ? 'default' : 'pointer', transition: 'background 0.3s' }}>
          {spinning ? "Крутим..." : "Крутить!"}
        </button>
      </div>
    </motion.div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
gameDataPromise
  .then(({ GAMES: loadedGames, REVIEWS: loadedReviews, catalogProfile }) => {
    GAMES = loadedGames;
    REVIEWS = loadedReviews;
    viewedCatalogProfile = catalogProfile || null;
    root.render(<App />);
  })
  .catch(error => {
    console.error('Не удалось загрузить данные каталога:', error);
    document.getElementById('root').innerHTML =
      '<div style="padding: 40px; text-align: center;">' +
      '<div>Не удалось загрузить данные каталога.</div>' +
      '<div style="margin-top: 12px; font-size: 0.9em; opacity: 0.75;">Попробуйте перезагрузить страницу позже.</div>' +
      '</div>';
  });
