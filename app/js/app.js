/* ============ 应用主控：路由 / Tab / 全局状态 ============ */
/* 全局错误捕获：移动端排查用（任何 JS 异常都弹出来，避免白屏后无从下手） */
(function () {
  function toastMsg(m) {
    try { if (window.UI && UI.toast) UI.toast(m); else console.error('[WXST]', m); } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    toastMsg('页面错误: ' + (e.message || 'unknown'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    toastMsg('异步错误: ' + ((r && (r.message || r)) || 'unknown'));
  });
})();

const App = (() => {
  // 全局缓存
  const state = {
    allCharacters: [],   // 全部角色卡（含未加入白名单的）
    characters: [],      // 白名单内角色卡（通讯录展示用）
    charMap: {},         // name -> character（全部）
    config: null,
    momentsGroup: null,
  };

  let currentTab = 'chatlist';

  /* ---- 数据加载 ---- */
  /** 有效通讯录：手动白名单 ∪ 带 autoWhitelistTag 的角色 − 手动排除的 */
  function effectiveWhitelist() {
    const cfg = state.config || {};
    const wl = (Array.isArray(cfg.whitelist) ? cfg.whitelist : []).map(String);
    const excluded = (Array.isArray(cfg.whitelistExcluded) ? cfg.whitelistExcluded : []).map(String);
    const autoTag = String(cfg.autoWhitelistTag || '').trim();
    const keys = new Set(wl);
    if (autoTag) {
      state.allCharacters.forEach(c => {
        if ((c.tag || []).indexOf(autoTag) >= 0) keys.add(String(c.key || c.avatar_file || c.name));
      });
    }
    excluded.forEach(k => keys.delete(k));
    return keys;
  }
  async function refreshCharacters() {
    const list = await API.listCharacters();
    state.allCharacters = list || [];
    // 白名单过滤（白名单存角色唯一标识 key = avatar_file || name）
    const wl = (state.config && state.config.whitelist) || null;
    if (wl) {
      const effective = effectiveWhitelist();
      state.characters = state.allCharacters.filter(c => effective.has(String(c.key || c.avatar_file || c.name)));
    } else {
      state.characters = state.allCharacters.slice();
    }
    state.charMap = {};
    for (const c of state.allCharacters) {
      const key = String(c.key || c.avatar_file || c.name);
      if (key) state.charMap[key] = c;
      if (c.name && !state.charMap[c.name]) state.charMap[c.name] = c; // name 兼容查找
    }
    return state.characters;
  }

  async function loadConfig() {
    state.config = await API.config();
    if (state.config && state.config.momentsGroup) state.momentsGroup = state.config.momentsGroup;
    return state.config;
  }

  /* ---- Tab 切换 ---- */
  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById('tabbar').style.display = 'flex';
    const pageId = 'page-' + tab;
    const page = document.getElementById(pageId);
    page.style.display = 'flex';
    document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    // 重新渲染对应页
    if (tab === 'chatlist') ChatList.render();
    else if (tab === 'contacts') Contacts.render();
    else if (tab === 'moments') {
      // 每次进入朋友圈都拉取最新数据（避免发布/评论后不刷新）
      Moments.load().then(() => Moments.render()).catch(e => UI.toast('朋友圈加载失败：' + e.message));
    }
    else if (tab === 'articles') {
      Articles.load().then(() => Articles.render()).catch(e => UI.toast('公众号加载失败：' + e.message));
    }
    else if (tab === 'me') renderMe();
  }

  /* ---- 全屏子页（聊天/详情/会话列表） ---- */
  function showPage(pageId, renderFn) {
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById('tabbar').style.display = 'none';
    const page = document.getElementById(pageId);
    page.style.display = 'flex';
    if (renderFn) renderFn();
  }

  /* ---- 返回来源记忆：从聊天页点卡片跳到原文（朋友圈详情/公众号阅读）时记录来源，返回时回到原处 ---- */
  let backHandler = null;
  function setBackHandler(fn) { backHandler = (typeof fn === 'function') ? fn : null; }
  function hasBack() { return !!backHandler; }
  /** 取走并执行返回处理器；没有则返回 null（调用方按默认返回处理） */
  function consumeBack() { const h = backHandler; backHandler = null; return h; }

  /* ---- 角色相关辅助 ---- */
  function charKey(c) { return c && (c.key || c.avatar_file || c.name) ? String(c.key || c.avatar_file || c.name) : ''; }
  function displayName(c) { return (c && c.displayName) || (c && c.name) || ''; }
  function charByName(name) { return state.charMap[name] || null; }
  function charByKey(key) { return key ? state.charMap[String(key)] || null : null; }
  function charByAvatar(avatar) { return state.characters.find(c => c.avatar === avatar) || null; }

  /* ---- 打开某角色聊天 ---- */
  async function openCharacter(character) {
    if (!character) return;
    const key = charKey(character);
    state.currentCharacter = character; // 供发布朋友圈默认「由谁发布」
    const sessions = Store.sessionsOf(key, character.name);
    if (sessions.length) {
      // 打开最近一次会话
      Chat.open(character, sessions[0]);
    } else {
      // 新建会话
      const session = await Chat.createSession(character);
      Chat.open(character, session);
    }
  }

  /* ---- 「我」页 ---- */
  function renderMe() {
    Me.render();
  }

  /* ---- 启动 ---- */
  async function init() {
    // Tab 绑定
    document.querySelectorAll('.tab-item').forEach(t => {
      t.addEventListener('click', () => showTab(t.dataset.tab));
    });
    // 各模块初始化
    ChatList.initAddButton();
    Chat.init();
    Detail.init();
    Moments.init();
    Articles.init();
    Friends.init();
    Me.init();
    if (typeof GroupChat !== 'undefined') GroupChat.init();
    // 预加载数据：先配置（含白名单）再角色，避免并行时白名单未就绪
    try {
      await loadConfig();
      // 会话映射多端同步：拉取酒馆设置里的权威副本覆盖本地缓存
      await Store.syncFromServer();
      // 公众号 tab 开关（设置里可关闭）
      const artTab = document.getElementById('tab-articles');
      if (artTab) artTab.style.display = (state.config && state.config.enableArticle !== false) ? '' : 'none';
      await refreshCharacters();
    } catch (e) {
      UI.toast('连接后端失败：' + e.message);
    }
    showTab('chatlist');
  }

  return {
    state, init, showTab, showPage,
    refreshCharacters, loadConfig,
    effectiveWhitelist,
    charByName, charByKey, charByAvatar, charKey, displayName, openCharacter,
    setBackHandler, hasBack, consumeBack,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
