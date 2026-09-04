/* ============ 公众号：AI 按世界观写推文、列表/阅读/分享到私信 ============ */
const Articles = (() => {
  let articles = [];
  let current = null; // 阅读页当前文章

  async function load() {
    const data = await API.getArticles();
    articles = (data && data.articles) || [];
    return articles;
  }

  function sortedChars() {
    return App.state.characters.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
  }
  function charOptions(chars) {
    return (chars || []).map(c => `<option value="${UI.esc(App.charKey(c))}">${UI.esc(App.displayName(c))}</option>`).join('');
  }
  function imgEnabled() {
    const cfg = App.state.config || {};
    return cfg.imageEnabled !== false;
  }
  function posterInfo(a) {
    // 公众号由 AI 拟名称 + 默认图标（不用角色头像，避免把公众号当角色）
    return { name: (a && a.author) || (a && a.character) || '公众号', avatar: '' };
  }
  async function recentChatOf(characterKey) {
    const c = App.charByKey(characterKey);
    if (!c) return '';
    const sessions = Store.sessionsOf(App.charKey(c), c.name);
    if (!sessions.length) return '';
    const file = sessions[0].file;
    const chat = await API.getChat(c.avatar_file || c.avatar, file);
    return (Array.isArray(chat) ? chat : []).slice(-8).map(m => (m.is_user ? '我：' : (m.name ? m.name + '：' : '')) + (m.mes || '')).join('\n');
  }

  /* ---- 列表 ---- */
  function render() {
    const body = document.getElementById('articles-body');
    if (!articles.length) {
      body.innerHTML = `<div class="empty"><div class="big">📰</div>还没有公众号推文<br><br>点击右上角 🤖 让 AI 写一篇吧</div>`;
      return;
    }
    body.innerHTML = articles.map((a, idx) => {
      const info = posterInfo(a);
      // 封面图：有封面显示图片缩略图，无封面显示默认 📰 图标
      const coverHtml = a.cover
        ? `<div class="article-avatar" style="overflow:hidden"><img src="${UI.esc(a.cover)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px" onerror="this.outerHTML='<span class=article-avatar-icon>📰</span>'"></div>`
        : `<span class="article-avatar-icon">📰</span>`;
      const summary = String(a.body || '').replace(/\s+/g, ' ').slice(0, 56);
      const delBtn = imgEnabled() ? `<span class="article-del" data-idx="${idx}" title="删除">✕</span>` : '';
      return `
      <div class="article-card" data-idx="${idx}">
        <div class="article-avatar">${coverHtml}</div>
        <div class="article-main">
          <div class="article-title">${UI.esc(a.title)}</div>
          <div class="article-summary">${UI.esc(summary)}${a.body && a.body.length > 56 ? '…' : ''}</div>
          <div class="article-meta"><span class="article-name">${UI.esc(info.name)}</span><span class="article-time">${UI.fmtTime(a.time)}</span></div>
        </div>
        ${delBtn}
      </div>`;
    }).join('');

    body.querySelectorAll('.article-card').forEach(card => {
      card.addEventListener('click', () => openRead(articles[Number(card.dataset.idx)]));
    });
    body.querySelectorAll('.article-del').forEach(el => {
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const a = articles[Number(el.dataset.idx)];
        if (!a) return;
        const ok = await UI.confirm('删除这篇推文？', { okText: '删除' });
        if (!ok) return;
        try {
          await API.deleteArticle(a.id);
          UI.toast('已删除');
          await load(); render();
        } catch (e) { UI.toast('删除失败：' + e.message); }
      });
    });
  }

  /* ---- 生成弹层 ---- */
  let artCover = ''; // 当前草稿封面（base64 data URL）
  function openArticleModal() {
    artCover = '';
    document.getElementById('art-hint').value = '';
    document.getElementById('art-author').value = '';
    document.getElementById('art-title').value = '';
    document.getElementById('art-body').value = '';
    document.getElementById('art-tip').textContent = '';
    const pv = document.getElementById('art-cover-preview');
    if (pv) pv.style.display = 'none';
    const cl = document.getElementById('art-cover-clear');
    if (cl) cl.style.display = 'none';
    const st = document.getElementById('art-cover-state');
    if (st) st.textContent = '';
    document.getElementById('article-modal').style.display = 'flex';
  }
  function closeArticleModal() {
    document.getElementById('article-modal').style.display = 'none';
  }
  /** AI 生成封面：先让 AI 按主题写英文封面提示词，再走生图（智绘姬/自填 NovelAI） */
  async function genCover() {
    const tip = document.getElementById('art-tip');
    const title = document.getElementById('art-title').value.trim();
    const body = document.getElementById('art-body').value.trim();
    const hint = document.getElementById('art-hint').value.trim();
    if (!title && !body && !hint) { tip.textContent = '先填主题/标题，再生成封面'; return; }
    const cfg = App.state.config || {};
    if (cfg.imageEnabled === false) { tip.textContent = '生图已关闭，可在设置里开启'; return; }
    tip.textContent = 'AI 正在构思封面提示词…';
    tip.className = 'modal-tip loading';
    try {
      const r = await API.genChat([{
        role: 'system', content: '你是公众号封面配图提示词设计师。根据给定的主题/标题，输出一条英文生图提示词（40词以内，描述一张杂志封面风格的图片；只要提示词本身，不要引号、不要解释）。',
      }, { role: 'user', content: '主题：' + (hint || title) }], { temperature: 0.8, max_tokens: 80 });
      const prompt = String((r && r.content) || '').trim().replace(/["“”']/g, '');
      if (!prompt) { tip.textContent = '生成提示词失败'; tip.className = 'modal-tip'; return; }
      tip.textContent = '正在生图（约 20~60 秒）…';
      // 默认走直连（与朋友圈 AI 发圈同款）；直连失败会自动回退酒馆代理（已兼容 NAI 4.5）
      const img = await API.genImage(prompt, { force: true });
      const url = (img && (img.url || img.image)) || '';
      if (!url) throw new Error('生图无返回');
      artCover = url;
      const pv = document.getElementById('art-cover-preview'), im = document.getElementById('art-cover-img');
      if (pv && im) { im.src = url; pv.style.display = 'block'; }
      const cl = document.getElementById('art-cover-clear');
      if (cl) cl.style.display = '';
      const st = document.getElementById('art-cover-state');
      if (st) st.textContent = '封面已生成';
      tip.textContent = '封面已生成';
      tip.className = 'modal-tip';
    } catch (e) { tip.textContent = '封面生成失败：' + e.message; tip.className = 'modal-tip'; }
  }
  async function genDraft() {
    const tip = document.getElementById('art-tip');
    const hint = document.getElementById('art-hint').value.trim();
    if (!hint) { tip.textContent = '先填一个主题/灵感，比如「新宿甜品店探店攻略」'; return; }
    tip.textContent = 'AI 正在写公众号推文…';
    tip.className = 'modal-tip loading';
    const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    try {
      const r = await API.genArticle({
        hint: hint,
        meDesc: player ? [player.description, player.signature, player.mountedText, player.worldbook].filter(Boolean).join('\n') : '',
      });
      document.getElementById('art-author').value = r.author || '';
      document.getElementById('art-title').value = r.title || '';
      document.getElementById('art-body').value = r.body || '';
      tip.textContent = '草稿已生成，可修改后发布';
      tip.className = 'modal-tip';
    } catch (e) {
      tip.textContent = '生成失败：' + e.message;
      tip.className = 'modal-tip';
    }
  }
  async function publish() {
    const author = document.getElementById('art-author').value.trim();
    const title = document.getElementById('art-title').value.trim();
    const body = document.getElementById('art-body').value.trim();
    if (!title || !body) { document.getElementById('art-tip').textContent = '标题和正文不能为空'; return; }
    const tip = document.getElementById('art-tip');
    tip.textContent = '发布中…';
    tip.className = 'modal-tip loading';
    try {
      await API.publishArticle({ author, title, body, cover: artCover });
      tip.textContent = '发布成功';
      tip.className = 'modal-tip';
      closeArticleModal();
      UI.toast('已发布');
      await load(); render();
    } catch (e) {
      tip.textContent = '发布失败：' + e.message;
      tip.className = 'modal-tip';
    }
  }

  /* ---- 阅读页 ---- */
  function openRead(a) {
    current = a;
    const body = document.getElementById('article-read-body');
    const info = posterInfo(a);
    const avatar = UI.avatarSrc(info.avatar) ? `<img src="${UI.esc(UI.avatarSrc(info.avatar))}">` : '';
    const bodyHtml = String(a.body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    body.innerHTML = `
      <div class="article-read">
        <div class="article-read-head">
          <div class="article-read-avatar"><span class="article-avatar-icon">📰</span></div>
          <div class="article-read-info">
            <div class="article-read-name">${UI.esc(info.name)}</div>
            <div class="article-read-time">${UI.fmtTime(a.time)}</div>
          </div>
        </div>
        ${a.cover ? `<img class="article-read-cover" src="${UI.esc(a.cover)}" onerror="this.style.display='none'">` : ''}
        <h1 class="article-read-title">${UI.esc(a.title)}</h1>
        <div class="article-read-content">${bodyHtml}</div>
      </div>`;
    document.getElementById('article-read-title').textContent = '推文';
    App.showPage('page-article-read');
    const delBtn = document.getElementById('btn-article-del');
    if (delBtn) delBtn.style.display = imgEnabled() ? '' : 'none';
  }
  function backFromRead() {
    const h = App.consumeBack();
    if (h) h(); else App.showTab('articles');
  }

  /* ---- 分享文章到私信（转发卡片，AI 能读到公众号与内容） ---- */
  function openShareArticle() {
    if (!current) return;
    const text = '公众号「' + (current.author || '') + '」推送了一篇《' + (current.title || '') + '》：\n' + (current.body || '');
    const card = {
      type: 'article',
      id: current.id,
      title: current.title || '',
      source: (current.author || '公众号') + ' · 公众号',
      thumb: (current && current.cover) || '',
    };
    Moments.shareToChat(text, card);
  }

  /** 从聊天卡片跳回：按 id 打开公众号阅读页 */
  async function openReadById(id) {
    try { await load(); } catch (e) {}
    const a = articles.find(x => x.id === id);
    if (!a) { UI.toast('找不到这篇推文（可能已删除）'); return; }
    openRead(a);
  }

  function init() {
    document.getElementById('btn-article-add').addEventListener('click', openArticleModal);
    document.getElementById('art-cancel').addEventListener('click', closeArticleModal);
    document.getElementById('art-gen').addEventListener('click', genDraft);
    document.getElementById('art-publish').addEventListener('click', publish);
    const cg = document.getElementById('art-cover-gen');
    if (cg) cg.addEventListener('click', genCover);
    const cc = document.getElementById('art-cover-clear');
    if (cc) cc.addEventListener('click', () => {
      artCover = '';
      const pv = document.getElementById('art-cover-preview');
      if (pv) pv.style.display = 'none';
      cc.style.display = 'none';
      const st = document.getElementById('art-cover-state');
      if (st) st.textContent = '';
    });
    document.getElementById('article-modal').addEventListener('click', e => {
      if (e.target.id === 'article-modal') closeArticleModal();
    });
    document.getElementById('btn-article-back').addEventListener('click', backFromRead);
    document.getElementById('btn-article-share').addEventListener('click', openShareArticle);
    document.getElementById('btn-article-del').addEventListener('click', async () => {
      if (!current) return;
      const ok = await UI.confirm('删除这篇推文？', { okText: '删除' });
      if (!ok) return;
      try {
        await API.deleteArticle(current.id);
        UI.toast('已删除');
        await load();
        backFromRead();
      } catch (e) { UI.toast('删除失败：' + e.message); }
    });
  }

  return { load, render, init, openReadById };
})();
