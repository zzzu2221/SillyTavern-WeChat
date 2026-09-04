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
      `<option value="${UI.esc(App.charKey(c))}">${UI.esc(shownName(c))}</option>`
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
  /** 按 key/名字解析角色：优先通讯录白名单（state.characters），避免取到白名单外同名卡导致头像/名字不一致 */
  function charByKeyOrName(key, name) {
    const chars = App.state.characters || [];
    const n = String(name || '').trim();
    if (chars.length) {
      if (key) {
        const byKey = chars.find(c => App.charKey(c) === key);
        if (byKey) return byKey;
      }
      if (n) {
        const byName = chars.find(c => String(c.name || '').trim() === n);
        if (byName) return byName;
      }
    }
    return App.charByKey(key) || (name ? App.charByName(name) : null);
  }
  /** 显示名统一走备注（Detail.shownName），无备注 fallback displayName，并去掉首尾空格 */
  function shownName(c) {
    const n = (typeof Detail !== 'undefined' && Detail.shownName) ? Detail.shownName(c) : App.displayName(c);
    return String(n || '').trim();
  }
  /** 评论者显示名：优先按 key/名字从通讯录白名单解析走备注；找不到才用存的名字（去空格） */
  function commentName(cm) {
    const c = cm ? charByKeyOrName(cm.key, cm.character) : null;
    if (c) return shownName(c);
    return String((cm && cm.character) || '未知').trim();
  }
  /** 角色间陌生人判断：任何一方把对方设为「陌生人」→ 朋友圈互不评论。兼容带空格重复卡（key/名字归一化） */
  function isStrangerTo(aKey, bKey) {
    if (!aKey || !bKey || aKey === bKey) return false;
    try {
      const all = (API.getSettings() || {}).charRelations || {};
      if ((all[aKey] && all[aKey][bKey] === '陌生人') || (all[bKey] && all[bKey][aKey] === '陌生人')) return true;
      // 归一化：去首尾空格（重复卡 key 可能只差空格）
      const na = String(aKey).trim(), nb = String(bKey).trim();
      if ((all[na] && all[na][nb] === '陌生人') || (all[nb] && all[nb][na] === '陌生人')) return true;
      // 名字兜底：按角色名 trim 在所有关系里匹配
      const aChar = charByKeyOrName(aKey, ''), bChar = charByKeyOrName(bKey, '');
      if (aChar && bChar) {
        const an = String(aChar.name || '').trim(), bn = String(bChar.name || '').trim();
        if (an && bn) {
          for (const k1 of Object.keys(all)) {
            const c1 = App.charByKey(k1);
            if (!c1 || String(c1.name || '').trim() !== an) continue;
            for (const k2 of Object.keys(all[k1] || {})) {
              const c2 = App.charByKey(k2);
              if (c2 && String(c2.name || '').trim() === bn && all[k1][k2] === '陌生人') return true;
            }
          }
        }
      }
      return false;
    } catch (e) { return false; }
  }
  /** 评论候选：排除发布者自己 + 与发布者互为陌生人的角色 */
  function commentableChars(post) {
    return sortedChars().filter(c =>
      App.charKey(c) !== post.key &&
      shownName(c).trim() !== String(post.character || '').trim() &&
      !isStrangerTo(post.key, App.charKey(c))
    );
  }
  /** 生图是否启用（设置面板「启用生图」开关，关闭时隐藏删除功能与配图入口） */
  function imgEnabled() {
    const cfg = App.state.config || {};
    return cfg.imageEnabled !== false;
  }

  /** 剥离 AI 偶尔复读的存储标记前缀（“对应动态id=…;角色=…;评论=真实内容”），兜底清洗 */
  function cleanCommentTag(t) {
    let s = String(t == null ? '' : t).trim();
    if (!s) return s;
    // 完整标记前缀：对应动态id=…;角色=…;评论=…
    const m = s.match(/^(?:【?朋友圈评论】?)?[\s:：]*对应动态id=[^;]*;\s*角色=[^;]*;\s*(?:key=[^;]*;\s*)?(?:时间=[^;]*;\s*)?评论=\s*/i);
    if (m) return s.slice(m[0].length).trim();
    // 截断式：只剩“对应动态id=…;评论=…”等变体
    s = s.replace(/^(?:【?朋友圈评论】?)?[\s:：]*对应动态id=[^;]*;?(?:\s*角色=[^;]*;?)?(?:\s*key=[^;]*;?)?(?:\s*时间=[^;]*;?)?\s*评论=\s*/i, '');
    return s.trim();
  }
  /** 评论显示文本：括号清洗 + 标记剥离 */
  function commentText(t) {
    const clean = cleanCommentTag(t);
    return window.stripActions ? window.stripActions(clean) : clean;
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
  /** 动态发布者信息（角色或 Player），名字走备注优先，头像按 key 精确解析 */
  function posterInfo(p) {
    const me = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    if (p.key && p.key.indexOf('__me__') === 0 && me) {
      return { name: me.name || '我', avatar: me.avatar || '' };
    }
    const c = charByKeyOrName(p.key, p.character);
    return { name: c ? shownName(c) : String(p.character || '未知').trim(), avatar: c ? c.avatar : '' };
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
          `<div class="comment-item"><span class="cname">${UI.esc(commentName(cm))}</span>：${UI.esc(commentText(cm.text))}<span class="comment-del" data-idx="${idx}" data-time="${UI.esc(cm.time)}" data-key="${UI.esc(cm.key || '')}">✕</span></div>`
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
            <button class="btn-share" data-idx="${idx}">分享</button>
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
    body.querySelectorAll('.btn-share').forEach(btn => {
      btn.addEventListener('click', () => openShareModal(list[Number(btn.dataset.idx)]));
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
    filterCharName = shownName(character);
    const label = document.getElementById('moments-title-label');
    if (label) label.textContent = shownName(character) + ' 的朋友圈';
    App.showTab('moments');
  }

  /** 从聊天卡片跳回：定位到某条朋友圈动态（清掉角色过滤，显示全部并高亮滚动） */
  async function openPostById(id) {
    filterKey = null;
    filterCharName = null;
    const label = document.getElementById('moments-title-label');
    if (label) label.textContent = '朋友圈';
    try { await load(); } catch (e) {}
    App.showTab('moments');
    await sleep(120);
    const el = document.querySelector(`.moment-card[data-mid="${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash-highlight');
      setTimeout(() => el.classList.remove('flash-highlight'), 2200);
    }
  }

  /* ---- 朋友圈单条详情（从转发卡片进入，仿微信单条详情页） ---- */
  let detailPost = null;
  function renderDetail(p) {
    detailPost = p;
    const body = document.getElementById('moment-detail-body');
    if (!body) return;
    const info = posterInfo(p);
    const avatar = UI.avatarSrc(info.avatar) ? `<img src="${UI.esc(UI.avatarSrc(info.avatar))}">` : '';
    const imgs = (Array.isArray(p.img) ? p.img : (p.img ? [p.img] : [])).filter(Boolean);
    const imgHtml = imgs.map(src => `<img src="${UI.esc(src)}" class="md-img" data-src="${UI.esc(src)}" loading="lazy">`).join('');
    const commentsHtml = (p.comments || []).map(cm =>
      `<div class="comment-item"><span class="cname">${UI.esc(commentName(cm))}</span>：${UI.esc(commentText(cm.text))}<span class="comment-del" data-time="${UI.esc(cm.time)}" data-key="${UI.esc(cm.key || '')}">✕</span></div>`
    ).join('');
    body.innerHTML = `
      <div class="moment-detail" data-mid="${UI.esc(p.id)}">
        <div class="md-head">
          <div class="avatar md-avatar">${avatar}</div>
          <div class="md-head-main">
            <div class="md-name">${UI.esc(info.name)}</div>
            <div class="md-time">${UI.fmtTime(p.time)}</div>
          </div>
        </div>
        ${p.text ? `<div class="md-text">${UI.esc(commentText(p.text)).replace(/\n/g, '<br>')}</div>` : ''}
        ${imgHtml ? `<div class="md-imgs">${imgHtml}</div>` : ''}
        <div class="md-actions">
          <button class="md-btn btn-comment">评论</button>
          <button class="md-btn btn-share">分享</button>
          <button class="md-btn btn-del">删除动态</button>
        </div>
        <div class="md-comments">${commentsHtml || '<div class="md-no-comment">还没有评论</div>'}</div>
      </div>`;
    body.querySelectorAll('.md-img').forEach(img => img.addEventListener('click', () => UI.lightbox(img.dataset.src)));
    const btnC = body.querySelector('.btn-comment');
    if (btnC) btnC.addEventListener('click', () => openCommentModal(p));
    const btnS = body.querySelector('.btn-share');
    if (btnS) btnS.addEventListener('click', () => openShareModal(p));
    const del = body.querySelector('.btn-del');
    if (del) {
      del.style.display = imgEnabled() ? '' : 'none'; // 生图开关关闭时隐藏删除（含动态删除）
      del.addEventListener('click', async () => {
        const ok = await UI.confirm('删除这条动态及其全部评论？', { okText: '删除' });
        if (!ok) return;
        try {
          await API.deleteMoment(p.id);
          UI.toast('已删除');
          backFromDetail();
        } catch (e) { UI.toast('删除失败：' + e.message); }
      });
    }
    body.querySelectorAll('.comment-del').forEach(el => {
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const ok = await UI.confirm('删除这条评论？', { okText: '删除' });
        if (!ok) return;
        try {
          await API.deleteComment(p.id, el.dataset.time, el.dataset.key);
          UI.toast('已删除');
          await load();
          const cur = posts.find(x => String(x.id) === String(p.id));
          if (cur) renderDetail(cur); else backFromDetail();
        } catch (e) { UI.toast('删除失败：' + e.message); }
      });
    });
  }
  async function openPostDetail(id) {
    try { await load(); } catch (e) {}
    const p = posts.find(x => String(x.id) === String(id));
    if (!p) { UI.toast('找不到这条动态（可能已删除）'); const h = App.consumeBack(); if (h) h(); else App.showTab('moments'); return; }
    App.showPage('page-moment-detail', () => renderDetail(p));
  }
  function backFromDetail() {
    const h = App.consumeBack();
    if (h) h(); else App.showTab('moments');
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
        character, characterName: shownName(c),
        recentChat: await recentChatOf(character),
        hint: '',
        asMe: true,
        meName: player ? (player.name || '我') : '我',
        meDesc: player ? [player.description, player.signature, player.mountedText, player.worldbook].filter(Boolean).join('\n') : '',
      });
      document.getElementById('moment-text').value = r.text ? (window.stripActions ? window.stripActions(r.text) : r.text) : '';
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
    // 评论角色数随机（最少～最多，默认 1～3；兼容旧的单值 autoCommentN 作为上限）
    const legacyMax = Math.min(8, Math.max(1, cfg.autoCommentN || 3));
    const minN = Math.max(0, cfg.autoCommentMin != null ? cfg.autoCommentMin : 1);
    const maxN = Math.min(8, Math.max(minN, cfg.autoCommentMax != null ? cfg.autoCommentMax : legacyMax));
    const n = minN + Math.floor(Math.random() * (maxN - minN + 1));
    const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    const rels = (player && Array.isArray(player.relations)) ? player.relations : [];
    // 关联角色优先（排除发布者自己 + 陌生人）
    const relCandidates = rels
      .map(r => r.key ? App.charByKey(r.key) : null)
      .filter(c => c && App.charKey(c) !== post.key && shownName(c).trim() !== String(post.character || '').trim() && !isStrangerTo(post.key, App.charKey(c)));
    const others = commentableChars(post);
    const pool = relCandidates.length ? relCandidates : others;
    if (!pool.length) return;
    const picked = pool.slice().sort(() => Math.random() - 0.5).slice(0, n);
    UI.toast('AI 正在让角色评论…');
    let okCount = 0;
    for (const c of picked) {
      try {
        const rel = rels.find(r => r.key === App.charKey(c));
        const r = await API.aiComment({ momentId: post.id, character: App.charKey(c), characterName: shownName(c), momentText: post.text || '', posterName: post.character || '', relation: rel ? (rel.relation || '') : '' });
        if (r && r.text) {
          const text = commentText(r.text); // 剥离可能的存储标记前缀 + 括号清洗
          await API.addComment({ momentId: post.id, character: App.charKey(c), characterName: shownName(c), text });
          okCount++;
          // 本地数据 + 局部渲染：一条一条带随机间隔弹出（仿聊天逐条）
          const cm = { character: shownName(c), text, time: new Date().toISOString(), key: App.charKey(c) };
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
    el.innerHTML = `<span class="cname">${UI.esc(commentName(cm))}</span>：${UI.esc(commentText(cm.text))}<span class="comment-del" data-time="${UI.esc(cm.time)}" data-key="${UI.esc(cm.key || '')}">✕</span>`;
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

  /* ---- 分享朋友圈到私信 ---- */
  let sharePayloadText = '';
  let sharePayloadCard = null;
  function openShareModal(post) {
    const mine = isMePost(post);
    const poster = posterInfo(post).name || '未知';
    const text = (mine ? '我发了条朋友圈：' : (poster + ' 发了条朋友圈：')) + (post.text || '（图片朋友圈）');
    const card = {
      type: 'moment',
      id: post.id,
      title: (post.text || '图片动态').slice(0, 60),
      source: (mine ? '我' : poster) + ' 的朋友圈',
      thumb: (Array.isArray(post.img) && post.img.length) ? post.img[0] : '',
    };
    shareToChat(text, card);
  }
  /** 通用分享：把一段文本分享给角色私信 / 群聊（朋友圈/公众号文章都走这里；card 用于渲染成可点击的转发卡片） */
  function shareToChat(text, card) {
    sharePayloadText = text || '';
    sharePayloadCard = card || null;
    const mask = document.getElementById('share-modal');
    if (!mask) return;
    const list = document.getElementById('share-char-list');
    list.innerHTML = sortedChars().map(c => {
      const avatar = UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
      return `<label class="share-char-item" data-key="${UI.esc(App.charKey(c))}">
        <span class="avatar sm">${avatar}</span>
        <span class="share-char-name">${UI.esc(shownName(c))}</span>
        <input type="checkbox" value="${UI.esc(App.charKey(c))}">
      </label>`;
    }).join('');
    list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', updateShareCount));
    // 群聊列表（异步填充）
    const glist = document.getElementById('share-group-list');
    glist.innerHTML = '<div class="share-char-item" style="color:#999">加载中…</div>';
    if (typeof API.listWeChatGroups === 'function') {
      API.listWeChatGroups().then(groups => {
        if (!groups || !groups.length) { glist.innerHTML = '<div class="share-char-item" style="color:#bbb">暂无群聊</div>'; return; }
        glist.innerHTML = groups.map(g => {
          const avatar = g.avatar ? `<img src="${UI.esc(g.avatar)}">` : '';
          return `<label class="share-char-item" data-group="${UI.esc(g.name)}">
            <span class="avatar sm">${avatar}</span>
            <span class="share-char-name">${UI.esc(g.displayName || g.name)}</span>
            <input type="checkbox" value="${UI.esc(g.name)}">
          </label>`;
        }).join('');
        glist.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', updateShareCount));
        updateShareCount();
      }).catch(() => { glist.innerHTML = '<div class="share-char-item" style="color:#bbb">暂无群聊</div>'; });
    } else {
      glist.innerHTML = '<div class="share-char-item" style="color:#bbb">暂无群聊</div>';
    }
    updateShareCount();
    document.getElementById('share-note').value = '';
    document.getElementById('share-tip').textContent = '';
    mask.style.display = 'flex';
  }
  function updateShareCount() {
    const n = document.querySelectorAll('#share-char-list input[type=checkbox]:checked').length +
              document.querySelectorAll('#share-group-list input[type=checkbox]:checked').length;
    const el = document.getElementById('share-count');
    if (el) el.textContent = n ? '已选 ' + n + ' 个' : '';
  }
  function closeShareModal() {
    const m = document.getElementById('share-modal');
    if (m) m.style.display = 'none';
  }
  /** 分享到私信 + 群聊（可多选）：后台发送不跳转，AI 在后台逐条回复；群聊发文本消息 */
  async function doShare() {
    if (!sharePayloadText) return;
    const charKeys = [...document.querySelectorAll('#share-char-list input[type=checkbox]:checked')].map(cb => cb.value);
    const groupNames = [...document.querySelectorAll('#share-group-list input[type=checkbox]:checked')].map(cb => cb.value);
    if (!charKeys.length && !groupNames.length) { document.getElementById('share-tip').textContent = '请至少勾选一个私信或群聊'; return; }
    const tip = document.getElementById('share-tip');
    tip.textContent = '正在分享给 ' + (charKeys.length + groupNames.length) + ' 个对象…';
    tip.className = 'modal-tip loading';
    closeShareModal();
    const note = document.getElementById('share-note').value.trim();
    // 附带的话随卡片一起存（渲染时显示在卡片上方，微信转发样式）
    const shareCard = sharePayloadCard ? Object.assign({}, sharePayloadCard, { note: note || '' }) : null;
    // 分享者身份：让 AI 明确是「当前玩家」转发的，避免把分享者误认成朋友圈发布者
    let meName = '我';
    try { const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null; if (p && p.name) meName = p.name; } catch (e) {}
    const shareText = (note ? note + '\n' : '') + '我（' + meName + '）分享给你看：\n' + sharePayloadText;
    let ok = 0, fail = 0;
    // 私信：后台发送（不切换页面），AI 后台必回
    for (const key of charKeys) {
      const c = App.charByKey(key);
      if (!c) { fail++; continue; }
      try {
        let s = Store.sessionsOf(App.charKey(c), c.name)[0];
        if (!s && typeof Chat.createSession === 'function') s = await Chat.createSession(c);
        if (!s) { fail++; continue; }
        if (typeof Chat.sendToCharBackground === 'function') {
          await Chat.sendToCharBackground(c, s, shareText, shareCard ? { card: shareCard } : undefined);
        } else {
          // 兜底：旧式前台发送
          await App.openCharacter(c);
          await sleep(400);
          await Chat.send(shareText, shareCard ? { card: shareCard } : undefined);
        }
        ok++;
      } catch (e) { fail++; }
    }
    // 群聊：写一条文本消息（触发群里 AI 随机接话）
    let pk = '__me__';
    try { const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null; if (p && p.id) pk = '__me__' + p.id; } catch (e) {}
    for (const gname of groupNames) {
      try {
        await API.saveWeChatMessage(gname, { name: meName, key: pk, text: shareText, card: shareCard || undefined });
        ok++;
        // 后台让群里 AI 自然接话（不阻塞、不跳转）
        if (typeof GroupChat !== 'undefined' && GroupChat.replyGroupBackground) {
          GroupChat.replyGroupBackground(gname);
        }
      } catch (e) { fail++; }
    }
    UI.toast('已分享给 ' + ok + ' 个对象' + (fail ? '，' + fail + ' 个失败' : ''));
  }

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
    const commentables = commentableChars(post);
    sel.innerHTML = charOptions(commentables.length ? commentables : sortedChars());
    document.getElementById('comment-text').value = '';
    document.getElementById('comment-tip').textContent = '';
    setCommentWho('char');
    if (commentables.length) sel.value = App.charKey(commentables[0]);
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
      characterName = shownName(c);
    }
    busy = true;
    const tip = document.getElementById('comment-tip');
    tip.textContent = '发送中…';
    tip.className = 'modal-tip loading';
    try {
      await API.addComment({ momentId: commentTarget.id, character, characterName, text: commentText(text) });
      closeCommentModal();
      await load();
      // 单条详情页可见时刷新详情，否则刷新列表
      const det = document.getElementById('page-moment-detail');
      if (det && det.style.display !== 'none' && detailPost) {
        const cur = posts.find(x => String(x.id) === String(detailPost.id));
        if (cur) renderDetail(cur); else backFromDetail();
      } else {
        render();
      }
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
      characterName = shownName(c);
    }
    busy = true;
    const tip = document.getElementById('comment-tip');
    tip.textContent = 'AI 正在以「' + characterName + '」的身份构思评论…';
    tip.className = 'modal-tip loading';
    try {
      let rel = null;
      try { const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null; if (p) rel = (p.relations || []).find(r => r.key === character) || null; } catch (e) {}
      let meDesc = '';
      try { const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null; if (p) meDesc = [p.description, p.signature, p.worldbook].filter(Boolean).join('\n'); } catch (e) {}
      const r = await API.aiComment({
        momentId: commentTarget.id, character, characterName, momentText: commentTarget.text,
        isMe: who === 'me', relation: who === 'me' ? '' : ((rel && rel.relation) || ''),
        meDesc: meDesc,
      });
      document.getElementById('comment-text').value = r.text ? commentText(r.text) : '';
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
    // 参考群聊下拉（异步填充）
    const gsel = document.getElementById('aim-group');
    if (gsel) {
      gsel.innerHTML = '<option value="">不参考群聊</option>';
      if (typeof API.listWeChatGroups === 'function') {
        API.listWeChatGroups().then(groups => {
          gsel.innerHTML = '<option value="">不参考群聊</option>' + (groups || []).map(g =>
            `<option value="${UI.esc(g.name)}">${UI.esc(g.displayName || g.name)}</option>`).join('');
        }).catch(() => {});
      }
    }
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
      // 参考群聊：读取最近消息，让角色根据群聊话题写朋友圈
      let groupChat = null, groupName = '';
      const gname = document.getElementById('aim-group').value;
      if (gname) {
        try {
          const g = await API.getWeChatGroup(gname);
          if (g && g.messages && g.messages.length) {
            groupName = g.displayName || g.name || gname;
            groupChat = g.messages.slice(-15).map(m => ({
              name: m.name || '', is_user: String(m.key || '').indexOf('__me__') === 0, text: m.text,
            }));
          }
        } catch (e) { /* 群读取失败则忽略 */ }
      }
      let meDesc = '';
      try { const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null; if (p) meDesc = [p.description, p.signature, p.worldbook].filter(Boolean).join('\n'); } catch (e) {}
      const r = await API.genAutoMoment({ character, characterName: shownName(c), recentChat, hint, imgTag, groupChat, groupName, meDesc });
      document.getElementById('aim-text').value = r.text ? (window.stripActions ? window.stripActions(r.text) : r.text) : '';
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
          await doPublish(character, shownName(c), r.text, img, document.getElementById('aim-preset').value, true, imgData);
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
      await doPublish(character, shownName(c), text, imagePrompt, preset, false, imgData);
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
    document.getElementById('share-cancel').addEventListener('click', closeShareModal);
    document.getElementById('share-ok').addEventListener('click', doShare);
    document.getElementById('share-all').addEventListener('click', () => {
      document.querySelectorAll('#share-char-list input[type=checkbox]').forEach(cb => cb.checked = true);
      updateShareCount();
    });
    document.getElementById('share-none').addEventListener('click', () => {
      document.querySelectorAll('#share-char-list input[type=checkbox]').forEach(cb => cb.checked = false);
      updateShareCount();
    });
    document.getElementById('share-modal').addEventListener('click', e => {
      if (e.target.id === 'share-modal') closeShareModal();
    });
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
    const detBack = document.getElementById('btn-moment-detail-back');
    if (detBack) detBack.addEventListener('click', backFromDetail);
  }

  return { render, load, init, openFor, openPostById, openPostDetail, shareToChat, recentChatOf, autoCommentMoment };
})();
