// Chat between a client and their agent. Used as a floating panel on the
// client's page and as an always-open box on the agent's sale page.
(function () {
  var root = document.getElementById('chat');
  if (!root) return;
  var url = root.dataset.url;
  var list = root.querySelector('.chatlist');
  var form = root.querySelector('form');
  var input = form.querySelector('textarea');
  var panel = root.querySelector('.chatpanel');
  var last = 0, timer = null;

  function add(m) {
    if (m.id <= last) return;
    last = m.id;
    var empty = list.querySelector('.empty');
    if (empty) empty.remove();
    var row = document.createElement('div');
    row.className = 'msg' + (m.mine ? ' mine' : '');
    var who = document.createElement('small');
    who.textContent = (m.mine ? 'You' : m.name) + ' · ' +
      new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    var text = document.createElement('p');
    text.textContent = m.body;
    row.append(who, text);
    list.append(row);
  }

  function load() {
    return fetch(url + '?after=' + last, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) {
        if (!d.messages.length) return;
        d.messages.forEach(add);
        list.scrollTop = list.scrollHeight;
      })
      .catch(function () {});
  }

  function start() {
    load();
    if (!timer) timer = setInterval(load, 8000);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = input.value.trim();
    if (!body) return;
    var button = form.querySelector('button');
    button.disabled = true;
    fetch(url, { method: 'POST', body: new URLSearchParams({ body: body }) })
      .then(function (r) { if (!r.ok) throw new Error(); input.value = ''; return load(); })
      .catch(function () { alert('Your message could not be sent. Please try again.'); })
      .then(function () { button.disabled = false; input.focus(); });
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  if (!panel) { start(); return; } // always-open version

  var opener = root.querySelector('.chatbtn');
  function setOpen(open) {
    panel.hidden = !open;
    opener.hidden = open;
    opener.setAttribute('aria-expanded', String(open));
    if (open) {
      var badge = opener.querySelector('.badge');
      if (badge) badge.remove();
      start();
      input.focus();
    } else {
      clearInterval(timer);
      timer = null;
    }
  }
  document.querySelectorAll('[data-chat-open]').forEach(function (b) { b.addEventListener('click', function () { setOpen(true); }); });
  root.querySelector('[data-chat-close]').addEventListener('click', function () { setOpen(false); opener.focus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });
})();
