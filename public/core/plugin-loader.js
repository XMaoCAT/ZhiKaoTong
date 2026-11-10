// 微内核核心：插件加载器
// 宪章铁律 §3.3-4：先鉴权后加载；manifest 校验（enabled/platforms/allowedUserGroups）；
// 每个模块独立 try...catch 熔断，404/异常仅 warn 并跳过，绝不中断宿主与其他模块
import { eventBus } from './event-bus.js';

const REGISTRY_URL = './modules/registry.json';
const mounted = new Map(); // moduleId -> { module, container, context, cleanup: Set<Function> }

/** 读取并校验 manifest：enabled / 终端 / 用户群组三重过滤（§3.3-4） */
async function fetchManifest(folder) {
  const res = await fetch(`./modules/${folder}/manifest.json`, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error(`manifest ${res.status}`), { statusCode: res.status, missing: true });
  return res.json();
}

function manifestAllows(manifest, hostCtx) {
  const platform = hostCtx?.platform;
  const userGroup = hostCtx?.user?.group ?? hostCtx?.userGroup ?? 'guest';
  if (manifest.enabled !== true) return false;
  const platforms = Array.isArray(manifest.platforms) ? manifest.platforms : ['pc'];
  if (!platforms.includes(platform)) return false;
  const groups = Array.isArray(manifest.allowedUserGroups) ? manifest.allowedUserGroups : null;
  if (!groups) return true; // 未配置视为全开放
  // 未登录（guest）仅允许显式声明 guest 的模块（如登录页）；其余模块需登录后按角色挂载
  return groups.includes(userGroup);
}

/**
 * 直接挂载单个已知模块（宿主切换主区/顶栏/手机台时使用，走同一套 manifest 鉴权与熔断）
 */
export async function mountModuleDirect(folder, hostContext) {
  try {
    const manifest = await fetchManifest(folder);
    if (!manifestAllows(manifest, hostContext)) return false;
    if (mounted.has(manifest.moduleId)) await unmountModule(manifest.moduleId);
    return mountModule(folder, manifest, hostContext);
  } catch (err) {
    if (err.missing) console.warn(`[plugin-loader] 模块文件夹 ${folder} 不存在（404），跳过`);
    else console.warn(`[plugin-loader] 模块 ${folder} 加载异常，跳过：`, err.message);
    return false;
  }
}

/** 加载并挂载单个模块（独立熔断） */
async function mountModule(folder, manifest, hostContext) {
  const container = document.querySelector(manifest.mountSlot || '#slot-main');
  if (!container) {
    console.warn(`[plugin-loader] ${manifest.moduleId} 挂载插槽 ${manifest.mountSlot} 不存在，跳过`);
    return false;
  }
  const context = { ...hostContext, eventBus, slot: manifest.mountSlot };
  const cleanup = new Set();

  try {
    // 私有样式懒加载（挂载前注入，卸载时移除）
    let styleEl = null;
    if (manifest.style) {
      styleEl = document.createElement('link');
      styleEl.rel = 'stylesheet';
      styleEl.dataset.mod = manifest.moduleId;
      styleEl.href = `./modules/${folder}/${manifest.style.replace(/^\.\//, '')}`;
      document.head.appendChild(styleEl);
      cleanup.add(() => styleEl?.remove());
    }

    const mod = await import(`./../modules/${folder}/${(manifest.entry || './index.js').replace(/^\.\//, '')}`);
    if (typeof mod.mount !== 'function') throw new Error('模块缺少 mount() 导出');
    await mod.mount(container, context);
    mounted.set(manifest.moduleId, { module: mod, container, context, cleanup });
    return true;
  } catch (err) {
    console.warn(`[plugin-loader] 模块 ${folder} 挂载失败，已熔断跳过：`, err && (err.stack || err.message || String(err)));
    // 回滚已注入的副作用
    cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    const entry = mounted.get(manifest.moduleId);
    if (entry) mounted.delete(manifest.moduleId);
    return false;
  }
}

/** 卸载指定模块（权限切换/端口切换/热关闭时彻底清理） */
export async function unmountModule(moduleId) {
  const entry = mounted.get(moduleId);
  if (!entry) return false;
  try {
    if (typeof entry.module.unmount === 'function') await entry.module.unmount(entry.container, entry.context);
  } catch (err) {
    console.warn(`[plugin-loader] 模块 ${moduleId} unmount 抛错（忽略，继续清理）：`, err.message);
  }
  entry.cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  entry.container.innerHTML = '';
  mounted.delete(moduleId);
  return true;
}

/**
 * 启动入口：扫描 registry.json → 逐个校验 manifest → 鉴权通过的才挂载
 * @param {Object} hostContext { user:{ id, group }, platform: 'pc'|'mobile' }
 */
export async function loadPlugins(hostContext) {
  let folders = [];
  try {
    const res = await fetch(REGISTRY_URL, { cache: 'no-store' });
    if (res.ok) folders = (await res.json()).modules || [];
  } catch (err) {
    console.warn('[plugin-loader] registry.json 读取失败，无模块可加载：', err.message);
    return { mounted: 0 };
  }

  let count = 0;
  for (const folder of folders) {
    try {
      const manifest = await fetchManifest(folder);
      if (!manifestAllows(manifest, hostContext)) continue; // 不满足开关/端口/群组 → 静默跳过
      if (await mountModule(folder, manifest, hostContext)) count++;
    } catch (err) {
      if (err.missing) console.warn(`[plugin-loader] 模块文件夹 ${folder} 不存在（404），跳过`);
      else console.warn(`[plugin-loader] 模块 ${folder} 加载异常，跳过：`, err.message);
      continue; // 铁律：单模块故障绝不中断整体
    }
  }
  return { mounted: count, mountedIds: Array.from(mounted.keys()) };
}

/** 用户/平台变化：广播 context:user-changed（各模块自行决定是否重渲染） */
export function broadcastContext(user, platform) {
  eventBus.emit('context:user-changed', { userId: user?.id ?? '', group: user?.group ?? '', platform });
}

export const getMounted = () => Array.from(mounted.keys());
