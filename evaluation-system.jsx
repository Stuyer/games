import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export const EVALUATION_CRITERIA = [
  {
    key: 'main_character',
    label: 'Главный герой',
    placeholder: 'Харизма, глубина характера, мотивация, развитие по сюжету...'
  },
  {
    key: 'story',
    label: 'Сюжет',
    placeholder: 'Сюжетные повороты, логика повествования, проработка лора...'
  },
  {
    key: 'gameplay',
    label: 'Геймплей',
    placeholder: 'Отзывчивость управления, глубина и баланс механик, темп...'
  },
  {
    key: 'graphics',
    label: 'Графика',
    placeholder: 'Визуальный стиль, детализация окружения, анимации...'
  },
  {
    key: 'characters',
    label: 'Персонажи',
    placeholder: 'Второстепенные герои, проработка антагонистов, озвучка...'
  },
  {
    key: 'atmosphere',
    label: 'Атмосфера',
    placeholder: 'Эффект погружения, дизайн мира, настроение, аудиовизуал...'
  },
  {
    key: 'sound_design',
    label: 'Саунд-дизайн',
    placeholder: 'Саундтрек, эмбиент, звуки окружения, звуковые эффекты...'
  },
  {
    key: 'general',
    label: 'Общие принципы',
    placeholder: 'Общие ориентиры при оценке, критерии для 10/10 или 5/10...'
  }
];

export const getEvaluationStorageKey = (userId) => {
  return 'site_evaluation_system_' + (userId || 'guest');
};

