/* ─── AUTH & API CONFIG ─── */
const API_URL = 'http://localhost:3000/api';
const HEADERS = { 'Content-Type': 'application/json' };
const sessionToken = localStorage.getItem('portalToken');
if (sessionToken) HEADERS.Authorization = `Bearer ${sessionToken}`;

let portalUserRole = localStorage.getItem('portalRole') || 'user';
let portalUserName = localStorage.getItem('portalName') || 'İstifadəçi';
let portalUserId = localStorage.getItem('portalUserId') || '0';

// Global cache for domains
let domains = { departments: [], sectors: [], positions: [] };
let employees = [];
let nextId = 1, editingId = null, currentView = 'card', currentPage = 'directory';
let editRequestMode = false; // true when non-admin is submitting an edit request
let editRequestOriginalData = null; // snapshot of current employee data
const employeeNameCollator = new Intl.Collator('az', { usage: 'sort', sensitivity: 'accent' });
let searchField = 'all'; // 'all' or specific field key
let orgSelectedDeptId = null;
let orgSearchQuery = '';
let orgExpandedSectors = new Set();

function formatCarPlate(plate) {
  if (!plate) return '';
  let s = String(plate).trim().toUpperCase();
  if (!s) return '';
  const clean = s.replace(/[^A-Z0-9]/g, '');
  const match = clean.match(/^(\d{2})([A-Z]{2})(\d{3})$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return s.replace(/\s+/g, ' ').trim();
}
window.formatCarPlate = formatCarPlate;

// Hərf fərqlərini (Ə/E, İ/I, Ö/O, Ü/U, Ş/S, Ç/C, Ğ/G) yumşaldan funksiya
function normalizeAzChars(text) {
  if (!text) return '';
  return String(text)
    .replace(/[Əə]/g, 'E')
    .replace(/[Iıİi]/g, 'I')
    .replace(/[Öö]/g, 'O')
    .replace(/[Üü]/g, 'U')
    .replace(/[Şş]/g, 'S')
    .replace(/[Çç]/g, 'C')
    .replace(/[Ğğ]/g, 'G')
    .toUpperCase();
}

// Axtarış üçün mətn təmizləyici (tire, boşluq, nöqtə və s. işarələri görməzdən gəlmək üçün)
function normalizeForSearch(str) {
  if (!str) return '';
  return String(str)
    .toLocaleUpperCase('az')
    .replace(/[\s\-_+().,\/\\]/g, '');
}

function matchesSearch(fieldValue, query) {
  if (!fieldValue || !query) return false;
  const fStr = String(fieldValue).toLocaleUpperCase('az');
  const qStr = String(query).toLocaleUpperCase('az').trim();
  if (!qStr) return true;

  // 1. Birbaşa alt-sətir axtarışı
  if (fStr.includes(qStr)) return true;

  // 2. Azərbaycan hərflərinin transliterasiyası ilə axtarış (məs: "eli" -> "Əli", "huseyn" -> "Hüseyn")
  const fSoft = normalizeAzChars(fStr);
  const qSoft = normalizeAzChars(qStr);
  if (qSoft && fSoft.includes(qSoft)) return true;

  // 3. Tire, boşluq və simvolları təmizləyərək axtarış (məs: "10ab123" -> "10-AB-123")
  const fClean = normalizeForSearch(fStr);
  const qClean = normalizeForSearch(qStr);
  if (qClean && fClean.includes(qClean)) return true;

  // 4. Telefon nömrələri üçün xüsusi rəqəm axtarışı (məs: "0502439132" -> "+994 50-243-91-32")
  const qDigits = qStr.replace(/\D/g, '');
  if (qDigits && qDigits.length >= 3) {
    const fDigits = fStr.replace(/\D/g, '');
    if (fDigits.includes(qDigits)) return true;
    if (qDigits.startsWith('0') && fDigits.includes(qDigits.slice(1))) return true;
    if (qDigits.startsWith('994') && fDigits.includes(qDigits.slice(3))) return true;
    if (fDigits.startsWith('994') && fDigits.slice(3).includes(qDigits)) return true;
  }

  return false;
}

function formatMobileNumber(phone) {
  if (!phone) return '';
  const s = String(phone).trim();
  if (!s) return '';

  const digits = s.replace(/\D/g, '');
  if (!digits) return s;

  let localDigits = '';
  if (digits.startsWith('994') && digits.length >= 12) {
    localDigits = digits.slice(3, 12);
  } else if (digits.startsWith('0') && digits.length === 10) {
    localDigits = digits.slice(1, 10);
  } else if (digits.length === 9) {
    localDigits = digits;
  } else if (digits.length > 9) {
    localDigits = digits.slice(-9);
  }

  if (localDigits.length === 9) {
    const op = localDigits.slice(0, 2);
    const p1 = localDigits.slice(2, 5);
    const p2 = localDigits.slice(5, 7);
    const p3 = localDigits.slice(7, 9);
    return `+994 ${op}-${p1}-${p2}-${p3}`;
  }

  if (s.startsWith('+994')) {
    return s.replace(/^\+994\s*/, '+994 ');
  }
  return s;
}
window.formatMobileNumber = formatMobileNumber;

function formatMobilePhone(input) {
  let val = input.value.replace(/\D/g, '');
  if (val.startsWith('994') && val.length > 3) {
    val = val.slice(3);
  } else if (val.startsWith('0') && val.length > 1) {
    val = val.slice(1);
  }
  val = val.slice(0, 9);

  let formatted = '';
  if (val.length > 0) {
    formatted = val.slice(0, 2);
  }
  if (val.length > 2) {
    formatted += '-' + val.slice(2, 5);
  }
  if (val.length > 5) {
    formatted += '-' + val.slice(5, 7);
  }
  if (val.length > 7) {
    formatted += '-' + val.slice(7, 9);
  }
  input.value = formatted;
}
window.formatMobilePhone = formatMobilePhone;

function syncAuthHeader() {
  const isAdmin = portalUserRole === 'admin';
  const isMeetingAdmin = portalUserRole === 'meeting_admin';
  const isLoggedIn = isAdmin || isMeetingAdmin;

  document.documentElement.dataset.headerRole = isAdmin ? 'admin' : (isMeetingAdmin ? 'meeting_admin' : 'user');
  const loginBtn = document.getElementById('adminLoginBtn');
  const userCard = document.getElementById('userCard');
  const adminDropdown = document.getElementById('adminNavDropdown');
  const userBadgeName = document.getElementById('userBadgeName');

  if (loginBtn) {
    if (isLoggedIn) {
      loginBtn.style.setProperty('display', 'none', 'important');
    } else {
      loginBtn.style.removeProperty('display');
    }
  }
  if (userCard) {
    if (isLoggedIn) {
      userCard.style.setProperty('display', 'inline-flex', 'important');
      if (userBadgeName) {
        userBadgeName.textContent = portalUserName || (isAdmin ? 'Admin' : 'İclas İdarəçisi');
      }
    } else {
      userCard.style.setProperty('display', 'none', 'important');
    }
  }
  if (adminDropdown) {
    if (isAdmin) {
      adminDropdown.style.removeProperty('display');
    } else {
      adminDropdown.style.setProperty('display', 'none', 'important');
    }
  }
}
window.syncAuthHeader = syncAuthHeader;
syncAuthHeader();

document.addEventListener('DOMContentLoaded', async () => {
  syncAuthHeader();
  if (portalUserRole === 'admin' || portalUserRole === 'meeting_admin') {
    try {
      const response = await fetch(`${API_URL}/auth/me`, { headers: HEADERS });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          ['portalToken', 'portalRole', 'portalName', 'portalUserId'].forEach(key => localStorage.removeItem(key));
          window.location.reload();
          return;
        }
        throw new Error('Session verification unavailable');
      }
    } catch (error) {
      portalUserRole = 'user';
      syncAuthHeader();
      showToast('Sessiyanı yoxlamaq mümkün olmadı. Səhifəni yeniləyin.', 'error');
    }
  }
  if (portalUserRole === 'admin') {

    fetchPendingRequestsCount();
    setInterval(fetchPendingRequestsCount, 30000);
    // Auto-sync sequences on admin panel entry/refresh (silently)
    syncSequences(false);
  }

  // Load domains first, then load employees
  await fetchDomains();
  await fetchEmployees();
  initIosWheelItems();

  const returnPage = sessionStorage.getItem('portalReturnPage');
  if (returnPage) {
    sessionStorage.removeItem('portalReturnPage');
    if (returnPage !== 'directory' && typeof setPage === 'function') {
      setPage(returnPage);
    }
  }
});

async function logout() {
  try {
    const response = await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: HEADERS });
    if (!response.ok && response.status !== 401 && response.status !== 403) throw new Error('Logout failed');
    ['portalToken', 'portalRole', 'portalName', 'portalUserId'].forEach(key => localStorage.removeItem(key));
    window.location.reload();
  } catch (error) {
    showToast('Çıxış mümkün olmadı. Yenidən cəhd edin.', 'error');
  }
}

async function syncSequences(showFeedback = true) {
  let syncBtn = null;
  if (showFeedback) {
    // Find the sync button in the UI
    const btns = document.querySelectorAll('button');
    syncBtn = Array.from(btns).find(b => b.textContent.includes('Bazanı Sinxronlaşdır'));
    if (syncBtn) {
      syncBtn.classList.add('loading');
      syncBtn.disabled = true;
    }
  }

  try {
    const res = await fetch(`${API_URL}/admin/sync-sequences`, { method: 'POST', headers: HEADERS });
    if (!res.ok) throw new Error('Sync failed');
    const data = await res.json();
    if (showFeedback) {
      const maxEmp = data.sequences?.employees ?? '?';
      showToast(`Sayğaclar sinxronlaşdırıldı ✓ (İşçi max ID: ${maxEmp})`, 'success');
    }
  } catch (err) {
    if (showFeedback) {
      showToast('Sinxronizasiya zamanı xəta baş verdi', 'error');
    }
    console.error('syncSequences error:', err);
  } finally {
    if (syncBtn) {
      // Small timeout to let user see the animation finish
      setTimeout(() => {
        syncBtn.classList.remove('loading');
        syncBtn.disabled = false;
      }, 500);
    }
  }
}
window.syncSequences = syncSequences;

let adminLoginPending = false;
let adminLoginController = null;
let adminLoginPreviousOverflow = '';
let adminLoginReturnFocus = null;

function clearAdminLoginError() {
  document.getElementById('adminLoginError').hidden = true;
  document.getElementById('adminLoginPassword').removeAttribute('aria-invalid');
}

function promptAdminLogin() {
  const dialog = document.getElementById('adminLoginModal');
  if (dialog.open) return;
  adminLoginReturnFocus = document.activeElement;
  document.getElementById('adminLoginForm').reset();
  clearAdminLoginError();
  const usernameInput = document.getElementById('adminLoginUsername');
  if (usernameInput) usernameInput.value = '';
  const input = document.getElementById('adminLoginPassword');
  input.type = 'password';
  const toggle = document.getElementById('adminLoginToggle');
  toggle.setAttribute('aria-label', 'Şifrəni göstər');
  toggle.setAttribute('aria-pressed', 'false');
  updateAdminPasswordToggleIcon(false);
  adminLoginPreviousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  dialog.showModal();
  if (usernameInput) {
    usernameInput.focus();
  } else {
    input.focus();
  }
}

function closeAdminLogin() {
  document.getElementById('adminLoginModal').close();
}

const eyeOpenSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const eyeOffSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function updateAdminPasswordToggleIcon(visible) {
  const toggle = document.getElementById('adminLoginToggle');
  if (toggle) toggle.innerHTML = visible ? eyeOpenSvg : eyeOffSvg;
}

function toggleAdminPassword() {
  const input = document.getElementById('adminLoginPassword');
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  const toggle = document.getElementById('adminLoginToggle');
  toggle.setAttribute('aria-label', visible ? 'Şifrəni gizlət' : 'Şifrəni göstər');
  toggle.setAttribute('aria-pressed', String(visible));
  updateAdminPasswordToggleIcon(visible);
}

async function submitAdminLogin(event) {
  event.preventDefault();
  if (adminLoginPending) return;
  const input = document.getElementById('adminLoginPassword');
  const error = document.getElementById('adminLoginError');
  const submit = document.getElementById('adminLoginSubmit');
  const setError = (message) => {
    error.textContent = message;
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };
  if (!input.value.trim()) {
    setError('Şifrəni daxil edin.');
    return;
  }
  clearAdminLoginError();
  adminLoginPending = true;
  const controller = new AbortController();
  adminLoginController = controller;
  const timeout = setTimeout(() => controller.abort(), 15000);
  submit.disabled = true;
  submit.querySelector('span').textContent = 'Yoxlanılır…';
  document.getElementById('adminLoginForm').setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(API_URL + '/auth/login', {
      method: 'POST',
      headers: HEADERS,
      signal: controller.signal,
      body: JSON.stringify({
        username: (document.getElementById('adminLoginUsername')?.value || 'Admin').trim(),
        password: input.value
      })
    });
    if (!document.getElementById('adminLoginModal').open) return;
    if (res.ok) {
      const data = await res.json();
      if (controller.signal.aborted) return;
      localStorage.setItem('portalRole', data.role);
      localStorage.setItem('portalToken', data.token);
      localStorage.setItem('portalName', data.username);
      localStorage.setItem('portalUserId', String(data.id));
      sessionStorage.setItem('portalReturnPage', currentPage || 'directory');
      input.value = '';
      window.location.reload();
    } else {
      const data = await res.json().catch(() => ({}));
      if (!controller.signal.aborted) setError(data.error || 'Şifrə yanlışdır. Yenidən cəhd edin.');
    }
  } catch (err) {
    if (document.getElementById('adminLoginModal').open) {
      setError(err.name === 'AbortError' ? 'Sorğunun vaxtı bitdi. Yenidən cəhd edin.' : 'Serverə qoşulmaq mümkün olmadı. Yenidən cəhd edin.');
    }
  } finally {
    clearTimeout(timeout);
    adminLoginController = null;
    adminLoginPending = false;
    submit.disabled = false;
    submit.querySelector('span').textContent = 'Daxil ol';
    document.getElementById('adminLoginForm').removeAttribute('aria-busy');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('adminLoginModal');
  let backdropPressed = false;
  dialog.addEventListener('pointerdown', (event) => {
    backdropPressed = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    if (backdropPressed && event.target === dialog) closeAdminLogin();
    backdropPressed = false;
  });
  dialog.addEventListener('close', () => {
    if (adminLoginController) adminLoginController.abort();
    document.getElementById('adminLoginPassword').value = '';
    document.body.style.overflow = adminLoginPreviousOverflow;
    if (adminLoginReturnFocus && adminLoginReturnFocus.isConnected) adminLoginReturnFocus.focus();
  });
});

/* ─── DATA & API ─── */

// API sorğusu üçün retry köməkçisi (DB-yə bağlantı gecikəndə 1 dəfə təkrar cəhd edir)
async function apiRequest(url, options = {}, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, ...options });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt < retries) {
        // Qısa gözləmə — sonra təkrar cəhd
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw err; // Bütün cəhdlər bitdi, xətanı yuxarı ötür
      }
    }
  }
}
const DEPT_GRADIENTS = [
  'linear-gradient(135deg, #1E293B, #334155)', // Corporate Slate
  'linear-gradient(135deg, #0F172A, #1E293B)', // Navy Dark
  'linear-gradient(135deg, #312E81, #4338CA)', // Deep Indigo
  'linear-gradient(135deg, #164E63, #0E7490)', // Teal/Cyan
  'linear-gradient(135deg, #064E3B, #047857)', // Emerald
  'linear-gradient(135deg, #581C87, #7E22CE)', // Purple
  'linear-gradient(135deg, #7F1D1D, #B91C1C)', // Ruby Red
  'linear-gradient(135deg, #701A75, #A21CAF)', // Fuchsia
  'linear-gradient(135deg, #111827, #374151)', // Charcoal
  'linear-gradient(135deg, #3F6212, #4D7C0F)'  // Olive Green
];

function departmentGradient(dept) {
  if (!dept) return DEPT_GRADIENTS[0];
  let h = 0; for (let c of dept) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFFFF;
  return DEPT_GRADIENTS[Math.abs(h) % DEPT_GRADIENTS.length];
}
function initials(n) { return n.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase(); }

window.formatMobilePhone = function (input) {
  let raw = input.value.replace(/\D/g, '');
  raw = raw.substring(0, 9);

  let formatted = '';
  if (raw.length > 0) formatted += raw.substring(0, 2);
  if (raw.length > 2) formatted += '-' + raw.substring(2, 5);
  if (raw.length > 5) formatted += '-' + raw.substring(5, 7);
  if (raw.length > 7) formatted += '-' + raw.substring(7, 9);

  input.value = formatted;
};

// Fetch all domain lists
async function fetchDomains() {
  try {
    const res = await apiRequest(`${API_URL}/domains`);
    domains = await res.json() || { departments: [], sectors: [], positions: [] };
    populateFormDomains();
  } catch (err) {
    showToast('Şöbə məlumatları yüklənərkən xəta baş verdi', 'error');
    console.error('fetchDomains error:', err);
  }
}

window.copyToClipboard = function (text, event, label = 'Email', triggerBtn = null) {
  if (event) {
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  if (!text || text === 'null') return;

  const btn = triggerBtn || (event && event.currentTarget ? event.currentTarget : null);

  const onSuccess = () => {
    showToast(`${label} kopyalandı!`);
    if (btn && btn.classList) {
      btn.classList.add('copied');
      setTimeout(() => {
        btn.classList.remove('copied');
      }, 1500);
    }
  };

  const onFail = () => {
    showToast('Kopyalama uğursuz oldu', 'error');
  };

  const fallbackCopy = () => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      // Prevent scrolling & keyboard popups on iOS / restricted mobile browsers
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) {
        onSuccess();
      } else {
        onFail();
      }
    } catch (e) {
      onFail();
    }
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      fallbackCopy();
    });
  } else {
    fallbackCopy();
  }
};

