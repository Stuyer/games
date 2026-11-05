-- Migration 007: Отслеживание просмотра заявок и автоматическая очистка
-- Добавляет поле viewed_at для отслеживания просмотра заявок пользователем
-- и автоматическую очистку старых просмотренных заявок

-- Добавляем поле viewed_at для отслеживания времени просмотра заявки
ALTER TABLE game_submissions
ADD COLUMN IF NOT EXISTS viewed_at timestamptz;

-- Создаём индекс для быстрого поиска просмотренных заявок
CREATE INDEX IF NOT EXISTS idx_game_submissions_viewed_at
ON game_submissions(user_id, viewed_at)
WHERE viewed_at IS NOT NULL;

-- Функция для пометки заявки как просмотренной
CREATE OR REPLACE FUNCTION mark_submission_as_viewed(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE game_submissions
  SET viewed_at = now()
  WHERE id = p_submission_id
    AND user_id = auth.uid()
    AND viewed_at IS NULL;
END;
$$;

-- Функция для автоматической очистки старых просмотренных заявок
-- Удаляет заявки, просмотренные более 1 минуты назад
CREATE OR REPLACE FUNCTION cleanup_old_viewed_submissions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Удаляем заявки, просмотренные более 1 минуты назад
  -- Только для статусов approved и rejected (pending оставляем)
  WITH deleted AS (
    DELETE FROM game_submissions
    WHERE viewed_at IS NOT NULL
      AND viewed_at < now() - interval '1 minute'
      AND status IN ('approved', 'rejected')
    RETURNING id
  )
  SELECT count(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$;

-- Комментарии к новым объектам
COMMENT ON COLUMN game_submissions.viewed_at IS
'Время просмотра заявки пользователем. После просмотра заявка будет автоматически удалена через 1 минуту.';

COMMENT ON FUNCTION mark_submission_as_viewed IS
'Помечает заявку как просмотренную текущим пользователем. Только владелец заявки может пометить её.';

COMMENT ON FUNCTION cleanup_old_viewed_submissions IS
'Удаляет просмотренные заявки старше 1 минуты (только approved/rejected). Возвращает количество удалённых записей.';
