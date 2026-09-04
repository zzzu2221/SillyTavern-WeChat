/* ============ 「我」页 + Player 账号管理 ============ */
/* Player 账号存在酒馆扩展设置里（settings.players / activePlayerId），多台电脑同步 */
const Me = (() => {
  const RELATIONS = ['情侣', '恋人', '伴侣', '好友', '兄弟', '姐妹', '家人', '死对头', '师生', '同事', '室友', '其他'];
  let personaCache = null;

  function players() {
    const s = API.getSettings() || {};
    let list = Array.isArray(s.players) ? s.players : null;
    if (!list) {
      list = [{ id: 'me', name: '我', signature: '', avatar: '', cover: '', relations: [], worldbook: '' }];
      API.saveAppSettings({ players: list, activePlayerId: 'me' });
    }
    return list;
  }
  function savePlayers(list, activeId) {
    const patch = { players: list };
    if (activeId) patch.activePlayerId = activeId;
    API.saveAppSettings(patch);
    if (App.state.config) {
      App.state.config.players = list;
      if (activeId) App.state.config.activePlayerId = activeId;
    }
  }
  function activePlayer() {
    const list = players();
    const s = API.getSettings() || {};
    return list.find(p => p.id === s.activePlayerId) || list[0] || { name: '我', signature: '', avatar: '', relations: [], worldbook: '' };
  }
  function newId() { return 'p' + Date.now().toString(36); }

  /* ---- 工具 ---- */
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsDataURL(file);
    });
  }
  async function loadPersonas() {
    if (!personaCache) {
      try { personaCache = await API.listPersonas(); } catch (e) { personaCache = []; }
    }
    return personaCache || [];
  }
  /** 头像选择器（默认 + 用户设定 + 角色卡 + 上传），返回当前选中 data URL；onUpload 可选 */
  async function buildAvatarPicker(box, current, onUpload) {
    box.innerHTML = '<div class="pa-loading">加载头像…</div>';
    const personas = await loadPersonas();
    const opts = [{ label: '默认', av: '' }];
    personas.forEach(p => opts.push({ label: '用户设定·' + (p.name || '未命名'), av: p.avatar, group: '用户设定' }));
    (App.state.allCharacters || []).forEach(c => opts.push({ label: App.displayName(c), av: c.avatar }));
    box.innerHTML = '';
    let picked = current;
    opts.forEach(o => {
      if (!o.av) return;
      const el = document.createElement('div');
      el.className = 'profile-avatar-opt' + (picked === o.av ? ' active' : '');
      const src = UI.avatarSrc(o.av);
      el.innerHTML = src ? `<img src="${UI.esc(src)}">` : '<span class="pa-default">👤</span>';
      el.title = o.label;
      el.dataset.av = o.av;
      el.addEventListener('click', () => {
        box.querySelectorAll('.profile-avatar-opt').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        picked = o.av;
      });
      box.appendChild(el);
    });
    // 若当前是上传图（data:）也展示
    if (current && current.startsWith('data:')) {
      const el = document.createElement('div');
      el.className = 'profile-avatar-opt active';
      el.innerHTML = `<img src="${UI.esc(current)}">`;
      el.title = '当前上传的头像';
      el.dataset.av = current;
      box.appendChild(el);
    }
    if (onUpload) {
      const up = document.createElement('div');
      up.className = 'profile-avatar-opt';
      up.innerHTML = '<span class="pa-default" style="font-size:22px">＋</span>';
      up.title = '本地上传';
      up.addEventListener('click', async () => {
        try {
          const av = await onUpload();
          if (!av) return;
          box.querySelectorAll('.profile-avatar-opt').forEach(x => x.classList.remove('active'));
          const el = document.createElement('div');
          el.className = 'profile-avatar-opt active';
          el.innerHTML = `<img src="${UI.esc(av)}">`;
          el.dataset.av = av;
          box.appendChild(el);
          picked = av;
          UI.toast('已选上传头像');
        } catch (e) { UI.toast(e.message); }
      });
      box.appendChild(up);
    }
    return { get: () => picked };
  }

  /* ---------- 我页 ---------- */
  function render() {
    const body = document.getElementById('me-body');
    const p = activePlayer();
    const list = players();
    const avatar = p.avatar && UI.avatarSrc(p.avatar) ? `<img src="${UI.esc(UI.avatarSrc(p.avatar))}">` : '';
    const cfg = App.state.config || {};
    body.innerHTML = `
      <div class="me-profile" id="me-profile">
        <div class="avatar me-avatar">${avatar}</div>
        <div class="me-profile-info">
          <div class="me-name">${UI.esc(p.name || '我')}</div>
          <div class="me-id">微信号：${UI.esc(p.id || '')}</div>
          <div class="me-sig">${UI.esc(p.signature || '暂未设置签名')}</div>
        </div>
        <div class="me-chevron">›</div>
      </div>
      <div class="me-menu">
        <div class="me-menu-item" id="me-menu-moments"><span class="me-menu-icon">🌐</span><span>朋友圈</span><span class="me-chevron">›</span></div>
        <div class="me-menu-item" id="me-menu-account"><span class="me-menu-icon">👤</span><span>账号管理（切换 / 关系 / 世界书）</span><span class="me-chevron">›</span></div>
        <div class="me-menu-item" id="me-menu-settings"><span class="me-menu-icon">⚙️</span><span>微信设置（生图 / 聊天 / 悬浮窗）</span><span class="me-chevron">›</span></div>
      </div>
      <div class="me-card">
        <div class="me-row"><span class="k">酒馆地址</span><span class="v">${UI.esc(cfg.stUrl || '未连接')}</span></div>
        <div class="me-row"><span class="k">通讯录</span><span class="v">${App.state.characters.length} 个角色</span></div>
        <div class="me-row"><span class="k">当前账号</span><span class="v">${UI.esc(p.name)}（关联 ${(p.relations || []).length} 个角色）</span></div>
      </div>
      <button class="me-btn" id="me-refresh">刷新数据</button>
    `;
    document.getElementById('me-profile').addEventListener('click', () => openProfileModal());
    document.getElementById('me-menu-moments').addEventListener('click', () => App.showTab('moments'));
    document.getElementById('me-menu-account').addEventListener('click', () => App.showPage('page-account', renderAccount));
    document.getElementById('me-menu-settings').addEventListener('click', () => {
      try { API.openSettings(); } catch (e) { UI.toast(e.message); }
    });
    document.getElementById('me-refresh').addEventListener('click', async () => {
      UI.toast('刷新中…');
      try {
        await App.loadConfig();
        await App.refreshCharacters();
        UI.toast('已刷新');
        render();
      } catch (e) { UI.toast('刷新失败：' + e.message); }
    });
  }

  /* ---------- 个人信息编辑 ---------- */
  function openProfileModal() {
    const p = activePlayer();
    const modal = document.getElementById('profile-modal');
    document.getElementById('profile-modal-title').textContent = '个人信息';
    document.getElementById('profile-name').value = p.name || '';
    document.getElementById('profile-id').value = p.id || '';
    document.getElementById('profile-sig').value = p.signature || '';
    document.getElementById('profile-desc').value = p.description || p.worldbook || '';
    document.getElementById('profile-cover').value = p.cover || '';
    document.getElementById('profile-tip').textContent = '';
    const coverPrev = document.getElementById('profile-cover-preview');
    if (p.cover && p.cover.startsWith('data:')) { coverPrev.src = p.cover; coverPrev.style.display = 'block'; }
    else coverPrev.style.display = 'none';
    // 头像选择：默认 + 用户设定 + 角色卡 + 上传
    const pick = document.getElementById('profile-avatar-pick');
    const fileInp = document.getElementById('profile-avatar-file');
    let picker = { get: () => p.avatar };
    buildAvatarPicker(pick, p.avatar, () => fileInp.click() && null).then(x => { picker = x; });
    document.getElementById('profile-avatar-upload-btn').addEventListener('click', () => fileInp.click());
    fileInp.onchange = async () => {
      const f = fileInp.files && fileInp.files[0];
      if (!f) return;
      const av = await readFileAsDataURL(f);
      // 重新渲染选择器并把上传图置为选中
      buildAvatarPicker(pick, av, () => fileInp.click()).then(x => { picker = x; });
      fileInp.value = '';
      UI.toast('已选择头像，点保存生效');
    };
    document.getElementById('profile-cover-upload-btn').addEventListener('click', () => document.getElementById('profile-cover-file').click());
    document.getElementById('profile-cover-file').onchange = async () => {
      const f = document.getElementById('profile-cover-file').files && document.getElementById('profile-cover-file').files[0];
      if (!f) return;
      const data = await readFileAsDataURL(f);
      document.getElementById('profile-cover').value = data;
      coverPrev.src = data; coverPrev.style.display = 'block';
      document.getElementById('profile-cover-file').value = '';
    };
    modal.style.display = 'flex';
    document.getElementById('profile-cancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.getElementById('profile-save').onclick = () => {
      const name = document.getElementById('profile-name').value.trim() || '我';
      const id = document.getElementById('profile-id').value.trim() || newId();
      const sig = document.getElementById('profile-sig').value.trim();
      const desc = document.getElementById('profile-desc').value.trim();
      const cover = document.getElementById('profile-cover').value.trim();
      const avatar = picker.get();
      const list = players().map(x => x.id === p.id ? Object.assign({}, x, { name, id, signature: sig, description: desc, avatar, cover }) : x);
      savePlayers(list, p.id);
      modal.style.display = 'none';
      UI.toast('已保存');
      render();
    };
  }

  /* ---------- 账号管理页 ---------- */
  function renderAccount() {
    const body = document.getElementById('account-body');
    const list = players();
    const cur = activePlayer();
    if (!list.length) { body.innerHTML = '<div class="empty"><div class="big">👤</div>还没有账号</div>'; return; }
    body.innerHTML = `
      <div class="acct-import">
        <select id="acct-import-sel"><option value="">从酒馆「用户设定」导入…</option></select>
        <button class="friend-btn friend-ok" id="acct-import-btn" type="button">导入为新账号</button>
      </div>
      <div class="acct-list">${list.map(p => `
      <div class="acct-item${p.id === cur.id ? ' active' : ''}" data-id="${UI.esc(p.id)}">
        <div class="avatar">${p.avatar && UI.avatarSrc(p.avatar) ? `<img src="${UI.esc(UI.avatarSrc(p.avatar))}">` : '<span class="pa-default">👤</span>'}</div>
        <div class="acct-info">
          <div class="acct-name">${UI.esc(p.name)}${p.id === cur.id ? ' <span class="acct-cur">当前</span>' : ''}</div>
          <div class="acct-sub">关联 ${(p.relations || []).length} 个角色${p.worldbook ? ' · 有世界书' : ''}</div>
        </div>
        <div class="acct-actions">
          ${p.id !== cur.id ? `<button class="friend-btn friend-ok acct-use" data-id="${UI.esc(p.id)}" type="button">切换</button>` : ''}
          <button class="friend-btn acct-edit" data-id="${UI.esc(p.id)}" type="button">编辑</button>
          ${list.length > 1 ? `<button class="friend-btn friend-rm acct-del" data-id="${UI.esc(p.id)}" type="button">删</button>` : ''}
        </div>
      </div>`).join('')}</div>`;
    // 从酒馆用户设定导入
    const sel = document.getElementById('acct-import-sel');
    loadPersonas().then(personas => {
      if (!personas.length) return;
      sel.innerHTML = '<option value="">从酒馆「用户设定」导入…</option>' + personas.map(p =>
        `<option value="${UI.esc(p.id)}" data-name="${UI.esc(p.name)}" data-avatar="${UI.esc(p.avatar)}" data-desc="${UI.esc(p.description)}">${UI.esc(p.name)}</option>`
      ).join('');
    });
    document.getElementById('acct-import-btn').addEventListener('click', async () => {
      const o = sel.selectedOptions[0];
      if (!o || !o.value) { UI.toast('请先选择要导入的用户设定'); return; }
      const np = {
        id: newId(), name: o.dataset.name || '我', signature: '', description: o.dataset.desc || '', avatar: o.dataset.avatar || '',
        cover: '', relations: [], worldbook: o.dataset.desc || '',
      };
      const nl = players(); nl.push(np);
      savePlayers(nl, np.id);
      UI.toast('已导入并切换为当前账号');
      renderAccount();
    });
    body.querySelectorAll('.acct-use').forEach(b => {
      b.addEventListener('click', async () => {
        savePlayers(players(), b.dataset.id);
        UI.toast('已切换账号');
        renderAccount();
      });
    });
    body.querySelectorAll('.acct-edit').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); openAccountModal(b.dataset.id); });
    });
    body.querySelectorAll('.acct-del').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await UI.confirm('删除该账号？', { okText: '删除' });
        if (!ok) return;
        const id = b.dataset.id;
        const rest = players().filter(x => x.id !== id);
        savePlayers(rest.length ? rest : [{ id: 'me', name: '我', signature: '', avatar: '', cover: '', relations: [], worldbook: '' }], rest.length ? (rest[0].id) : 'me');
        UI.toast('已删除');
        renderAccount();
      });
    });
    // ＋ 新建
    document.getElementById('btn-account-add').onclick = () => openAccountModal(null);
    document.getElementById('btn-account-back').onclick = () => App.showTab('me');
  }

  /* ================= 世界书挂载（多选 + 条目勾选，存 wbSel） ================= */
  /* 编辑中的挂载状态：{ [fileId]: { name, uids: ['*'] | [uid...] } }；* = 全部启用 */
  let acctWbSel = {};

  function renderWbMounted() {
    const box = document.getElementById('acct-wb-mounted');
    if (!box) return;
    const clear = document.getElementById('acct-wb-clear');
    const keys = Object.keys(acctWbSel);
    if (!keys.length) {
      box.innerHTML = '<div class="wb-mounted-empty">未挂载世界书（点「＋ 挂载世界书」从酒馆导入选择）</div>';
      if (clear) clear.style.display = 'none';
      return;
    }
    box.innerHTML = keys.map(fid => {
      const s = acctWbSel[fid] || {};
      const uids = s.uids || ['*'];
      const cnt = (uids.length === 1 && uids[0] === '*') ? '全部条目' : (uids.length + ' 条');
      return `<div class="wb-mounted-item" data-fid="${UI.esc(fid)}">
        <div class="wb-mounted-name" title="${UI.esc(s.name || fid)}">${UI.esc(s.name || fid)}</div>
        <div class="wb-mounted-ops">
          <span class="wb-mounted-count">${cnt}</span>
          <button type="button" class="btn-plain wb-mini" data-act="entries">条目</button>
          <button type="button" class="btn-plain wb-mini" data-act="remove">移除</button>
        </div>
      </div>`;
    }).join('');
    if (clear) clear.style.display = 'inline-block';
  }

  /** 挂载弹层：多选世界书 */
  async function openWbPick() {
    const modal = document.getElementById('wb-pick-modal');
    const list = document.getElementById('wb-pick-list');
    list.innerHTML = '<div class="pa-loading">读取世界书…</div>';
    modal.style.display = 'flex';
    let infos = [];
    try { infos = await API.listWorldInfos(); } catch (e) { list.innerHTML = '<div class="empty small">读取失败：' + UI.esc(e.message) + '</div>'; return; }
    if (!infos.length) { list.innerHTML = '<div class="empty small">尚未导入世界书，请先在酒馆「世界观」里创建</div>'; return; }
    list.innerHTML = infos.map((w, i) => {
      const on = !!acctWbSel[w.id];
      return `<label class="wb-pick-item">
        <input type="checkbox" data-i="${i}"${on ? ' checked' : ''}>
        <span>${UI.esc(w.name)}${on ? '（已挂载）' : ''}</span>
      </label>`;
    }).join('');
    document.getElementById('wb-pick-cancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.getElementById('wb-pick-ok').onclick = () => {
      const chosen = [];
      list.querySelectorAll('input[type="checkbox"]').forEach(cb => { if (cb.checked) chosen.push(infos[Number(cb.dataset.i)]); });
      const keep = {};
      chosen.forEach(w => { keep[w.id] = acctWbSel[w.id] || { name: w.name, uids: ['*'] }; });
      acctWbSel = keep;
      modal.style.display = 'none';
      renderWbMounted();
      UI.toast('已挂载 ' + chosen.length + ' 个世界书');
    };
  }

  /** 世界书条目勾选弹层：勾选启用条目（持久化到 acctWbSel[fileId].uids） */
  function entryUid(en) { return (en && en.uid != null) ? en.uid : (en && en.id != null ? en.id : null); }
  async function openWbEntries(fileId) {
    if (!fileId) { UI.toast('请先选择世界书'); return; }
    const modal = document.getElementById('wb-entries-modal');
    const list = document.getElementById('wb-entries-list');
    const s = acctWbSel[fileId] || {};
    const selUids = s.uids || ['*'];
    document.getElementById('wb-entries-name').textContent = '（' + (s.name || '') + '）';
    list.innerHTML = '<div class="pa-loading">加载世界书条目…</div>';
    modal.style.display = 'flex';
    let entries = [];
    try { entries = await API.getWorldInfoEntries(fileId); } catch (e) { list.innerHTML = '<div class="empty small">加载失败：' + UI.esc(e.message) + '</div>'; return; }
    if (!entries.length) { list.innerHTML = '<div class="empty small">这个世界书没有条目</div>'; return; }
    list.innerHTML = entries.map((en, i) => {
      const checked = (selUids.length === 1 && selUids[0] === '*') ? en.enabled : selUids.includes(entryUid(en));
      return `<label class="wb-entry">
        <input type="checkbox" data-i="${i}"${checked ? ' checked' : ''}>
        <div class="wb-entry-body">
          <div class="wb-entry-comment">${UI.esc(en.comment || '(无注释)')}</div>
          <div class="wb-entry-preview">${UI.esc(en.content.slice(0, 80))}${en.content.length > 80 ? '…' : ''}</div>
        </div>
      </label>`;
    }).join('');
    document.getElementById('wb-entries-cancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.getElementById('wb-entries-ok').onclick = () => {
      const uids = [];
      list.querySelectorAll('.wb-entry input[type="checkbox"]').forEach(cb => {
        if (cb.checked) { const en = entries[Number(cb.dataset.i)]; const uid = entryUid(en); if (uid != null) uids.push(uid); }
      });
      if (acctWbSel[fileId]) acctWbSel[fileId].uids = uids;
      modal.style.display = 'none';
      renderWbMounted();
      UI.toast('已勾选 ' + uids.length + ' 条条目');
    };
  }

  /** 根据挂载选择拼接世界书正文 */
  async function buildWorldbookText(sel) {
    const parts = [];
    for (const fid of Object.keys(sel || {})) {
      const s = sel[fid] || {};
      const uids = s.uids || ['*'];
      let entries = [];
      try { entries = await API.getWorldInfoEntries(fid); } catch (e) { continue; }
      let chosen = entries;
      if (!(uids.length === 1 && uids[0] === '*')) chosen = entries.filter(en => uids.includes(entryUid(en)));
      chosen.forEach(en => { if (en.content) parts.push(en.content); });
    }
    return parts.join('\n');
  }

  /* ---------- 账号编辑（头像 / 封面 / 关系 / 世界书） ---------- */
  function openAccountModal(id) {
    const list = players();
    const isNew = !id;
    const p = isNew ? { id: newId(), name: '', signature: '', avatar: '', cover: '', relations: [], worldbook: '' } : list.find(x => x.id === id);
    const modal = document.getElementById('account-modal');
    document.getElementById('account-modal-title').textContent = isNew ? '新建账号' : '编辑账号';
    document.getElementById('acct-name').value = p.name || '';
    document.getElementById('acct-sig').value = p.signature || '';
    document.getElementById('acct-desc').value = p.description || p.worldbook || '';
    document.getElementById('acct-wb').value = p.worldbook || '';
    document.getElementById('acct-tip').textContent = '';
    const coverPrev = document.getElementById('acct-cover-preview');
    if (p.cover && p.cover.startsWith('data:')) { coverPrev.src = p.cover; coverPrev.style.display = 'block'; }
    else coverPrev.style.display = 'none';
    // 头像
    const avPick = document.getElementById('acct-avatar-pick');
    const avFile = document.getElementById('acct-avatar-file');
    let acctPicker = { get: () => p.avatar };
    buildAvatarPicker(avPick, p.avatar, () => avFile.click() && null).then(x => { acctPicker = x; });
    document.getElementById('acct-avatar-upload-btn').addEventListener('click', () => avFile.click());
    avFile.onchange = async () => {
      const f = avFile.files && avFile.files[0];
      if (!f) return;
      const av = await readFileAsDataURL(f);
      buildAvatarPicker(avPick, av, () => avFile.click()).then(x => { acctPicker = x; });
      avFile.value = '';
      UI.toast('已选择头像，点保存生效');
    };
    // 封面
    document.getElementById('acct-cover-upload-btn').addEventListener('click', () => document.getElementById('acct-cover-file').click());
    document.getElementById('acct-cover-file').onchange = async () => {
      const f = document.getElementById('acct-cover-file').files && document.getElementById('acct-cover-file').files[0];
      if (!f) return;
      const data = await readFileAsDataURL(f);
      coverPrev.src = data; coverPrev.style.display = 'block';
      document.getElementById('acct-cover-file').dataset.value = data;
      document.getElementById('acct-cover-file').value = '';
      UI.toast('已选择封面');
    };
    // 世界书挂载（多选）：恢复已挂载状态并渲染列表
    acctWbSel = Object.assign({}, p.wbSel || {});
    renderWbMounted();
    document.getElementById('acct-wb-add').onclick = openWbPick;
    const wbMountedBox = document.getElementById('acct-wb-mounted');
    wbMountedBox.onclick = (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const item = btn.closest('.wb-mounted-item');
      const fid = item && item.dataset.fid;
      if (!fid) return;
      if (btn.dataset.act === 'entries') openWbEntries(fid);
      else if (btn.dataset.act === 'remove') { delete acctWbSel[fid]; renderWbMounted(); }
    };
    document.getElementById('acct-wb-clear').onclick = () => { acctWbSel = {}; renderWbMounted(); };
    renderRelations(p);
    modal.style.display = 'flex';
    document.getElementById('acct-cancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.getElementById('acct-save').onclick = async () => {
      const name = document.getElementById('acct-name').value.trim() || '未命名';
      const signature = document.getElementById('acct-sig').value.trim();
      const description = document.getElementById('acct-desc').value.trim();
      const manualWb = document.getElementById('acct-wb').value.trim();
      const wbSel = acctWbSel;
      const mountedText = await buildWorldbookText(wbSel);
      const worldbook = [mountedText, manualWb].filter(Boolean).join('\n');
      const relations = collectRelations();
      const avatar = acctPicker.get();
      const coverData = document.getElementById('acct-cover-file').dataset.value;
      const cover = coverData || p.cover || '';
      const merged = { name, signature, description, worldbook, wbSel, relations, avatar, cover };
      if (isNew) {
        list.push(Object.assign({}, p, merged));
        savePlayers(list, p.id);
      } else {
        savePlayers(list.map(x => x.id === p.id ? Object.assign({}, x, merged) : x), p.id);
      }
      modal.style.display = 'none';
      UI.toast('已保存');
      renderAccount();
    };

    function renderRelations(player) {
      const box = document.getElementById('acct-relations');
      const rels = player.relations || [];
      box.innerHTML = '';
      if (rels.length) {
        const list = document.createElement('div');
        list.className = 'acct-rel-list';
        rels.forEach((r, i) => list.appendChild(relRow(r, i, player, box)));
        box.appendChild(list);
      } else {
        const empty = document.createElement('div');
        empty.className = 'acct-rel-empty';
        empty.textContent = '还没有关联角色';
        box.appendChild(empty);
      }
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'friend-btn friend-ok acct-add-rel';
      addBtn.textContent = '＋ 添加关联角色';
      addBtn.addEventListener('click', () => openRolePick(player));
      box.appendChild(addBtn);
    }
    function relRow(r, i, player, box) {
      const chars = App.state.allCharacters || [];
      const wrap = document.createElement('div');
      wrap.className = 'acct-rel';
      wrap.dataset.key = r.key || '';
      const c = r.key ? App.charByKey(r.key) : null;
      const avatar = c && UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
      wrap.innerHTML = `
        <div class="acct-rel-head">
          <div class="avatar">${avatar}</div>
          <div class="acct-rel-name">${UI.esc(r.name || '未命名')}</div>
          <select class="acct-rel-type">${RELATIONS.map(x => `<option${x === (r.relation || '好友') ? ' selected' : ''}>${x}</option>`).join('')}</select>
          <button class="friend-btn friend-rm acct-rel-del" type="button">✕</button>
        </div>
        <div class="acct-rel-sub">
          <input class="acct-rel-note" placeholder="备注（可选，如：他在追我 / 从小一起长大）" value="${UI.esc(r.note || '')}">
          <input class="acct-rel-imgtag" placeholder="生图标签（英文，如：jujutsu kaisen, Satoru Gojo）" value="${UI.esc(r.imgTag || '')}">
        </div>
      `;
      wrap.querySelector('.acct-rel-type').addEventListener('change', (e) => { r.relation = e.target.value; });
      wrap.querySelector('.acct-rel-note').addEventListener('input', (e) => { r.note = e.target.value; });
      wrap.querySelector('.acct-rel-imgtag').addEventListener('input', (e) => { r.imgTag = e.target.value; });
      wrap.querySelector('.acct-rel-del').addEventListener('click', () => {
        player.relations.splice(i, 1);
        renderRelations(player);
      });
      return wrap;
    }
    /** 打开「添加关联角色」选择弹层（搜索 + 酒馆 tag 分组） */
    function openRolePick(player) {
      const modal = document.getElementById('role-pick-modal');
      const search = document.getElementById('rp-search');
      const tagSel = document.getElementById('rp-tag');
      const list = document.getElementById('rp-list');
      const addBtn = document.getElementById('rp-add');
      const chars = App.state.allCharacters || [];
      const used = new Set((player.relations || []).map(x => x.key));
      const sel = new Set(); // 勾选中的角色 key（支持多选批量添加）
      // tag 分组下拉：读取酒馆角色标签，可按分组筛选
      const tags = Array.from(new Set(chars.reduce((a, c) => a.concat(c.tag || []), []))).sort();
      tagSel.innerHTML = '<option value="">全部分组</option>' + tags.map(t => `<option>${UI.esc(t)}</option>`).join('');
      function updateAddBtn() {
        addBtn.textContent = '添加所选（' + sel.size + '）';
        addBtn.disabled = !sel.size;
      }
      function render() {
        const q = (search.value || '').trim().toLowerCase();
        const tg = tagSel.value;
        const filtered = chars.filter(c => {
          if (used.has(App.charKey(c))) return false;
          if (q && App.displayName(c).toLowerCase().indexOf(q) < 0) return false;
          if (tg && (c.tag || []).indexOf(tg) < 0) return false;
          return true;
        });
        if (!filtered.length) { list.innerHTML = '<div class="empty small">没有可添加的角色（可切换分组/搜索，或先去酒馆给角色加 tag）</div>'; return; }
        list.innerHTML = filtered.map(c => {
          const k = App.charKey(c);
          const on = sel.has(k);
          const avatar = UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
          const tagsHtml = (c.tag || []).map(t => `<span class="rp-tag">${UI.esc(t)}</span>`).join('');
          return `<div class="rp-item${on ? ' sel' : ''}" data-key="${UI.esc(k)}">
            <span class="rp-check${on ? ' on' : ''}"></span>
            <div class="avatar">${avatar}</div>
            <div class="rp-main"><div class="rp-name">${UI.esc(App.displayName(c))}</div><div class="rp-tags">${tagsHtml || '<span class="rp-tag-none">无 tag</span>'}</div></div>
          </div>`;
        }).join('');
        list.querySelectorAll('.rp-item').forEach(el => {
          el.addEventListener('click', () => {
            const k = el.dataset.key;
            if (sel.has(k)) sel.delete(k); else sel.add(k);
            el.classList.toggle('sel');
            const chk = el.querySelector('.rp-check');
            if (chk) chk.classList.toggle('on');
            updateAddBtn();
          });
        });
      }
      search.value = '';
      search.oninput = render;
      tagSel.onchange = render;
      render();
      updateAddBtn();
      addBtn.onclick = () => {
        if (!sel.size) return;
        sel.forEach(k => {
          if (used.has(k)) return;
          const c = App.charByKey(k);
          if (!c) return;
          player.relations.push({ key: k, name: App.displayName(c), relation: '好友', note: '', imgTag: '' });
          used.add(k);
        });
        renderRelations(player);
        modal.style.display = 'none';
        UI.toast('已添加 ' + sel.size + ' 个角色');
      };
      modal.style.display = 'flex';
      document.getElementById('rp-cancel').onclick = () => { modal.style.display = 'none'; };
      modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    }
    function collectRelations() {
      const box = document.getElementById('acct-relations');
      const out = [];
      box.querySelectorAll('.acct-rel').forEach(el => {
        const key = el.dataset.key;
        if (!key) return;
        const c = App.charByKey(key);
        if (!c) return;
        out.push({
          key,
          name: App.displayName(c),
          relation: el.querySelector('.acct-rel-type').value,
          note: el.querySelector('.acct-rel-note').value.trim(),
          imgTag: el.querySelector('.acct-rel-imgtag').value.trim(),
        });
      });
      return out;
    }
  }

  function init() {
    document.getElementById('btn-contacts-add').addEventListener('click', () => App.showPage('page-friends', Friends.render));
  }

  return { render, init, activePlayer, players };
})();
