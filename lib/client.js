/* eslint-disable */
// dsh-bili-sessions —— 客户端半边
//
// 形制参照 dsh-restart-now：入口落在 sidebar.panellist（侧栏左上角整行）与 main
// （点击后切过去的主区面板），两者必须成对存在 —— selectPanel(id) 找不到 key 会抛错。
//
// 颜色只用 --dsw-alias-* token；类名统一 bs- 前缀，避免和宿主样式打架。
window.__ModuleLoader__.load({
  id: 'dsh-bili-sessions',
  factory(require) {
    var React = require('react');
    var h = React.createElement;

    var API_STATE = '/plugins/dsh-bili-sessions/state';
    var API_LIST = '/plugins/dsh-bili-sessions/list';
    var API_DELETE = '/plugins/dsh-bili-sessions/delete';
    var API_PURGE = '/plugins/dsh-bili-sessions/purge';
    var PANEL_ID = 'dsh-bili-sessions';

    // ---- 工具 -------------------------------------------------------------

    function formatBytes(n) {
      if (!n || n < 0) return '0 B';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(2) + ' MB';
      return (n / 1073741824).toFixed(2) + ' GB';
    }

    function formatTime(ms) {
      if (!ms) return '—';
      var d = new Date(ms);
      if (isNaN(d.getTime())) return '—';
      var pad = function (v) { return v < 10 ? '0' + v : String(v); };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function relativeTime(ms) {
      if (!ms) return '';
      var diff = Date.now() - ms;
      if (diff < 0) return '';
      var minute = 60000, hour = 3600000, day = 86400000;
      if (diff < minute) return '刚刚';
      if (diff < hour) return Math.floor(diff / minute) + ' 分钟前';
      if (diff < day) return Math.floor(diff / hour) + ' 小时前';
      if (diff < day * 30) return Math.floor(diff / day) + ' 天前';
      return '';
    }

    function shortId(id) {
      if (!id) return '';
      var m = /^session-([0-9a-f]{8})/.exec(id);
      return m ? m[1] : id;
    }

    // 后端错误码 -> 用户能看懂的一句话。丢原始码不是怕它难看，是它没法指导下一步。
    var ERROR_HINTS = {
      'cli-not-found': '找不到 billion-context，请确认它已装在本 profile 里',
      'cli-failed': 'billion-context 的命令行执行失败',
      'unparsable-output': '命令行返回的内容无法解析',
      'no-ids': '没有选中任何会话',
      'bad-json': '请求格式错误',
      'method-not-allowed': '请求方法不正确',
    };

    function explainError(code, payload) {
      var hint = ERROR_HINTS[code];
      if (!hint) return code || '未知错误';
      var detail = payload && payload.stderr ? String(payload.stderr).trim().slice(-300) : '';
      return detail ? hint + '：' + detail : hint;
    }

    function requestJson(url, options) {
      var opts = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {});
      return fetch(url, opts).catch(function () {
        // fetch 本身 reject 时没有 response，抛的是 TypeError: Failed to fetch
        throw new Error('无法连接本地服务，请确认 DSH 仍在运行');
      }).then(function (response) {
        return response.text().then(function (text) {
          var parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
          if (!response.ok) {
            var message = explainError(parsed && parsed.error, parsed);
            var err = new Error(message);
            err.payload = parsed;
            throw err;
          }
          return parsed;
        });
      });
    }

    // ---- 样式 -------------------------------------------------------------
    // 只引用宿主主题 token，跟随明暗切换。

    var STYLE_ID = 'dsh-bili-sessions-style';
    var STYLE_RULES = [
      '.bs-root{display:flex;flex-direction:column;gap:14px;padding:20px 24px;height:100%;',
      'box-sizing:border-box;color:inherit;',
      'background:var(--dsw-alias-bg-base,transparent);',
      'font-family:inherit;font-size:13px;overflow:hidden;}',
      '.bs-head{display:flex;flex-direction:column;gap:4px;}',
      '.bs-title{font-size:16px;font-weight:600;line-height:1.4;}',
      '.bs-sub{font-size:12px;color:var(--dsw-alias-label-secondary,inherit);line-height:1.5;}',
      '.bs-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.bs-spacer{flex:1 1 auto;}',
      '.bs-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));',
      'background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;border-radius:6px;',
      'padding:5px 12px;font-size:12px;line-height:1.6;cursor:pointer;font-family:inherit;',
      'transition:background .12s ease,border-color .12s ease;}',
      '.bs-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l4,rgba(0,0,0,.32));}',
      '.bs-btn:disabled{opacity:.45;cursor:not-allowed;}',
      '.bs-btn-primary{background:var(--dsw-alias-button-primary-fill,#2a6df4);border-color:transparent;',
      'color:var(--dsw-alias-label-on-color,#fff);}',
      '.bs-btn-primary:hover:not(:disabled){filter:brightness(1.06);}',
      '.bs-btn-danger{color:var(--dsw-alias-state-error-primary,#c9342b);',
      'border-color:var(--dsw-alias-state-error-primary,#c9342b);}',
      '.bs-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(201,52,43,.09));}',
      '.bs-btn-danger.bs-armed{background:var(--dsw-alias-state-error-primary,#c9342b);border-color:transparent;color:#fff;}',
      '.bs-list{flex:1 1 auto;overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
      'border-radius:8px;min-height:120px;}',
      '.bs-row{display:flex;align-items:center;gap:10px;padding:9px 12px;',
      'border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));}',
      '.bs-row:last-child{border-bottom:none;}',
      '.bs-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.03));}',
      '.bs-row{cursor:pointer;}',
      '.bs-row-locked{cursor:default;opacity:.72;}',
      '.bs-row-locked:hover{background:transparent;}',
      '.bs-row-check{width:15px;height:15px;flex:0 0 auto;cursor:pointer;accent-color:var(--dsw-alias-button-primary-fill,#2a6df4);}',
      '.bs-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px;}',
      '.bs-row-title{display:flex;align-items:center;gap:6px;min-width:0;}',
      '.bs-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;',
      'font-weight:500;line-height:1.45;}',
      '.bs-row-nameless{font-weight:400;color:var(--dsw-alias-label-secondary,inherit);}',
      '.bs-row-first{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,inherit);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.bs-row-meta{font-size:11px;color:var(--dsw-alias-label-secondary,inherit);',
      'display:flex;gap:10px;flex-wrap:wrap;}',
      '.bs-tag{flex:0 0 auto;font-size:10px;line-height:1.6;padding:0 6px;border-radius:9px;',
      'border:1px solid var(--dsw-alias-state-success-primary,#1f883d);color:var(--dsw-alias-state-success-primary,#1f883d);}',
      '.bs-tag-lock{border-color:var(--dsw-alias-state-warn-primary,#bf8700);',
      'color:var(--dsw-alias-state-warn-label,#8a6100);}',
      '.bs-empty{padding:32px 16px;text-align:center;font-size:12px;',
      'color:var(--dsw-alias-label-secondary,inherit);}',
      '.bs-warn{padding:9px 12px;border-radius:6px;font-size:12px;line-height:1.6;',
      'background:var(--dsw-alias-state-warn-tertiary,rgba(191,135,0,.12));',
      'color:var(--dsw-alias-state-warn-label,#8a6100);}',
      '.bs-msg{padding:9px 12px;border-radius:6px;font-size:12px;line-height:1.6;}',
      '.bs-msg-err{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(201,52,43,.09));',
      'color:var(--dsw-alias-state-error-primary,#c9342b);}',
      '.bs-msg-ok{background:var(--dsw-alias-state-success-secondary,rgba(31,136,61,.09));',
      'color:var(--dsw-alias-state-success-primary,#1f883d);}',
      '.bs-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;}',
      '.bs-glyph{display:block;pointer-events:none;}',
    ].join('');

    function mountStyle(doc) {
      if (!doc) return function () {};
      // 已存在就覆盖内容而不是直接返回：插件热重载后旧 <style> 还挂在页面里，
      // 直接 return 会让新样式永远不生效，改半天还是老样子。
      var existing = doc.getElementById(STYLE_ID);
      if (existing) {
        if (existing.textContent !== STYLE_RULES) existing.textContent = STYLE_RULES;
        return function () {};
      }
      var style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLE_RULES;
      (doc.head || doc.documentElement).appendChild(style);
      // 交还给 ctx.effect 的清理函数：插件被禁用时样式一起下去，不留残渣
      return function unmountStyle() {
        try {
          if (style.parentNode) style.parentNode.removeChild(style);
        } catch (e) { /* 页已卸载 */ }
      };
    }

    // ---- 组件 -------------------------------------------------------------

    function Glyph(props) {
      var size = props && typeof props.size === 'number' ? props.size : 16;
      return h('svg', {
        viewBox: '0 0 64 64', width: size, height: size, className: 'bs-glyph',
        'aria-hidden': true, focusable: 'false',
      },
        h('rect', { x: 6, y: 8, width: 26, height: 9, rx: 2.5, fill: 'currentColor', opacity: 0.9 }),
        h('rect', { x: 6, y: 22, width: 26, height: 9, rx: 2.5, fill: 'currentColor', opacity: 0.62 }),
        h('rect', { x: 6, y: 36, width: 17, height: 9, rx: 2.5, fill: 'currentColor', opacity: 0.4 }),
        h('path', { d: 'M40 12h18M40 20h18M40 28h11', stroke: 'currentColor', strokeWidth: 3.2, strokeLinecap: 'round', opacity: 0.5 }),
        h('path', { d: 'M42 44l9 9M51 44l-9 9', stroke: 'currentColor', strokeWidth: 4, strokeLinecap: 'round' }),
      );
    }

    function Row(props) {
      var s = props.session;
      var checked = props.checked;
      var onToggle = props.onToggle;
      var locked = s.live && props.keepLive;
      var title = s.title || '';
      var firstMessage = s.firstMessage || '';
      // 首句和标题内容重复时不重复展示；用前缀判断，别用长度比 —— 标题比首句长时
      // 首句会被整个丢掉，而那往往才是人真正需要的信息
      var head = firstMessage.slice(0, 12);
      var showFirstMessage = firstMessage && firstMessage !== title
        && !(head && title.indexOf(head) === 0);
      // 整行可点：15px 的复选框当热区，长列表里一路点下去必然点错行
      var onRowClick = function () { if (!locked) onToggle(s.id); };
      return h('div', {
        className: 'bs-row' + (locked ? ' bs-row-locked' : ''),
        onClick: onRowClick,
        title: locked ? '正在使用的会话受保护，关掉「保护正在使用的会话」才能删' : '',
      },
        h('input', {
          type: 'checkbox',
          className: 'bs-row-check',
          checked: checked,
          disabled: locked,
          onChange: function (e) { e.stopPropagation(); onToggle(s.id); },
        }),
        h('div', { className: 'bs-row-main' },
          h('div', { className: 'bs-row-title' },
            title
              ? h('span', { className: 'bs-row-name', title: title }, title)
              : h('span', { className: 'bs-row-name bs-row-nameless', title: s.id }, '（无标题会话）'),
            // 锁住时不能只靠 title 属性：disabled 元素点了毫无反应，用户只能猜
            locked
              ? h('span', { className: 'bs-tag bs-tag-lock' }, '使用中 · 受保护')
              : null,
          ),
          showFirstMessage
            ? h('div', { className: 'bs-row-first', title: firstMessage }, firstMessage)
            : null,
          h('div', { className: 'bs-row-meta' },
            h('span', { className: 'bs-mono' }, shortId(s.id)),
            h('span', null, formatBytes(s.sizeBytes)),
            h('span', null, formatTime(s.lastUpdated) + (relativeTime(s.lastUpdated) ? ' · ' + relativeTime(s.lastUpdated) : '')),
            s.blocksCount ? h('span', null, s.blocksCount + ' 块') : null,
            s.model ? h('span', null, s.model) : null,
          ),
        ),
      );
    }

    function Panel() {
      var state = React.useState({ phase: 'loading', env: null, sessions: [], error: null });
      var view = state[0];
      var setView = state[1];
      var sel = React.useState({});
      var selected = sel[0];
      var setSelected = sel[1];
      var guard = React.useState(true);
      var keepLive = guard[0];
      var setKeepLive = guard[1];
      var busy = React.useState(false);
      var isBusy = busy[0];
      var setBusy = busy[1];
      var note = React.useState(null);
      var message = note[0];
      var setMessage = note[1];
      // 两击式确认必须各管各的：共用一个 armed 会让"删除选中"把"清空全部"也点亮，
      // 用户第二下点到另一个按钮就会删错东西。
      var armDel = React.useState(false);
      var armedDelete = armDel[0];
      var setArmedDelete = armDel[1];
      var armPurge = React.useState(false);
      var armedPurge = armPurge[0];
      var setArmedPurge = armPurge[1];
      var disarmAll = function () { setArmedDelete(false); setArmedPurge(false); };
      // 选择变了就必须重新确认：确认的是"这一批"，不是"删除"这个动作
      React.useEffect(function () { disarmAll(); }, [selected]);
      // 确认态 8 秒后自动解除：点了一次走开再回来，不该一点就删
      React.useEffect(function () {
        if (!armedDelete && !armedPurge) return undefined;
        var timer = setTimeout(disarmAll, 8000);
        return function () { clearTimeout(timer); };
      }, [armedDelete, armedPurge]);

      // 请求序号：连点刷新时只让最后一次的结果落地，先发后返不覆盖新数据
      var seq = React.useRef(0);
      var load = React.useCallback(function () {
        seq.current += 1;
        var mine = seq.current;
        setMessage(null); // 旧提示不该跨次刷新继续挂着
        setView(function (prev) { return Object.assign({}, prev, { phase: 'loading', error: null }); });
        return Promise.all([requestJson(API_STATE), requestJson(API_LIST)])
          .then(function (results) {
            if (mine !== seq.current) return;
            var env = results[0];
            var list = results[1];
            setView({
              phase: 'ready', env: env, sessions: list.sessions || [], error: null,
              // proxyReachable=false 意味着 live 标记不可信 —— 「保护正在使用的会话」
              // 这个时候形同虚设，必须让用户看见，否则最该防的事故正好被这个开关放行。
              proxyReachable: list.proxyReachable !== false,
            });
            setSelected(function (prev) {
              var next = {};
              (list.sessions || []).forEach(function (s) { if (prev[s.id]) next[s.id] = true; });
              return next;
            });
          })
          .catch(function (err) {
            if (mine !== seq.current) return;
            setView({ phase: 'error', env: null, sessions: [], error: err.message });
          });
      }, []);

      React.useEffect(function () { load(); }, [load]);

      var selectedIds = Object.keys(selected).filter(function (id) { return selected[id]; });
      var totalBytes = view.sessions.reduce(function (sum, s) { return sum + (s.sizeBytes || 0); }, 0);
      var selectedBytes = view.sessions.reduce(function (sum, s) {
        return selected[s.id] ? sum + (s.sizeBytes || 0) : sum;
      }, 0);

      var toggle = function (id) {
        setSelected(function (prev) {
          var next = Object.assign({}, prev);
          if (next[id]) delete next[id]; else next[id] = true;
          return next;
        });
        disarmAll();
      };

      var toggleAll = function () {
        var selectable = view.sessions.filter(function (s) { return !(s.live && keepLive); });
        var allOn = selectable.length > 0 && selectable.every(function (s) { return selected[s.id]; });
        var next = {};
        if (!allOn) selectable.forEach(function (s) { next[s.id] = true; });
        setSelected(next);
        disarmAll();
      };

      var runDelete = function (ids, isPurge) {
        if (isBusy) return;
        setBusy(true);
        setMessage(null);
        var url = isPurge ? API_PURGE : API_DELETE;
        var body = isPurge ? { keepLive: keepLive } : { ids: ids, keepLive: keepLive };
        requestJson(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then(function (result) {
            var removed = (result.removed || []).length;
            var failedList = result.failed || [];
            var failed = failedList.length;
            var skipped = (result.skipped || []).length;
            var bits;
            var kind;
            if (removed === 0 && failed === 0) {
              // 全被保护挡住：这不是成功，也不能显示成绿色"已删除 0 个"
              bits = ['没有删除任何会话'];
              if (skipped) bits.push('全部 ' + skipped + ' 个都受保护（使用中）');
              kind = 'err';
            } else {
              bits = ['已删除 ' + removed + ' 个会话'];
              if (skipped) bits.push('跳过 ' + skipped + ' 个' + (keepLive ? '（使用中）' : ''));
              if (failed) {
                var names = failedList.slice(0, 3).map(function (f) {
                  return (f.reason || f.code || '未知原因');
                });
                bits.push('失败 ' + failed + ' 个（' + names.join('、') + (failed > 3 ? ' 等' : '') + '）');
              }
              kind = failed ? 'err' : 'ok';
            }
            setMessage({ kind: kind, text: bits.join('，') });
            // 只清掉成功的；失败的保留选中，用户可以直接再点一次重试
            setSelected(function (prev) {
              var next = {};
              failedList.forEach(function (f) { if (prev[f.id]) next[f.id] = true; });
              return next;
            });
            disarmAll();
            return load();
          })
          .catch(function (err) {
            var detail = err.payload && err.payload.stderr ? ' — ' + String(err.payload.stderr).slice(0, 300) : '';
            setMessage({ kind: 'err', text: '操作失败：' + err.message + detail });
          })
          .finally(function () { setBusy(false); });
      };

      var onDeleteSelected = function () {
        if (selectedIds.length === 0) return;
        if (!armedDelete) { setArmedDelete(true); return; }
        runDelete(selectedIds, false);
      };

      var onPurge = function () {
        if (!armedPurge) { setArmedPurge(true); return; }
        runDelete(null, true);
      };

      var header = h('div', { className: 'bs-head' },
        h('div', { className: 'bs-title' }, 'billion-context 会话清理'),
        h('div', { className: 'bs-sub' },
          view.phase === 'error'
            ? '读取失败'
            : view.sessions.length > 0
              ? '共 ' + view.sessions.length + ' 个会话，占用 ' + formatBytes(totalBytes)
              : '正在读取会话清单…'),
      );

      if (view.phase === 'loading' && view.sessions.length === 0) {
        return h('div', { className: 'bs-root' }, header,
          h('div', { className: 'bs-empty' }, '读取中…'));
      }

      if (view.phase === 'error') {
        return h('div', { className: 'bs-root' }, header,
          h('div', { className: 'bs-msg bs-msg-err', role: 'status' }, '读取失败：' + view.error),
          h('div', { className: 'bs-bar' },
            h('button', { className: 'bs-btn', onClick: load }, '重试')),
        );
      }

      var env = view.env || {};
      var envLine = [];
      if (env.dataDir) envLine.push('数据目录 ' + env.dataDir);
      if (env.cliFound) envLine.push('CLI 已就绪');

      var selectable = view.sessions.filter(function (s) { return !(s.live && keepLive); });
      var allSelected = selectable.length > 0
        && selectable.every(function (s) { return selected[s.id]; });
      // 「清空全部」实际会删的就是这些；全被保护时必须置灰，不能让它点出一句"已删除 0 个"
      var purgeTargets = selectable;
      var purgeBytes = purgeTargets.reduce(function (sum, s) { return sum + (s.sizeBytes || 0); }, 0);

      var bar = h('div', { className: 'bs-bar' },
        h('button', { className: 'bs-btn', onClick: load, disabled: isBusy }, '刷新'),
        h('button', { className: 'bs-btn', onClick: toggleAll, disabled: isBusy || selectable.length === 0 },
          allSelected ? '取消全选' : '全选'),
        h('span', { className: 'bs-spacer' }),
        h('button', {
          className: 'bs-btn bs-btn-danger' + (armedDelete ? ' bs-armed' : ''),
          onClick: onDeleteSelected,
          disabled: isBusy || selectedIds.length === 0,
          title: selectedIds.length ? '删除勾选的会话，删除后无法恢复' : '先勾选要删除的会话',
        }, armedDelete && selectedIds.length > 0
          ? '确认删除 ' + selectedIds.length + ' 个（' + formatBytes(selectedBytes) + '）'
          : '删除选中' + (selectedIds.length
            ? '（' + selectedIds.length + ' 个 · ' + formatBytes(selectedBytes) + '）'
            : '')),
        h('button', {
          className: 'bs-btn bs-btn-danger' + (armedPurge ? ' bs-armed' : ''),
          onClick: onPurge,
          disabled: isBusy || purgeTargets.length === 0,
          title: purgeTargets.length ? '删除全部可删会话，删除后无法恢复' : '没有可删除的会话',
        }, armedPurge
          ? '确认清空 ' + purgeTargets.length + ' 个（' + formatBytes(purgeBytes) + '）'
          : '清空全部'),
      );

      var guardLine = h('label', {
        className: 'bs-row-meta',
        style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' },
      },
        h('input', {
          type: 'checkbox',
          checked: keepLive,
          style: { width: '14px', height: '14px', accentColor: 'var(--dsw-alias-button-primary-fill,#2a6df4)' },
          onChange: function (e) { setKeepLive(e.target.checked); disarmAll(); setSelected({}); },
        }),
        '保护正在使用的会话',
      );

      // 代理不可达时 live 标记全是 false，保护开关会静默失效 —— 这是最危险的状态，
      // 必须显式告知，而不是让用户以为正在被保护。
      var warnNode = view.proxyReachable === false
        ? h('div', { className: 'bs-warn', role: 'status' },
          '无法读取「使用中」状态，保护开关当前无效。此时所有会话都显示为可删除，'
          + '请在删除前确认没有正在进行的对话。')
        : null;

      var list = h('div', { className: 'bs-list' },
        view.sessions.length === 0
          ? h('div', { className: 'bs-empty' }, '没有会话记录')
          : view.sessions.map(function (s) {
            return h(Row, {
              key: s.id, session: s, checked: Boolean(selected[s.id]),
              keepLive: keepLive, onToggle: toggle,
            });
          }),
      );

      var messageNode = message
        ? h('div', {
          className: 'bs-msg ' + (message.kind === 'err' ? 'bs-msg-err' : 'bs-msg-ok'),
          role: 'status',
          'aria-live': 'polite',
        }, message.text)
        : null;

      var envNode = envLine.length
        ? h('div', { className: 'bs-sub bs-mono', style: { wordBreak: 'break-all' } }, envLine.join(' · '))
        : null;

      return h('div', { className: 'bs-root' },
        header, envNode, warnNode, bar, guardLine, messageNode, list,
      );
    }

    return {
      inject: ['slots'],
      apply: function (ctx) {
        var slots = ctx.get('slots');
        if (!slots || typeof slots.inject !== 'function') return;
        // 样式是插件拥有的资源：交给 ctx.effect，禁用插件时自动摘除
        if (typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return mountStyle(typeof document !== 'undefined' ? document : null);
          });
        } else {
          mountStyle(typeof document !== 'undefined' ? document : null);
        }
        slots.inject('sidebar.panellist', function () {
          return slots.register({
            name: 'sidebar.panellist', id: PANEL_ID, order: 62, label: '上下文缓存清理',
          }, Glyph);
        });
        slots.inject('main', function () {
          return slots.register({ name: 'main', key: PANEL_ID }, Panel);
        });
      },
    };
  },
});
