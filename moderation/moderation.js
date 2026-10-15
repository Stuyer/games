(function () {
  const config = window.SUPABASE_CONFIG || {};
  const client = window.supabase && config.url && config.publishableKey
    ? window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
    : null;

  const state = {
    submissions: [],
    rejectId: null,
    busyIds: new Set()
  };

  const listElement = document.getElementById('submissions-list');
  const statusElement = document.getElementById('moderation-status');
  const countElement = document.getElementById('queue-count');
  const rejectBackdrop = document.getElementById('reject-dialog');
  const rejectForm = document.getElementById('reject-form');
  const rejectNote = document.getElementById('reject-note');

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));

  const setStatus = (text, type = '') => {
    statusElement.textContent = text;
    statusElement.className = `page-status ${type}`.trim();
  };

  const formatDate = value => {
    if (!value) return '';
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  };

  const createCover = item => {
    const cover = document.createElement('div');
    cover.className = 'submission-cover';
    if (item.signedUrl) {
      const image = document.createElement('img');
      image.src = item.signedUrl;
      image.alt = item.title || 'Обложка заявки';
      cover.append(image);
    } else {
      cover.textContent = 'Обложка недоступна';
    }
    return cover;
  };

  const render = () => {
    countElement.textContent = state.submissions.length;
    listElement.replaceChildren();

    if (!state.submissions.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Новых заявок нет.';
      listElement.append(empty);
      return;
    }

    state.submissions.forEach(item => {
      const article = document.createElement('article');
      article.className = 'submission-item';
      article.dataset.id = item.id;
      const profileName = item.profile?.display_name || item.profile?.username || 'Пользователь';
      const genres = Array.isArray(item.genres) ? item.genres.join(' · ') : '';
      const details = [item.developer, item.release_year, item.playtime_hours == null ? '' : `${Math.round(Number(item.playtime_hours))} ч.`, genres]
        .filter(Boolean).join(' · ');

      const main = document.createElement('div');
      main.className = 'submission-main';
      main.innerHTML = `
        <div class="submission-heading">
          <div>
            <h2>${escapeHtml(item.title || 'Без названия')}</h2>
            <div class="submission-meta">${escapeHtml(details)}</div>
          </div>
          <div class="submission-meta">${escapeHtml(formatDate(item.created_at))}</div>
        </div>
        <div class="submission-author">Автор: ${escapeHtml(profileName)}${item.profile?.username ? ` · @${escapeHtml(item.profile.username)}` : ''}</div>
        <div class="submission-review"><span class="submission-review-label">Обзор:</span> ${escapeHtml(item.review || 'не указан')}</div>
        <div class="submission-actions">
          <button class="approve-button" type="button" data-action="approve" ${state.busyIds.has(item.id) ? 'disabled' : ''}>Одобрить</button>
          <button class="reject-button" type="button" data-action="reject" ${state.busyIds.has(item.id) ? 'disabled' : ''}>Отклонить</button>
        </div>`;

      article.append(main, createCover(item));
      article.querySelector('[data-action="approve"]').addEventListener('click', () => moderate(item.id, true));
      article.querySelector('[data-action="reject"]').addEventListener('click', () => openRejectDialog(item.id));
      listElement.append(article);
    });
  };

  async function loadQueue() {
    if (!client) throw new Error('Supabase не подключен.');
    setStatus('Загружаю заявки…');
    const { data, error } = await client
      .from('game_submissions')
      .select('id, user_id, game_id, title, developer, release_year, genres, image_path, review, playtime_hours, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw error;

    const rows = data || [];
    const userIds = [...new Set(rows.map(item => item.user_id).filter(Boolean))];
    const profiles = userIds.length
      ? await client.from('profiles').select('id, username, display_name').in('id', userIds)
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const profileById = new Map((profiles.data || []).map(profile => [profile.id, profile]));
    const paths = rows.map(item => item.image_path).filter(Boolean);
    const signed = paths.length
      ? await client.storage.from('game-covers').createSignedUrls(paths, 600)
      : { data: [], error: null };
    if (signed.error) throw signed.error;
    const urlByPath = new Map((signed.data || []).map(item => [item.path, item.signedUrl]));

    state.submissions = rows.map(item => ({
      ...item,
      profile: profileById.get(item.user_id),
      signedUrl: urlByPath.get(item.image_path) || ''
    }));
    render();
    setStatus(state.submissions.length ? '' : 'Очередь пуста.', state.submissions.length ? '' : 'success');
  }

  async function moderate(id, approve, note = '') {
    if (state.busyIds.has(id)) return;
    state.busyIds.add(id);
    render();
    try {
      const submission = state.submissions.find(item => item.id === id);
      let oldImagePath = '';
      if (submission?.game_id) {
        const { data: game, error: gameError } = await client
          .from('games').select('image_path').eq('id', submission.game_id).maybeSingle();
        if (gameError) throw gameError;
        oldImagePath = game?.image_path || '';
      }

      const result = approve
        ? await client.rpc('approve_game_submission', { p_submission_id: id })
        : await client.rpc('reject_game_submission', { p_submission_id: id, p_note: note });
      if (result.error) throw result.error;

      // После решения заявки файл больше не нужен, если он не стал обложкой игры.
      // При редактировании старую обложку удаляем только после успешного одобрения.
      const obsoletePath = approve
        ? (oldImagePath && oldImagePath !== submission?.image_path ? oldImagePath : '')
        : (submission?.game_id && oldImagePath === submission.image_path ? '' : submission?.image_path || '');
      let cleanupWarning = '';
      if (obsoletePath) {
        const { error: removeError } = await client.storage.from('game-covers').remove([obsoletePath]);
        if (removeError) cleanupWarning = ` Старый файл не удалён: ${removeError.message || 'Storage отклонил операцию.'}`;
      }
      state.submissions = state.submissions.filter(item => item.id !== id);
      setStatus((approve ? 'Заявка одобрена и добавлена в каталог.' : 'Заявка отклонена.') + cleanupWarning, cleanupWarning ? 'error' : 'success');
      render();
    } catch (error) {
      setStatus(error.message || 'Не удалось обработать заявку.', 'error');
      state.busyIds.delete(id);
      render();
    }
  }

  const openRejectDialog = id => {
    state.rejectId = id;
    rejectNote.value = '';
    rejectBackdrop.hidden = false;
    rejectNote.focus();
  };

  const closeRejectDialog = () => {
    state.rejectId = null;
    rejectBackdrop.hidden = true;
  };

  document.getElementById('refresh-button').addEventListener('click', () => loadQueue().catch(error => setStatus(error.message || 'Не удалось обновить очередь.', 'error')));
  document.getElementById('signout-button').addEventListener('click', async () => {
    await client?.auth.signOut({ scope: 'local' });
    window.location.href = '../';
  });
  document.getElementById('cancel-reject').addEventListener('click', closeRejectDialog);
  rejectBackdrop.addEventListener('click', event => { if (event.target === rejectBackdrop) closeRejectDialog(); });
  rejectForm.addEventListener('submit', event => {
    event.preventDefault();
    const note = rejectNote.value.trim();
    if (!note || !state.rejectId) return;
    const id = state.rejectId;
    closeRejectDialog();
    moderate(id, false, note);
  });

  (async () => {
    if (!client) {
      setStatus('Supabase не подключен.', 'error');
      return;
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const user = data.session?.user;
      if (!user) {
        window.location.href = '../';
        return;
      }
      const { data: profile, error: profileError } = await client.from('profiles')
        .select('is_moderator').eq('id', user.id).single();
      if (profileError) throw profileError;
      if (!profile?.is_moderator) {
        setStatus('Доступ разрешён только модератору.', 'error');
    setTimeout(() => { window.location.href = '../'; }, 1400);
        return;
      }
      await loadQueue();
    } catch (error) {
      setStatus(error.message || 'Не удалось открыть очередь модерации.', 'error');
    }
  })();
})();
