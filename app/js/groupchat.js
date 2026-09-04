/* ============ 微信群聊：群列表 / 群会话 / 建群 / AI 群回复 ============ */
const GroupChat = (() => {
  let current = null;   // {name, meta, members, messages}
  let busy = false;
  let backTo = 'page-chatlist';    // 进入群会话前的页面（返回用）
  let groupsBack = 'page-chatlist'; // 进入群列表前的页面
  let pollTimer = null; // 群聊页停留时自动轮询新消息（AI 后台回复实时弹出）

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function currentPageId() {
    const p = Array.from(document.querySelectorAll('.page')).find(x => x.style.display !== 'none');
    return p ? p.id : 'page-chatlist';
  }
  function isGroupPageVisible() {
    const p = document.getElementById('page-group-chat');
    return p && p.style.display !== 'none' && !!current;
  }
  /** 群聊页停留时轮询：AI 后台回复/系统通知写入后自动刷新（不打断输入与浏览位置） */
  async function pollOnce() {
    if (!current || !current.name) return;
    try {
      const fresh = await API.getWeChatGroup(current.name);
      if (!fresh) return;
      const body = document.getElementById('group-chat-body');
      const nearBottom = !body || (body.scrollHeight - body.scrollTop - body.clientHeight < 80);
      const oldArr = current.messages || [], newArr = fresh.messages || [];
      const oldLast = oldArr.length ? oldArr[oldArr.length - 1] : null;
      const newLast = newArr.length ? newArr[newArr.length - 1] : null;
      const changed = newArr.length !== oldArr.length || (oldLast && newLast && oldLast._rawIndex !== newLast._rawIndex);
      if (!changed) return;
      const prevScroll = body ? body.scrollTop : 0;
      current = fresh;
      renderChat(nearBottom);
      if (body && !nearBottom) body.scrollTop = prevScroll;
      if (typeof ChatList !== 'undefined' && ChatList.render) ChatList.render();
    } catch (e) {}
  }
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (isGroupPageVisible()) pollOnce(); }, 2500);
    pollOnce(); // 打开时立即同步一次
  }

  const EMOJIS = ['😀','😄','😂','🤣','😊','😉','😍','😘','😜','🤪','😎','🥳','😏','😳','🥺','😢','😭','😤','😡','🤯','😱','🥰','😋','🤭','🫣','👍','👏','🙏','💪','🤝','👋','❤️','💔','💯','✨','🔥','🎉','🌈','🍀','🌙','🍰','☕','🐱','🐶','🐰','🐼','🦊','🐷','🦄','🙈','🙉','🙊','💬','❓','❗','✅','💤','🎮','📱','🎵','🎤','🏆','🌹'];

  function meInfo() {
    let p = null;
    try { p = (typeof Me !== 'undefined') ? Me.activePlayer() : null; } catch (e) {}
    return p || { name: '我', key: '__me__', avatar: '' };
  }
  function playerKey() {
    let pk = '__me__';
    try { const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null; if (p && p.id) pk = '__me__' + p.id; } catch (e) {}
    return pk;
  }
  /** 当前玩家账号的人设文本（身份/签名/挂载世界书），切换账号自动跟随；截断避免撑爆 prompt */
  function meDescText() {
    try {
      const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
      if (!p) return '';
      return [p.description, p.signature, p.worldbook].filter(Boolean).join('\n').slice(0, 600);
    } catch (e) { return ''; }
  }
  function groupAvatarHtml(g) {
    // 优先用自定义群头像（群信息页上传）；否则跳过玩家取第一个非玩家成员头像，再兜底默认群图标
    if (g && g.avatar && UI.avatarSrc(g.avatar)) return `<img src="${UI.esc(UI.avatarSrc(g.avatar))}">`;
    const keys = (g.memberKeys || []).filter(k => String(k || '').indexOf('__me__') !== 0);
    const key = keys[0] || '';
    const c = key ? App.charByKey(key) : null;
    if (c && UI.avatarSrc(c.avatar)) return `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">`;
    return '<span class="g-avatar-fallback">👥</span>';
  }
  function userAvatarHtml() {
    const p = meInfo();
    if (p && p.avatar && UI.avatarSrc(p.avatar)) return `<img src="${UI.esc(UI.avatarSrc(p.avatar))}">`;
    return '<span class="g-avatar-fallback">👤</span>';
  }
  function memberAvatarHtml(key, fallbackName) {
    if (!current) return '';
    // 优先按 key 匹配；历史坏消息 key 可能是名字 → 用名字兜底反查
    let m = current.members.find(x => x.key === key);
    if (!m && fallbackName) m = current.members.find(x => x.name === fallbackName);
    // 名字带空格的角色卡（如「 虎杖悠仁」）去空格后匹配群成员，历史坏消息也能对上用户实际使用的卡
    if (!m && fallbackName) {
      const t = String(fallbackName).trim();
      if (t) m = current.members.find(x => String(x.name || '').trim() === t);
    }
    if (!m) {
      // 最终兜底：直接用角色卡查头像，避免空白
      const c = key ? App.charByKey(key) : (fallbackName ? App.charByName(fallbackName) : null);
      if (c && UI.avatarSrc(c.avatar)) return `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">`;
      return '';
    }
    const c = m ? App.charByKey(m.key) : null;
    if (c && UI.avatarSrc(c.avatar)) return `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">`;
    return '';
  }
  /** 微信里显示的角色名：优先备注；玩家（__me__）→ 当前账号微信名 */
  function charDisplayName(key, fallback) {
    if (key && String(key).indexOf('__me__') === 0) {
      const p = meInfo();
      return (p && (p.name || '我')) || '我';
    }
    const c = key ? App.charByKey(key) : null;
    if (!c) return fallback || key || '';
    // 显示名去空格（兼容角色卡名带空格，如「 虎杖悠仁」→「虎杖悠仁」）
    const n = String((typeof Detail !== 'undefined' && Detail.shownName) ? Detail.shownName(c) : App.displayName(c)).trim();
    return n || fallback || key || '';
  }

  /* ---------------- 群列表（已并入主「微信」列表，无独立群聊页） ---------------- */
  function openGroups() {
    // 群聊显示在主列表，不再有独立「群聊」页面；此处仅返回主列表并刷新
    App.showTab('chatlist');
    try { if (typeof ChatList !== 'undefined' && ChatList.render) ChatList.render(); } catch (e) {}
  }
  async function renderGroups() {
    const body = document.getElementById('groups-body');
    body.innerHTML = '<div class="loading">加载中…</div>';
    try {
      const groups = await API.listWeChatGroups();
      if (!groups.length) {
        body.innerHTML = `<div class="empty"><div class="big">👥</div>还没有群聊<br><br>点右上角「＋」新建一个群吧</div>`;
        return;
      }
      groups.sort((a, b) => (b.lastTime ? new Date(b.lastTime) : 0) - (a.lastTime ? new Date(a.lastTime) : 0));
      body.innerHTML = `<div class="list">` + groups.map(g => {
        const gname = g.displayName || g.name;
        const preview = g.lastPreview ? UI.esc(g.lastPreview) : '群聊已创建，快来发第一条消息吧';
        return `<div class="list-item group-item" data-name="${UI.esc(g.name)}">
          <div class="avatar g-avatar">${groupAvatarHtml(g)}</div>
          <div class="list-main">
            <div class="list-title">${UI.esc(gname)}（${(g.memberKeys || []).length}）</div>
            <div class="list-sub">${preview}</div>
          </div>
          <div class="list-meta">${g.lastTime ? UI.fmtTime(g.lastTime) : ''}</div>
        </div>`;
      }).join('') + `</div>`;
      body.querySelectorAll('.group-item').forEach(el => {
        el.addEventListener('click', () => openGroupChat(el.dataset.name, groupsBack));
      });
    } catch (e) {
      body.innerHTML = `<div class="empty"><div class="big">⚠️</div>加载失败<br>${UI.esc(e.message)}</div>`;
    }
  }

  /* ---------------- 群会话 ---------------- */
  async function openGroupChat(name, from) {
    if (from) backTo = from;
    // 打开群时强制刷新角色列表，同步用户在酒馆改过的头像/标签（force 绕过 60s 缓存）
    try { if (typeof App !== 'undefined' && App.refreshCharacters) await App.refreshCharacters(true); } catch (e) {}
    try {
      current = await API.getWeChatGroup(name);
    } catch (e) { UI.toast('打开群聊失败：' + e.message); return; }
    if (!current) { UI.toast('群不存在'); return; }
    API.clearGroupUnread(name);
    const title = (current.meta && current.meta.displayName) || current.name;
    document.getElementById('group-chat-title').textContent = title;
    App.showPage('page-group-chat', () => renderChat(true));
    checkMuteExpiry(); // 打开群时先检查一次禁言是否到期
    startPolling();    // 停留时自动轮询新消息（AI 后台回复实时弹出）
  }

  /** 群公告置顶块（过长自动折叠，点击展开/收起） */
  function announcementHtml() {
    const ann = (current.meta && current.meta.announcement) || '';
    if (!ann) return '';
    const long = ann.length > 60;
    return `<div class="group-announcement" id="group-announcement">
      <div class="ga-title">📢 群公告</div>
      <div class="ga-body${long ? ' collapsed' : ''}" data-full="${UI.esc(ann)}">${UI.esc(ann).replace(/\n/g, '<br>')}</div>
      ${long ? '<div class="ga-more" data-act="toggle-ann">展开 ▾</div>' : ''}
    </div>`;
  }

  function renderChat(scroll) {
    const body = document.getElementById('group-chat-body');
    if (!current) return;
    const msgs = current.messages || [];
    let html = announcementHtml(); // 群公告置顶（可折叠）
    let lastTime = null;
    const pk = playerKey();
    for (const m of msgs) {
      const t = m.time;
      const showTime = !lastTime || (t && Math.abs(new Date(t) - new Date(lastTime)) > 5 * 60 * 1000);
      if (showTime && t) html += `<div class="msg-time">${UI.fmtTime(t)}</div>`;
      lastTime = t || lastTime;
      // 系统通知（禁言/踢人等）：居中灰字
      if (m.isSystem || m.key === '__system__') {
        html += `<div class="msg-time system-notice">${UI.esc(m.text)}</div>`;
        continue;
      }
      const isMe = String(m.key || '').indexOf('__me__') === 0 || (m.key === pk);
      // 卡片与私聊一致：独立显示（不带气泡）；普通消息走气泡（支持 ||| 拆多条）
      if (isMe) {
        html += `<div class="msg-row me" data-idx="${m._rawIndex}">
          <div class="avatar sm">${userAvatarHtml()}</div>
          <div class="msg-col">${m.card ? cardHtml(m.card, true) : renderMsgText(m.text, true)}</div>
        </div>`;
      } else {
        html += `<div class="msg-row group-ai" data-idx="${m._rawIndex}">
          <div class="avatar sm">${memberAvatarHtml(m.key, m.name)}</div>
          <div class="msg-col group-msg-col">
            <div class="group-msg-name">${UI.esc(charDisplayName(m.key, m.name))}</div>
            ${m.card ? cardHtml(m.card, false) : renderMsgText(m.text, false)}
          </div>
        </div>`;
      }
    }
    if (busy) {
      html += `<div class="msg-row group-ai">
        <div class="avatar sm"></div>
        <div class="msg-col group-msg-col">
          <div class="group-msg-name">群成员</div>
          <div class="bubble typing-dot">正在输入…</div>
        </div>
      </div>`;
    }
    if (!msgs.length && !busy) html = announcementHtml() + `<div class="msg-time">群聊已创建，说点什么吧（AI 会以成员身份回应）</div>`;
    body.innerHTML = html;
    // 群公告折叠切换
    const annToggle = body.querySelector('[data-act="toggle-ann"]');
    if (annToggle) {
      annToggle.addEventListener('click', () => {
        const ga = body.querySelector('.group-announcement');
        const gb = ga && ga.querySelector('.ga-body');
        if (!ga || !gb) return;
        const collapsed = gb.classList.toggle('collapsed');
        annToggle.textContent = collapsed ? '展开 ▾' : '收起 ▴';
      });
    }
    // 卡片点击：跳回原文（朋友圈 / 公众号），返回时回到本群
    body.querySelectorAll('.chat-card').forEach(el => {
      el.addEventListener('click', () => {
        const type = el.dataset.cardType, id = el.dataset.cardId;
        if (!id) return;
        App.setBackHandler(() => { openGroupChat(current.name, 'page-group-chat'); });
        if (type === 'article') { try { Articles.openReadById(id); } catch (e) { UI.toast('无法打开推文：' + (e && e.message)); } }
        else { try { Moments.openPostDetail(id); } catch (e) { UI.toast('无法打开朋友圈：' + (e && e.message)); } }
      });
    });
    if (scroll !== false) body.scrollTop = body.scrollHeight;
  }

  /** 转发卡片 HTML（复用私聊 chat-card 样式；点击跳原文）。附带的话（card.note）显示在卡片上方 */
  function cardHtml(card, isMe) {
    card = card || {};
    const title = UI.esc(card.title || '');
    const source = UI.esc(card.source || '');
    const thumb = UI.esc(card.thumb || '');
    const note = String(card.note || '').trim();
    const noteHtml = note ? `<div class="bubble${isMe ? ' green' : ''}">${UI.esc(note).replace(/\n/g, '<br>')}</div>` : '';
    // 无图不配缩略图
    const thumbHtml = thumb
      ? `<div class="chat-card-thumb"><img src="${thumb}" onerror="this.style.display='none'"><span class="chat-card-thumb-fallback">${card.type === 'article' ? '📰' : '🌐'}</span></div>`
      : '';
    return `${noteHtml}<div class="chat-card" data-card-type="${UI.esc(card.type || '')}" data-card-id="${UI.esc(card.id || '')}">
      ${thumbHtml}
      <div class="chat-card-main">
        <div class="chat-card-title">${title}</div>
        <div class="chat-card-source">${source}</div>
      </div></div>`;
  }

  /** 渲染消息文本：高亮 @名字；支持 ||| 拆成同一头像下多个气泡 */
  function renderMsgText(t, isMe) {
    let s = UI.esc(String(t || ''));
    s = s.replace(/@([^@\s，。！？,.!?]{1,12})/g, (mm, n) => `<span class="at-mention">@${n}</span>`);
    const parts = s.split(/\|{2,}/).map(p => p.trim()).filter(Boolean);
    const list = parts.length ? parts : [s];
    return list.map(p => `<div class="bubble${isMe ? ' green' : ''}">${p.replace(/\n/g, '<br>')}</div>`).join('');
  }

  /** 解析最新一条消息（任意人，用户或 AI 成员）里的 @：返回被 @ 的成员微信名列表；@全员返回 ['@all'] */
  function mentionInMsg(msgs, members, lastIndex) {
    const last = msgs && msgs.length ? msgs[lastIndex != null ? lastIndex : msgs.length - 1] : null;
    const txt = String((last && last.text) || '');
    if (/@(all|所有人|全员)/i.test(txt)) return ['@all'];
    const names = [];
    for (const mem of (members || [])) {
      // @ 玩家（真人）不触发强制回应补轮；玩家自己看到消息自然会回
      if (mem.key && String(mem.key).indexOf('__me__') === 0) continue;
      const nm = charDisplayName(mem.key, mem.name);
      if (nm && txt.includes('@' + nm)) names.push(nm);
    }
    return names;
  }

  /** @ 成员选择弹窗：微信通讯录风格，带头像、可多选、支持 @所有人 */
  function openAtPicker() {
    if (!current) return;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.style.display = 'flex';
    const card = document.createElement('div');
    card.className = 'modal-card share-modal-card';
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = '选择提醒的人';
    const toolbar = document.createElement('div');
    toolbar.className = 'share-toolbar';
    const allLbl = document.createElement('label');
    allLbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;color:#333;';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.style.cssText = 'width:18px;height:18px;accent-color:#07c160;';
    allLbl.appendChild(allCb);
    allLbl.appendChild(document.createTextNode('@所有人'));
    const cnt = document.createElement('span');
    cnt.className = 'share-count';
    const list = document.createElement('div');
    list.className = 'share-char-list';
    // 成员行（过滤玩家自己，不能 @ 自己）
    const members = current.members.filter(m => !m.key || String(m.key).indexOf('__me__') !== 0);
    const items = [];
    const refresh = () => {
      const n = items.filter(it => it.cb.checked).length + (allCb.checked ? 1 : 0);
      cnt.textContent = '已选 ' + n + ' 人';
    };
    members.forEach(mm => {
      const name = charDisplayName(mm.key, mm.name);
      const row = document.createElement('div');
      row.className = 'share-char-item';
      const av = document.createElement('div');
      av.className = 'avatar sm';
      const c = mm.key ? App.charByKey(mm.key) : null;
      if (c && UI.avatarSrc(c.avatar)) av.innerHTML = `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">`;
      const nm = document.createElement('div');
      nm.style.cssText = 'flex:1;font-size:14px;color:#333;';
      nm.textContent = name;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.style.cssText = 'width:18px;height:18px;accent-color:#07c160;';
      row.appendChild(av); row.appendChild(nm); row.appendChild(cb);
      row.addEventListener('click', () => { cb.checked = !cb.checked; refresh(); });
      items.push({ name, cb });
      list.appendChild(row);
    });
    allCb.addEventListener('change', refresh);
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn-plain';
    cancel.textContent = '取消';
    const ok = document.createElement('button');
    ok.className = 'btn-primary';
    ok.textContent = '确定';
    ok.addEventListener('click', () => {
      const names = items.filter(it => it.cb.checked).map(it => it.name);
      const atAll = allCb.checked;
      mask.remove();
      const input = document.getElementById('group-input');
      const start = input.selectionStart ?? input.value.length;
      const ins = (atAll ? '@所有人 ' : '') + names.map(n => '@' + n).join(' ') + (names.length || atAll ? ' ' : '');
      input.value = input.value.slice(0, start) + ins + input.value.slice(start);
      input.focus();
      autoResize(input);
    });
    cancel.addEventListener('click', () => mask.remove());
    actions.appendChild(cancel);
    actions.appendChild(ok);
    toolbar.appendChild(allLbl);
    toolbar.appendChild(cnt);
    card.appendChild(title);
    card.appendChild(toolbar);
    card.appendChild(list);
    card.appendChild(actions);
    mask.appendChild(card);
    mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    refresh();
  }

  /* ---------------- 发送 + AI 群回复 ---------------- */
  /** 发消息后 AI 连聊轮数（随机，配置 groupActive.chatMin/chatMax；默认 1） */
  function chatRounds() {
    const cfg = (App.state && App.state.config) || {};
    const ga = cfg.groupActive || {};
    const min = ga.chatMin != null ? ga.chatMin : 1;
    const max = ga.chatMax != null ? ga.chatMax : 1;
    return Math.max(1, min + Math.floor(Math.random() * (Math.max(1, max - min) + 1)));
  }
  async function sendGroupMessage(text) {
    text = (text || '').trim();
    if (!text || !current || busy) return;
    const p = meInfo();
    // 支持用 || 或 ||| 拆成多条连发
    const parts = String(text).split(/\|{2,}/).map(s => s.trim()).filter(Boolean);
    for (const part of (parts.length ? parts : [text])) {
      await API.saveWeChatMessage(current.name, { name: p.name || '我', key: playerKey(), text: part });
      // 玩家消息里的群管理意图也生效（只发系统通知，群回复由下面的 triggerAI 自然延续）
      await maybeGroupManage(current.name, part, current.members, p.name || '我');
    }
    current = await API.getWeChatGroup(current.name);
    renderChat(true);
    await triggerAI(undefined, chatRounds());
  }

  async function triggerAI(extraEvent, rounds) {
    if (!current || busy) return;
    busy = true;
    renderChat(true);
    try {
      rounds = rounds || 1;
      const p = meInfo();
      for (let r = 0; r < rounds; r++) {
        // 每轮都用最新群数据（禁言名单可能刚变化），确保被禁言者不再参与
        current = await API.getWeChatGroup(current.name);
        const now = Date.now();
        const muted = (current.meta && current.meta.muted) || {};
        const activeMembers = current.members.filter(m => !(muted[m.key] && muted[m.key] > now));
        if (!activeMembers.length) break; // 全员禁言中，这轮不产出
        const members = activeMembers.map(m => {
          let rel = '';
          try {
            const rr = (p.relations || []).find(x => x.key === m.key);
            if (rr) rel = rr.relation || '';
          } catch (e) {}
          return { key: m.key, name: charDisplayName(m.key, m.name), relation: rel };
        });
        const msgs = current.messages.map(m => ({ name: charDisplayName(m.key, m.name), key: m.key, text: m.text }));
        const cfg = (App.state && App.state.config) || {};
        let evt = extraEvent || '';
        if (r === 1) evt = '群成员接着刚才的话题继续聊几句，自然接话，别冷场。';
        else if (r >= 2) evt = '继续自然聊下去：围绕前面的话题接话、互相打趣或抛出新话题，别重复前面说过的话。';
        // 每轮解析最新一条消息里的 @（用户 @ 或 AI 成员 @ 别人都算）→ 被 @ 者必须回应
        const mention = mentionInMsg(current.messages, activeMembers, current.messages.length - 1);
        const out = await API.genGroupReply({
          groupName: current.name, members, messages: msgs,
          meName: p.name || '我',
          meDesc: meDescText(),
          timezone: cfg.timezone || 'Asia/Shanghai',
          announcement: (current.meta && current.meta.announcement) || '',
          event: evt,
          mentioned: mention,
        });
        if (!out || !out.length) break; // 这轮没有产出就停下，避免空转
        for (const o of out) {
          await sleep(500 + Math.random() * 1000);
          // AI 试图以玩家身份发言（玩家名 / 「玩家」 / 「我」）→ 直接跳过，玩家由本人说话
          const p0 = meInfo();
          if (o.key === p0.name || o.key === '玩家' || o.key === '我') continue;
          // AI 输出的「角色=名字」是微信备注名，映射回角色 key
          let key = null;
          const member = members.find(x => x.name === o.key);
          if (member) key = member.key;
          else if (App.charByKey(o.key)) key = o.key;
          // 兜底也避开玩家（玩家不会由 AI 代发言，否则会把 AI 的话错存成「我」）
          if (!key) { const fb = activeMembers.find(m => String(m.key || '').indexOf('__me__') !== 0); key = (fb && fb.key) || null; }
          // 玩家由本人说话：AI 若跑偏输出玩家名，跳过不写入
          if (!key || String(key || '').indexOf('__me__') === 0) continue;
          // 写入前兜底：若该成员此刻已被禁言（AI 可能选错），跳过这条
          if (muted[key] && muted[key] > Date.now()) continue;
          const c = App.charByKey(key);
          await API.saveWeChatMessage(current.name, { name: charDisplayName(key, o.key), key, text: o.text });
          current = await API.getWeChatGroup(current.name);
          renderChat(true);
          // 聊天执行群管理（开关 aiManage 控制）
          await maybeGroupManage(current.name, o.text, activeMembers, charDisplayName(key, o.key));
        }
        // 轮间节奏：松弛一点，模拟真人思考
        if (r < rounds - 1) await sleep(1500 + Math.random() * 2500);
      }
      // 用户此刻正打开该群 → 清零未读
      if (isGroupVisible()) API.clearGroupUnread(current.name);
    } catch (e) {
      UI.toast('群回复失败：' + e.message);
    }
    busy = false;
    renderChat(true);
  }

  /** 群活跃：让群成员自发聊起来（不依赖用户发消息），聊若干轮 */
  async function groupSpontaneous() {
    if (!current || busy) return;
    const cfg = (App.state && App.state.config) || {};
    const ga = cfg.groupActive || {};
    const min = ga.spontMin || 3, max = ga.spontMax || 6;
    const rounds = Math.max(1, min + Math.floor(Math.random() * (Math.max(1, max - min) + 1)));
    UI.toast('群成员开始聊起来了…');
    await triggerAI('群里安静下来了，成员们随便聊起来：聊聊最近的事、互相打趣、吐槽几句都行，让群热闹起来。', rounds);
  }

  /** 禁言到期自动解除：到期 → 群里发通知 + 群成员讨论（欢迎回来等） */
  async function checkMuteExpiry() {
    if (!current) return;
    try {
      const g = await API.getWeChatGroup(current.name);
      if (!g) return;
      const muted = (g.meta && g.meta.muted) || {};
      const now = Date.now();
      const expired = Object.keys(muted).filter(k => muted[k] && muted[k] <= now);
      if (!expired.length) return;
      for (const k of expired) await API.muteGroupMember(current.name, k, null);
      const names = expired.map(k => charDisplayName(k, k)).join('、');
      current = await API.getWeChatGroup(current.name);
      renderChat(true);
      await groupEventNotice(current.name, '「' + names + '」的禁言时间到了，已自动解除', '群里刚有一条系统通知：' + names + ' 的禁言自动解除了。其他成员围绕这件事自然地聊几句（欢迎回来、调侃等）。');
    } catch (e) {}
  }

  /** AI 主动拉群：随机一个活跃角色当群主，拉一个含玩家+若干关联角色的新群，群内 AI 开场 */
  async function aiSpontaneousGroup() {
    try {
      const p = meInfo();
      const rels = (p && p.relations) || [];
      const candidates = rels.map(r => ({ key: r.key, c: App.charByKey(r.key) })).filter(x => x.c);
      if (!candidates.length) return;
      const host = candidates[Math.floor(Math.random() * candidates.length)];
      const others = candidates.filter(x => x.key !== host.key).sort(() => Math.random() - 0.5);
      const invited = others.slice(0, Math.floor(Math.random() * 3) + 1);
      // 拉群一定包含玩家（微信里玩家天然在群里）
      const memberKeys = [playerKey(), host.key, ...invited.map(x => x.key)];
      // 群名：AI 生成，口语化
      let name = host.c.name + ' 的群';
      try {
        const r = await API.genChat([{
          role: 'system', content: '你是微信群名生成器，只输出一句话中文群名（12字以内，口语化、像真实微信群名），不要解释、不要标点、不要引号。',
        }, { role: 'user', content: '群成员：' + memberKeys.map(k => charDisplayName(k, k)).join('、') + '。请给这个群起个自然的名字。' }], { temperature: 1.0, max_tokens: 30 });
        const n = String((r && r.content) || '').trim().replace(/["“”']/g, '');
        if (n && n.length <= 15) name = n;
      } catch (e) {}
      await API.createWeChatGroup(name, memberKeys, host.key);
      UI.toast('「' + host.c.name + '」创建了群「' + name + '」');
      if (typeof ChatList !== 'undefined' && ChatList.render) ChatList.render();
      if (typeof GroupChat !== 'undefined' && GroupChat.replyGroupBackground) {
        GroupChat.replyGroupBackground(name, '这是一个刚建好的新群，你是群主。按你自己的性格随便开口说一句（比如吐槽、分享近况、交代拉群的原因都行；不要客套，别说"请多关照"这类官话），其他成员自然回应。');
      }
    } catch (e) {}
  }

  /** AI 主动拉群定时判断（开关 + 频率：hours 内最多一次） */
  let lastAiGroupTs = 0;
  try { lastAiGroupTs = Number(localStorage.getItem('wst_last_ai_group') || 0) || 0; } catch (e) {}
  function maybeAiGroup() {
    try {
      const cfg = (App.state && App.state.config) || {};
      const ga = cfg.groupActive || {};
      if (!ga.aiGroupEnabled) return;
      const hours = ga.aiGroupHours || 24;
      if (Date.now() - lastAiGroupTs < hours * 3600 * 1000) return;
      if (Math.random() > (ga.aiGroupChance != null ? ga.aiGroupChance : 0.5)) return;
      lastAiGroupTs = Date.now();
      try { localStorage.setItem('wst_last_ai_group', String(lastAiGroupTs)); } catch (e) {}
      aiSpontaneousGroup();
    } catch (e) {}
  }

  /** 角色候选名（支持 2 字简称/昵称/全名）：备注名、角色名、各取前 2 字 */
  function candidateNames(c) {
    const set = new Set();
    const push = s => { s = String(s || '').trim(); if (s.length >= 2) set.add(s); };
    const display = App.displayName(c);
    const real = String(c.name || '').trim();
    push(display); push(real);
    if (display && display.length > 2) push(display.slice(0, 2));
    if (real && real.length > 2) push(real.slice(0, 2));
    // 「家入硝子」这类带姓的，补上最后 2 字（=名）
    for (const s of [display, real]) {
      if (s && s.length === 4) push(s.slice(2));
      if (s && s.length > 4) push(s.slice(s.length - 2));
    }
    return [...set];
  }

  /** 从文本里找出对应通讯录角色（支持简称）；排除 excludeKeys 内的 key；allowShort 时额外支持 1 字昵称（如「杰」→夏油杰） */
  function resolveCharKeyFromText(text, excludeKeys, allowShort) {
    text = String(text || '');
    const exclude = new Set(excludeKeys || []);
    // 第一轮：2 字以上候选（备注名/角色名/前2字/4字名后2字）
    for (const c of (App.state.characters || [])) {
      const k = App.charKey(c);
      if (exclude.has(k)) continue;
      for (const cn of candidateNames(c)) {
        if (cn.length >= 2 && text.indexOf(cn) >= 0) return { key: k, name: cn };
      }
    }
    // 第二轮：1 字昵称兜底（仅拉人语境，避免「子/人」这类常见字误伤）
    if (allowShort) {
      for (const c of (App.state.characters || [])) {
        const k = App.charKey(c);
        if (exclude.has(k)) continue;
        const real = String(c.name || '').trim();
        if (real.length >= 3) {
          const last = real.slice(-1);
          if (/[\u4e00-\u9fa5]/.test(last) && !/子|人|的|们|君|桑/.test(last) && text.indexOf(last) >= 0) {
            return { key: k, name: last };
          }
        }
      }
    }
    return null;
  }

  /** 解析群消息里的群管理意图（开关 aiManage 控制）：设/取消管理员、转让群主、玩家要管理员/要群主、拉人进群 */
  function parseManageIntent(text, members) {
    text = String(text || '');
    // 1a) 玩家要群主：「把群主给我/群主给我/给我(一下/个)群主/让我当群主/我来当群主/我想当群主/转让群主给我」
    if (/我/.test(text) && /(群主|群主位置|管理权|群管理)/.test(text) && /(给|交给|让给|转给|转让|给我|当|做|担任|来当|来做|让给我|交给我)/.test(text)) {
      const me = meInfo();
      return { action: 'transferToSelf', key: playerKey(), name: (me && me.name) || '我' };
    }
    // 1) 玩家要管理员：「给我(个)?管理」「把我设为管理员」「让我当管理员」
    if (/(给我|让我|把我).{0,6}(管理员|管理|群管理)/.test(text)) {
      const me = meInfo();
      return { action: 'setSelfAdmin', key: playerKey(), name: (me && me.name) || '我' };
    }
    // 2) 拉人进群：「把XX拉进来/拉上XX/忘记拉XX/邀请XX」→ 找不在群的通讯录角色
    const inGroupKeys = new Set((members || []).map(m => m.key));
    const addActionRe = /拉.{0,8}(进群|进来|入群)|拉上|拉一下|把.{0,4}(拉|加|邀请).{0,6}(进群|进来|入群)|邀请.{0,6}|(忘记|忘了)(拉|加|叫)/;
    if (addActionRe.test(text)) {
      const hit = resolveCharKeyFromText(text, inGroupKeys, true);
      if (hit) return { action: 'addMember', key: hit.key, name: hit.name };
    }
    // 3) 设/取消管理员 + 转让群主（针对已入群成员）
    for (const mm of (members || [])) {
      const nm = charDisplayName(mm.key, mm.name);
      if (!nm) continue;
      const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reSet = new RegExp('(把|让|任命|提拔|请)?@?' + esc(nm) + '(设为|当|做|升为|提为)(管理员|群管理)');
      if (reSet.test(text)) return { action: 'setAdmin', key: mm.key, name: nm };
      const reUn = new RegExp('(把|将|撤掉|撤销|去掉|下掉)?@?' + esc(nm) + '(取消|撤掉|撤销|去掉|下掉)(管理员|群管理)');
      if (reUn.test(text)) return { action: 'unsetAdmin', key: mm.key, name: nm };
      const reTr = new RegExp('(把|将)(群主|管理权|群主位置).{0,5}(转让|让给|转交给|交给)?@?' + esc(nm));
      if (reTr.test(text)) return { action: 'transfer', key: mm.key, name: nm };
    }
    return null;
  }

  /** 开关开启时，按群消息里的管理意图真实执行 + 群通知讨论（30 秒冷却防死循环）。actor 为操作者名（玩家或某成员） */
  const manageCooldown = {};
  async function maybeGroupManage(groupName, text, members, actor) {
    try {
      const cfg = (App.state && App.state.config) || {};
      const ga = cfg.groupActive || {};
      if (!ga.aiManage) return;
      if (manageCooldown[groupName] && Date.now() - manageCooldown[groupName] < 30000) return;
      const intent = parseManageIntent(text, members);
      if (!intent) return;
      manageCooldown[groupName] = Date.now();
      const who = actor || '';
      if (intent.action === 'transferToSelf') {
        // 只有玩家本人说"把群主给我"才生效；AI 成员说出这句不触发（否则群里 AI 一句话群主就易主了）
        const me = meInfo();
        const isMe = !who || who === (me && me.name) || who === '我';
        if (!isMe) return;
        await API.transferGroupOwner(groupName, intent.key);
        await groupEventNotice(groupName, '你已成为本群新群主', '群里刚有一条系统通知：群主转让给了 ' + who + '。成员们围绕这件事自然地聊几句（恭喜、调侃等）。', true);
      } else if (intent.action === 'setSelfAdmin') {
        await API.setGroupAdmin(groupName, intent.key, true);
        await groupEventNotice(groupName, who ? who + ' 已被设为管理员' : '你已被设为管理员', '群里刚有一条系统通知：' + (who || '玩家') + ' 被设为管理员。成员们围绕这件事自然地聊几句。', true);
      } else if (intent.action === 'addMember') {
        await API.addGroupMember(groupName, intent.key);
        await groupEventNotice(groupName, who ? who + ' 将「' + intent.name + '」拉进群聊' : '「' + intent.name + '」已被拉进群聊', '群里刚有一条系统通知：' + (who ? who + ' 把 ' : '') + intent.name + ' 拉进了群聊。大家自然地欢迎/调侃几句。', true);
      } else if (intent.action === 'setAdmin') {
        await API.setGroupAdmin(groupName, intent.key, true);
        await groupEventNotice(groupName, who ? who + ' 将「' + intent.name + '」设为管理员' : '「' + intent.name + '」已被设为管理员', '群里刚有一条系统通知：' + (who ? who + ' 把 ' : '') + intent.name + ' 设为管理员。成员们围绕这件事自然地聊几句。', true);
      } else if (intent.action === 'unsetAdmin') {
        await API.setGroupAdmin(groupName, intent.key, false);
        await groupEventNotice(groupName, who ? who + ' 将「' + intent.name + '」取消管理员' : '「' + intent.name + '」已被取消管理员', '群里刚有一条系统通知：' + (who ? who + ' 把 ' : '') + intent.name + ' 取消管理员。成员们围绕这件事自然地聊几句。', true);
      } else if (intent.action === 'transfer') {
        await API.transferGroupOwner(groupName, intent.key);
        await groupEventNotice(groupName, who ? who + ' 将群主转让给「' + intent.name + '」' : '「' + intent.name + '」已成为本群新群主', '群里刚有一条系统通知：' + (who ? who + ' 把' : '') + '群主转让给了 ' + intent.name + '。成员们围绕这件事自然地聊几句（恭喜、调侃等）。', true);
      }
      if (current && current.name === groupName) current = await API.getWeChatGroup(groupName);
      if (typeof ChatList !== 'undefined' && ChatList.render) ChatList.render();
    } catch (e) {}
  }

  /** 后台群回复：不依赖当前打开的群（分享/推送/事件后让群里 AI 自然接话；禁言成员跳过；失败提示便于排查）。
   *  rounds：多轮连续讨论（事件后群成员聊得更充分），每轮基于最新群数据，@ 补轮也每轮检查 */
  async function replyGroupBackground(groupName, event, rounds) {
    rounds = Math.max(1, parseInt(rounds, 10) || 2);
    let evt = event;
    try {
      for (let r = 0; r < rounds; r++) {
        const g = await API.getWeChatGroup(groupName);
        if (!g) return;
        const now = Date.now();
        const muted = (g.meta && g.meta.muted) || {};
        const activeMembers = g.members.filter(m => !(muted[m.key] && muted[m.key] > now));
        if (!activeMembers.length) return;
        const p = meInfo();
        const rels = (p && p.relations) || [];
        const members = activeMembers.map(m => {
          let rel = '';
          try { const r2 = rels.find(rr => rr.key === m.key); if (r2) rel = r2.relation || ''; } catch (e) {}
          return { key: m.key, name: charDisplayName(m.key, m.name), relation: rel };
        });
        const cfg = (App.state && App.state.config) || {};
        const writeOut = async (list) => {
          for (const o of (list || [])) {
            await sleep(500 + Math.random() * 1000);
            // AI 试图以玩家身份发言（玩家名 / 「玩家」 / 「我」）→ 直接跳过，玩家由本人说话
            const p0 = meInfo();
            if (o.key === p0.name || o.key === '玩家' || o.key === '我') continue;
            let key = null;
            const member = members.find(x => x.name === o.key);
            if (member) key = member.key;
            else if (App.charByKey(o.key)) key = o.key;
            // 兜底避开玩家（玩家不会由 AI 代发言）
            if (!key) { const fb = activeMembers.find(m => String(m.key || '').indexOf('__me__') !== 0); key = (fb && fb.key) || null; }
            // 玩家由本人说话：AI 跑偏输出玩家名则跳过
            if (!key || String(key || '').indexOf('__me__') === 0) continue;
            // 写入前兜底：该成员此刻已被禁言则跳过
            if (muted[key] && muted[key] > Date.now()) continue;
            await API.saveWeChatMessage(groupName, { name: charDisplayName(key, o.key), key, text: o.text });
            await maybeGroupManage(groupName, o.text, activeMembers, charDisplayName(key, o.key));
          }
        };
        const out = await API.genGroupReply({
          groupName, members,
          messages: g.messages.map(m => ({ name: charDisplayName(m.key, m.name), key: m.key, text: m.text })),
          meName: p.name || '我',
          meDesc: meDescText(),
          timezone: cfg.timezone || 'Asia/Shanghai',
          announcement: (g.meta && g.meta.announcement) || '',
          event: evt || '有人往群里分享了一条朋友圈/公众号内容（上面最新那条分享），大家围绕分享的内容自然地聊几句。',
          mentioned: [],
        });
        await writeOut(out);
        // 本轮 AI 成员 @ 了别人 → 补一轮让被 @ 者必须回应（最多 1 轮，防死循环）
        const fresh = await API.getWeChatGroup(groupName);
        const atNames = mentionInMsg(fresh.messages, activeMembers, fresh.messages.length - 1);
        if (atNames.length) {
          await sleep(1200 + Math.random() * 1800);
          const out2 = await API.genGroupReply({
            groupName, members,
            messages: fresh.messages.map(m => ({ name: charDisplayName(m.key, m.name), key: m.key, text: m.text })),
            meName: p.name || '我',
            meDesc: meDescText(),
            timezone: cfg.timezone || 'Asia/Shanghai',
            announcement: (g.meta && g.meta.announcement) || '',
            event: '最新一条消息 @ 了 ' + (atNames[0] === '@all' ? '所有人' : atNames.join('、')) + '。被 @ 的成员现在必须回应对方，其他人可以视情况补充或保持沉默。',
            mentioned: atNames,
          });
          await writeOut(out2);
        }
        if (r < rounds - 1) {
          await sleep(1200 + Math.random() * 1800);
          evt = '继续围绕刚才发生的事（系统通知、新成员、管理变动等）自然地聊下去，成员可以接别人的话、调侃、补充。';
        }
      }
      if (typeof ChatList !== 'undefined' && ChatList.render) ChatList.render();
    } catch (e) { UI.toast('群分享回复失败：' + (e && e.message)); }
  }

  function isGroupVisible() {
    const p = document.getElementById('page-group-chat');
    return p && p.style.display !== 'none' && !!current;
  }

  /** 群事件：发系统通知 + 触发群成员讨论（禁言/踢人/改名/公告/管理员/转让等统一入口） */
  async function groupEventNotice(groupName, noticeText, eventText, skipAi) {
    try {
      await API.saveWeChatMessage(groupName, { name: '系统', key: '__system__', text: noticeText, system: true });
      if (typeof ChatList !== 'undefined' && ChatList.render) ChatList.render();
      if (!skipAi && typeof GroupChat !== 'undefined' && GroupChat.replyGroupBackground) {
        GroupChat.replyGroupBackground(groupName, eventText);
      }
    } catch (e) {}
  }

  /* ---------------- 群消息长按：删除 / 重说 ---------------- */
  async function delGroupMsg(rawIdx) {
    try {
      await API.deleteWeChatMessage(current.name, rawIdx);
      current = await API.getWeChatGroup(current.name);
      renderChat(true);
    } catch (e) { UI.toast('删除失败：' + e.message); }
  }
  async function resayGroupMsg(rawIdx) {
    // 截断：删除该条及其后所有消息，再让 AI 重新接话
    const msgs = current.messages || [];
    const i = msgs.findIndex(m => m._rawIndex === rawIdx);
    if (i < 0) return;
    const rawIndexes = msgs.slice(i).map(m => m._rawIndex).sort((a, b) => b - a);
    try {
      for (const ri of rawIndexes) await API.deleteWeChatMessage(current.name, ri);
      current = await API.getWeChatGroup(current.name);
      renderChat(true);
      await triggerAI();
    } catch (e) { UI.toast('重说失败：' + e.message); }
  }
  function openGroupMsgMenu(rawIdx) {
    const m = (current.messages || []).find(x => x._rawIndex === rawIdx);
    if (!m) return;
    const isMe = String(m.key || '').indexOf('__me__') === 0;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const sheet = document.createElement('div');
    sheet.className = 'msg-actions';
    const btn = (label, danger, fn) => {
      const b = document.createElement('div');
      b.className = 'msg-action' + (danger ? ' danger' : '');
      b.textContent = label;
      b.addEventListener('click', () => { mask.remove(); fn(); });
      sheet.appendChild(b);
    };
    if (!isMe) btn('重说', false, () => resayGroupMsg(rawIdx));
    btn('删除', true, async () => {
      const ok = await UI.confirm('删除这条消息？', { okText: '删除' });
      if (ok) delGroupMsg(rawIdx);
    });
    const cancel = document.createElement('div');
    cancel.className = 'msg-action cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => mask.remove());
    sheet.appendChild(cancel);
    mask.appendChild(sheet);
    mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
  }
  function bindGroupMsgMenus() {
    const body = document.getElementById('group-chat-body');
    let rowEl = null, sx = 0, sy = 0, timer = null;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } rowEl = null; };
    body.addEventListener('pointerdown', e => {
      const row = e.target.closest('.msg-row[data-idx]');
      if (!row || busy) return;
      rowEl = row; sx = e.clientX; sy = e.clientY;
      timer = setTimeout(() => { timer = null; if (rowEl && rowEl.isConnected) openGroupMsgMenu(rowEl.dataset.idx); }, 600);
    });
    body.addEventListener('pointermove', e => {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) clear();
    });
    body.addEventListener('pointerup', clear);
    body.addEventListener('pointercancel', clear);
    body.addEventListener('contextmenu', e => {
      const row = e.target.closest('.msg-row[data-idx]');
      if (row) { e.preventDefault(); openGroupMsgMenu(row.dataset.idx); }
    });
  }

  /* ---------------- 建群 ---------------- */
  function openCreateModal() {
    const list = document.getElementById('group-create-list');
    list.innerHTML = App.state.characters.map(c => {
      const avatar = UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
      return `<label class="share-char-item" data-key="${UI.esc(App.charKey(c))}">
        <span class="avatar sm">${avatar}</span>
        <span class="share-char-name">${UI.esc(App.displayName(c))}</span>
        <input type="checkbox" value="${UI.esc(App.charKey(c))}">
      </label>`;
    }).join('');
    list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', updateCreateCount));
    updateCreateCount();
    document.getElementById('group-create-name').value = '';
    document.getElementById('group-create-tip').textContent = '';
    document.getElementById('group-create-modal').style.display = 'flex';
  }
  function updateCreateCount() {
    const n = document.querySelectorAll('#group-create-list input[type=checkbox]:checked').length;
    const el = document.getElementById('group-create-count');
    if (el) el.textContent = n ? '已选 ' + n + ' 个' : '';
  }
  async function doCreate() {
    const name = document.getElementById('group-create-name').value.trim();
    const keys = [...document.querySelectorAll('#group-create-list input[type=checkbox]:checked')].map(cb => cb.value);
    const tip = document.getElementById('group-create-tip');
    if (!name) { tip.textContent = '请填写群名'; return; }
    if (!keys.length) { tip.textContent = '请至少勾选一个成员'; return; }
    tip.textContent = '创建中…';
    tip.className = 'modal-tip loading';
    try {
      // 拉群的人就是群主；玩家自动在群里
      const allKeys = keys.includes(playerKey()) ? keys : [playerKey(), ...keys];
      await API.createWeChatGroup(name, allKeys, playerKey());
      document.getElementById('group-create-modal').style.display = 'none';
      UI.toast('群「' + name + '」已创建');
      openGroups();
      openGroupChat(name);
    } catch (e) {
      tip.textContent = '创建失败：' + e.message;
      tip.className = 'modal-tip';
    }
  }

  /* ---------------- 表情面板 ---------------- */
  function buildEmojiPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel || panel.childNodes.length) return;
    panel.innerHTML = EMOJIS.map(e => `<span class="emoji-item" data-e="${UI.esc(e)}">${e}</span>`).join('');
    panel.querySelectorAll('.emoji-item').forEach(el => {
      el.addEventListener('click', () => {
        const inputId = panelId === 'group-emoji-panel' ? 'group-input' : 'group-input';
        const input = document.getElementById(inputId);
        if (input) {
          const start = input.selectionStart || input.value.length;
          input.value = input.value.slice(0, start) + el.dataset.e + input.value.slice(start);
          input.focus();
        }
        panel.classList.remove('open');
      });
    });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    // 独立群聊页已删除：群聊并入主「微信」列表；新建群聊入口在「发起会话」弹层（chatlist.js）
    document.getElementById('btn-group-chat-back').addEventListener('click', () => {
      App.showTab('chatlist');
    });
    document.getElementById('btn-group-chat-info').addEventListener('click', openGroupInfo);
    const infoBack = document.getElementById('btn-group-info-back');
    if (infoBack) infoBack.addEventListener('click', () => {
      if (current && current.name) openGroupChat(current.name);
      else openGroups();
    });
    document.getElementById('group-create-cancel').addEventListener('click', () => { document.getElementById('group-create-modal').style.display = 'none'; });
    document.getElementById('group-create-ok').addEventListener('click', doCreate);
    document.getElementById('group-create-all').addEventListener('click', () => {
      document.querySelectorAll('#group-create-list input[type=checkbox]').forEach(cb => cb.checked = true);
      updateCreateCount();
    });
    document.getElementById('group-create-none').addEventListener('click', () => {
      document.querySelectorAll('#group-create-list input[type=checkbox]').forEach(cb => cb.checked = false);
      updateCreateCount();
    });
    document.getElementById('group-create-modal').addEventListener('click', e => {
      if (e.target.id === 'group-create-modal') document.getElementById('group-create-modal').style.display = 'none';
    });
    // 添加群成员弹窗
    document.getElementById('group-add-cancel').addEventListener('click', () => { document.getElementById('group-add-modal').style.display = 'none'; });
    document.getElementById('group-add-ok').addEventListener('click', doGroupAdd);
    document.getElementById('group-add-all').addEventListener('click', () => {
      document.querySelectorAll('#group-add-list input[type=checkbox]').forEach(cb => cb.checked = true);
      updateGroupAddCount();
    });
    document.getElementById('group-add-none').addEventListener('click', () => {
      document.querySelectorAll('#group-add-list input[type=checkbox]').forEach(cb => cb.checked = false);
      updateGroupAddCount();
    });
    document.getElementById('group-add-modal').addEventListener('click', e => {
      if (e.target.id === 'group-add-modal') document.getElementById('group-add-modal').style.display = 'none';
    });
    // 发送
    const send = () => {
      const input = document.getElementById('group-input');
      const text = input.value;
      input.value = '';
      autoResize(input);
      sendGroupMessage(text);
    };
    document.getElementById('group-send').addEventListener('click', send);
    document.getElementById('group-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    // 表情
    document.getElementById('btn-group-emoji').addEventListener('click', e => {
      e.stopPropagation();
      const p = document.getElementById('group-emoji-panel');
      buildEmojiPanel('group-emoji-panel');
      p.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#btn-group-emoji') && !e.target.closest('#group-emoji-panel')) {
        document.getElementById('group-emoji-panel').classList.remove('open');
      }
    });
    // @ 成员
    document.getElementById('btn-group-at').addEventListener('click', e => { e.stopPropagation(); openAtPicker(); });
    // 群活跃：AI 自发聊天
    document.getElementById('btn-group-fire').addEventListener('click', e => { e.stopPropagation(); groupSpontaneous(); });
    // 群消息长按：删除 / 重说
    bindGroupMsgMenus();
    // 禁言到期自动解除检测（每 30 秒）
    setInterval(checkMuteExpiry, 30000);
    // AI 主动拉群定时判断（每 30 分钟）
    setInterval(maybeAiGroup, 30 * 60 * 1000);
  }

  /* ---------------- 群信息 / 管理 ---------------- */
  function promptDialog(title, placeholder, value) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'wx-confirm-mask';
      mask.innerHTML = `
        <div class="wx-confirm">
          <div class="wx-confirm-msg" style="font-weight:600">${UI.esc(title)}</div>
          <input class="wx-confirm-input" type="text" value="${UI.esc(value || '')}" placeholder="${UI.esc(placeholder || '')}" maxlength="30">
          <div class="wx-confirm-btns">
            <button class="wx-confirm-btn wx-confirm-cancel" type="button">取消</button>
            <button class="wx-confirm-btn wx-confirm-ok" type="button">确定</button>
          </div>
        </div>`;
      const input = mask.querySelector('.wx-confirm-input');
      const okBtn = mask.querySelector('.wx-confirm-ok');
      const cancelBtn = mask.querySelector('.wx-confirm-cancel');
      const done = val => { mask.remove(); resolve(val); };
      okBtn.addEventListener('click', () => done(input.value.trim()));
      cancelBtn.addEventListener('click', () => done(null));
      mask.addEventListener('click', e => { if (e.target === mask) done(null); });
      document.body.appendChild(mask);
      setTimeout(() => input.focus(), 50);
    });
  }

  async function openGroupInfo() {
    if (!current) return;
    App.showPage('page-group-info', renderGroupInfo);
  }
  async function renderGroupInfo() {
    const body = document.getElementById('group-info-body');
    if (!current) return;
    const name = current.name;
    const meta = (await API.getWeChatGroupInfo(name)) || {};
    const m = meta.meta || {};
    const avatar = m.avatar ? `<img src="${UI.esc(m.avatar)}">` : groupAvatarHtml({ memberKeys: current.members.map(x => x.key) });
    const muted = m.muted || {};
    const admins = m.adminKeys || [];
    // 旧群升级：owner 为空 → 视为拉群的人（玩家）是群主，并补写存储
    let owner = m.owner || null;
    if (!owner) {
      owner = playerKey();
      try { await API.updateWeChatGroup(name, { owner }); } catch (e) {}
    }
    const now = Date.now();
    // 玩家单独渲染在「我」行，这里过滤掉 __me__ 成员，避免「白井」出现两次
    const nonMeMembers = current.members.filter(mm => String(mm.key || '').indexOf('__me__') !== 0);
    const memberRows = nonMeMembers.map(mm => {
      const isOwner = mm.key === owner;
      const isAdmin = admins.indexOf(mm.key) >= 0 && !isOwner;
      const mu = muted[mm.key];
      const mutedTag = (mu && mu > now) ? ` <span class="gi-muted">🔇 禁言至 ${UI.fmtTime(new Date(mu).toISOString())}</span>` : '';
      const ownerTag = isOwner ? ' <span class="gi-admin gi-owner">群主</span>' : '';
      const adminTag = isAdmin ? ' <span class="gi-admin">管理员</span>' : '';
      return `<div class="gi-member" data-key="${UI.esc(mm.key)}">
        <div class="avatar sm">${memberAvatarHtml(mm.key)}</div>
        <div class="gi-member-name">${UI.esc(charDisplayName(mm.key, mm.name))}${ownerTag}${adminTag}${mutedTag}</div>
        <button class="gi-btn" data-act="member" data-key="${UI.esc(mm.key)}" data-name="${UI.esc(charDisplayName(mm.key, mm.name))}">⋯</button>
      </div>`;
    }).join('');
    const me = meInfo();
    const meKey = playerKey();
    const meOwnerTag = (meKey === owner) ? ' <span class="gi-admin gi-owner">群主</span>' : '';
    const myRow = `<div class="gi-member gi-me">
      <div class="avatar sm">${userAvatarHtml()}</div>
      <div class="gi-member-name">${UI.esc(me.name || '我')}<span class="gi-me-tag">（我）</span>${meOwnerTag}</div>
    </div>`;
    // 权限：我是不是群主/管理员（决定公告可编辑、成员管理项）
    const iAmOwner = meKey === owner;
    const iAmAdmin = admins.indexOf(meKey) >= 0;
    const annBtnHtml = (iAmOwner || iAmAdmin)
      ? '<button class="gi-btn" data-act="ann">编辑</button>'
      : '<span class="gi-ann-hint">仅群主/管理员可编辑</span>';
    const annVal = UI.esc(String(m.announcement || '').slice(0, 80)) + (String(m.announcement || '').length > 80 ? '…' : '');
    body.innerHTML = `
      <div class="gi-head">
        <div class="gi-avatar" id="gi-avatar">${avatar}</div>
        <div class="gi-head-main">
          <div class="gi-name">${UI.esc(m.displayName || name)}</div>
          <div class="gi-sub">${nonMeMembers.length + 1} 位成员</div>
        </div>
        <button class="gi-btn" id="gi-change-avatar">更换头像</button>
        <input type="file" id="gi-avatar-file" accept="image/*" style="display:none">
      </div>
      <div class="gi-section" id="gi-name-row">
        <div class="gi-label">群聊名称</div>
        <div class="gi-value">${UI.esc(m.displayName || name)}</div>
        <button class="gi-btn" data-act="rename">修改</button>
      </div>
      <div class="gi-section" id="gi-ann-row">
        <div class="gi-label">群公告</div>
        <div class="gi-value">${m.announcement ? annVal : '（未设置）'}</div>
        ${annBtnHtml}
      </div>
      <div class="gi-title">群成员</div>
      <div class="gi-members">${myRow}${memberRows}
        <div class="gi-member gi-add" id="gi-add-member">
          <div class="avatar sm gi-add-icon">＋</div>
          <div class="gi-member-name">添加成员</div>
        </div>
      </div>
      <div class="gi-danger"><button class="gi-btn danger" id="gi-clear-chat">清空聊天记录</button></div>
      <div class="gi-danger"><button class="gi-btn danger" id="gi-del-group">解散群聊</button></div>`;
    // 事件
    document.getElementById('gi-change-avatar').addEventListener('click', () => document.getElementById('gi-avatar-file').click());
    document.getElementById('gi-avatar-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        try {
          await API.updateWeChatGroup(name, { avatar: r.result });
          UI.toast('群头像已更新');
          renderGroupInfo();
        } catch (err) { UI.toast('更新失败：' + err.message); }
      };
      r.readAsDataURL(f);
    });
    body.querySelector('[data-act=rename]').addEventListener('click', async () => {
      const oldName = m.displayName || name;
      const v = await promptDialog('修改群聊名称', '群名', oldName);
      if (v && v !== oldName) {
        await API.updateWeChatGroup(name, { displayName: v });
        UI.toast('已修改');
        if (current && current.name === name) current = await API.getWeChatGroup(name);
        renderGroupInfo();
        // 群内通知 + 讨论
        const meName = (meInfo() || {}).name || '我';
        await groupEventNotice(name, '你已将「' + oldName + '」改名为「' + v + '」', '群里刚有一条系统通知：' + meName + ' 把群名改成了「' + v + '」。成员们围绕新群名自然地聊两句（调侃、吐槽都行）。');
      }
    });
    const annBtn = body.querySelector('[data-act=ann]');
    if (annBtn) annBtn.addEventListener('click', async () => {
      const v = await promptDialog('编辑群公告', '群公告内容', m.announcement || '');
      if (v != null) {
        await API.updateWeChatGroup(name, { announcement: v });
        UI.toast('已保存公告');
        if (current && current.name === name) current = await API.getWeChatGroup(name);
        renderGroupInfo();
        renderChat(true);
        // 群内通知 + 讨论（公告更新是大事，值得聊）
        const meName = (meInfo() || {}).name || '我';
        await groupEventNotice(name, '你更新了群公告', '群里刚有一条系统通知：' + meName + ' 更新了群公告。成员们看看公告内容，围绕公告聊几句。');
      }
    });
    body.querySelectorAll('[data-act=member]').forEach(el => {
      el.addEventListener('click', () => memberActionSheet(name, el.dataset.key, el.dataset.name, m, current));
    });
    body.querySelector('#gi-clear-chat').addEventListener('click', async () => {
      const ok = await UI.confirm('清空群「' + (m.displayName || name) + '」的全部聊天记录？群信息和成员保留。', { okText: '清空' });
      if (!ok) return;
      try {
        await API.clearWeChatGroupMessages(name);
        UI.toast('已清空聊天记录');
        if (current && current.name === name) {
          current = await API.getWeChatGroup(name);
          renderChat(true);
        }
        renderGroupInfo();
      } catch (e) { UI.toast('清空失败：' + e.message); }
    });
    body.querySelector('#gi-del-group').addEventListener('click', async () => {
      const ok = await UI.confirm('解散群聊「' + (m.displayName || name) + '」？所有聊天记录会删除。', { okText: '解散' });
      if (!ok) return;
      try {
        await API.deleteWeChatGroup(name);
        UI.toast('群已解散');
        current = null;
        openGroups();
      } catch (e) { UI.toast('解散失败：' + e.message); }
    });
    // 加人入口（所有成员可用，无需管理员权限）
    const addBtn = document.getElementById('gi-add-member');
    if (addBtn) addBtn.addEventListener('click', openGroupAddModal);
  }

  /* ---------------- 添加群成员（拉人进群，无需管理员权限） ---------------- */
  function openGroupAddModal() {
    if (!current) return;
    const inKeys = new Set(current.members.map(x => x.key));
    const list = document.getElementById('group-add-list');
    const chars = App.state.characters.filter(c => !inKeys.has(App.charKey(c)));
    list.innerHTML = chars.map(c => {
      const avatar = UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
      return `<label class="share-char-item" data-key="${UI.esc(App.charKey(c))}">
        <span class="avatar sm">${avatar}</span>
        <span class="share-char-name">${UI.esc(App.displayName(c))}</span>
        <input type="checkbox" value="${UI.esc(App.charKey(c))}">
      </label>`;
    }).join('') || '<div class="share-empty">通讯录里没有更多角色可加了</div>';
    list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', updateGroupAddCount));
    updateGroupAddCount();
    document.getElementById('group-add-tip').textContent = '';
    document.getElementById('group-add-modal').style.display = 'flex';
  }
  function updateGroupAddCount() {
    const n = document.querySelectorAll('#group-add-list input[type=checkbox]:checked').length;
    const el = document.getElementById('group-add-count');
    if (el) el.textContent = n ? '已选 ' + n + ' 个' : '';
  }
  async function doGroupAdd() {
    if (!current) return;
    const name = current.name;
    const keys = [...document.querySelectorAll('#group-add-list input[type=checkbox]:checked')].map(cb => cb.value);
    const tip = document.getElementById('group-add-tip');
    if (!keys.length) { tip.textContent = '请至少勾选一个成员'; return; }
    tip.textContent = '添加中…';
    tip.className = 'modal-tip loading';
    try {
      const names = [];
      for (const k of keys) {
        await API.addGroupMember(name, k);
        const c = App.charByKey(k);
        names.push(c ? App.displayName(c) : k);
      }
      document.getElementById('group-add-modal').style.display = 'none';
      current = await API.getWeChatGroup(name);
      renderGroupInfo();
      UI.toast('已添加 ' + names.join('、'));
      // 群通知 + 成员欢迎讨论
      const meName = (meInfo() || {}).name || '我';
      await groupEventNotice(name, '你已将「' + names.join('、') + '」拉进群聊', '群里刚有一条系统通知：' + meName + ' 把 ' + names.join('、') + ' 拉进了群聊。大家自然地欢迎一下。');
    } catch (e) { tip.textContent = '添加失败：' + e.message; tip.className = 'modal-tip'; }
  }

  async function memberActionSheet(name, key, displayName, meta, cur) {
    const admins = meta.adminKeys || [];
    const owner = meta.owner || playerKey(); // owner 为空（旧群）→ 玩家即群主
    const isOwnerTarget = key === owner;       // 目标成员是群主
    const isAdmin = admins.indexOf(key) >= 0;
    const meKey = playerKey();
    const iAmOwner = meKey === owner;          // 我是群主
    const iAmAdmin = admins.indexOf(meKey) >= 0; // 我是管理员
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const sheet = document.createElement('div');
    sheet.className = 'msg-actions';
    const btn = (label, danger, fn) => {
      const b = document.createElement('div');
      b.className = 'msg-action' + (danger ? ' danger' : '');
      b.textContent = label;
      b.addEventListener('click', async () => { mask.remove(); await fn(); });
      sheet.appendChild(b);
    };
    // 群主不能被管理（微信里群主最大）
    if (!isOwnerTarget) {
      // 群主：设/取消管理员 + 转让群主
      if (iAmOwner) {
        btn(isAdmin ? '取消管理员' : '设为管理员', false, async () => {
          try {
            await API.setGroupAdmin(name, key, !isAdmin);
            const meName = (meInfo() || {}).name || '我';
            await groupEventNotice(name, '你已将「' + displayName + '」' + (isAdmin ? '取消管理员' : '设为管理员'), '群里刚有一条系统通知：' + meName + ' 把 ' + displayName + (isAdmin ? '取消了管理员' : '设为管理员') + '。成员们围绕这件事自然地聊几句。');
            renderGroupInfo();
          } catch (err) { UI.toast('操作失败：' + err.message); }
        });
        btn('转让群主给「' + displayName + '」', false, async () => {
          const ok = await UI.confirm('确定把群主转让给 ' + displayName + ' ？转让后你将变为普通成员。', { okText: '转让' });
          if (!ok) return;
          try {
            await API.transferGroupOwner(name, key);
            const meName = (meInfo() || {}).name || '我';
            await groupEventNotice(name, '你已将群主转让给「' + displayName + '」', '群里刚有一条系统通知：' + meName + ' 把群主转让给了 ' + displayName + '。成员们围绕这件事自然地聊几句（恭喜、调侃等）。');
            renderGroupInfo();
          } catch (err) { UI.toast('转让失败：' + err.message); }
        });
      }
      // 禁言/移出：群主可对所有成员；管理员可对普通成员
      const canPunish = iAmOwner || (iAmAdmin && !isAdmin);
      if (canPunish) {
        btn('禁言 / 解除禁言', false, async () => await muteSheet(name, key, displayName, meta));
        btn('移出群聊', true, async () => {
          const ok = await UI.confirm('把 ' + displayName + ' 移出群聊？', { okText: '移出' });
          if (!ok) return;
          try {
            await API.kickGroupMember(name, key);
            UI.toast('已移出 ' + displayName);
            if (current && current.name === name) current = await API.getWeChatGroup(name);
            renderGroupInfo();
            // 群里通知 + 剩余成员讨论
            const meName = (meInfo() || {}).name || '我';
            await groupEventNotice(name, '你已将「' + displayName + '」移出群聊', '群里刚有一条系统通知：' + meName + ' 把 ' + displayName + ' 移出群聊。剩余成员围绕这件事自然地聊几句。');
          } catch (err) { UI.toast('移出失败：' + err.message); }
        });
      }
    } else {
      btn('群主', false, async () => {});
    }
    const cancel = document.createElement('div');
    cancel.className = 'msg-action';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => mask.remove());
    sheet.appendChild(cancel);
    mask.appendChild(sheet);
    mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
  }

  async function muteSheet(name, key, displayName, meta) {
    const muted = meta.muted || {};
    const now = Date.now();
    const curUntil = muted[key];
    const opts = [
      ['解除禁言', 0],
      ['禁言 10 分钟', now + 10 * 60 * 1000],
      ['禁言 1 小时', now + 60 * 60 * 1000],
      ['禁言 6 小时', now + 6 * 60 * 60 * 1000],
      ['禁言 1 天', now + 24 * 60 * 60 * 1000],
      ['永久禁言', now + 3650 * 24 * 60 * 60 * 1000],
    ];
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const sheet = document.createElement('div');
    sheet.className = 'msg-actions';
    opts.forEach(([label, until]) => {
      if (until === 0 && !(curUntil && curUntil > now)) return;
      const b = document.createElement('div');
      b.className = 'msg-action';
      b.textContent = label;
      b.addEventListener('click', async () => {
        mask.remove();
        await API.muteGroupMember(name, key, until || null);
        // 立即刷新群数据（含最新禁言名单），避免 AI 后续还用旧名单让被禁言者发言
        if (current && current.name === name) current = await API.getWeChatGroup(name);
        UI.toast('已' + label + displayName);
        renderGroupInfo();
        // ① 群里发系统通知 + 其他成员围绕禁言聊
        const meName = (meInfo() || {}).name || '我';
        let noticeText, eventText;
        if (until > now) {
          const perm = (until - now) >= 3650 * 24 * 60 * 60 * 1000; // until 是绝对时间戳，减 now 才是剩余时长
          const dur = perm ? '永久' : ('至 ' + UI.fmtTime(new Date(until).toISOString()));
          noticeText = meName + ' 将「' + displayName + '」禁言' + dur;
          eventText = '群里刚有一条系统通知：' + noticeText + '。其他成员围绕这件事自然地聊几句（吐槽、调侃、打抱不平都行）。';
        } else {
          noticeText = meName + ' 解除了「' + displayName + '」的禁言';
          eventText = '群里刚有一条系统通知：' + noticeText + '。其他成员围绕这件事自然地聊几句（比如欢迎回来）。';
        }
        await groupEventNotice(name, noticeText, eventText);
        // ② 玩家禁言了某角色 → 该角色私信玩家质问/解释，展开话题
        if (until > now && key && String(key).indexOf('__me__') !== 0) {
          const c = App.charByKey(key);
          if (c) {
            try {
              let s = Store.sessionsOf(App.charKey(c), c.name)[0];
              if (!s && typeof Chat.createSession === 'function') s = await Chat.createSession(c);
              if (s && typeof Chat.sendCharMessageToPlayer === 'function') {
                Chat.sendCharMessageToPlayer(c, s, '你刚刚在群「' + name + '」里被管理员禁言了，私下找玩家质问/聊这件事。');
              }
            } catch (e2) {}
          }
        }
      });
      sheet.appendChild(b);
    });
    const cancel = document.createElement('div');
    cancel.className = 'msg-action';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => mask.remove());
    sheet.appendChild(cancel);
    mask.appendChild(sheet);
    mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
  }

  function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px';
  }

  return { init, openGroups, openGroupChat, openCreateModal, replyGroupBackground, groupSpontaneous };
})();
