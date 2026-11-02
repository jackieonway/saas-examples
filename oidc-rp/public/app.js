let session;
const element = id => document.getElementById(id);
const messages = {
  CSRF_REJECTED: '会话校验失败，请重新打开页面。', LOGIN_REQUIRED: '请重新登录。', SESSION_REQUIRED: '会话已结束，请重新打开页面。',
  OIDC_REQUEST_REJECTED: '认证请求被拒绝，请重新登录。', OPERATION_PENDING: '已有操作正在处理，请稍后查询原操作。',
  UPSTREAM_UNAVAILABLE: '认证中心暂不可达。本地会话已按失败关闭处理，请检查状态。', LOGOUT_RESULT_UNKNOWN: '登出结果暂不确定，请查询原操作。',
};
async function request(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw new Error(messages[value.code] ?? '操作未完成，请检查会话或重新登录。');
  return value;
}
async function update() {
  session = await request('/api/session');
  element('status').textContent = session.authenticated ? '身份已验证' : '尚未登录';
  element('status-dot').classList.toggle('active', session.authenticated);
  element('identity').hidden = !session.authenticated; element('empty').hidden = session.authenticated;
  element('login').hidden = session.authenticated || session.pendingLogout;
  for (const name of ['userinfo', 'revoke']) element(name).hidden = !session.authenticated;
  element('extension').hidden = !session.authenticated || !session.logoutExtensionAvailable;
  element('refresh').hidden = !session.authenticated || !session.hasRefreshToken;
  element('recover').hidden = !session.pendingLogout;
  if (session.identity) {
    element('display-name').textContent = session.identity.displayName || '统一账号';
    element('issuer').textContent = session.identity.issuer; element('subject').textContent = session.identity.subject;
    element('expires').textContent = new Date(session.expiresAt).toLocaleTimeString();
  }
}
function action(id, callback) {
  element(id).addEventListener('click', async () => {
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    element('message').textContent = '';
    try { await callback(); await update(); }
    catch (error) { element('message').textContent = error.message; await update().catch(() => {}); }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  });
}
action('login', async () => { const value = await request('/auth/login', {}); location.assign(value.authorizationUrl); });
action('userinfo', async () => { await request('/api/userinfo'); element('message').textContent = '身份与当前授权已重新验证。'; });
action('refresh', async () => { await request('/auth/refresh', {}); element('message').textContent = '授权已轮换，本地会话截止保持不变。'; });
action('revoke', async () => { await request('/auth/revoke', {}); element('message').textContent = '令牌已撤销，本地会话已结束。'; });
action('current', async () => { await request('/auth/logout', { scope: 'CURRENT_APP' }); element('message').textContent = '当前应用已退出。'; });
action('global', async () => { await request('/auth/logout', { scope: 'GLOBAL' }); element('message').textContent = '认证中心已完成全局退出。'; });
action('recover', async () => { await request('/auth/logout/recover', {}); element('message').textContent = '原登出操作已确认完成。'; });
update().catch(() => { element('status').textContent = '暂时无法连接'; element('message').textContent = '请稍后重新打开页面。'; });
