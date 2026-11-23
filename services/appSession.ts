/**
 * 启动状态的最小共享标记。
 *
 * 单独放一个模块，避免 authStore / homeStore 为了读启动状态而反向依赖
 * bootStore，形成 store 之间的循环引用。
 */
let bootRunning = false;

export const setBootRunning = (value: boolean) => {
  bootRunning = value;
};

export const isBootRunning = () => bootRunning;
