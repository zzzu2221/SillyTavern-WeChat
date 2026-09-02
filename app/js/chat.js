/* ============ 聊天页 ============ */
const Chat = (() => {
  const ctx = { char: null, session: null, chat: [], busy: false };

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
      const bubbles = splitBubbles(m.mes);
      if (!bubbles.length) continue;
      const chatIndex = mi + 1; // ctx.chat 中实际下标（下标 0 是 meta）
      // 每条气泡独立成一行、各自带头像（仿微信连续发多条）
      for (const b of bubbles) {
        html += rowHtml(isUser, ctx.char, b, chatIndex);
      }
    }

    if (ctx.busy) {
      html += `<div class="msg-row ai typing"><div class="avatar">${charAvatarHtml(char)}</div><div class="msg-col"><div class="bubble">正在输入…</div></div></div>`;
    }
    if (!messages.length && !ctx.busy) {
      html = `<div class="msg-time">新会话开始啦，说点什么吧</div>`;
    }
    body.innerHTML = html;
    scrollBottom();
  }

  /** 生成一行消息：头像 + 单气泡（data-i 指向 ctx.chat 下标，供长按操作定位） */
  /** 清洗 AI 气泡中的动作/表情/心理描写（仅渲染层，存储保留原文）：
   *  句中括号动作整段删（“别哭了(递过纸巾)”→“别哭了”）；整条就是括号的去括号保留台词（“(撤回也没用哦)”→“撤回也没用哦”） */
  function stripActions(text) {
    let s = String(text || '');
    s = s.replace(/\*[^*]*\*/g, '');
    s = s.replace(/^[（(【\[]([^）)】\]]{1,30})[）)】\]]$/, '$1');
    s = s.replace(/[（(【\[]([^）)】\]]{1,20})[）)】\]]/g, '');
    return s.replace(/\s{2,}/g, ' ').trim();
  }
  window.stripActions = stripActions; // 供朋友圈等模块复用（清洗动作/心理括号）

  function rowHtml(isUser, char, text, chatIndex) {
    const avatar = isUser ? userAvatarHtml() : charAvatarHtml(char);
    const display = isUser ? text : stripActions(text);
    if (!display) return '';
    const safe = UI.esc(display).replace(/\n/g, '<br>');
    return `<div class="msg-row ${isUser ? 'user' : 'ai'}" data-i="${chatIndex}">${avatar}<div class="msg-col"><div class="bubble">${safe}</div></div></div>`;
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
    try {
      ctx.chat = await loadChat(character, session);
      render();
    } catch (e) {
      UI.toast('加载会话失败：' + e.message);
    }
  }

  /* ---- 构建模型上下文 ---- */
  function buildSystemPrompt() {
    const c = ctx.char;
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
    parts.push('【微信消息输出格式·必须遵守】我们在微信里聊天，真人聊天是「想到一句发一句」，只发说出口的话。当你的回复包含 2 个及以上独立的意思、转折或想分条强调的内容时，用「|||」分隔成多条消息逐条发出；每条消息为短句、口语化，通常一两句，最多三句。一个「|||」代表换一条新消息，前后不要加空格；「|||」只用于分隔消息，不要在普通句子里使用，更不要用换行、逗号、波浪线「～」等代替它。只有一句话能说完时不要硬拆。每条消息都要贴合你当前角色的性格和语气。绝对禁止：任何动作、表情、神态、心理描写或旁白，不要用括号、星号标注任何动作，只输出角色说出口的话。正确：哟～晚上好呀；错误：(摘下墨镜，笑了笑)哟～晚上好呀；错误：*笑了笑*晚上好。');
    return parts.join('\n');
  }

  function buildHistory() {
    const msgs = ctx.chat.slice(1).filter(m => !m.is_system);
    // 多气泡拆成独立消息，让模型学到"分多条发"的微信格式（避免学成换行 \n\n）
    const out = [];
    for (const m of msgs) {
      const content = String(m.mes || '').trim();
      if (!content) continue;
      if (m.is_user) out.push({ role: 'user', content });
      else {
        for (const b of splitBubbles(content)) out.push({ role: 'assistant', content: b });
      }
    }
    return out.slice(-24);
  }

  /* ---- 发送 / AI 请求 ---- */

  // 在途 AI 请求版本号：撤回/删除/重说时递增，使未完成的旧请求作废，避免残留/乱序
  let reqSeq = 0;

  /** 请求 AI 回复（send / 撤回 / 重说共用）；extraEvent 为附加的事件提示（作为 user 消息末尾追加，不进历史） */
  async function askAI(extraEvent) {
    const myReq = ++reqSeq;
    ctx.busy = true;
    render();
    try {
      await persistChat();
      const hist = buildHistory();
      if (extraEvent) hist.push({ role: 'user', content: extraEvent });
      const messages = [{ role: 'system', content: buildSystemPrompt() }, ...hist];
      const reply = await API.genChat(messages, { temperature: 0.9 });
      if (myReq !== reqSeq) return; // 已被撤回/删除/重说作废，不写入
      const content = (reply.content || '').trim();
      // 保存 AI 回复（保留 ||| 原始内容）
      ctx.chat.push({
        name: ctx.char.name,
        is_user: false,
        is_name: false,
        send_date: new Date().toISOString(),
        mes: content,
        extra: { api: 'wechat-h5', model: App.state.config?.chatModel || '' },
      });
      await persistChat();
      // 更新会话预览
      const preview = splitBubbles(content)[0] || '';
      Store.touchSession(App.charKey(ctx.char), ctx.char.name, ctx.session.file, { preview: preview.slice(0, 60), updatedAt: Date.now() });
      ctx.busy = false;
      const bubbles = splitBubbles(content);
      if (bubbles.length) {
        appendReplyBubbles(bubbles, ctx.chat.length - 1); // 逐条弹出
      } else {
        render();
      }
    } catch (e) {
      if (myReq !== reqSeq) return;
      UI.toast('回复失败：' + e.message);
      ctx.busy = false;
      render();
    }
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || ctx.busy) return;
    const input = document.getElementById('chat-input');
    input.value = '';
    autoResize(input);
    // 追加用户消息
    ctx.chat.push({
      name: 'user',
      is_user: true,
      is_name: true,
      send_date: new Date().toISOString(),
      mes: text,
    });
    await askAI();
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
    await askAI('（系统事件：对方刚刚悄悄撤回了自己发的一条消息，没有补发任何内容。你注意到了这个撤回。请用纯对话自然地回应，可以打趣、好奇，或者表示“我已经看到了哦”，一两句即可，符合你的性格。注意：只输出说出口的话，绝对不要写任何动作、表情、神态或心理描写。）');
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

  return { open, createSession, createGreetingSession, deleteSession, send, init };
})();
