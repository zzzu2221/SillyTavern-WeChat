/* ============ 本地会话映射存储（localStorage） ============ */
/* 酒馆原生一个角色绑定一个会话文件，这里用 localStorage 自建映射表，
   实现同一角色多条会话存档。每个会话对应酒馆里一个 .jsonl 聊天文件。 */

const Store = (() => {
  const KEY = 'wx_sessions_v1';
  const CUR = 'wx_current_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function save(map) {
    localStorage.setItem(KEY, JSON.stringify(map));
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
  function getCurrent() {
    try { return JSON.parse(localStorage.getItem(CUR)) || null; } catch { return null; }
  }
  function setCurrent(ctx) {
    localStorage.setItem(CUR, JSON.stringify(ctx));
  }
  function clearCurrent() {
    localStorage.removeItem(CUR);
  }

  /** 生成酒馆风格的会话文件名 */
  function newFileName(charName) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${charName} - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}@${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}s${ms}ms`;
  }

  return { sessionsOf, addSession, touchSession, removeSession, getCurrent, setCurrent, clearCurrent, newFileName };
})();