function renderEmailWithCopy(email, extraClass = '') {
  if (!email || email === 'null') return '<strong>-</strong>';
  const escaped = String(email).replace(/'/g, "\\'");
  return `<span class="email-container ${extraClass}">` +
    `<span class="email-text">${email}</span>` +
    `<button type="button" class="email-copy-btn" onclick="copyToClipboard('${escaped}', event, 'Email', this)" title="Emaili kopyala" aria-label="Emaili kopyala">` +
    `<svg class="copy-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>` +
    `<svg class="check-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` +
    `</button>` +
    `</span>`;
}

async function fetchEmployees() {
  try {
    window.setPage = setPage; window.openView = openView; window.openEdit = openEdit; window.deleteEmp = deleteEmp; window.openDeleteModal = openDeleteModal; window.executeDeleteAction = executeDeleteAction; window.filterEmployees = filterEmployees; window.logout = logout; window.openAddModal = openAddModal; window.closeModal = closeModal; window.saveDirectPassword = saveDirectPassword; window.openDirectPassModal = openDirectPassModal; window.openAddPortalUserModal = openAddPortalUserModal; window.savePortalUser = savePortalUser; window.deletePortalUser = deletePortalUser; window.generateRandomUserPass = generateRandomUserPass; window.approveEditRequest = approveEditRequest; window.rejectEditRequest = rejectEditRequest; window.saveEmployee = saveEmployee; window.showToast = showToast; window.toggleSearchFieldDD = toggleSearchFieldDD; window.setSearchField = setSearchField; window.approveNewEmployeeRequest = approveNewEmployeeRequest; window.renderUsersTable = renderUsersTable; window.copyToClipboard = copyToClipboard;
    const res = await apiRequest(`${API_URL}/employees`);
    employees = await res.json() || [];
    render();
  } catch (err) {
    showToast('Əməkdaş məlumatları yüklənərkən xəta baş verdi. Səhifəni yeniləyin.', 'error');
    console.error('fetchEmployees error:', err);
  }
}

const statAnimations = new WeakMap();

function animateStatCount(element, target) {
  const previous = statAnimations.get(element);
  if (previous && previous.target === target) return;
  if (previous) {
    cancelAnimationFrame(previous.frame);
    statAnimations.delete(element);
  }
  const from = Number(element.textContent) || 0;
  if (from === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.textContent = String(target);
    return;
  }
  const animation = { target, frame: null };
  const started = performance.now();
  const duration = 350;
  const step = (now) => {
    const progress = Math.min(Math.max((now - started) / duration, 0), 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = String(Math.round(from + (target - from) * eased));
    if (progress < 1) {
      animation.frame = requestAnimationFrame(step);
    } else {
      element.textContent = String(target);
      statAnimations.delete(element);
    }
  };
  statAnimations.set(element, animation);
  animation.frame = requestAnimationFrame(step);
}

function updateStats(list) {
  const uniqueRooms = new Set(list.map(e => String(e.room || '').trim().toLocaleLowerCase('az')).filter(Boolean)).size;
  const carOwners = list.filter(e => String(e.car_plate || '').trim() !== '').length;
  const counts = { totalCount: list.length, roomCount: uniqueRooms, carCount: carOwners };
  Object.entries(counts).forEach(([id, count]) => {
    const element = document.getElementById(id);
    if (element) animateStatCount(element, count);
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select')) {
    document.querySelectorAll('.custom-select').forEach(el => el.classList.remove('open'));
  }
  if (!e.target.closest('#searchFieldWrap')) {
    const dd = document.getElementById('searchFieldDD');
    if (dd) dd.classList.remove('open');
  }
  if (!e.target.closest('.form-cs')) {
    document.querySelectorAll('.form-cs').forEach(el => el.classList.remove('open'));
  }
});

/* ─── FORM CUSTOM SELECT SYSTEM ─── */
window.toggleFormCS = function (id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('disabled')) return; // Block opening if disabled
  const wasOpen = el.classList.contains('open');
  // Close all form-cs first
  document.querySelectorAll('.form-cs').forEach(x => x.classList.remove('open'));
  if (!wasOpen) el.classList.add('open');
};

function sortFormCSOptionsById(options) {
  const idOf = (val) => {
    const s = String(val);
    if (s.startsWith('sys_')) return Number(s.slice(4)) || 0;
    return Number(s) || 0;
  };
  return [...options].sort((a, b) => idOf(a.val) - idOf(b.val));
}

function populateFormCS(csId, options, placeholder, withSearch = false) {
  // options = [{val, text}]
  const optsEl = document.getElementById(csId + '-opts');
  if (!optsEl) return;

  const sortedOptions = sortFormCSOptionsById(options);

  let html = '';
  if (withSearch && sortedOptions.length > 5) {
    html += `<div class="form-cs-search"><input type="text" placeholder="Axtar..." oninput="filterFormCSOptions('${csId}', this.value)" onclick="event.stopPropagation()"></div>`;
  }
  if (placeholder !== null) {
    html += `<div class="form-cs-option empty-opt" onclick="selectFormCS('${csId}', '', '${placeholder.replace(/'/g, "\\'")}')">— ${placeholder} —</div>`;
    html += '<div class="form-cs-divider"></div>';
  }
  sortedOptions.forEach(opt => {
    const escapedText = opt.text.replace(/'/g, "\\'");
    html += `<div class="form-cs-option" data-val="${opt.val}" data-text="${opt.text}" onclick="selectFormCS('${csId}', '${opt.val}', '${escapedText}')">${opt.text}</div>`;
  });
  optsEl.innerHTML = html;
}

window.filterFormCSOptions = function (csId, query) {
  const optsEl = document.getElementById(csId + '-opts');
  if (!optsEl) return;
  const q = (query || '').trim();
  optsEl.querySelectorAll('.form-cs-option:not(.empty-opt)').forEach(opt => {
    const text = opt.dataset.text || '';
    opt.style.display = matchesSearch(text, q) ? '' : 'none';
  });
};

window.selectFormCS = function (csId, val, text) {
  const el = document.getElementById(csId);
  if (!el) return;
  const selectedEl = el.querySelector('.form-cs-selected');
  const hiddenInput = el.querySelector('input[type="hidden"]');
  if (selectedEl) {
    selectedEl.textContent = text;
    selectedEl.classList.toggle('placeholder', !val);
  }
  if (hiddenInput) {
    const oldVal = hiddenInput.value;
    hiddenInput.value = val;
    if (oldVal !== val && typeof hiddenInput.onchange === 'function') {
      hiddenInput.onchange();
    }
  }
  // Update active state
  el.querySelectorAll('.form-cs-option').forEach(opt => {
    opt.classList.toggle('active', String(opt.dataset.val) === String(val) && val !== '');
  });
  el.classList.remove('open');
};

function setFormCSWithValue(csId, val, placeholderText) {
  const el = document.getElementById(csId);
  if (!el) return;
  const hiddenInput = el.querySelector('input[type="hidden"]');
  const oldVal = hiddenInput ? hiddenInput.value : '';
  setFormCS(csId, val, placeholderText);
  if (hiddenInput && oldVal !== String(val || '') && typeof hiddenInput.onchange === 'function') {
    hiddenInput.onchange();
  }
}

function setFormCS(csId, val, placeholderText) {
  // Programmatically set a value (for edit mode)
  const el = document.getElementById(csId);
  if (!el) return;
  const hiddenInput = el.querySelector('input[type="hidden"]');
  if (hiddenInput) hiddenInput.value = val || '';
  const selectedEl = el.querySelector('.form-cs-selected');
  // Find matching option text
  const matchOpt = el.querySelector(`.form-cs-option[data-val="${val}"]`);
  el.querySelectorAll('.form-cs-option').forEach(opt => {
    opt.classList.toggle('active', String(opt.dataset.val) === String(val) && val !== '');
  });
  if (selectedEl) {
    if (val && matchOpt) {
      selectedEl.textContent = matchOpt.dataset.text;
      selectedEl.classList.remove('placeholder');
    } else {
      selectedEl.textContent = placeholderText;
      selectedEl.classList.add('placeholder');
    }
  }
}

window.toggleCS = function (id) {
  const el = document.getElementById(id);
  const wasOpen = el.classList.contains('open');
  document.querySelectorAll('.custom-select').forEach(x => x.classList.remove('open'));
  if (!wasOpen) el.classList.add('open');
};

window.selectCSOption = function (csId, val, text) {
  const cs = document.getElementById(csId);
  cs.classList.remove('open');
  cs.querySelector('.cs-selected').textContent = text;
  const inp = cs.querySelector('input');
  inp.value = val;
  filterEmployees();
};

function renderCSOptions(csId, placeholder, optionsArr, currentVal) {
  const cso = document.getElementById('cso-' + csId.split('-')[1]);
  if (!cso) return;
  let html = `<div class="cs-option ${currentVal === '' ? 'active' : ''}" onclick="selectCSOption('${csId}', '', '${placeholder}')">${placeholder}</div>`;
  optionsArr.forEach(opt => {
    html += `<div class="cs-option ${String(currentVal) === String(opt.val) ? 'active' : ''}" onclick="selectCSOption('${csId}', '${opt.val}', '${opt.text}')">${opt.text}</div>`;
  });
  cso.innerHTML = html;
  const cs = document.getElementById(csId);
  if (cs) {
    const selected = optionsArr.find(x => String(x.val) === String(currentVal));
    cs.querySelector('.cs-selected').textContent = selected ? selected.text : placeholder;
    const inp = cs.querySelector('input');
    if (inp) inp.value = currentVal;
  }
}

window.clearFilters = function () {
  const search = document.getElementById('searchInput');
  if (search) search.value = '';

  const setCS = (id, text) => {
    const cs = document.getElementById(id);
    if (!cs) return;
    cs.querySelector('.cs-selected').textContent = text;
    const inp = cs.querySelector('input');
    if (inp) inp.value = '';
  };

  setCS('cs-dept', 'Bütün şöbələr');
  setCS('cs-sec', 'Bütün sektorlar');
  setCS('cs-pos', 'Bütün vəzifələr');

  filterEmployees();
};

function updateFilters() {
  const q = document.getElementById('searchInput') ? document.getElementById('searchInput').value : '';
  const df = document.getElementById('deptFilter'), sf = document.getElementById('secFilter'), pf = document.getElementById('posFilter');
  const dv = df ? df.value : '', sv = sf ? sf.value : '', pv = pf ? pf.value : '';

  const clearBtn = document.getElementById('clearFiltersBtn');
  if (clearBtn) {
    clearBtn.style.display = (q || dv || sv || pv) ? 'inline-flex' : 'none';
  }

  // Populate departments
  renderCSOptions('cs-dept', 'Bütün şöbələr', domains.departments.map(d => ({ val: d.id, text: d.name })), dv);

  // Populate sectors (cascade based on dept)
  let availableSectors = domains.sectors;
  if (dv) {
    availableSectors = domains.sectors.filter(s => String(s.dept_id) === String(dv));
  }
  renderCSOptions('cs-sec', 'Bütün sektorlar', availableSectors.map(s => ({ val: s.id, text: s.name })), sv);

  // Populate positions (cascade based on sector/dept from employees data)
  let availablePositions = domains.positions;
  if (sv) {
    const posIdsInSector = employees.filter(e => String(e.sector_id) === String(sv) && e.position_id).map(e => String(e.position_id));
    availablePositions = domains.positions.filter(p => posIdsInSector.includes(String(p.id)));
  } else if (dv) {
    const posIdsInDept = employees.filter(e => String(e.dept_id) === String(dv) && e.position_id).map(e => String(e.position_id));
    availablePositions = domains.positions.filter(p => posIdsInDept.includes(String(p.id)));
  }
  renderCSOptions('cs-pos', 'Bütün vəzifələr', availablePositions.map(p => ({ val: p.id, text: p.name })), pv);
}

function compareNamesAlphabetically(a, b) {
  return employeeNameCollator.compare(
    String(a.name || '').trim().normalize('NFC'),
    String(b.name || '').trim().normalize('NFC')
  );
}

function searchNameRank(employee, query) {
  const name = String(employee.name || '').normalize('NFC').trim().toLocaleUpperCase('az');
  const q = query.normalize('NFC').trim().toLocaleUpperCase('az');
  if (name.startsWith(q)) return 0;
  if (matchesSearch(employee.name, query)) return 1;
  return 2;
}

function getFiltered() {
  const raw = document.getElementById('searchInput').value;
  const q = raw ? raw.trim() : '';
  const d = document.getElementById('deptFilter').value;
  const s = document.getElementById('secFilter') ? document.getElementById('secFilter').value : '';
  const p = document.getElementById('posFilter').value;
  const list = employees.filter(e => {
    let ok = true;
    if (q) {
      if (searchField === 'all') {
        ok = [e.name, e.email, e.dept_name, e.sector_name, e.position_name, e.room, e.car_plate, e.intphone, e.mobile].some(f => matchesSearch(f, q));
      } else {
        let key = searchField;
        if (key === 'dept') key = 'dept_name';
        if (key === 'sektor') key = 'sector_name';
        if (key === 'position') key = 'position_name';
        ok = matchesSearch(e[key], q);
      }
    }
    return ok && (!d || String(e.dept_id) === String(d)) && (!s || String(e.sector_id) === String(s)) && (!p || String(e.position_id) === String(p));
  });
  if (q && (searchField === 'all' || searchField === 'name')) {
    return list.sort((a, b) =>
      searchNameRank(a, q) - searchNameRank(b, q) || compareNamesAlphabetically(a, b)
    );
  }
  const leadershipDept = getRehberlikDept();
  const leadership = [];
  const remaining = [];
  list.forEach(employee => {
    const position = String(employee.position_name || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('az');
    const isLeadEngineer = position.includes('APARICI MÜHƏNDİS');
    const isLeadership = leadershipDept && String(employee.dept_id) === String(leadershipDept.id) && !isLeadEngineer;
    (isLeadership ? leadership : remaining).push(employee);
  });
  remaining.sort(compareNamesAlphabetically);
  return [...leadership, ...remaining];
}

function toggleSearchFieldDD(event) {
  if (event) event.stopPropagation();
  const dd = document.getElementById('searchFieldDD');
  if (dd) dd.classList.toggle('open');
}

function setSearchField(field, label, placeholder) {
  searchField = field;
  const lbl = document.getElementById('searchFieldLabel');
  if (lbl) lbl.textContent = label;
  document.querySelectorAll('.sfd-opt').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');
  const inp = document.getElementById('searchInput');
  if (inp) { inp.placeholder = placeholder; inp.focus(); }
  const dd = document.getElementById('searchFieldDD');
  if (dd) dd.classList.remove('open');
  filterEmployees();
}

function renderCards(list) {
  const g = document.getElementById('cardGrid');
  if (!list.length) {
    g.innerHTML = `<div class="empty-wrap"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><h3>Məlumat tapılmadı</h3><p>Fərqli axtarış sözü sınayın</p></div>`;
    return;
  }
  g.innerHTML = list.map((e, i) => {
    const bg = departmentGradient(e.dept_name);
    const delay = `animation-delay:${i * 0.04}s`;
    const isRehberlik = Number(e.dept_id) === 1 || (e.dept_name && e.dept_name.toLocaleUpperCase('az').includes('RƏHBƏRL'));
    return `<div class="emp-card" style="${delay}" onclick="openView(${e.id})">
      <div class="card-banner" style="background:${bg}"></div>
      <div class="card-top">
        <div class="emp-avatar" style="background:${bg}">${initials(e.name)}</div>
        <div style="min-width: 0; flex: 1;">
          <div class="emp-name">${e.name}</div>
          <div class="emp-pos">${e.position_name || '—'}</div>
          <span class="dept-chip" title="Şöbə: ${e.dept_name || '—'}">Şöbə: ${e.dept_name || '—'}</span>
          ${e.sector_name ? `<span class="dept-chip" title="Sektor: ${e.sector_name}" style="background:rgba(16,185,129,0.1); color:var(--success); margin-left:4px">Sektor: ${e.sector_name}</span>` : ''}
        </div>
      </div>
      <div class="card-body">
        <div class="info-row"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg><span class="card-email-line"><span>Email:</span>${renderEmailWithCopy(e.email)}</span></div>
        <div class="info-row"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg><span>Daxili: <strong>${e.intphone || '-'}</strong></span></div>
        <div class="info-row"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg><span>Mobil: <strong>${e.mobile || '-'}</strong></span></div>
      </div>
      <div class="card-footer">
        <span class="room-chip"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>Otaq ${e.room || '-'}</span>
        <div class="card-acts">
          ${portalUserRole === 'admin' ? `
          <button class="act-btn" title="Redəktə" onclick="event.stopPropagation();openEdit(${e.id})"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
          ${!isRehberlik ? `<button class="act-btn red" title="Sil" onclick="event.stopPropagation();openDeleteModal(${e.id})"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : ''}
          ` : `
          <button class="act-btn" title="Redəktə Sorğusu" ${isRehberlik ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="event.stopPropagation(); if (!${isRehberlik}) openEdit(${e.id})"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
          ${!isRehberlik ? `<button class="act-btn red" title="Silinmə Sorğusu Göndər" onclick="event.stopPropagation(); openDeleteModal(${e.id})"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : ''}
          `}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderTable(list) {
  const tb = document.getElementById('tableBody');
  if (!list.length) { tb.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#94A3B8">Məlumat tapılmadı</td></tr>`; return; }
  tb.innerHTML = list.map(e => {
    const isRehberlik = Number(e.dept_id) === 1 || (e.dept_name && e.dept_name.toLocaleUpperCase('az').includes('RƏHBƏRL'));
    return `<tr>
    <td><span class="t-avatar" style="background:${departmentGradient(e.dept_name)}">${initials(e.name)}</span>${e.name}</td>
    <td>${e.position_name || '—'}</td>
    <td><span class="dept-chip" style="margin:0">${e.dept_name || '—'}</span></td>
    <td>${e.sector_name || '—'}</td>
    <td>${e.email && e.email !== 'null' ? renderEmailWithCopy(e.email) : '—'}</td>
    <td>${e.intphone || '—'}</td>
    <td>${e.mobile || '—'}</td>
    <td>${e.room || '—'}</td>
    <td style="text-align:right">
      <div class="card-acts" style="justify-content:flex-end">
        <button class="act-btn" onclick="openView(${e.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
        <button class="act-btn" title="${portalUserRole === 'admin' ? 'Redəktə' : 'Redəktə Sorğusu'}" ${portalUserRole !== 'admin' && isRehberlik ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="if (portalUserRole === 'admin' || !${isRehberlik}) openEdit(${e.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
        ${portalUserRole === 'admin' ? `
        ${!isRehberlik ? `<button class="act-btn red" title="Sil" onclick="openDeleteModal(${e.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : ''}
        ` : `
        ${!isRehberlik ? `<button class="act-btn red" title="Silinmə Sorğusu Göndər" onclick="openDeleteModal(${e.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : ''}
        `}
      </div>
    </td>
  </tr>`;
  }).join('');
}

const ORG_ROLE_LABELS = {
  director: 'Direktor',
  'director-deputy': 'Direktor Müavini',
  'dept-head': 'Şöbə Müdiri',
  'dept-deputy': 'Şöbə Müdiri Müavini',
  'sector-head': 'Sektor Müdiri',
  staff: 'Əməkdaş'
};

function getEmployeeRole(emp) {
  const p = (emp.position_name || '').toLocaleUpperCase('az');
  if (p.includes('DİREKTOR') && p.includes('MÜAVİN')) return 'director-deputy';
  if (p.includes('DİREKTOR')) return 'director';
  if (p.includes('ŞÖBƏ MÜDİR') && p.includes('MÜAVİN')) return 'dept-deputy';
  if (p.includes('ŞÖBƏ MÜDİR')) return 'dept-head';
  if (p.includes('SEKTOR MÜDİR')) return 'sector-head';
  if (p.includes('MÜAVİN') && !p.includes('SEKTOR')) return 'dept-deputy';
  return 'staff';
}

function orgAvatarBg(role, deptGradient) {
  if (role === 'director') return 'linear-gradient(135deg,#1E293B 0%,#0F172A 55%,#334155 100%)';
  if (role === 'director-deputy') return 'linear-gradient(135deg,#1E3A5F,#2563EB)';
  if (role === 'dept-head') return 'linear-gradient(135deg,#3730A3,#4F46E5)';
  if (role === 'dept-deputy') return 'linear-gradient(135deg,#475569,#64748B)';
  if (role === 'sector-head') return 'linear-gradient(135deg,#047857,#10B981)';
  return deptGradient || 'linear-gradient(135deg,#64748B,#94A3B8)';
}

function renderOrgPerson(emp, role, deptGradient) {
  return `
    <div class="org-person org-person--${role}" onclick="openView(${emp.id})" title="Profilə bax">
      <span class="org-person-badge">${ORG_ROLE_LABELS[role]}</span>
      
      <div class="org-person-name">${emp.name}</div>
    </div>`;
}

function renderOrgStaffList(staffList, deptGradient, label) {
  if (!staffList.length) return '';
  return `
    <div class="org-staff-section">
      <button type="button" class="org-staff-label" onclick="toggleOrgStaff(this, event)" title="Siyahını aç / bağla">
        <span class="org-staff-chevron">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
        </span>
        <span class="org-staff-title">${label}</span>
        <span class="org-staff-count">${staffList.length} nəfər</span>
      </button>
      <div class="org-staff-list">
        ${staffList.map(emp => `
          <div class="org-staff-row" onclick="openView(${emp.id})" title="Profilə bax">
            <span class="org-staff-row-name">${emp.name}</span>
            <span class="org-staff-row-pos">${emp.position_name || 'Əməkdaş'}</span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderOrgSectorBlock(sector, deptEmps, excludeIds, deptGradient, deptId) {
  const secEmps = deptEmps.filter(e =>
    String(e.sector_id) === String(sector.id) && !excludeIds.has(String(e.id))
  );
  const leader = secEmps.find(e => getEmployeeRole(e) === 'sector-head');
  const staff = secEmps.filter(e => !leader || String(e.id) !== String(leader.id));
  const sectorKey = `${deptId}-${sector.id}`;
  const isOpen = orgExpandedSectors.has(sectorKey);

  return `
    <section class="org-sector-block ${isOpen ? 'open' : ''}" data-sector-key="${sectorKey}">
      <button type="button" class="org-sector-head" onclick="toggleOrgSector('${sectorKey}', event)">
        <span class="org-sector-chevron">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
        </span>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16" style="margin-right:6px; opacity:0.6;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
        <h4>${sector.name}</h4>
        <span class="org-sector-count">${secEmps.length} nəfər</span>
      </button>
      <div class="org-sector-body">
        ${leader ? `<div class="org-sector-leader">${renderOrgPerson(leader, 'sector-head', deptGradient)}</div>` : ''}
        ${staff.length
      ? renderOrgStaffList(staff, deptGradient, 'Sektor əməkdaşları')
      : (!leader ? '<p class="org-empty-note">Bu sektorda əməkdaş qeydiyyatdan keçməyib</p>' : '')}
      </div>
    </section>`;
}

function getDeptEmployeeCount(deptId) {
  return employees.filter(e =>
    String(e.dept_id) === String(deptId) && getEmployeeRole(e) !== 'director'
  ).length;
}

function renderOrgDeptPanel(dept, isActive) {
  const deptEmps = employees.filter(e =>
    String(e.dept_id) === String(dept.id) && getEmployeeRole(e) !== 'director'
  ).sort(compareNamesAlphabetically);
  const manager = deptEmps.find(e => getEmployeeRole(e) === 'dept-head');
  const deputies = deptEmps.filter(e => getEmployeeRole(e) === 'dept-deputy');
  const excludeIds = new Set([manager, ...deputies].filter(Boolean).map(e => String(e.id)));
  const deptSectors = domains.sectors.filter(s => String(s.dept_id) === String(dept.id)).sort(compareNamesAlphabetically);
  const deptGradient = departmentGradient(dept.name);

  const deptDirectStaff = deptEmps.filter(e =>
    !e.sector_id &&
    !excludeIds.has(String(e.id)) &&
    getEmployeeRole(e) !== 'sector-head'
  );

  const sectorsHtml = deptSectors.map(sec =>
    renderOrgSectorBlock(sec, deptEmps, excludeIds, deptGradient, dept.id)
  ).join('');

  return `
    <article class="org-dept-panel ${isActive ? 'active' : ''}" data-dept-id="${dept.id}" id="org-dept-${dept.id}">
      <header class="org-dept-header">
        
        <div class="org-dept-meta">
          <h3>${dept.name}</h3>
          <p>${deptEmps.length} əməkdaş${deptSectors.length ? ` · ${deptSectors.length} sektor` : ''}</p>
        </div>
      </header>

      <div class="org-leadership-row">
        ${manager
      ? renderOrgPerson(manager, 'dept-head', deptGradient)
      : '<div class="org-person org-person--vacant"><span class="org-person-badge">Şöbə Müdiri</span><div class="org-vacant-text">Təyin edilməyib</div></div>'}
        ${deputies.length
      ? deputies.map(dep => renderOrgPerson(dep, 'dept-deputy', deptGradient)).join('')
      : '<div class="org-person org-person--vacant org-person--vacant-deputy"><span class="org-person-badge">Şöbə Müdiri Müavini</span><div class="org-vacant-text">Təyin edilməyib</div></div>'}
      </div>

      ${deptSectors.length ? `<div class="org-sectors-wrap">${sectorsHtml}</div>` : ''}
      ${renderOrgStaffList(deptDirectStaff, deptGradient, 'Birbaşa şöbə əməkdaşları')}
    </article>`;
}

function getFilteredOrgDepts() {
  const q = orgSearchQuery.trim();
  return domains.departments.filter(dept => {
    if (!q || matchesSearch(dept.name, q)) return true;
    const deptSectors = domains.sectors.filter(s => String(s.dept_id) === String(dept.id));
    return deptSectors.some(s => matchesSearch(s.name, q));
  }).sort(compareNamesAlphabetically);
}

window.filterOrgView = function (query) {
  orgSearchQuery = query || '';
  const filtered = getFilteredOrgDepts();
  if (filtered.length && (!orgSelectedDeptId || !filtered.some(d => String(d.id) === String(orgSelectedDeptId)))) {
    orgSelectedDeptId = filtered[0].id;
  }
  renderDepts();
};

window.selectOrgDept = function (deptId) {
  if (String(orgSelectedDeptId) === String(deptId)) return;
  orgSelectedDeptId = deptId;

  // 1. Update active state in sidebar nav
  const navItems = document.querySelectorAll('.org-nav-item');
  navItems.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-dept-id') === String(deptId));
  });

  // 2. Update active state in mobile custom select
  const mobileOpts = document.querySelectorAll('.org-mobile-custom-select-option');
  mobileOpts.forEach(opt => {
    opt.classList.toggle('selected', opt.getAttribute('data-dept-id') === String(deptId));
  });
  const triggerText = document.querySelector('.org-mobile-custom-select-trigger-text');
  const targetDept = domains.departments.find(d => String(d.id) === String(deptId));
  if (triggerText && targetDept) triggerText.textContent = targetDept.name;

  // 3. Switch active panel smoothly without DOM re-creation
  const currentActive = document.querySelector('.org-dept-panel.active');
  const targetPanel = document.getElementById(`org-dept-${deptId}`);
  if (targetPanel) {
    if (currentActive && currentActive !== targetPanel) {
      currentActive.classList.remove('active');
    }
    targetPanel.classList.add('active');
  } else {
    renderDepts();
  }

  // 4. Smoothly adjust scroll ONLY if user was scrolled deep below the top of departments
  const layout = document.querySelector('.org-layout');
  if (layout) {
    const rect = layout.getBoundingClientRect();
    const topOffset = 76; // topbar height + comfortable padding
    if (rect.top < 0) {
      const targetScroll = window.scrollY + rect.top - topOffset;
      window.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }
};

window.toggleOrgStaff = function (btn, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const section = btn.closest('.org-staff-section');
  if (section) {
    section.classList.toggle('open');
  }
};

window.toggleOrgSector = function (sectorKey, event) {
  event.stopPropagation();
  if (orgExpandedSectors.has(sectorKey)) orgExpandedSectors.delete(sectorKey);
  else orgExpandedSectors.add(sectorKey);
  const block = document.querySelector(`[data-sector-key="${sectorKey}"]`);
  if (block) block.classList.toggle('open', orgExpandedSectors.has(sectorKey));
};

window.orgExpandAllSectors = function () {
  document.querySelectorAll('.org-sector-block').forEach(el => {
    const key = el.dataset.sectorKey;
    if (key) orgExpandedSectors.add(key);
    el.classList.add('open');
  });
  document.querySelectorAll('.org-staff-section').forEach(el => {
    el.classList.add('open');
  });
};

window.orgCollapseAllSectors = function () {
  orgExpandedSectors.clear();
  document.querySelectorAll('.org-sector-block').forEach(el => {
    el.classList.remove('open');
  });
  document.querySelectorAll('.org-staff-section').forEach(el => {
    el.classList.remove('open');
  });
};

// Find the Rəhbərlik department by name (case-insensitive)
function getRehberlikDept() {
  return domains.departments.find(d =>
    d.name.toLocaleUpperCase('az').includes('RƏHBƏRL') ||
    d.name.toLocaleUpperCase('az').includes('REHBERL')
  ) || null;
}

function renderDepts() {
  const container = document.getElementById('deptsContent');
  if (!container) return;

  // Rəhbərlik department employees
  const rehberlikDept = getRehberlikDept();
  const rehberlikEmps = rehberlikDept
    ? employees.filter(e => String(e.dept_id) === String(rehberlikDept.id))
    : employees.filter(e => getEmployeeRole(e) === 'director' || getEmployeeRole(e) === 'director-deputy');

  const directors = rehberlikEmps.filter(e => getEmployeeRole(e) === 'director');
  const directorDeputies = rehberlikEmps.filter(e => getEmployeeRole(e) === 'director-deputy');
  const mgmtOtherStaff = rehberlikEmps.filter(e => {
    const r = getEmployeeRole(e);
    return r !== 'director' && r !== 'director-deputy';
  });

  // Exclude Rəhbərlik from the departments list
  const allFilteredDepts = getFilteredOrgDepts();
  const filteredDepts = rehberlikDept
    ? allFilteredDepts.filter(d => String(d.id) !== String(rehberlikDept.id))
    : allFilteredDepts;
  const sectorCount = domains.sectors.length;

  if (!orgSelectedDeptId && filteredDepts.length) {
    orgSelectedDeptId = filteredDepts[0].id;
  }
  if (orgSelectedDeptId && filteredDepts.length && !filteredDepts.some(d => String(d.id) === String(orgSelectedDeptId))) {
    orgSelectedDeptId = filteredDepts[0].id;
  }

  let html = `
    <div class="org-stats">
      <div class="org-stat"><strong>${directors.length}</strong><span>Direktor</span></div>
      <div class="org-stat"><strong>${domains.departments.length}</strong><span>Şöbə</span></div>
      <div class="org-stat"><strong>${sectorCount}</strong><span>Sektor</span></div>
      <div class="org-stat"><strong>${employees.length}</strong><span>Cəmi əməkdaş</span></div>
    </div>`;

  html += `
    <section class="org-tier org-tier--director">
      <div class="org-tier-head">
        <span class="org-tier-line"></span>
        <h2>İdarəetmə heyəti</h2>
        <span class="org-tier-line"></span>
      </div>

      <!-- Tier 1: Director -->
      <div class="org-director-stage">
        ${directors.length
      ? directors.map(d => renderOrgPerson(d, 'director')).join('')
      : `<div class="org-director-placeholder">
               <div class="org-director-placeholder-title">KADASTR VƏ YERQURULUŞU LAYİHƏ-TƏDQİQAT MƏRKƏZİ</div>
               <div class="org-director-placeholder-sub">Direktor vəzifəsi hələ təyin edilməyib</div>
             </div>`}
      </div>

      <!-- Tier 2: Deputy Directors -->
      ${directorDeputies.length ? `
      <div class="org-deputy-stage">
        <div class="org-tier-connector"></div>
        <div class="org-deputies-row">
          ${directorDeputies.map(d => renderOrgPerson(d, 'director-deputy')).join('')}
        </div>
      </div>` : ''}

      <!-- Tier 3: Remaining Rəhbərlik staff -->
      ${mgmtOtherStaff.length ? renderOrgStaffList(mgmtOtherStaff, null, 'Rəhbərlik əməkdaşları') : ''}

    </section>`;

  if (filteredDepts.length) {
    html += `
      <section class="org-tier org-tier--departments">
        <div class="org-tier-head">
          <span class="org-tier-line"></span>
          <h2>Şöbələr və Sektorlar</h2>
          <span class="org-tier-line"></span>
        </div>
        <div class="org-layout">
          <aside class="org-sidebar">
            <div class="org-sidebar-title">Şöbələr <span>${filteredDepts.length}</span></div>
            
            <div class="org-mobile-custom-select" onclick="this.classList.toggle('open')">
              <div class="org-mobile-custom-select-trigger">
                <span class="org-mobile-custom-select-trigger-text">${filteredDepts.find(d => String(d.id) === String(orgSelectedDeptId))?.name || (filteredDepts[0]?.name || 'Şöbə seçin')}</span>
                <svg class="org-mobile-custom-select-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
              <div class="org-mobile-custom-select-options">
                ${filteredDepts.map(dept => `
                  <div class="org-mobile-custom-select-option ${String(dept.id) === String(orgSelectedDeptId) ? 'selected' : ''}" data-dept-id="${dept.id}" onclick="event.stopPropagation(); selectOrgDept('${dept.id}')">
                    <span class="org-nav-name">${dept.name}</span>
                    <span class="org-nav-count">${getDeptEmployeeCount(dept.id)}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <nav class="org-nav">
              ${filteredDepts.map(dept => `
                <button type="button" class="org-nav-item ${String(dept.id) === String(orgSelectedDeptId) ? 'active' : ''}" data-dept-id="${dept.id}"
                  onclick="selectOrgDept('${dept.id}')">
                  <span class="org-nav-name">${dept.name}</span>
                  <span class="org-nav-count">${getDeptEmployeeCount(dept.id)}</span>
                </button>
              `).join('')}
            </nav>
          </aside>
          <main class="org-main">
            ${filteredDepts.map(dept => renderOrgDeptPanel(dept, String(dept.id) === String(orgSelectedDeptId))).join('')}
          </main>
        </div>
      </section>`;
  } else if (domains.departments.length) {
    html += `<div class="org-empty-state"><p>Axtarışa uyğun şöbə tapılmadı.</p></div>`;
  } else {
    html += `<div class="org-empty-state"><p>Heç bir şöbə əlavə edilməyib. Domainlər bölməsindən şöbə yarada bilərsiniz.</p></div>`;
  }

  container.innerHTML = html;
}

function toggleDeptCollapse(el) {
  // legacy noop
}
window.toggleDeptCollapse = toggleDeptCollapse;

let searchRenderTimer = null;

function render({ searchOnly = false } = {}) {
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
  if (!searchOnly) updateFilters();
  const list = getFiltered();
  updateStats(list);
  if (currentView === 'card') renderCards(list);
  else renderTable(list);
  if (currentPage === 'departments') renderDepts();
}
function filterEmployees() { render(); }

function scheduleSearch() {
  clearTimeout(searchRenderTimer);
  const hasFilter = ['searchInput', 'deptFilter', 'secFilter', 'posFilter']
    .some(id => document.getElementById(id)?.value);
  const clearBtn = document.getElementById('clearFiltersBtn');
  if (clearBtn) clearBtn.style.display = hasFilter ? 'inline-flex' : 'none';
  // Keep repeated key presses responsive; rebuild results after a brief pause.
  searchRenderTimer = setTimeout(() => render({ searchOnly: true }), 180);
}

function setView(v) {
  currentView = v;
  render({ searchOnly: true });
  document.getElementById('cardGrid').classList.toggle('hidden', v === 'table');
  document.getElementById('tableWrap').classList.toggle('active', v === 'table');
  document.getElementById('cardViewBtn').classList.toggle('active', v === 'card');
  document.getElementById('tableViewBtn').classList.toggle('active', v === 'table');
}

function toggleAdminNavDropdown(event) {
  event?.stopPropagation();
  const dropdown = document.getElementById('adminNavDropdown');
  if (dropdown) dropdown.classList.toggle('open');
}

function closeAdminNavDropdown() {
  const dropdown = document.getElementById('adminNavDropdown');
  if (dropdown) dropdown.classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#adminNavDropdown')) {
    closeAdminNavDropdown();
  }
});

window.toggleAdminNavDropdown = toggleAdminNavDropdown;
window.closeAdminNavDropdown = closeAdminNavDropdown;

async function setPage(p) {
  currentPage = p;
  document.getElementById('directoryPage').style.display = p === 'directory' ? '' : 'none';
  document.getElementById('departmentsPage').style.display = p === 'departments' ? '' : 'none';
  document.getElementById('meetingsPage').style.display = p === 'meetings' ? '' : 'none';
  document.getElementById('requestsPage').style.display = p === 'requests' ? '' : 'none';
  document.getElementById('domainsPage').style.display = p === 'domains' ? '' : 'none';
  document.getElementById('importPage').style.display = p === 'import' ? '' : 'none';

  const searchBox = document.getElementById('searchBox');
  if (searchBox) {
    searchBox.style.display = p === 'directory' ? '' : 'none';
  }

  const addBtn = document.getElementById('addBtn');
  if (addBtn) {
    addBtn.style.display = p === 'directory' ? '' : 'none';
  }

  if (p !== 'directory') {
    closeModal('formModal');
  }

  closeAdminNavDropdown();
  const isAdminPage = ['requests', 'domains', 'import'].includes(p);
  const adminDropdownBtn = document.getElementById('navAdminDropdown');
  if (adminDropdownBtn) {
    adminDropdownBtn.classList.toggle('active', isAdminPage);
  }

  document.getElementById('navDirectory').classList.toggle('active', p === 'directory');
  document.getElementById('navDepartments').classList.toggle('active', p === 'departments');
  const navMeetings = document.getElementById('navMeetings');
  if (navMeetings) navMeetings.classList.toggle('active', p === 'meetings');
  document.getElementById('navRequests').classList.toggle('active', p === 'requests');
  document.getElementById('navDomains').classList.toggle('active', p === 'domains');
  document.getElementById('navImport').classList.toggle('active', p === 'import');

  if (p === 'departments') renderDepts();
  if (p === 'meetings') await initMeetingsPage();
  if (p === 'requests') await fetchRequestsPageData();
  if (p === 'domains') renderDomainsPage();
}

function openView(id) {
  const e = employees.find(x => String(x.id) === String(id)); if (!e) return;
  const isRehberlik = Number(e.dept_id) === 1 || (e.dept_name && e.dept_name.toLocaleUpperCase('az').includes('RƏHBƏRL'));
  document.getElementById('viewModalBody').innerHTML = `
    <div class="profile-banner">
      <div class="profile-avatar-lg" style="background:${departmentGradient(e.dept_name)}">${initials(e.name)}</div>
      <div>
        <div class="profile-name">${e.name}</div>
        <div class="profile-pos">${e.position_name || '—'}</div>
        <span class="dept-chip" style="margin-top:8px">Şöbə: ${e.dept_name || '—'}</span>
        ${e.sector_name ? `<span class="dept-chip" style="margin-top:8px; background:rgba(16,185,129,0.1); color:var(--success); margin-left:4px">Sektor: ${e.sector_name}</span>` : ''}
      </div>
    </div>
    <div class="info-section">
      <div class="info-section-title">Əlaqə Məlumatları</div>
      ${e.email && e.email !== 'null' ? `<div class="info-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg><div><div class="info-item-label">Email</div><div class="info-item-value">${renderEmailWithCopy(e.email)}</div></div></div>` : ''}
      ${e.intphone ? `<div class="info-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg><div><div class="info-item-label">Daxili Tel.</div><div class="info-item-value">${e.intphone}</div></div></div>` : ''}
      ${e.mobile ? `<div class="info-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg><div><div class="info-item-label">Mobil</div><div class="info-item-value">${e.mobile}</div></div></div>` : ''}
      ${e.room ? `<div class="info-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg><div><div class="info-item-label">Otaq Nömrəsi</div><div class="info-item-value">${e.room}</div></div></div>` : ''}
      ${e.car_plate ? `<div class="info-item"><svg viewBox="0 0 24 24" fill="currentColor" style="opacity:0.75"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg><div><div class="info-item-label">Maşın Nömrəsi</div><div class="info-item-value">${formatCarPlate(e.car_plate)}</div></div></div>` : ''}
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      ${portalUserRole === 'admin' ? `
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="closeModal('viewModal');openEdit(${e.id})">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        Redəktə et
      </button>
      ${!isRehberlik ? `
      <button class="btn" style="justify-content:center;background:#FEF2F2;color:#EF4444;border:1px solid #FCA5A5;padding:0 18px;font-weight:600" onclick="closeModal('viewModal');openDeleteModal(${e.id})" title="Bazadan sil">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        Sil
      </button>` : ''}
      ` : `
      <button class="btn" style="flex:1;justify-content:center;background:#F0F4FF;color:var(--accent);border:1px solid var(--accent); ${isRehberlik ? 'opacity: 0.5; cursor: not-allowed;' : ''}" ${isRehberlik ? 'disabled' : ''} onclick="closeModal('viewModal'); if (!${isRehberlik}) openEdit(${e.id})">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        Redəktə Sorğusu
      </button>
      ${!isRehberlik ? `
      <button class="btn" style="justify-content:center;background:#FEF2F2;color:#EF4444;border:1px solid #FCA5A5;padding:0 18px;font-weight:600" onclick="closeModal('viewModal');openDeleteModal(${e.id})" title="Silinmə Sorğusu Göndər">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        Silinmə Sorğusu
      </button>` : ''}
      `}
    </div>
  `;
  document.getElementById('viewModal').classList.add('open');
}

function openAddModal() {
  if (currentPage !== 'directory') return;
  editingId = null;
  editRequestMode = false;
  editRequestOriginalData = null;
  const isAdmin = portalUserRole === 'admin';
  document.getElementById('formTitle').textContent = isAdmin ? 'Yeni Əməkdaş' : 'Yeni Əməkdaş Sorğusu';
  const saveBtn = document.getElementById('saveEmpBtn');
  if (saveBtn) {
    if (isAdmin) {
      saveBtn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Saxla';
    } else {
      saveBtn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg> Sorğu Göndər';
    }
  }
  ['fName', 'fRoom', 'fEmail', 'fIntPhone', 'fMobile', 'fCarPlate'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });

  // Reset select elements
  setFormCS('fcs-fDept', '', 'Şöbə seçin');
  setFormCS('fcs-fSector', '', 'Sektor seçin');
  onFormDeptChange();

  document.getElementById('formModal').classList.add('open');
}

function openEdit(id) {
  const e = employees.find(x => String(x.id) === String(id)); if (!e) return;
  if (portalUserRole !== 'admin' && Number(e.dept_id) === 1) {
    showToast('Rəhbərlik şöbəsindəki əməkdaşlar redaktə edilə bilməz!', 'error');
    return;
  }
  editingId = id;

  if (portalUserRole !== 'admin') {
    editRequestMode = true;
    editRequestOriginalData = { ...e };
    document.getElementById('formTitle').textContent = 'Redəktə Sorğusu — ' + e.name;
    const saveBtn = document.getElementById('saveEmpBtn');
    if (saveBtn) saveBtn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg> Sorğu Göndər';
  } else {
    editRequestMode = false;
    editRequestOriginalData = null;
    document.getElementById('formTitle').textContent = 'Məlumatları Yenilə';
    const saveBtn = document.getElementById('saveEmpBtn');
    if (saveBtn) saveBtn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Saxla';
  }

  // ── Populate selects without cascade side-effects ──
  const deptId = e.dept_id ? String(e.dept_id) : '';
  const sectorId = e.sector_id ? String(e.sector_id) : '';
  const positionId = e.position_id ? String(e.position_id) : '';

  // 1. Dept — always has all departments as options (filtered for non-admin)
  let depts = domains.departments;
  if (portalUserRole !== 'admin') {
    depts = depts.filter(d => String(d.id) !== '1');
  }
  populateFormCS('fcs-fDept', depts.map(d => ({ val: d.id, text: d.name })), 'Şöbə seçin', true);
  setFormCS('fcs-fDept', deptId, 'Şöbə seçin');

  // 2. Sector — options filtered by dept (empty if no dept)
  const sectorOpts = deptId
    ? domains.sectors.filter(s => String(s.dept_id) === deptId)
    : [];
  const sectorContainer = document.getElementById('fcs-fSector');
  if (sectorContainer) {
    if (deptId) sectorContainer.classList.remove('disabled');
    else sectorContainer.classList.add('disabled');
  }
  populateFormCS('fcs-fSector', sectorOpts.map(s => ({ val: s.id, text: s.name })), 'Sektor seçin', true);
  setFormCS('fcs-fSector', sectorId, 'Sektor seçin');

  // 3. Position — show all positions (filtered for non-admin)
  let normalPos = domains.positions || [];
  if (portalUserRole !== 'admin') {
    normalPos = normalPos.filter(p => {
      const id = String(p.id);
      return id !== '1' && id !== '2' && id !== '3';
    });
  }
  const posData = normalPos.map(p => ({ val: p.id, text: p.name }));

  populateFormCS('fcs-fPosition', posData, 'Vəzifə seçin', true);
  setFormCS('fcs-fPosition', positionId, 'Vəzifə seçin');

  // Text fields
  document.getElementById('fName').value = e.name || '';
  document.getElementById('fRoom').value = e.room || '';
  document.getElementById('fEmail').value = e.email || '';
  document.getElementById('fIntPhone').value = e.intphone || '';

  const mDigits = (e.mobile || '').replace(/\D/g, '');
  let localM = '';
  if (mDigits.startsWith('994') && mDigits.length >= 11) localM = mDigits.slice(3, 12);
  else if (mDigits.startsWith('0') && mDigits.length === 10) localM = mDigits.slice(1, 10);
  else if (mDigits.length === 9) localM = mDigits;
  else localM = (e.mobile || '').replace(/^\+994\s*/, '');

  if (localM.length === 9) {
    document.getElementById('fMobile').value = `${localM.slice(0, 2)}-${localM.slice(2, 5)}-${localM.slice(5, 7)}-${localM.slice(7, 9)}`;
  } else {
    document.getElementById('fMobile').value = localM;
  }

  const fCarPlate = document.getElementById('fCarPlate'); if (fCarPlate) fCarPlate.value = e.car_plate || '';

  document.getElementById('formModal').classList.add('open');
}

// Populate cascading form dropdowns
function populateFormDomains() {
  const fDept = document.getElementById('fDept');
  if (!fDept) return;

  let depts = domains.departments;
  if (portalUserRole !== 'admin') {
    depts = depts.filter(d => String(d.id) !== '1');
  }

  populateFormCS('fcs-fDept', depts.map(d => ({ val: d.id, text: d.name })), 'Şöbə seçin', true);
  onFormDeptChange();
}

window.onFormDeptChange = function () {
  const deptId = document.getElementById('fDept').value;
  const fSector = document.getElementById('fSector');
  const sectorContainer = document.getElementById('fcs-fSector');
  if (!fSector) return;

  if (!deptId) {
    // If no department is selected, disable sector selection
    if (sectorContainer) sectorContainer.classList.add('disabled');
    populateFormCS('fcs-fSector', [], 'Sektor seçin', false);
    setFormCS('fcs-fSector', '', 'Sektor seçin');
  } else {
    // If department is selected, enable sector selection
    if (sectorContainer) sectorContainer.classList.remove('disabled');
    const sectorsData = domains.sectors.filter(s => String(s.dept_id) === String(deptId));
    populateFormCS('fcs-fSector', sectorsData.map(s => ({ val: s.id, text: s.name })), 'Sektor seçin', true);
    setFormCS('fcs-fSector', '', 'Sektor seçin');
  }
  onFormSectorChange();
};

window.onFormSectorChange = function () {
  const sectorId = document.getElementById('fSector').value;
  const deptId = document.getElementById('fDept').value;
  const fPosition = document.getElementById('fPosition');
  if (!fPosition) return;

  const currentPosVal = fPosition.value;
  let posData = [];

  // Build positions dropdown options based on dept/sector selection
  let normalPos = domains.positions || [];

  if (portalUserRole !== 'admin') {
    normalPos = normalPos.filter(p => {
      const id = String(p.id);
      return id !== '1' && id !== '2' && id !== '3';
    });
  }

  posData = normalPos.map(p => ({ val: p.id, text: p.name }));

  populateFormCS('fcs-fPosition', posData, 'Vəzifə seçin', true);
  setFormCS('fcs-fPosition', currentPosVal || '', 'Vəzifə seçin');
};

window.onFormPositionChange = function () {
  const posId = document.getElementById('fPosition').value;
  const fSector = document.getElementById('fSector');
  if (!posId) return;

  const pos = domains.positions.find(x => String(x.id) === String(posId));
  if (pos) {
    const name = (pos.name || '').toLocaleUpperCase('az');
    if (!name.includes('SEKTOR MÜDİR') && fSector && fSector.value) {
      setFormCS('fcs-fSector', '', 'Sektor seçin');
    }
  }
};

async function saveEmployee() {
  const saveBtn = document.getElementById('saveEmpBtn');
  if (saveBtn && saveBtn.disabled) return; // already running, ignore double-click
  if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.6'; }

  const name = document.getElementById('fName').value.trim();
  const position_id = document.getElementById('fPosition').value;
  const dept_id = document.getElementById('fDept').value;
  const sector_id = document.getElementById('fSector').value;
  const email = document.getElementById('fEmail').value.trim();
  const intPhone = document.getElementById('fIntPhone').value.trim();
  const mobileRaw = document.getElementById('fMobile').value.trim();
  const mobile = mobileRaw ? formatMobileNumber(mobileRaw) : null;
  const room = document.getElementById('fRoom').value.trim();
  const fCarPlate = document.getElementById('fCarPlate');
  const car_plate = fCarPlate ? formatCarPlate(fCarPlate.value.trim()) : '';

  const enableBtn = () => { if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = ''; } };

  if (!name || !position_id || !dept_id) {
    showToast('Ad Soyad, Şöbə və Vəzifə mütləq seçilməlidir!', 'error');
    enableBtn();
    return;
  }

  const data = { name, position_id, dept_id: dept_id || null, sector_id: sector_id || null, email: email || '', intphone: intPhone || null, mobile: mobile || null, room: room || null, car_plate: car_plate || null };

  if (editRequestMode && editingId) {
    await saveEditRequest(data);
    enableBtn();
    return;
  }

  // Non-admin trying to add a completely NEW employee → send as approval request
  if (portalUserRole !== 'admin' && !editingId) {
    await saveNewEmployeeRequest(data);
    enableBtn();
    return;
  }

  try {
    if (editingId) {
      const res = await fetch(`${API_URL}/employees/${editingId}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify(data) });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.details || 'Update failed');
      }
      const updated = await res.json();
      const idx = employees.findIndex(x => String(x.id) === String(editingId));
      if (idx !== -1) employees[idx] = updated;
      showToast('Məlumatlar yenilendi ✓');
      closeModal('formModal');
      render();
    } else {
      const res = await fetch(`${API_URL}/employees`, { method: 'POST', headers: HEADERS, body: JSON.stringify(data) });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.details || 'Insert failed');
      }
      const created = await res.json();
      employees.push(created);
      showToast('Əməkdaş əlavə edildi ✓');
      closeModal('formModal');
      render();
    }
  } catch (err) {
    showToast(err.message || 'Yadda saxlayarkən xəta baş verdi', 'error');
    console.error(err);
    await fetchEmployees();
  } finally {
    enableBtn();
  }
}


