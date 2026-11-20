// dsh-bili-sessions —— Host 端
//
// 目的：在 DSH 界面内列出、删除、清空 billion-context 的会话记录。
//
// 为什么走 CLI 子进程而不是直接改 SQLite：
//   index.db 里 content 是带 refcount 的内容寻址表，blocks / refs / conversations
//   各自持有引用。手写 SQL 删除必须同时维护五张表的引用计数，任何一处算错都会
//   让别的会话丢内容。bili sessions rm 已经把这件事做对了（含 media refcount
//   释放与 vacuum），所以这里只负责调度它。
//
// 为什么 CLI 在 agent 沙箱里跑不起来、在 Host 里却可以：
//   agent 的子进程被 DSH 沙箱切断 stdio 管道（execFile 一律 EPERM），且无法写
//   工作区外的 C:\Users\...。Host 主进程不受该沙箱约束，子进程继承 Host 权限。

import { spawn } from 'node:child_process';
import {
  accessSync, closeSync, constants, mkdtempSync, openSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const name = 'dsh-bili-sessions';

/** 代理默认端口与路径，与 billion-context 的默认配置一致。 */
const DEFAULT_PROXY = 'http://127.0.0.1:18787';

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** profile 目录：profileContext 是官方权威来源，env 兜底。 */
function resolveProfileDir(ctx) {
  try {
    const pc = typeof ctx.get === 'function' ? ctx.get('profileContext') : undefined;
    if (pc && typeof pc.dir === 'string' && pc.dir) return pc.dir;
  } catch {
    /* 服务缺失继续兜底 */
  }
  if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR;
  if (process.env.DSH_HOME) {
    return join(process.env.DSH_HOME, 'profiles', process.env.DSH_PROFILE || 'desktop');
  }
  return '';
}

/** 定位 billion-context 的 CLI 入口。装在哪取决于它是 profile 依赖还是随发行版内置。 */
function resolveCliPath(ctx) {
  const candidates = [];
  const profileDir = resolveProfileDir(ctx);
  if (profileDir) {
    candidates.push(join(profileDir, 'node_modules', 'billion-context', 'dist', 'index.js'));
  }
  // DSH 安装目录内置副本
  const exeDir = process.execPath ? join(process.execPath, '..') : '';
  if (exeDir) {
    candidates.push(join(exeDir, 'resources', 'app.asar', 'dsh', 'node_modules', 'billion-context', 'dist', 'index.js'));
  }
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.R_OK);
      return candidate;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

/** billion-context 的数据目录（会话、配置都在这里）。 */
function resolveDataDir() {
  if (process.env.BILI_SESSIONS_DIR) return { sessions: process.env.BILI_SESSIONS_DIR, source: 'BILI_SESSIONS_DIR' };
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (process.platform === 'win32') {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg) return { sessions: join(xdg, 'billion-context', 'sessions'), source: 'XDG_DATA_HOME' };
    return { sessions: join(home, '.local', 'share', 'billion-context', 'sessions'), source: 'default' };
  }
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return { sessions: join(xdg, 'billion-context', 'sessions'), source: 'XDG_DATA_HOME' };
  return { sessions: join(home, '.local', 'share', 'billion-context', 'sessions'), source: 'default' };
}

/**
 * 跑一次 bili CLI。
 *
 * 输出重定向到临时文件而不是管道：Host 子进程的 stdio 管道在某些 Windows 配置下
 * 会被完整性标签或安全软件挡住，文件重定向没有这个问题，也不需要额外的缓冲逻辑。
 */
function runCli(cliPath, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), 'bili-sessions-'));
    const outPath = join(dir, 'out.txt');
    const errPath = join(dir, 'err.txt');
    let fdOut;
    let fdErr;
    let settled = false;
    const cleanup = () => {
      for (const fd of [fdOut, fdErr]) {
        if (typeof fd === 'number') {
          try {
            closeSync(fd);
          } catch {
            /* 可能已随进程退出关闭 */
          }
        }
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 忽略 */
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    let child;
    try {
      fdOut = openSync(outPath, 'w');
      fdErr = openSync(errPath, 'w');
      child = spawn(process.execPath, [cliPath, ...args], {
        // ELECTRON_RUN_AS_NODE：宿主 exe 本身是 Electron，这个变量把它变成 node。
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', fdOut, fdErr],
        windowsHide: true,
      });
    } catch (error) {
      finish({ ok: false, code: null, stdout: '', stderr: String(error), reason: 'spawn-failed' });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* 忽略 */
      }
      finish({ ok: false, code: null, stdout: readSafe(outPath), stderr: readSafe(errPath), reason: 'timeout' });
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, code: null, stdout: readSafe(outPath), stderr: String(error), reason: 'spawn-error' });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const stdout = readSafe(outPath);
      const stderr = readSafe(errPath);
      finish({ ok: code === 0, code, stdout, stderr, reason: code === 0 ? null : 'exit-nonzero' });
    });
  });
}

function readSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** 从 CLI 的混合输出里抠出 JSON 数组／对象。CLI 会把日志打到 stderr，stdout 才是 JSON。 */
function parseJsonOutput(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试截取 */
  }
  const firstBracket = Math.min(
    ...[trimmed.indexOf('['), trimmed.indexOf('{')].filter((index) => index >= 0),
  );
  if (!Number.isFinite(firstBracket)) return null;
  const opener = trimmed[firstBracket];
  const closer = opener === '[' ? ']' : '}';
  const lastIndex = trimmed.lastIndexOf(closer);
  if (lastIndex <= firstBracket) return null;
  try {
    return JSON.parse(trimmed.slice(firstBracket, lastIndex + 1));
  } catch {
    return null;
  }
}

/** 读代理的会话概览（拿到标题与 live 标记，CLI 的 ls 没有这些）。代理没在跑时返回空表。 */
async function fetchProxySessions(proxyBase) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`${proxyBase}/__bili/sessions`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return new Map();
    const payload = await response.json();
    const list = Array.isArray(payload?.sessions)
      ? payload.sessions
      : Array.isArray(payload) ? payload : [];
    return new Map(list.map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
}

/**
 * 直接读 index.db 取标题。
 *
 * 代理 /__bili/sessions 的 title 是 DSH 生成的短标题，但代理挂了就读不到；
 * 而 CLI 的 sessions ls 只回 id/label/size/lastUpdated，label 那列存的其实就是
 * session_id，当标题用毫无意义。索引库里有三档可用文本，优先级从短到长：
 *   host_title（DSH 生成的短标题）> title（用户第一句话）> label（通常等于 id，丢弃）
 * 只读打开，不影响正在写库的代理。
 */
async function readTitlesFromDb(diag) {
  const result = new Map();
  const sessionsDir = resolveDataDir().sessions;
  const dbPath = join(sessionsDir, 'index.db');
  let db = null;
  try {
    const sqlite = await import('node:sqlite');
    if (diag) diag.sqliteModule = Object.keys(sqlite).join(',');
    const { DatabaseSync } = sqlite;
    if (diag) diag.databaseSyncType = typeof DatabaseSync;
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare('SELECT session_id, title, host_title FROM sessions')
      .all();
    if (diag) diag.rowsRead = rows.length;
    for (const row of rows) {
      const id = String(row.session_id || '');
      if (!id) continue;
      const host = typeof row.host_title === 'string' ? row.host_title.trim() : '';
      const full = typeof row.title === 'string' ? row.title.trim() : '';
      result.set(id, { hostTitle: host, title: full });
    }
  } catch (error) {
    if (diag) diag.dbError = String(error && error.message ? error.message : error);
  } finally {
    try {
      db?.close();
    } catch {
      /* 忽略 */
    }
  }
  if (diag) diag.titlesFound = result.size;
  return result;
}

/**
 * 打码。
 *
 * 会话首句常常就是用户粘进来的 API key / token —— 界面上原样显示等于把密钥
 * 摊在屏幕上，截个图分享出去就漏了。凡是像凭据的片段一律只留头尾。
 */
const SECRET_PATTERNS = [
  // sk-xxxx / sk-proj-xxxx / ghp_xxx / xoxb-xxx 之类常见前缀
  /\b(?:sk|rk|pk|ghp|gho|ghu|ghs|ghr|xox[baprs]|glpat|hf)[-_][A-Za-z0-9_-]{12,}\b/g,
  // 长串无分隔的随机字符（多半是 token）
  /\b[A-Za-z0-9]{32,}\b/g,
  // key=value 形态
  /\b([A-Za-z_]*(?:api[_-]?key|token|secret|password|passwd))\s*[=:]\s*\S+/gi,
];

