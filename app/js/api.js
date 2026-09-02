/* ============ 后端 API 客户端（扩展版：通过 parent.WXBRIDGE 对接酒馆） ============ */
const API = (() => {
  /** 获取桥：运行在 iframe 内时访问 parent.WXBRIDGE；直接打开时回退到自身 */
  function bridge() {
    try {
      if (window.parent && window.parent.WXBRIDGE) return window.parent.WXBRIDGE;
    } catch (e) {}
    if (window.WXBRIDGE) return window.WXBRIDGE;
    return null;
  }

  function requireBridge() {
    const b = bridge();
    if (!b) throw new Error('未连接到酒馆扩展，请通过酒馆页面的悬浮 💬 按钮打开');
    return b;
  }

  /** 角色头像：白名单文件名的 data URL 直接用；否则保持原样 */
  function resolveAvatar(c) {
    if (!c) return '';
    let a = c.avatar || '';
    if (typeof a === 'string' && !a.startsWith('data:')) {
      // 扩展桥返回的 avatar 已是 data URL（来自酒馆 getCharacters）
      return a;
    }
    return a;
  }

  return {
    /** 运行时配置 */
    config: () => requireBridge().getConfig(),

    /* --- 角色 --- */
    listCharacters: () => requireBridge().listCharacters(),

    /* --- 聊天 --- */
    getChat: (avatar, file) => requireBridge().getChat(avatar, file),
    saveChat: (avatar, file, chat) => requireBridge().saveChat(avatar, file, chat),
    deleteChat: (avatar, file) => requireBridge().deleteChat(avatar, file),

    /* --- 聊天生成 --- */
    genChat: (messages, opts) => requireBridge().genChat(messages, opts || {}),

    /* --- 生图 --- */
    genImage: (prompt, extra) => requireBridge().genImage(Object.assign({ prompt }, extra || {})),

    /* --- 朋友圈 --- */
    getMoments: () => requireBridge().getMoments(),
    publishMoment: (data) => requireBridge().publishMoment(data),
    addComment: (data) => requireBridge().addComment(data),
    deleteMoment: (id) => requireBridge().deleteMoment(id),
    deleteComment: (momentId, time, key) => requireBridge().deleteComment(momentId, time, key),
    aiComment: (data) => requireBridge().aiComment(data),
    genAutoMoment: (data) => requireBridge().genAutoMoment(data),

    /* --- 公众号 --- */
    getArticles: () => requireBridge().getArticles(),
    publishArticle: (data) => requireBridge().publishArticle(data),
    deleteArticle: (id) => requireBridge().deleteArticle(id),
    genArticle: (data) => requireBridge().genArticle(data),

    /* --- 设置 --- */
    getSettings: () => requireBridge().getSettings(),
    saveAppSettings: (patch) => { requireBridge().saveAppSettings(patch || {}); return true; },
    openSettings: () => requireBridge().openSettings(),
    isAllowed: (name) => { try { const b = bridge(); return b ? b.isAllowed(name) : true; } catch (e) { return true; } },

    /* --- 用户设定 / 世界书（酒馆） --- */
    listPersonas: () => requireBridge().listPersonas(),
    listWorldInfos: () => requireBridge().listWorldInfos(),
    getWorldInfoText: (id) => requireBridge().getWorldInfoText(id),
    getWorldInfoEntries: (id) => requireBridge().getWorldInfoEntries(id),
  };
})();
