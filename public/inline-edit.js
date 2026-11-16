/*
 * sigtil editing in place, loaded by a connected site only when it is shown
 * inside a frame. It does nothing until the sigtil editor around it switches
 * editing on. Then a click on a piece of plain text makes it editable in place,
 * and the old and new text go to the editor, which saves the change. Pointing
 * at a picture shows a button to replace it with one from the editor's device.
 * Links, buttons and menus keep working, so the editor can still move around.
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
  var pending = {}; // id -> { el, original } for a text, { el, restore } for a picture
  var seq = 0;
  var shownImg = null; // the picture the replace button belongs to
  var pickFor = null; // the picture a file is being picked for
  // Smaller pictures are icons and decoration, not something an editor swaps.
  var MIN_IMG = 60;

  var style = document.createElement('style');
  style.textContent =
    '[data-sigtil-hover]{outline:2px dashed ' + ACCENT + '!important;outline-offset:3px;cursor:text!important}' +
    '[data-sigtil-editing]{outline:2px solid ' + ACCENT + '!important;outline-offset:3px;cursor:text!important;caret-color:' + ACCENT + '}' +
    '[data-sigtil-saving]{outline:2px solid ' + ACCENT + '!important;outline-offset:3px;animation:sigtil-pulse 1s ease-in-out infinite}' +
    '[data-sigtil-saved]{outline:2px solid ' + ACCENT + '!important;outline-offset:3px;transition:outline-color .6s}' +
    '[data-sigtil-failed]{outline:2px solid #b42318!important;outline-offset:3px}' +
    '@keyframes sigtil-pulse{50%{outline-color:transparent}}' +
    '[data-sigtil-ui]{all:initial;position:fixed;z-index:2147483647;display:none;align-items:center;' +
    'padding:7px 13px;border-radius:999px;background:' + ACCENT + ';color:#fff;font:600 13px/1.2 system-ui,sans-serif;' +
    'cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3)}' +
    '[data-sigtil-ui]:hover{filter:brightness(1.12)}';
  document.head.appendChild(style);

  var imgButton = document.createElement('button');
  imgButton.type = 'button';
  imgButton.setAttribute('data-sigtil-ui', '');
  imgButton.textContent = 'Skift billede';
  var picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/*';
  picker.style.display = 'none';
  function mountUi() {
    document.body.appendChild(imgButton);
    document.body.appendChild(picker);
  }
  if (document.body) mountUi();
  else document.addEventListener('DOMContentLoaded', mountUi);

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

  /** The picture under a point, also when something lies on top of it (a gradient, a caption). */
  function imageAt(x, y) {
    var stack = document.elementsFromPoint(x, y);
    for (var i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (el === imgButton) return shownImg;
      if (el.tagName === 'IMG' && !el.hasAttribute('data-sigtil-saving')) {
        var r = el.getBoundingClientRect();
        if (r.width >= MIN_IMG && r.height >= MIN_IMG) return el;
      }
    }
    return null;
  }

  function showImageButton(img) {
    if (shownImg === img) return;
    shownImg = img;
    if (!img) {
      imgButton.style.display = 'none';
      return;
    }
    var r = img.getBoundingClientRect();
    imgButton.style.display = 'inline-flex';
    // Top left of the picture, kept inside the part of it that is on screen.
    imgButton.style.left = Math.max(8, r.left + 10) + 'px';
    imgButton.style.top = Math.max(8, r.top + 10) + 'px';
  }

  /** The path the site's files name the picture by, behind the image optimizer's address. */
  function imagePath(img) {
    try {
      var u = new URL(img.currentSrc || img.src, location.href);
      if (u.pathname === '/_next/image' && u.searchParams.get('url')) {
        u = new URL(u.searchParams.get('url'), location.href);
      }
      return u.origin === location.origin ? decodeURIComponent(u.pathname) : u.href;
    } catch (e) {
      return '';
    }
  }

  /** Show the picked picture at once and send it to the editor, which saves it. */
  function replaceImage(img, file) {
    var src = imagePath(img);
    var before = { src: img.getAttribute('src'), srcset: img.getAttribute('srcset'), sizes: img.getAttribute('sizes') };
    var shown = URL.createObjectURL(file);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.src = shown;
    img.setAttribute('data-sigtil-saving', '');
    var id = 'i' + ++seq;
    pending[id] = {
      el: img,
      restore: function () {
        if (before.srcset !== null) img.setAttribute('srcset', before.srcset);
        if (before.sizes !== null) img.setAttribute('sizes', before.sizes);
        if (before.src !== null) img.setAttribute('src', before.src);
        URL.revokeObjectURL(shown);
      },
    };
    send({ sigtil: 'image', id: id, src: src, alt: norm(img.alt || ''), file: file, path: location.pathname });
  }

  imgButton.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (!shownImg) return;
    pickFor = shownImg;
    picker.value = '';
    picker.click();
  });

  picker.addEventListener('change', function () {
    var file = picker.files && picker.files[0];
    var img = pickFor;
    pickFor = null;
    if (file && img && on && document.contains(img)) replaceImage(img, file);
  });

  function onResult(msg) {
    var p = pending[msg.id];
    if (!p) return;
    delete pending[msg.id];
    var el = p.el;
    el.removeAttribute('data-sigtil-saving');
    var mark = msg.ok ? 'data-sigtil-saved' : 'data-sigtil-failed';
    if (!msg.ok && p.restore) p.restore();
    else if (!msg.ok) el.textContent = p.original;
    el.setAttribute(mark, '');
    setTimeout(function () {
      el.removeAttribute(mark);
    }, 1500);
  }

  function setMode(next) {
    on = next;
    if (!on) {
      setHover(null);
      showImageButton(null);
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

  document.addEventListener(
    'mousemove',
    function (e) {
      if (on) showImageButton(imageAt(e.clientX, e.clientY));
    },
    true,
  );
  // The button sits at a fixed spot, so it would drift off its picture.
  window.addEventListener(
    'scroll',
    function () {
      showImageButton(null);
    },
    true,
  );

  // While editing is on, a click on plain text edits it. Everything else,
  // links, buttons and menus, works as on the live site.
  document.addEventListener(
    'click',
    function (e) {
      if (!on || e.target === imgButton) return;
      if (editing && editing.el.contains(e.target)) return;
      var el = editableFrom(e.target);
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        startEdit(el);
        return;
      }
      if (editing) finishEdit(true);
      // No pointer to hover with on a touch screen: a tap on a picture shows its button.
      showImageButton(imageAt(e.clientX, e.clientY));
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