function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, keyName) => {
      if (keyName) return `${keyName}=***`;
      if (match.length <= 14) return match;
      return `${match.slice(0, 6)}…${match.slice(-4)}`;
    });
  }
  return out;
}

/** 标题优先级：DSH 短标题 > 用户首句 > 代理给的 > 空（前端会退回显示短 ID）。 */
function pickTitle(cliLabel, dbRow, proxyRow) {
  const candidates = [
    dbRow?.hostTitle,
    proxyRow?.title,
    dbRow?.title,
    cliLabel,
  ];
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text) continue;
    // label 列存的是 session_id，当标题毫无意义，直接跳过
    if (/^session-[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text)) continue;
    return redactSecrets(text);
  }
  return '';
}

function findProxyArg(config) {
  const port = Number(config?.proxyPort) || 18787;
  const host = typeof config?.proxyHost === 'string' && config.proxyHost ? config.proxyHost : '127.0.0.1';
  return `http://${host}:${port}`;
}

export function apply(ctx, config = {}) {
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      const proxyBase = findProxyArg(config);

      /** GET /state：环境自检，前端据此决定显示什么。 */
      const stateHandler = async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const cliPath = resolveCliPath(hostCtx);
        const dataDir = resolveDataDir();
        let dataDirReadable = false;
        try {
          accessSync(dataDir.sessions, constants.R_OK);
          dataDirReadable = true;
        } catch {
          /* 目录不存在 */
        }
        sendJson(res, 200, {
          ok: true,
          cliPath,
          cliFound: Boolean(cliPath),
          dataDir: dataDir.sessions,
          dataDirSource: dataDir.source,
          dataDirReadable,
          proxy: proxyBase,
          platform: process.platform,
          execPath: process.execPath,
        });
      };

      /** GET /list：会话清单，合并 CLI 的容量信息与代理的 live 标记。 */
      const listHandler = async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const cliPath = resolveCliPath(hostCtx);
        if (!cliPath) {
          sendJson(res, 500, { ok: false, error: 'cli-not-found', hint: '没找到 billion-context 的 dist/index.js' });
          return;
        }
        const diag = {};
        const [result, proxyRows, dbTitles] = await Promise.all([
          runCli(cliPath, ['sessions', 'ls', '--json']),
          fetchProxySessions(proxyBase),
          readTitlesFromDb(diag),
        ]);
        if (!result.ok) {
          sendJson(res, 500, {
            ok: false,
            error: 'cli-failed',
            reason: result.reason,
            code: result.code,
            stderr: result.stderr.slice(-4000),
          });
          return;
        }
        const parsed = parseJsonOutput(result.stdout);
        if (!Array.isArray(parsed)) {
          sendJson(res, 500, {
            ok: false,
            error: 'unparsable-output',
            stdout: result.stdout.slice(-2000),
            stderr: result.stderr.slice(-2000),
          });
          return;
        }
        const sessions = parsed.map((row) => {
          const extra = proxyRows.get(row.id) || null;
          const dbRow = dbTitles.get(row.id) || null;
          return {
            id: row.id,
            title: pickTitle(row.label, dbRow, extra),
            firstMessage: redactSecrets(dbRow?.title || ''),
            sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : 0,
            lastUpdated: typeof row.lastUpdated === 'number' ? row.lastUpdated : 0,
            status: row.status || 'active',
            live: Boolean(extra?.live),
            requests: typeof extra?.requests === 'number' ? extra.requests : null,
            model: extra?.model || null,
            blocksCount: typeof extra?.blocks === 'number' ? extra.blocks : null,
          };
        });
        sessions.sort((a, b) => b.lastUpdated - a.lastUpdated);
        const totalBytes = sessions.reduce((sum, row) => sum + row.sizeBytes, 0);
        sendJson(res, 200, {
          ok: true,
          sessions,
          total: sessions.length,
          totalBytes,
          proxyReachable: proxyRows.size > 0,
          diag,
        });
      };

      /** POST /delete：删除指定会话。body { ids: string[], keepLive?: boolean, dryRun?: boolean } */
      const deleteHandler = async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (error) {
          sendJson(res, 400, { ok: false, error: 'bad-json', detail: String(error) });
          return;
        }
        const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string' && id) : [];
        if (ids.length === 0) {
          sendJson(res, 400, { ok: false, error: 'no-ids' });
          return;
        }
        const keepLive = body?.keepLive !== false;
        const dryRun = body?.dryRun === true;
        const cliPath = resolveCliPath(hostCtx);
        if (!cliPath) {
          sendJson(res, 500, { ok: false, error: 'cli-not-found' });
          return;
        }

        // 保护当前活跃会话：删掉它会让正在进行的对话丢掉上下文压缩缓存。
        let liveIds = new Set();
        if (keepLive) {
          const proxyRows = await fetchProxySessions(proxyBase);
          liveIds = new Set([...proxyRows.entries()].filter(([, row]) => row?.live).map(([id]) => id));
        }
        const skipped = [];
        const targets = [];
        for (const id of ids) {
          if (keepLive && liveIds.has(id)) skipped.push({ id, reason: 'live-session' });
          else targets.push(id);
        }
        if (dryRun) {
          sendJson(res, 200, { ok: true, dryRun: true, wouldDelete: targets, skipped });
          return;
        }

        const removed = [];
        const failed = [];
        for (const id of targets) {
          const result = await runCli(cliPath, ['sessions', 'rm', id, '--json']);
          if (result.ok) {
            removed.push({ id, output: parseJsonOutput(result.stdout) });
          } else {
            failed.push({ id, reason: result.reason, code: result.code, stderr: result.stderr.slice(-1500) });
          }
        }
        sendJson(res, 200, { ok: failed.length === 0, removed, failed, skipped });
      };

      /** POST /purge：清空。body { keepLive?: boolean, dryRun?: boolean } */
      const purgeHandler = async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (error) {
          sendJson(res, 400, { ok: false, error: 'bad-json', detail: String(error) });
          return;
        }
        const cliPath = resolveCliPath(hostCtx);
        if (!cliPath) {
          sendJson(res, 500, { ok: false, error: 'cli-not-found' });
          return;
        }
        const listResult = await runCli(cliPath, ['sessions', 'ls', '--json']);
        if (!listResult.ok) {
          sendJson(res, 500, { ok: false, error: 'list-failed', stderr: listResult.stderr.slice(-2000) });
          return;
        }
        const parsed = parseJsonOutput(listResult.stdout);
        if (!Array.isArray(parsed)) {
          sendJson(res, 500, { ok: false, error: 'unparsable-output' });
          return;
        }
        const keepLive = body?.keepLive !== false;
        const dryRun = body?.dryRun === true;
        let liveIds = new Set();
        if (keepLive) {
          const proxyRows = await fetchProxySessions(proxyBase);
          liveIds = new Set([...proxyRows.entries()].filter(([, row]) => row?.live).map(([id]) => id));
        }
        const targets = parsed.map((row) => row.id).filter((id) => !(keepLive && liveIds.has(id)));
        const skipped = parsed
          .map((row) => row.id)
          .filter((id) => keepLive && liveIds.has(id))
          .map((id) => ({ id, reason: 'live-session' }));
        if (dryRun) {
          sendJson(res, 200, { ok: true, dryRun: true, wouldDelete: targets, skipped });
          return;
        }
        const removed = [];
        const failed = [];
        for (const id of targets) {
          const result = await runCli(cliPath, ['sessions', 'rm', id, '--json']);
          if (result.ok) removed.push({ id });
          else failed.push({ id, reason: result.reason, code: result.code, stderr: result.stderr.slice(-1500) });
        }
        sendJson(res, 200, { ok: failed.length === 0, removed, failed, skipped });
      };

      const disposers = [
        hostCtx.webServer.register({ kind: 'exact', path: '/plugins/dsh-bili-sessions/state', handler: stateHandler }),
        hostCtx.webServer.register({ kind: 'exact', path: '/plugins/dsh-bili-sessions/list', handler: listHandler }),
        hostCtx.webServer.register({ kind: 'exact', path: '/plugins/dsh-bili-sessions/delete', handler: deleteHandler }),
        hostCtx.webServer.register({ kind: 'exact', path: '/plugins/dsh-bili-sessions/purge', handler: purgeHandler }),
      ];
      return () => {
        for (const dispose of disposers) {
          try {
            dispose?.();
          } catch {
            /* 忽略 */
          }
        }
      };
    });
  });
}