/* ─── USER EDIT REQUEST ─── */
async function saveEditRequest(newData) {
  try {
    const oldD = editRequestOriginalData || {};
    const fieldKeys = ['name', 'position_id', 'dept_id', 'sector_id', 'email', 'intphone', 'mobile', 'room', 'car_plate'];

    const hasAnyChange = fieldKeys.some(k => {
      const oldVal = (oldD[k] !== undefined && oldD[k] !== null) ? String(oldD[k]).trim() : '';
      const newVal = (newData[k] !== undefined && newData[k] !== null) ? String(newData[k]).trim() : '';
      return oldVal !== newVal;
    });

    if (!hasAnyChange) {
      showToast('Heç bir məlumatı dəyişmədiniz! Boş sorğu göndərilə bilməz.', 'error');
      return;
    }

    const payload = {
      employee_id: editingId,
      employee_name: editRequestOriginalData ? editRequestOriginalData.name : '',
      old_data: editRequestOriginalData,
      new_data: newData,
      status: 'pending',
      requested_by: portalUserName
    };
    const res = await fetch(`${API_URL}/employee_edit_requests`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Request failed');
    }
    showToast('Redəktə sorğunuz adminə göndərildi ✓');
    closeModal('formModal');
    editRequestMode = false;
    editRequestOriginalData = null;
    await fetchPendingRequestsCount();
  } catch (err) {
    showToast(err.message || 'Sorğu göndərilərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

/* ─── NEW EMPLOYEE REQUEST (User → Admin) ─── */
async function saveNewEmployeeRequest(data) {
  try {
    const payload = {
      employee_id: null,
      employee_name: data.name,
      old_data: null,
      new_data: data,
      status: 'pending',
      requested_by: portalUserName,
      request_type: 'new_employee'
    };
    const res = await fetch(`${API_URL}/employee_edit_requests`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Request failed');
    showToast('Yeni əməkdaş sorğunuz adminə göndərildi ✓');
    closeModal('formModal');
    await fetchPendingRequestsCount();
  } catch (err) {
    showToast('Sorğu göndərilərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

function openDeleteModal(id) {
  const emp = employees.find(x => String(x.id) === String(id));
  if (!emp) return;
  const isRehberlik = Number(emp.dept_id) === 1 || (emp.dept_name && emp.dept_name.toLocaleUpperCase('az').includes('RƏHBƏRL'));
  if (isRehberlik) {
    showToast('Rəhbərlik şöbəsindəki əməkdaşlar silinə bilməz!', 'error');
    return;
  }

  document.getElementById('deleteTargetEmpId').value = id;
  document.getElementById('deleteReasonInput').value = '';

  const isAdmin = portalUserRole === 'admin';
  document.getElementById('deleteModalTitle').textContent = isAdmin ? 'Əməkdaşı Sil' : 'Silinmə Sorğusu Göndər';
  document.getElementById('deleteModalDesc').innerHTML = isAdmin
    ? `<strong>"${emp.name}"</strong> adlı əməkdaşı bazadan tamamilə silmək istəyirsiniz?`
    : `<strong>"${emp.name}"</strong> adlı əməkdaşın sistemdən silinməsi üçün adminə sorğu göndərmək istəyirsiniz?`;

  const actionBtn = document.getElementById('confirmDeleteActionBtn');
  actionBtn.textContent = isAdmin ? 'Bəli, Sil' : 'Sorğu Göndər';

  document.getElementById('deleteConfirmModal').classList.add('open');
}

async function executeDeleteAction() {
  const id = document.getElementById('deleteTargetEmpId').value;
  const reason = document.getElementById('deleteReasonInput').value.trim();
  const btn = document.getElementById('confirmDeleteActionBtn');
  if (btn) btn.disabled = true;

  try {
    if (portalUserRole === 'admin') {
      await deleteEmp(id, reason);
    } else {
      await requestDeleteEmp(id, reason);
    }
    closeModal('deleteConfirmModal');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function requestDeleteEmp(id, reason = '') {
  const emp = employees.find(x => String(x.id) === String(id));
  try {
    const payload = {
      employee_id: id,
      employee_name: emp ? emp.name : '',
      old_data: emp || {},
      new_data: { reason: reason },
      status: 'pending',
      requested_by: portalUserName,
      request_type: 'delete'
    };

    const res = await fetch(`${API_URL}/employee_edit_requests`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Request failed');
    }

    showToast('Əməkdaşın silinməsi üçün sorğunuz adminə göndərildi ✓');
    closeModal('viewModal');
    await fetchPendingRequestsCount();
  } catch (err) {
    showToast(err.message || 'Silinmə sorğusu göndərilərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

async function deleteEmp(id, reason = '') {
  try {
    const res = await fetch(`${API_URL}/employees/${id}`, { method: 'DELETE', headers: HEADERS });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Delete failed');
    }
    employees = employees.filter(x => String(x.id) !== String(id));
    closeModal('viewModal');
    showToast('Əməkdaş bazadan uğurla silindi');
    render();
    if (currentPage === 'departments') renderDepts();
  } catch (err) {
    showToast(err.message || 'Silinərkən xəta baş verdi', 'error');
    console.error(err);
    await fetchEmployees();
  }
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/* ─── CUSTOM ELEGANT CONFIRM MODAL (Replaces browser confirm()) ─── */
let appConfirmResolve = null;

function showAppConfirm({ title = 'Təsdiq', message = '', okText = 'Bəli, Təsdiqlə', cancelText = 'Ləğv et', type = 'danger' }) {
  return new Promise((resolve) => {
    appConfirmResolve = resolve;
    document.getElementById('appConfirmTitle').textContent = title;
    document.getElementById('appConfirmMessage').textContent = message;

    const okBtn = document.getElementById('appConfirmOkBtn');
    okBtn.textContent = okText;

    const iconWrap = document.getElementById('appConfirmIconWrap');
    const icon = document.getElementById('appConfirmIcon');

    if (type === 'danger') {
      iconWrap.style.background = 'rgba(239, 68, 68, 0.1)';
      iconWrap.style.color = '#EF4444';
      okBtn.style.background = '#EF4444';
      icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />';
    } else if (type === 'success') {
      iconWrap.style.background = 'rgba(16, 185, 129, 0.1)';
      iconWrap.style.color = 'var(--success)';
      okBtn.style.background = 'var(--success)';
      icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />';
    } else {
      iconWrap.style.background = 'rgba(79, 70, 229, 0.1)';
      iconWrap.style.color = 'var(--accent)';
      okBtn.style.background = 'var(--accent)';
      icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';
    }

    document.getElementById('appConfirmModal').classList.add('open');
  });
}

function closeAppConfirm(result) {
  closeModal('appConfirmModal');
  if (appConfirmResolve) {
    appConfirmResolve(result);
    appConfirmResolve = null;
  }
}
window.closeAppConfirm = closeAppConfirm;
window.showAppConfirm = showAppConfirm;

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  const msgEl = document.getElementById('toastMsg');
  const dotEl = t.querySelector('.toast-dot');

  if (msgEl) msgEl.textContent = msg;

  if (type === 'error') {
    t.classList.add('error');
    if (dotEl) {
      dotEl.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"/></svg>`;
    }
  } else {
    t.classList.remove('error');
    if (dotEl) {
      dotEl.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>`;
    }
  }

  t.classList.add('show');
  if (t._timeout) clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 3000);
}


/* ─── EDIT REQUEST SYSTEM (ADMIN PANEL) ─── */
async function fetchPendingRequestsCount() {
  if (portalUserRole !== 'admin') return;
  try {
    const res = await fetch(`${API_URL}/employee_edit_requests/count?status=pending`, { headers: HEADERS });
    if (!res.ok) return;
    const data = await res.json();
    const count = data.count || 0;
    const badge = document.getElementById('reqBadge');
    const dropBadge = document.getElementById('adminDropdownBadge');
    if (badge) {
      if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
      else { badge.style.display = 'none'; }
    }
    if (dropBadge) {
      if (count > 0) { dropBadge.textContent = count; dropBadge.style.display = 'inline-flex'; }
      else { dropBadge.style.display = 'none'; }
    }
  } catch (err) {
    console.error(err);
  }
}

async function fetchRequestsPageData() {
  try {
    const editRes = await fetch(`${API_URL}/employee_edit_requests?status=pending`, { headers: HEADERS });
    if (!editRes.ok) throw new Error('Fetch edit requests failed');
    const allPending = await editRes.json();

    // Split by request type
    const editRequests = allPending.filter(r => !r.request_type || r.request_type === 'edit');
    const deleteRequests = allPending.filter(r => r.request_type === 'delete');
    const newEmpRequests = allPending.filter(r => r.request_type === 'new_employee');

    const usersRes = await fetch(`${API_URL}/portal_users`, { headers: HEADERS });
    if (!usersRes.ok) throw new Error('Fetch users failed');
    const users = await usersRes.json();

    renderEditRequestsTable(editRequests);
    renderDeleteRequestsTable(deleteRequests);
    renderNewEmployeeRequestsTable(newEmpRequests);
    renderUsersTable(users);
  } catch (err) {
    showToast('Məlumatlar yüklənərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

function renderEditRequestsTable(list) {
  const tb = document.getElementById('editRequestsTableBody');
  if (!tb) return;
  if (!list || !list.length) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">Gözləyən məlumat dəyişikliyi sorğusu yoxdur</td></tr>`;
    return;
  }

  const getDeptName = (id) => { const d = domains.departments.find(x => String(x.id) === String(id)); return d ? d.name : '—'; };
  const getSectorName = (id) => { const s = domains.sectors.find(x => String(x.id) === String(id)); return s ? s.name : '—'; };
  const getPosName = (id) => { const p = domains.positions.find(x => String(x.id) === String(id)); return p ? p.name : '—'; };

  const getValLabel = (key, val) => {
    if (!val) return '—';
    if (key === 'dept_id') return getDeptName(val);
    if (key === 'sector_id') return getSectorName(val);
    if (key === 'position_id') return getPosName(val);
    return val;
  };

  tb.innerHTML = list.map(req => {
    const oldD = req.old_data || {};
    const newD = req.new_data || {};

    const fieldLabels = {
      name: 'Ad',
      position_id: 'Vəzifə', position: 'Vəzifə',
      dept_id: 'Şöbə', dept: 'Şöbə',
      sector_id: 'Sektor', sektor: 'Sektor',
      email: 'Email', intphone: 'Daxili Tel', mobile: 'Mobil', room: 'Otaq', car_plate: 'Maşın №'
    };

    const changes = Object.keys(fieldLabels).filter(k => {
      const oldV = String(oldD[k] || '');
      const newV = String(newD[k] || '');
      return oldV !== newV;
    });

    const changesHtml = changes.length
      ? changes.map(k => `<span style="display:inline-block;background:#FFF8E7;border:1px solid #F59E0B;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>${fieldLabels[k]}:</b> <s style="color:#999">${getValLabel(k, oldD[k])}</s> → <b style="color:var(--success)">${getValLabel(k, newD[k])}</b></span>`).join(' ')
      : '<em style="color:#999">Dəyişiklik yoxdur</em>';
    const dateStr = new Date(req.requested_at).toLocaleString('az-AZ');
    const newDataEncoded = encodeURIComponent(JSON.stringify(newD));
    return `<tr>
      <td><strong>${req.employee_name || '—'}</strong></td>
      <td>${changesHtml}</td>
      <td>${req.requested_by || '—'}</td>
      <td style="white-space:nowrap">${dateStr}</td>
      <td style="text-align:right">
        <div class="card-acts" style="justify-content:flex-end">
          <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;background:var(--success);box-shadow:none" onclick="approveEditRequest(${req.id})">Təsdiqlə</button>
          <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="rejectEditRequest(${req.id})">Rədd et</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderDeleteRequestsTable(list) {
  const tb = document.getElementById('deleteRequestsTableBody');
  if (!tb) return;
  if (!list || !list.length) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">Gözləyən əməkdaş silinməsi sorğusu yoxdur</td></tr>`;
    return;
  }

  const getDeptName = (id) => { const d = domains.departments.find(x => String(x.id) === String(id)); return d ? d.name : '—'; };
  const getPosName = (id) => { const p = domains.positions.find(x => String(x.id) === String(id)); return p ? p.name : '—'; };

  tb.innerHTML = list.map(req => {
    const oldD = req.old_data || {};
    const dateStr = new Date(req.requested_at).toLocaleString('az-AZ');
    const deptInfo = `${getPosName(oldD.position_id)} / ${getDeptName(oldD.dept_id)}`;
    const reasonText = (req.new_data && req.new_data.reason) ? req.new_data.reason : '—';
    return `<tr>
      <td><strong>${req.employee_name || oldD.name || '—'}</strong></td>
      <td><span style="display:inline-block;background:#FEF2F2;border:1px solid #FCA5A5;color:#B91C1C;border-radius:5px;padding:2px 7px;font-size:12px;">${deptInfo}</span></td>
      <td style="max-width:200px;word-break:break-word"><span style="color:${reasonText !== '—' ? '#B91C1C' : '#94A3B8'};font-style:${reasonText !== '—' ? 'normal' : 'italic'}">${reasonText}</span></td>
      <td>${req.requested_by || '—'}</td>
      <td style="white-space:nowrap">${dateStr}</td>
      <td style="text-align:right">
        <div class="card-acts" style="justify-content:flex-end">
          <button class="btn" style="padding:6px 12px;font-size:12px;background:#EF4444;color:#fff;border:none" onclick="approveDeleteRequest(${req.id})">Silinməni Təsdiqlə</button>
          <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px" onclick="rejectEditRequest(${req.id})">Rədd et</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function approveDeleteRequest(reqId) {
  const ok = await showAppConfirm({
    title: 'Silinmə Sorğusunu Təsdiqlə',
    message: 'Bu silinmə sorğusunu təsdiqləmək istəyirsiniz? Əməkdaş bazadan tamamilə silinəcək.',
    okText: 'Bəli, Təsdiqlə',
    type: 'danger'
  });
  if (!ok) return;

  try {
    const r = await fetch(`${API_URL}/employee_edit_requests/${reqId}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ status: 'approved', resolved_at: new Date().toISOString() })
    });
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || 'Approval failed');
    }
    showToast('Silinmə sorğusu təsdiqləndi, əməkdaş bazadan silindi ✓');
    await fetchRequestsPageData();
    await fetchPendingRequestsCount();
    await fetchEmployees();
  } catch (err) {
    showToast('Təsdiqləyərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

function renderNewEmployeeRequestsTable(list) {
  const tb = document.getElementById('newEmpRequestsTableBody');
  if (!tb) return;
  if (!list || !list.length) {
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">Gözləyən yeni əməkdaş əlavəsi sorğusu yoxdur</td></tr>`;
    return;
  }

  const getDeptName = (id) => { const d = domains.departments.find(x => String(x.id) === String(id)); return d ? d.name : '—'; };
  const getSectorName = (id) => { const s = domains.sectors.find(x => String(x.id) === String(id)); return s ? s.name : '—'; };
  const getPosName = (idVal) => {
    if (!idVal) return '—';
    const p = domains.positions.find(x => String(x.id) === String(idVal));
    return p ? p.name : '—';
  };

  const getOtherDetailsHtml = (d) => {
    const details = [];
    if (d.email) details.push(`<span style="display:inline-block;background:#F0FDF4;border:1px solid #10B981;color:#047857;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Email:</b> ${d.email}</span>`);
    if (d.mobile) details.push(`<span style="display:inline-block;background:#EFF6FF;border:1px solid #3B82F6;color:#1D4ED8;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Mobil:</b> ${d.mobile}</span>`);
    if (d.intphone) details.push(`<span style="display:inline-block;background:#F5F3FF;border:1px solid #8B5CF6;color:#6D28D9;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Daxili:</b> ${d.intphone}</span>`);
    if (d.room) details.push(`<span style="display:inline-block;background:#FFF7ED;border:1px solid #F97316;color:#C2410C;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Otaq:</b> ${d.room}</span>`);
    if (d.car_plate) details.push(`<span style="display:inline-block;background:#F1F5F9;border:1px solid #64748B;color:#334155;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Maşın №:</b> ${d.car_plate}</span>`);
    return details.length ? details.join(' ') : '<em style="color:#999">—</em>';
  };

  tb.innerHTML = list.map(req => {
    const d = req.new_data || {};
    const dateStr = new Date(req.requested_at).toLocaleString('az-AZ');
    return `<tr>
      <td><strong>${d.name || '—'}</strong></td>
      <td>${getPosName(d.position_id)}</td>
      <td><span class="dept-chip" style="margin:0">${getDeptName(d.dept_id)}</span></td>
      <td>${getSectorName(d.sector_id)}</td>
      <td>${getOtherDetailsHtml(d)}</td>
      <td>${req.requested_by || '—'}</td>
      <td style="white-space:nowrap">${dateStr}</td>
      <td style="text-align:right">
        <div class="card-acts" style="justify-content:flex-end">
          <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;background:var(--success);box-shadow:none" onclick="approveNewEmployeeRequest(${req.id})">Təsdiqlə</button>
          <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="rejectEditRequest(${req.id})">Rədd et</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderUsersTable(users) {
  const tb = document.getElementById('usersTableBody');
  if (!tb) return;
  if (!users || !users.length) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">İstifadəçi tapılmadı</td></tr>`;
    return;
  }
  tb.innerHTML = users.map(u => {
    let roleBadge = '';
    if (u.role === 'admin') {
      roleBadge = '<span class="dept-chip" style="margin:0;background:rgba(79,70,229,0.1);color:var(--accent);">Admin (Tam Hüquq)</span>';
    } else if (u.role === 'meeting_admin') {
      roleBadge = '<span class="dept-chip" style="margin:0;background:rgba(59,130,246,0.1);color:#1D4ED8;">İclas İdarəçisi</span>';
    } else {
      roleBadge = '<span class="dept-chip" style="margin:0;background:rgba(16,185,129,0.1);color:var(--success);">İstifadəçi</span>';
    }

    const isMainAdmin = u.username.toLowerCase() === 'admin';

    return `<tr>
      <td><strong>${u.username}</strong></td>
      <td>${u.email || '—'}</td>
      <td>${roleBadge}</td>
      <td style="letter-spacing:2px;color:var(--text-muted)">••••••••</td>
      <td style="text-align:right">
        <div style="display: inline-flex; gap: 4px; justify-content: flex-end;">
          <button class="act-btn" style="display:inline-flex" onclick="openDirectPassModal(${u.id}, '${u.username}')" title="Şifrəni Dəyiş">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1m0 0a2 2 0 114 0m-4 0v5"/></svg>
          </button>
          ${!isMainAdmin ? `
            <button class="act-btn red" style="display:inline-flex" onclick="deletePortalUser(${u.id}, '${u.username}')" title="İstifadəçini Sil">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          ` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function approveNewEmployeeRequest(reqId) {
  const ok = await showAppConfirm({
    title: 'Yeni Əməkdaş Əlavəsi',
    message: 'Bu yeni əməkdaş sorğusunu təsdiqləyirsiniz? Əməkdaş dərhal sistemə əlavə ediləcək.',
    okText: 'Təsdiq et',
    type: 'success'
  });
  if (!ok) return;

  try {
    const r = await fetch(`${API_URL}/employee_edit_requests/${reqId}`, {
      method: 'PATCH', headers: HEADERS,
      body: JSON.stringify({ status: 'approved', resolved_at: new Date().toISOString() })
    });
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || 'Approval failed');
    }
    showToast('Sorğu təsdiqlendi, əməkdaş əlavə edildi ✓');
    await fetchRequestsPageData();
    await fetchPendingRequestsCount();
    await fetchEmployees();
  } catch (err) {
    showToast('Təsdiqləyərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

async function approveEditRequest(reqId) {
  const ok = await showAppConfirm({
    title: 'Redəktə Sorğusunu Təsdiqlə',
    message: 'Bu redəktə sorğusunu təsdiqləyirsiniz? Əməkdaşın dəyişdirilmiş məlumatları yenilənəcək.',
    okText: 'Təsdiq et',
    type: 'success'
  });
  if (!ok) return;

  try {
    const r = await fetch(`${API_URL}/employee_edit_requests/${reqId}`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify({ status: 'approved', resolved_at: new Date().toISOString() })
    });
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || 'Approval failed');
    }
    showToast('Sorğu təsdiqləndi, məlumatlar yeniləndi ✓');
    await fetchRequestsPageData();
    await fetchPendingRequestsCount();
    await fetchEmployees();
  } catch (err) {
    showToast('Təsdiqləyərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

async function rejectEditRequest(reqId) {
  const ok = await showAppConfirm({
    title: 'Sorğunu Rədd Et',
    message: 'Bu sorğunu rədd etmək istədiyinizə əminsiniz?',
    okText: 'Bəli, Rədd et',
    type: 'danger'
  });
  if (!ok) return;

  try {
    const res = await fetch(`${API_URL}/employee_edit_requests/${reqId}`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify({ status: 'rejected', resolved_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error('Reject failed');
    showToast('Sorğu rədd edildi');
    await fetchRequestsPageData();
    await fetchPendingRequestsCount();
  } catch (err) {
    showToast('Rədd edilərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

function openDirectPassModal(userId, username) {
  document.getElementById('directPassUserId').value = userId;
  document.getElementById('directPassTitle').textContent = `${username} — Şifrəni Dəyiş`;
  document.getElementById('directPassInput').value = '';
  document.getElementById('directPassModal').classList.add('open');
}

async function saveDirectPassword() {
  const userId = document.getElementById('directPassUserId').value;
  const newPass = document.getElementById('directPassInput').value.trim();
  if (!newPass) { showToast('Yeni şifrəni daxil edin!', 'error'); return; }

  try {
    const res = await fetch(`${API_URL}/portal_users/${userId}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ password: newPass }) });
    if (!res.ok) throw new Error('Update password failed');

    showToast('Şifrə birbaşa yeniləndi ✓');
    closeModal('directPassModal');
    await fetchRequestsPageData();
  } catch (err) {
    showToast('Şifrə yenilənərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

function openAddPortalUserModal() {
  const modal = document.getElementById('addPortalUserModal');
  if (!modal) return;

  const getDeptNameSafe = (id) => {
    const d = (domains.departments || []).find(x => String(x.id) === String(id));
    return d ? d.name : '';
  };

  // Populate employees dropdown
  const empOpts = (employees || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'az'))
    .map(e => {
      const deptName = getDeptNameSafe(e.dept_id);
      return { val: String(e.id), text: deptName ? `${e.name} (${deptName})` : e.name };
    });

  populateFormCS('fcs-pUserEmp', empOpts, 'Əməkdaş seçin...', true);
  setFormCS('fcs-pUserEmp', '', 'Əməkdaş seçin...');

  document.getElementById('pUserEmpId').value = '';
  document.getElementById('pUsername').value = '';
  document.getElementById('pUserEmail').value = '';
  document.getElementById('pUserPassword').value = '';
  document.getElementById('pUserRole').value = 'meeting_admin';

  modal.classList.add('open');
}

function onSelectPortalUserEmp() {
  const empId = document.getElementById('pUserEmpId').value;
  if (!empId) return;

  const emp = (employees || []).find(e => String(e.id) === String(empId));
  if (emp) {
    const nameInput = document.getElementById('pUsername');
    const emailInput = document.getElementById('pUserEmail');
    if (nameInput) nameInput.value = emp.name;
    if (emailInput) emailInput.value = emp.email || '';
    if (!document.getElementById('pUserPassword').value) {
      generateRandomUserPass();
    }
  }
}

function generateRandomUserPass() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 6; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  document.getElementById('pUserPassword').value = pass;
}

async function savePortalUser() {
  const username = (document.getElementById('pUsername').value || '').trim();
  const email = (document.getElementById('pUserEmail').value || '').trim();
  const password = (document.getElementById('pUserPassword').value || '').trim();
  const role = document.getElementById('pUserRole').value || 'meeting_admin';
  const saveBtn = document.getElementById('btnSavePortalUser');

  if (!username) {
    showToast('İstifadəçi adı daxil edilməlidir!', 'error');
    return;
  }
  if (!password) {
    showToast('Şifrə daxil edilməlidir!', 'error');
    return;
  }

  if (saveBtn) saveBtn.disabled = true;

  try {
    const res = await fetch(`${API_URL}/portal_users`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ username, email, password, role })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'İstifadəçi əlavə edilərkən xəta baş verdi');
    }

    showToast(`"${username}" adlı səlahiyyətli uğurla təyin edildi ✓`);
    closeModal('addPortalUserModal');
    await fetchRequestsPageData();
  } catch (err) {
    showToast(err.message || 'Xəta baş verdi', 'error');
    console.error(err);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deletePortalUser(id, username) {
  const ok = await showAppConfirm({
    title: 'Səlahiyyətlini Sil',
    message: `<strong>"${username}"</strong> adlı istifadəçinin sistemə və iclas idarəçiliyinə giriş icazəsini ləğv etmək istəyirsiniz?`,
    okText: 'Bəli, Sil',
    type: 'danger'
  });
  if (!ok) return;

  try {
    const res = await fetch(`${API_URL}/portal_users/${id}`, {
      method: 'DELETE',
      headers: HEADERS
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Silinmə uğursuz oldu');
    }

    showToast(`"${username}" adlı istifadəçi uğurla silindi ✓`);
    await fetchRequestsPageData();
  } catch (err) {
    showToast(err.message || 'Silinərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

window.openAddPortalUserModal = openAddPortalUserModal;
window.onSelectPortalUserEmp = onSelectPortalUserEmp;
window.generateRandomUserPass = generateRandomUserPass;
window.savePortalUser = savePortalUser;
window.deletePortalUser = deletePortalUser;

/* ─── DOMAIN MANAGEMENT SYSTEM (ADMIN PANEL) ─── */

function getDomainPosLinkType() {
  const el = document.querySelector('input[name="domainPosLinkType"]:checked');
  return el ? el.value : 'sector';
}

function setDomainPosLinkType(type) {
  const radio = document.querySelector(`input[name="domainPosLinkType"][value="${type}"]`);
  if (radio) radio.checked = true;
  updateDomainPosLinkUI();
}

window.onDomainPosLinkTypeChange = function () {
  updateDomainPosLinkUI();
};

function updateDomainPosLinkUI() {
  const linkGroup = document.getElementById('domainPosLinkTypeGroup');
  if (!linkGroup || linkGroup.style.display === 'none') return;
  const linkType = getDomainPosLinkType();
  document.getElementById('domainParentDeptGroup').style.display = linkType === 'dept' ? 'block' : 'none';
  document.getElementById('domainParentSectorGroup').style.display = linkType === 'sector' ? 'block' : 'none';
}

function populateDomainParentField(kind, options, placeholder) {
  const csId = kind === 'dept' ? 'fcs-domainDept' : 'fcs-domainSector';
  const csEl = document.getElementById(csId);
  if (csEl) {
    populateFormCS(csId, options, null, true);
    setFormCS(csId, '', placeholder);
    return;
  }
  const sel = document.getElementById(kind === 'dept' ? 'domainParentDeptSelect' : 'domainParentSectorSelect');
  if (sel && sel.tagName === 'SELECT') {
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      options.map(o => `<option value="${o.val}">${o.text}</option>`).join('');
    sel.value = '';
  }
}

function setDomainParentFieldValue(kind, val, placeholder) {
  const csId = kind === 'dept' ? 'fcs-domainDept' : 'fcs-domainSector';
  const csEl = document.getElementById(csId);
  const list = kind === 'dept' ? domains.departments : domains.sectors;
  const match = list.find(x => String(x.id) === String(val));
  if (csEl) {
    setFormCS(csId, val || '', match ? match.name : placeholder);
    return;
  }
  const sel = document.getElementById(kind === 'dept' ? 'domainParentDeptSelect' : 'domainParentSectorSelect');
  if (sel) sel.value = val || '';
}

function renderDomainsPage() {
  const deptTable = document.getElementById('domainDeptTableBody');
  if (deptTable) {
    deptTable.innerHTML = domains.departments.map(d => `
      <tr>
        <td><strong>${d.name}</strong></td>
        <td style="text-align:right">
          <div class="card-acts" style="justify-content:flex-end">
            <button class="act-btn" onclick="openEditDomainModal('dept', ${d.id}, '${d.name.replace(/'/g, "\\'")}')"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
            <button class="act-btn red" onclick="deleteDomain('dept', ${d.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  const sectorTable = document.getElementById('domainSectorTableBody');
  if (sectorTable) {
    sectorTable.innerHTML = domains.sectors.map(s => {
      const parentDept = domains.departments.find(d => String(d.id) === String(s.dept_id));
      return `
        <tr>
          <td><strong>${s.name}</strong></td>
          <td><span class="dept-chip" style="margin:0">${parentDept ? parentDept.name : '—'}</span></td>
          <td style="text-align:right">
            <div class="card-acts" style="justify-content:flex-end">
              <button class="act-btn" onclick="openEditDomainModal('sector', ${s.id}, '${s.name.replace(/'/g, "\\'")}', ${s.dept_id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
              <button class="act-btn red" onclick="deleteDomain('sector', ${s.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  const posTable = document.getElementById('domainPosTableBody');
  if (posTable) {
    const allSysPositions = ["DİREKTOR", "ŞÖBƏ MÜDİRİ", "ŞÖBƏ MÜDİRİ MÜAVİNİ", "SEKTOR MÜDİRİ"];

    posTable.innerHTML = domains.positions
      .filter(p => !allSysPositions.includes((p.name || '').toLocaleUpperCase('az')))
      .map(p => {
        const activeUsage = employees.filter(e => String(e.position_id) === String(p.id));
        const usedIn = [...new Set(activeUsage.map(e => e.sector_name ? `Sektor: ${e.sector_name}` : (e.dept_name ? `Şöbə: ${e.dept_name}` : '')).filter(Boolean))];
        const parentLabel = usedIn.length ? usedIn.join(', ') : 'İstifadə edilmir';
        const isSystem = allSysPositions.includes((p.name || '').toLocaleUpperCase('az'));
        return `
          <tr>
            <td><strong>${p.name}</strong></td>
            <td style="text-align:right">
              <div class="card-acts" style="justify-content:flex-end">
                ${isSystem ? `
                  <span title="Sistem vəzifəsi (redaktə edilə bilməz)" style="color:var(--text-muted); opacity:0.6; padding: 6px 12px; display:inline-flex; align-items:center; gap:4px; font-size:11px;">
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                    Kilidli
                  </span>
                ` : `
                  <button class="act-btn" onclick="openEditDomainModal('pos', ${p.id}, '${p.name.replace(/'/g, "\\'")}')"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
                  <button class="act-btn red" onclick="deleteDomain('pos', ${p.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                `}
              </div>
            </td>
          </tr>
        `;
      }).join('');
  }
}

window.openAddDomainModal = function (type) {
  document.getElementById('domainType').value = type;
  document.getElementById('domainEditId').value = '';
  document.getElementById('domainNameInput').value = '';

  const typeTitles = { dept: 'Yeni Şöbə', sector: 'Yeni Sektor', pos: 'Yeni Vəzifə' };
  document.getElementById('domainFormTitle').textContent = typeTitles[type] || 'Domain Əlavə Et';

  document.getElementById('domainParentDeptGroup').style.display = type === 'sector' ? 'block' : 'none';
  document.getElementById('domainParentSectorGroup').style.display = 'none';
  document.getElementById('domainPosLinkTypeGroup').style.display = 'none';

  if (type === 'sector') {
    populateDomainParentField('dept', domains.departments.map(d => ({ val: d.id, text: d.name })), 'Şöbə seçin');
  }

  document.getElementById('domainFormModal').classList.add('open');
};

window.openEditDomainModal = function (type, id, name, deptId, sectorId) {
  document.getElementById('domainType').value = type;
  document.getElementById('domainEditId').value = id;
  document.getElementById('domainNameInput').value = name;

  const typeTitles = { dept: 'Şöbəni Redaktə Et', sector: 'Sektoru Redaktə Et', pos: 'Vəzifəni Redaktə Et' };
  document.getElementById('domainFormTitle').textContent = typeTitles[type] || 'Domain Redaktə Et';

  document.getElementById('domainParentDeptGroup').style.display = type === 'sector' ? 'block' : 'none';
  document.getElementById('domainParentSectorGroup').style.display = 'none';
  document.getElementById('domainPosLinkTypeGroup').style.display = 'none';

  if (type === 'sector') {
    populateDomainParentField('dept', domains.departments.map(d => ({ val: d.id, text: d.name })), 'Şöbə seçin');
    setDomainParentFieldValue('dept', deptId, 'Şöbə seçin');
  }

  document.getElementById('domainFormModal').classList.add('open');
};

window.saveDomain = async function () {
  const type = document.getElementById('domainType').value;
  const id = document.getElementById('domainEditId').value;
  const name = document.getElementById('domainNameInput').value.trim();

  if (!name) { showToast('Ad sahəsi məcburidir!', 'error'); return; }

  let url = `${API_URL}/`;
  let method = id ? 'PATCH' : 'POST';
  let body = { name };

  if (type === 'dept') {
    url += `departments${id ? '/' + id : ''}`;
  } else if (type === 'sector') {
    url += `sectors${id ? '/' + id : ''}`;
    const selectedDept = document.getElementById('domainParentDeptSelect').value;
    if (!selectedDept) { showToast('Şöbə seçmək məcburidir!', 'error'); return; }
    body.dept_id = selectedDept;
  } else if (type === 'pos') {
    url += `positions${id ? '/' + id : ''}`;
  }

  try {
    const res = await fetch(url, {
      method,
      headers: HEADERS,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Uğursuz əməliyyat');
    }
    showToast('Uğurla yadda saxlanıldı ✓');
    closeModal('domainFormModal');
    await fetchDomains();
    await fetchEmployees();
    if (currentPage === 'domains') renderDomainsPage();
  } catch (err) {
    showToast(err.message || 'Xəta baş verdi', 'error');
    console.error(err);
  }
};

window.deleteDomain = async function (type, id) {
  if (!confirm('Bu domaini silmək istədiyinizə əminsiniz? Altındakı bütün əlaqəli məlumatlar da silinə bilər.')) return;

  let url = `${API_URL}/`;
  if (type === 'dept') url += `departments/${id}`;
  else if (type === 'sector') url += `sectors/${id}`;
  else if (type === 'pos') url += `positions/${id}`;

  try {
    const res = await fetch(url, { method: 'DELETE', headers: HEADERS });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Silinmə uğursuz oldu');
    }
    showToast('Uğurla silindi');
    await fetchDomains();
    await fetchEmployees();
    if (currentPage === 'domains') renderDomainsPage();
  } catch (err) {
    showToast(err.message || 'Silinərkən xəta baş verdi', 'error');
    console.error(err);
  }
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.org-mobile-custom-select')) {
    document.querySelectorAll('.org-mobile-custom-select.open').forEach(el => el.classList.remove('open'));
  }
});

window.clearAllData = async function (type) {
  const typeMap = {
    'employees': 'əməkdaşları',
    'departments': 'şöbələri',
    'sectors': 'sektorları',
    'positions': 'vəzifələri'
  };

  const typeName = typeMap[type] || 'məlumatları';
  if (!confirm(`DİQQƏT: Bütün ${typeName} bazadan həmişəlik silinəcək. Davam etmək istədiyinizə əminsiniz?`)) return;

  try {
    const res = await fetch(`${API_URL}/admin/clear/${type}`, { method: 'DELETE', headers: HEADERS });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Silinmə uğursuz oldu');
    }
    showToast(`Bütün ${typeName} uğurla silindi`);

    // Refresh data
    await fetchDomains();
    await fetchEmployees();
    if (currentPage === 'domains') renderDomainsPage();
    if (currentPage === 'directory') render();
  } catch (err) {
    showToast(err.message || 'Silinərkən xəta baş verdi', 'error');
    console.error(err);
  }
};

/* ─── IMPORT PAGE FUNCTIONS ─── */

// CSV şablonlarının strukturu
const CSV_TEMPLATES = {
  departments: {
    headers: ['id', 'name'],
    sample: [['1', 'Texniki Şöbə'], ['2', 'Maliyyə Şöbəsi']]
  },
  sectors: {
    headers: ['id', 'name', 'dept_id'],
    sample: [['1', 'Proqram Sektoru', '1'], ['2', 'Avadanlıq Sektoru', '1']]
  },
  positions: {
    headers: ['id', 'name'],
    sample: [['1', 'Mütəxəssis'], ['2', 'Aparıcı Mütəxəssis']]
  },
  employees: {
    headers: ['id', 'name', 'email', 'intphone', 'mobile', 'room', 'car_plate', 'dept_id', 'sector_id', 'position_id'],
    sample: [['1', 'Anar Həsənov', 'anar@kyltm.az', '1045', '050-123-45-67', '405', '10-AB-123', '1', '1', '1']]
  }
};

// Cədvəl adından UI suffix almaq
function tableKey(tableName) {
  const map = { departments: 'Dept', sectors: 'Sector', positions: 'Pos', employees: 'Emp' };
  return map[tableName] || '';
}

// Fayl seçildikdə
window.handleFileSelect = function (event, tableName) {
  const file = event.target.files[0];
  if (!file) return;
  processImportFile(file, tableName);
};

// Drag over
window.handleDragOver = function (event) {
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
};

// Drag leave
window.handleDragLeave = function (event) {
  event.currentTarget.classList.remove('drag-over');
};

// Drop
window.handleDrop = function (event, tableName) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.endsWith('.csv')) {
    showToast('Yalnız .csv formatında fayl qəbul edilir!', 'error');
    return;
  }
  processImportFile(file, tableName);
};

// CSV validasiyası
function validateTableRows(rows, tableName) {
  const errors = [];
  const errorMap = {};
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isDigitsOnly = (v) => /^\d+$/.test(String(v).trim());
  const hasLetter = (v) => /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u0500-\u052F\u018F\u0259\u01DD\u018F\u011F\u011E\u0131\u0130\u00F6\u00D6\u00FC\u00DC\u00E7\u00C7\u015F\u015E]/i.test(String(v));

  rows.forEach((r, idx) => {
    const rowNum = idx + 2; // +1 for 1-based, +1 for CSV header row

    const addErr = (col, msg) => {
      errors.push({ row: rowNum, col, message: msg });
      errorMap[`${idx}_${col}`] = msg;
    };

    if (tableName === 'departments') {
      const rawName = r.name || r['ŞÖBƏ'] || r['Şöbə'] || r['şöbə'];
      const rawId = r.id || r.NO || r.no;
      const name = rawName ? String(rawName).trim() : '';

      if (!name) {
        addErr('name', `Sətir ${rowNum}: 'name' (Şöbə adı) boş ola bilməz`);
      }
      if (rawId && !isDigitsOnly(rawId)) {
        addErr('id', `Sətir ${rowNum}: 'id' sütununda hərf və ya simvol ola bilməz (Daxil edilən: "${rawId}"). Yalnız tam rəqəm olmalıdır.`);
      }

    } else if (tableName === 'sectors') {
      const rawName = r.name || r['SEKTOR'] || r['Sektor'] || r['sektor'];
      const rawId = r.id || r.NO || r.no;
      const deptId = r.dept_id !== undefined ? String(r.dept_id).trim() : (r['deptId'] !== undefined ? String(r['deptId']).trim() : '');
      const name = rawName ? String(rawName).trim() : '';

      if (!name) {
        addErr('name', `Sətir ${rowNum}: 'name' (Sektor adı) boş ola bilməz`);
      }
      if (rawId && !isDigitsOnly(rawId)) {
        addErr('id', `Sətir ${rowNum}: 'id' sütununda hərf ola bilməz (Daxil edilən: "${rawId}"). Yalnız rəqəm olmalıdır.`);
      }
      if (!deptId) {
        addErr('dept_id', `Sətir ${rowNum}: 'dept_id' (Şöbə ID-si) məcburidir və boş ola bilməz`);
      } else if (!isDigitsOnly(deptId)) {
        addErr('dept_id', `Sətir ${rowNum}: 'dept_id' sütununda hərf və ya mətn ola bilməz (Daxil edilən: "${deptId}"). Yalnız şöbənin ID nömrəsi (rəqəm) olmalıdır.`);
      }

    } else if (tableName === 'positions') {
      const rawName = r.name || r['VƏZİFƏ'] || r['Vəzifə'] || r['vəzifə'];
      const rawId = r.id || r.NO || r.no;
      const name = rawName ? String(rawName).trim() : '';

      if (!name) {
        addErr('name', `Sətir ${rowNum}: 'name' (Vəzifə adı) boş ola bilməz`);
      }
      if (rawId && !isDigitsOnly(rawId)) {
        addErr('id', `Sətir ${rowNum}: 'id' sütununda hərf ola bilməz (Daxil edilən: "${rawId}"). Yalnız rəqəm olmalıdır.`);
      }

    } else if (tableName === 'employees') {
      const rawName = r.name || r['Ad'] || r['Ad Soyad'] || r['AD SOYAD'];
      const name = rawName ? String(rawName).trim() : '';
      const rawId = r.id ? String(r.id).trim() : '';
      const deptId = r.dept_id ? String(r.dept_id).trim() : '';
      const sectorId = r.sector_id ? String(r.sector_id).trim() : '';
      const positionId = r.position_id ? String(r.position_id).trim() : '';
      const email = r.email ? String(r.email).trim() : '';
      const intphone = r.intphone ? String(r.intphone).trim() : '';
      const mobile = r.mobile ? String(r.mobile).trim() : '';

      if (!name) {
        addErr('name', `Sətir ${rowNum}: 'name' (Əməkdaşın adı) boş ola bilməz`);
      }
      if (rawId && !isDigitsOnly(rawId)) {
        addErr('id', `Sətir ${rowNum}: 'id' sütununda hərf ola bilməz (Daxil edilən: "${rawId}"). Yalnız rəqəm olmalıdır.`);
      }
      if (deptId && !isDigitsOnly(deptId)) {
        addErr('dept_id', `Sətir ${rowNum}: 'dept_id' sütununda hərf və ya mətn ola bilməz (Daxil edilən: "${deptId}"). Yalnız şöbə ID-si (rəqəm) olmalıdır.`);
      }
      if (sectorId && !isDigitsOnly(sectorId)) {
        addErr('sector_id', `Sətir ${rowNum}: 'sector_id' sütununda hərf və ya mətn ola bilməz (Daxil edilən: "${sectorId}"). Yalnız sektor ID-si (rəqəm) olmalıdır.`);
      }
      if (positionId && !isDigitsOnly(positionId)) {
        addErr('position_id', `Sətir ${rowNum}: 'position_id' sütununda hərf və ya mətn ola bilməz (Daxil edilən: "${positionId}"). Yalnız vəzifə ID-si (rəqəm) olmalıdır.`);
      }
      if (email && !emailRegex.test(email)) {
        addErr('email', `Sətir ${rowNum}: 'email' formatı yanlışdır (Daxil edilən: "${email}"). Nümunə: ad@domen.az`);
      }
      if (intphone && hasLetter(intphone)) {
        addErr('intphone', `Sətir ${rowNum}: 'intphone' (daxili telefon) sütununda hərf ola bilməz (Daxil edilən: "${intphone}"). Yalnız rəqəm olmalıdır.`);
      }
      if (mobile) {
        if (hasLetter(mobile)) {
          addErr('mobile', `Sətir ${rowNum}: 'mobile' (mobil nömrə) sütununda hərf ola bilməz (Daxil edilən: "${mobile}"). Nümunə: 050-123-45-67 və ya 994502439132`);
        } else {
          // Normalize mobile number in row object for import and preview
          r.mobile = formatMobileNumber(mobile);
        }
      }
    }
  });

  return { isValid: errors.length === 0, errors, errorMap };
}

// Faylı oxuyub preview göstər
function processImportFile(file, tableName) {
  const key = tableKey(tableName);
  const reader = new FileReader();
  reader.onload = function (e) {
    const content = e.target.result;
    const rows = parseCsvText(content);
    if (!rows || rows.length === 0) {
      showToast('CSV faylı boş və ya oxuna bilən məlumat yoxdur!', 'error');
      return;
    }

    // Validasiya et
    const validation = validateTableRows(rows, tableName);

    // Dropzone-a rows və validasiya nəticəsini bağla
    const dropzoneEl = document.getElementById('dropzone' + key);
    if (dropzoneEl) {
      dropzoneEl._csvRows = rows;
      dropzoneEl._validation = validation;
    }

    // File info göstər
    const fileInfoEl = document.getElementById('fileInfo' + key);
    if (fileInfoEl) {
      if (validation.isValid) {
        fileInfoEl.innerHTML = `
          <div class="import-file-badge" style="background:#F0FDF4;border:1px solid #86EFAC;color:#166534">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
            </svg>
            <span><strong>${file.name}</strong> — ${rows.length} sətir tapıldı (Validasiyadan keçdi ✓)</span>
          </div>
        `;
      } else {
        fileInfoEl.innerHTML = `
          <div class="import-file-badge" style="background:#FEF2F2;border:1px solid #FCA5A5;color:#991B1B">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
            <span><strong>${file.name}</strong> — ${validation.errors.length} xəta tapıldı</span>
          </div>
          <div style="background:#FFF5F5;border:1px solid #FEB2B2;border-radius:8px;padding:10px 14px;margin-top:8px;font-size:12px">
            <div style="font-weight:700;color:#C53030;margin-bottom:6px;display:flex;align-items:center;gap:6px">
              <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              CSV-də xətalar var (İdxal etmək üçün xətaları düzəldin):
            </div>
            <ul style="margin:0;padding-left:18px;color:#9B2C2C;max-height:130px;overflow-y:auto;line-height:1.6">
              ${validation.errors.map(err => `<li><b>${err.message}</b></li>`).join('')}
            </ul>
          </div>
        `;
      }
      fileInfoEl.style.display = '';
    }

    // Preview göstər (ilk 10 sətir)
    const previewEl = document.getElementById('preview' + key);
    if (previewEl) {
      previewEl.innerHTML = buildPreviewTable(rows, 10, validation.errorMap);
      previewEl.style.display = '';
    }

    // Actions göstər
    const actionsEl = document.getElementById('actions' + key);
    if (actionsEl) {
      actionsEl.style.display = '';
      const importBtn = actionsEl.querySelector('.btn-primary');
      if (importBtn) {
        if (!validation.isValid) {
          importBtn.disabled = true;
          importBtn.style.opacity = '0.5';
          importBtn.style.cursor = 'not-allowed';
          importBtn.title = 'CSV-dəki xətalar düzəldilmədən idxal edilə bilməz';
        } else {
          importBtn.disabled = false;
          importBtn.style.opacity = '';
          importBtn.style.cursor = '';
          importBtn.title = '';
        }
      }
    }

    // Result sıfırla
    const resultEl = document.getElementById('result' + key);
    if (resultEl) resultEl.innerHTML = '';

    // Dropzone yeniləyin
    const dropzone = document.getElementById('dropzone' + key);
    if (dropzone) dropzone.classList.add('has-file');

    if (!validation.isValid) {
      showToast(`CSV-də ${validation.errors.length} xəta tapıldı!`, 'error');
    } else {
      showToast(`CSV yoxlanıldı: ${rows.length} sətir düzgündür ✓`);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// CSV mətn → [{col: val, ...}] massivi
function parseCsvText(content) {
  const lines = content.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (!vals.length) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = vals[idx] !== undefined ? vals[idx].trim() : '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Preview cədvəlini qur
function buildPreviewTable(rows, maxRows, errorMap = {}) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const displayRows = rows.slice(0, maxRows);
  const moreCount = rows.length - displayRows.length;

  let html = `<div class="import-preview-label">Önizləmə (ilk ${displayRows.length} sətir${moreCount > 0 ? ` + ${moreCount} daha` : ''}):</div>`;
  html += '<div class="import-preview-scroll"><table class="import-preview-table"><thead><tr>';
  headers.forEach(h => { html += `<th>${h}</th>`; });
  html += '</tr></thead><tbody>';
  displayRows.forEach((row, rIdx) => {
    html += '<tr>';
    headers.forEach(h => {
      const errKey = `${rIdx}_${h}`;
      const hasErr = !!errorMap[errKey];
      const cellStyle = hasErr ? 'style="background:#FEE2E2;color:#DC2626;font-weight:700;border:1px solid #EF4444;"' : '';
      const cellTitle = hasErr ? `title="${errorMap[errKey]}"` : '';
      html += `<td ${cellStyle} ${cellTitle}>${row[h] || ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// Import çalışdır
window.runImport = async function (tableName) {
  const key = tableKey(tableName);
  const dropzoneEl = document.getElementById('dropzone' + key);
  const rows = dropzoneEl ? dropzoneEl._csvRows : null;
  const validation = dropzoneEl ? dropzoneEl._validation : null;

  if (!rows || rows.length === 0) {
    showToast('İdxal üçün məlumat tapılmadı!', 'error');
    return;
  }

  if (validation && !validation.isValid) {
    showToast(`CSV-də ${validation.errors.length} xəta var, idxal edilə bilməz!`, 'error');
    return;
  }

  const resultEl = document.getElementById('result' + key);
  if (resultEl) {
    resultEl.innerHTML = `<div class="import-result-loading"><span class="import-spinner"></span> İdxal edilir... (${rows.length} sətir)</div>`;
  }

  // Düymələri deaktiv et
  const actionsEl = document.getElementById('actions' + key);
  const btns = actionsEl ? actionsEl.querySelectorAll('button') : [];
  btns.forEach(b => { b.disabled = true; });

  try {
    const res = await fetch(`${API_URL}/import/${tableName}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ rows })
    });
    const responseText = await res.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      if (res.status === 413) {
        throw new Error('Göndərilən məlumat serverin ölçü limitini keçir (HTTP 413).');
      }
      throw new Error('Server JSON cavabı qaytarmadı (HTTP ' + res.status + ').');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Serverin cavab formatı yanlışdır (HTTP ' + res.status + ').');
    }

    if (!res.ok) {
      const errDetails = data.details && Array.isArray(data.details)
        ? `<ul style="margin:6px 0 0 16px;padding:0;text-align:left;font-size:12px">${data.details.map(d => `<li>${d}</li>`).join('')}</ul>`
        : '';
      throw new Error((data.error || `HTTP ${res.status}`) + errDetails);
    }

    if (resultEl) {
      resultEl.innerHTML = `
        <div class="import-result-success">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
          </svg>
          <span>Uğurlu! <strong>${data.imported}</strong> sətir idxal edildi${data.skipped ? `, <strong>${data.skipped}</strong> ötürüldü` : ''}.</span>
        </div>
      `;
    }

    showToast(`${tableName} idxalı uğurla tamamlandı ✓`, 'success');

    // Domenləri və əməkdaşları yenilə
    await fetchDomains();
    if (tableName === 'employees') await fetchEmployees();

  } catch (err) {
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="import-result-error" style="display:block">
          <div style="display:flex;align-items:center;gap:6px">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
            <span><strong>İdxal xətası:</strong></span>
          </div>
          <div style="margin-top:4px">${err.message}</div>
        </div>
      `;
    }
    showToast('İdxal zamanı xəta baş verdi!', 'error');
    console.error('Import error:', err);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
};

// Import sıfırla
window.clearImport = function (tableName) {
  const key = tableKey(tableName);
  const dropzoneEl = document.getElementById('dropzone' + key);
  if (dropzoneEl) {
    dropzoneEl._csvRows = null;
    dropzoneEl._validation = null;
    dropzoneEl.classList.remove('has-file', 'drag-over');
  }
  ['fileInfo', 'preview', 'actions', 'result'].forEach(prefix => {
    const el = document.getElementById(prefix + key);
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
  });
  // File input sıfırla
  const fileInputMap = { Dept: 'fileDept', Sector: 'fileSector', Pos: 'filePos', Emp: 'fileEmp' };
  const fileInput = document.getElementById(fileInputMap[key]);
  if (fileInput) fileInput.value = '';
};

// Şablon yüklə
window.downloadTemplate = function (tableName) {
  const tpl = CSV_TEMPLATES[tableName];
  if (!tpl) return;

  const csvContent = [
    tpl.headers.join(','),
    ...tpl.sample.map(row => row.join(','))
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${tableName}_sablon.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${tableName} şablonu yükləndi ✓`, 'success');
};

// Bütün bazanı Export etmək
window.exportAllTables = async function () {
  const tables = ['departments', 'sectors', 'positions', 'employees'];
  showToast('Bütün cədvəllərin exportu başladılır...', 'success');

  for (const table of tables) {
    try {
      const res = await fetch(`${API_URL}/export/${table}`, { headers: HEADERS });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = getLocalTodayStr();
        a.download = `${table}_export_${date}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        console.error(`Export failed for ${table}:`, await res.text());
        showToast(`${table} cədvəlini export edərkən xəta oldu.`, 'error');
      }
    } catch (err) {
      console.error(`Export error for ${table}:`, err);
    }
    // Kiçik gecikmə ki, browser ardıcıl downloadları bloklamasın
    await new Promise(resolve => setTimeout(resolve, 800));
  }
};


/* ─── MEETINGS (İCLAS OTAĞI) SYSTEM ─── */
let currentMeetingDate = new Date();
function getLocalTodayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
let selectedMeetingDateStr = getLocalTodayStr();
let currentMonthMeetings = [];

async function initMeetingsPage() {
  const canManageMeetings = portalUserRole === 'admin' || portalUserRole === 'meeting_admin';
  const btn = document.getElementById('btnOpenMeetingModal');
  if (btn) {
    btn.style.display = canManageMeetings ? 'inline-flex' : 'none';
  }
  populateMeetingDepts();
  await loadMeetingsForMonth(currentMeetingDate.getFullYear(), currentMeetingDate.getMonth() + 1);
  renderMeetingCalendar();
  renderDayTimeline(selectedMeetingDateStr);
}

function populateMeetingDepts(selectedDeptId = '') {
  const depts = (domains.departments || []).map(d => ({ val: d.id, text: d.name }));
  populateFormCS('fcs-mDept', depts, 'Şöbə seçin *', true);
  setFormCS('fcs-mDept', selectedDeptId, 'Şöbə seçin *');
}

async function loadMeetingsForMonth(year, month) {
  try {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const res = await fetch(`${API_URL}/meetings?month=${monthStr}`);
    if (!res.ok) throw new Error('Meetings fetch failed');
    currentMonthMeetings = await res.json() || [];
  } catch (err) {
    console.error('loadMeetingsForMonth error:', err);
    currentMonthMeetings = [];
  }
}

const AZ_MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
  'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'
];

function changeMeetingMonth(delta) {
  currentMeetingDate.setMonth(currentMeetingDate.getMonth() + delta);
  loadMeetingsForMonth(currentMeetingDate.getFullYear(), currentMeetingDate.getMonth() + 1).then(() => {
    renderMeetingCalendar();
  });
}

function goToCurrentMeetingMonth() {
  currentMeetingDate = new Date();
  selectedMeetingDateStr = getLocalTodayStr();
  loadMeetingsForMonth(currentMeetingDate.getFullYear(), currentMeetingDate.getMonth() + 1).then(() => {
    renderMeetingCalendar();
    renderDayTimeline(selectedMeetingDateStr);
  });
}

function renderMeetingCalendar() {
  const grid = document.getElementById('meetingCalendarGrid');
  const title = document.getElementById('calendarMonthTitle');
  if (!grid || !title) return;

  const year = currentMeetingDate.getFullYear();
  const month = currentMeetingDate.getMonth(); // 0-indexed

  title.textContent = `${AZ_MONTHS[month]} ${year}`;

  // First day of month & total days
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();

  // Day of week for 1st day (0 is Sunday, convert to Monday=0 .. Sunday=6)
  let startDayOfWeek = firstDay.getDay() - 1;
  if (startDayOfWeek === -1) startDayOfWeek = 6;

  const todayStr = getLocalTodayStr();

  let html = '';

    // Previous month trailing days
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      html += `<div class="calendar-day-cell other-month">${dayNum}</div>`;
    }

    // Current month days
    for (let day = 1; day <= totalDays; day++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayMeetings = currentMonthMeetings.filter(m => {
        const mDate = typeof m.meeting_date === 'string' ? m.meeting_date.split('T')[0] : '';
        return mDate === dStr;
      });

      const isToday = dStr === todayStr;
      const isSelected = dStr === selectedMeetingDateStr;

      let cellClass = 'calendar-day-cell current-month';
      if (isSelected) cellClass += ' selected';
      if (isToday) cellClass += ' today';

      html += `
        <div onclick="selectMeetingDate('${dStr}')" class="${cellClass}">
          <div class="calendar-day-top">
            <span class="calendar-day-number">${day}</span>
            ${isToday ? `<span class="calendar-today-badge">BU GÜN</span>` : ''}
            ${dayMeetings.length > 0 ? `<span class="calendar-mobile-dot" title="${dayMeetings.length} iclas"></span>` : ''}
          </div>
          <div class="calendar-events-preview">
            ${dayMeetings.slice(0, 2).map(m => `
              <div class="calendar-event-pill" title="${m.title} (${m.start_time.slice(0,5)} - ${m.end_time.slice(0,5)})">
                ${m.start_time.slice(0,5)} ${m.title}
              </div>
            `).join('')}
            ${dayMeetings.length > 2 ? `<div class="calendar-event-more">+${dayMeetings.length - 2} daha</div>` : ''}
          </div>
        </div>
      `;
    }

    // Next month leading days to complete grid (multiples of 7)
    const remainingCells = 7 - ((startDayOfWeek + totalDays) % 7);
    if (remainingCells < 7) {
      for (let day = 1; day <= remainingCells; day++) {
        html += `<div class="calendar-day-cell other-month">${day}</div>`;
      }
    }

  grid.innerHTML = html;
}

function selectMeetingDate(dateStr) {
  selectedMeetingDateStr = dateStr;
  renderMeetingCalendar();
  renderDayTimeline(dateStr);
}

let currentSelectedParticipants = []; // array of { type: 'employee'|'external', id?, name, email?, dept? }

function renderParticipantChecklist() {
  const box = document.getElementById('mEmployeesChecklistBox');
  const countBadge = document.getElementById('mParticipantCountBadge');
  const deptFilter = document.getElementById('mParticipantDeptFilter');
  const searchVal = (document.getElementById('mParticipantSearch')?.value || '').trim().toLocaleUpperCase('az');
  const selectedDept = deptFilter ? deptFilter.value : '';

  if (!box) return;

  // Update selected count badge
  const totalCount = currentSelectedParticipants.length;
  if (countBadge) countBadge.textContent = `${totalCount} seçilib`;

  // Populate department filter once
  const pDeptContainer = document.getElementById('fcs-mParticipantDept');
  if (pDeptContainer && domains.departments && !pDeptContainer.dataset.populated) {
    pDeptContainer.dataset.populated = 'true';
    const deptOpts = (domains.departments || []).map(d => ({ val: d.id, text: d.name }));
    populateFormCS('fcs-mParticipantDept', deptOpts, 'Bütün şöbələr', true);
  }

  // Filter employees
  let list = employees || [];
  if (selectedDept) {
    list = list.filter(e => String(e.dept_id) === String(selectedDept));
  }
  if (searchVal) {
    list = list.filter(e => {
      const nameM = (e.name || '').toLocaleUpperCase('az').includes(searchVal);
      const posM = (e.position_name || '').toLocaleUpperCase('az').includes(searchVal);
      const emailM = (e.email || '').toLocaleUpperCase('az').includes(searchVal);
      return nameM || posM || emailM;
    });
  }

  if (list.length === 0) {
    box.innerHTML = '<div style="padding: 12px; font-size: 12px; color: #94A3B8; text-align: center;">Əməkdaş tapılmadı</div>';
    return;
  }

  box.innerHTML = list.map(e => {
    const isSelected = currentSelectedParticipants.some(p => p.type === 'employee' && String(p.id) === String(e.id));
    return `
      <label style="display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 8px; background: ${isSelected ? '#F0F7FF' : '#fff'}; border: 1px solid ${isSelected ? '#BFDBFE' : '#E2E8F0'}; cursor: pointer; transition: all 0.15s ease;">
        <div style="display: flex; align-items: center; gap: 9px; min-width: 0;">
          <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleEmployeeParticipant(${e.id}, this.checked)" style="cursor: pointer; width: 16px; height: 16px; accent-color: var(--accent);">
          <div style="min-width: 0;">
            <div style="font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${e.name}</div>
            <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${e.position_name || '—'} · ${e.dept_name || '—'}</div>
          </div>
        </div>
        ${e.email && e.email !== 'null' ? `
          <span style="font-size: 11px; color: #2563EB; margin-left: 8px; display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;">
            <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            ${e.email}
          </span>
        ` : ''}
      </label>
    `;
  }).join('');

  renderExternalChips();
}

function filterParticipantEmployeesList() {
  renderParticipantChecklist();
}

function toggleEmployeeParticipant(empId, isChecked) {
  const e = (employees || []).find(x => String(x.id) === String(empId));
  if (!e) return;

  if (isChecked) {
    if (!currentSelectedParticipants.some(p => p.type === 'employee' && String(p.id) === String(empId))) {
      currentSelectedParticipants.push({
        type: 'employee',
        id: e.id,
        name: e.name,
        email: (e.email && e.email !== 'null') ? e.email : null,
        dept: e.dept_name || null
      });
    }
  } else {
    currentSelectedParticipants = currentSelectedParticipants.filter(p => !(p.type === 'employee' && String(p.id) === String(empId)));
  }

  renderParticipantChecklist();
}

function addExternalParticipant() {
  const emailInput = document.getElementById('mExternalEmailInput');
  if (!emailInput) return;
  const email = emailInput.value.trim();

  if (!email) {
    showToast('Email daxil edin', 'error');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Düzgün email formatı daxil edin!', 'error');
    return;
  }

  const alreadyAdded = currentSelectedParticipants.some(p => p.email && p.email.toLowerCase() === email.toLowerCase());
  if (alreadyAdded) {
    showToast('Bu email artıq əlavə edilib', 'error');
    return;
  }

  currentSelectedParticipants.push({
    type: 'external',
    email: email,
    name: email
  });

  emailInput.value = '';
  renderParticipantChecklist();
}

function removeExternalParticipant(email) {
  currentSelectedParticipants = currentSelectedParticipants.filter(p => !(p.type === 'external' && p.email.toLowerCase() === email.toLowerCase()));
  renderParticipantChecklist();
}

function renderExternalChips() {
  const container = document.getElementById('mExternalParticipantsChips');
  if (!container) return;

  const externals = currentSelectedParticipants.filter(p => p.type === 'external');
  container.innerHTML = externals.map(p => `
    <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; background: #F8FAFC; color: #334155; border: 1px solid #CBD5E1; padding: 3px 8px; border-radius: 6px;">
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #64748B;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
      <span>${p.email}</span>
      <button type="button" onclick="removeExternalParticipant('${p.email}')" style="background: none; border: none; cursor: pointer; color: #94A3B8; padding: 0 0 0 2px; font-size: 14px; line-height: 1;" title="Sil">&times;</button>
    </span>
  `).join('');
}

function renderDayTimeline(dateStr) {
  const container = document.getElementById('dayMeetingsTimeline');
  const title = document.getElementById('selectedDateTitle');
  const badge = document.getElementById('selectedDateBadge');
  if (!container || !title) return;

  const parts = dateStr.split('-');
  const dObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  title.textContent = `${dObj.getDate()} ${AZ_MONTHS[dObj.getMonth()]} ${dObj.getFullYear()}`;

  const meetings = currentMonthMeetings.filter(m => {
    const mDate = typeof m.meeting_date === 'string' ? m.meeting_date.split('T')[0] : '';
    return mDate === dateStr;
  }).sort((a, b) => a.start_time.localeCompare(b.start_time));

  badge.textContent = `${meetings.length} İclas`;

  if (meetings.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 10px; color: #94A3B8;">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="40" height="40" style="margin-bottom: 12px; opacity: 0.5;">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div style="font-weight: 700; color: var(--text); font-size: 14px;">Bu tarixdə iclas yoxdur</div>
        <p style="font-size: 12px; margin-top: 4px;">İclas zalı gün ərzində tamamilə boşdur.</p>
      </div>
    `;
    return;
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  container.innerHTML = meetings.map(m => {
    const start = m.start_time.slice(0, 5);
    const end = m.end_time.slice(0, 5);
    const participantsList = Array.isArray(m.participants) ? m.participants : [];

    const isPast = dateStr < todayStr || (dateStr === todayStr && end <= currentTimeStr);
    const isOngoing = dateStr === todayStr && currentTimeStr >= start && currentTimeStr < end;

    let borderLeftColor = '#3B82F6';
    let statusBadge = '';

    if (isOngoing) {
      borderLeftColor = '#10B981';
      statusBadge = '<span style="font-size: 10px; font-weight: 800; background: #DCFCE7; color: #15803D; padding: 2px 7px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><span style="width:6px;height:6px;border-radius:50%;background:#16A34A;display:inline-block;"></span> Hazırda Gedir</span>';
    } else if (isPast) {
      borderLeftColor = '#94A3B8';
      statusBadge = '<span style="font-size: 10px; font-weight: 700; background: #F1F5F9; color: #64748B; padding: 2px 6px; border-radius: 5px;">Başa çatıb</span>';
    }

    return `
      <div style="border-radius: 12px; border: 1px solid #E2E8F0; padding: 14px; background: ${isPast ? '#FAFAFA' : '#F8FAFC'}; border-left: 4px solid ${borderLeftColor}; opacity: ${isPast ? '0.75' : '1'}; transition: all 0.15s ease;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="font-size: 12px; font-weight: 800; color: ${isPast ? '#64748B' : '#2563EB'}; background: ${isPast ? '#F1F5F9' : '#EFF6FF'}; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              ${start} – ${end}
            </span>
            ${statusBadge}
          </div>
          ${(portalUserRole === 'admin' || portalUserRole === 'meeting_admin') ? `
            <div style="display: flex; gap: 4px; flex-shrink: 0;">
              <button class="act-btn" title="Redaktə et" style="width: 26px; height: 26px;" onclick="openMeetingModal(${m.id})">
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="act-btn red" title="Sil" style="width: 26px; height: 26px;" onclick="deleteMeeting(${m.id})">
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          ` : ''}
        </div>
        <div style="font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 4px;">${m.title}</div>
        <div style="font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px;">
          <div><strong>Təşkilatçı:</strong> ${m.organizer}</div>
          ${m.dept_name ? `<div><strong>Şöbə:</strong> ${m.dept_name}</div>` : ''}
          ${participantsList.length > 0 ? `
            <div style="margin-top: 6px;">
              <strong style="display: block; margin-bottom: 4px; color: var(--text); font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px;">İştirakçılar (${participantsList.length}):</strong>
              <div style="display: flex; flex-wrap: wrap; gap: 5px;">
                ${participantsList.map(p => `
                  <span style="font-size: 11px; background: #fff; border: 1px solid #CBD5E1; color: #334155; padding: 2px 7px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
                    ${p.type === 'employee' 
                      ? '<svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#64748B"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>' 
                      : '<svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#64748B"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>'
                    }
                    <span>${p.name || p.email}</span>
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${m.description ? `<div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed #E2E8F0; color: #475569; font-style: italic;">${m.description}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/* ─── IOS STYLE WHEEL TIME PICKER SYSTEM ─── */
let activeIosTimeTarget = 'start'; // 'start' or 'end'
let currentWheelHour = 10;
let currentWheelMinute = 0;
const ITEM_HEIGHT = 44;

function initIosWheelItems() {
  const hoursScroll = document.getElementById('iosWheelHoursScroll');
  const minutesScroll = document.getElementById('iosWheelMinutesScroll');
  if (!hoursScroll || !minutesScroll) return;

  // 00 to 23
  let hHtml = '';
  for (let i = 0; i < 24; i++) {
    const s = String(i).padStart(2, '0');
    hHtml += `<div class="ios-wheel-item" data-value="${i}" onclick="scrollIosWheelTo('iosWheelHours', ${i})">${s}</div>`;
  }
  hoursScroll.innerHTML = hHtml;

  // 00 to 59
  let mHtml = '';
  for (let i = 0; i < 60; i++) {
    const s = String(i).padStart(2, '0');
    mHtml += `<div class="ios-wheel-item" data-value="${i}" onclick="scrollIosWheelTo('iosWheelMinutes', ${i})">${s}</div>`;
  }
  minutesScroll.innerHTML = mHtml;

  setupWheelScrollListener('iosWheelHours', (val) => {
    currentWheelHour = val;
    updateWheelActiveClasses('iosWheelHours', val);
  });

  setupWheelScrollListener('iosWheelMinutes', (val) => {
    currentWheelMinute = val;
    updateWheelActiveClasses('iosWheelMinutes', val);
  });
}

function setupWheelScrollListener(colId, onChange) {
  const col = document.getElementById(colId);
  if (!col) return;
  let scrollTimeout = null;

  col.addEventListener('scroll', () => {
    const index = Math.round(col.scrollTop / ITEM_HEIGHT);
    const maxIndex = colId === 'iosWheelHours' ? 23 : 59;
    const clamped = Math.max(0, Math.min(index, maxIndex));
    onChange(clamped);

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      // Snap smooth
      col.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: 'smooth' });
    }, 100);
  }, { passive: true });
}

function scrollIosWheelTo(colId, val, smooth = true) {
  const col = document.getElementById(colId);
  if (!col) return;
  col.scrollTo({
    top: val * ITEM_HEIGHT,
    behavior: smooth ? 'smooth' : 'auto'
  });
  updateWheelActiveClasses(colId, val);
}

function updateWheelActiveClasses(colId, selectedVal) {
  const col = document.getElementById(colId);
  if (!col) return;
  col.querySelectorAll('.ios-wheel-item').forEach(item => {
    item.classList.toggle('selected', Number(item.dataset.value) === selectedVal);
  });
}

function openIosTimePicker(target) {
  activeIosTimeTarget = target;
  const inputId = target === 'start' ? 'mStartTime' : 'mEndTime';
  const input = document.getElementById(inputId);
  const currentVal = input ? input.value : (target === 'start' ? '10:00' : '11:00');

  const parts = currentVal.split(':').map(Number);
  currentWheelHour = !isNaN(parts[0]) ? parts[0] : 10;
  currentWheelMinute = !isNaN(parts[1]) ? parts[1] : 0;

  const titleEl = document.getElementById('iosPickerTitle');
  if (titleEl) {
    titleEl.textContent = target === 'start' ? 'Başlama Saatını Seçin' : 'Bitmə Saatını Seçin';
  }

  const modal = document.getElementById('iosTimePickerModal');
  if (modal) modal.classList.add('open');

  // Position wheels
  setTimeout(() => {
    scrollIosWheelTo('iosWheelHours', currentWheelHour, false);
    scrollIosWheelTo('iosWheelMinutes', currentWheelMinute, false);
  }, 30);
}

function closeIosTimePicker(confirmed = false) {
  const modal = document.getElementById('iosTimePickerModal');
  if (modal) modal.classList.remove('open');
}

function confirmIosTimePicker() {
  const timeStr = `${String(currentWheelHour).padStart(2, '0')}:${String(currentWheelMinute).padStart(2, '0')}`;
  const inputId = activeIosTimeTarget === 'start' ? 'mStartTime' : 'mEndTime';
  const input = document.getElementById(inputId);
  if (input) input.value = timeStr;

  closeIosTimePicker(true);

  if (activeIosTimeTarget === 'start') {
    onStartTimeChange();
  }
}

function formatTimeInput(input, target) {
  let digits = input.value.replace(/\D/g, '').slice(0, 4);
  if (digits.length >= 3) {
    input.value = digits.slice(0, 2) + ':' + digits.slice(2);
  } else {
    input.value = digits;
  }
  if (digits.length === 4 && target === 'start') {
    const h = parseInt(digits.slice(0, 2), 10);
    const m = parseInt(digits.slice(2, 4), 10);
    if (h <= 23 && m <= 59) {
      onStartTimeChange();
    }
  }
}

function validateTimeInput(input, target) {
  let digits = input.value.replace(/\D/g, '');
  if (!digits) {
    input.value = target === 'start' ? '10:00' : '11:00';
    return;
  }
  if (digits.length === 1) digits = '0' + digits + '00';
  else if (digits.length === 2) digits = digits + '00';
  else if (digits.length === 3) digits = '0' + digits;

  let h = Math.min(23, Math.max(0, parseInt(digits.slice(0, 2), 10) || 0));
  let m = Math.min(59, Math.max(0, parseInt(digits.slice(2, 4), 10) || 0));
  input.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  if (target === 'start') {
    onStartTimeChange();
  }
}

window.formatTimeInput = formatTimeInput;
window.validateTimeInput = validateTimeInput;
window.openIosTimePicker = openIosTimePicker;
window.closeIosTimePicker = closeIosTimePicker;
window.confirmIosTimePicker = confirmIosTimePicker;
window.scrollIosWheelTo = scrollIosWheelTo;

function onStartTimeChange() {
  const startInput = document.getElementById('mStartTime');
  const endInput = document.getElementById('mEndTime');
  if (!startInput || !endInput) return;

  const startVal = startInput.value;
  if (!startVal) return;

  // If end time is earlier or equal to start, advance by 1 hour automatically
  if (!endInput.value || endInput.value <= startVal) {
    const parts = startVal.split(':').map(Number);
    const totalMin = parts[0] * 60 + parts[1] + 60;
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    endInput.value = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  }
}

window.onStartTimeChange = onStartTimeChange;

function openMeetingModal(meetingId = null, presetDate = null) {
  const canManageMeetings = portalUserRole === 'admin' || portalUserRole === 'meeting_admin';
  if (!canManageMeetings) {
    showToast('İclas təyin etmək üçün səlahiyyətiniz yoxdur', 'error');
    return;
  }

  populateMeetingDepts();
  document.getElementById('meetingEditId').value = meetingId || '';
  const delBtn = document.getElementById('btnDeleteMeeting');

  const todayStr = getLocalTodayStr();
  const dateInput = document.getElementById('mDate');
  if (dateInput) {
    dateInput.min = todayStr;
  }

  const searchInput = document.getElementById('mParticipantSearch');
  if (searchInput) searchInput.value = '';
  setFormCS('fcs-mParticipantDept', '', 'Bütün şöbələr');
  const emailInput = document.getElementById('mExternalEmailInput');
  if (emailInput) emailInput.value = '';
  const dropdown = document.getElementById('mParticipantDropdown');
  if (dropdown) dropdown.style.display = 'none';

  if (meetingId) {
    const m = currentMonthMeetings.find(x => String(x.id) === String(meetingId));
    if (!m) return;
    document.getElementById('meetingModalTitle').textContent = 'İclası Redaktə Et';
    document.getElementById('mTitle').value = m.title || '';
    document.getElementById('mOrganizer').value = m.organizer || '';
    populateMeetingDepts(m.dept_id || '');
    document.getElementById('mDate').value = typeof m.meeting_date === 'string' ? m.meeting_date.split('T')[0] : '';
    document.getElementById('mStartTime').value = m.start_time.slice(0, 5);
    document.getElementById('mEndTime').value = m.end_time.slice(0, 5);
    document.getElementById('mEndTime').min = m.start_time.slice(0, 5);
    document.getElementById('mDescription').value = m.description || '';
    currentSelectedParticipants = Array.isArray(m.participants) ? [...m.participants] : [];
    if (delBtn) delBtn.style.display = 'inline-flex';
  } else {
    let initialDate = presetDate || selectedMeetingDateStr || todayStr;
    if (initialDate < todayStr) initialDate = todayStr;

    document.getElementById('meetingModalTitle').textContent = 'Yeni İclas Təyin Et';
    document.getElementById('mTitle').value = '';
    document.getElementById('mOrganizer').value = portalUserName || '';
    populateMeetingDepts('');
    document.getElementById('mDate').value = initialDate;
    document.getElementById('mStartTime').value = '10:00';
    document.getElementById('mEndTime').value = '11:00';
    document.getElementById('mEndTime').min = '10:00';
    document.getElementById('mDescription').value = '';
    currentSelectedParticipants = [];
    if (delBtn) delBtn.style.display = 'none';
  }

  renderParticipantChecklist();
  loadBusyMeetingsForDate(document.getElementById('mDate').value);
  document.getElementById('meetingModal').classList.add('open');
}

async function loadBusyMeetingsForDate(dateStr) {
  const box = document.getElementById('mDateBusyBox');
  if (!box) return;
  if (!dateStr) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  const editId = document.getElementById('meetingEditId')?.value || '';
  box.style.display = 'block';
  box.innerHTML = `<div style="font-size: 12px; color: #64748B; padding: 6px 10px;">Yoxlanılır...</div>`;

  try {
    const res = await fetch(`${API_URL}/meetings?date=${encodeURIComponent(dateStr)}`, { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    let list = await res.json();
    if (editId) {
      list = list.filter(m => String(m.id) !== String(editId));
    }

    if (!list || list.length === 0) {
      box.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 8px; background: #F0FDF4; border: 1px solid #BBF7D0; color: #15803D; font-size: 12px; font-weight: 600;">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
          Bu tarixdə heç bir iclas yoxdur (Gün ərzində boşdur)
        </div>
      `;
      return;
    }

    box.innerHTML = `
      <div style="padding: 10px 12px; border-radius: 10px; background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E;">
        <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; margin-bottom: 6px;">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Bu tarixdə məşğul olan saatlar (${list.length}):
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${list.map(m => `
            <span style="font-size: 11.5px; font-weight: 600; background: #FFFFFF; border: 1px solid #FCD34D; color: #78350F; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
              <strong>${m.start_time.slice(0, 5)} – ${m.end_time.slice(0, 5)}</strong>
              <span style="opacity: 0.75;">• ${m.title}</span>
            </span>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    box.style.display = 'none';
    box.innerHTML = '';
  }
}
window.loadBusyMeetingsForDate = loadBusyMeetingsForDate;

async function saveMeeting() {
  const meetingId = document.getElementById('meetingEditId').value;
  const title = document.getElementById('mTitle').value.trim();
  const organizer = document.getElementById('mOrganizer').value.trim();
  const dept_id = document.getElementById('mDept').value;
  const meeting_date = document.getElementById('mDate').value;
  const start_time = document.getElementById('mStartTime').value;
  const end_time = document.getElementById('mEndTime').value;
  const description = document.getElementById('mDescription').value.trim();

  if (!title || !organizer || !dept_id || !meeting_date || !start_time || !end_time) {
    showToast('Bütün məcburi sahələri (*), o cümlədən Aid Olduğu Şöbəni seçin!', 'error');
    return;
  }

  // Validate that meeting is not scheduled in the past
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (meeting_date < todayStr) {
    showToast('Keçmiş tarixə iclas təyin etmək mümkün deyil!', 'error');
    return;
  }

  if (meeting_date === todayStr && start_time < currentTimeStr) {
    showToast('Keçmiş saata iclas təyin etmək mümkün deyil!', 'error');
    return;
  }

  if (start_time >= end_time) {
    showToast('Bitmə saatı başlama saatından sonra olmalıdır!', 'error');
    return;
  }

  const payload = {
    title,
    organizer,
    dept_id: Number(dept_id),
    meeting_date,
    start_time,
    end_time,
    description: description || null,
    participants: currentSelectedParticipants
  };

  const btn = document.getElementById('btnSaveMeeting');
  if (btn) btn.disabled = true;

  try {
    const url = meetingId ? `${API_URL}/meetings/${meetingId}` : `${API_URL}/meetings`;
    const method = meetingId ? 'PATCH' : 'POST';

    const res = await fetch(url, {
      method,
      headers: HEADERS,
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'İclas yadda saxlanılmadı');
    }

    showToast(meetingId ? 'İclas məlumatları yeniləndi ✓' : 'İclas uğurla təyin edildi ✓');
    closeModal('meetingModal');

    // Reload and refresh UI
    const parts = meeting_date.split('-');
    await loadMeetingsForMonth(Number(parts[0]), Number(parts[1]));
    selectedMeetingDateStr = meeting_date;
    renderMeetingCalendar();
    renderDayTimeline(meeting_date);
  } catch (err) {
    showToast(err.message || 'Xəta baş verdi', 'error');
    console.error(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteMeeting(id) {
  const ok = await showAppConfirm({
    title: 'İclası Sil',
    message: 'Bu iclası təqvimdən silmək istədiyinizə əminsiniz?',
    okText: 'Bəli, Sil',
    type: 'danger'
  });
  if (!ok) return;

  try {
    const res = await fetch(`${API_URL}/meetings/${id}`, {
      method: 'DELETE',
      headers: HEADERS
    });
    if (!res.ok) throw new Error('Delete failed');

    showToast('İclas təqvimdən silindi ✓');
    closeModal('meetingModal');

    // Reload
    await loadMeetingsForMonth(currentMeetingDate.getFullYear(), currentMeetingDate.getMonth() + 1);
    renderMeetingCalendar();
    renderDayTimeline(selectedMeetingDateStr);
  } catch (err) {
    showToast('İclas silinərkən xəta baş verdi', 'error');
    console.error(err);
  }
}

function deleteMeetingFromModal() {
  const meetingId = document.getElementById('meetingEditId').value;
  if (meetingId) deleteMeeting(meetingId);
}

  function formatTimeInput(input, target) {
  let digits = input.value.replace(/\D/g, '').slice(0, 4);
  if (digits.length >= 3) {
    input.value = digits.slice(0, 2) + ':' + digits.slice(2);
  } else {
    input.value = digits;
  }
  if (digits.length === 4 && target === 'start') {
    const h = parseInt(digits.slice(0, 2), 10);
    const m = parseInt(digits.slice(2, 4), 10);
    if (h <= 23 && m <= 59) {
      onStartTimeChange();
    }
  }
}

function validateTimeInput(input, target) {
  let digits = input.value.replace(/\D/g, '');
  if (!digits) {
    input.value = target === 'start' ? '10:00' : '11:00';
    return;
  }
  if (digits.length === 1) digits = '0' + digits + '00';
  else if (digits.length === 2) digits = digits + '00';
  else if (digits.length === 3) digits = '0' + digits;

  let h = Math.min(23, Math.max(0, parseInt(digits.slice(0, 2), 10) || 0));
  let m = Math.min(59, Math.max(0, parseInt(digits.slice(2, 4), 10) || 0));
  input.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  if (target === 'start') {
    onStartTimeChange();
  }
}

window.formatTimeInput = formatTimeInput;
window.validateTimeInput = validateTimeInput;
window.openIosTimePicker = openIosTimePicker;
  window.closeIosTimePicker = closeIosTimePicker;
  window.confirmIosTimePicker = confirmIosTimePicker;
  window.scrollIosWheelTo = scrollIosWheelTo;
  window.openMeetingModal = openMeetingModal;
  window.saveMeeting = saveMeeting;
window.deleteMeeting = deleteMeeting;
window.deleteMeetingFromModal = deleteMeetingFromModal;
window.changeMeetingMonth = changeMeetingMonth;
window.goToCurrentMeetingMonth = goToCurrentMeetingMonth;
window.selectMeetingDate = selectMeetingDate;

window.renderParticipantChecklist = renderParticipantChecklist;
window.filterParticipantEmployeesList = filterParticipantEmployeesList;
window.toggleEmployeeParticipant = toggleEmployeeParticipant;
window.addExternalParticipant = addExternalParticipant;
window.removeExternalParticipant = removeExternalParticipant;
