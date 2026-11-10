// 微内核核心：跨模块解耦通信总线（基于浏览器原生 CustomEvent 封装）
// 宪章契约：模块间通信唯一通道；监听方被删除时发送方依然安全运行
// 事件字典登记于根目录 Rules.md 第 6.2 节

const BUS_TARGET = typeof window !== 'undefined' ? window : globalThis;

export class EventBus {
  constructor(namespace = 'zkt-bus') {
    this._ns = namespace;
    this._handlers = new Map(); // eventName -> Set<Function>（用于显式 off）
  }

  /** 触发事件：payload 直接挂在 CustomEvent.detail 上 */
  emit(eventName, payload = null) {
    const listeners = this._handlers.get(eventName);
    if (!listeners || listeners.size === 0) return false; // 无监听方时安全静默
    BUS_TARGET.dispatchEvent(new CustomEvent(`${this._ns}:${eventName}`, { detail: payload }));
    return true;
  }

  /** 注册监听（返回解绑函数，便于模块 unmount 清理） */
  on(eventName, handler) {
    if (typeof handler !== 'function') throw new Error('eventBus.on 需要函数 handler');
    const namespaced = `${this._ns}:${eventName}`;
    const wrapper = (event) => handler(event.detail, event);
    if (!this._handlers.has(eventName)) this._handlers.set(eventName, new Set());
    this._handlers.get(eventName).add(wrapper);
    BUS_TARGET.addEventListener(namespaced, wrapper);
    return () => this.off(eventName, wrapper);
  }

  /** 显式解绑（接受 on 返回的解绑函数或原 handler 包装） */
  off(eventName, handler) {
    const listeners = this._handlers.get(eventName);
    if (!listeners) return false;
    const target = listeners.has(handler) ? handler : null;
    if (!target) {
      // 允许按原 handler 反查（on 内部包装过）
      for (const w of listeners) {
        if (w._zktOriginal === handler) { listeners.delete(w); BUS_TARGET.removeEventListener(`${this._ns}:${eventName}`, w); return true; }
      }
      return false;
    }
    listeners.delete(target);
    BUS_TARGET.removeEventListener(`${this._ns}:${eventName}`, target);
    return true;
  }
}

/** 全局唯一总线实例（宿主 context.eventBus 注入各模块） */
export const eventBus = new EventBus();
