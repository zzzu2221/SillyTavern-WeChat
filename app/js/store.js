/* ============ 会话映射存储（按账号隔离 + localStorage 缓存 + 酒馆设置双写，多端同步） ============ */
/* 酒馆原生一个角色绑定一个会话文件，这里用自建映射表实现同一角色多条会话存档，
   每个会话对应酒馆里一个 .jsonl 聊天文件。
   切号系统：会话映射按「账号 id」分桶 —— 每个账号独立的 wx_sessions_v1_<账号id>，
   切 A 账号只看 A 的会话，切 B 账号只看 B 的会话，互不串号。
   映射同时写入酒馆设置（extension_settings['wechat-st'].sessionsByPlayer[账号id]），
   与朋友圈/账号/白名单一样随酒馆数据多端同步；localStorage 仅作本地缓存与回退。 */

const Store = (() => {
  const BASE_KEY = 'wx_sessions_v1';
  const BASE_CUR = 'wx_current_v1';

  /** 当前账号 id（与扩展层 currentPlayerId 同源：activePlayerId → players[0] → 'me'） */
  function currentId() {
    try {
      const s = API.getSettings() || {};
      let id = s.activePlayerId;
      if (!id) {
        const list = Array.isArray(s.players) ? s.players : [];
        id = (list[0] && list[0].id) || 'me';
      }
      return String(id);
    } catch (e) { return 'me'; }
  }
  function KEY() { return BASE_KEY + '_' + currentId(); }
  function CUR() { return BASE_CUR + '_' + currentId(); }

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(KEY())) || {}; } catch { return {}; }
  }
  function getLocalCurrent() {
    try { return JSON.parse(localStorage.getItem(CUR())) || null; } catch { return null; }
  }

  /** 当前账号在酒馆设置里的会话桶 { map, current }（多端同步权威副本） */
  function accountBucket() {
    const pid = currentId();
    const s = API.getSettings() || {};
    const sp = (s.sessionsByPlayer && typeof s.sessionsByPlayer === 'object') ? s.sessionsByPlayer : {};
    const b = (sp[pid] && typeof sp[pid] === 'object') ? sp[pid] : {};
    return { pid, sp, b };
  }
  /** 写入酒馆设置（多端同步权威副本）；无桥/失败时静默忽略（仅存本地） */
  function pushSessions(map) {
    try {
      const { pid, sp, b } = accountBucket();
      sp[pid] = Object.assign({}, b, { map: map || {} });
      API.saveAppSettings({ sessionsByPlayer: sp });
    } catch (e) {}
  }
  function pushCurrent(ctx) {
    try {
      const { pid, sp, b } = accountBucket();
      sp[pid] = Object.assign({}, b, { current: ctx || null });
      API.saveAppSettings({ sessionsByPlayer: sp });
    } catch (e) {}
  }

  function load() { return loadLocal(); }
  function save(map) {
    try { localStorage.setItem(KEY(), JSON.stringify(map)); } catch (e) { /* 隐私模式/禁用存储：忽略 */ }
    pushSessions(map);
  }

  /** 会话归档键：优先角色唯一标识 key（avatar_file），兼容旧版本按 name 存储的数据 */
  function bucketKey(charKey, charName) {
    const k = (charKey && charKey !== 'undefined') ? String(charKey) : '';
    const n = charName || '';
    return k || n;
  }

  /** 取某角色全部会话（按更新时间倒序） */
  function sessionsOf(charKey, charName) {
    const map = load();
    const bk = bucketKey(charKey, charName);
    const list = (map[bk] || []).slice();
    // 兼容旧数据：旧版本以 name 为键且与 key 不同名时合并
    if (charName && bk !== charName && Array.isArray(map[charName])) {
      for (const s of map[charName]) {
        if (!list.some(x => x.file === s.file)) list.push(s);
      }
    }
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list;
  }

  /** 新增会话 */
  function addSession(charKey, charName, session) {
    const map = load();
    const bk = bucketKey(charKey, charName);
    if (!map[bk]) map[bk] = [];
    map[bk].push(session);
    save(map);
    return session;
  }

  /** 更新会话（preview / updatedAt / unread）；兼容旧数据：会话若在 charName 桶里，自动迁移到 charKey 桶再更新 */
  function touchSession(charKey, charName, file, patch) {
    const map = load();
    const bk = bucketKey(charKey, charName);
    let list = map[bk] || [];
    let s = list.find(x => x.file === file);
    // 兼容旧数据：charKey 桶找不到时，去 charName 桶找，找到就迁移过来
    if (!s && charName && bk !== charName && Array.isArray(map[charName])) {
      const oldList = map[charName];
      const idx = oldList.findIndex(x => x.file === file);
      if (idx >= 0) {
        s = oldList.splice(idx, 1)[0];
        if (!oldList.length) delete map[charName];
        if (!map[bk]) map[bk] = [];
        map[bk].push(s);
        list = map[bk];
      }
    }
    if (s) Object.assign(s, patch, { updatedAt: Date.now() });
    save(map);
    return s;
  }

  /** 删除会话（同时清理旧版本以 name 为键的桶） */
  function removeSession(charKey, charName, file) {
    const map = load();
    const bk = bucketKey(charKey, charName);
    [bk, charName].filter(Boolean).forEach(b => {
      if (map[b]) {
        map[b] = map[b].filter(x => x.file !== file);
        if (!map[b].length) delete map[b];
      }
    });
    save(map);
  }

  /** 当前会话上下文：{charKey, charName, file, title} */
  function getCurrent() { return getLocalCurrent(); }
  function setCurrent(ctx) {
    try { localStorage.setItem(CUR(), JSON.stringify(ctx)); } catch (e) { /* 忽略 */ }
    pushCurrent(ctx);
  }
  function clearCurrent() {
    try { localStorage.removeItem(CUR()); } catch (e) { /* 忽略 */ }
    pushCurrent(null);
  }

  /** 启动/切号时从酒馆设置拉取当前账号会话映射（服务端为权威）覆盖本地缓存；
      服务端还没有而本地已有旧数据时，一次性迁移到服务端，实现多端一致 */
  async function syncFromServer() {
    let s = null;
    try { s = await API.getSettings(); } catch (e) { return; }
    if (!s) return;
    try {
      const pid = currentId();
      const sp = (s.sessionsByPlayer && typeof s.sessionsByPlayer === 'object') ? s.sessionsByPlayer : {};
      const b = (sp[pid] && typeof sp[pid] === 'object') ? sp[pid] : {};
      if (b.map) {
        localStorage.setItem(KEY(), JSON.stringify(b.map));
      } else if (Object.keys(loadLocal()).length) {
        pushSessions(loadLocal());
      }
      if (b.current) {
        localStorage.setItem(CUR(), JSON.stringify(b.current));
      } else if (getLocalCurrent()) {
        pushCurrent(getLocalCurrent());
      }
    } catch (e) {}
  }

  /** 生成酒馆风格的会话文件名 */
  function newFileName(charName) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${charName} - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}@${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}s${ms}ms`;
  }

  return { sessionsOf, addSession, touchSession, removeSession, getCurrent, setCurrent, clearCurrent, newFileName, syncFromServer };
})();
