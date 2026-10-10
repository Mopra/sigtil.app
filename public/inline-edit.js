/*
 * sigtil inline text editing, loaded by a connected site only when it is shown
 * inside a frame. It does nothing until the sigtil editor around it switches
 * editing on. Then a click on a piece of plain text makes it editable in place,
 * and the old and new text go to the editor, which saves the change.
 *
 * Messages to and from the editor are plain objects with a `sigtil` field.
 */
(function () {
  if (window.self === window.top || window.__sigtilInline) return;
  window.__sigtilInline = true;

  var ACCENT = '#2e6b52';
  // Never editable in place: interactive elements and things that are not text.
  var SKIP = 'a,button,select,option,input,textarea,label,script,style,noscript,svg,code,pre,[contenteditable="true"],[contenteditable="plaintext-only"]';

  var parentOrigin = null;
  var on = false;
  var hovered = null;
  var editing = null; // { el, original }
  var pending = {}; // id -> { el, original }
  var seq = 0;

  var style = document.createElement('style');
  style.textContent =
    '[data-sigtil-hover]{outline:2px dashed ' + ACCENT + '!important;outline-offset:3px;cursor:text!important}' +
    '[data-sigtil-editing]{outline:2px solid ' + ACCENT + '!important;outline-offset:3px;cursor:text!important;caret-color:' + ACCENT + '}' +
    '[data-sigtil-saving]{outline:2px solid ' + ACCENT + '!important;outline-offset:3px;animation:sigtil-pulse 1s ease-in-out infinite}' +
    '[data-sigtil-saved]{outline:2px solid ' + ACCENT + '!important;outline-offset:3px;transition:outline-color .6s}' +
    '[data-sigtil-failed]{outline:2px solid #b42318!important;outline-offset:3px}' +
    '@keyframes sigtil-pulse{50%{outline-color:transparent}}';
  document.head.appendChild(style);

  // Until the editor has spoken, only the content-free "ready" goes out, to any origin.
  function send(msg) {
    window.parent.postMessage(msg, parentOrigin || '*');
  }

  function norm(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  /** The element under the pointer if it is plain text we can map back to the source, else null. */
  function editableFrom(target) {
    var el = target && target.nodeType === 3 ? target.parentElement : target;
    if (!el || !el.closest || el.closest(SKIP)) return null;
    if (el === document.body || el === document.documentElement) return null;
    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) {
        if (n.nodeValue.trim()) hasText = true;
      } else if (n.nodeType !== 8) {
        return null; // has child elements, e.g. a bold word or a link
      }
    }
    var text = norm(el.textContent || '');
    return hasText && text.length <= 2000 ? el : null;
  }

  function setHover(el) {
    if (hovered === el) return;
    if (hovered) hovered.removeAttribute('data-sigtil-hover');
    hovered = el;
    if (el && (!editing || editing.el !== el)) el.setAttribute('data-sigtil-hover', '');
  }

  function startEdit(el) {
    if (editing) finishEdit(true);
    setHover(null);
    editing = { el: el, original: el.textContent };
    try {
      el.contentEditable = 'plaintext-only';
    } catch (e) {
      el.contentEditable = 'true';
    }
    el.setAttribute('data-sigtil-editing', '');
    el.spellcheck = true;
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    el.addEventListener('paste', onPaste);
    send({ sigtil: 'editing', on: true });
  }

  /** End the edit in progress; `save` sends the change, otherwise the old text is put back. */
  function finishEdit(save) {
    if (!editing) return;
    var el = editing.el;
    var original = editing.original;
    editing = null;
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    el.removeEventListener('paste', onPaste);
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-sigtil-editing');
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    send({ sigtil: 'editing', on: false });

    var oldText = norm(original);
    var newText = norm(el.textContent || '');
    if (!save || !newText || newText === oldText) {
      el.textContent = original;
      return;
    }
    el.textContent = newText;
    var id = 'e' + ++seq;
    pending[id] = { el: el, original: original };
    el.setAttribute('data-sigtil-saving', '');
    send({
      sigtil: 'edit',
      id: id,
      oldText: oldText,
      newText: newText,
      path: location.pathname,
      lang: document.documentElement.lang || '',
    });
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finishEdit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(false);
    } else if (e.key === 'Enter') {
      e.preventDefault(); // one line of text: no line breaks
    }
  }

  function onBlur() {
    finishEdit(true);
  }

  function onPaste(e) {
    e.preventDefault();
    var text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
  }

  function onResult(msg) {
    var p = pending[msg.id];
    if (!p) return;
    delete pending[msg.id];
    var el = p.el;
    el.removeAttribute('data-sigtil-saving');
    var mark = msg.ok ? 'data-sigtil-saved' : 'data-sigtil-failed';
    if (!msg.ok) el.textContent = p.original;
    el.setAttribute(mark, '');
    setTimeout(function () {
      el.removeAttribute(mark);
    }, 1500);
  }

  function setMode(next) {
    on = next;
    if (!on) {
      setHover(null);
      finishEdit(true);
    }
  }

  document.addEventListener(
    'mouseover',
    function (e) {
      if (on) setHover(editableFrom(e.target));
    },
    true,
  );

  // While editing is on, clicks edit text instead of following links or opening menus.
  document.addEventListener(
    'click',
    function (e) {
      if (!on) return;
      if (editing && editing.el.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      var el = editableFrom(e.target);
      if (el) startEdit(el);
      else if (editing) finishEdit(true);
    },
    true,
  );

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var msg = e.data;
    if (!msg || typeof msg !== 'object' || typeof msg.sigtil !== 'string') return;
    parentOrigin = e.origin;
    if (msg.sigtil === 'hello') send({ sigtil: 'ready' });
    else if (msg.sigtil === 'mode') setMode(!!msg.on);
    else if (msg.sigtil === 'result') onResult(msg);
  });

  // Announce ourselves; the editor answers with the current mode.
  send({ sigtil: 'ready' });
})();
