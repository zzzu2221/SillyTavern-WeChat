/* ============ 微信（会话列表）页 ============ */
const ChatList = (() => {
  function collectSessions() {
    const items = [];
    const chars = App.state.characters;
    for (const c of chars) {
      const sessions = Store.sessionsOf(App.charKey(c), c.name);
      if (sessions.length) {
        const s = sessions[0]; // 最近一个
        items.push({ char: c, session: s });
      }
    }
    items.sort((a, b) => (b.session.updatedAt || 0) - (a.session.updatedAt || 0));
    return items;
  }

  function render() {
    const body = document.getElementById('chatlist-body');
    const items = collectSessions();
    if (!items.length) {
      body.innerHTML = `<div class="empty"><div class="big">💬</div>还没有会话<br><br>去「通讯录」选一个角色开始聊天吧</div>`;
      return;
    }
    const html = items.map(it => {
      const c = it.char;
      const s = it.session;
      const avatar = UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
      return `<div class="list-item session-item" data-key="${UI.esc(App.charKey(c))}" data-file="${UI.esc(s.file)}">
        <div class="avatar">${avatar}</div>
        <div class="list-main">
          <div class="list-title">${UI.esc((typeof Detail !== 'undefined' && Detail.shownName) ? Detail.shownName(c) : App.displayName(c))}</div>
          <div class="list-sub">${UI.esc(window.stripActions ? window.stripActions(s.preview || '') : (s.preview || '开始聊天吧'))}</div>
        </div>
        <div class="list-meta">${UI.fmtTime(s.updatedAt)}</div>
      </div>`;
    }).join('');
    body.innerHTML = `<div class="list">${html}</div>`;
    body.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', () => {
        const c = App.charByKey(el.dataset.key);
        if (!c) return;
        const s = Store.sessionsOf(App.charKey(c), c.name).find(x => x.file === el.dataset.file);
        if (c && s) Chat.open(c, s);
      });
    });
  }

  function initAddButton() {
    document.getElementById('btn-chatlist-add').addEventListener('click', () => {
      const chars = App.state.characters;
      if (!chars.length) return UI.toast('暂无角色');
      // 简单角色选择弹层：用 toast 列表弹层
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      const card = document.createElement('div');
      card.className = 'modal-card';
      card.innerHTML = `<div class="modal-title">选择角色发起会话</div><div class="list" id="picker-list"></div>`;
      const list = card.querySelector('#picker-list');
      list.innerHTML = chars.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh')).map(c =>
        `<div class="list-item picker-item" data-key="${UI.esc(App.charKey(c))}"><div class="avatar sm">${UI.avatarSrc(c.avatar)?`<img src="${UI.esc(UI.avatarSrc(c.avatar))}">`:''}</div><div class="list-main"><div class="list-title">${UI.esc(App.displayName(c))}</div></div></div>`
      ).join('');
      card.querySelectorAll('.picker-item').forEach(el => {
        el.addEventListener('click', async () => {
          mask.remove();
          const c = App.charByKey(el.dataset.key);
          if (!c) return;
          UI.toast('创建会话中…');
          try {
            const s = await Chat.createSession(c);
            Chat.open(c, s);
          } catch (e) { UI.toast('创建失败：' + e.message); }
        });
      });
      mask.appendChild(card);
      mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
      document.body.appendChild(mask);
    });
  }

  return { render, initAddButton };
})();
