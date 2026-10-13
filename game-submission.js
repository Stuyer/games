(function () {
  const MAX_COVER_SIZE = 409600;

  async function compressCover(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Выберите файл изображения.');
    if (file.size <= MAX_COVER_SIZE) return file;

    const bitmap = await createImageBitmap(file);
    try {
      let scale = Math.min(1, 1600 / bitmap.width, 2000 / bitmap.height);
      const canvas = document.createElement('canvas');
      let blob = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        let quality = 0.9;
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob || blob.type !== 'image/webp') {
          throw new Error('Браузер не смог преобразовать изображение в WebP. Используйте актуальную версию Chrome или Edge.');
        }
        while (blob.size > MAX_COVER_SIZE && quality > 0.5) {
          quality = Math.max(0.5, quality - 0.08);
          blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        }
        if (blob && blob.size <= MAX_COVER_SIZE) break;
        scale *= 0.82;
      }
      if (!blob || blob.size > MAX_COVER_SIZE) throw new Error('Не удалось сжать обложку до 400 КБ. Выберите другое изображение.');
      return blob;
    } finally {
      bitmap.close();
    }
  }

  function getCoverExtension(contentType) {
    const extensions = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/bmp': 'bmp',
      'image/svg+xml': 'svg',
      'image/avif': 'avif',
      'image/webp': 'webp'
    };
    return extensions[contentType] || 'img';
  }

  async function submit(supabase, values, cover, existingGame = null) {
    const { data: authData, error: authError } = await supabase.auth.getSession();
    const user = authData && authData.session && authData.session.user;
    if (authError || !user) throw new Error('Войдите в аккаунт, чтобы добавить игру.');

    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('is_moderator').eq('id', user.id).single();
    if (profileError) throw profileError;

    const submissionId = crypto.randomUUID();
    let imagePath = existingGame && existingGame.imagePath ? existingGame.imagePath : '';
    let uploadedPath = '';
    if (cover) {
      const contentType = cover.type || 'image/webp';
      uploadedPath = user.id + '/' + submissionId + '.' + getCoverExtension(contentType);
      const { error: uploadError } = await supabase.storage.from('game-covers').upload(uploadedPath, cover, {
        contentType, cacheControl: '31536000', upsert: false
      });
      if (uploadError) throw uploadError;
      imagePath = uploadedPath;
    }

    if (!imagePath) throw new Error('Добавьте обложку игры.');

    const game = {
      id: submissionId,
      title: values.title.trim(),
      developer: values.developer.trim(),
      release_year: values.releaseYear ? Number(values.releaseYear) : null,
      genres: values.genres,
      image_path: imagePath,
      ratings: values.ratings,
      review: values.review.trim(),
      playtime_hours: values.playtimeHours ? Math.round(Number(values.playtimeHours)) : null,
      background_position_list_x: values.cardDisplay?.list?.x ?? 50,
      background_position_list_y: values.cardDisplay?.list?.y ?? 50,
      background_scale_list: values.cardDisplay?.list?.scale ?? 100,
      background_position_grid_x: values.cardDisplay?.grid?.x ?? 50,
      background_position_grid_y: values.cardDisplay?.grid?.y ?? 50,
      background_scale_grid: values.cardDisplay?.grid?.scale ?? 100
    };
    const catalogGame = { ...game, owner_id: user.id };

    try {
      let result;
      if (existingGame && profile.is_moderator) {
        result = await supabase.from('games')
          .update({
            title: game.title,
            developer: game.developer,
            release_year: game.release_year,
            genres: game.genres,
            image_path: game.image_path,
            ratings: game.ratings,
            review: game.review,
            playtime_hours: game.playtime_hours,
            background_position_list_x: game.background_position_list_x,
            background_position_list_y: game.background_position_list_y,
            background_scale_list: game.background_scale_list,
            background_position_grid_x: game.background_position_grid_x,
            background_position_grid_y: game.background_position_grid_y,
            background_scale_grid: game.background_scale_grid
          })
          .eq('id', existingGame.id)
          .select('id')
          .single();
      } else if (existingGame) {
        result = await supabase.from('game_submissions').insert({
          ...game,
          user_id: user.id,
          game_id: existingGame.id,
          status: 'pending'
        });
      } else if (profile.is_moderator) {
        result = await supabase.from('games').insert(catalogGame);
      } else {
        result = await supabase.from('game_submissions').insert({
          ...game,
          user_id: user.id,
          status: 'pending'
        });
      }
      if (result.error) throw result.error;
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('game-covers').remove([uploadedPath]).catch(() => { });
      throw error;
    }
    return { isModerator: Boolean(profile.is_moderator), isEdit: Boolean(existingGame) };
  }

  window.GameSubmission = { compressCover, submit };
})();
