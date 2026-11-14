/* ============================================================
   Cash & Stock — ร้านลาซานญ่า (v2)
   Model: คลัง (สต๊อกบ้าน)  ↔  งานขาย (ร้าน/รอบขายของพนักงาน)
   - เถ้าแก่: จัดการสต๊อก, สร้างงาน, ปิดยอดเงิน, ประวัติ, ตั้งค่า
   - พนักงานครัว: จัดการสต๊อก
   - พนักงานขาย (หลายคน): ดูร้านของฉัน, นับของเหลือส่งปิดยอด, ประวัติของตัวเอง
   ============================================================ */

'use strict';

/* ---------------- Constants ---------------- */

const STORAGE_KEY = 'calforcash_v1';
const LOW_STOCK_THRESHOLD = 5;

const PRODUCTS = [
  { id: 'lasagna-pork',     name: 'ลาซานญ่าหมู',       price: 60, cat: 'ลาซานญ่า', emoji: '🍖' },
  { id: 'lasagna-beef',     name: 'ลาซานญ่าเนื้อ',      price: 60, cat: 'ลาซานญ่า', emoji: '🥩' },
  { id: 'lasagna-salmon',   name: 'ลาซานญ่าแซลมอน',    price: 60, cat: 'ลาซานญ่า', emoji: '🐟' },
  { id: 'pasta-seafood',    name: 'พาสต้าซีฟู้ด',       price: 65, cat: 'พาสต้า',   emoji: '🦐' },
  { id: 'pasta-bacon',      name: 'พาสต้าเบค่อน',       price: 65, cat: 'พาสต้า',   emoji: '🥓' },
  { id: 'pasta-ham-mush',   name: 'พาสต้าแฮมเห็ด',      price: 65, cat: 'พาสต้า',   emoji: '🍄' },
  { id: 'spinach-cheese',   name: 'ผักโขมอบชีส',        price: 60, cat: 'เมนูอบ',   emoji: '🥬' },
  { id: 'mashed-cheese',    name: 'มันบดอบชีส',         price: 45, cat: 'เมนูอบ',   emoji: '🥔' },
];

const LOGIN_ROLES = [
  { id: 'owner',   name: 'เถ้าแก่',     emoji: '👑',  desc: 'สต๊อก · สร้างงาน · ปิดยอดเงิน · ตั้งค่า' },
  { id: 'kitchen', name: 'พนักงานครัว', emoji: '👨‍🍳', desc: 'จัดการสต๊อก (คลัง)' },
  { id: 'sales',   name: 'พนักงานขาย', emoji: '🧑‍💼', desc: 'ดูร้านของฉัน · นับของส่งปิดยอด' },
];

const JOB_STATUS = {
  active:  { label: 'กำลังขาย',  emoji: '🛒', cls: 'active' },
  pending: { label: 'รอปิดยอด',  emoji: '⏳', cls: 'pending' },
  closed:  { label: 'ปิดแล้ว',    emoji: '✅', cls: 'closed' },
};

const MONEY_TYPES = [
  { key: 'cash',     label: 'เงินสด',    icon: '💵' },
  { key: 'qr',       label: 'QR Code',   icon: '📱' },
  { key: 'halfhalf', label: 'คนละครึ่ง', icon: '🤝' },
];

/* ---------------- State ---------------- */

function defaultState() {
  const stock = {};
  PRODUCTS.forEach(p => (stock[p.id] = 0));
  return {
    products: PRODUCTS.map(p => ({ ...p })),
    stock,
    pins: { owner: '1234', kitchen: '1234' },
    staff: [],
    jobs: [],
    settings: { shopName: 'ร้านลาซานญ่า' },
  };
}

let state = loadState();
let session = null; // { roleId, staffId, staffName }

function migrateOldRecords(records) {
  return (records || []).map(r => {
    const take = {}, remain = {}, sold = {};
    (r.items || []).forEach(it => {
      take[it.id] = it.opening || 0;
      remain[it.id] = it.closing || 0;
      sold[it.id] = it.sold || 0;
    });
    return {
      id: r.id || ('job-' + r.ts),
      location: 'ร้าน (เดิม)',
      staffId: null,
      staffName: r.closedBy || '—',
      createdAt: r.ts || new Date().toISOString(),
      status: 'closed',
      take, remain, sold,
      totalSoldQty: r.totalSoldQty || 0,
      expected: r.expected || 0,
      cash: r.cash || 0, qr: r.qr || 0, halfhalf: r.halfhalf || 0,
      received: r.received || 0, diff: r.diff || 0,
      saleDate: r.date || '',
      submittedAt: r.ts, submittedBy: r.closedBy,
      closedAt: r.ts,
    };
  });
}

function loadState() {
  const base = defaultState();
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return base; }
  if (!raw) return base;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return base; }

  const staff = [];
  if (Array.isArray(parsed.staff) && parsed.staff.length) {
    parsed.staff.forEach(s => {
      if (s && s.name) staff.push({ id: s.id || uid('staff'), name: s.name, pin: s.pin || '1234' });
    });
  } else if (parsed.pins && parsed.pins.sales) {
    staff.push({ id: 'staff-legacy', name: 'พนักงานขาย', pin: parsed.pins.sales });
  }

  const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : migrateOldRecords(parsed.records);

  return {
    products: base.products.map((p, i) => ({ ...p, ...(parsed.products && parsed.products[i]) })),
    stock: { ...base.stock, ...(parsed.stock || {}) },
    pins: {
      owner: (parsed.pins && parsed.pins.owner) || base.pins.owner,
      kitchen: (parsed.pins && parsed.pins.kitchen) || base.pins.kitchen,
    },
    staff,
    jobs,
    settings: { ...base.settings, ...(parsed.settings || {}) },
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('saveState failed', e);
    toast('⚠️ บันทึกข้อมูลไม่สำเร็จ (พื้นที่เต็ม?)');
  }
}

/* ---------------- Utils ---------------- */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

let _seq = 0;
function uid(prefix) {
  return `${prefix}-${Date.now()}-${(++_seq)}-${Math.floor(Math.random() * 1000)}`;
}

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

const fmtMoney = n => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const fmtNum = n => Number(n).toLocaleString('th-TH');

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtDateThai(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}
function diffLabel(diff) { return diff === 0 ? 'ยอดตรง' : (diff > 0 ? 'เงินเกิน' : 'เงินขาด'); }
function staffById(id) { return state.staff.find(s => s.id === id); }

function sumStock() { return state.products.reduce((s, p) => s + (state.stock[p.id] || 0), 0); }
function stockTotalValue() { return state.products.reduce((s, p) => s + (state.stock[p.id] || 0) * p.price, 0); }

function jobTakeTotal(job) {
  return state.products.reduce((s, p) => s + (job.take && job.take[p.id] || 0), 0);
}
function jobExpected(job) {
  return state.products.reduce((s, p) => s + (job.sold && job.sold[p.id] || 0) * p.price, 0);
}

function roleDisplay() {
  if (session.roleId === 'sales') return `🧑‍💼 ${session.staffName || 'พนักงานขาย'}`;
  const r = LOGIN_ROLES.find(x => x.id === session.roleId);
  return `${r ? r.emoji : ''} ${r ? r.name : ''}`;
}

/* ---------------- Toast & Modal ---------------- */

let toastTimer = null;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function openModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modalBackdrop').classList.remove('hidden');
}
function closeModal() {
  $('#modalBackdrop').classList.add('hidden');
  $('#modalBox').innerHTML = '';
}
$('#modalBackdrop').addEventListener('click', e => {
  if (e.target === $('#modalBackdrop')) closeModal();
});

/* ---------------- Auth / Login ---------------- */

let pinBuffer = '';
let selectedRoleId = null;
let selectedStaffId = null;

