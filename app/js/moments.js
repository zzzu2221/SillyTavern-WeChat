/* ============ 朋友圈页 ============ */
const Moments = (() => {
  let posts = [];
  let busy = false;
  let filterKey = null; // 非空时只显示该角色发的动态（从角色详情页进来）

  async function load() {
    const data = await API.getMoments();
    posts = (data && data.posts) || [];
    return posts;
  }

  function charOptions(sortedChars) {
    return (sortedChars || []).map(c =>
      `<option value="${UI.esc(App.charKey(c))}">${UI.esc(App.displayName(c))}</option>`
    ).join('');
  }
  function sortedChars() {
    return App.state.characters.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
  }
  /** 生图预设下拉，默认选中 defaultPreset */
  function fillPresets(sel) {
    const cfg = App.state.config || {};
    const list = cfg.imagePresets || [];
    const def = cfg.imageDefaultPreset || '';
    let opts = '<option value="">无</option>' + list.map(p => `<option value="${UI.esc(p)}"${p === def ? ' selected' : ''}>${UI.esc(p)}</option>`).join('');
    sel.innerHTML = opts;
    if (def && !sel.value) { try { sel.value = def; } catch (e) {} }
  }
  function charByKeyOrName(key, name) {
    return App.charByKey(key) || (name ? App.charByName(name) : null);
  }
  /** 生图是否启用（设置面板「启用生图」开关，关闭时隐藏删除功能与配图入口） */
  function imgEnabled() {
    const cfg = App.state.config || {};
    return cfg.imageEnabled !== false;
  }

  function filteredPosts() {
    if (!filterKey) return posts;
    return posts.filter(p => p.key === filterKey || p.character === (filterCharName || ''));
  }
  let filterCharName = null;
  /** 判断动态是否为当前 Player 发布 */
  function isMePost(p) {
    const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    if (!player) return false;
    return p.key === ('__me__' + player.id) || (p.character === player.name && p.key && p.key.indexOf('__me__') === 0);
  }
  /** 动态发布者信息（角色或 Player） */
  function posterInfo(p) {
    const me = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    if (p.key && p.key.indexOf('__me__') === 0 && me) {
      return { name: me.name || '我', avatar: me.avatar || '' };
    }
    const c = charByKeyOrName(p.key, p.character);
    return { name: p.character || '未知', avatar: c ? c.avatar : '' };
  }

  /* ---- 封面 + 时间线 ---- */
  function render() {
    const body = document.getElementById('moments-body');
    const cfg = App.state.config || {};
    const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    const cover = (player && player.cover) || '';
    const pName = (player && player.name) || '我';
    const pAvatar = player && player.avatar && UI.avatarSrc(player.avatar) ? `<img src="${UI.esc(UI.avatarSrc(player.avatar))}">` : '';

    const list = filteredPosts();
    // 覆盖层：封面
    const coverHtml = `
      <div class="moments-cover">
        ${cover ? `<div class="moments-cover-bg" style="background-image:url('${UI.esc(cover)}')"></div>` : '<div class="moments-cover-bg"></div>'}
        <div class="moments-cover-user">
          <span class="moments-cover-name">${UI.esc(pName)}</span>
          <span class="moments-cover-avatar">${pAvatar}</span>
        </div>
      </div>`;

    const filterHtml = filterKey
      ? `<div class="moments-filterbar">正在看「${UI.esc(filterCharName || '该角色')}」的朋友圈 <button class="friend-btn friend-ok" id="moments-filter-all" type="button">看全部</button></div>`
      : '';

    if (!list.length) {
      body.innerHTML = coverHtml + filterHtml + `<div class="empty"><div class="big">🌐</div>${filterKey ? 'TA 还没发过朋友圈' : '朋友圈还是空的'}<br><br>${filterKey ? '' : '点击右上角 📷 发布第一条动态吧'}</div>`;
    } else {
      const html = list.map((p, idx) => {
        const info = posterInfo(p);
        const avatar = UI.avatarSrc(info.avatar) ? `<img src="${UI.esc(UI.avatarSrc(info.avatar))}">` : '';
        const imgHtml = p.img
          ? `<div class="moment-img-wrap"><img src="${UI.esc(p.img)}" class="moment-img" data-src="${UI.esc(p.img)}" loading="lazy"></div>`
          : '';
        const commentsHtml = (p.comments || []).map(cm =>
          `<div class="comment-item"><span class="cname">${UI.esc(cm.character)}</span>：${UI.esc(window.stripActions ? window.stripActions(cm.text) : cm.text)}<span class="comment-del" data-idx="${idx}" data-time="${UI.esc(cm.time)}" data-key="${UI.esc(cm.key || '')}">✕</span></div>`
        ).join('');
        return `
        <div class="moment-card" data-idx="${idx}" data-mid="${UI.esc(p.id)}">
          <div class="moment-head">
            <div class="avatar">${avatar}</div>
            <div>
              <div class="moment-name">${UI.esc(info.name)}</div>
              <div class="moment-time">${UI.fmtTime(p.time)}</div>
            </div>
            ${`<span class="moment-del" data-idx="${idx}" title="删除这条动态">⋯</span>`}
          </div>
          ${p.text ? `<div class="moment-text">${UI.esc(window.stripActions ? window.stripActions(p.text) : p.text).replace(/\n/g, '<br>')}</div>` : ''}
          ${imgHtml}
          <div class="moment-comments">${commentsHtml}</div>
          <div class="comment-actions">
            <button class="btn-comment" data-idx="${idx}">评论</button>
          </div>
        </div>`;
      }).join('');
      body.innerHTML = coverHtml + filterHtml + `<div class="moments-bg">${html}</div>`;
    }

    if (filterKey) {
      const allBtn = document.getElementById('moments-filter-all');
      if (allBtn) allBtn.addEventListener('click', () => { filterKey = null; filterCharName = null; document.getElementById('moments-title-label') && (document.getElementById('moments-title-label').textContent = '朋友圈'); render(); });
    }

    body.querySelectorAll('.moment-img').forEach(img => {
      img.addEventListener('click', () => UI.lightbox(img.dataset.src));
    });
    body.querySelectorAll('.btn-comment').forEach(btn => {
      btn.addEventListener('click', () => openCommentModal(list[Number(btn.dataset.idx)]));
    });
    body.querySelectorAll('.moment-del').forEach(el => {
      el.addEventListener('click', async () => {
        const p = list[Number(el.dataset.idx)];
        if (!p) return;
        const ok = await UI.confirm('删除这条动态及其全部评论？', { okText: '删除' });
        if (!ok) return;
        try {
          await API.deleteMoment(p.id);
          UI.toast('已删除');
          await load();
          render();
        } catch (e) { UI.toast('删除失败：' + e.message); }
      });
    });
    body.querySelectorAll('.comment-del').forEach(el => {
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const p = list[Number(el.dataset.idx)];
        if (!p) return;
        const ok = await UI.confirm('删除这条评论？', { okText: '删除' });
        if (!ok) return;
        try {
          await API.deleteComment(p.id, el.dataset.time, el.dataset.key);
          UI.toast('已删除');
          await load();
          render();
        } catch (e) { UI.toast('删除失败：' + e.message); }
      });
    });
  }

  /* ---- 只看某角色发的朋友圈（角色详情页入口） ---- */
  function openFor(character) {
    filterKey = App.charKey(character);
    filterCharName = App.displayName(character);
    const label = document.getElementById('moments-title-label');
    if (label) label.textContent = App.displayName(character) + ' 的朋友圈';
    App.showTab('moments');
  }

  /* ---- 发布弹层 ---- */
  function openPublishModal() {
    const mask = document.getElementById('moment-modal');
    const sel = document.getElementById('moment-char');
    sel.innerHTML = charOptions(sortedChars());
    fillPresets(document.getElementById('moment-preset'));
    document.getElementById('moment-text').value = '';
    document.getElementById('moment-imgprompt').value = '';
    document.getElementById('moment-tip').textContent = '';
    // 生图开关只影响「生图」能力：无图/上传图片始终可用
    const en = imgEnabled();
    setImgMode(en ? 'gen' : 'upload');
    const imgModeBtns = document.querySelectorAll('#moment-imgmode .seg-btn');
    imgModeBtns.forEach(b => {
      b.style.display = (b.dataset.mode === 'none' || b.dataset.mode === 'upload' || (b.dataset.mode === 'gen' && en)) ? '' : 'none';
    });
    // 参考角色：默认选当前聊天/详情页角色（若有）
    const curChar = App.state.currentCharacter;
    if (curChar) {
      const opt = [...sel.options].find(o => o.value === App.charKey(curChar));
      if (opt) sel.value = opt.value;
    }
    mask.style.display = 'flex';
  }

  function closePublishModal() {
    document.getElementById('moment-modal').style.display = 'none';
  }
  /** 配图方式：none / gen / upload */
  function setImgMode(mode) {
    document.querySelectorAll('#moment-imgmode .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const presetField = document.getElementById('moment-preset-field');
    const imgField = document.getElementById('moment-imgprompt-field');
    const upField = document.getElementById('moment-upload-field');
    if (presetField) presetField.style.display = mode === 'gen' ? '' : 'none';
    if (imgField) imgField.style.display = mode === 'gen' ? '' : 'none';
    if (upField) upField.style.display = mode === 'upload' ? '' : 'none';
  }

  async function submitPublish() {
    if (busy) return;
    const text = document.getElementById('moment-text').value.trim();
    if (!text) { document.getElementById('moment-tip').textContent = '请填写文案'; return; }
    const mode = document.querySelector('#moment-imgmode .seg-btn.active').dataset.mode;
    const tip = document.getElementById('moment-tip');
    // 发布朋友圈固定由「我」发布
    const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    if (!player) { tip.textContent = '没有可用账号'; return; }
    const characterKey = '__me__' + player.id;
    const characterName = player.name || '我';
    const imagePrompt = mode === 'gen' ? document.getElementById('moment-imgprompt').value.trim() : '';
    const preset = mode === 'gen' ? document.getElementById('moment-preset').value : '';
    let imgData = '';
    if (mode === 'upload') {
      const f = document.getElementById('moment-file').files && document.getElementById('moment-file').files[0];
      if (f) imgData = await readFileData(f);
    }
    busy = true;
    tip.textContent = (mode === 'gen' && imagePrompt) ? '生图中，请稍候…（约 20~60 秒）' : '发布中…';
    tip.className = 'modal-tip loading';
    try {
      const payload = { character: characterKey, characterName, text };
      if (mode === 'gen' && imagePrompt) { payload.imagePrompt = imagePrompt; payload.preset = preset; }
      if (mode === 'upload' && imgData) { payload.imgData = imgData; }
      const post = await API.publishMoment(payload);
      tip.textContent = '发布成功';
      tip.className = 'modal-tip';
      closePublishModal();
      UI.toast('发布成功');
      await load();
      render();
      // AI 自动评论/点赞
      const target = post && post.id ? { id: post.id, key: characterKey, character: characterName, text } : (posts[0] || null);
      if (target) autoCommentMoment(target);
    } catch (e) {
      tip.textContent = '失败：' + e.message;
      tip.className = 'modal-tip';
    }
    busy = false;
  }
  /** 手动发布：AI 生成草稿（以「我」的口吻，参考所选角色的聊天） */
  async function aiDraftForMe() {
    if (busy) return;
    const character = document.getElementById('moment-char').value;
    const c = App.charByKey(character);
    if (!c) { document.getElementById('moment-tip').textContent = '请先选择参考角色'; return; }
    const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    busy = true;
    const tip = document.getElementById('moment-tip');
    tip.textContent = 'AI 正在结合聊天生成草稿…';
    tip.className = 'modal-tip loading';
    try {
      const r = await API.genAutoMoment({
        character, characterName: App.displayName(c),
        recentChat: await recentChatOf(character),
        hint: '',
        asMe: true,
        meName: player ? (player.name || '我') : '我',
        meDesc: player ? [player.description, player.signature, player.worldbook].filter(Boolean).join('\n') : '',
      });
      document.getElementById('moment-text').value = r.text || '';
      document.getElementById('moment-imgprompt').value = r.imgPrompt || '';
      tip.textContent = '草稿已生成，可修改后发布';
      tip.className = 'modal-tip';
    } catch (e) {
      tip.textContent = '生成失败：' + e.message;
      tip.className = 'modal-tip';
    }
    busy = false;
  }
  function readFileData(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('读取图片失败'));
      fr.readAsDataURL(file);
    });
  }

  /* ---- AI 自动评论/点赞：优先让「与当前账号有关联关系」的角色评论 ---- */
  async function autoCommentMoment(post) {
    const cfg = App.state.config || {};
    if (!cfg.autoComment || !post) return;
    const n = Math.min(6, Math.max(1, cfg.autoCommentN || 2));
    const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    const rels = (player && Array.isArray(player.relations)) ? player.relations : [];
    // 关联角色优先（排除发布者自己）
    const relCandidates = rels
      .map(r => r.key ? App.charByKey(r.key) : null)
      .filter(c => c && App.charKey(c) !== post.key && App.displayName(c) !== post.character);
    const others = sortedChars().filter(c => App.charKey(c) !== post.key && App.displayName(c) !== post.character);
    const pool = relCandidates.length ? relCandidates : others;
    if (!pool.length) return;
    const picked = pool.slice().sort(() => Math.random() - 0.5).slice(0, n);
    UI.toast('AI 正在让角色评论…');
    let okCount = 0;
    for (const c of picked) {
      try {
        const rel = rels.find(r => r.key === App.charKey(c));
        const r = await API.aiComment({ momentId: post.id, character: App.charKey(c), characterName: App.displayName(c), momentText: post.text || '', posterName: post.character || '', relation: rel ? (rel.relation || '') : '' });
        if (r && r.text) {
          await API.addComment({ momentId: post.id, character: App.charKey(c), characterName: App.displayName(c), text: r.text });
          okCount++;
          // 本地数据 + 局部渲染：一条一条带随机间隔弹出（仿聊天逐条）
          const cm = { character: App.displayName(c), text: r.text, time: new Date().toISOString(), key: App.charKey(c) };
          (post.comments = post.comments || []).push(cm);
          appendCommentEl(post.id, cm);
          await sleep(900 + Math.random() * 1100);
        }
      } catch (e) { /* 单条失败忽略 */ }
    }
    if (okCount) {
      UI.toast('AI 已自动添加 ' + okCount + ' 条评论');
      await load();
      render();
    }
  }

  /** 局部追加一条评论到对应朋友圈卡片（AI 自动评论逐条弹出用），并绑定删除 */
  function appendCommentEl(postId, cm) {
    const card = Array.from(document.querySelectorAll('.moment-card')).find(c => c.dataset.mid === String(postId));
    if (!card) return;
    const cbox = card.querySelector('.moment-comments');
    if (!cbox) return;
    const el = document.createElement('div');
    el.className = 'comment-item';
    el.innerHTML = `<span class="cname">${UI.esc(cm.character)}</span>：${UI.esc(window.stripActions ? window.stripActions(cm.text) : cm.text)}<span class="comment-del" data-time="${UI.esc(cm.time)}" data-key="${UI.esc(cm.key || '')}">✕</span>`;
    cbox.appendChild(el);
    const del = el.querySelector('.comment-del');
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const ok = await UI.confirm('删除这条评论？', { okText: '删除' });
      if (!ok) return;
      try {
        await API.deleteComment(postId, del.dataset.time, del.dataset.key);
        UI.toast('已删除');
        await load(); render();
      } catch (e) { UI.toast('删除失败：' + e.message); }
    });
    el.scrollIntoView({ block: 'nearest' });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ---- 评论弹层 ---- */
  let commentTarget = null;
  function setCommentWho(who) {
    document.querySelectorAll('#comment-who .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.who === who));
    const f = document.getElementById('comment-char-field');
    if (f) f.style.display = who === 'char' ? '' : 'none';
    const aiBtn = document.getElementById('comment-ai');
    if (aiBtn) aiBtn.style.display = who === 'char' ? '' : 'none';
  }
  function openCommentModal(post) {
    commentTarget = post;
    const mask = document.getElementById('comment-modal');
    const sel = document.getElementById('comment-char');
    sel.innerHTML = charOptions(sortedChars());
    document.getElementById('comment-text').value = '';
    document.getElementById('comment-tip').textContent = '';
    setCommentWho('char');
    const others = sortedChars().filter(c => App.charKey(c) !== post.key && App.displayName(c) !== post.character);
    if (others.length) sel.value = App.charKey(others[0]);
    else if (sel.options.length) sel.value = sel.options[0].value;
    mask.style.display = 'flex';
  }
  function closeCommentModal() {
    document.getElementById('comment-modal').style.display = 'none';
    commentTarget = null;
  }
  /** 解析评论者：__me__<id> → Player；否则角色 key */
  function commenterInfo(key, name) {
    if (key && key.indexOf('__me__') === 0) {
      const me = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
      return { key, name: name || (me ? me.name : '我') };
    }
    return { key, name };
  }

  async function submitComment() {
    if (busy || !commentTarget) return;
    const who = document.querySelector('#comment-who .seg-btn.active').dataset.who;
    const text = document.getElementById('comment-text').value.trim();
    if (!text) { document.getElementById('comment-tip').textContent = '请填写评论内容'; return; }
    let character, characterName;
    if (who === 'me') {
      const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
      if (!player) { document.getElementById('comment-tip').textContent = '没有可用账号'; return; }
      character = '__me__' + player.id;
      characterName = player.name || '我';
    } else {
      character = document.getElementById('comment-char').value;
      const c = App.charByKey(character);
      if (!c) { document.getElementById('comment-tip').textContent = '请选择角色'; return; }
      characterName = App.displayName(c);
    }
    busy = true;
    const tip = document.getElementById('comment-tip');
    tip.textContent = '发送中…';
    tip.className = 'modal-tip loading';
    try {
      await API.addComment({ momentId: commentTarget.id, character, characterName, text });
      closeCommentModal();
      await load();
      render();
    } catch (e) {
      tip.textContent = '失败：' + e.message;
      tip.className = 'modal-tip';
    }
    busy = false;
  }

  async function aiComment() {
    if (busy || !commentTarget) return;
    const who = document.querySelector('#comment-who .seg-btn.active').dataset.who;
    let character, characterName;
    if (who === 'me') {
      const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
      if (!player) return;
      character = '__me__' + player.id;
      characterName = player.name || '我';
    } else {
      character = document.getElementById('comment-char').value;
      const c = App.charByKey(character);
      if (!c) return;
      characterName = App.displayName(c);
    }
    busy = true;
    const tip = document.getElementById('comment-tip');
    tip.textContent = 'AI 正在以「' + characterName + '」的身份构思评论…';
    tip.className = 'modal-tip loading';
    try {
      const r = await API.aiComment({ momentId: commentTarget.id, character, characterName, momentText: commentTarget.text, isMe: who === 'me' });
      document.getElementById('comment-text').value = r.text || '';
      tip.textContent = '已生成，点「发送」确认';
      tip.className = 'modal-tip';
    } catch (e) {
      tip.textContent = '失败：' + e.message;
      tip.className = 'modal-tip';
    }
    busy = false;
  }

  /* ---- AI 自动发朋友圈 ---- */
  function setAiImgMode(mode) {
    document.querySelectorAll('#aim-imgmode .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const pf = document.getElementById('aim-preset-field');
    const ig = document.getElementById('aim-img-field');
    const uf = document.getElementById('aim-upload-field');
    if (pf) pf.style.display = mode === 'gen' ? '' : 'none';
    if (ig) ig.style.display = mode === 'gen' ? '' : 'none';
    if (uf) uf.style.display = mode === 'upload' ? '' : 'none';
  }
  function openAiMomentModal() {
    const mask = document.getElementById('ai-moment-modal');
    const sel = document.getElementById('aim-char');
    sel.innerHTML = charOptions(sortedChars());
    fillPresets(document.getElementById('aim-preset'));
    document.getElementById('aim-hint').value = '';
    document.getElementById('aim-text').value = '';
    document.getElementById('aim-img').value = '';
    setAiTip('', '');
    // AI 发圈配图方式完全独立：不受生图总开关影响，始终可选「无图 / AI 生图」
    setAiImgMode('gen');
    const genBtn = document.querySelector('#aim-imgmode .seg-btn[data-mode="gen"]');
    if (genBtn) genBtn.style.display = '';
    const curChar = App.state.currentCharacter;
    if (curChar) {
      const opt = [...sel.options].find(o => o.value === App.charKey(curChar));
      if (opt) sel.value = opt.value;
    }
    mask.style.display = 'flex';
  }
  function closeAiMomentModal() {
    document.getElementById('ai-moment-modal').style.display = 'none';
  }
  function setAiTip(msg, cls) {
    const tip = document.getElementById('aim-tip');
    tip.textContent = msg || '';
    tip.className = 'modal-tip' + (cls ? ' ' + cls : '');
  }

  async function recentChatOf(characterKey) {
    const c = App.charByKey(characterKey);
    if (!c) return [];
    const sessions = Store.sessionsOf(App.charKey(c), c.name);
    if (!sessions.length) return [];
    const file = sessions[0].file;
    const chat = await API.getChat(c.avatar_file || c.avatar, file);
    return (Array.isArray(chat) ? chat : []).map(m => ({ is_user: !!m.is_user, mes: m.mes }));
  }

  /** 取角色的生图标签（当前账号关联关系里配置的，AI 写提示词时带上作品/角色名） */
  function imgTagOf(charKey) {
    try {
      const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
      const rel = player && (player.relations || []).find(r => r.key === charKey);
      return (rel && rel.imgTag) || '';
    } catch (e) { return ''; }
  }

  async function genAiDraft() {
    if (busy) return;
    const character = document.getElementById('aim-char').value;
    const c = App.charByKey(character);
    if (!c) { setAiTip('请选择角色'); return; }
    busy = true;
    setAiTip('AI 正在结合最近聊天构思文案与提示词…', 'loading');
    try {
      const hint = document.getElementById('aim-hint').value.trim();
      const recentChat = await recentChatOf(character);
      const imgTag = imgTagOf(character);
      const r = await API.genAutoMoment({ character, characterName: App.displayName(c), recentChat, hint, imgTag });
      document.getElementById('aim-text').value = r.text || '';
      document.getElementById('aim-img').value = r.imgPrompt || '';
      setAiTip('草稿已生成，可修改后发布', '');
      const autoPost = !!(App.state.config && App.state.config.autoPost);
      if (autoPost) {
        setAiTip('已开启自动发布，正在发布…', 'loading');
        try {
          const mode = document.querySelector('#aim-imgmode .seg-btn.active').dataset.mode;
          let img = '';
          let imgData = '';
          if (mode === 'gen') img = r.imgPrompt || '';
          else if (mode === 'upload') {
            const f = document.getElementById('aim-file').files && document.getElementById('aim-file').files[0];
            if (f) imgData = await readFileData(f);
          }
          await doPublish(character, App.displayName(c), r.text, img, document.getElementById('aim-preset').value, true, imgData);
        } catch (e) {
          setAiTip('发布失败：' + e.message);
        }
      }
    } catch (e) {
      setAiTip('生成失败：' + e.message);
    }
    busy = false;
  }

  async function doPublish(characterKey, characterName, text, imagePrompt, preset, isAuto, imgData) {
    setAiTip((modeHint(imagePrompt, imgData)), 'loading');
    const post = await API.publishMoment({ character: characterKey, characterName, text, imagePrompt, preset, imgData, force: true });
    closeAiMomentModal();
    UI.toast(isAuto ? 'AI 已自动发布' : '发布成功');
    await load();
    render();
    if (post && post.id) autoCommentMoment({ id: post.id, key: characterKey, character: characterName, text });
  }
  function modeHint(imagePrompt, imgData) {
    return (imagePrompt && String(imagePrompt).trim()) ? '生图中，请稍候…（约 20~60 秒）' : (imgData && String(imgData).trim() ? '发布中…' : '发布中…');
  }

  async function submitAiPublish() {
    if (busy) return;
    const character = document.getElementById('aim-char').value;
    const c = App.charByKey(character);
    const text = document.getElementById('aim-text').value.trim();
    const mode = document.querySelector('#aim-imgmode .seg-btn.active').dataset.mode;
    const imagePrompt = (mode === 'gen') ? document.getElementById('aim-img').value.trim() : '';
    const preset = document.getElementById('aim-preset').value;
    let imgData = '';
    if (mode === 'upload') {
      const f = document.getElementById('aim-file').files && document.getElementById('aim-file').files[0];
      if (f) imgData = await readFileData(f);
    }
    if (!c || !text) { setAiTip('请选择角色并先生成/填写文案'); return; }
    busy = true;
    try {
      await doPublish(character, App.displayName(c), text, imagePrompt, preset, false, imgData);
    } catch (e) {
      setAiTip('发布失败：' + e.message);
    }
    busy = false;
  }

  function init() {
    document.getElementById('btn-moments-add').addEventListener('click', openPublishModal);
    document.getElementById('btn-moments-ai').addEventListener('click', openAiMomentModal);
    document.getElementById('moment-cancel').addEventListener('click', closePublishModal);
    document.getElementById('moment-submit').addEventListener('click', submitPublish);
    document.getElementById('moment-ai-draft').addEventListener('click', aiDraftForMe);
    // 配图方式切换
    document.querySelectorAll('#moment-imgmode .seg-btn').forEach(b => b.addEventListener('click', () => setImgMode(b.dataset.mode)));
    document.getElementById('moment-upload-btn').addEventListener('click', () => document.getElementById('moment-file').click());
    document.getElementById('moment-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const prev = document.getElementById('moment-file-preview');
      const fr = new FileReader();
      fr.onload = () => { prev.src = fr.result; prev.style.display = 'block'; };
      fr.readAsDataURL(f);
    });
    document.getElementById('aim-upload-btn').addEventListener('click', () => document.getElementById('aim-file').click());
    document.getElementById('aim-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const prev = document.getElementById('aim-file-preview');
      const fr = new FileReader();
      fr.onload = () => { prev.src = fr.result; prev.style.display = 'block'; };
      fr.readAsDataURL(f);
    });
    document.getElementById('comment-cancel').addEventListener('click', closeCommentModal);
    document.getElementById('comment-submit').addEventListener('click', submitComment);
    document.getElementById('comment-ai').addEventListener('click', aiComment);
    document.querySelectorAll('#comment-who .seg-btn').forEach(b => b.addEventListener('click', () => setCommentWho(b.dataset.who)));
    document.getElementById('aim-cancel').addEventListener('click', closeAiMomentModal);
    document.getElementById('aim-gen').addEventListener('click', genAiDraft);
    document.getElementById('aim-publish').addEventListener('click', submitAiPublish);
    document.querySelectorAll('#aim-imgmode .seg-btn').forEach(b => b.addEventListener('click', () => setAiImgMode(b.dataset.mode)));
    document.getElementById('moment-modal').addEventListener('click', e => {
      if (e.target.id === 'moment-modal') closePublishModal();
    });
    document.getElementById('comment-modal').addEventListener('click', e => {
      if (e.target.id === 'comment-modal') closeCommentModal();
    });
    document.getElementById('ai-moment-modal').addEventListener('click', e => {
      if (e.target.id === 'ai-moment-modal') closeAiMomentModal();
    });
  }

  return { render, load, init, openFor };
})();
