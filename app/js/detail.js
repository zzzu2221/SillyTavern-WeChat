/* ============ 角色详情页（微信个人资料风） ============ */
const Detail = (() => {
  let currentChar = null;
  let introOpen = false;
  let sessionsOpen = false; // 历史会话默认收起

  /** 该角色的备注 / 个签（存酒馆扩展设置 settings.charNotes[key]） */
  function notes(c) {
    let n = {};
    try {
      const s = API.getSettings() || {};
      n = (s.charNotes && s.charNotes[App.charKey(c)]) || {};
    } catch (e) {}
    return n;
  }
  function saveNotes(c, patch) {
    const s = API.getSettings() || {};
    const all = Object.assign({}, s.charNotes || {});
    all[App.charKey(c)] = Object.assign({}, all[App.charKey(c)] || {}, patch);
    API.saveAppSettings({ charNotes: all });
    if (App.state.config) App.state.config.charNotes = all;
  }
  function shownName(c) {
    const n = notes(c);
    return n.remark ? n.remark : App.displayName(c);
  }

  /** 角色间关系：settings.charRelations[keyA][keyB] = 关系（'陌生人'= 朋友圈不互评；未设置默认互通；支持自定义关系词） */
  const RELATIONS = ['认识', '陌生人', '情侣', '恋人', '好友', '兄弟', '姐妹', '家人', '死对头', '师生', '同事', '其他', '自定义…'];
  function relationsAll() {
    try { return (API.getSettings() || {}).charRelations || {}; } catch (e) { return {}; }
  }
  function relationBetween(keyA, keyB) {
    const all = relationsAll();
    if (!keyA || !keyB || keyA === keyB) return '';
    return (all[keyA] && all[keyB] && all[keyA][keyB]) || (all[keyB] && all[keyA] && all[keyB][keyA]) || '';
  }
  function saveRelation(keyA, keyB, rel) {
    const all = relationsAll();
    const a = Object.assign({}, all[keyA] || {});
    const b = Object.assign({}, all[keyB] || {});
    if (rel && rel !== '认识') { a[keyB] = rel; b[keyA] = rel; }
    else { delete a[keyB]; delete b[keyA]; }
    all[keyA] = a; all[keyB] = b;
    API.saveAppSettings({ charRelations: all });
    if (App.state.config) App.state.config.charRelations = all;
  }
  function saveAllRelations(key, map) {
    const all = relationsAll();
    Object.keys(map).forEach(k => {
      const rel = map[k];
      const a = Object.assign({}, all[key] || {});
      const b = Object.assign({}, all[k] || {});
      if (rel && rel !== '认识') { a[k] = rel; b[key] = rel; }
      else { delete a[k]; delete b[key]; }
      all[key] = a; all[k] = b;
    });
    API.saveAppSettings({ charRelations: all });
    if (App.state.config) App.state.config.charRelations = all;
  }

  /** 生图是否启用（设置面板「启用生图」开关，关闭时隐藏删除功能） */
  function imgEnabled() {
    const cfg = App.state.config || {};
    return cfg.imageEnabled !== false;
  }

  /** 拆分开场白：先按 ||| 拆默认开场白，再并入 alternate_greetings（酒馆原生多开场白） */
  function splitGreetings(c) {
    const list = [];
    const g = (c && c.greeting) ? String(c.greeting).trim() : '';
    if (g) {
      const parts = g.split('|||').map(x => x.trim()).filter(Boolean);
      list.push.apply(list, parts.length ? parts : [g]);
    }
    (c && Array.isArray(c.alternateGreetings) ? c.alternateGreetings : []).forEach(a => {
      const t = String(a).trim();
      if (t) list.push(t);
    });
    const seen = {};
    return list.filter(t => {
      const k = t.slice(0, 30);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function hasGreetingSession(c, greetingText) {
    const sessions = Store.sessionsOf(App.charKey(c), c.name);
    const target = String(greetingText).slice(0, 40);
    return sessions.some(s => (s.preview || '').indexOf(target) >= 0);
  }

  function render() {
    const c = currentChar;
    if (!c) return;
    const body = document.getElementById('detail-body');
    const key = App.charKey(c);
    const n = notes(c);
    document.getElementById('detail-title').textContent = shownName(c);

    const avatar = UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
    const desc = c.description || c.personality || '';
    const sessions = Store.sessionsOf(key, c.name);
    const greetings = splitGreetings(c);

    // 更多信息（简介）——默认收起，点击展开
    const moreHtml = desc ? `
      <div class="detail-cell" id="detail-more">
        <span class="dc-label">更多信息</span>
        <span class="dc-value">${introOpen ? UI.esc(desc).replace(/\n/g, '<br>') : (desc.slice(0, 28) + (desc.length > 28 ? '…' : ''))}</span>
        <span class="dc-arrow">${introOpen ? '▴' : '▾'}</span>
      </div>` : '';

    const greetingHtml = greetings.length > 1
      ? `<div class="detail-greetings">${greetings.map((g, i) => `
          <button class="greeting-btn" data-i="${i}">开场白 ${i + 1}${hasGreetingSession(c, g) ? ' ✓' : ''}</button>`).join('')}
        </div>`
      : '';

    const sessionRows = sessions.map((s, i) => `
      <div class="list-item session-item" data-file="${UI.esc(s.file)}">
        <div class="list-main">
          <div class="list-title" style="font-size:14px">${UI.esc(s.title)}</div>
          <div class="list-sub">${UI.esc(s.preview || '空会话')}</div>
        </div>
        <div class="list-meta">${UI.fmtTime(s.updatedAt)}</div>
        <span class="session-del" data-file="${UI.esc(s.file)}" title="删除该会话">✕</span>
      </div>`).join('');

    body.innerHTML = `
      <div class="detail-hero">
        <div class="avatar lg">${avatar}</div>
        <div class="name">${UI.esc(shownName(c))}</div>
        <div class="sig">${UI.esc(n.signature || '这个人很懒，什么都没留下…')}</div>
        ${c.avatar_file && c.avatar_file !== 'none' ? `<div class="wxid">微信号：${UI.esc(c.avatar_file)}</div>` : ''}
      </div>
      <div class="detail-cells">
        <div class="detail-cell" id="detail-cell-moments"><span class="dc-label">朋友圈</span><span class="dc-arrow">›</span></div>
        ${moreHtml}
        <div class="detail-cell" id="detail-cell-sig"><span class="dc-label">个性签名</span><span class="dc-value">${UI.esc(n.signature || '未设置')}</span><span class="dc-arrow">›</span></div>
        <div class="detail-cell" id="detail-cell-remark"><span class="dc-label">设置备注</span><span class="dc-value">${UI.esc(n.remark || '未设置')}</span><span class="dc-arrow">›</span></div>
        <div class="detail-cell" id="detail-cell-rels"><span class="dc-label">角色关系</span><span class="dc-value">${relsCountText(c)}</span><span class="dc-arrow">›</span></div>
        <div class="detail-cell" id="detail-cell-bg"><span class="dc-label">聊天背景</span><span class="dc-value">${UI.esc(n.chatBg ? '已设置' : '默认')}</span><span class="dc-arrow">›</span></div>
      </div>
      <div class="detail-msgwrap"><button class="btn-detail-msg" id="detail-msg">发消息</button></div>
      ${greetingHtml}
      <div class="detail-sessions">
        <div class="detail-cell" id="detail-sessions-toggle">
          <span class="dc-label">历史会话（${sessions.length}）</span><span class="dc-arrow">${sessionsOpen ? '▴' : '▾'}</span>
        </div>
        ${sessionsOpen ? (sessions.length ? `<div class="list" id="detail-sessions">${sessionRows}</div>` : `<div class="empty">暂无历史会话</div>`) : ''}
      </div>
      <div class="detail-newline"><button class="btn-new-session" id="detail-new">＋ 新建会话</button></div>
    `;

    // 发消息
    document.getElementById('detail-msg').addEventListener('click', () => {
      App.openCharacter(c);
    });
    // 新建会话（单开场白带开场白开档）
    document.getElementById('detail-new').addEventListener('click', async () => {
      UI.toast('创建会话中…');
      try {
        let s;
        if (greetings.length) s = await Chat.createGreetingSession(c, greetings[0], greetings.length > 1 ? '开场白 1' : undefined);
        else s = await Chat.createSession(c);
        Chat.open(c, s);
      } catch (e) { UI.toast('创建失败：' + e.message); }
    });
    // 朋友圈 → 该角色自己的朋友圈
    document.getElementById('detail-cell-moments').addEventListener('click', () => {
      Moments.openFor(c);
    });
    // 更多信息
    const moreEl = document.getElementById('detail-more');
    if (moreEl) moreEl.addEventListener('click', () => { introOpen = !introOpen; render(); });
    // 个性签名编辑
    document.getElementById('detail-cell-sig').addEventListener('click', async () => {
      const val = await editPrompt('个性签名', n.signature || '');
      if (val == null) return;
      saveNotes(c, { signature: val });
      UI.toast('已保存');
      render();
    });
    // 设置备注
    document.getElementById('detail-cell-remark').addEventListener('click', async () => {
      const val = await editPrompt('设置备注（微信里显示的名字）', n.remark || '');
      if (val == null) return;
      saveNotes(c, { remark: val });
      UI.toast('已保存');
      render();
      if (typeof ChatList !== 'undefined') ChatList.render();
    });
    // 角色间关系
    const relsEl = document.getElementById('detail-cell-rels');
    if (relsEl) relsEl.addEventListener('click', () => openRelationModal(c));
    // 聊天背景（该角色专属；支持色值/图片URL，留空恢复全局默认）
    document.getElementById('detail-cell-bg').addEventListener('click', async () => {
      const val = await editPrompt('聊天背景\n支持：色值（如 #E8E8E8）或图片链接；留空 = 用全局默认', n.chatBg || '', true);
      if (val == null) return;
      saveNotes(c, { chatBg: val });
      UI.toast('已保存，进入该角色聊天即可看到');
      render();
    });

    // 历史会话折叠
    document.getElementById('detail-sessions-toggle').addEventListener('click', () => { sessionsOpen = !sessionsOpen; render(); });

    // 开场白按钮
    body.querySelectorAll('.greeting-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const i = Number(btn.dataset.i);
        const g = greetings[i];
        if (!g) return;
        if (hasGreetingSession(c, g)) {
          const s2 = Store.sessionsOf(key, c.name).find(x => (x.preview || '').indexOf(String(g).slice(0, 40)) >= 0);
          if (s2) return Chat.open(c, s2);
        }
        UI.toast('正在用「开场白 ' + (i + 1) + '」开档…');
        try {
          const s = await Chat.createGreetingSession(c, g, '开场白 ' + (i + 1));
          Chat.open(c, s);
        } catch (e) { UI.toast('创建失败：' + e.message); }
      });
    });

    // 历史会话：打开 / 删除
    const listEl = document.getElementById('detail-sessions');
    if (listEl) {
      listEl.querySelectorAll('.session-item').forEach(el => {
        el.addEventListener('click', () => {
          const s = Store.sessionsOf(key, c.name).find(x => x.file === el.dataset.file);
          if (s) Chat.open(c, s);
        });
      });
      listEl.querySelectorAll('.session-del').forEach(del => {
        del.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const file = del.dataset.file;
          const s = Store.sessionsOf(key, c.name).find(x => x.file === file);
          if (!s) return;
          const ok = await UI.confirm('删除会话「' + (s.title || file) + '」？酒馆里的聊天文件也会一并删除。', { okText: '删除' });
          if (!ok) return;
          try {
            await Chat.deleteSession(c, s);
            UI.toast('已删除');
            render();
          } catch (e) { UI.toast('删除失败：' + e.message); }
        });
      });
    }
  }

  /** 自绘单行输入弹窗，返回输入值；取消返回 null */
  function editPrompt(title, value, showUpload) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'wx-confirm-mask';
      mask.innerHTML = `
        <div class="wx-confirm">
          <div class="wx-confirm-title">${UI.esc(title)}</div>
          <input class="wx-confirm-input" value="${UI.esc(value || '')}">
          ${showUpload ? `<div style="text-align:center;margin:8px 0 0">
            <button type="button" class="wx-confirm-btn" id="wx-chatbg-upload" style="background:#fff;color:#07c160;border:1px solid #07c160">＋ 上传本地图片</button>
            <input type="file" id="wx-chatbg-file" accept="image/*" style="position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0">
          </div>` : ''}
          <div class="wx-confirm-btns">
            <button class="wx-confirm-btn wx-confirm-cancel" type="button">取消</button>
            <button class="wx-confirm-btn wx-confirm-ok" type="button">保存</button>
          </div>
        </div>`;
      const input = mask.querySelector('.wx-confirm-input');
      const ok = mask.querySelector('.wx-confirm-ok');
      const cancel = mask.querySelector('.wx-confirm-cancel');
      const done = v => { mask.remove(); resolve(v); };
      if (showUpload) {
        const upBtn = mask.querySelector('#wx-chatbg-upload');
        const upFile = mask.querySelector('#wx-chatbg-file');
        upBtn.addEventListener('click', () => upFile.click());
        upFile.addEventListener('change', () => {
          const f = upFile.files && upFile.files[0];
          if (!f) return;
          const fr = new FileReader();
          fr.onload = () => { input.value = fr.result; UI.toast('已载入图片，保存后生效'); };
          fr.readAsDataURL(f);
        });
      }
      ok.addEventListener('click', () => done(input.value.trim()));
      cancel.addEventListener('click', () => done(null));
      mask.addEventListener('click', e => { if (e.target === mask) done(null); });
      document.body.appendChild(mask);
      input.focus();
      input.select();
    });
  }

  /** 角色间关系：当前角色为"主角"，列出通讯录其他角色逐个选关系（陌生人 = 朋友圈不互评） */
  function relsCountText(c) {
    try {
      const all = relationsAll();
      const n = Object.keys(all[App.charKey(c)] || {}).length;
      return n ? `已设置 ${n} 个关系` : '管理与其他角色';
    } catch (e) { return '管理与其他角色'; }
  }
  function openRelationModal(c) {
    const myKey = App.charKey(c);
    const others = App.state.characters.filter(x => App.charKey(x) !== myKey);
    const PRESET = RELATIONS.filter(r => r !== '自定义…');
    const mask = document.createElement('div');
    mask.className = 'wx-confirm-mask';
    mask.innerHTML = `
      <div class="wx-confirm" style="max-width:420px;width:88vw">
        <div class="wx-confirm-title">「${UI.esc(shownName(c))}」与其他角色的关系</div>
        <div style="font-size:12px;color:#999;margin-bottom:8px;line-height:1.5">「陌生人」= 朋友圈里互不评论；其他关系用于让 AI 把握互动；选「自定义…」可输入专属称呼（如「前辈」）。未设置的默认互通。</div>
        <div class="acct-rel-list rels-list" style="max-height:55vh;overflow-y:auto">
          ${others.length ? others.map(x => {
            const rel = relationBetween(myKey, App.charKey(x));
            const known = !!rel && PRESET.indexOf(rel) >= 0;
            const selVal = rel ? (known ? rel : '__custom__') : '认识';
            const customWord = rel && !known ? rel : '';
            return `<div class="acct-rel">
              <div class="acct-rel-head">
                <div class="avatar">${UI.avatarSrc(x.avatar) ? `<img src="${UI.esc(UI.avatarSrc(x.avatar))}">` : ''}</div>
                <div class="acct-rel-name">${UI.esc(shownName(x))}</div>
                <select class="acct-rel-type" data-k="${UI.esc(App.charKey(x))}" data-custom="${UI.esc(customWord)}">${PRESET.map(r => `<option value="${r}"${r === selVal ? ' selected' : ''}>${r}</option>`).join('')}<option value="__custom__"${selVal === '__custom__' ? ' selected' : ''}>自定义…</option></select>
              </div>
              <div class="acct-rel-sub"><input class="acct-rel-custom" data-k="${UI.esc(App.charKey(x))}" placeholder="自定义关系词（选「自定义…」时填写）" value="${UI.esc(customWord)}" style="display:${selVal === '__custom__' ? 'block' : 'none'};width:100%;box-sizing:border-box"></div>
            </div>`;
          }).join('') : '<div class="acct-rel-empty">暂无其他角色</div>'}
        </div>
        <div class="wx-confirm-btns">
          <button class="wx-confirm-btn wx-confirm-cancel" type="button">取消</button>
          <button class="wx-confirm-btn wx-confirm-ok" type="button">保存</button>
        </div>
      </div>`;
    // 「自定义…」选中时显示输入框
    mask.querySelectorAll('.acct-rel-type').forEach(sel => {
      sel.addEventListener('change', () => {
        const sub = mask.querySelector('.acct-rel-custom[data-k="' + sel.dataset.k + '"]');
        if (sub) sub.style.display = sel.value === '__custom__' ? 'block' : 'none';
      });
    });
    const ok = mask.querySelector('.wx-confirm-ok');
    const cancel = mask.querySelector('.wx-confirm-cancel');
    const done = saved => { mask.remove(); if (saved) { render(); UI.toast('已保存角色关系'); } };
    ok.addEventListener('click', () => {
      const map = {};
      mask.querySelectorAll('.acct-rel-type').forEach(sel => {
        if (sel.value === '__custom__') {
          const sub = mask.querySelector('.acct-rel-custom[data-k="' + sel.dataset.k + '"]');
          map[sel.dataset.k] = (sub && sub.value.trim()) || '认识';
        } else {
          map[sel.dataset.k] = sel.value;
        }
      });
      saveAllRelations(myKey, map);
      done(true);
    });
    cancel.addEventListener('click', () => done(false));
    mask.addEventListener('click', e => { if (e.target === mask) done(false); });
    document.body.appendChild(mask);
  }

  function open(character) {
    currentChar = character;
    App.state.currentCharacter = character;
    introOpen = false;
    App.showPage('page-detail', render);
  }

  function init() {
    document.getElementById('btn-detail-back').addEventListener('click', () => {
      const cur = Store.getCurrent();
      if (cur && cur.charKey) {
        const c = App.charByKey(cur.charKey);
        const s = Store.sessionsOf(cur.charKey, cur.charName).find(x => x.file === cur.file);
        if (c && s) return Chat.open(c, s);
      }
      App.showTab('chatlist');
    });
  }

  return { open, init, shownName };
})();
