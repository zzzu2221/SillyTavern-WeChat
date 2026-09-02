/* ============ 通讯录页 ============ */
const Contacts = (() => {
  function render() {
    const body = document.getElementById('contacts-body');
    const chars = App.state.characters;
    if (!chars.length) {
      body.innerHTML = `<div class="empty"><div class="big">👥</div>暂无角色卡<br><br>请确认酒馆已启动并已导入角色</div>`;
      return;
    }
    // 按名称拼音/字母排序（简单按 localeCompare）
    const sorted = chars.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
    const html = sorted.map(c => {
      const avatar = UI.avatarSrc(c.avatar) ? `<img src="${UI.esc(UI.avatarSrc(c.avatar))}">` : '';
      const key = App.charKey(c);
      return `<div class="list-item contact-item" data-key="${UI.esc(key)}">
        <div class="avatar">${avatar}</div>
        <div class="list-main"><div class="list-title">${UI.esc(App.displayName(c))}</div></div>
      </div>`;
    }).join('');
    body.innerHTML = `<div class="list">${html}</div>`;
    body.querySelectorAll('.contact-item').forEach(el => {
      el.addEventListener('click', () => {
        const c = App.charByKey(el.dataset.key);
        if (c) App.openCharacter(c);
      });
    });
  }
  return { render };
})();
