/* ============ 新朋友页（通讯录右上角＋） ============ */
/* 列出全部角色卡，点「同意」加入通讯录白名单，点「移除」移出 */
const Friends = (() => {
  let tagFilter = '';
  function whitelist() {
    const cfg = App.state.config || {};
    return Array.isArray(cfg.whitelist) ? cfg.whitelist.map(String) : [];
  }
  /** 手动排除列表（对 tag 自动加入的角色点「移除」时记录，用于从通讯录隐藏） */
  function excluded() {
    const cfg = App.state.config || {};
    return Array.isArray(cfg.whitelistExcluded) ? cfg.whitelistExcluded.map(String) : [];
  }
  /** 有效联系人 key 集合（手动白名单 + tag 自动 − 排除） */
  function effectiveKeys() {
    try { return App.effectiveWhitelist(); } catch (e) { return new Set(whitelist()); }
  }

  async function saveWhitelist(list) {
    const uniq = Array.from(new Set(list.map(String).filter(Boolean)));
    await API.saveAppSettings({ whitelist: uniq });
    // 更新本地缓存
    if (App.state.config) App.state.config.whitelist = uniq;
    await App.refreshCharacters();
  }
  async function saveExcluded(list) {
    const uniq = Array.from(new Set(list.map(String).filter(Boolean)));
    await API.saveAppSettings({ whitelistExcluded: uniq });
    if (App.state.config) App.state.config.whitelistExcluded = uniq;
    await App.refreshCharacters();
  }

  /** 生图是否启用（设置面板「启用生图」开关，关闭时隐藏删除/移除功能） */
  function imgEnabled() {
    const cfg = App.state.config || {};
    return cfg.imageEnabled !== false;
  }

  function render() {
    const body = document.getElementById('friends-body');
    const chars = App.state.allCharacters || [];
    const wl = whitelist();
    const eff = effectiveKeys();
    const autoTag = (App.state.config && App.state.config.autoWhitelistTag) || '';
    if (!chars.length) {
      body.innerHTML = `<div class="empty"><div class="big">👥</div>暂无角色卡<br><br>请确认酒馆已启动并已导入角色</div>`;
      return;
    }
    const allTags = Array.from(new Set(chars.reduce((a, c) => a.concat(c.tag || []), []))).sort();
    const curTag = tagFilter;
    const visible = curTag ? chars.filter(c => (c.tag || []).indexOf(curTag) >= 0) : chars;
    const sorted = visible.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
    const added = [], pending = [];
    sorted.forEach(c => {
      const key = App.charKey(c);
      if (eff.has(key)) added.push(c);
      else pending.push(c);
    });

    function row(c, opts) {
      const avatar = UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
      const key = App.charKey(c);
      const tagsHtml = (c.tag || []).map(t => `<span class="rp-tag">${UI.esc(t)}</span>`).join('');
      const isAuto = autoTag && (c.tag || []).indexOf(autoTag) >= 0 && wl.indexOf(key) < 0;
      const autoBadge = isAuto ? '<span class="friend-auto">tag 自动</span>' : '';
      const btns = opts.btn || '';
      return `<div class="friend-item" data-key="${UI.esc(key)}">
        <div class="avatar">${avatar}</div>
        <div class="friend-main"><div class="friend-name">${UI.esc(App.displayName(c))}${autoBadge}</div><div class="friend-tags">${tagsHtml || ''}</div></div>
        <div class="friend-actions">${btns}</div>
      </div>`;
    }

    const addedHtml = added.map(c => row(c, {
      btn: `<button class="friend-btn friend-rm" data-key="${UI.esc(App.charKey(c))}" type="button">移除</button>`
    })).join('');
    const pendingHtml = pending.map(c => row(c, {
      btn: `<button class="friend-btn friend-ok" data-key="${UI.esc(App.charKey(c))}" type="button">同意</button>`
    })).join('');

    const tagBar = allTags.length ? `
      <div class="friend-tagbar">
        <select id="friend-tag-sel">
          <option value="">全部分组</option>
          ${allTags.map(t => `<option${t === curTag ? ' selected' : ''}>${UI.esc(t)}</option>`).join('')}
        </select>
      </div>` : '';
    body.innerHTML = tagBar + `
      <div class="friend-hint">点「同意」把角色加入通讯录（也才能发朋友圈）；「移除」则从通讯录删掉。可在酒馆角色管理给角色打 tag 后按分组筛选。${autoTag ? `当前设置：打「${UI.esc(autoTag)}」tag 的角色自动加入通讯录（可移除，移除后不会再自动出现，除非重新同意）。` : ''}</div>
      <div class="friend-group">${added.length ? `<div class="friend-group-title">已加入（${added.length}）</div><div class="friend-list">${addedHtml}</div>` : ''}</div>
      <div class="friend-group">${pending.length ? `<div class="friend-group-title">新朋友（${pending.length}）</div><div class="friend-list">${pendingHtml}</div>` : '<div class="empty small">没有待添加的角色卡了</div>'}</div>
    `;
    const tagSel = document.getElementById('friend-tag-sel');
    if (tagSel) tagSel.addEventListener('change', () => { tagFilter = tagSel.value; render(); });
    body.querySelectorAll('.friend-ok').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const c = App.charByKey(key);
        // 若之前被排除（tag 自动但被移除过），重新同意时解除排除
        const ex = excluded();
        if (ex.indexOf(key) >= 0) await saveExcluded(ex.filter(k => k !== key));
        const list = whitelist();
        if (list.indexOf(key) < 0) list.push(key);
        await saveWhitelist(list);
        openRelationModal(key, c);
      });
    });
    body.querySelectorAll('.friend-rm').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const ok = await UI.confirm('从通讯录移除该角色？（聊天记录不会删除）', { okText: '移除' });
        if (!ok) return;
        const wl2 = whitelist();
        if (wl2.indexOf(key) >= 0) {
          await saveWhitelist(wl2.filter(k => k !== key));
        } else {
          // tag 自动加入的：记入排除列表
          const ex = excluded();
          if (ex.indexOf(key) < 0) { ex.push(key); await saveExcluded(ex); }
        }
        UI.toast('已移除');
        render();
      });
    });
    // 点头像/名字直接聊天
    body.querySelectorAll('.friend-item').forEach(el => {
      el.addEventListener('click', () => {
        const c = App.charByKey(el.dataset.key);
        if (c) App.openCharacter(c);
      });
    });
  }

  /* ---- 同意时选关系（写入当前 Player 的 relations） ---- */
  const RELATIONS = ['情侣', '恋人', '伴侣', '好友', '兄弟', '姐妹', '家人', '死对头', '师生', '同事', '室友', '其他'];
  function openRelationModal(key, c) {
    const modal = document.getElementById('friend-rel-modal');
    document.getElementById('fr-name').textContent = c ? App.displayName(c) : key;
    const sel = document.getElementById('fr-relation');
    sel.innerHTML = RELATIONS.map(x => `<option>${x}</option>`).join('');
    document.getElementById('fr-note').value = '';
    document.getElementById('fr-tip').textContent = '';
    // 若当前账号已有关联该角色，回填
    const player = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    if (player) {
      const exist = (player.relations || []).find(r => r.key === key);
      if (exist) { sel.value = exist.relation || '好友'; document.getElementById('fr-note').value = exist.note || ''; }
    }
    modal.style.display = 'flex';
    document.getElementById('fr-cancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.getElementById('fr-ok').onclick = async () => {
      const relation = sel.value;
      const note = document.getElementById('fr-note').value.trim();
      const list = whitelist();
      if (list.indexOf(key) < 0) list.push(key);
      await saveWhitelist(list);
      // 写入当前 Player 的关系
      try {
        if (typeof Me !== 'undefined') {
          const players = Me.players();
          const active = Me.activePlayer();
          const rels = (active.relations || []).filter(r => r.key !== key);
          rels.push({ key, name: c ? App.displayName(c) : key, relation, note });
          const updated = players.map(p => p.id === active.id ? Object.assign({}, p, { relations: rels }) : p);
          API.saveAppSettings({ players: updated });
          if (App.state.config) App.state.config.players = updated;
        }
      } catch (e) { /* 关系写入失败不阻断加好友 */ }
      modal.style.display = 'none';
      UI.toast('已加入通讯录，并记录关系');
      render();
    };
  }

  function init() {
    document.getElementById('btn-friends-back').addEventListener('click', () => {
      App.showTab('contacts');
    });
  }

  return { render, init };
})();