function renderRoleList() {
  const list = $('#roleList');
  list.innerHTML = LOGIN_ROLES.map(r => `
    <button class="role-card" data-role="${r.id}">
      <span class="role-emoji">${r.emoji}</span>
      <span>
        <span class="role-name">${r.name}</span>
        <span class="role-desc">${r.desc}</span>
      </span>
    </button>
  `).join('');
  $$('.role-card', list).forEach(btn => {
    btn.addEventListener('click', () => onPickRole(btn.dataset.role));
  });
}

function onPickRole(roleId) {
  selectedRoleId = roleId;
  if (roleId === 'sales') {
    openStaffSelect();
  } else {
    openPin(roleId, null);
  }
}

function openStaffSelect() {
  $('#roleList').classList.add('hidden');
  $('#staffPanel').classList.remove('hidden');
  const list = $('#staffList');
  if (!state.staff.length) {
    list.innerHTML = `<div class="staff-empty">ยังไม่มีพนักงานขาย<br>ให้เถ้าแก่เพิ่มใน ตั้งค่า → จัดการพนักงาน</div>`;
    return;
  }
  list.innerHTML = state.staff.map(s => `
    <button class="role-card" data-staff="${s.id}">
      <span class="role-emoji">🧑‍💼</span>
      <span>
        <span class="role-name">${escapeHtml(s.name)}</span>
        <span class="role-desc">พนักงานขาย</span>
      </span>
    </button>
  `).join('');
  $$('.role-card', list).forEach(btn => {
    btn.addEventListener('click', () => {
      selectedStaffId = btn.dataset.staff;
      openPin('sales', selectedStaffId);
    });
  });
}

function openPin(roleId, staffId) {
  pinBuffer = '';
  const role = LOGIN_ROLES.find(x => x.id === roleId);
  const staff = staffId ? staffById(staffId) : null;
  const label = staff ? `🧑‍💼 ${staff.name}` : `${role.emoji} ${role.name}`;
  $('#pinRoleLabel').textContent = label;
  $('#roleList').classList.add('hidden');
  $('#staffPanel').classList.add('hidden');
  $('#pinPanel').classList.remove('hidden');
  $('#pinError')?.remove();
  renderKeypad();
  renderDots();
}

function pinReal() {
  if (selectedRoleId === 'sales') {
    const s = staffById(selectedStaffId);
    return s ? s.pin : '';
  }
  return state.pins[selectedRoleId] || '';
}

function renderKeypad() {
  const kp = $('#keypad');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ลบ', '0', '⌫'];
  kp.innerHTML = keys.map(k => {
    const isFn = k === 'ลบ' || k === '⌫';
    return `<button class="key ${isFn ? 'key-fn' : ''}" data-k="${k}">${k}</button>`;
  }).join('');
  $$('.key', kp).forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.k;
      if (k === 'ลบ') pinBuffer = '';
      else if (k === '⌫') pinBuffer = pinBuffer.slice(0, -1);
      else if (pinBuffer.length < 6) pinBuffer += k;
      renderDots();
      attemptLogin();
    });
  });
}

function renderDots() {
  const dots = $('#pinDots');
  const len = Math.max(pinBuffer.length, (pinReal() || '').length, 4);
  dots.innerHTML = Array.from({ length: Math.min(len, 6) }, (_, i) =>
    `<span class="pin-dot ${i < pinBuffer.length ? 'filled' : ''}"></span>`
  ).join('');
}

function attemptLogin() {
  const real = pinReal();
  $('#pinError')?.remove();
  if (pinBuffer.length >= real.length) {
    if (pinBuffer === real) {
      doLogin();
    } else {
      pinBuffer = '';
      renderDots();
      const err = document.createElement('div');
      err.id = 'pinError';
      err.className = 'pin-error';
      err.textContent = 'รหัสไม่ถูกต้อง ลองอีกครั้ง';
      $('#pinDots').after(err);
    }
  }
}

function doLogin() {
  const staff = selectedRoleId === 'sales' ? staffById(selectedStaffId) : null;
  session = {
    roleId: selectedRoleId,
    staffId: selectedStaffId,
    staffName: staff ? staff.name : null,
  };
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#headerShopName').textContent = state.settings.shopName;
  $('#headerRole').textContent = roleDisplay();
  renderNav();
  go('dashboard');
  toast(`ยินดีต้อนรับ ${roleDisplay()}`);
}

function doLogout() {
  session = null;
  selectedRoleId = null;
  selectedStaffId = null;
  pinBuffer = '';
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  $('#pinPanel').classList.add('hidden');
  $('#staffPanel').classList.add('hidden');
  $('#roleList').classList.remove('hidden');
  renderRoleList();
}

$('#logoutBtn').addEventListener('click', doLogout);
$('#pinCancel').addEventListener('click', () => {
  $('#pinPanel').classList.add('hidden');
  $('#roleList').classList.remove('hidden');
});
$('#staffCancel').addEventListener('click', () => {
  $('#staffPanel').classList.add('hidden');
  $('#roleList').classList.remove('hidden');
});

/* ---------------- Navigation ---------------- */

const NAV_DEFS = {
  dashboard: { label: 'หน้าหลัก', icon: '🏠' },
  stock:     { label: 'สต๊อก',    icon: '📦' },
  jobs:      { label: 'งานขาย',   icon: '🧾' },
  myshop:    { label: 'ร้านของฉัน', icon: '🛍️' },
  history:   { label: 'ประวัติ',  icon: '📊' },
  settings:  { label: 'ตั้งค่า',  icon: '⚙️' },
};

function navItemsForRole() {
  if (session.roleId === 'owner')   return ['dashboard', 'stock', 'jobs', 'history', 'settings'];
  if (session.roleId === 'kitchen') return ['dashboard', 'stock'];
  if (session.roleId === 'sales')   return ['dashboard', 'myshop', 'history'];
  return ['dashboard'];
}

function renderNav() {
  const nav = $('#bottomNav');
  const ids = navItemsForRole();
  nav.innerHTML = ids.map(id => `
    <button class="nav-item" data-view="${id}">
      <span class="nav-icon">${NAV_DEFS[id].icon}</span>${NAV_DEFS[id].label}
    </button>
  `).join('');
  $$('.nav-item', nav).forEach(btn => {
    btn.addEventListener('click', () => go(btn.dataset.view));
  });
}

function go(view) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  const el = $('#view-' + view);
  if (el) el.classList.remove('hidden');
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderView(view);
  window.scrollTo(0, 0);
}

function renderView(view) {
  const renderers = {
    dashboard: renderDashboard,
    stock: renderStock,
    jobs: renderJobs,
    myshop: renderMyShop,
    history: renderHistory,
    settings: renderSettings,
  };
  if (renderers[view]) renderers[view]();
}

/* ---------------- Dashboard ---------------- */

