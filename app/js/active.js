/* ============ AI 活跃行为（活人感）：主动私信 / 群话题 / 朋友圈 / 公众号 定时触发 ============ */
/* 需要微信页面开着；每 3 分钟检查一次，各行为按冷却频率触发，每次最多执行 1 个行为避免打爆模型。
   角色选择只从「当前账号的关联角色」里挑（非关联角色大多是别的设定卡，不会主动来）。 */
const Active = (() => {
  const LS = 'wst_active_last';
  const CHECK_MS = 3 * 60 * 1000; // 每 3 分钟检查一次
  let timer = null;

  function cfg() {
    const c = ((App.state && App.state.config && App.state.config.active) || {});
    return Object.assign({
      enabled: true, privateEnabled: true, privateHours: 4,
      groupEnabled: true, groupHours: 3,
      momentEnabled: true, momentHours: 6, momentImg: true, momentImgChance: 0.5,
      articleEnabled: true, articleHours: 12, articleImg: true, articleImgChance: 0.5,
    }, c);
  }
  function lastOf(k) { try { return Number(localStorage.getItem(LS + '_' + k) || 0) || 0; } catch (e) { return 0; } }
  function markDone(k) { try { localStorage.setItem(LS + '_' + k, String(Date.now())); } catch (e) {} }
  function passed(k, hours) { if (!hours) return true; return Date.now() - lastOf(k) >= hours * 3600 * 1000; }
  function pick(list) { return (list && list.length) ? list[Math.floor(Math.random() * list.length)] : null; }
  function lastPicked(k) { try { return localStorage.getItem('wst_active_pick_' + k) || ''; } catch (e) { return ''; } }
  function rememberPick(k, key) { try { localStorage.setItem('wst_active_pick_' + k, String(key || '')); } catch (e) {} }
  /** 随机选，但尽量避免与上次选的重复（相邻两次不撞车，增加随机感） */
  function pickAvoid(list, avoid) {
    if (!list || !list.length) return null;
    if (!avoid) return list[Math.floor(Math.random() * list.length)];
    const others = list.filter(x => App.charKey(x) !== avoid);
    const pool = others.length ? others : list;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** 关联角色候选：只从当前玩家账号 relations 里选（非关联角色不会主动） */
  function relatedChars() {
    try {
      const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
      const rels = (p && Array.isArray(p.relations)) ? p.relations : [];
      return rels.map(r => r.key ? App.charByKey(r.key) : null).filter(Boolean);
    } catch (e) { return []; }
  }
  function meKey() {
    try { const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null; return p && p.id ? '__me__' + p.id : '__me__'; } catch (e) { return '__me__'; }
  }
  function displayName(key, fallback) {
    try {
      if (key && String(key).indexOf('__me__') === 0) {
        const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
        return (p && p.name) || '我';
      }
      const c = key ? App.charByKey(key) : null;
      if (c) {
        const n = String((typeof Detail !== 'undefined' && Detail.shownName) ? Detail.shownName(c) : App.displayName(c)).trim();
        return n || fallback || key || '';
      }
    } catch (e) {}
    return fallback || String(key || '');
  }
  function meDescText() {
    try {
      const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
      return p ? [p.description, p.signature, p.mountedText, p.worldbook].filter(Boolean).join('\n') : '';
    } catch (e) { return ''; }
  }

  /* ---- 1. 主动私信：关联角色主动找玩家（优先有会话的角色，避免连续重复；会话太少则放宽到全部关联角色） ---- */
  async function doPrivate() {
    const ac = cfg();
    if (!ac.enabled || !ac.privateEnabled || !passed('private', ac.privateHours)) return false;
    const chars = relatedChars();
    if (!chars.length) return false;
    // 有会话的角色优先（聊过才自然主动找）；太少则放宽到全部关联角色
    const withSessions = chars.filter(c => {
      try { const ss = Store.sessionsOf(App.charKey(c), App.displayName(c)); return ss && ss.length; } catch (e) { return false; }
    });
    const pool = withSessions.length >= 2 ? withSessions : chars;
    const c = pickAvoid(pool, lastPicked('private'));
    if (!c) return false;
    const key = App.charKey(c);
    const name = App.displayName(c);
    let sessions = [];
    try { sessions = (typeof Store !== 'undefined') ? Store.sessionsOf(key, name) : []; } catch (e) {}
    let s = sessions.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (!s) {
      // 没聊过的：新建会话主动搭话（保持随机与活人感）
      try { s = await Chat.createSession(c); } catch (e) { return false; }
      if (!s) return false;
    }
    markDone('private');
    rememberPick('private', key);
    try {
      if (typeof Chat !== 'undefined' && Chat.sendCharMessageToPlayer) {
        await Chat.sendCharMessageToPlayer(c, s, null, true);
      }
    } catch (e) {}
    return true;
  }

  /* ---- 2. 主动群话题：随机一个玩家在的群，成员自发聊几句 ---- */
  async function doGroup() {
    const ac = cfg();
    if (!ac.enabled || !ac.groupEnabled || !passed('group', ac.groupHours)) return false;
    let groups = [];
    try { groups = (await API.listWeChatGroups()) || []; } catch (e) {}
    if (!groups.length) return false;
    const mk = meKey();
    const mine = groups.filter(g => (g.memberKeys || []).some(k => String(k).indexOf('__me__') === 0 || k === mk) || !(g.memberKeys && g.memberKeys.length));
    const pool = mine.length ? mine : groups;
    const avoid = lastPicked('group');
    const others = pool.filter(x => x.name !== avoid);
    const chosen = (others.length ? others : pool)[Math.floor(Math.random() * (others.length ? others.length : pool.length))];
    if (!chosen || !chosen.name) return false;
    markDone('group');
    rememberPick('group', chosen.name);
    try { await backgroundGroupChat(chosen.name); } catch (e) {}
    return true;
  }

  /** 后台群聊（不依赖当前打开哪个群）：读群最新消息 → 让成员自发聊几句 → 写回消息；首轮后按最新消息再延续一轮，避免"角色发了没人理" */
  async function backgroundGroupChat(name) {
    const g = await API.getWeChatGroup(name);
    if (!g || !Array.isArray(g.members)) return;
    const now = Date.now();
    const muted = (g.meta && g.meta.muted) || {};
    const activeMembers = g.members.filter(m => !(muted[m.key] && muted[m.key] > now));
    const aiMembers = activeMembers.filter(m => String(m.key || '').indexOf('__me__') !== 0);
    if (!aiMembers.length) return;
    const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    const rels = (p && Array.isArray(p.relations)) ? p.relations : [];
    const members = activeMembers.map(m => {
      const rel = rels.find(x => x.key === m.key);
      return { key: m.key, name: displayName(m.key, m.name), relation: rel ? (rel.relation || '') : '' };
    });
    const base = {
      groupName: name, members, meName: p ? (p.name || '我') : '我',
      meDesc: meDescText(),
      timezone: (App.state && App.state.config && App.state.config.timezone) || 'Asia/Shanghai',
      announcement: (g.meta && g.meta.announcement) || '',
    };
    const writeRound = async (out) => {
      if (!out || !out.length) return 0;
      let wrote = 0;
      for (const o of out.slice(0, 3)) {
        await sleep(600 + Math.random() * 900);
        let key = null;
        const member = members.find(x => x.name === o.key);
        if (member) key = member.key;
        else if (App.charByKey(o.key)) key = o.key;
        if (!key || String(key).indexOf('__me__') === 0) {
          const fb = aiMembers[Math.floor(Math.random() * aiMembers.length)];
          key = fb ? fb.key : null;
        }
        if (!key || String(key).indexOf('__me__') === 0) continue;
        if (muted[key] && muted[key] > Date.now()) continue;
        await API.saveWeChatMessage(name, { name: displayName(key, o.key), key, text: o.text });
        wrote++;
      }
      return wrote;
    };
    // 首轮：群里安静下来，成员主动聊起来
    const msgs = (g.messages || []).slice(-12).map(m => ({ name: displayName(m.key, m.name), key: m.key, text: m.text }));
    const out1 = await API.genGroupReply(Object.assign({}, base, {
      messages: msgs,
      event: '群里安静下来了，成员们主动聊起来：分享近况、互相打趣、抛个新话题都行，像真人微信群一样自然热闹，别官方客套。',
    }));
    let wrote = await writeRound(out1);
    // 第二轮：成员接着刚才的话题自然往下聊（有来有回，别冷场）
    if (wrote) {
      await sleep(900 + Math.random() * 1200);
      try {
        const g2 = await API.getWeChatGroup(name);
        const msgs2 = (g2.messages || []).slice(-14).map(m => ({ name: displayName(m.key, m.name), key: m.key, text: m.text }));
        const out2 = await API.genGroupReply(Object.assign({}, base, {
          messages: msgs2,
          event: '成员们接着刚才的话题自然往下聊：回应上一条、接个梗、抛新话题都行，别冷场，别所有人都只回同一个人，要像真实微信群一样有来有回。',
        }));
        await writeRound(out2);
      } catch (e) {}
    }
    if (wrote && typeof ChatList !== 'undefined' && ChatList.render) ChatList.render();
  }

  /* ---- 3. 主动朋友圈：关联角色发圈（独立开关+带图概率，避免连续同一人） ---- */
  async function doMoment() {
    const ac = cfg();
    if (!ac.enabled || !ac.momentEnabled || !passed('moment', ac.momentHours)) return false;
    const chars = relatedChars();
    if (!chars.length) return false;
    const c = pickAvoid(chars, lastPicked('moment'));
    if (!c) return false;
    markDone('moment');
    rememberPick('moment', App.charKey(c));
    try {
      const key = App.charKey(c);
      const name = App.displayName(c);
      let recentChat = '';
      try { if (typeof Moments !== 'undefined' && Moments.recentChatOf) recentChat = await Moments.recentChatOf(key); } catch (e) {}
      const r = await API.genAutoMoment({ character: key, characterName: name, recentChat, hint: '' });
      let text = (r && r.text) || '';
      if (!text) return true;
      if (window.stripActions) text = window.stripActions(text);
      const withImg = ac.momentImg !== false && Math.random() < (ac.momentImgChance != null ? ac.momentImgChance : 0.5);
      const payload = { character: key, characterName: name, text };
      if (withImg && r.imgPrompt) payload.imagePrompt = r.imgPrompt;
      const post = await API.publishMoment(payload);
      // 发圈后 AI 自动评论（沿用 autoComment 开关）
      if (post && post.id && (App.state && App.state.config && App.state.config.autoComment) && typeof Moments !== 'undefined' && Moments.autoCommentMoment) {
        try { await Moments.autoCommentMoment({ id: post.id, key, character: name, text }); } catch (e) {}
      }
      return true;
    } catch (e) { return true; }
  }

  /* ---- 4. 自动公众号：AI 拟小编按世界观发文（独立开关+带封面概率） ---- */
  async function doArticle() {
    const ac = cfg();
    if (!ac.enabled || !ac.articleEnabled || !passed('article', ac.articleHours)) return false;
    markDone('article');
    try {
      const r = await API.genArticle({
        hint: '随机挑一个贴合世界观、普通人视角的日常主题（如本地探店攻略、生活技巧、热点话题），写一篇自然的中文公众号推文；不要硬扯角色，除非这个世界观里该事件确实被普通人知道。',
        meDesc: meDescText(),
      });
      if (!r || !r.title || !r.body) return true;
      let cover = '';
      const withImg = ac.articleImg !== false && Math.random() < (ac.articleImgChance != null ? ac.articleImgChance : 0.5);
      if (withImg) {
        try {
          const img = await API.genImage('公众号封面配图：' + r.title, { force: true });
          cover = (img && (img.url || img.image)) || '';
        } catch (e) {}
      }
      await API.publishArticle({ author: r.author || '', title: r.title, body: r.body, cover });
      return true;
    } catch (e) { return true; }
  }

  /* ---- 调度：每 CHECK_MS 检查，按优先级执行第一个到期行为（避免并发打爆模型） ---- */
  async function check() {
    try {
      const ac = cfg();
      if (!ac || !ac.enabled) return;
      const acts = [doPrivate, doGroup, doMoment, doArticle];
      for (const fn of acts) {
        if (await fn()) return;
      }
    } catch (e) {}
  }

  function init() {
    if (timer) return;
    timer = setInterval(() => { check(); }, CHECK_MS);
    setTimeout(() => { check(); }, 20000); // 启动后先检查一次（给页面初始化留时间）
  }

  return { init, check };
})();
