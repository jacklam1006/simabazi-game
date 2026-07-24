/**
 * config.js · 全局配置
 * 修改此文件来调整颜色、API 地址、功能开关等
 */

const CONFIG = {
  // API 地址（生产环境改为 Render 上的真实 URL）
  API_BASE: 'https://simabazi-api.onrender.com',

  // 五行颜色主题
  WUXING_COLORS: {
    木: { primary: '#6FCF97', glow: 'rgba(111,207,151,0.3)', name: '木' },
    火: { primary: '#EB5757', glow: 'rgba(235,87,87,0.3)',   name: '火' },
    土: { primary: '#F2C94C', glow: 'rgba(242,201,76,0.3)',  name: '土' },
    金: { primary: '#E8D5A8', glow: 'rgba(232,213,168,0.3)', name: '金' },
    水: { primary: '#6EB5FF', glow: 'rgba(110,181,255,0.3)', name: '水' },
  },

  // 场景设置
  SCENE: {
    fogColor: 0x0a0a12,
    fogNear: 20,
    fogFar: 80,
    ambientIntensity: 0.4,
    cameraFov: 60,
    cameraZ: 18,
  },

  // 功能开关
  FEATURES: {
    multiplayer: false,   // 多人联机（阶段4b开启）
    shareLink:   false,   // 分享链接（阶段4a开启）
    dailyTasks:  false,   // 每日任务（阶段3开启）
  },

  // 版本
  VERSION: '0.1.0-scaffold',
};
