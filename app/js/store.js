/* ============ 会话映射存储（localStorage 缓存 + 酒馆设置双写，多端同步） ============ */
/* 酒馆原生一个角色绑定一个会话文件，这里用自建映射表实现同一角色多条会话存档，
   每个会话对应酒馆里一个 .jsonl 聊天文件。
   映射同时写入酒馆设置（extension_settings['wechat-st'].sessions/.current），
   与朋友圈/账号/白名单一样随酒馆数据多端同步；localStorage 仅作本地缓存与回退。 */

const Store = (() => {
  const KEY = 'wx_sessions_v1';
  const CUR = 'wx_current_v1';

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function getLocalCurrent() {
    try { return JSON.parse(localStorage.getItem(CUR)) || null; } catch { return null; }
  }

  /** 写入酒馆设置（多端同步权威副本）；无桥/失败时静默忽略（仅存本地） */
  function pushSessions(map) {
    try { API.saveAppSettings({ sessions: map || {} }); } catch (e) {}
  }
  function pushCurrent(ctx) {
    try { API.saveAppSettings({ current: ctx || null }); } catch (e) {}
  }

  function load() { return loadLocal(); }
  function save(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) { /* 隐私模式/禁用存储：忽略 */ }
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

  /** 更新会话（preview / updatedAt） */
  function touchSession(charKey, charName, file, patch) {
    const map = load();
    const bk = bucketKey(charKey, charName);
    const list = map[bk] || [];
    const s = list.find(x => x.file === file);
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
    try { localStorage.setItem(CUR, JSON.stringify(ctx)); } catch (e) { /* 忽略 */ }
    pushCurrent(ctx);
  }
  function clearCurrent() {
    try { localStorage.removeItem(CUR); } catch (e) { /* 忽略 */ }
    pushCurrent(null);
  }

  /** 启动时从酒馆设置拉取会话映射（服务端为权威）覆盖本地缓存；
      服务端还没有而本地已有旧数据时，一次性迁移到服务端，实现多端一致 */
  async function syncFromServer() {
    let s = null;
    try { s = await API.getSettings(); } catch (e) { return; }
    if (!s) return;
    try {
      if (s.sessions) {
        localStorage.setItem(KEY, JSON.stringify(s.sessions));
      } else if (Object.keys(loadLocal()).length) {
        pushSessions(loadLocal());
      }
      if (s.current) {
        localStorage.setItem(CUR, JSON.stringify(s.current));
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