function renderDashboard() {
  const el = $('#view-dashboard');
  const today = todayStr();
  const closedToday = state.jobs.filter(j => j.status === 'closed' && j.saleDate === today);
  const todayRevenue = closedToday.reduce((s, j) => s + j.expected, 0);
  const activeJobs = state.jobs.filter(j => j.status === 'active');
  const pendingJobs = state.jobs.filter(j => j.status === 'pending');
  const lowItems = state.products.filter(p => (state.stock[p.id] || 0) <= LOW_STOCK_THRESHOLD);

  if (session.roleId === 'owner') {
    el.innerHTML = `
      <h1 class="page-title">สวัสดี, เถ้าแก่ 👑</h1>
      <p class="page-sub">${fmtDateThai(today)} · ${state.settings.shopName}</p>

      ${lowItems.length ? `<div class="alert-banner">⚠️ สินค้าในคลังใกล้หมด ${lowItems.length} รายการ — <button class="btn btn-soft" style="padding:6px 12px;min-height:0" id="gotoStock">ดูเลย</button></div>` : ''}

      <div class="stat-grid">
        <div class="stat-card tint-primary"><div class="stat-label">สินค้าในคลัง</div><div class="stat-value">${fmtNum(sumStock())} ชิ้น</div></div>
        <div class="stat-card tint-amber"><div class="stat-label">มูลค่าคลัง</div><div class="stat-value">${fmtMoney(stockTotalValue())}</div></div>
        <div class="stat-card"><div class="stat-label">งานกำลังขาย</div><div class="stat-value">${fmtNum(activeJobs.length)} งาน</div></div>
        <div class="stat-card"><div class="stat-label">รอปิดยอด</div><div class="stat-value">${fmtNum(pendingJobs.length)} งาน</div></div>
        <div class="stat-card tint-green" style="grid-column:1/-1"><div class="stat-label">ยอดขายวันนี้</div><div class="stat-value">${fmtMoney(todayRevenue)}</div><div class="stat-hint">${fmtNum(closedToday.length)} งานที่ปิดแล้ว</div></div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="card-title">เมนูลัด</div>
        <div style="display:grid;gap:10px">
          <button class="btn btn-primary btn-block" id="quickCreate">🧾 สร้างงานส่งของให้พนักงาน</button>
          <button class="btn btn-soft btn-block" id="quickClose">💰 ปิดยอด (กรอกเงิน)</button>
          <button class="btn btn-ghost btn-block" id="quickStock">📦 ดู / แก้สต๊อกคลัง</button>
        </div>
      </div>
    `;
    $('#quickCreate').addEventListener('click', () => { go('jobs'); openCreateJob(); });
    $('#quickClose').addEventListener('click', () => go('jobs'));
    $('#quickStock').addEventListener('click', () => go('stock'));
    const gs = $('#gotoStock');
    if (gs) gs.addEventListener('click', () => go('stock'));
    return;
  }

  if (session.roleId === 'kitchen') {
    el.innerHTML = `
      <h1 class="page-title">สวัสดี, พนักงานครัว 👨‍🍳</h1>
      <p class="page-sub">${fmtDateThai(today)} · จัดการสต๊อกคลัง</p>
      ${lowItems.length ? `<div class="alert-banner">⚠️ สินค้าในคลังใกล้หมด ${lowItems.length} รายการ</div>` : ''}
      <div class="stat-grid">
        <div class="stat-card tint-primary"><div class="stat-label">สินค้าในคลัง</div><div class="stat-value">${fmtNum(sumStock())} ชิ้น</div></div>
        <div class="stat-card tint-amber"><div class="stat-label">มูลค่าคลัง</div><div class="stat-value">${fmtMoney(stockTotalValue())}</div></div>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="card-title">เมนูลัด</div>
        <button class="btn btn-primary btn-block" id="quickStock2">📦 ไปที่สต๊อก</button>
      </div>
    `;
    $('#quickStock2').addEventListener('click', () => go('stock'));
    return;
  }

  // sales staff
  const myJobs = state.jobs.filter(j => j.staffId === session.staffId);
  const myActive = myJobs.filter(j => j.status === 'active');
  const myPending = myJobs.filter(j => j.status === 'pending');
  const myClosed = myJobs.filter(j => j.status === 'closed');
  const heldQty = myActive.reduce((s, j) => s + jobTakeTotal(j), 0);

  el.innerHTML = `
    <h1 class="page-title">สวัสดี, ${escapeHtml(session.staffName || '')} 🧑‍💼</h1>
    <p class="page-sub">${fmtDateThai(today)} · งานของคุณ</p>

    <div class="stat-grid">
      <div class="stat-card tint-primary"><div class="stat-label">กำลังขาย</div><div class="stat-value">${fmtNum(myActive.length)} งาน</div></div>
      <div class="stat-card"><div class="stat-label">ถือของอยู่</div><div class="stat-value">${fmtNum(heldQty)} ชิ้น</div></div>
      <div class="stat-card tint-amber"><div class="stat-label">รอปิดยอด</div><div class="stat-value">${fmtNum(myPending.length)} งาน</div></div>
      <div class="stat-card tint-green"><div class="stat-label">ปิดแล้ว</div><div class="stat-value">${fmtNum(myClosed.length)} งาน</div></div>
    </div>

    ${myActive.length ? `
      <div class="card" style="margin-top:14px">
        <div class="card-title">งานที่กำลังขาย</div>
        ${myActive.map(j => `
          <div class="job-card">
            <div class="job-card-head">
              <span class="job-loc">📍 ${escapeHtml(j.location || 'ร้าน')}</span>
              <span class="job-badge ${JOB_STATUS.active.cls}">${JOB_STATUS.active.emoji} ${JOB_STATUS.active.label}</span>
            </div>
            <div class="job-card-meta">ถือของอยู่ <b>${fmtNum(jobTakeTotal(j))}</b> ชิ้น</div>
            <button class="btn btn-primary btn-block" data-count="${j.id}" style="margin-top:8px">นับของเหลือ / ส่งปิดยอด</button>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="empty-state"><div class="es-icon">🛒</div>ยังไม่มีงานที่กำลังขาย<br>รอเถ้าแก่สร้างงานส่งของให้</div>
    `}
  `;

  $$('[data-count]', el).forEach(btn => {
    btn.addEventListener('click', () => openCountJob(btn.dataset.count));
  });
}

/* ---------------- Stock ---------------- */

function renderStock() {
  const el = $('#view-stock');
  const editable = (session.roleId === 'owner' || session.roleId === 'kitchen');
  const cats = [...new Set(state.products.map(p => p.cat))];

  let html = `
    <h1 class="page-title">สต๊อกคลัง 📦</h1>
    <p class="page-sub">${editable ? 'กด + / − หรือพิมพ์ตัวเลขเพื่อแก้จำนวนในคลัง' : 'สิทธิของคุณดูได้อย่างเดียว'}</p>
    <div class="stat-grid" style="grid-template-columns:1fr 1fr">
      <div class="stat-card tint-primary"><div class="stat-label">รวมจำนวน</div><div class="stat-value" id="stockTotalQty">${fmtNum(sumStock())} ชิ้น</div></div>
      <div class="stat-card tint-amber"><div class="stat-label">มูลค่ารวม</div><div class="stat-value" id="stockTotalValue">${fmtMoney(stockTotalValue())}</div></div>
    </div>
  `;

  cats.forEach(cat => {
    const items = state.products.filter(p => p.cat === cat);
    html += `<div class="category-label">${cat}</div>`;
    items.forEach(p => {
      const qty = state.stock[p.id] || 0;
      const low = qty <= LOW_STOCK_THRESHOLD;
      html += `
        <div class="product-row">
          <div class="product-emoji">${p.emoji}</div>
          <div class="product-info">
            <div class="product-name">${p.name}</div>
            <div class="product-price">${fmtMoney(p.price)} / ชิ้น${low ? ' · <span class="stock-low-badge">ใกล้หมด</span>' : ''}</div>
          </div>
          ${editable ? `
            <div class="stock-steppers">
              <button class="step-btn minus" data-act="minus" data-id="${p.id}">−</button>
              <input class="step-input" data-act="input" data-id="${p.id}" type="number" inputmode="numeric" min="0" step="1" value="${qty}" />
              <button class="step-btn plus" data-act="plus" data-id="${p.id}">+</button>
            </div>
          ` : `
            <div class="product-stock"><div class="stock-qty ${low ? 'stock-zero' : ''}">${fmtNum(qty)}</div><div class="stock-unit">ชิ้น</div></div>
          `}
        </div>
      `;
    });
  });

  el.innerHTML = html;
}

function initStockEvents() {
  const el = $('#view-stock');
  el.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !session || !(session.roleId === 'owner' || session.roleId === 'kitchen')) return;
    const { act, id } = btn.dataset;
    let qty = state.stock[id] || 0;
    if (act === 'plus') qty += 1;
    else if (act === 'minus') qty = Math.max(0, qty - 1);
    state.stock[id] = qty;
    saveState();
    const input = el.querySelector(`input[data-id="${id}"]`);
    if (input) input.value = qty;
    refreshStockStats();
  });
  el.addEventListener('change', e => {
    const input = e.target.closest('input[data-act="input"]');
    if (!input || !session || !(session.roleId === 'owner' || session.roleId === 'kitchen')) return;
    const id = input.dataset.id;
    state.stock[id] = Math.max(0, Math.round(num(input.value) || 0));
    saveState();
    refreshStockStats();
  });
}

function refreshStockStats() {
  const qtyEl = $('#stockTotalQty');
  const valEl = $('#stockTotalValue');
  if (qtyEl) qtyEl.textContent = `${fmtNum(sumStock())} ชิ้น`;
  if (valEl) valEl.textContent = fmtMoney(stockTotalValue());
}

/* ---------------- Jobs (owner) ---------------- */

function renderJobs() {
  const el = $('#view-jobs');
  const active = state.jobs.filter(j => j.status === 'active');
  const pending = state.jobs.filter(j => j.status === 'pending');
  const closed = state.jobs.filter(j => j.status === 'closed');

  const section = (title, jobs, showActions) => {
    if (!jobs.length) return '';
    return `
      <div class="category-label">${title} (${jobs.length})</div>
      ${jobs.map(j => jobCardHtml(j, showActions)).join('')}
    `;
  };

  el.innerHTML = `
    <h1 class="page-title">งานขาย 🧾</h1>
    <p class="page-sub">สร้างงานส่งของให้พนักงาน แล้วปิดยอดเงินที่นี่</p>

    <button class="btn btn-primary btn-block" id="createJobBtn">➕ สร้างงานใหม่</button>

    <div style="margin-top:18px">
      ${section('⏳ รอปิดยอด (กรอกเงิน)', pending, 'pending')}
      ${section('🛒 กำลังขาย', active, 'active')}
      ${section('✅ ปิดแล้ว', closed.slice(0, 50), 'closed')}
    </div>

    ${!state.jobs.length ? `<div class="empty-state"><div class="es-icon">🧾</div>ยังไม่มีงานขาย<br>กด “สร้างงานใหม่” เพื่อเริ่ม</div>` : ''}
  `;

  $('#createJobBtn').addEventListener('click', openCreateJob);
  $$('.job-card', el).forEach(card => {
    const id = card.dataset.id;
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openJobDetail(id);
    });
  });
  $$('[data-finalize]', el).forEach(btn => btn.addEventListener('click', () => openFinalizeJob(btn.dataset.finalize)));
  $$('[data-cancel]', el).forEach(btn => btn.addEventListener('click', () => cancelJob(btn.dataset.cancel)));
}

function jobCardHtml(job, mode) {
  const st = JOB_STATUS[job.status];
  let actions = '';
  if (mode === 'pending') {
    actions = `<button class="btn btn-primary btn-block" data-finalize="${job.id}" style="margin-top:8px">💰 ปิดยอด (กรอกเงิน)</button>`;
  } else if (mode === 'active') {
    actions = `<button class="btn btn-ghost btn-block" data-cancel="${job.id}" style="margin-top:8px">ยกเลิกงาน (คืนของเข้าคลัง)</button>`;
  }
  const moneyLine = job.status === 'closed'
    ? `<div class="job-card-meta">ยอดขาย ${fmtMoney(job.expected)} · รับ ${fmtMoney(job.received)} · <b style="color:${job.diff >= 0 ? 'var(--green)' : 'var(--red)'}">${diffLabel(job.diff)} ${fmtMoney(Math.abs(job.diff))}</b></div>`
    : `<div class="job-card-meta">ส่งของไป <b>${fmtNum(jobTakeTotal(job))}</b> ชิ้น${job.status === 'pending' ? ` · ขายแล้ว <b>${fmtNum(job.totalSoldQty)}</b> ชิ้น` : ''}</div>`;

  return `
    <div class="job-card" data-id="${job.id}">
      <div class="job-card-head">
        <span class="job-loc">📍 ${escapeHtml(job.location || 'ร้าน')}</span>
        <span class="job-badge ${st.cls}">${st.emoji} ${st.label}</span>
      </div>
      <div class="job-card-meta">👤 ${escapeHtml(job.staffName || '—')} · ${fmtDateThai(job.saleDate || job.createdAt.slice(0, 10))}</div>
      ${moneyLine}
      ${actions}
    </div>
  `;
}

function openCreateJob() {
  if (!state.staff.length) {
    toast('⚠️ ยังไม่มีพนักงาน — เพิ่มใน ตั้งค่า → จัดการพนักงาน ก่อน');
    return;
  }
  const options = state.staff.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');

  openModal(`
    <div class="modal-title">➕ สร้างงานขาย</div>
    <div class="field-label">พนักงานขาย</div>
    <select id="jobStaff" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:12px;background:#fff">${options}</select>
    <div class="field-label">สถานที่ขาย (ชื่อร้าน/ตลาด)</div>
    <input type="text" id="jobLocation" placeholder="เช่น ตลาดรวมใจ" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:12px" />

    <div class="field-label">จำนวนสินค้าที่ให้ไป <span class="hint">(จะถูกหักจากคลัง)</span></div>
    ${state.products.map(p => `
      <div class="sales-item">
        <div><div class="si-name">${p.emoji} ${p.name}</div><div class="si-price">คลังมี ${fmtNum(state.stock[p.id] || 0)}</div></div>
        <input class="qty-box-input" type="number" inputmode="numeric" min="0" step="1" data-take="${p.id}" value="0" />
      </div>
    `).join('')}

    <div class="summary-row total"><span>รวมที่จะส่ง</span><span class="s-val" id="takeTotal">0 ชิ้น</span></div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="createCancel">ยกเลิก</button>
      <button class="btn btn-primary" id="createConfirm">สร้างงาน</button>
    </div>
  `);

  $('#createCancel').addEventListener('click', closeModal);

  const recompute = () => {
    let total = 0;
    $$('input[data-take]', $('#modalBox')).forEach(inp => { total += Math.round(num(inp.value) || 0); });
    $('#takeTotal').textContent = `${fmtNum(total)} ชิ้น`;
  };
  $$('input[data-take]', $('#modalBox')).forEach(inp => inp.addEventListener('input', recompute));

  $('#createConfirm').addEventListener('click', () => {
    const staffId = $('#jobStaff').value;
    const location = $('#jobLocation').value.trim();
    const staff = staffById(staffId);
    if (!staff) return toast('เลือกพนักงานก่อน');
    if (!location) return toast('ใส่สถานที่ขายก่อน');

    const take = {};
    let total = 0;
    let over = null;
    state.products.forEach(p => {
      const q = Math.round(num($(`input[data-take="${p.id}"]`, $('#modalBox'))?.value) || 0);
      take[p.id] = q;
      total += q;
      if (q > (state.stock[p.id] || 0) && !over) over = p;
    });
    if (total <= 0) return toast('ใส่จำนวนสินค้าที่จะส่งก่อน');
    if (over) return toast(`“${over.name}” ส่งเกินคลัง (มี ${state.stock[over.id]} ชิ้น)`);

    // deduct stock
    state.products.forEach(p => { state.stock[p.id] = (state.stock[p.id] || 0) - take[p.id]; });

    const job = {
      id: uid('job'),
      location,
      staffId,
      staffName: staff.name,
      createdAt: new Date().toISOString(),
      status: 'active',
      take,
      remain: {},
      sold: {},
      totalSoldQty: 0,
      expected: 0,
      cash: 0, qr: 0, halfhalf: 0, received: 0, diff: 0,
      saleDate: '',
      submittedAt: null, submittedBy: null,
      closedAt: null,
    };
    state.jobs.unshift(job);
    saveState();
    closeModal();
    toast(`✅ สร้างงาน “${location}” ให้ ${staff.name} (${total} ชิ้น)`);
    renderJobs();
  });
}

function openJobDetail(id) {
  const j = state.jobs.find(x => x.id === id);
  if (!j) return;
  const st = JOB_STATUS[j.status];
  const rows = state.products.map(p => {
    const take = j.take && j.take[p.id] || 0;
    const remain = j.remain && j.remain[p.id] || 0;
    const sold = j.sold && j.sold[p.id] || 0;
    return `
      <div class="sales-item">
        <div><div class="si-name">${p.emoji} ${p.name}</div></div>
        <div class="si-qty-row">
          <div class="qty-box"><span class="qty-label">ส่ง</span><span>${fmtNum(take)}</span></div>
          <div class="qty-box"><span class="qty-label">เหลือ</span><span>${fmtNum(remain)}</span></div>
          <div class="qty-box"><span class="qty-label">ขาย</span><span>${fmtNum(sold)}</span></div>
        </div>
      </div>
    `;
  }).join('');

  openModal(`
    <div class="modal-title">${st.emoji} ${escapeHtml(j.location || 'ร้าน')}</div>
    <div style="color:var(--text-muted);font-size:.88rem;margin-bottom:12px">
      👤 ${escapeHtml(j.staffName || '—')} · สถานะ ${st.label}${j.saleDate ? ` · ${fmtDateThai(j.saleDate)}` : ''}
    </div>
    ${rows}
    ${j.status === 'closed' ? `
      <div class="summary-row total"><span>ยอดขายที่ควรได้</span><span class="s-val">${fmtMoney(j.expected)}</span></div>
      <div class="summary-row"><span>💵 เงินสด</span><span class="s-val">${fmtMoney(j.cash)}</span></div>
      <div class="summary-row"><span>📱 QR Code</span><span class="s-val">${fmtMoney(j.qr)}</span></div>
      <div class="summary-row"><span>🤝 คนละครึ่ง</span><span class="s-val">${fmtMoney(j.halfhalf)}</span></div>
      <div class="summary-row"><span>รวมเงินที่ได้รับ</span><span class="s-val">${fmtMoney(j.received)}</span></div>
      <div class="summary-row total"><span>${diffLabel(j.diff)}</span><span class="s-val" style="color:${j.diff >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoney(Math.abs(j.diff))}</span></div>
    ` : ''}
    <div class="modal-actions">
      <button class="btn btn-outline" id="detailClose">ปิด</button>
    </div>
  `);
  $('#detailClose').addEventListener('click', closeModal);
}

function cancelJob(id) {
  const j = state.jobs.find(x => x.id === id);
  if (!j || j.status !== 'active') return;
  if (!confirm(`ยกเลิกงาน “${j.location}”? ของที่ส่งไป ${jobTakeTotal(j)} ชิ้น จะคืนเข้าคลัง`)) return;
  state.products.forEach(p => { state.stock[p.id] = (state.stock[p.id] || 0) + (j.take && j.take[p.id] || 0); });
  state.jobs = state.jobs.filter(x => x.id !== id);
  saveState();
  toast('ยกเลิกงานแล้ว คืนของเข้าคลัง');
  renderJobs();
}

function openFinalizeJob(id) {
  const j = state.jobs.find(x => x.id === id);
  if (!j) return;

  openModal(`
    <div class="modal-title">💰 ปิดยอด “${escapeHtml(j.location || 'ร้าน')}”</div>
    <div style="color:var(--text-muted);font-size:.88rem;margin-bottom:12px">
      👤 ${escapeHtml(j.staffName || '—')} · ${fmtDateThai(j.saleDate)} · ขายแล้ว <b>${fmtNum(j.totalSoldQty)}</b> ชิ้น
    </div>

    <div class="field-label">ยอดขาย (ส่ง − เหลือ)</div>
    ${state.products.filter(p => (j.sold && j.sold[p.id] || 0) > 0).map(p => `
      <div class="sales-item">
        <div><div class="si-name">${p.emoji} ${p.name}</div><div class="si-price">ส่ง ${fmtNum(j.take && j.take[p.id] || 0)} · เหลือ ${fmtNum(j.remain && j.remain[p.id] || 0)}</div></div>
        <div class="si-sold"><b>${fmtNum(j.sold && j.sold[p.id] || 0)}</b> × ${fmtMoney(p.price)} = ${fmtMoney((j.sold && j.sold[p.id] || 0) * p.price)}</div>
      </div>
    `).join('') || '<div style="color:var(--text-muted)">ไม่มีการขายในงานนี้</div>'}

    <div class="field-label">เงินที่ได้รับ 💸</div>
    <div class="money-grid">
      ${MONEY_TYPES.map(m => `
        <div class="money-box">
          <div class="mb-icon">${m.icon}</div>
          <div class="mb-label">${m.label}</div>
          <input type="number" inputmode="decimal" min="0" step="0.01" data-money="${m.key}" value="0" />
        </div>
      `).join('')}
    </div>

    <div class="card summary-card" style="box-shadow:none;border:1.5px solid var(--border);margin-top:14px">
      <div class="summary-row"><span>ยอดขายที่ควรได้</span><span class="s-val">${fmtMoney(j.expected)}</span></div>
      <div class="summary-row"><span>เงินที่ได้รับรวม</span><span class="s-val" id="finReceived">฿0</span></div>
      <div class="summary-row total">
        <span id="finDiffLabel">ยอดตรง</span>
        <span class="s-val" id="finDiffVal" style="color:var(--green)">฿0</span>
      </div>
      <div id="finBanner" class="diff-banner ok">✅ ยอดตรง — เงินครบพอดี</div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-outline" id="finCancel">ยกเลิก</button>
      <button class="btn btn-primary" id="finConfirm">ยืนยันปิดยอด</button>
    </div>
  `);

  $('#finCancel').addEventListener('click', closeModal);

  const recompute = () => {
    const cash = num($('input[data-money="cash"]', $('#modalBox'))?.value);
    const qr = num($('input[data-money="qr"]', $('#modalBox'))?.value);
    const hh = num($('input[data-money="halfhalf"]', $('#modalBox'))?.value);
    const received = round2(cash + qr + hh);
    const diff = round2(received - j.expected);
    $('#finReceived').textContent = fmtMoney(received);
    $('#finDiffLabel').textContent = diffLabel(diff);
    const dv = $('#finDiffVal');
    dv.textContent = fmtMoney(Math.abs(diff));
    dv.style.color = diff >= 0 ? 'var(--green)' : 'var(--red)';
    const banner = $('#finBanner');
    banner.classList.remove('ok', 'over', 'short');
    if (diff === 0) { banner.className = 'diff-banner ok'; banner.textContent = '✅ ยอดตรง — เงินครบพอดี'; }
    else if (diff > 0) { banner.className = 'diff-banner over'; banner.textContent = `✅ เงินเกิน +${fmtMoney(diff)}`; }
    else { banner.className = 'diff-banner short'; banner.textContent = `⚠️ เงินขาด ${fmtMoney(Math.abs(diff))}`; }
  };
  $$('input[data-money]', $('#modalBox')).forEach(inp => inp.addEventListener('input', recompute));
  recompute();

  $('#finConfirm').addEventListener('click', () => {
    const cash = num($('input[data-money="cash"]', $('#modalBox'))?.value);
    const qr = num($('input[data-money="qr"]', $('#modalBox'))?.value);
    const hh = num($('input[data-money="halfhalf"]', $('#modalBox'))?.value);
    const received = round2(cash + qr + hh);
    const diff = round2(received - j.expected);
    j.cash = cash; j.qr = qr; j.halfhalf = hh;
    j.received = received; j.diff = diff;
    j.status = 'closed';
    j.closedAt = new Date().toISOString();
    saveState();
    closeModal();
    toast('✅ ปิดยอดเรียบร้อย');
    renderJobs();
  });
}

/* ---------------- MyShop (sales staff) ---------------- */

function renderMyShop() {
  const el = $('#view-myshop');
  const myActive = state.jobs.filter(j => j.staffId === session.staffId && j.status === 'active');
  const myPending = state.jobs.filter(j => j.staffId === session.staffId && j.status === 'pending');

  let html = `
    <h1 class="page-title">ร้านของฉัน 🛍️</h1>
    <p class="page-sub">สินค้าที่คุณถืออยู่ และการส่งยอดปิด</p>
  `;

  if (!myActive.length && !myPending.length) {
    html += `<div class="empty-state"><div class="es-icon">🛒</div>ยังไม่มีงานของร้าน<br>รอเถ้าแก่สร้างงานส่งของให้</div>`;
  }

  if (myActive.length) {
    html += `<div class="category-label">กำลังขาย (${myActive.length})</div>`;
    myActive.forEach(j => {
      html += `
        <div class="job-card">
          <div class="job-card-head">
            <span class="job-loc">📍 ${escapeHtml(j.location || 'ร้าน')}</span>
            <span class="job-badge ${JOB_STATUS.active.cls}">${JOB_STATUS.active.emoji} ${JOB_STATUS.active.label}</span>
          </div>
          ${state.products.filter(p => (j.take && j.take[p.id] || 0) > 0).map(p => `
            <div class="myshop-item">
              <span>${p.emoji} ${p.name}</span>
              <b>${fmtNum(j.take && j.take[p.id] || 0)} ชิ้น</b>
            </div>
          `).join('') || '<div class="job-card-meta">ไม่มีสินค้าในงานนี้</div>'}
          <button class="btn btn-primary btn-block" data-count="${j.id}" style="margin-top:10px">นับของเหลือ / ส่งปิดยอด</button>
        </div>
      `;
    });
  }

  if (myPending.length) {
    html += `<div class="category-label">รอเถ้าแก่ปิดยอด (${myPending.length})</div>`;
    myPending.forEach(j => {
      html += `
        <div class="job-card">
          <div class="job-card-head">
            <span class="job-loc">📍 ${escapeHtml(j.location || 'ร้าน')}</span>
            <span class="job-badge ${JOB_STATUS.pending.cls}">${JOB_STATUS.pending.emoji} ${JOB_STATUS.pending.label}</span>
          </div>
          <div class="job-card-meta">ส่งยอดแล้ว ขาย <b>${fmtNum(j.totalSoldQty)}</b> ชิ้น · รอเถ้าแก่กรอกเงิน</div>
        </div>
      `;
    });
  }

  el.innerHTML = html;
  $$('[data-count]', el).forEach(btn => {
    btn.addEventListener('click', () => openCountJob(btn.dataset.count));
  });
}

function openCountJob(id) {
  const j = state.jobs.find(x => x.id === id);
  if (!j) return;

  openModal(`
    <div class="modal-title">🧮 นับของเหลือ “${escapeHtml(j.location || 'ร้าน')}”</div>
    <div style="color:var(--text-muted);font-size:.88rem;margin-bottom:12px">กรอกจำนวนของที่เหลืออยู่ในร้านตอนนี้ แล้วส่งให้เถ้าแก่</div>

    ${state.products.filter(p => (j.take && j.take[p.id] || 0) > 0).map(p => `
      <div class="sales-item">
        <div><div class="si-name">${p.emoji} ${p.name}</div><div class="si-price">ถืออยู่ ${fmtNum(j.take && j.take[p.id] || 0)} ชิ้น</div></div>
        <div class="qty-box">
          <span class="qty-label">เหลือ</span>
          <input type="number" inputmode="numeric" min="0" step="1" data-remain="${p.id}" value="${j.take && j.take[p.id] || 0}" />
        </div>
        <div class="si-sold" data-sold="${p.id}"></div>
      </div>
    `).join('')}

    <div class="summary-row total"><span>ขายรวม</span><span class="s-val" id="countSoldTotal">0 ชิ้น</span></div>
    <div id="countWarn" class="diff-banner hidden"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="countCancel">ยกเลิก</button>
      <button class="btn btn-primary" id="countConfirm">ส่งยอดให้เถ้าแก่</button>
    </div>
  `);

  $('#countCancel').addEventListener('click', closeModal);

  const recompute = () => {
    let totalSold = 0, hasNeg = false;
    state.products.forEach(p => {
      const takeQ = j.take && j.take[p.id] || 0;
      if (takeQ <= 0) return;
      const remain = Math.round(num($(`input[data-remain="${p.id}"]`, $('#modalBox'))?.value) || 0);
      const sold = takeQ - remain;
      if (sold < 0) hasNeg = true;
      else totalSold += sold;
      const badge = $(`[data-sold="${p.id}"]`, $('#modalBox'));
      if (badge) {
        badge.classList.toggle('neg', sold < 0);
        badge.innerHTML = sold < 0 ? '⚠️ เกินที่ถือ' : `ขาย <b>${fmtNum(sold)}</b> ชิ้น`;
      }
    });
    $('#countSoldTotal').textContent = `${fmtNum(totalSold)} ชิ้น`;
    const warn = $('#countWarn');
    if (hasNeg) {
      warn.className = 'diff-banner short';
      warn.textContent = '⚠️ มีรายการ “เหลือ” มากกว่า “ถืออยู่” — ตรวจสอบตัวเลข';
      warn.classList.remove('hidden');
    } else {
      warn.classList.add('hidden');
    }
    $('#countConfirm').disabled = hasNeg;
  };
  $$('input[data-remain]', $('#modalBox')).forEach(inp => inp.addEventListener('input', recompute));
  recompute();

  $('#countConfirm').addEventListener('click', () => {
    const remain = {};
    let totalSold = 0, expected = 0;
    for (const p of state.products) {
      const takeQ = j.take && j.take[p.id] || 0;
      const r = Math.round(num($(`input[data-remain="${p.id}"]`, $('#modalBox'))?.value) || 0);
      if (r > takeQ) return toast('มีรายการ “เหลือ” เกิน “ถืออยู่” กรุณาแก้');
      remain[p.id] = r;
      const sold = takeQ - r;
      j.sold = j.sold || {};
      j.sold[p.id] = sold;
      totalSold += sold;
      expected += sold * p.price;
    }
    j.remain = remain;
    j.totalSoldQty = totalSold;
    j.expected = expected;
    j.status = 'pending';
    j.submittedAt = new Date().toISOString();
    j.submittedBy = session.staffName;
    j.saleDate = todayStr();

    // return remaining goods to warehouse stock
    state.products.forEach(p => { state.stock[p.id] = (state.stock[p.id] || 0) + (remain[p.id] || 0); });

    saveState();
    closeModal();
    toast(`✅ ส่งยอดแล้ว ขาย ${totalSold} ชิ้น · เหลือ ${jobRemainTotal(j)} ชิ้นคืนคลัง`);
    renderMyShop();
  });
}

function jobRemainTotal(job) {
  return state.products.reduce((s, p) => s + (job.remain && job.remain[p.id] || 0), 0);
}

/* ---------------- History ---------------- */

function renderHistory() {
  const el = $('#view-history');
  const today = todayStr();
  const month = today.slice(0, 7);

  if (session.roleId === 'owner') {
    const closed = state.jobs.filter(j => j.status === 'closed').slice().sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));
    const closedToday = closed.filter(j => j.saleDate === today);
    const closedMonth = closed.filter(j => (j.saleDate || '').startsWith(month));
    const todayRev = closedToday.reduce((s, j) => s + j.expected, 0);
    const monthRev = closedMonth.reduce((s, j) => s + j.expected, 0);

    let html = `
      <h1 class="page-title">ประวัติการขาย 📊</h1>
      <p class="page-sub">สรุปยอดจากงานที่ปิดแล้ว</p>
      <div class="stat-grid">
        <div class="stat-card tint-green"><div class="stat-label">ยอดขายวันนี้</div><div class="stat-value">${fmtMoney(todayRev)}</div><div class="stat-hint">${fmtNum(closedToday.length)} งาน</div></div>
        <div class="stat-card tint-primary"><div class="stat-label">ยอดขายเดือนนี้</div><div class="stat-value">${fmtMoney(monthRev)}</div><div class="stat-hint">${fmtNum(closedMonth.length)} งาน</div></div>
      </div>
    `;
    if (!closed.length) {
      html += `<div class="empty-state"><div class="es-icon">🧾</div>ยังไม่มีประวัติการขาย</div>`;
    } else {
      closed.slice(0, 200).forEach(j => {
        const cls = j.diff === 0 ? 'ok' : (j.diff > 0 ? 'over' : 'short');
        const txt = j.diff === 0 ? 'ยอดตรง' : (j.diff > 0 ? `เกิน ${fmtMoney(j.diff)}` : `ขาด ${fmtMoney(Math.abs(j.diff))}`);
        html += `
          <div class="history-item" data-id="${j.id}">
            <div class="hi-head">
              <span class="hi-date">📍 ${escapeHtml(j.location)} · ${fmtDateThai(j.saleDate)}</span>
              <span class="hi-badge ${cls}">${txt}</span>
            </div>
            <div class="hi-row"><span>👤 ${escapeHtml(j.staffName || '—')} · ขาย ${fmtNum(j.totalSoldQty)} ชิ้น</span></div>
            <div class="hi-row"><span>ยอดขายที่ควรได้ ${fmtMoney(j.expected)}</span><b>รับ ${fmtMoney(j.received)}</b></div>
          </div>
        `;
      });
    }
    el.innerHTML = html;
    $$('.history-item', el).forEach(item => item.addEventListener('click', () => openJobDetail(item.dataset.id)));
    return;
  }

  // sales staff history
  const my = state.jobs.filter(j => j.staffId === session.staffId).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  let html = `
    <h1 class="page-title">ประวัติของฉัน 📊</h1>
    <p class="page-sub">งานทั้งหมดของคุณ</p>
  `;
  if (!my.length) {
    html += `<div class="empty-state"><div class="es-icon">🧾</div>ยังไม่มีงานของฉัน</div>`;
  } else {
    my.slice(0, 200).forEach(j => {
      const st = JOB_STATUS[j.status];
      html += `
        <div class="history-item" data-id="${j.id}">
          <div class="hi-head">
            <span class="hi-date">📍 ${escapeHtml(j.location)}</span>
            <span class="hi-badge ${st.cls}">${st.emoji} ${st.label}</span>
          </div>
          <div class="hi-row"><span>${fmtDateThai(j.saleDate || j.createdAt.slice(0, 10))} · ${fmtTime(j.createdAt)}</span></div>
          <div class="hi-row"><span>ส่งของ ${fmtNum(jobTakeTotal(j))} ชิ้น${j.status !== 'active' ? ` · ขาย ${fmtNum(j.totalSoldQty)} ชิ้น` : ''}</span></div>
        </div>
      `;
    });
  }
  el.innerHTML = html;
  $$('.history-item', el).forEach(item => item.addEventListener('click', () => openJobDetail(item.dataset.id)));
}

/* ---------------- Settings ---------------- */

function renderSettings() {
  if (session.roleId !== 'owner') {
    $('#view-settings').innerHTML = `<div class="empty-state"><div class="es-icon">🔒</div>เฉพาะเถ้าแก่เท่านั้นที่เข้าถึงส่วนนี้ได้</div>`;
    return;
  }
  const el = $('#view-settings');

  el.innerHTML = `
    <h1 class="page-title">ตั้งค่า ⚙️</h1>
    <p class="page-sub">จัดการร้าน พนักงาน สิทธิ รหัส และข้อมูล</p>

    <div class="card">
      <div class="card-title">ข้อมูลร้าน</div>
      <div class="setting-row">
        <div><div class="sr-label">ชื่อร้าน</div><div class="sr-desc">แสดงบนหน้าจอ</div></div>
        <input type="text" id="shopNameInput" value="${escapeHtml(state.settings.shopName)}" />
      </div>
      <button class="btn btn-primary btn-block" id="saveShopName" style="margin-top:12px">บันทึกชื่อร้าน</button>
    </div>

    <div class="card">
      <div class="card-title">จัดการพนักงานขาย 🧑‍💼</div>
      ${state.staff.map(s => `
        <div class="setting-row">
          <div><div class="sr-label">${escapeHtml(s.name)}</div><div class="sr-desc">PIN ${'•'.repeat((s.pin || '').length)}</div></div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-outline" data-staff-edit="${s.id}" style="min-height:0;padding:8px 12px">แก้ไข</button>
            <button class="btn btn-danger" data-staff-del="${s.id}" style="min-height:0;padding:8px 12px">ลบ</button>
          </div>
        </div>
      `).join('') || '<div style="color:var(--text-muted);padding:8px 0">ยังไม่มีพนักงาน</div>'}
      <button class="btn btn-primary btn-block" id="addStaff" style="margin-top:12px">➕ เพิ่มพนักงาน</button>
    </div>

    <div class="card">
      <div class="card-title">รหัส PIN ตำแหน่ง 🔑</div>
      <div class="setting-row">
        <div><div class="sr-label">👑 เถ้าแก่</div><div class="sr-desc">PIN ปัจจุบัน ${'•'.repeat((state.pins.owner || '').length)}</div></div>
        <button class="btn btn-outline" data-pin-role="owner" style="min-height:0;padding:8px 14px">แก้รหัส</button>
      </div>
      <div class="setting-row">
        <div><div class="sr-label">👨‍🍳 พนักงานครัว</div><div class="sr-desc">PIN ปัจจุบัน ${'•'.repeat((state.pins.kitchen || '').length)}</div></div>
        <button class="btn btn-outline" data-pin-role="kitchen" style="min-height:0;padding:8px 14px">แก้รหัส</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">ราคาสินค้า</div>
      ${state.products.map(p => `
        <div class="setting-row">
          <div><div class="sr-label">${p.emoji} ${p.name}</div></div>
          <input type="number" inputmode="decimal" min="0" step="1" data-price="${p.id}" value="${p.price}" />
        </div>
      `).join('')}
      <button class="btn btn-primary btn-block" id="savePrices" style="margin-top:12px">บันทึกราคา</button>
    </div>

    <div class="card">
      <div class="card-title">ข้อมูล & สำรอง</div>
      <button class="btn btn-soft btn-block" id="exportData">⬇️ สำรองข้อมูล (ดาวน์โหลดไฟล์)</button>
      <button class="btn btn-soft btn-block" id="importData" style="margin-top:8px">⬆️ นำเข้าข้อมูลจากไฟล์</button>
      <input type="file" id="importFile" accept="application/json" class="hidden" />
      <button class="btn btn-danger btn-block" id="resetData" style="margin-top:8px">🗑️ ล้างข้อมูลทั้งหมด</button>
    </div>

    <div class="card">
      <div class="card-title">ติดตั้งแอปลงเครื่อง 📲</div>
      <p class="page-sub" style="margin:0 0 8px">เปิดผ่าน Chrome/Edge (HTTPS หรือ localhost) แล้วกด “เพิ่มไปที่หน้าจอหลัก”</p>
      <button class="btn btn-green btn-block" id="installBtn" style="display:none">➕ ติดตั้งแอป</button>
      <div id="installHint" style="color:var(--text-muted);font-size:.85rem">เปิดผ่าน Chrome/Edge บน Android เพื่อติดตั้งลงหน้าจอหลัก</div>
    </div>
  `;

  $('#saveShopName').addEventListener('click', () => {
    state.settings.shopName = $('#shopNameInput').value.trim() || 'ร้านลาซานญ่า';
    $('#headerShopName').textContent = state.settings.shopName;
    saveState();
    toast('บันทึกชื่อร้านแล้ว');
  });

  $('#addStaff').addEventListener('click', () => openStaffEditor(null));
  $$('[data-staff-edit]', el).forEach(btn => btn.addEventListener('click', () => openStaffEditor(btn.dataset.staffEdit)));
  $$('[data-staff-del]', el).forEach(btn => btn.addEventListener('click', () => deleteStaff(btn.dataset.staffDel)));

  $$('[data-pin-role]', el).forEach(btn => btn.addEventListener('click', () => openPinEditor(btn.dataset.pinRole)));

  $('#savePrices').addEventListener('click', () => {
    state.products.forEach(p => {
      const inp = el.querySelector(`input[data-price="${p.id}"]`);
      if (inp) p.price = Math.max(0, round2(num(inp.value)));
    });
    saveState();
    toast('บันทึกราคาแล้ว');
  });

  $('#exportData').addEventListener('click', exportData);
  $('#importData').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', importData);
  $('#resetData').addEventListener('click', () => {
    openModal(`
      <div class="modal-title">🗑️ ล้างข้อมูลทั้งหมด</div>
      <p style="color:var(--red);font-weight:600">จะลบสต๊อก งาน ประวัติ พนักงาน และการตั้งค่าทั้งหมด แล้วกลับเป็นค่าเริ่มต้น ไม่สามารถย้อนกลับได้</p>
      <div class="modal-actions">
        <button class="btn btn-outline" id="resetCancel">ยกเลิก</button>
        <button class="btn btn-danger" id="resetConfirm">ลบทั้งหมด</button>
      </div>
    `);
    $('#resetCancel').addEventListener('click', closeModal);
    $('#resetConfirm').addEventListener('click', () => {
      state = defaultState();
      saveState();
      closeModal();
      toast('ล้างข้อมูลแล้ว');
      doLogout();
    });
  });

  const ib = $('#installBtn');
  if (installPromptEvent) {
    ib.style.display = 'block';
    $('#installHint').style.display = 'none';
    ib.addEventListener('click', () => {
      installPromptEvent.prompt();
      installPromptEvent.userChoice.then(() => { installPromptEvent = null; ib.style.display = 'none'; $('#installHint').style.display = 'block'; });
    });
  }
}

function openStaffEditor(id) {
  const s = id ? staffById(id) : null;
  openModal(`
    <div class="modal-title">${s ? '✏️ แก้ไขพนักงาน' : '➕ เพิ่มพนักงานขาย'}</div>
    <div class="field-label">ชื่อพนักงาน</div>
    <input type="text" id="staffName" maxlength="40" value="${s ? escapeHtml(s.name) : ''}" placeholder="เช่น สมชาย" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:12px" />
    <div class="field-label">รหัส PIN (ตัวเลข 4–6 หลัก)</div>
    <input type="password" inputmode="numeric" id="staffPin" maxlength="6" value="${s ? s.pin : ''}" placeholder="••••" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:12px;text-align:center;font-size:1.2rem;letter-spacing:.3em" />
    <div class="modal-actions">
      <button class="btn btn-outline" id="staffCancel">ยกเลิก</button>
      <button class="btn btn-primary" id="staffSave">บันทึก</button>
    </div>
  `);
  $('#staffCancel').addEventListener('click', closeModal);
  $('#staffSave').addEventListener('click', () => {
    const name = $('#staffName').value.trim();
    const pin = $('#staffPin').value;
    if (!name) return toast('ใส่ชื่อพนักงานก่อน');
    if (!/^\d{4,6}$/.test(pin)) return toast('PIN ต้องเป็นตัวเลข 4–6 หลัก');
    if (s) { s.name = name; s.pin = pin; }
    else { state.staff.push({ id: uid('staff'), name, pin }); }
    saveState();
    closeModal();
    toast(s ? 'แก้ไขพนักงานแล้ว' : `เพิ่มพนักงาน “${name}” แล้ว`);
    renderSettings();
  });
}

function deleteStaff(id) {
  const s = staffById(id);
  if (!s) return;
  const hasOpen = state.jobs.some(j => j.staffId === id && j.status !== 'closed');
  if (hasOpen) return toast('พนักงานนี้ยังมีงานที่กำลังขาย/รอปิดยอด ลบไม่ได้');
  if (!confirm(`ลบพนักงาน “${s.name}”?`)) return;
  state.staff = state.staff.filter(x => x.id !== id);
  saveState();
  toast('ลบพนักงานแล้ว');
  renderSettings();
}

function openPinEditor(roleId) {
  const role = LOGIN_ROLES.find(x => x.id === roleId);
  openModal(`
    <div class="modal-title">🔑 เปลี่ยนรหัส ${role.emoji} ${role.name}</div>
    <div class="field-label">รหัส PIN ใหม่ (ตัวเลข 4–6 หลัก)</div>
    <input type="password" inputmode="numeric" id="newPin1" maxlength="6" placeholder="••••" style="width:100%;padding:14px;border:1.5px solid var(--border);border-radius:12px;text-align:center;font-size:1.4rem;letter-spacing:.3em" />
    <div class="field-label">ยืนยันรหัสอีกครั้ง</div>
    <input type="password" inputmode="numeric" id="newPin2" maxlength="6" placeholder="••••" style="width:100%;padding:14px;border:1.5px solid var(--border);border-radius:12px;text-align:center;font-size:1.4rem;letter-spacing:.3em" />
    <div class="field-label">รหัส PIN ปัจจุบันของเถ้าแก่ (เพื่อยืนยันสิทธิ)</div>
    <input type="password" inputmode="numeric" id="curPin" maxlength="6" placeholder="••••" style="width:100%;padding:14px;border:1.5px solid var(--border);border-radius:12px;text-align:center;font-size:1.4rem;letter-spacing:.3em" />
    <div class="modal-actions">
      <button class="btn btn-outline" id="pinCancelBtn">ยกเลิก</button>
      <button class="btn btn-primary" id="pinSaveBtn">บันทึก</button>
    </div>
  `);
  $('#pinCancelBtn').addEventListener('click', closeModal);
  $('#pinSaveBtn').addEventListener('click', () => {
    const p1 = $('#newPin1').value;
    const p2 = $('#newPin2').value;
    const cur = $('#curPin').value;
    if (!/^\d{4,6}$/.test(p1)) return toast('PIN ต้องเป็นตัวเลข 4–6 หลัก');
    if (p1 !== p2) return toast('รหัสทั้งสองช่องไม่ตรงกัน');
    if (cur !== state.pins.owner) return toast('รหัสเถ้าแก่ปัจจุบันไม่ถูกต้อง');
    state.pins[roleId] = p1;
    saveState();
    closeModal();
    toast(`เปลี่ยนรหัส ${role.name} แล้ว`);
    renderSettings();
  });
}

/* ---------------- Backup / Restore ---------------- */

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calforcash-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('ดาวน์โหลดไฟล์สำรองแล้ว');
}

function importData(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.products) throw new Error('bad');
      if (!confirm('นำเข้าข้อมูลนี้จะทับข้อมูลปัจจุบัน ต้องการดำเนินการต่อ?')) return;
      const base = defaultState();
      state = {
        ...base,
        ...data,
        products: base.products.map((p, i) => ({ ...p, ...(data.products[i]) })),
        stock: { ...base.stock, ...(data.stock || {}) },
        pins: { owner: (data.pins && data.pins.owner) || base.pins.owner, kitchen: (data.pins && data.pins.kitchen) || base.pins.kitchen },
        staff: Array.isArray(data.staff) ? data.staff : [],
        jobs: Array.isArray(data.jobs) ? data.jobs : [],
        settings: { ...base.settings, ...(data.settings || {}) },
      };
      saveState();
      $('#headerShopName').textContent = state.settings.shopName;
      toast('นำเข้าข้อมูลสำเร็จ');
      renderSettings();
    } catch (e) {
      toast('⚠️ ไม่สามารถนำเข้าไฟล์นี้ได้');
      console.error(e);
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

/* ---------------- Escape helper ---------------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------------- PWA install ---------------- */

let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPromptEvent = e;
});

/* ---------------- Init ---------------- */

function init() {
  $('#loginShopName').textContent = state.settings.shopName;
  renderRoleList();
  initStockEvents();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW register failed', err));
  }
}

init();