export const getStoredEvaluationSystem = (userId) => {
  try {
    const key = getEvaluationStorageKey(userId);
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_) { }

  // Fallback to guest key if user key is not found
  if (userId) {
    try {
      const guestRaw = localStorage.getItem('site_evaluation_system_guest');
      if (guestRaw) {
        const parsed = JSON.parse(guestRaw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (_) { }
  }

  return null;
};

export const saveStoredEvaluationSystem = async (client, userId, data) => {
  const key = getEvaluationStorageKey(userId);
  try {
    if (data && Object.keys(data).length > 0) {
      localStorage.setItem(key, JSON.stringify(data));
    } else {
      localStorage.removeItem(key);
    }
  } catch (_) { }

  // Dispatch custom event for real-time reactivity in active tabs/components
  try {
    window.dispatchEvent(new CustomEvent('site:evaluation_system_updated', {
      detail: data || {}
    }));
  } catch (_) { }

  // Sync to Supabase user_metadata if client and user session exist
  if (client?.auth && userId) {
    try {
      await client.auth.updateUser({
        data: { evaluation_system: data || {} }
      });
    } catch (err) {
      console.warn('Не удалось синхронизировать систему оценивания в user_metadata:', err);
    }
  }

  // Also sync to public profiles table if evaluation_system column exists
  if (client && userId) {
    try {
      const { error: profileError } = await client.from('profiles').update({
        evaluation_system: data || {}
      }).eq('id', userId);
      if (profileError) {
        console.warn('Не удалось обновить evaluation_system в profiles:', profileError);
      }
    } catch (err) {
      console.warn('Исключение при обновлении profiles:', err);
    }
  }
};

export const fetchRemoteEvaluationSystem = async (client, userId) => {
  if (!client || !userId) return null;
  try {
    const { data, error } = await client
      .from('profiles')
      .select('evaluation_system')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data?.evaluation_system && typeof data.evaluation_system === 'object') {
      const key = getEvaluationStorageKey(userId);
      try {
        localStorage.setItem(key, JSON.stringify(data.evaluation_system));
      } catch (_) { }
      return data.evaluation_system;
    }
  } catch (_) { }
  return null;
};

export const hasEvaluationSystem = (system) => {
  if (!system || typeof system !== 'object') return false;
  return Object.values(system).some(v => typeof v === 'string' && v.trim().length > 0);
};

let activeScrollLocks = 0;
let savedDocumentOverflow = '';

export const useScrollLock = (locked) => {
  useEffect(() => {
    if (!locked) return undefined;
    if (activeScrollLocks === 0) {
      savedDocumentOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }
    activeScrollLocks += 1;
    return () => {
      activeScrollLocks = Math.max(0, activeScrollLocks - 1);
      if (activeScrollLocks === 0) {
        document.documentElement.style.overflow = savedDocumentOverflow;
      }
    };
  }, [locked]);
};

export const EvaluationSystemModal = ({ isOpen, onClose, user, onSave }) => {
  useScrollLock(isOpen);
  const [criteriaValues, setCriteriaValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState(false);
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setStatusMessage('');
    setStatusError(false);

    // Initial load from local storage or user metadata
    const stored = getStoredEvaluationSystem(user?.id);
    if (stored) {
      setCriteriaValues(stored);
    } else if (user?.user_metadata?.evaluation_system) {
      setCriteriaValues(user.user_metadata.evaluation_system);
    } else {
      setCriteriaValues({});
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleChange = (key, val) => {
    const trimmedVal = val.slice(0, 100);
    setCriteriaValues(prev => ({
      ...prev,
      [key]: trimmedVal
    }));
  };

  const handleClearAll = () => {
    if (window.confirm('Очистить все поля системы оценивания?')) {
      setCriteriaValues({});
    }
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setStatusMessage('');
    setStatusError(false);

    try {
      const cleaned = {};
      for (const item of EVALUATION_CRITERIA) {
        const val = (criteriaValues[item.key] || '').trim().slice(0, 100);
        if (val) cleaned[item.key] = val;
      }

      const activeUserId = user?.id || (await window.siteSupabase?.auth?.getUser())?.data?.user?.id;
      await saveStoredEvaluationSystem(window.siteSupabase, activeUserId, cleaned);
      setStatusMessage('Система оценивания сохранена!');
      if (onSave) onSave(cleaned);

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error('Ошибка сохранения системы оценивания:', err);
      setStatusMessage('Ошибка сохранения. Попробуйте снова.');
      setStatusError(true);
    } finally {
      setSaving(false);
    }
  };

  const modalMarkup = (
    <div
      className="evaluation-modal-backdrop"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      aria-hidden="true"
    >
      <div
        className="evaluation-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="eval-modal-title"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="evaluation-modal-header">
          <div>
            <h2 id="eval-modal-title" className="evaluation-modal-title">Система оценивания</h2>
            <p className="evaluation-modal-subtitle">
              Опишите, на что вы обращаете внимание при оценке игр. Опционально.
            </p>
          </div>
          <button
            type="button"
            className="evaluation-modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <form className="evaluation-modal-form" onSubmit={handleSave}>
          <div className="evaluation-modal-body">
            {EVALUATION_CRITERIA.map((crit) => {
              const val = criteriaValues[crit.key] || '';
              return (
                <div key={crit.key} className="evaluation-field">
                  <div className="evaluation-field-header">
                    <label htmlFor={`eval-${crit.key}`} className="evaluation-field-label">
                      <span>{crit.label}</span>
                    </label>
                    <span className="evaluation-field-count" aria-live="polite">
                      {val.length} / 100
                    </span>
                  </div>
                  <textarea
                    id={`eval-${crit.key}`}
                    className="evaluation-field-textarea"
                    value={val}
                    onChange={(e) => handleChange(crit.key, e.target.value)}
                    placeholder={crit.placeholder}
                    maxLength={100}
                    rows={3}
                  />
                </div>
              );
            })}
          </div>

          <div className="evaluation-modal-footer">
            <button
              type="button"
              className="evaluation-modal-clear-btn"
              onClick={handleClearAll}
              title="Очистить все поля"
            >
              Очистить всё
            </button>

            {statusMessage && (
              <span className={`evaluation-modal-status ${statusError ? 'error' : ''}`}>
                {statusMessage}
              </span>
            )}

            <div className="evaluation-modal-actions">
              <button
                type="button"
                className="btn evaluation-modal-cancel-btn"
                onClick={onClose}
                disabled={saving}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn primary evaluation-modal-save-btn"
                disabled={saving}
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalMarkup, document.body) : modalMarkup;
};
