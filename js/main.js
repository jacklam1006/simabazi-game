/**
 * main.js · 入口，串联所有模块
 */

(function () {
  const container = document.getElementById('canvas-container');

  const sb    = new SceneBuilder(container).init();
  const anno  = new AnnotationSystem(sb.scene, sb.camera, sb.renderer);
  const journey = new UserJourney(sb, anno);

  window._journey = journey;

  sb.startRenderLoop();   // 轨道控制已内置，无需外部旋转
  journey.start();
})();
