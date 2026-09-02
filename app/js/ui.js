/* ============ 通用 UI 工具 ============ */
const UI = (() => {
  let toastTimer = null;
  function toast(msg, ms = 2200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** 头像 img src：data:base64 直接用；文件名走 /api/avatar 代理；其它返回 '' */
  function avatarSrc(avatar) {
    if (!avatar || typeof avatar !== 'string') return '';
    if (avatar.startsWith('data:')) return avatar;
    return '/api/avatar?file=' + encodeURIComponent(avatar);
  }

  /** 头像 DOM：data:base64 直接用；文件名则走 /api/avatar 代理；都没有则占位 */
  function avatarEl(avatar, cls = 'avatar') {
    const div = document.createElement('div');
    div.className = cls;
    const src = avatarSrc(avatar);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.onerror = () => { img.remove(); };
      div.appendChild(img);
    } else {
      div.textContent = '头像';
    }
    return div;
  }

  /** 时间格式化：今天 HH:MM / 昨天 / MM-DD / YYYY-MM-DD */
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (sameDay) return hm;
    if (d.toDateString() === yest.toDateString()) return '昨天';
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** 全屏图片预览 */
  function lightbox(src) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    const img = document.createElement('img');
    img.src = src;
    box.appendChild(img);
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** 微信风格自定义确认弹窗（替代浏览器 confirm），返回 Promise<boolean> */
  function confirm(msg, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'wx-confirm-mask';
      mask.innerHTML = `
        <div class="wx-confirm">
          <div class="wx-confirm-msg">${esc(msg)}</div>
          <div class="wx-confirm-btns">
            <button class="wx-confirm-btn wx-confirm-cancel" type="button">${esc(opts.cancelText || '取消')}</button>
            <button class="wx-confirm-btn wx-confirm-ok" type="button">${esc(opts.okText || '确定')}</button>
          </div>
        </div>`;
      const okBtn = mask.querySelector('.wx-confirm-ok');
      const cancelBtn = mask.querySelector('.wx-confirm-cancel');
      const done = val => { mask.remove(); resolve(val); };
      okBtn.addEventListener('click', () => done(true));
      cancelBtn.addEventListener('click', () => done(false));
      mask.addEventListener('click', e => { if (e.target === mask) done(false); });
      document.body.appendChild(mask);
    });
  }

  /** 微信风格轻提示弹窗（替代 alert） */
  function alert(msg) {
    return confirm(msg, { okText: '好的', cancelText: '' }).then(() => {});
  }

  return { toast, avatarEl, avatarSrc, fmtTime, lightbox, esc, confirm, alert };
})();
