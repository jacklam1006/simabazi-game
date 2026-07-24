/**
 * main.js · 入口，串联所有模块
 */

(function () {
  const container = document.getElementById('canvas-container');

  // 初始化场景
  const sb = new SceneBuilder(container).init();

  // 初始化标注系统
  const anno = new AnnotationSystem(sb.scene, sb.camera, sb.renderer);

  // 初始化用户旅程
  const journey = new UserJourney(sb, anno);
  window._journey = journey; // 供 HTML 按钮调用

  // 启动渲染循环
  sb.startRenderLoop(() => {
    // 每帧逻辑：轻微自动旋转场景
    sb.scene.rotation.y += 0.0005;
  });

  // 启动旅程
  journey.start();
})();
