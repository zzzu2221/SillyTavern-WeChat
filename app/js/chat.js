/* ============ 聊天页 ============ */
const Chat = (() => {
  const ctx = { char: null, session: null, chat: [], busy: false };
  // 会话级"正在生成"标记：file -> 请求序号（作废旧请求时只清自己的标记）
  const pendingMap = {};

  const MULTI_SEP = '|||'; // 多气泡分隔标记

  /** 酒馆接口用的角色标识：优先原始文件名（avatar_file），退回 avatar */
  function avatarKey(c) { return (c && (c.avatar_file || c.avatar)) || ''; }

  /* ---- 会话文件操作 ---- */

  /** 新建会话：在酒馆创建一个新的聊天文件 */
  async function createSession(character) {
    const file = Store.newFileName(App.displayName(character));
    const meta = { chat_metadata: {}, user_name: 'unused', character_name: 'unused' };
    await API.saveChat(avatarKey(character), file, [meta]);
    const session = {
      file,
      title: '会话 ' + new Date().toLocaleString(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preview: '',
    };
    Store.addSession(App.charKey(character), character.name, session);
    return session;
  }

  /** 新建会话并以指定开场白作为第一条 AI 消息（用于多开场白角色） */
  async function createGreetingSession(character, greetingText, label) {
    const file = Store.newFileName(App.displayName(character));
    const meta = { chat_metadata: {}, user_name: 'unused', character_name: 'unused' };
    const greeting = String(greetingText || '').trim();
    const chat = [meta];
    if (greeting) {
      chat.push({ name: character.name, is_user: false, is_system: false, send_date: new Date().toISOString(), mes: greeting });
    }
    await API.saveChat(avatarKey(character), file, chat);
    const session = {
      file,
      title: label || '开场白会话 ' + new Date().toLocaleString(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preview: greeting ? greeting.slice(0, 40) : '',
    };
    Store.addSession(App.charKey(character), character.name, session);
    return session;
  }

  /** 删除会话：删酒馆聊天文件 + 本地记录 */
  async function deleteSession(character, session) {
    try {
      await API.deleteChat(avatarKey(character), session.file);
    } catch (e) { /* 酒馆文件删除失败也继续删本地记录 */ }
    Store.removeSession(App.charKey(character), character.name, session.file);
  }

  async function loadChat(character, session) {
    const chat = await API.getChat(avatarKey(character), session.file);
    return Array.isArray(chat) ? chat : [ { chat_metadata: {}, user_name: 'unused', character_name: 'unused' } ];
  }

  async function persistChat() {
    await API.saveChat(avatarKey(ctx.char), ctx.session.file, ctx.chat);
  }

  /** 后台写聊天文件：绑定具体会话（avatar/file/chat），不依赖"当前 ctx"（退出/切换会话后仍正确写回） */
  async function persistChatFor(avatar, file, chat) {
    await API.saveChat(avatar, file, chat);
  }

  /* ---- 渲染 ---- */

  function splitBubbles(text) {
    // 按 ||| 拆成多气泡；每个气泡内部保留普通换行
    const parts = String(text || '').split(MULTI_SEP);
    return parts.map(p => p.trim()).filter(p => p.length > 0);
  }

  function scrollBottom(force = false) {
    const body = document.getElementById('chat-body');
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  }

  function render() {
    const c = ctx.char;
    const body = document.getElementById('chat-body');
    applyBackground(c);
    const char = ctx.char;
    document.getElementById('chat-title').textContent = (typeof Detail !== 'undefined' && Detail.shownName) ? Detail.shownName(char) : App.displayName(char);

    const meta = ctx.chat[0];
    const messages = ctx.chat.slice(1);

    // 时间分组：简单按分钟
    let lastTime = null;
    let html = '';
    for (let mi = 0; mi < messages.length; mi++) {
      const m = messages[mi];
      if (m.is_system) {
        // 撤回提示（微信样式灰字）
        if (m.mes === 'recalled') html += `<div class="msg-time recall-tip">你撤回了一条消息</div>`;
        continue;
      }
      const isUser = !!m.is_user;
      const t = m.send_date;
      const showTime = !lastTime || (t && Math.abs(new Date(t) - new Date(lastTime)) > 5 * 60 * 1000);
      if (showTime && t) html += `<div class="msg-time">${UI.fmtTime(t)}</div>`;
      lastTime = t || lastTime;
      const chatIndex = mi + 1; // ctx.chat 中实际下标（下标 0 是 meta）
      // 转发卡片消息：单条卡片渲染，点击跳回原文
      if (m.extra && m.extra.card) {
        html += cardRowHtml(isUser, ctx.char, m, chatIndex);
        continue;
      }
      const bubbles = splitBubbles(m.mes);
      if (!bubbles.length) continue;
      // 每条气泡独立成一行、各自带头像（仿微信连续发多条）
      for (const b of bubbles) {
        html += rowHtml(isUser, ctx.char, b, chatIndex);
      }
    }

    if (ctx.session && pendingMap[ctx.session.file]) {
      html += `<div class="msg-row ai typing"><div class="avatar">${charAvatarHtml(char)}</div><div class="msg-col"><div class="bubble">正在输入…</div></div></div>`;
    }
    if (!messages.length && !(ctx.session && pendingMap[ctx.session.file])) {
      html = `<div class="msg-time">新会话开始啦，说点什么吧</div>`;
    }
    body.innerHTML = html;
    // 转发卡片点击：跳回原文（朋友圈 / 公众号）
    body.querySelectorAll('.chat-card').forEach(card => {
      card.addEventListener('click', () => openCard(card.dataset.cardType, card.dataset.cardId));
    });
    scrollBottom();
  }

  /** 转发卡片消息行（朋友圈 / 公众号分享到私信，微信式：独立卡片，左缩略图 + 右标题/来源，不套气泡） */
  function cardRowHtml(isUser, char, m, chatIndex) {
    const avatar = isUser ? userAvatarHtml() : charAvatarHtml(char);
    const card = (m.extra && m.extra.card) || {};
    const title = UI.esc(card.title || '');
    const source = UI.esc(card.source || '');
    const thumb = UI.esc(card.thumb || '');
    // 无图不配缩略图：微信转发卡片没有图时只显示右侧标题/来源
    const thumbHtml = thumb
      ? `<img src="${thumb}" onerror="this.style.display='none'"><span class="chat-card-thumb-fallback">${card.type === 'article' ? '📰' : '🌐'}</span>`
      : '';
    // 附带的话（微信转发：文字在上，卡片在下）
    const note = String(card.note || '').trim();
    const noteHtml = note ? `<div class="bubble${isUser ? ' green' : ''}">${UI.esc(note).replace(/\n/g, '<br>')}</div>` : '';
    return `<div class="msg-row ${isUser ? 'user' : 'ai'} card-msg" data-i="${chatIndex}">${avatar}
      <div class="msg-col">
        ${noteHtml}
        <div class="chat-card" data-card-type="${UI.esc(card.type || '')}" data-card-id="${UI.esc(card.id || '')}">
          ${thumbHtml ? `<div class="chat-card-thumb">${thumbHtml}</div>` : ''}
          <div class="chat-card-main">
            <div class="chat-card-title">${title}</div>
            <div class="chat-card-source">${source}</div>
          </div>
        </div>
      </div></div>`;
  }

  /** 卡片点击：跳回原文（朋友圈 / 公众号阅读页）；记录来源以便返回时回到聊天页 */
  function openCard(type, id) {
    if (!id) return;
    App.setBackHandler(() => {
      if (ctx.char && ctx.session) Chat.open(ctx.char, ctx.session);
      else App.showPage('page-chat', render);
    });
    if (type === 'article') {
      try { Articles.openReadById(id); } catch (e) { UI.toast('无法打开推文：' + (e && e.message)); }
    } else if (type === 'moment') {
      try { Moments.openPostDetail(id); } catch (e) { UI.toast('无法打开朋友圈：' + (e && e.message)); }
    }
  }

  /** 生成一行消息：头像 + 单气泡（data-i 指向 ctx.chat 下标，供长按操作定位） */
  /** 清洗 AI 气泡中的动作/表情/心理描写（仅渲染层，存储保留原文）：
   *  句中括号动作整段删（“别哭了(递过纸巾)”→“别哭了”）；整条就是括号的去括号保留台词（“(撤回也没用哦)”→“撤回也没用哦”） */
  function stripActions(text) {
    let s = String(text || '');
    // 剥离 AI 复读的存储标记前缀（“对应动态id=…;角色=…;评论=真实内容”→ 只留真实内容；聊天/分享场景兜底）
    const tag = s.match(/^(?:【?朋友圈评论】?)?[\s:：]*对应动态id=[^;]*;?(?:\s*角色=[^;]*;?)?(?:\s*key=[^;]*;?)?(?:\s*时间=[^;]*;?)?\s*评论=\s*/i);
    if (tag) s = s.slice(tag[0].length);
    else s = s.replace(/^对应动态id=[^;]*;?\s*/i, '');
    // 剥离朋友圈动态存储格式（角色=…;正文=…[;img=…] → 只留正文，去掉 img 生图提示词后缀）
    const dyn = s.match(/^(?:【?朋友圈动态】?)?[\s:：]*角色=[^;]*;\s*正文=\s*/i);
    if (dyn) s = s.slice(dyn[0].length).replace(/;img=[^;]*$/i, '').trim();
    s = s.replace(/\*[^*]*\*/g, '');
    // 整条都是括号（纯动作/表情/旁白）→ 丢弃不显示（AI 跑偏时防止刷屏动作）
    if (/^[（(【\[]+[^）)】\]]{1,60}[）)】\]]+$/.test(s.trim())) return '';
    s = s.replace(/[（(【\[]([^）)】\]]{1,40})[）)】\]]/g, '');
    return s.replace(/\s{2,}/g, ' ').trim();
  }
  window.stripActions = stripActions; // 供朋友圈等模块复用（清洗动作/心理括号）

  function rowHtml(isUser, char, text, chatIndex) {
    const avatar = isUser ? userAvatarHtml() : charAvatarHtml(char);
    const display = isUser ? text : stripActions(text);
    if (!display) return '';
    // 兼容历史消息里残留的 ||| 拆分：同一头像下渲染成多个气泡
    const parts = String(display).split(/\|{2,}/).map(p => p.trim()).filter(Boolean);
    const bubbles = (parts.length ? parts : [display]).map(p => `<div class="bubble">${UI.esc(p).replace(/\n/g, '<br>')}</div>`).join('');
    return `<div class="msg-row ${isUser ? 'user' : 'ai'}" data-i="${chatIndex}">${avatar}<div class="msg-col">${bubbles}</div></div>`;
  }

  /** AI 新回复逐条弹出（仿微信一条一条冒出来，每条带头像） */
  function appendReplyBubbles(bubbles, chatIndex) {
    const body = document.getElementById('chat-body');
    const typing = body.querySelector('.msg-row.typing');
    if (typing) typing.remove();
    let i = 0;
    function addOne() {
      if (i >= bubbles.length) return;
      const b = bubbles[i++];
      body.insertAdjacentHTML('beforeend', rowHtml(false, ctx.char, b, chatIndex));
      scrollBottom();
      if (i < bubbles.length) {
        // 随机间隔 + 按消息长度微调：短句快、长句慢，松弛有度（约 350~1500ms）
        const delay = Math.min(320 + b.length * 14 + Math.random() * 600, 1500);
        setTimeout(addOne, delay);
      }
    }
    addOne();
  }

  function userAvatarHtml() {
    const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
    const av = p && p.avatar && UI.avatarSrc(p.avatar) ? `<img src="${UI.esc(UI.avatarSrc(p.avatar))}">` : '';
    return `<div class="avatar">${av || '我'}</div>`;
  }
  function charAvatarHtml(char) {
    const a = UI.avatarSrc(char && char.avatar) ? `<img src="${UI.esc(UI.avatarSrc(char.avatar))}">` : '';
    return `<div class="avatar">${a}</div>`;
  }

  /* ---- 聊天背景（角色级优先，未设置则用全局） ---- */
  function applyBackground(char) {
    const body = document.getElementById('chat-body');
    if (!body) return;
    let bg = '';
    try {
      const s = API.getSettings() || {};
      const key = char ? App.charKey(char) : null;
      const note = (key && s.charNotes && s.charNotes[key]) || {};
      bg = note.chatBg || s.chatBg || '';
    } catch (e) {}
    if (!bg) {
      body.style.background = '';
      body.style.backgroundImage = '';
      return;
    }
    if (/^(#|rgb|hsl)/i.test(bg) || /^\d+,\d+,\d+/.test(bg)) {
      body.style.background = bg;
      body.style.backgroundImage = '';
    } else {
      body.style.background = 'none';
      body.style.backgroundImage = `url("${bg}")`;
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
      body.style.backgroundAttachment = 'fixed';
    }
  }

  /* ---- 打开会话 ---- */
  async function open(character, session) {
    ctx.char = character;
    ctx.session = session;
    ctx.busy = false;
    Store.setCurrent({ charKey: App.charKey(character), charName: App.displayName(character), file: session.file, title: session.title });
    App.showPage('page-chat', render);
    // 打开会话即已读，清掉未读红点
    Store.touchSession(App.charKey(character), App.displayName(character), session.file, { unread: 0 });
    if (typeof ChatList !== 'undefined' && ChatList.refreshTabBadge) ChatList.refreshTabBadge();
    try {
      ctx.chat = await loadChat(character, session);
      render();
    } catch (e) {
      UI.toast('加载会话失败：' + e.message);
    }
  }

  /* ---- 构建模型上下文 ---- */
  function buildSystemPrompt(char) {
    const c = char || ctx.char;
    const parts = [];
    // Player 身份（账号切换后这里随之变化）
    let player = null;
    try { player = (typeof Me !== 'undefined') ? Me.activePlayer() : null; } catch (e) {}
    if (player) {
      const rel = (player.relations || []).find(r => r.key === App.charKey(c));
      if (rel) {
        parts.push(`我和你的关系：${rel.relation}${rel.note ? '（' + rel.note + '）' : ''}`);
      }
      if (player.name && player.name !== '我') parts.push(`我是「${player.name}」。`);
      if (player.signature) parts.push(`我的个性签名：${player.signature}`);
      if (player.worldbook) parts.push(`关于我（世界书/设定）：${player.worldbook}`);
    }
    parts.push(`你是${c.name}。`);
    if (c.description) parts.push(`角色设定：${c.description}`);
    if (c.personality) parts.push(`性格：${c.personality}`);
    if (c.scenario) parts.push(`场景：${c.scenario}`);
    parts.push(`请始终以「${c.name}」的身份、第一人称与我对话，贴合设定，不要跳出角色。`);
    // 微信多气泡输出格式（兜底注入：不依赖酒馆世界书挂载，对所有角色生效）
    parts.push('【微信消息输出格式·必须遵守】我们在微信里聊天，真人聊天是「想到一句发一句」，只发说出口的话。当你的回复包含 2 个及以上独立的意思、转折或想分条强调的内容时，用「|||」分隔成多条消息逐条发出；每条消息为短句、口语化，通常一两句，最多三句。一个「|||」代表换一条新消息，前后不要加空格；「|||」只用于分隔消息，不要在普通句子里使用，更不要用换行、逗号、波浪线「～」等代替它。只有一句话能说完时不要硬拆。每条消息都要贴合你当前角色的性格和语气。绝对禁止：任何动作、表情、神态、心理描写或旁白，例如不要写「摘下墨镜笑了笑」、不要写「轻叹一声」、不要写「递过纸巾」这类描述，只输出角色说出口的话。正确示例：哟～晚上好呀。当对方只发来表情、一个问号或很短的追问时，要针对性地自然回应对方说的内容，绝对不要机械重复自己刚说过的话。');
    return parts.join('\n');
  }

  function buildHistory(chat) {
    const msgs = (chat || ctx.chat).slice(1).filter(m => !m.is_system);
    // 多气泡拆成独立消息，让模型学到"分多条发"的微信格式（避免学成换行 \n\n）
    const out = [];
    for (const m of msgs) {
      const content = String(m.mes || '').trim();
      if (!content) continue;
      if (m.is_user) {
        // 兼容历史里残留 |||：拆成多条 user 消息，让模型学到"分多条发"
        const ub = String(content).split(/\|{2,}/).map(p => p.trim()).filter(Boolean);
        (ub.length ? ub : [content]).forEach(b => out.push({ role: 'user', content: b }));
      }
      else {
        // 喂给模型的历史也按显示层清洗（剥括号/标记），避免模型从旧脏数据里学到错误格式
        const cleaned = stripActions(content);
        if (!cleaned) continue;
        for (const b of splitBubbles(cleaned)) out.push({ role: 'assistant', content: b });
      }
    }
    return out.slice(-24);
  }

  /* ---- 发送 / AI 请求 ---- */

  // 在途 AI 请求版本号：撤回/删除/重说时递增，使未完成的旧请求作废，避免残留/乱序
  let reqSeq = 0;

  /** 请求 AI 回复（send / 撤回 / 重说 / 后台分享共用）；extraEvent 为附加的事件提示（作为 user 消息末尾追加，不进历史）；opts 可指定目标会话（后台发送用，不依赖当前 ctx） */
  async function askAI(extraEvent, opts) {
    opts = opts || {};
    // 绑定本次请求对应的会话（不依赖"当前 ctx"：退出/切换会话后仍在后台加载，只把结果写回该会话）
    const myChar = opts.char || ctx.char;
    const myCharKey = opts.charKey || App.charKey(myChar);
    const myCharName = opts.charName || App.displayName(myChar);
    const myFile = opts.file || ctx.session.file;
    const myChat = opts.chat || ctx.chat;
    const myAvatar = opts.avatar || avatarKey(myChar);
    const isBg = !!opts.char;   // 后台请求（分享/推送）：独立并行，不参与 reqSeq 作废（否则并发互相作废只剩最后一个）
    const myReq = isBg ? -1 : ++reqSeq;
    pendingMap[myFile] = myReq;
    // 是否正打开该会话（决定弹气泡 + 未读）：仅当走"当前 ctx"且页面可见
    const viewing = !opts.char && ctx.session && ctx.session.file === myFile && isChatPageVisible();
    if (viewing) render(); // 显示"正在输入…"
    // 后台触发的回复（分享/主动推送）：按「AI 回复行为」配置延迟或选择性不回（当面聊天始终立即回）
    if (opts.char) {
      const ab = (App.state && App.state.config && App.state.config.aiBehavior) || null;
      if (ab) {
        if (ab.skipReply && Math.random() * 100 < (ab.skipRate || 0)) {
          if (pendingMap[myFile] === myReq) delete pendingMap[myFile];
          return; // 选择性不回：AI 不生成（消息已保留）
        }
        if (ab.delayReply) {
          const dmin = Math.max(0, (ab.delayMin || 30) * 1000);
          const dmax = Math.max(dmin, (ab.delayMax || 180) * 1000);
          await new Promise(r => setTimeout(r, dmin + Math.random() * (dmax - dmin)));
        }
      }
    }
    try {
      await persistChatFor(myAvatar, myFile, myChat);
      const hist = buildHistory(myChat);
      if (extraEvent) hist.push({ role: 'user', content: extraEvent });
      const messages = [{ role: 'system', content: buildSystemPrompt(myChar) }, ...hist];
      const reply = await API.genChat(messages, { temperature: 0.9 });
      if (!isBg && myReq !== reqSeq) { if (pendingMap[myFile] === myReq) delete pendingMap[myFile]; return; } // 已被撤回/删除/重说作废，不写入
      const content = (reply.content || '').trim();
      // 保存 AI 回复（保留 ||| 原始内容）
      myChat.push({
        name: myCharName,
        is_user: false,
        is_name: false,
        send_date: new Date().toISOString(),
        mes: content,
        extra: { api: 'wechat-h5', model: App.state.config?.chatModel || '' },
      });
      await persistChatFor(myAvatar, myFile, myChat);
      if (pendingMap[myFile] === myReq) delete pendingMap[myFile];
      // 私聊建群：AI 回复提到「拉群/建群 + 成员名」→ 真建群（AI 角色当群主）。受群活跃的 aiManage 开关控制
      maybeDmGroupCreate(content, myChar, myChat);
      // 未读计数：用户此刻正打开该会话且聊天页可见 → 不算未读；否则 +1
      const s = Store.sessionsOf(myCharKey, myCharName).find(x => x.file === myFile);
      const preview = stripActions(splitBubbles(content)[0] || '');
      Store.touchSession(myCharKey, myCharName, myFile, {
        preview: preview.slice(0, 60),
        updatedAt: Date.now(),
        unread: viewing ? 0 : ((s && s.unread) || 0) + 1,
      });
      // 若用户已退出该聊天页：实时刷新会话列表（未读红点 / 预览）
      if (!viewing && typeof ChatList !== 'undefined') ChatList.render();
      // 若当前正打开该会话 → 逐条弹出；否则只写回文件，回来时重新渲染
      if (viewing) {
        const bubbles = splitBubbles(content);
        if (bubbles.length) appendReplyBubbles(bubbles, myChat.length - 1);
        else render();
      }
    } catch (e) {
      if (!isBg && myReq !== reqSeq) { if (pendingMap[myFile] === myReq) delete pendingMap[myFile]; return; }
      if (pendingMap[myFile] === myReq) delete pendingMap[myFile];
      UI.toast('回复失败：' + e.message);
      if (ctx.session && ctx.session.file === myFile) { ctx.busy = false; render(); }
    }
  }

  /** 后台发送到指定角色私信（不切换页面）：写用户消息 + 触发 AI 后台生成 + 未读+1 */
  async function sendToCharBackground(char, session, text, extra) {
    if (!char || !session || !text) return;
    const avatar = avatarKey(char);
    const file = session.file;
    const chat = await loadChat(char, session);
    chat.push({
      name: 'user', is_user: true, is_name: true, send_date: new Date().toISOString(), mes: text,
      ...(extra ? { extra } : {}),
    });
    await persistChatFor(avatar, file, chat);
    const key = App.charKey(char);
    const name = App.displayName(char);
    const s = Store.sessionsOf(key, name).find(x => x.file === file);
    // 未读由 askAI 统一处理（生成回复后 +1；选择性不回则保持原样）；这里只刷新预览
    Store.touchSession(key, name, file, {
      preview: stripActions(splitBubbles(text)[0] || '').slice(0, 60),
      updatedAt: Date.now(),
    });
    if (typeof ChatList !== 'undefined') ChatList.render();
    askAI(null, { char, charKey: key, charName: name, file, chat, avatar });
  }

  /** 私聊建群：AI 回复提到「拉群/建群」→ 真建群（AI 角色当群主，玩家不用自己建）。受群活跃 aiManage 开关控制 */
  const dmGroupCooldown = {};
  async function maybeDmGroupCreate(text, char, recentMsgs) {
    try {
      const cfg = (App.state && App.state.config) || {};
      const ga = cfg.groupActive || {};
      if (!ga.aiManage) return;
      const ck = App.charKey(char);
      if (dmGroupCooldown[ck] && Date.now() - dmGroupCooldown[ck] < 60000) return;
      // 意图：拉群/建群/开群/组群 + 说"群名就叫XX"或"已经拉好"也算
      const intentRe = /拉.{0,10}(群|群聊)|建.{0,8}(群|群聊)|开.{0,8}(群|群聊)|组.{0,6}(个)?群|群名(就)?(是|叫|取|为)|拉好.{0,6}了|建好.{0,6}了|弄好.{0,6}了/;
      // 扫描范围：AI 回复 + 最近 10 条历史（玩家说"拉上五条和夏油"往往在更早的消息里）
      const hist = (recentMsgs || []).slice(-10).map(m => m.mes || '');
      const scan = [text, ...hist].join(' ');
      if (!intentRe.test(scan)) return;
      // 群名：AI 回复里「群名(就)叫「XXX」/群名叫XXX」（尽量取最新）
      let gname = '';
      const nms = [...String(text).matchAll(/群名(就)?(是|叫|取|为)?[「"“]?([^」"”\s，。！？]{2,14})/g)];
      if (nms.length) gname = nms[nms.length - 1][3].trim();
      // 成员：扫描文本里出现的通讯录角色名（支持 2 字简称，如「夏油」匹配「夏油杰」；排除 AI 自己）
      const aiKey = App.charKey(char);
      const aiName = App.displayName(char);
      const keys = [aiKey];
      for (const c of App.state.characters) {
        const k = App.charKey(c);
        if (k === aiKey) continue;
        // 候选名：备注名 / 角色名 / 各取前 2 字 / 4 字名取后 2 字
        const cands = new Set();
        const dn = App.displayName(c), rn = String(c.name || '').trim();
        for (const s of [dn, rn]) {
          if (s && s.length >= 2) cands.add(s);
          if (s && s.length > 2) cands.add(s.slice(0, 2));
          if (s && s.length === 4) cands.add(s.slice(2));
        }
        let hit = false;
        for (const cn of cands) { if (cn && scan.indexOf(cn) >= 0) { hit = true; break; } }
        if (hit && keys.length < 4) keys.push(k);
      }
      if (keys.length < 2) return; // 至少要 AI 自己 + 1 个成员
      if (!gname) gname = aiName + ' 的群';
      dmGroupCooldown[ck] = Date.now();
      // 玩家自动在群里（微信里玩家天然在群里）
      try {
        const p = (typeof Me !== 'undefined') ? Me.activePlayer() : null;
        const pk = p ? '__me__' + p.id : '';
        if (pk && keys.indexOf(pk) < 0) keys.push(pk);
      } catch (e) {}
      await API.createWeChatGroup(gname, keys, aiKey);
      UI.toast('「' + aiName + '」创建了群「' + gname + '」');
      if (typeof ChatList !== 'undefined' && ChatList.render) ChatList.render();
      if (typeof GroupChat !== 'undefined' && GroupChat.replyGroupBackground) {
        GroupChat.replyGroupBackground(gname, '这是一个刚建好的新群，你是群主。按你自己的性格随便开口说一句就行（不要客套，别说"请多关照"这类官话），其他成员自然回应。');
      }
    } catch (e) {}
  }

  /** 角色主动给玩家发私信（禁言/事件触发）：AI 生成角色口吻的一句话写进该角色会话并未读+1（玩家回复后自然延续） */
  async function sendCharMessageToPlayer(char, session, eventText) {
    if (!char || !session) return;
    const avatar = avatarKey(char);
    const file = session.file;
    const chat = await loadChat(char, session);
    const hist = buildHistory(chat).slice(-8);
    const name = App.displayName(char);
    const messages = [
      { role: 'system', content: buildSystemPrompt(char) },
      ...hist,
      { role: 'user', content: '（新事件：' + eventText + '）现在你是「' + name + '」，主动给玩家发一条微信消息，围绕这件事自然地说一句话（质问、吐槽、解释都行，符合你的性格）。只发说出口的话，口语化，不要动作/表情/心理描写，不要括号，不要解释自己。' },
    ];
    try {
      const reply = await API.genChat(messages, { temperature: 0.9, max_tokens: 200 });
      const content = stripActions(splitBubbles((reply.content || '').trim())[0] || '');
      if (!content) return;
      chat.push({
        name, is_user: false, is_name: false, send_date: new Date().toISOString(), mes: content,
        extra: { api: 'wechat-h5', model: App.state.config?.chatModel || '' },
      });
      await persistChatFor(avatar, file, chat);
      const key = App.charKey(char);
      const s = Store.sessionsOf(key, name).find(x => x.file === file);
      Store.touchSession(key, name, file, {
        preview: content.slice(0, 60),
        updatedAt: Date.now(),
        unread: ((s && s.unread) || 0) + 1,
      });
      if (typeof ChatList !== 'undefined' && ChatList.render) ChatList.render();
    } catch (e) { /* 生成失败静默 */ }
  }

  function isChatPageVisible() {
    const p = document.getElementById('page-chat');
    return p && p.style.display !== 'none';
  }

  async function send(text, extra) {
    text = (text || '').trim();
    if (!text) return;
    if (ctx.busy || (ctx.session && pendingMap[ctx.session.file])) {
      UI.toast('AI 还在回复中，稍等一下');
      return;
    }
    const input = document.getElementById('chat-input');
    input.value = '';
    autoResize(input);
    // 追加用户消息（extra 用于卡片转发等元数据）；支持用 || 或 ||| 拆成多条连发（模拟微信发多条）
    const parts = String(text).split(/\|{2,}/).map(p => p.trim()).filter(Boolean);
    (parts.length ? parts : [text]).forEach((part, i) => {
      ctx.chat.push({
        name: 'user',
        is_user: true,
        is_name: true,
        send_date: new Date().toISOString(),
        mes: part,
        ...(extra && i === 0 ? { extra } : {}),
      });
    });
    // 不 await：发出后即可退出聊天页，AI 在后台加载
    askAI();
  }

  /* ---- 输入框自适应 ---- */
  function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px';
  }

  /* ---- 长按消息：撤回 / 删除 / 重说 ---- */

  function bindLongPress() {
    const body = document.getElementById('chat-body');
    let timer = null, rowEl = null, sx = 0, sy = 0;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };

    body.addEventListener('pointerdown', e => {
      const row = e.target.closest('.msg-row');
      if (!row || row.classList.contains('typing')) return;
      rowEl = row; sx = e.clientX; sy = e.clientY;
      timer = setTimeout(() => { timer = null; if (rowEl && rowEl.isConnected) openMsgMenu(rowEl); }, 600);
    });
    body.addEventListener('pointermove', e => {
      if (!timer || !rowEl) return;
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clear();
    });
    body.addEventListener('pointerup', clear);
    body.addEventListener('pointercancel', clear);
    // 电脑端右键也打开菜单
    body.addEventListener('contextmenu', e => {
      const row = e.target.closest('.msg-row');
      if (row) { e.preventDefault(); openMsgMenu(row); }
    });
  }

  function openMsgMenu(rowEl) {
    const chatIndex = Number(rowEl.dataset.i);
    const m = ctx.chat[chatIndex];
    if (!m || !Number.isFinite(chatIndex)) return;
    const isUser = !!m.is_user;
    const items = [];
    if (isUser) items.push({ label: '撤回', danger: false, fn: () => recallMsg(chatIndex) });
    items.push({ label: '删除', danger: true, fn: () => deleteMsg(chatIndex) });
    if (!isUser) items.push({ label: '重说', danger: false, fn: () => resayMsg(chatIndex) });
    items.push({ label: '取消', danger: false, cancel: true, fn: null });
    showActionSheet(items);
  }

  function showActionSheet(items) {
    const old = document.getElementById('wxst-actions');
    if (old) old.remove();
    const mask = document.createElement('div');
    mask.id = 'wxst-actions';
    mask.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:99999999;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;';
    mask.innerHTML = '<div class="msg-actions">' + items.map(it =>
      `<div class="msg-action${it.danger ? ' danger' : ''}${it.cancel ? ' cancel' : ''}" data-a="${UI.esc(it.label)}">${UI.esc(it.label)}</div>`).join('') + '</div>';
    // 挂 documentElement（与微信 overlay 同级，绕开手机 body transform 层叠问题）
    (document.documentElement || document.body).appendChild(mask);
    mask.addEventListener('click', e => {
      if (e.target === mask) { mask.remove(); return; }
      const el = e.target.closest('.msg-action');
      if (!el) return;
      const it = items.find(x => x.label === el.dataset.a);
      mask.remove();
      if (it && it.fn) it.fn();
    });
  }

  /** 撤回：移除用户消息 + 紧随其后的 AI 接话 + 显示撤回提示 + 触发 AI 反应 */
  async function recallMsg(chatIndex) {
    reqSeq++; // 作废所有在途 AI 请求，防止撤回后旧回复残留
    const m = ctx.chat[chatIndex];
    if (!m || !m.is_user) return;
    // 一并删除紧随其后的 AI 接话（针对该消息的回复），避免撤回后残留"对着空气说话"
    let end = chatIndex + 1;
    while (end < ctx.chat.length) {
      const nm = ctx.chat[end];
      if (nm.is_system || nm.is_user) break;
      end++;
    }
    ctx.chat.splice(chatIndex, end - chatIndex, { name: 'system', is_user: false, is_system: true, send_date: new Date().toISOString(), mes: 'recalled' });
    await persistChat();
    render();
    await askAI('对方刚刚悄悄撤回了自己发的一条消息，没有补发任何内容。你注意到了这个撤回，自然地回应一句即可，可以打趣、好奇，或者表示我已经看到了哦。只用说出口的话，绝对不要括号、动作、表情、神态或心理描写。如果想说两三句，就按微信消息格式用「|||」分隔成多条。');
  }

  /** 删除：移除该条消息 */
  async function deleteMsg(chatIndex) {
    reqSeq++; // 作废在途请求
    const m = ctx.chat[chatIndex];
    if (!m) return;
    ctx.chat.splice(chatIndex, 1);
    await persistChat();
    render();
  }

  /** 重说：从该条 AI 回复起截断并重新生成 */
  async function resayMsg(chatIndex) {
    reqSeq++; // 作废在途请求
    const m = ctx.chat[chatIndex];
    if (!m || m.is_user) return;
    ctx.chat.splice(chatIndex);
    await persistChat();
    await askAI();
  }

  /* ---- Emoji 表情面板 ---- */
  const EMOJIS = ['😀','😄','😁','😂','🤣','😊','😇','🙂','😉','😍','😘','😜','🤪','😎','🤓','🥳','😏','😳','🥺','😢','😭','😤','😡','🤯','😱','😴','🤗','🤔','🫡','👀','🙄','😬','🤐','😷','🤒','🥰','😋','🤭','🫣','✌️','👍','👎','👏','🙏','💪','🤝','👋','🖐️','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💯','✨','🔥','🎉','🎊','🌈','⭐','🍀','🌸','🌙','☀️','🍉','🍰','🍜','☕','🍺','🐱','🐶','🐰','🐻','🐼','🦊','🐷','🐸','🦄','🐉','🙈','🙉','🙊','💬','❓','❗','✅','❌','❗️','💤','🕐','🎮','📱','💻','🏀','⚽','🎵','🎤','🎨','🚀','🌹','🥀','🎁','🍬','🏆','🦋'];

  function buildEmojiPanel() {
    const panel = document.getElementById('emoji-panel');
    if (!panel || panel.childNodes.length) return;
    panel.innerHTML = EMOJIS.map(e => `<span class="emoji-item" data-e="${UI.esc(e)}">${e}</span>`).join('');
    panel.querySelectorAll('.emoji-item').forEach(el => {
      el.addEventListener('click', () => insertEmoji(el.dataset.e));
    });
  }

  function insertEmoji(emoji) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const s = input.selectionStart ?? input.value.length;
    const e = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, s) + emoji + input.value.slice(e);
    input.focus();
    autoResize(input);
    // 光标移到插入后
    try { const p = s + emoji.length; input.setSelectionRange(p, p); } catch (err) {}
    document.getElementById('emoji-panel').classList.remove('open');
  }

  /* ---- 事件绑定 ---- */
  function init() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');

    input.addEventListener('input', () => autoResize(input));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send(input.value);
      }
    });
    sendBtn.addEventListener('click', () => send(input.value));

    // Emoji 面板
    const emojiBtn = document.getElementById('btn-emoji');
    const emojiPanel = document.getElementById('emoji-panel');
    buildEmojiPanel();
    emojiBtn.addEventListener('click', e => {
      e.stopPropagation();
      emojiPanel.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (emojiPanel.classList.contains('open') && !emojiPanel.contains(e.target) && e.target.id !== 'btn-emoji') {
        emojiPanel.classList.remove('open');
      }
    });

    document.getElementById('btn-chat-back').addEventListener('click', () => {
      Store.clearCurrent();
      App.showTab('chatlist');
    });
    // 顶部角色名 / ⋯ → 详情
    const toDetail = () => {
      if (!ctx.char) return;
      Detail.open(ctx.char);
    };
    document.getElementById('chat-title').addEventListener('click', toDetail);
    document.getElementById('btn-chat-detail').addEventListener('click', toDetail);

    // 长按消息操作（撤回 / 删除 / 重说）
    bindLongPress();
  }

  return { open, createSession, createGreetingSession, deleteSession, send, sendToCharBackground, sendCharMessageToPlayer, init };
})();
