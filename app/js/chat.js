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
    for (const m of messages) {
      if (m.is_system) continue;
      const isUser = !!m.is_user;
      const t = m.send_date;
      const showTime = !lastTime || (t && Math.abs(new Date(t) - new Date(lastTime)) > 5 * 60 * 1000);
      if (showTime && t) html += `<div class="msg-time">${UI.fmtTime(t)}</div>`;
      lastTime = t || lastTime;

      const avatar = isUser ? userAvatarHtml() : charAvatarHtml(char);
      const bubbles = splitBubbles(m.mes).map(b =>
        `<div class="bubble">${UI.esc(b).replace(/\n/g, '<br>')}</div>`
      ).join('');
      html += `<div class="msg-row ${isUser ? 'user' : 'ai'}">
        ${avatar}
        <div class="msg-col">${bubbles || '<div class="bubble">…</div>'}</div>
      </div>`;
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
    return parts.join('\n');
  }

  function buildHistory() {
    const msgs = ctx.chat.slice(1).filter(m => !m.is_system);
    // 取最近 24 条
    const recent = msgs.slice(-24);
    const out = [];
    for (const m of recent) {
      const content = String(m.mes || '').replaceAll(MULTI_SEP, '\n\n').trim();
      if (!content) continue;
      if (m.is_user) out.push({ role: 'user', content });
      else out.push({ role: 'assistant', content });
    }
    return out;
  }

  /* ---- 发送 ---- */
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
    ctx.busy = true;
    render();
    try {
      await persistChat();
      // 构造消息
      const messages = [{ role: 'system', content: buildSystemPrompt() }, ...buildHistory()];
      const reply = await API.genChat(messages, { temperature: 0.9 });
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
    } catch (e) {
      UI.toast('回复失败：' + e.message);
      // 失败时把用户消息保留，但移除"正在输入"
    }
    ctx.busy = false;
    render();
  }

  /* ---- 输入框自适应 ---- */
  function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px';
  }

  /* ---- Emoji 表情面板 ---- */
  const EMOJIS = ['😀','😄','😁','😂','🤣','😊','😇','🙂','😉','😍','😘','😜','🤪','😎','🤓','🥳','😏','😳','🥺','😢','😭','😤','😡','🤯','😱','😴','🤗','🤔','🫡','👀','🙄','😬','🤐','😷','🤒','🥰','😋','🤭','🫣','✌️','👍','👎','👏','🙏','💪','🤝','👋','🖐️','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💯','✨','🔥','🎉','🎊','🌈','⭐','🍀','🌸','🌙','☀️','🍉','🍰','🍜','☕','🍺','🐱','🐶','🐰','🐻','🐼','🦊','🐷','🐸','🦄','🐉','💬','❓','❗','✅','❌','❗️','💤','🕐','🎮','📱','💻','🏀','⚽','🎵','🎤','🎨','🚀','🌹','🥀','🎁','🍬','🏆','🦋'];

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
  }

  return { open, createSession, createGreetingSession, deleteSession, send, init };
})();
