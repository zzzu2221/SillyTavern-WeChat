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

  function totalUnread() {
    let n = 0;
    for (const c of App.state.characters) {
      const ss = Store.sessionsOf(App.charKey(c), c.name);
      for (const s of ss) n += (s.unread || 0);
    }
    return n;
  }

  /** 底部"微信"Tab 总未读红点 */
  function refreshTabBadge() {
    const tab = document.getElementById('tab-chatlist');
    if (!tab) return;
    const n = totalUnread();
    let b = tab.querySelector('.tab-badge');
    if (n > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'tab-badge'; tab.appendChild(b); }
      b.textContent = n > 99 ? '99+' : n;
    } else if (b) b.remove();
  }

  function render() {
    const body = document.getElementById('chatlist-body');
    const items = collectSessions();
    // 并行拉群聊，合并到会话列表
    Promise.all([
      Promise.resolve(items),
      (typeof API.listWeChatGroups === 'function') ? API.listWeChatGroups().catch(() => []) : Promise.resolve([]),
    ]).then(([chatItems, groups]) => {
      const rows = [
        ...(groups || []).map(g => ({ type: 'group', g, ts: g.lastTime ? new Date(g.lastTime) : new Date(g.createdAt || 0) })),
        ...chatItems.map(it => ({ type: 'chat', it, ts: new Date(it.session.updatedAt || 0) })),
      ].sort((a, b) => b.ts - a.ts);
      if (!rows.length) {
        body.innerHTML = `<div class="empty"><div class="big">💬</div>还没有会话<br><br>去「通讯录」选一个角色开始聊天吧</div>`;
        refreshTabBadge();
        return;
      }
      const html = rows.map(row => {
        if (row.type === 'group') return groupRowHtml(row.g);
        const c = row.it.char;
        const s = row.it.session;
        const avatar = UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
        const unread = (s.unread || 0);
        const badge = unread > 0 ? `<span class="list-badge avatar-badge">${unread > 99 ? '99+' : unread}</span>` : '';
        return `<div class="list-item session-item" data-key="${UI.esc(App.charKey(c))}" data-file="${UI.esc(s.file)}">
          <div class="avatar-wrap">${avatar ? `<div class="avatar">${avatar}</div>` : `<div class="avatar"></div>`}${badge}</div>
          <div class="list-main">
            <div class="list-title">${UI.esc((typeof Detail !== 'undefined' && Detail.shownName) ? Detail.shownName(c) : App.displayName(c))}</div>
            <div class="list-sub">${UI.esc(s.typing ? '正在输入…' : (window.stripActions ? window.stripActions(s.preview || '') : (s.preview || '开始聊天吧')))}</div>
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
      body.querySelectorAll('.group-item').forEach(el => {
        el.addEventListener('click', () => {
          if (typeof GroupChat !== 'undefined' && GroupChat.openGroupChat) GroupChat.openGroupChat(el.dataset.name, 'page-chatlist');
        });
      });
      refreshTabBadge();
    });
  }

  function groupRowHtml(g) {
    const unread = (g.unread || 0);
    const badge = unread > 0 ? `<span class="list-badge avatar-badge">${unread > 99 ? '99+' : unread}</span>` : '';
    const avatar = g.avatar
      ? `<img src="${UI.esc(g.avatar)}">`
      : (groupAvatarImg(g));
    const preview = g.lastPreview ? UI.esc(window.stripActions ? window.stripActions(g.lastPreview) : g.lastPreview) : '群聊已创建，快来发第一条消息吧';
    return `<div class="list-item group-item" data-name="${UI.esc(g.name)}">
      <div class="avatar-wrap"><div class="avatar g-avatar">${avatar}</div>${badge}</div>
      <div class="list-main">
        <div class="list-title">${UI.esc(g.displayName || g.name)}（${(g.memberKeys || []).length}）</div>
        <div class="list-sub">${preview}</div>
      </div>
      <div class="list-meta">${g.lastTime ? UI.fmtTime(g.lastTime) : ''}</div>
    </div>`;
  }
  function groupAvatarImg(g) {
    const key = (g.memberKeys && g.memberKeys[0]) || '';
    const c = key ? App.charByKey(key) : null;
    if (c && UI.avatarSrc(c.avatar)) return `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">`;
    return '<span class="g-avatar-fallback">👥</span>';
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
      card.innerHTML = `<div class="modal-title">选择角色发起会话</div>
        <div class="picker-new-group" id="picker-new-group">＋ 新建群聊</div>
        <div class="list" id="picker-list"></div>`;
      const list = card.querySelector('#picker-list');
      const newGroup = card.querySelector('#picker-new-group');
      newGroup.addEventListener('click', () => {
        mask.remove();
        if (typeof GroupChat !== 'undefined' && GroupChat.openCreateModal) GroupChat.openCreateModal();
      });
      list.innerHTML = chars.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh')).map(c =>
        `<div class="list-item picker-item" data-key="${UI.esc(App.charKey(c))}"><div class="avatar sm">${UI.avatarSrc(c.avatar)?`<img src="${UI.esc(UI.avatarSrc(c.avatar))}">`:''}</div><div class="list-main"><div class="list-title">${UI.esc((typeof Detail !== 'undefined' && Detail.shownName) ? Detail.shownName(c) : App.displayName(c))}</div></div></div>`
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

  return { render, initAddButton, totalUnread, refreshTabBadge };
})();
